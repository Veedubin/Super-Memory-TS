/**
 * Memory Storage Layer
 *
 * Complete memory system with LanceDB storage and HNSW indexing,
 * supporting TIERED, VECTOR_ONLY, and TEXT_ONLY search strategies.
 */

// Schema and types
export {
  MEMORY_TABLE_NAME,
  HNSW_CONFIG,
  DEFAULT_SEARCH_OPTIONS,
  type MemoryEntry,
  type MemoryEntryInput,
  type MemorySourceType,
  type SearchOptions,
  type SearchFilter,
  type SearchStrategy,
  type ContentHash,
} from './schema.js';

// Database layer
export {
  MemoryDatabase,
  getDatabase,
  initializeDatabase,
} from './database.js';

// Search layer
export {
  MemorySearch,
  getSearch,
  initializeSearch,
} from './search.js';

// Import for local use (in MemorySystem class)
import { MemoryDatabase } from './database.js';
import { MemorySearch } from './search.js';
import type { MemoryEntry, MemoryEntryInput, SearchOptions } from './schema.js';

/**
 * MemorySystem - High-level memory interface
 *
 * Combines database and search operations into a single interface.
 */
export class MemorySystem {
  private db: MemoryDatabase;
  private search: MemorySearch;

  constructor(db?: MemoryDatabase, search?: MemorySearch) {
    this.db = db ?? new MemoryDatabase();
    this.search = search ?? new MemorySearch(this.db);
  }

  /**
   * Initialize the memory system
   * Must be called before any memory operations
   */
  async initialize(dbUri?: string): Promise<void> {
    // Always reinitialize to ensure we have a fresh database connection
    // This handles the case where MemorySystem was created before initialization
    if (dbUri) {
      // Create new database instance with the specific URI
      this.db = new MemoryDatabase(dbUri);
    }
    await this.db.initialize();

    // Create new search with the database instance
    this.search = new MemorySearch(this.db);
    await this.search.refreshIndex();
  }

  /**
   * Add a memory entry
   */
  async addMemory(input: MemoryEntryInput): Promise<string> {
    const id = await this.db.addMemory(input);
    await this.search.refreshIndex();
    return id;
  }

  /**
   * Get a memory by ID
   */
  async getMemory(id: string): Promise<MemoryEntry | null> {
    return this.db.getMemory(id);
  }

  /**
   * Delete a memory entry
   */
  async deleteMemory(id: string): Promise<void> {
    await this.db.deleteMemory(id);
    await this.search.refreshIndex();
  }

  /**
   * Query memories using search strategies
   */
  async queryMemories(
    question: string,
    options?: SearchOptions
  ): Promise<MemoryEntry[]> {
    return this.search.query(question, options);
  }

  /**
   * Search with a pre-computed vector
   */
  async searchWithVector(
    vector: Float32Array,
    options?: SearchOptions
  ): Promise<MemoryEntry[]> {
    return this.search.searchWithVector(vector, options);
  }

  /**
   * Get memories similar to a given memory
   */
  async getSimilar(
    memoryId: string,
    options?: SearchOptions
  ): Promise<MemoryEntry[]> {
    return this.search.getSimilar(memoryId, options);
  }

  /**
   * List memories with optional filter
   */
  async listMemories(filter?: SearchOptions['filter']): Promise<MemoryEntry[]> {
    return this.db.listMemories(filter);
  }

  /**
   * Get memory statistics
   */
  async getStats(): Promise<{ count: number }> {
    const count = await this.db.countMemories();
    return { count };
  }

  /**
   * Check if content already exists
   */
  async contentExists(text: string): Promise<boolean> {
    const encoder = new TextEncoder();
    const data = encoder.encode(text);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const hash = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');

    return this.db.contentExists(hash);
  }
}

/**
 * Create a new MemorySystem instance
 */
export function createMemorySystem(): MemorySystem {
  return new MemorySystem();
}

/**
 * Default memory system instance
 */
let defaultMemorySystem: MemorySystem | null = null;

/**
 * Get the default memory system instance
 */
export function getMemorySystem(): MemorySystem {
  if (!defaultMemorySystem) {
    defaultMemorySystem = new MemorySystem();
  }
  return defaultMemorySystem;
}
