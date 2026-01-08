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
        env: { ...process.env, GCP_STDIO: 'true' },
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

  describe('when GCP_STDIO is unset', () => {
    before(async () => {
      stderr = '';
      const env = { ...process.env };
      delete env.GCP_STDIO;
      serverProcess = spawn('node', ['mcp-server.js'], {
        cwd: process.cwd(),
        env: env,
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
});
