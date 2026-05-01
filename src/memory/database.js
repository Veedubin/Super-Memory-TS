/**
 * Memory Database Layer
 *
 * Handles Qdrant operations for memory storage with HNSW indexing.
 * Uses Qdrant native client for vector storage with HNSW indexing and payload filtering.
 */
import { QdrantClient } from '@qdrant/js-client-rest';
import { randomUUID, createHash } from 'crypto';
import { MEMORY_TABLE_NAME, QDRANT_METADATA_COLLECTION, DEFAULT_QDRANT_URL, QDRANT_HNSW_CONFIG, PAYLOAD_FIELDS, DEFAULT_SEARCH_OPTIONS, } from './schema.js';
import { ModelManager } from '../model/index.js';
import { generateEmbeddings } from '../model/embeddings.js';
import { logger } from '../utils/logger.js';
import { getConfig } from '../config.js';
/**
 * Helper to compute SHA-256 hash
 */
function computeHash(text) {
    return createHash('sha256').update(text, 'utf-8').digest('hex');
}
// --- Client Cache ---
const clients = new Map();
/**
 * Validate that a client connection is healthy by checking collections.
 * Returns true if connection is working, false otherwise.
 */
async function validateConnection(client) {
    try {
        await client.getCollections();
        return true;
    }
    catch {
        return false;
    }
}
function getClient(url) {
    if (!clients.has(url)) {
        clients.set(url, new QdrantClient({ url, timeout: 60000, checkCompatibility: false }));
    }
    return clients.get(url);
}
/**
 * Remove a client from the cache with cleanup.
 * Aborts any pending requests before removal.
 */
function removeClient(url) {
    const client = clients.get(url);
    if (client) {
        // QdrantClient uses AbortController internally - trigger aborts
        // Client is stateless HTTP, so no persistent connections to close
        clients.delete(url);
    }
}
/**
 * Clear all clients from the cache (for shutdown/testing)
 */
export function clearClientCache() {
    clients.clear();
}
/**
 * Retry wrapper for transient network errors with optional connection validation.
 * Before each attempt, validates the connection is healthy and recreates if needed.
 */
async function withRetry(operation, url, retries = 3) {
    for (let i = 0; i < retries; i++) {
        try {
            // Get current client and validate health before operation
            const client = clients.get(url);
            if (client) {
                const healthy = await validateConnection(client);
                if (!healthy) {
                    // Connection dead - recreate with cleanup
                    removeClient(url);
                    const newClient = new QdrantClient({ url, timeout: 60000, checkCompatibility: false });
                    clients.set(url, newClient);
                }
            }
            return await operation();
        }
        catch (err) {
            if (i === retries - 1)
                throw err;
            await new Promise(r => setTimeout(r, 1000 * (i + 1)));
        }
    }
    throw new Error('Unreachable');
}
/**
 * Convert MemoryEntryInput + generated fields → Qdrant PointStruct
 */
function toPoint(id, vector, entry, timestamp, contentHash, projectId) {
    const payload = {
        [PAYLOAD_FIELDS.text]: entry.text,
        [PAYLOAD_FIELDS.content]: entry.text,
        [PAYLOAD_FIELDS.sourceType]: entry.sourceType,
        [PAYLOAD_FIELDS.sourcePath]: entry.sourcePath ?? '',
        [PAYLOAD_FIELDS.timestamp]: timestamp,
        [PAYLOAD_FIELDS.contentHash]: contentHash,
        [PAYLOAD_FIELDS.metadataJson]: entry.metadataJson ?? '',
        [PAYLOAD_FIELDS.sessionId]: entry.sessionId ?? '',
    };
    if (projectId) {
        payload[PAYLOAD_FIELDS.projectId] = projectId;
    }
    return { id, vector, payload };
}
/**
 * Type guard for named vectors (Record<string, number[]>)
 */
function isNamedVector(vector) {
    return typeof vector === 'object' && vector !== null && !Array.isArray(vector);
}
/**
 * Extract Float32Array from vector regardless of format
 */
