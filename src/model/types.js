/**
 * Model Layer Types for Super-Memory-TS
 * Defines types for embedding model management and inference
 */
/** BGE-Large model identifier */
export const BGE_LARGE_MODEL_ID = 'Xenova/bge-large-en-v1.5';
/** MiniLM (CPU fallback) model identifier */
export const MINI_LM_MODEL_ID = 'Xenova/all-MiniLM-L6-v2';
/** BGE-Large embedding dimensions */
export const BGE_LARGE_DIMENSIONS = 1024;
/** MiniLM embedding dimensions */
export const MINI_LM_DIMENSIONS = 384;
/** Environment variable names */
export const ENV_PRECISION = 'BOOMERANG_PRECISION';
export const ENV_DEVICE = 'BOOMERANG_DEVICE';
export const ENV_USE_GPU = 'BOOMERANG_USE_GPU';
