# Snapshot-Based File Indexing Design

## Problem Statement

Current pain points in `super-memory-ts`:
1. **Every startup re-hashes all files with SHA-256** — slow and CPU-intensive
2. **No resume capability** — crash mid-indexing restarts from zero
3. **Re-embeds unchanged files** — redundant embedding work
4. **Watcher emits 'add' for ALL files on startup** — triggering full processing pipeline for every file

## Solution Overview

Introduce a **snapshot-based delta indexing system**:
- **xxhash** (via `xxhash-wasm`) for 10× faster file fingerprinting
- **JSON snapshot** stored alongside the database
- **Fast scan phase** on startup: walk directory, stat() for mtime+size shortcut, xxhash only when needed
- **Delta computation**: only new/changed files enter the embedding pipeline
- **Deleted files** automatically removed from the database
- **Crash recovery**: resume from last saved snapshot

---

## 1. Snapshot Data Structure & Storage

### Location
```
.opencode/super-memory-ts/snapshot.json
```

### Format
```json
{
  "version": 1,
  "createdAt": "2025-04-24T10:00:00.000Z",
  "files": {
    "src/index.ts": {
      "xxhash": "a3f7b2d8e1c9045f",
      "fileSize": 2048,
      "mtimeMs": 1713952800000,
      "lastIndexed": "2025-04-24T10:00:00.000Z",
      "chunkCount": 5
    }
  }
}
```

### Why JSON?
- **Fast load**: `JSON.parse()` is orders of magnitude faster than SQLite queries for bulk reads
- **Human-readable**: easy to debug, inspect, version control if needed
- **Atomic writes**: write to `.tmp` file, then `fs.rename()` for crash safety
- **Compact**: only stores metadata, not content

---

## 2. xxhash Library Choice

### Choice: `xxhash-wasm`

```bash
npm install xxhash-wasm
```

**Why not `xxhashjs`?**
| Factor | xxhash-wasm | xxhashjs |
|--------|-------------|----------|
| Implementation | WASM (native speed) | Pure JavaScript |
| Performance | ~10× faster | Slow |
| 64-bit support | Yes (h64) | Limited |
| Streaming | Yes | No |
| Bundle size | ~20KB WASM | ~15KB JS |

**Usage pattern:**
```typescript
import xxhash from 'xxhash-wasm';

const { h64 } = await xxhash();
const hash = h64(fileBuffer).toString(16); // hex string
```

---

## 3. Fast Hash Scan Algorithm

### Phase 1: Directory Walk
```typescript
async function scanDirectory(
  rootPath: string,
  includePatterns: string[],
  excludePatterns: string[]
): Promise<Map<string, SnapshotEntry>> {
  const results = new Map<string, SnapshotEntry>();
  
  // Use Node.js 20+ recursive readdir for speed
  const entries = await readdir(rootPath, { recursive: true, withFileTypes: true });
  
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    
    const filePath = join(entry.parentPath || rootPath, entry.name);
    
    // Skip excluded patterns (reuse existing glob matching)
    if (isExcluded(filePath, excludePatterns)) continue;
    if (!isIncluded(filePath, includePatterns)) continue;
    
    // Get file stats
    const stats = await stat(filePath);
    
    // Skip oversized files
    if (stats.size > maxFileSize) continue;
    
    results.set(filePath, await getSnapshotEntry(filePath, stats));
  }
  
  return results;
}
```

### Phase 2: Smart Hashing with mtime+size Shortcut
```typescript
async function getSnapshotEntry(
  filePath: string, 
  stats: Stats,
  snapshotEntry?: SnapshotEntry
): Promise<SnapshotEntry> {
  // FAST PATH: if mtime and size match snapshot, reuse hash
  if (snapshotEntry && 
      snapshotEntry.fileSize === stats.size && 
      snapshotEntry.mtimeMs === stats.mtimeMs) {
    return {
      ...snapshotEntry,
      // mtimeMs and fileSize unchanged, hash is still valid
    };
  }
  
  // SLOW PATH: read file and compute xxhash
  const content = await readFile(filePath);
  const hash = h64(content).toString(16);
  
  return {
    xxhash: hash,
    fileSize: stats.size,
    mtimeMs: stats.mtimeMs,
    lastIndexed: new Date().toISOString(),
    chunkCount: 0, // filled after processing
  };
}
```

