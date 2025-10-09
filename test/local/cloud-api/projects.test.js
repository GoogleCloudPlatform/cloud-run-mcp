import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import esmock from 'esmock';

describe('projects', () => {
  describe('generateProjectId', () => {
    it('should generate a project id in the correct format', async () => {
      const { generateProjectId } = await esmock(
        '../../../lib/cloud-api/projects.js',
        {}
      );

      const projectId = generateProjectId();
      assert.ok(projectId.startsWith('mcp-'));
      assert.strictEqual(projectId.length, 11);
    });
  });
});
