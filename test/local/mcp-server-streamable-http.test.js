import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'child_process';

class MCPClient {
    client = null;
    transport = null;

    constructor(serverName) {
        this.client = new Client({ name: `mcp-client-for-${serverName}`, version: "1.0.0", url: `http://localhost:3000/mcp` });
    }

    async connectToServer(serverUrl) {
        this.transport = new StreamableHTTPClientTransport(serverUrl);
        await this.client.connect(this.transport);
    }

    async listTools() {
        return await this.client.listTools();
    }

    async listPrompts() {
        return await this.client.listPrompts();
    }

    async cleanup() {
        await this.client.close();
    }
}

describe('MCP Server in Streamble HTTP mode', () => {
    let client;
    let serverProcess;

    before(async () => {
        // Start MCP server as a child process
        serverProcess = spawn('node', ['mcp-server.js'], {
            cwd: process.cwd(),
            env: { ...process.env, GCP_STDIO: 'false' },
            stdio: 'inherit'
        });

        // Wait for server to start (better: poll the port, here we just wait)
        await new Promise(resolve => setTimeout(resolve, 2000));

        client = new MCPClient("http-server");
        await client.connectToServer("http://localhost:3000/mcp");
    });

    after(async () => {
        await client.cleanup();
        if (serverProcess) {
            serverProcess.kill();
        }
    });

    test('should list tools over streamble-http', async () => {
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

    test('should list prompts over streamble-http', async () => {
        const response = await client.listPrompts();
        const prompts = response.prompts;
        assert(Array.isArray(prompts));
        const promptNames = prompts.map((p) => p.name);
        assert.deepStrictEqual(promptNames.sort(), ['deploy', 'logs'].sort());
    });
});