**Performance impact:**
- For 1,000 unchanged files: ~200ms (just `stat()` calls)
- For 1,000 files with 10 changed: ~500ms
- Current SHA-256 approach: ~15-30 seconds

---

## 4. Delta Calculation

```typescript
interface Delta {
  added: string[];      // In filesystem, not in snapshot
  modified: string[];   // In both, hash differs
  deleted: string[];    // In snapshot, not on disk
  unchanged: string[];  // In both, hash matches
}

function computeDelta(
  currentFiles: Map<string, SnapshotEntry>,
  snapshot: Snapshot
): Delta {
  const added: string[] = [];
  const modified: string[] = [];
  const unchanged: string[] = [];
  
  for (const [path, entry] of currentFiles) {
    const snap = snapshot.files[path];
    if (!snap) {
      added.push(path);
    } else if (snap.xxhash !== entry.xxhash) {
      modified.push(path);
    } else {
      unchanged.push(path);
    }
  }
  
  const deleted = Object.keys(snapshot.files).filter(p => !currentFiles.has(p));
  
  return { added, modified, deleted, unchanged };
}
```

---

## 5. Integration with Existing Indexer

### Modified Startup Flow

```
┌─────────────────┐
│   Indexer.start  │
└────────┬────────┘
         │
         ▼
┌─────────────────┐     ┌─────────────────┐
│  Load Snapshot   │────▶│  snapshot.json  │
└────────┬────────┘     └─────────────────┘
         │
         ▼
┌─────────────────┐
│  Fast Scan Walk  │◀─── stat() + xxhash (if needed)
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  Compute Delta   │
└────────┬────────┘
         │
    ┌────┴────┐
    ▼         ▼         ▼
┌───────┐ ┌───────┐ ┌─────────┐
│ Added │ │Changed│ │ Deleted │
└───┬───┘ └───┬───┘ └────┬────┘
    │         │          │
    ▼         ▼          ▼
┌─────────────────────────────────────┐
│  Process through normal pipeline     │
│  (chunk → embed → store → tracker)   │
└─────────────────────────────────────┘
         │
         ▼
┌─────────────────┐
│  Save Snapshot   │◀─── atomic write
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  Start Watcher   │◀─── ignoreInitial: true
│  (runtime only)  │
└─────────────────┘
```

### Key Changes to `indexer.ts`

**In `start()` method:**
```typescript
async start(): Promise<void> {
  // ... existing setup ...
  
  // ========== FAST SNAPSHOT SCAN ==========
  logger.info('Starting fast snapshot scan...');
  
  const snapshotPath = resolve(dbUri || './memory_data', '../snapshot.json');
  const snapshotIndex = new SnapshotIndex(snapshotPath);
  await snapshotIndex.init(); // load xxhash-wasm
  await snapshotIndex.load();
  
  // Fast directory walk with smart hashing
  const currentFiles = await snapshotIndex.scanDirectory(
    this.config.rootPath,
    this.config.includePatterns,
    this.config.excludePatterns
  );
  
  // Compute delta
  const delta = snapshotIndex.computeDelta(currentFiles);
  
  logger.info(
    `Scan complete: ${delta.added.length} new, ` +
    `${delta.modified.length} changed, ` +
    `${delta.deleted.length} deleted, ` +
    `${delta.unchanged.length} unchanged`
  );
  
  // Process deletions
  for (const path of delta.deleted) {
    await this.removeFile(path);
    snapshotIndex.removeEntry(path);
  }
  
  // Process additions and modifications
  const filesToProcess = [...delta.added, ...delta.modified];
  for (const filePath of filesToProcess) {
    const entry = currentFiles.get(filePath)!;
    await this.processFile(filePath, entry.xxhash); // pass precomputed hash
    
    // Update snapshot after successful processing
    entry.lastIndexed = new Date().toISOString();
    entry.chunkCount = this.fileTracker.getFile(filePath)?.chunkCount || 0;
    snapshotIndex.updateEntry(filePath, entry);
  }
  
  // Save snapshot atomically
  await snapshotIndex.save();
  
  // ========== START WATCHER (RUNTIME ONLY) ==========
  this.watcher = createWatcher({
    paths: [this.config.rootPath],
    includePatterns: this.config.includePatterns,
    excludePatterns: this.config.excludePatterns,
    ignoreInitial: true, // CRITICAL: don't re-process existing files
    debounceMs: 500,
  });
  
  // ... existing watcher event handlers ...
}
```

