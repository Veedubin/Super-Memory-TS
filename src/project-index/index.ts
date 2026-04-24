/**
 * Project Index Module
 * 
 * Comprehensive file indexing system for project navigation and semantic search.
 * Features:
 * - File watching with chokidar
 * - Intelligent chunking (semantic for code, sliding window for text)
 * - Incremental updates with SHA-256 hashing
 * - Background indexing on startup
 * - HNSW index for fast search
 */

// ==================== Types ====================
export type {
  ProjectChunk,
  ProjectIndexConfig,
  FileEvent,
  FileEventType,
  ChunkOptions,
  Chunk,
  IndexedFile,
  FileHash,
  ProjectSearchOptions,
  ProjectSearchFilters,
  ProjectSearchResult,
  WatcherConfig,
  ProjectIndexerStats,
  IndexerEvents,
} from './types.js';

// ==================== Core Classes ====================
export { FileChunker } from './chunker.js';
export { ProjectWatcher } from './watcher.js';
export { ProjectIndexer } from './indexer.js';

// ==================== Factory Functions ====================
export { createChunker } from './chunker.js';
export { createWatcher } from './watcher.js';
export { createIndexer } from './indexer.js';