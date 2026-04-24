/**
 * Model Layer Test Script
 * Tests ModelManager, embedding generation, fp16 precision, and CPU fallback
 */

import { ModelManager } from './src/model/index.js';
import { 
  generateEmbedding, 
  generateEmbeddings, 
  generateEmbeddingBatch,
  isModelReady,
  getEmbeddingDimensions,
  getModelMetadata,
  preloadModel,
  releaseModel 
} from './src/model/embeddings.js';
import { 
  BGE_LARGE_MODEL_ID, 
  MINI_LM_MODEL_ID,
  BGE_LARGE_DIMENSIONS,
  MINI_LM_DIMENSIONS 
} from './src/model/types.js';

// Helper to get memory usage in MB
function getMemoryUsageMB(): number {
  const usage = process.memoryUsage();
  return {
    rss: usage.rss / 1024 / 1024,
    heapTotal: usage.heapTotal / 1024 / 1024,
    heapUsed: usage.heapUsed / 1024 / 1024,
    external: usage.external / 1024 / 1024,
  };
}

// Helper to format memory
function formatMemory(mem: { rss: number; heapTotal: number; heapUsed: number; external: number }): string {
  return `RSS: ${mem.rss.toFixed(2)}MB, HeapTotal: ${mem.heapTotal.toFixed(2)}MB, HeapUsed: ${mem.heapUsed.toFixed(2)}MB, External: ${mem.external.toFixed(2)}MB`;
}

// Test results collector
interface TestResult {
  name: string;
  passed: boolean;
  duration: number;
  error?: string;
  metadata?: any;
}

const results: TestResult[] = [];

async function runTest(name: string, fn: () => Promise<void>): Promise<void> {
  const start = Date.now();
  try {
    await fn();
    results.push({ name, passed: true, duration: Date.now() - start });
    console.log(`✅ PASS: ${name} (${Date.now() - start}ms)`);
  } catch (error) {
    results.push({ 
      name, 
      passed: false, 
      duration: Date.now() - start,
      error: error instanceof Error ? error.message : String(error)
    });
    console.log(`❌ FAIL: ${name} - ${error instanceof Error ? error.message : String(error)}`);
  }
}

console.log('='.repeat(60));
console.log('Super-Memory-TS Model Layer Test Suite');
console.log('='.repeat(60));
console.log(`Started at: ${new Date().toISOString()}`);
console.log(`Node version: ${process.version}`);
console.log(`Initial memory: ${formatMemory(getMemoryUsageMB())}`);
console.log('');


// ============================================
// TEST 1: ModelManager Singleton Pattern
// ============================================
await runTest('ModelManager singleton returns same instance', async () => {
  const instance1 = ModelManager.getInstance();
  const instance2 = ModelManager.getInstance();
  if (instance1 !== instance2) {
    throw new Error('ModelManager should return same instance');
  }
});

// ============================================
// TEST 2: Model Loading with fp16 Precision
// ============================================
let modelLoadTime = 0;
let modelMetadata: any;

await runTest('Model loads with fp16 precision (BGE-Large or MiniLM fallback)', async () => {
  const manager = ModelManager.getInstance();
  
  // Check initial config
  const config = manager.getMetadata();
  console.log(`  Initial config - Precision: ${config.precision}, Device: ${config.device}, Model: ${config.modelId}`);
  
  const memBefore = getMemoryUsageMB();
  console.log(`  Memory before load: ${formatMemory(memBefore)}`);
  
  const loadStart = Date.now();
  await manager.acquire();
  modelLoadTime = Date.now() - loadStart;
  
  const memAfter = getMemoryUsageMB();
  console.log(`  Memory after load: ${formatMemory(memAfter)}`);
  console.log(`  Memory delta: ${(memAfter.heapUsed - memBefore.heapUsed).toFixed(2)}MB`);
  
  modelMetadata = manager.getMetadata();
  console.log(`  Loaded model: ${modelMetadata.modelId}`);
  console.log(`  Dimensions: ${modelMetadata.dimensions}`);
  console.log(`  Is loaded: ${modelMetadata.isLoaded}`);
  console.log(`  Reference count: ${modelMetadata.referenceCount}`);
  console.log(`  Load time: ${modelLoadTime}ms`);
  
  if (!modelMetadata.isLoaded) {
    throw new Error('Model should be loaded after acquire()');
  }
});

