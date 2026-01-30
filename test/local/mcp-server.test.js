import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

describe('MCP Server in stdio mode', () => {
  let client;
  let transport;

  before(async () => {
    transport = new StdioClientTransport({
      command: 'node',
      args: ['mcp-server.js'],
      env: { ...process.env, GCP_STDIO: 'true' },
    });
    client = new Client({
      name: 'test-client',
      version: '1.0.0',
    });
    await client.connect(transport);
  });

  after(() => {
    client.close();
  });

  test('should list tools', async () => {
    const response = await client.listTools();

    const tools = response.tools;
    assert(Array.isArray(tools));
    const toolNames = tools.map((t) => t.name);
    assert.deepStrictEqual(
      toolNames.sort(),
      [
        'create_project',
        'deploy_container_image',
        'deploy_file_contents',
        'deploy_local_folder',
        'get_service',
        'get_service_log',
        'list_projects',
        'list_services',
      ].sort()
    );
  });

  test('should list prompts', async () => {
    const response = await client.listPrompts();

    const prompts = response.prompts;
    assert(Array.isArray(prompts));
    const promptNames = prompts.map((p) => p.name);
    assert.deepStrictEqual(promptNames.sort(), ['deploy', 'logs'].sort());
  });
});