function extractVector(point) {
    const rawVector = point.vector;
    // Handle flat number array
    if (Array.isArray(rawVector) && rawVector.length > 0 && typeof rawVector[0] === 'number') {
        return new Float32Array(rawVector);
    }
    // Handle named vectors
    if (isNamedVector(rawVector)) {
        const defaultVec = rawVector.default;
        if (Array.isArray(defaultVec) && defaultVec.length > 0 && typeof defaultVec[0] === 'number') {
            return new Float32Array(defaultVec);
        }
    }
    return new Float32Array();
}
/**
 * Convert Qdrant ScoredPoint/Record → MemoryEntry
 */
function pointToMemoryEntry(point) {
    const payload = point.payload ?? {};
    const vector = extractVector(point);
    const ts = payload[PAYLOAD_FIELDS.timestamp];
    return {
        id: String(point.id),
        text: payload[PAYLOAD_FIELDS.text] ?? '',
        vector,
        sourceType: payload[PAYLOAD_FIELDS.sourceType] ?? 'session',
        sourcePath: payload[PAYLOAD_FIELDS.sourcePath] || undefined,
        timestamp: ts ? new Date(ts) : new Date(),
        contentHash: payload[PAYLOAD_FIELDS.contentHash] ?? '',
        metadataJson: payload[PAYLOAD_FIELDS.metadataJson] || undefined,
        sessionId: payload[PAYLOAD_FIELDS.sessionId] || undefined,
        projectId: payload[PAYLOAD_FIELDS.projectId] || undefined,
    };
}
// --- Database Class ---
export class MemoryDatabase {
    initialized = false;
    connected = false;
    client;
    qdrantUrl;
    projectId;
    constructor(url = DEFAULT_QDRANT_URL, projectId) {
        this.qdrantUrl = url;
        this.client = getClient(url);
        this.projectId = projectId;
    }
    /**
     * Build the project isolation filter with backward compatibility.
     * Matches entries with the current projectId OR entries with no projectId (legacy data).
     */
    getProjectFilter() {
        if (!this.projectId)
            return undefined;
        return {
            should: [
                { key: PAYLOAD_FIELDS.projectId, match: { value: this.projectId } },
                { is_empty: { key: PAYLOAD_FIELDS.projectId } },
            ],
        };
    }
    /**
     * Check if the database is connected (last health check succeeded)
     */
    isConnected() {
        return this.connected;
    }
    /**
     * Initialize the Qdrant collection
     */
    async initialize() {
        if (this.initialized)
            return;
        // Health check with retry - verify Qdrant is reachable
        try {
            await withRetry(() => this.client.getCollections(), this.qdrantUrl);
            this.connected = true;
        }
        catch (_err) {
            this.connected = false;
            throw new Error(`Cannot connect to Qdrant at ${this.qdrantUrl}. Ensure Qdrant is running: docker run -p 6333:6333 qdrant/qdrant`);
        }
        const modelManager = ModelManager.getInstance();
        const embeddingDim = modelManager.getDimensions();
        // Check if collection exists
        const collections = await withRetry(() => this.client.getCollections(), this.qdrantUrl);
        const exists = collections.collections.some(c => c.name === MEMORY_TABLE_NAME);
        if (!exists) {
            // Create collection with vector config
            await withRetry(() => this.client.createCollection(MEMORY_TABLE_NAME, {
                vectors: {
                    size: embeddingDim,
                    distance: 'Cosine',
                },
                hnsw_config: QDRANT_HNSW_CONFIG,
            }), this.qdrantUrl);
            // Create payload indexes for fields used in filtering
            await this.createPayloadIndexes();
            // Store model metadata
            await this.storeModelMetadata(modelManager.getMetadata().modelId, embeddingDim);
        }
        else {
            // Validate dimensions match
            await this.validateModelDimensions(embeddingDim);
            // Ensure project_id index exists for existing collections
            await this.ensureProjectIdIndex();
        }
        this.initialized = true;
    }
    /**
     * Create payload indexes for filter fields
     */
    async createPayloadIndexes() {
        const indexFields = [
            { field: PAYLOAD_FIELDS.sourceType, type: 'keyword' },
            { field: PAYLOAD_FIELDS.sourcePath, type: 'keyword' },
            { field: PAYLOAD_FIELDS.sessionId, type: 'keyword' },
            { field: PAYLOAD_FIELDS.contentHash, type: 'keyword' },
            { field: PAYLOAD_FIELDS.timestamp, type: 'integer' },
            { field: PAYLOAD_FIELDS.projectId, type: 'keyword' },
        ];
        for (const { field, type } of indexFields) {
            try {
                await this.client.createPayloadIndex(MEMORY_TABLE_NAME, {
                    field_name: field,
                    field_schema: type,
                });
            }
            catch (_err) {
                // Index may already exist — non-fatal
                logger.warn(`Payload index warning for ${field}:`, _err);
            }
        }
    }
    /**
     * Ensure project_id payload index exists (for existing collections)
     */
    async ensureProjectIdIndex() {
        try {
            await this.client.createPayloadIndex(MEMORY_TABLE_NAME, {
                field_name: PAYLOAD_FIELDS.projectId,
                field_schema: 'keyword',
            });
        }
        catch (err) {
            // Index may already exist — non-fatal
            const errMsg = err instanceof Error ? err.message : String(err);
            if (!errMsg.includes('already exists')) {
                logger.warn('Project ID payload index warning:', err);
            }
        }
    }
    /**
     * Add multiple memories in a single batch
     */
    async addMemories(entries) {
        const timestamp = Date.now();
        // Generate embeddings for all entries
        const texts = entries.map(e => e.text);
        const embeddingResults = await generateEmbeddings(texts);
        const points = entries.map((entry, idx) => {
            const contentHash = computeHash(entry.text);
            const id = randomUUID();
            return toPoint(id, embeddingResults[idx].embedding, entry, timestamp, contentHash, this.projectId);
        });
        await withRetry(() => this.client.upsert(MEMORY_TABLE_NAME, { points }), this.qdrantUrl);
        return points.map(p => pointToMemoryEntry({
            ...p,
            payload: p.payload,
        }));
    }
    /**
     * Add a single memory entry
     */
    async addMemory(input) {
        const id = randomUUID();
        const timestamp = Date.now();
        const contentHash = computeHash(input.text);
        let vector;
        try {
            vector = input.vector?.length
                ? Array.isArray(input.vector) ? input.vector : Array.from(input.vector)
                : (await generateEmbeddings([input.text]))[0].embedding;
        }
        catch (embErr) {
            console.error('[DEBUG] Embedding generation failed:', embErr);
            throw embErr;
        }
        console.error('[DEBUG] addMemory vector dim:', vector.length, 'projectId:', this.projectId);
        const point = toPoint(id, vector, input, timestamp, contentHash, this.projectId);
        try {
            await withRetry(() => this.client.upsert(MEMORY_TABLE_NAME, { points: [point] }), this.qdrantUrl);
        }
        catch (upsertErr) {
            console.error('[DEBUG] Qdrant upsert failed:', upsertErr);
            throw upsertErr;
        }
        return id;
    }
    /**
     * Get a memory entry by ID
     */
    async getMemory(id) {
        const results = await withRetry(() => this.client.retrieve(MEMORY_TABLE_NAME, {
            ids: [id],
            with_payload: true,
            with_vector: true,
        }), this.qdrantUrl);
        if (results.length === 0)
            return null;
        return pointToMemoryEntry(results[0]);
    }
    /**
     * Delete a memory entry by ID
     */
    async deleteMemory(id) {
        await withRetry(() => this.client.delete(MEMORY_TABLE_NAME, {
            points: [id],
        }), this.qdrantUrl);
    }
    /**
     * Delete all memories from a specific source path
     */
    async deleteBySourcePath(sourcePath, sourceType) {
        const must = [
            { key: PAYLOAD_FIELDS.sourcePath, match: { value: sourcePath } },
        ];
        if (sourceType) {
            must.push({
                key: PAYLOAD_FIELDS.sourceType,
                match: { value: sourceType },
            });
        }
        const projectFilter = this.getProjectFilter();
        if (projectFilter) {
            must.push(projectFilter);
        }
        const filter = { must };
        // Count before delete
        const countResult = await withRetry(() => this.client.count(MEMORY_TABLE_NAME, {
            filter,
            exact: true,
        }), this.qdrantUrl);
        await withRetry(() => this.client.delete(MEMORY_TABLE_NAME, { filter }), this.qdrantUrl);
        return countResult.count;
    }
    /**
     * Query memories by vector similarity
     */
    async queryMemories(vector, options = {}) {
        const opts = { ...DEFAULT_SEARCH_OPTIONS, ...options };
        const topK = Math.min(opts.topK ?? 5, 20);
        const queryVector = Array.isArray(vector) ? vector : Array.from(vector);
        // Build filter: project isolation + user filters
        const conditions = [];
        const projectFilter = this.getProjectFilter();
        if (projectFilter)
            conditions.push(projectFilter);
        if (opts.filter) {
            if (opts.filter.sourceType) {
                conditions.push({ key: PAYLOAD_FIELDS.sourceType, match: { value: opts.filter.sourceType } });
            }
            if (opts.filter.sessionId) {
                conditions.push({ key: PAYLOAD_FIELDS.sessionId, match: { value: opts.filter.sessionId } });
            }
            if (opts.filter.since) {
                conditions.push({ key: PAYLOAD_FIELDS.timestamp, range: { gte: opts.filter.since.getTime() } });
            }
            if (opts.filter.projectId) {
                conditions.push({ key: PAYLOAD_FIELDS.projectId, match: { value: opts.filter.projectId } });
            }
        }
        const filter = conditions.length === 0 ? undefined : { must: conditions };
        const results = await withRetry(() => this.client.search(MEMORY_TABLE_NAME, {
            vector: queryVector,
            limit: topK * 2,
            filter,
            with_payload: true,
            with_vector: false,
        }), this.qdrantUrl);
        // Deduplicate by contentHash and return topK
        const seen = new Set();
        const deduped = [];
        for (const result of results) {
            const entry = pointToMemoryEntry(result);
            if (typeof result.score === 'number') {
                entry.score = result.score;
            }
            if (!seen.has(entry.contentHash)) {
                seen.add(entry.contentHash);
                deduped.push(entry);
                if (deduped.length >= topK)
                    break;
            }
        }
        return deduped;
    }
    /**
     * List all memories with optional filter
     */
    async listMemories(filter) {
        // Build filter: project isolation + user filters
        const conditions = [];
        const projectFilter = this.getProjectFilter();
        if (projectFilter)
            conditions.push(projectFilter);
        if (filter) {
            if (filter.sourceType) {
                conditions.push({ key: PAYLOAD_FIELDS.sourceType, match: { value: filter.sourceType } });
            }
            if (filter.sessionId) {
                conditions.push({ key: PAYLOAD_FIELDS.sessionId, match: { value: filter.sessionId } });
            }
            if (filter.since) {
                conditions.push({ key: PAYLOAD_FIELDS.timestamp, range: { gte: filter.since.getTime() } });
            }
            if (filter.projectId) {
                conditions.push({ key: PAYLOAD_FIELDS.projectId, match: { value: filter.projectId } });
            }
        }
        const qdrantFilter = conditions.length === 0 ? undefined : { must: conditions };
        const results = await withRetry(() => this.client.scroll(MEMORY_TABLE_NAME, {
            filter: qdrantFilter,
            limit: 100,
            with_payload: true,
            with_vector: false,
        }), this.qdrantUrl);
        return results.points.map(p => pointToMemoryEntry(p));
    }
    /**
     * Get count of memories
     */
    async countMemories() {
        const projectFilter = this.getProjectFilter();
        const filter = projectFilter || undefined;
        const result = await withRetry(() => this.client.count(MEMORY_TABLE_NAME, { filter, exact: true }), this.qdrantUrl);
        return result.count;
    }
    /**
     * Check if content already exists (by hash)
     */
    async contentExists(hash) {
        const must = [
            { key: PAYLOAD_FIELDS.contentHash, match: { value: hash } },
        ];
        const projectFilter = this.getProjectFilter();
        if (projectFilter) {
            must.push(projectFilter);
        }
        const filter = { must };
        const result = await withRetry(() => this.client.count(MEMORY_TABLE_NAME, {
            filter,
            exact: true,
        }), this.qdrantUrl);
        return result.count > 0;
    }
    /**
     * Store model metadata in dedicated collection
     */
    async storeModelMetadata(modelId, dimensions) {
        // Ensure metadata collection exists
        const collections = await withRetry(() => this.client.getCollections(), this.qdrantUrl);
        const metaExists = collections.collections.some(c => c.name === QDRANT_METADATA_COLLECTION);
        if (!metaExists) {
            await withRetry(() => this.client.createCollection(QDRANT_METADATA_COLLECTION, {
                vectors: { size: 1, distance: 'Cosine' }, // Dummy vector for single-point collection
            }), this.qdrantUrl);
        }
        await withRetry(() => this.client.upsert(QDRANT_METADATA_COLLECTION, {
            points: [{
                    id: '00000000-0000-0000-0000-000000000000',
                    vector: [0],
                    payload: { modelId, dimensions, updatedAt: Date.now() },
                }],
        }), this.qdrantUrl);
    }
    /**
     * Retrieve stored model metadata
     */
    async getStoredModelMetadata() {
        try {
            const collections = await withRetry(() => this.client.getCollections(), this.qdrantUrl);
            const metaExists = collections.collections.some(c => c.name === QDRANT_METADATA_COLLECTION);
            if (!metaExists)
                return null;
            const result = await withRetry(() => this.client.retrieve(QDRANT_METADATA_COLLECTION, {
                ids: ['00000000-0000-0000-0000-000000000000'],
                with_payload: true,
            }), this.qdrantUrl);
            if (result.length === 0 || !result[0].payload)
                return null;
            return {
                modelId: result[0].payload.modelId,
                dimensions: result[0].payload.dimensions,
            };
        }
        catch {
            return null;
        }
    }
    /**
     * Validate that current model dimensions match stored metadata
     */
    async validateModelDimensions(currentDimensions) {
        const stored = await this.getStoredModelMetadata();
        if (stored && stored.dimensions !== currentDimensions) {
            const errorMsg = [
                `Model dimension mismatch detected!`,
                `  Stored dimensions: ${stored.dimensions}`,
                `  Current model dimensions: ${currentDimensions}`,
                ``,
                `To fix this, delete the Qdrant collection and restart:`,
                `  curl -X DELETE http://localhost:6333/collections/${MEMORY_TABLE_NAME}`,
                ``,
                `Or specify a different collection via environment variable.`,
            ].join('\n');
            throw new Error(errorMsg);
        }
    }
    /**
     * Get all entries from a specific source path with optional sourceType filter.
     * Uses scroll API with pagination for large result sets.
     */
    async getEntriesBySourcePath(sourcePath, sourceType) {
        const must = [
            { key: PAYLOAD_FIELDS.sourcePath, match: { value: sourcePath } },
        ];
        if (sourceType) {
            must.push({
                key: PAYLOAD_FIELDS.sourceType,
                match: { value: sourceType },
            });
        }
        const projectFilter = this.getProjectFilter();
        if (projectFilter) {
            must.push(projectFilter);
        }
        const filter = { must };
        const entries = [];
        let scrollId;
        // Paginate through all results
        do {
            const result = await withRetry(() => this.client.scroll(MEMORY_TABLE_NAME, {
                filter,
                limit: 100,
                offset: scrollId,
                with_payload: true,
                with_vector: false,
            }), this.qdrantUrl);
            entries.push(...result.points.map(p => pointToMemoryEntry(p)));
            scrollId = typeof result.next_page_offset === 'string' ? result.next_page_offset : undefined;
        } while (scrollId);
        return entries;
    }
    /**
     * Close the database connection and clean up client cache
     */
    async close() {
        removeClient(this.qdrantUrl);
        this.initialized = false;
        this.connected = false;
    }
}
// --- Singletons ---
const databaseInstances = new Map();
/**
 * Get a database instance for the given URL and projectId
 */
export function getDatabase(url, projectId) {
    const key = url || DEFAULT_QDRANT_URL;
    if (!databaseInstances.has(key)) {
        const effectiveProjectId = projectId ?? getConfig().database.projectId;
        databaseInstances.set(key, new MemoryDatabase(key, effectiveProjectId));
    }
    return databaseInstances.get(key);
}
/**
 * Initialize the default database
 */
export async function initializeDatabase(url) {
    const db = getDatabase(url);
    await db.initialize();
}