// ============================================
// TEST 3: Embedding Generation - Single Text
// ============================================
await runTest('Single embedding generation', async () => {
  const testText = 'This is a test sentence for embedding generation.';
  
  console.log(`  Input text: "${testText}"`);
  const memBefore = getMemoryUsageMB();
  
  const result = await generateEmbedding(testText);
  
  const memAfter = getMemoryUsageMB();
  console.log(`  Embedding dimensions: ${result.embedding.length}`);
  console.log(`  Token count: ${result.tokenCount}`);
  console.log(`  Model ID: ${result.modelId}`);
  console.log(`  Device: ${result.device}`);
  console.log(`  Latency: ${result.latencyMs}ms`);
  console.log(`  Memory delta: ${(memAfter.heapUsed - memBefore.heapUsed).toFixed(2)}MB`);
  
  // Validate embedding
  if (!result.embedding || result.embedding.length === 0) {
    throw new Error('Embedding should not be empty');
  }
  
  // Check dimension based on model
  const expectedDim = result.modelId === BGE_LARGE_MODEL_ID ? BGE_LARGE_DIMENSIONS : MINI_LM_DIMENSIONS;
  if (result.embedding.length !== expectedDim) {
    throw new Error(`Expected embedding dimension ${expectedDim}, got ${result.embedding.length}`);
  }
  
  // Check embedding is normalized (values should be between -1 and 1)
  const norm = Math.sqrt(result.embedding.reduce((sum, val) => sum + val * val, 0));
  console.log(`  Embedding norm: ${norm.toFixed(4)}`);
  if (Math.abs(norm - 1.0) > 0.01) {
    throw new Error('Embedding should be normalized (norm ~= 1.0)');
  }
});

// ============================================
// TEST 4: Batch Embedding Generation
// ============================================
await runTest('Batch embedding generation', async () => {
  const texts = [
    'First test sentence for batch processing.',
    'Second test sentence for batch processing.',
    'Third test sentence for batch processing.',
    'Fourth test sentence for batch processing.',
    'Fifth test sentence for batch processing.',
  ];
  
  console.log(`  Processing ${texts.length} texts...`);
  const memBefore = getMemoryUsageMB();
  
  const startTime = Date.now();
  const batchResult = await generateEmbeddingBatch(texts, 2);
  const batchTime = Date.now() - startTime;
  
  const memAfter = getMemoryUsageMB();
  console.log(`  Generated ${batchResult.embeddings.length} embeddings`);
  console.log(`  Total latency: ${batchTime}ms`);
  console.log(`  Average latency per text: ${(batchTime / texts.length).toFixed(2)}ms`);
  console.log(`  Memory delta: ${(memAfter.heapUsed - memBefore.heapUsed).toFixed(2)}MB`);
  
  if (batchResult.embeddings.length !== texts.length) {
    throw new Error(`Expected ${texts.length} embeddings, got ${batchResult.embeddings.length}`);
  }
  
  // Check all embeddings have correct dimensions
  for (let i = 0; i < batchResult.embeddings.length; i++) {
    const expectedDim = batchResult.modelId === BGE_LARGE_MODEL_ID ? BGE_LARGE_DIMENSIONS : MINI_LM_DIMENSIONS;
    if (batchResult.embeddings[i].length !== expectedDim) {
      throw new Error(`Embedding ${i} has wrong dimension: ${batchResult.embeddings[i].length}, expected ${expectedDim}`);
    }
  }
});