**In `processFile()` method:**
```typescript
async processFile(filePath: string, precomputedHash?: string): Promise<void> {
  // ... existing file size checks ...
  
  const content = await readFile(filePath, 'utf-8');
  
  // Use precomputed hash if available, otherwise compute
  const hash = precomputedHash ?? this.computeHash(content);
  
  // Check FileTracker (now stores xxhash)
  const existing = this.fileTracker.getFile(filePath);
  if (existing?.hash === hash) {
    logger.debug(`File unchanged, skipping: ${filePath}`);
    return;
  }
  
  // ... rest of processing unchanged ...
}
```

---

## 6. Crash Recovery Logic

### Atomic Snapshot Writes
```typescript
async save(): Promise<void> {
  const tmpPath = `${this.snapshotPath}.tmp.${Date.now()}`;
  await writeFile(tmpPath, JSON.stringify(this.snapshot, null, 2));
  await rename(tmpPath, this.snapshotPath); // atomic on POSIX
}
```

### Recovery Flow
```
Crash occurs during processing
         │
         ▼
┌─────────────────┐
│  Restart server  │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  Load snapshot   │◀─── reflects last atomic save
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  Fast scan       │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  Delta shows     │
│  already-done    │◀─── files as "unchanged"
│  files           │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  Only process    │
│  files that were │
│  mid-flight      │
└─────────────────┘
```

### Batch-Based Safety
For extra safety, save snapshot after processing batches:
```typescript
const BATCH_SIZE = 50;
for (let i = 0; i < filesToProcess.length; i += BATCH_SIZE) {
  const batch = filesToProcess.slice(i, i + BATCH_SIZE);
  
  for (const filePath of batch) {
    await this.processFile(filePath, currentFiles.get(filePath)!.xxhash);
  }
  
  // Flush buffer to DB
  await this.flush();
  
  // Update and save snapshot
  for (const filePath of batch) {
    snapshotIndex.updateEntry(filePath, currentFiles.get(filePath)!);
  }
  await snapshotIndex.save();
}
```

**Worst-case loss:** At most `BATCH_SIZE` files need re-processing after crash.

---

## 7. File Modifications Summary

