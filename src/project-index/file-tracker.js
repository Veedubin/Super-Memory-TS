import Database from 'better-sqlite3';
import { dirname } from 'path';
import { existsSync, mkdirSync } from 'fs';
/**
 * SQLite-based persistent file tracker to avoid re-indexing unchanged files.
 */
export class FileTracker {
    db;
    constructor(dbPath) {
        const dir = dirname(dbPath);
        if (!existsSync(dir))
            mkdirSync(dir, { recursive: true });
        this.db = new Database(dbPath);
        this.initTable();
    }
    initTable() {
        this.db.exec(`
      CREATE TABLE IF NOT EXISTS indexed_files (
        file_path TEXT PRIMARY KEY,
        content_hash TEXT NOT NULL,
        last_indexed TEXT NOT NULL,
        chunk_count INTEGER NOT NULL DEFAULT 0
      )
    `);
    }
    getFile(filePath) {
        const row = this.db.prepare('SELECT * FROM indexed_files WHERE file_path = ?').get(filePath);
        if (!row)
            return undefined;
        return {
            hash: row.content_hash,
            lastIndexed: row.last_indexed,
            chunkCount: row.chunk_count,
        };
    }
    setFile(filePath, hash, chunkCount) {
        this.db.prepare(`
      INSERT OR REPLACE INTO indexed_files (file_path, content_hash, last_indexed, chunk_count)
      VALUES (?, ?, ?, ?)
    `).run(filePath, hash, new Date().toISOString(), chunkCount);
    }
    removeFile(filePath) {
        this.db.prepare('DELETE FROM indexed_files WHERE file_path = ?').run(filePath);
    }
    getAllFiles() {
        const rows = this.db.prepare('SELECT * FROM indexed_files').all();
        const map = new Map();
        for (const row of rows) {
            map.set(row.file_path, {
                hash: row.content_hash,
                lastIndexed: row.last_indexed,
                chunkCount: row.chunk_count,
            });
        }
        return map;
    }
    close() {
        this.db.close();
    }
}
