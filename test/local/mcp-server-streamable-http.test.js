import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'child_process';
import { waitForString } from './test-utils.js';

class MCPClient {
  client = null;
  transport = null;

  constructor(serverName) {
    this.client = new Client({
      name: `mcp-client-for-${serverName}`,
      version: '1.0.0',
      url: `http://localhost:3000/mcp`,
    });
  }

  async connectToServer(serverUrl) {
    this.transport = new StreamableHTTPClientTransport(serverUrl);
    await this.client.connect(this.transport);
  }

  async cleanup() {
    await this.client.close();
  }
}

describe('MCP Server in Streamble HTTP mode', () => {
  let client;
  let serverProcess;
  let stdout = '';
  const httpMsg = 'Cloud Run MCP server listening on port 3000';

  describe('when GCP_STDIO=false', () => {
    before(async () => {
      stdout = '';
      // Start MCP server as a child process
      serverProcess = spawn('node', ['mcp-server.js'], {
        cwd: process.cwd(),
        env: { ...process.env, GCP_STDIO: 'false' },
      });
      stdout = await waitForString(serverProcess.stdout, httpMsg);

      client = new MCPClient('http-server');
    });

    after(async () => {
      await client.cleanup();
      if (serverProcess) {
        serverProcess.kill();
      }
    });

    test('should start an HTTP server', async () => {
      await client.connectToServer('http://localhost:3000/mcp');
      assert.ok(stdout.includes(httpMsg));
    });
  });
});