### New File: `src/project-index/snapshot.ts`
```typescript
import { readFile, writeFile, stat, readdir, rename } from 'fs/promises';
import { resolve, join } from 'path';
import xxhash from 'xxhash-wasm';
import { logger } from '../utils/logger.js';

export interface SnapshotEntry {
  xxhash: string;
  fileSize: number;
  mtimeMs: number;
  lastIndexed: string;
  chunkCount: number;
}

export interface Snapshot {
  version: number;
  createdAt: string;
  files: Record<string, SnapshotEntry>;
}

export interface Delta {
  added: string[];
  modified: string[];
  deleted: string[];
  unchanged: string[];
}

export class SnapshotIndex {
  private snapshotPath: string;
  private snapshot: Snapshot;
  private h64: ((input: Buffer) => bigint) | null = null;
  private maxFileSize: number;

  constructor(snapshotPath: string, maxFileSize: number = 10 * 1024 * 1024) {
    this.snapshotPath = snapshotPath;
    this.maxFileSize = maxFileSize;
    this.snapshot = {
      version: 1,
      createdAt: new Date().toISOString(),
      files: {},
    };
  }

  async init(): Promise<void> {
    const xxh = await xxhash();
    this.h64 = xxh.h64;
  }

  async load(): Promise<void> {
    try {
      const content = await readFile(this.snapshotPath, 'utf-8');
      this.snapshot = JSON.parse(content);
      logger.debug(`Loaded snapshot with ${Object.keys(this.snapshot.files).length} files`);
    } catch {
      logger.info('No existing snapshot found, starting fresh');
      this.snapshot = {
        version: 1,
        createdAt: new Date().toISOString(),
        files: {},
      };
    }
  }

  async save(): Promise<void> {
    const tmpPath = `${this.snapshotPath}.tmp.${Date.now()}`;
    await writeFile(tmpPath, JSON.stringify(this.snapshot, null, 2));
    await rename(tmpPath, this.snapshotPath);
    logger.debug(`Saved snapshot with ${Object.keys(this.snapshot.files).length} files`);
  }

  async scanDirectory(
    rootPath: string,
    includePatterns: string[],
    excludePatterns: string[]
  ): Promise<Map<string, SnapshotEntry>> {
    const results = new Map<string, SnapshotEntry>();
    
    const entries = await readdir(rootPath, { recursive: true, withFileTypes: true });
    
    for (const entry of entries) {
      if (!entry.isFile()) continue;
      
      const filePath = join(entry.parentPath || rootPath, entry.name);
      
      if (this.shouldSkip(filePath, excludePatterns)) continue;
      
      try {
        const stats = await stat(filePath);
        if (stats.size > this.maxFileSize) continue;
        
        const snapshotEntry = this.snapshot.files[filePath];
        const entry = await this.getSnapshotEntry(filePath, stats, snapshotEntry);
        results.set(filePath, entry);
      } catch (err) {
        logger.warn(`Failed to scan file: ${filePath}`, err);
      }
    }
    
    return results;
  }

  private async getSnapshotEntry(
    filePath: string,
    stats: { size: number; mtimeMs: number },
    snapshotEntry?: SnapshotEntry
  ): Promise<SnapshotEntry> {
    // Fast path: mtime + size unchanged
    if (snapshotEntry &&
        snapshotEntry.fileSize === stats.size &&
        snapshotEntry.mtimeMs === stats.mtimeMs) {
      return snapshotEntry;
    }
    
    // Slow path: compute xxhash
    const content = await readFile(filePath);
    const hash = this.h64!(content).toString(16);
    
    return {
      xxhash: hash,
      fileSize: stats.size,
      mtimeMs: stats.mtimeMs,
      lastIndexed: new Date().toISOString(),
      chunkCount: snapshotEntry?.chunkCount ?? 0,
    };
  }

  computeDelta(currentFiles: Map<string, SnapshotEntry>): Delta {
    const added: string[] = [];
    const modified: string[] = [];
    const unchanged: string[] = [];
    
    for (const [path, entry] of currentFiles) {
      const snap = this.snapshot.files[path];
      if (!snap) {
        added.push(path);
      } else if (snap.xxhash !== entry.xxhash) {
        modified.push(path);
      } else {
        unchanged.push(path);
      }
    }
    
    const deleted = Object.keys(this.snapshot.files).filter(p => !currentFiles.has(p));
    
    return { added, modified, deleted, unchanged };
  }

  updateEntry(path: string, entry: SnapshotEntry): void {
    this.snapshot.files[path] = entry;
  }

  removeEntry(path: string): void {
    delete this.snapshot.files[path];
  }

  private shouldSkip(filePath: string, excludePatterns: string[]): boolean {
    // Reuse existing skip logic
    const SKIP_EXTENSIONS = new Set(['.db', '.har', '.db-journal', '.db-wal', '.sqlite', '.sqlite3']);
    const SKIP_DIRS = new Set(['lancedb', 'node_modules', '.git', 'dist', 'build', '.cache', '__pycache__']);
    
    const ext = filePath.slice(filePath.lastIndexOf('.')).toLowerCase();
    if (SKIP_EXTENSIONS.has(ext)) return true;
    if (filePath.split('/').some(p => SKIP_DIRS.has(p))) return true;
    
    // Check exclude patterns
    for (const pattern of excludePatterns) {
      if (this.matchGlob(pattern, filePath)) return true;
    }
    
    return false;
  }

  private matchGlob(pattern: string, path: string): boolean {
    // Simple glob matching (can be extracted to shared utility)
    const normalizedPath = path.replace(/\\/g, '/');
    const normalizedPattern = pattern.replace(/\\/g, '/');
    let regexPattern = normalizedPattern
      .replace(/\./g, '\\.')
      .replace(/\*\*/g, '{{GLOB_STAR_STAR}}')
      .replace(/\*/g, '[^/]*');
    regexPattern = regexPattern.replace(/{{GLOB_STAR_STAR}}/g, '.*');
    const regex = new RegExp(`.*${regexPattern}$`);
    return regex.test(normalizedPath);
  }
}
```

