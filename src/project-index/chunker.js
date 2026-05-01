/**
 * File chunking for project indexing
 *
 * Supports multiple chunking strategies:
 * - semantic: Uses code structure (functions, classes) for intelligent splitting
 * - sliding: Window-based chunking with overlap as fallback
 * - lines: Simple line-based chunking
 */
import { logger } from '../utils/logger.js';
// ==================== Constants ====================
const DEFAULT_CHUNK_OPTIONS = {
    maxChunkSize: 512,
    overlap: 50,
    minChunkSize: 50,
    splitBy: 'semantic',
};
// Code file extensions
const CODE_EXTENSIONS = new Set([
    '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs',
    '.py', '.pyw',
    '.java', '.kt', '.kts',
    '.cs', '.fs',
    '.cpp', '.cc', '.cxx', '.h', '.hpp',
    '.go', '.rs',
    '.rb', '.erb',
    '.php',
    '.swift',
    '.vue', '.svelte',
    '.sql',
    '.sh', '.bash', '.zsh',
    '.yaml', '.yml',
    '.json', '.jsonc',
    '.xml', '.html', '.css', '.scss', '.sass', '.less',
]);
// Large file threshold (1MB) - JSON files larger than this are risky
const LARGE_FILE_THRESHOLD = 1024 * 1024;
// Boundary patterns for code files
const BOUNDARY_PATTERNS = [
    // TypeScript/JavaScript
    { pattern: /^export\s+(function|class|interface|type|const|enum)\s+/m, type: 'export' },
    { pattern: /^export\s+default\s+/m, type: 'export-default' },
    { pattern: /^function\s+\w+/m, type: 'function' },
    { pattern: /^class\s+\w+/m, type: 'class' },
    { pattern: /^interface\s+\w+/m, type: 'interface' },
    { pattern: /^type\s+\w+\s*=/m, type: 'type' },
    { pattern: /^const\s+\w+\s*=/m, type: 'const' },
    { pattern: /^let\s+\w+\s*=/m, type: 'let' },
    { pattern: /^async\s+(function|\()/m, type: 'async-function' },
    { pattern: /^async\s+const\s+/m, type: 'async-const' },
    // Python
    { pattern: /^def\s+\w+/m, type: 'python-function' },
    { pattern: /^class\s+\w+.*:/m, type: 'python-class' },
    { pattern: /^async\s+def\s+/m, type: 'python-async' },
    { pattern: /^@(\w+)\s*$/m, type: 'decorator' },
    { pattern: /^if\s+__name__\s*==\s*['"]__main__['"]/m, type: 'main-block' },
    // Java/Kotlin
    { pattern: /^(public|private|protected)\s+(static\s+)?(void|int|String|class)\s+/m, type: 'java-member' },
    { pattern: /^class\s+\w+/m, type: 'java-class' },
    // Go
    { pattern: /^func\s+(\(\w+\s+\*?\w+\)\s+)?\w+/m, type: 'go-function' },
    // Rust
    { pattern: /^fn\s+\w+/m, type: 'rust-function' },
    { pattern: /^struct\s+\w+/m, type: 'rust-struct' },
    { pattern: /^impl\s+(\w+\s+for\s+)?\w+/m, type: 'rust-impl' },
    // SQL
    { pattern: /^(CREATE|ALTER|DROP|SELECT|INSERT|UPDATE|DELETE|WITH)\s+/im, type: 'sql-statement' },
    // General code structures
    { pattern: /^\s*#\s*include\s*</m, type: 'c-include' },
    { pattern: /^import\s+\w+/m, type: 'import' },
    { pattern: /^from\s+\w+\s+import\s+/m, type: 'from-import' },
    { pattern: /^#!\s*\/.*$/m, type: 'shebang' },
];
// ==================== FileChunker Class ====================
export class FileChunker {
    options;
    constructor(options = {}) {
        this.options = { ...DEFAULT_CHUNK_OPTIONS, ...options };
    }
    /**
     * Chunk a file's content
     */
    chunkFile(content, filePath) {
        const ext = this.getExtension(filePath).toLowerCase();
        // For large JSON files, return empty chunks to prevent OOM
        // Large JSON files (especially array-based) are not suitable for text chunking
        if ((ext === '.json' || ext === '.jsonc') && content.length > LARGE_FILE_THRESHOLD) {
            logger.warn(`Large JSON file (${(content.length / 1024 / 1024).toFixed(1)}MB), skipping chunking: ${filePath}`);
            return [];
        }
        const lines = content.split('\n');
        // Check if this is a code file
        if (this.isCodeFile(filePath)) {
            // Try semantic chunking first
            const semanticChunks = this.semanticChunk(lines, filePath);
            if (semanticChunks.length > 0) {
                logger.debug(`Semantic chunking produced ${semanticChunks.length} chunks for ${filePath}`);
                return semanticChunks;
            }
        }
        // Fallback to sliding window
        logger.debug(`Using sliding window chunking for ${filePath}`);
        return this.slidingWindowChunk(lines);
    }
    /**
     * Check if a file is a code file based on extension
     */
    isCodeFile(filePath) {
        const ext = this.getExtension(filePath);
        return CODE_EXTENSIONS.has(ext);
    }
    /**
     * Get file extension including the dot
     */
    getExtension(filePath) {
        const lastDot = filePath.lastIndexOf('.');
        if (lastDot === -1)
            return '';
        return filePath.slice(lastDot);
    }
    /**
     * Detect function/class definition boundaries
     */
    isBoundaryLine(line) {
        const trimmed = line.trim();
        // Skip empty lines and single-line comments
        if (!trimmed || trimmed.startsWith('//') || trimmed.startsWith('#')) {
            return false;
        }
        // Skip multi-line comment starts
        if (trimmed.startsWith('/*') || trimmed.startsWith('<!--')) {
            return false;
        }
        // Check against boundary patterns
        for (const { pattern } of BOUNDARY_PATTERNS) {
            if (pattern.test(trimmed)) {
                return true;
            }
        }
        return false;
    }
    /**
     * Semantic chunking - split at function/class boundaries
     */
    semanticChunk(lines, _filePath) {
        const chunks = [];
        let currentChunkLines = [];
        let startLine = 1;
        let currentTokenCount = 0;
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            const lineTokens = this.estimateTokens(line);
            // Check if this is a boundary line
            const isBoundary = this.isBoundaryLine(line);
            // If adding this line would exceed max and we have enough content
            if (currentTokenCount + lineTokens > this.options.maxChunkSize
                && currentChunkLines.length > 0) {
                // Finish current chunk
                chunks.push(this.createChunk(currentChunkLines, startLine, i));
                // Start new chunk with overlap
                const overlapLines = this.getOverlapLines(currentChunkLines);
                currentChunkLines = [...overlapLines, line];
                startLine = i - overlapLines.length + 1;
                currentTokenCount = this.calculateTokenCount(currentChunkLines);
            }
            else {
                currentChunkLines.push(line);
                currentTokenCount += lineTokens;
            }
            // If we hit a boundary and have enough content, start new chunk
            if (isBoundary
                && currentChunkLines.length > 1
                && currentTokenCount >= this.options.minChunkSize) {
                chunks.push(this.createChunk(currentChunkLines, startLine, i + 1));
                currentChunkLines = [line];
                startLine = i + 1;
                currentTokenCount = lineTokens;
            }
        }
        // Don't forget the last chunk - always include it even if small
        if (currentChunkLines.length > 0) {
            chunks.push(this.createChunk(currentChunkLines, startLine, lines.length));
        }
        return this.mergeSmallChunks(chunks);
    }
    /**
     * Sliding window chunking - fallback strategy
     */
    slidingWindowChunk(lines) {
        if (lines.length === 0)
            return [];
        const chunks = [];
        const windowSize = Math.ceil(this.options.maxChunkSize / 50); // ~50 tokens per line average
        const step = windowSize - this.options.overlap;
        for (let i = 0; i < lines.length; i += Math.max(step, 1)) {
            const windowLines = lines.slice(i, i + windowSize);
            if (windowLines.length === 0)
                continue;
            const chunk = this.createChunk(windowLines, i + 1, Math.min(i + windowSize, lines.length));
            const tokenCount = this.calculateTokenCount(windowLines);
            // Only add if chunk meets minimum size, unless it's the last chunk
            const isLastChunk = i + windowSize >= lines.length;
            if (tokenCount >= this.options.minChunkSize || isLastChunk) {
                // Skip chunks with empty content
                if (chunk.content.length > 0) {
                    chunks.push(chunk);
                }
            }
        }
        // If no chunks produced (empty file), return empty
        if (chunks.length === 0 && lines.length > 0) {
            // Create a single chunk for the entire file
            chunks.push(this.createChunk(lines, 1, lines.length));
        }
        return chunks;
    }
    /**
     * Get overlapping lines for continuity between chunks
     */
    getOverlapLines(chunkLines) {
        const overlapCount = Math.ceil(this.options.overlap / 50); // tokens to lines
        return chunkLines.slice(-Math.min(overlapCount, chunkLines.length));
    }
    /**
     * Create a chunk object
     */
    createChunk(lines, startLine, endLine) {
        const content = lines.join('\n');
        return {
            content,
            startLine,
            endLine,
            startToken: 0, // Would need to track properly if needed
            endToken: this.estimateTokens(content),
        };
    }
    /**
     * Calculate total tokens in lines
     */
    calculateTokenCount(lines) {
        return lines.reduce((sum, line) => sum + this.estimateTokens(line), 0);
    }
    /**
     * Rough token estimation
     *
     * Approximate: 1 token ≈ 4 chars for English, or 1 word per token
     * For code: slightly more tokens per line due to symbols
     */
    estimateTokens(text) {
        if (!text || text.length === 0)
            return 0;
        // For code, count words and symbols more precisely
        // Remove excessive whitespace but keep structure
        const normalized = text.replace(/\s+/g, ' ').trim();
        // Rough heuristic: ~4 characters per token on average
        // But code has more symbols, so use 3.5
        const charBasedEstimate = Math.ceil(normalized.length / 3.5);
        // Also count words as an alternative
        const wordBasedEstimate = normalized.split(/\s+/).length;
        // Take the higher estimate (tends to be more accurate for code)
        return Math.max(charBasedEstimate, wordBasedEstimate);
    }
    /**
     * Merge small chunks with neighbors to meet minimum size
     */
    mergeSmallChunks(chunks) {
        if (chunks.length === 0)
            return chunks;
        if (chunks.length === 1) {
            // Single chunk - return it even if small rather than dropping
            return chunks;
        }
        const merged = [];
        let current = chunks[0];
        for (let i = 1; i < chunks.length; i++) {
            const next = chunks[i];
            const currentTokens = this.estimateTokens(current.content);
            // If current chunk is too small, merge with next
            if (currentTokens < this.options.minChunkSize) {
                current = this.createChunk([...current.content.split('\n'), ...next.content.split('\n')], current.startLine, next.endLine);
            }
            else {
                merged.push(current);
                current = next;
            }
        }
        // Don't forget the last one
        const lastChunkTokens = this.estimateTokens(current.content);
        if (lastChunkTokens >= this.options.minChunkSize) {
            merged.push(current);
        }
        else if (merged.length > 0) {
            // Merge last small chunk into previous
            const last = merged[merged.length - 1];
            last.content = last.content + '\n' + current.content;
            last.endLine = current.endLine;
        }
        else {
            // Only one chunk and it's too small - still return it rather than dropping
            merged.push(current);
        }
        return merged;
    }
}
/**
 * Create a chunker instance with options
 */
export function createChunker(options) {
    return new FileChunker(options);
}
