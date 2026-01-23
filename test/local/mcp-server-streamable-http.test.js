import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'child_process';
import { waitForString } from './test-utils.js';
import { SCOPES, BEARER_METHODS_SUPPORTED, RESPONSE_TYPES_SUPPORTED } from '../../constants.js';

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

describe('OAuth Endpoints', () => {
  let serverProcess;
  let stdout = '';
  const httpMsg = 'Cloud Run MCP server listening on port 3001';
  const oauthProtectedResource = 'https://example.com/resource';
  const oauthAuthorizationServer = 'https://example.com/auth';
  const oauthAuthorizationEndpoint = 'https://example.com/auth/authorize';
  const oauthTokenEndpoint = 'https://example.com/auth/token';

  before(async () => {
    stdout = '';
    serverProcess = spawn('node', ['mcp-server.js'], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        GCP_STDIO: 'false',
        PORT: '3001',
        OAUTH_PROTECTED_RESOURCE: oauthProtectedResource,
        OAUTH_AUTHORIZATION_SERVER: oauthAuthorizationServer,
        OAUTH_AUTHORIZATION_ENDPOINT: oauthAuthorizationEndpoint,
        OAUTH_TOKEN_ENDPOINT: oauthTokenEndpoint,
      }
    });
    stdout = await waitForString(serverProcess.stdout, httpMsg);
  });

  after(() => {
    if (serverProcess) {
      serverProcess.kill();
    }
  });

  test('should return correct OAuth protected resource configuration', async () => {
    const response = await fetch('http://localhost:3001/.well-known/oauth-protected-resource');
    assert.equal(response.status, 200);
    const data = await response.json();

    assert.deepStrictEqual(data, {
      resource: oauthProtectedResource,
      authorization_servers: [oauthAuthorizationServer],
      scopes_supported: [
        SCOPES.OPENID,
        SCOPES.EMAIL,
        SCOPES.CLOUD_PLATFORM,
      ],
      bearer_methods_supported: [...BEARER_METHODS_SUPPORTED],
    });
  });

  test('should return correct OAuth authorization server configuration', async () => {
    const response = await fetch('http://localhost:3001/.well-known/oauth-authorization-server');
    assert.equal(response.status, 200);
    const data = await response.json();

    assert.deepStrictEqual(data, {
      issuer: oauthProtectedResource,
      authorization_endpoint: oauthAuthorizationEndpoint,
      token_endpoint: oauthTokenEndpoint,
      scopes_supported: [
        SCOPES.OPENID,
        SCOPES.EMAIL,
        SCOPES.CLOUD_PLATFORM,
      ],
      response_types_supported: [...RESPONSE_TYPES_SUPPORTED],
    });
  });
});