### Modified: `src/utils/hash.ts`
Add xxhash functions:
```typescript
import xxhash from 'xxhash-wasm';

let h64Instance: ((input: Buffer) => bigint) | null = null;

export async function initXxhash(): Promise<void> {
  const xxh = await xxhash();
  h64Instance = xxh.h64;
}

export function xxhashContent(content: Buffer | string): string {
  if (!h64Instance) throw new Error('xxhash not initialized');
  const buffer = Buffer.isBuffer(content) ? content : Buffer.from(content, 'utf-8');
  return h64Instance(buffer).toString(16);
}

export async function xxhashFile(filePath: string): Promise<string> {
  const content = await readFile(filePath);
  return xxhashContent(content);
}
```

### Modified: `src/project-index/file-tracker.ts`
Change hash field to store xxhash (conceptually same, just faster algorithm):
```typescript
// No schema change needed - the 'content_hash' column stores xxhash hex string
// Just update documentation/comments
```

### Modified: `src/project-index/watcher.ts`
Add `ignoreInitial` to config:
```typescript
export interface WatcherConfig {
  paths: string[];
  includePatterns: string[];
  excludePatterns: string[];
  debounceMs: number;
  ignoreHidden?: boolean;
  ignoreInitial?: boolean; // NEW
}
```
And pass to chokidar:
```typescript
this.watcher = chokidar.watch(watchTargets, {
  // ... other options ...
  ignoreInitial: this.config.ignoreInitial ?? false,
});
```

### Modified: `package.json`
```json
{
  "dependencies": {
    "xxhash-wasm": "^1.1.0"
  }
}
```

---

## 8. Performance Expectations

| Scenario | Files | Current (SHA-256) | New (xxhash + snapshot) |
|----------|-------|-------------------|------------------------|
| Fresh start | 1,000 | 15-30s | 3-5s |
| Startup (no changes) | 1,000 | 15-30s | **200-500ms** |
| Startup (10 files changed) | 1,000 | 15-30s | **500ms-1s** |
| Startup (100 files changed) | 1,000 | 15-30s | 2-3s |
| Crash recovery (mid-batch) | 1,000 | 15-30s | 1-2s |

**Key win:** The 99% case (no changes) drops from 15-30 seconds to **under 500 milliseconds**.

---

## 9. Edge Cases & Handling

| Scenario | Handling |
|----------|----------|
| Missing snapshot | Treat as empty, full scan + hash |
| Corrupt snapshot JSON | Log warning, treat as empty |
| File deleted during scan | `stat()`/`readFile()` fails, skip with warning |
| File modified between hash and process | FileTracker hash check catches it, re-processes |
| Snapshot save fails (disk full) | Log error, continue; next startup recovers |
| Watcher race condition | Watcher handles runtime changes; snapshot handles startup |
| Symlinks | `followSymlinks: false` (already configured) |
| Empty file | xxhash handles empty buffers correctly |
| Binary files | Already skipped by extension filter |

---

## 10. Rollback Plan

If issues arise:
1. Delete `.opencode/super-memory-ts/snapshot.json` → falls back to full scan behavior
2. Revert `indexer.ts` changes → uses watcher-only approach
3. Keep `xxhash-wasm` dependency (small, harmless)

The snapshot is purely an optimization layer — removing it doesn't break functionality.
