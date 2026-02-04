import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'child_process';
import { waitForString } from './test-utils.js';

describe('MCP Server stdio startup', () => {
  let serverProcess;
  let stderr = '';
  const stdioMsg = 'Cloud Run MCP server stdio transport connected';

  describe('when GCP_STDIO=true', () => {
    before(async () => {
      stderr = '';
      serverProcess = spawn('node', ['mcp-server.js'], {
        cwd: process.cwd(),
      });
      stderr = await waitForString(serverProcess.stderr, stdioMsg);
    });

    after(() => {
      if (serverProcess) {
        serverProcess.kill();
      }
    });

    test('should start in stdio mode', () => {
      assert.ok(stderr.includes(stdioMsg));
    });
  });

  describe('when GCP_STDIO=false', () => {
    before(async () => {
      stderr = '';
      const env = { ...process.env };
      env.GCP_STDIO = 'false';
      serverProcess = spawn('node', ['mcp-server.js'], {
        cwd: process.cwd(),
        env: env,
      });
      const stderrChunks = [];
      serverProcess.stderr.on('data', (chunk) => {
        stderrChunks.push(chunk);
      });
      await new Promise((resolve) => setTimeout(resolve, 2000));
      stderr = Buffer.concat(stderrChunks).toString();
    });

    after(() => {
      if (serverProcess) {
        serverProcess.kill();
      }
    });

    test('should not start in stdio mode', () => {
      assert.ok(!stderr.includes(stdioMsg));
    });
  });
});