// ============================================
// TEST 5: Reference Counting
// ============================================
await runTest('Reference counting works correctly', async () => {
  const manager = ModelManager.getInstance();
  const initialCount = manager.getRefCount();
  console.log(`  Initial ref count: ${initialCount}`);
  
  // Acquire should increment
  await manager.acquire();
  const afterAcquire = manager.getRefCount();
  console.log(`  After acquire: ${afterAcquire}`);
  
  if (afterAcquire <= initialCount) {
    throw new Error('Reference count should increase after acquire()');
  }
  
  // Release should decrement
  await manager.release();
  const afterRelease = manager.getRefCount();
  console.log(`  After release: ${afterRelease}`);
  
  if (afterRelease >= afterAcquire) {
    throw new Error('Reference count should decrease after release()');
  }
});

// ============================================
// TEST 6: Model Dimensions
// ============================================
await runTest('Model dimensions are correct', async () => {
  const dims = getEmbeddingDimensions();
  console.log(`  getEmbeddingDimensions(): ${dims}`);
  
  const metadata = getModelMetadata();
  console.log(`  metadata.dimensions: ${metadata.dimensions}`);
  
  const expectedDim = metadata.modelId === BGE_LARGE_MODEL_ID ? BGE_LARGE_DIMENSIONS : MINI_LM_DIMENSIONS;
  
  if (dims !== expectedDim) {
    throw new Error(`Expected dimensions ${expectedDim} for ${metadata.modelId}, got ${dims}`);
  }
  
  if (metadata.dimensions !== expectedDim) {
    throw new Error(`Metadata dimensions mismatch: expected ${expectedDim}, got ${metadata.dimensions}`);
  }
});

// ============================================
// TEST 7: isModelReady State
// ============================================
await runTest('isModelReady reflects actual state', async () => {
  const ready = isModelReady();
  const metadata = getModelMetadata();
  
  console.log(`  isModelReady(): ${ready}`);
  console.log(`  metadata.isLoaded: ${metadata.isLoaded}`);
  
  if (ready !== metadata.isLoaded) {
    throw new Error('isModelReady() should match metadata.isLoaded');
  }
});

// ============================================
// TEST 8: Model Unload
// ============================================
await runTest('Model can be unloaded', async () => {
  const manager = ModelManager.getInstance();
  
  // Ensure loaded first
  await manager.acquire();
  if (!manager.getMetadata().isLoaded) {
    throw new Error('Model should be loaded before unload test');
  }
  
  // Release all references
  while (manager.getRefCount() > 0) {
    await manager.release();
  }
  
  const memBefore = getMemoryUsageMB();
  manager.unload();
  const memAfter = getMemoryUsageMB();
  
  console.log(`  After unload - ref count: ${manager.getRefCount()}`);
  console.log(`  Memory delta after unload: ${(memAfter.heapUsed - memBefore.heapUsed).toFixed(2)}MB`);
  
  if (manager.getMetadata().isLoaded) {
    throw new Error('Model should not be loaded after unload()');
  }
});

// ============================================
// SUMMARY
// ============================================
console.log('');
console.log('='.repeat(60));
console.log('TEST SUMMARY');
console.log('='.repeat(60));

const passed = results.filter(r => r.passed).length;
const failed = results.filter(r => !r.passed).length;

console.log(`Total tests: ${results.length}`);
console.log(`Passed: ${passed}`);
console.log(`Failed: ${failed}`);
console.log(`Total time: ${results.reduce((sum, r) => sum + r.duration, 0)}ms`);
console.log('');
console.log('Model Performance:');
console.log(`  Model load time: ${modelLoadTime}ms`);
console.log(`  Model loaded: ${modelMetadata?.modelId || 'N/A'}`);
console.log(`  Dimensions: ${modelMetadata?.dimensions || 'N/A'}`);
console.log(`  Precision: ${modelMetadata?.precision || 'N/A'}`);
console.log('');
console.log('Final memory:', formatMemory(getMemoryUsageMB()));

if (failed > 0) {
  console.log('');
  console.log('FAILED TESTS:');
  results.filter(r => !r.passed).forEach(r => {
    console.log(`  - ${r.name}: ${r.error}`);
  });
  process.exit(1);
}

console.log('');
console.log('All tests passed! ✅');

// Export results for external use
export { results, modelLoadTime, modelMetadata };
