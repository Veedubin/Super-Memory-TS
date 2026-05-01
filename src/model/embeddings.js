/**
 * Model Layer - Embedding Generation
 * Handles embedding creation with batching support
 */
import { ModelManager } from './index.js';
/**
 * Default batch size for embedding generation
 */
const DEFAULT_BATCH_SIZE = 8;
/**
 * Generate a single embedding for text
 */
export async function generateEmbedding(text) {
    const startTime = Date.now();
    const manager = ModelManager.getInstance();
    // Ensure model is loaded
    if (!manager.getMetadata().isLoaded) {
        await manager.acquire();
    }
    const extractor = manager.getExtractor();
    const metadata = manager.getMetadata();
    try {
        // Run feature extraction
        const output = await extractor(text, {
            pooling: 'mean',
            normalize: true,
        });
        // Extract embedding (token count estimated from text length / 4)
        const embedding = Array.from(output.data);
        const tokenCount = Math.ceil(text.length / 4);
        const latencyMs = Date.now() - startTime;
        return {
            embedding,
            tokenCount,
            modelId: metadata.modelId,
            device: metadata.device,
            timestamp: Date.now(),
            latencyMs,
        };
    }
    catch (error) {
        throw new Error(`Failed to generate embedding: ${error instanceof Error ? error.message : String(error)}`);
    }
}
/**
 * Generate embeddings for multiple texts with batch processing
 */
export async function generateEmbeddings(texts, batchSize = DEFAULT_BATCH_SIZE) {
    if (texts.length === 0) {
        return [];
    }
    const manager = ModelManager.getInstance();
    // Ensure model is loaded
    if (!manager.getMetadata().isLoaded) {
        await manager.acquire();
    }
    const results = [];
    // Process in batches for memory efficiency
    for (let i = 0; i < texts.length; i += batchSize) {
        const batch = texts.slice(i, i + batchSize);
        const batchResults = await processBatch(batch, manager);
        results.push(...batchResults);
    }
    return results;
}
/**
 * Process a batch of texts
 */
async function processBatch(texts, manager) {
    const extractor = manager.getExtractor();
    const metadata = manager.getMetadata();
    const startTime = Date.now();
    try {
        // Run batch feature extraction
        const outputs = await Promise.all(texts.map((text) => extractor(text, {
            pooling: 'mean',
            normalize: true,
        })));
        const results = outputs.map((output, index) => ({
            embedding: Array.from(output.data),
            tokenCount: Math.ceil(texts[index].length / 4),
            modelId: metadata.modelId,
            device: metadata.device,
            timestamp: Date.now(),
            latencyMs: Date.now() - startTime,
        }));
        return results;
    }
    catch (error) {
        throw new Error(`Failed to generate batch embeddings: ${error instanceof Error ? error.message : String(error)}`);
    }
}
/**
 * Generate batch embedding result (single result with multiple vectors)
 */
export async function generateEmbeddingBatch(texts, batchSize = DEFAULT_BATCH_SIZE) {
    const startTime = Date.now();
    if (texts.length === 0) {
        return {
            embeddings: [],
            tokenCounts: [],
            modelId: '',
            device: 'auto',
            timestamp: Date.now(),
            latencyMs: 0,
        };
    }
    const manager = ModelManager.getInstance();
    // Ensure model is loaded
    if (!manager.getMetadata().isLoaded) {
        await manager.acquire();
    }
    const metadata = manager.getMetadata();
    const allEmbeddings = [];
    const allTokenCounts = [];
    // Process in batches
    for (let i = 0; i < texts.length; i += batchSize) {
        const batch = texts.slice(i, i + batchSize);
        const batchResults = await processBatch(batch, manager);
        for (const result of batchResults) {
            allEmbeddings.push(result.embedding);
            allTokenCounts.push(result.tokenCount);
        }
    }
    return {
        embeddings: allEmbeddings,
        tokenCounts: allTokenCounts,
        modelId: metadata.modelId,
        device: metadata.device,
        timestamp: Date.now(),
        latencyMs: Date.now() - startTime,
    };
}
/**
 * Get current model dimensions without loading
 */
export function getEmbeddingDimensions() {
    const manager = ModelManager.getInstance();
    return manager.getDimensions();
}
/**
 * Check if model is ready for inference
 */
export function isModelReady() {
    const manager = ModelManager.getInstance();
    return manager.getMetadata().isLoaded;
}
/**
 * Preload model (call before actual use for better latency)
 */
export async function preloadModel() {
    const manager = ModelManager.getInstance();
    await manager.acquire();
}
/**
 * Release model when done (for manual lifecycle management)
 */
export async function releaseModel() {
    const manager = ModelManager.getInstance();
    await manager.release();
}
/**
 * Get model metadata for diagnostics
 */
export function getModelMetadata() {
    const manager = ModelManager.getInstance();
    return manager.getMetadata();
}
export default {
    generateEmbedding,
    generateEmbeddings,
    generateEmbeddingBatch,
    getEmbeddingDimensions,
    isModelReady,
    preloadModel,
    releaseModel,
    getModelMetadata,
};
