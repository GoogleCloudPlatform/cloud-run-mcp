
import assert from 'node:assert/strict';
import { describe, it, mock } from 'node:test';
import { registerTools } from '../tools.js';

describe('registerTools', () => {
  it('should register all tools', () => {
    const server = {
      registerTool: mock.fn(),
    };

    registerTools(server);

    assert.strictEqual(server.registerTool.mock.callCount(), 9);
    const toolNames = server.registerTool.mock.calls.map(call => call.arguments[0]);
    assert.deepStrictEqual(toolNames.sort(), [
      'create_project',
      'deploy_container_image',
      'deploy_file_contents',
      'deploy_local_files',
      'deploy_local_folder',
      'get_service',
      'get_service_log',
      'list_projects',
      'list_services'
    ].sort());
  });
});
