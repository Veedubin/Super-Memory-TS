/**
 * MCP Server Integration Test Script
 * 
 * This script provides manual integration tests for the MCP server.
 * Run with: node tests/integration-test.js
 * 
 * NOTE: The server has LanceDB initialization issues documented below.
 */

const { spawn } = require('child_process');
const path = require('path');

const SERVER_PATH = path.join(__dirname, '../dist/index.js');

/**
 * MCP Client for testing
 */
class MCPClient {
  constructor() {
    this.process = null;
    this.messageId = 0;
    this.pendingRequests = new Map();
    this.stdoutData = '';
    this.stderrData = '';
  }

  async start() {
    return new Promise((resolve, reject) => {
      this.process = spawn('node', [SERVER_PATH], {
        stdio: ['pipe', 'pipe', 'pipe'],
        env: {
          ...process.env,
          BOOMERANG_LOG_LEVEL: 'error',
        },
      });

      if (!this.process.stdout || !this.process.stdin || !this.process.stderr) {
        reject(new Error('Failed to create stdio streams'));
        return;
      }

      this.process.stderr.on('data', (data) => {
        this.stderrData += data.toString();
      });

      this.process.stdout.on('data', (data) => {
        this.stdoutData += data.toString();
        this.processStdout();
      });

      this.process.on('error', (error) => {
        reject(error);
      });

      this.process.on('exit', (code) => {
        console.log(`Server exited with code ${code}`);
      });

      setTimeout(resolve, 2000);
    });
  }

  processStdout() {
    const lines = this.stdoutData.split('\n');
    for (let i = 0; i < lines.length - 1; i++) {
      const line = lines[i].trim();
      if (line && line.startsWith('{')) {
        try {
          const response = JSON.parse(line);
          this.handleResponse(response);
        } catch {}
      }
    }
    this.stdoutData = lines[lines.length - 1];
  }

  handleResponse(response) {
    const pending = this.pendingRequests.get(response.id);
    if (pending) {
      this.pendingRequests.delete(response.id);
      pending.resolve(response);
    }
  }

  async sendRequest(method, params = {}) {
    if (!this.process || !this.process.stdin) {
      throw new Error('Server not started');
    }

    const id = ++this.messageId;
    const request = {
      jsonrpc: '2.0',
      id,
      method,
      params,
    };

    return new Promise((resolve, reject) => {
      this.pendingRequests.set(id, { resolve, reject });
      this.process.stdin.write(JSON.stringify(request) + '\n');

      setTimeout(() => {
        if (this.pendingRequests.has(id)) {
          this.pendingRequests.delete(id);
          reject(new Error(`Request ${method} timed out`));
        }
      }, 30000);
    });
  }

  async callTool(name, args = {}) {
    return this.sendRequest('tools/call', { name, arguments: args });
  }

  async listTools() {
    return this.sendRequest('tools/list');
  }

  async stop() {
    if (this.process) {
      this.process.stdin.end();
      this.process.kill();
      this.process = null;
    }
  }

  getStderr() {
    return this.stderrData;
  }
}

/**
 * Test runner
 */
async function runTests() {
  console.log('='.repeat(60));
  console.log('Super-Memory MCP Server Integration Tests');
  console.log('='.repeat(60));
  console.log();

  const client = new MCPClient();
  let passed = 0;
  let failed = 0;

  const test = async (name, fn) => {
    try {
      await fn();
      console.log(`✓ ${name}`);
      passed++;
    } catch (error) {
      console.log(`✗ ${name}`);
      console.log(`  Error: ${error.message}`);
      failed++;
    }
  };

  try {
    // Start server
    await test('1. Server Startup - Start server', async () => {
      await client.start();
    });

    // List tools
    await test('2. Tool Registration - List tools', async () => {
      const response = await client.listTools();
      if (response.error) throw new Error(response.error.message);
      const result = response.result;
      if (!result.tools || result.tools.length !== 4) {
        throw new Error(`Expected 4 tools, got ${result.tools?.length || 0}`);
      }
    });

    // Add memory
    await test('3. add_memory - Add new memory', async () => {
      const response = await client.callTool('add_memory', {
        content: 'Test memory: Integration testing works!',
        sourceType: 'manual',
      });
      if (response.error) throw new Error(response.error.message);
      const result = JSON.parse(response.result.content[0].text);
      if (!result.success) throw new Error(result.message);
    });

    // Query memories
    await test('4. query_memories - Query memories', async () => {
      const response = await client.callTool('query_memories', {
        query: 'integration testing',
        limit: 5,
      });
      if (response.error) throw new Error(response.error.message);
      const result = JSON.parse(response.result.content[0].text);
      if (typeof result.count !== 'number') throw new Error('Invalid response format');
    });

    // Error: Empty query
    await test('5. Error Handling - Empty query rejected', async () => {
      const response = await client.callTool('query_memories', { query: '' });
      const result = JSON.parse(response.result.content[0].text);
      if (!result.error) throw new Error('Should have returned error');
      if (result.code !== 'VALIDATION_ERROR') throw new Error(`Wrong error code: ${result.code}`);
    });

    // Error: Empty content
    await test('6. Error Handling - Empty content rejected', async () => {
      const response = await client.callTool('add_memory', { content: '' });
      const result = JSON.parse(response.result.content[0].text);
      if (!result.error) throw new Error('Should have returned error');
    });

    // Error: Search project without indexer
    await test('7. Error Handling - Search without indexer', async () => {
      const response = await client.callTool('search_project', {
        query: 'test',
      });
      const result = JSON.parse(response.result.content[0].text);
      if (!result.error) throw new Error('Should have returned error');
      if (result.code !== 'INDEX_NOT_INITIALIZED') throw new Error(`Wrong error code: ${result.code}`);
    });

  } catch (error) {
    console.log('\nFatal error during tests:', error.message);
    console.log('Server stderr:', client.getStderr());
  } finally {
    await client.stop();
  }

  console.log();
  console.log('='.repeat(60));
  console.log(`Results: ${passed} passed, ${failed} failed`);
  console.log('='.repeat(60));

  process.exit(failed > 0 ? 1 : 0);
}

// Run tests
runTests().catch(console.error);
