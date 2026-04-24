# Sample Markdown File

## Introduction

This is a sample markdown file for testing the project indexing system.

## Features

The project indexer supports:

- **File Watching** - Real-time monitoring of project files
- **Semantic Chunking** - Intelligent splitting of code at function/class boundaries
- **Vector Storage** - HNSW-indexed embeddings in LanceDB
- **Fast Search** - Sub-second semantic search across project files

## Usage

```typescript
import { createIndexer } from './project-index';

const indexer = createIndexer({
  rootPath: './src',
  includePatterns: ['**/*.ts', '**/*.js'],
  chunkSize: 512,
});

await indexer.start();

// Search for code
const results = await indexer.search('user authentication');
```

## Architecture

1. **Watcher** - Uses chokidar to monitor file changes
2. **Chunker** - Splits files at semantic boundaries
3. **Indexer** - Coordinates embedding and storage
