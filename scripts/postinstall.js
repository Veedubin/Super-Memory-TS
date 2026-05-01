#!/usr/bin/env node
/**
 * Postinstall script to pre-download embedding model
 * Runs during npm install to cache model files locally.
 */
import os from 'os';
import path from 'path';
import fs from 'fs';

// Skip in CI unless explicitly forced
if (process.env.CI && !process.env.SUPER_MEMORY_POSTINSTALL) {
  console.log('[super-memory-ts] Skipping model pre-download in CI (set SUPER_MEMORY_POSTINSTALL=1 to force)');
  process.exit(0);
}

// Match the cache directory used at runtime
const cacheDir = path.join(os.homedir(), '.cache', 'transformers');
process.env.TRANSFORMERS_CACHE = cacheDir;

const modelId = 'Xenova/bge-large-en-v1.5';
const modelCachePath = path.join(cacheDir, 'models--Xenova--bge-large-en-v1.5');

// Skip if already cached
if (fs.existsSync(modelCachePath)) {
  const stats = fs.statSync(modelCachePath);
  console.log(`[super-memory-ts] Model already cached (last modified: ${stats.mtime.toISOString()})`);
  process.exit(0);
}

console.log('[super-memory-ts] Pre-downloading embedding model (~650MB)...');
console.log(`[super-memory-ts] Cache location: ${cacheDir}`);
console.log('[super-memory-ts] This is a one-time download. Subsequent startups will use the cached model.');

async function downloadModel() {
  try {
    const { pipeline, env } = await import('@xenova/transformers');
    env.cacheDir = cacheDir;
    
    // Use CPU to avoid GPU driver requirements during installation
    await pipeline('feature-extraction', modelId, { 
      dtype: 'fp16',
      device: 'cpu',
    });
    
    console.log('[super-memory-ts] Model downloaded and cached successfully');
  } catch (error) {
    console.error('[super-memory-ts] Model pre-download failed:', error instanceof Error ? error.message : String(error));
    console.error('[super-memory-ts] The model will be downloaded automatically on first use.');
    // Exit 0 so npm install doesn't fail
  }
}

downloadModel();
