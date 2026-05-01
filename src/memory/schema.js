/**
 * Memory Schema Definitions
 *
 * Defines the core data structures for the memory storage layer.
 */
/**
 * Qdrant collection name for memory points
 */
export const MEMORY_TABLE_NAME = 'memories';
/**
 * Qdrant collection name for model metadata (single-point config store)
 */
export const QDRANT_METADATA_COLLECTION = 'model_metadata';
/**
 * Default Qdrant server URL
 * Override with QDRANT_URL environment variable
 */
export const DEFAULT_QDRANT_URL = process.env.QDRANT_URL || 'http://localhost:6333';
/**
 * HNSW configuration for Qdrant collection creation
 * Maps to Qdrant's HnswConfigDiff
 */
export const QDRANT_HNSW_CONFIG = {
    m: 16,
    ef_construct: 128,
    full_scan_threshold: 10000,
};
/**
 * Payload field names used for indexing and filtering
 */
export const PAYLOAD_FIELDS = {
    text: 'text',
    content: 'content',
    sourceType: 'sourceType',
    sourcePath: 'sourcePath',
    timestamp: 'timestamp',
    contentHash: 'contentHash',
    metadataJson: 'metadataJson',
    sessionId: 'sessionId',
    projectId: 'projectId',
};
/**
 * Default search options
 */
export const DEFAULT_SEARCH_OPTIONS = {
    topK: 5,
    strategy: 'TIERED',
    threshold: 0.72,
    filter: {},
};
