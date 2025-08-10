import assert from 'node:assert/strict';
import { describe, it, mock } from 'node:test';
import esmock from 'esmock';

describe('registerTools', () => {
  it('should register all tools', async () => {
    const server = {
      registerTool: mock.fn(),
    };

    const { registerTools } = await esmock('../tools.js', {});

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

  describe('list_projects', () => {
    it('should list projects', async () => {
      const server = {
        registerTool: mock.fn(),
      };

      const { registerTools } = await esmock('../tools.js', {
        '../lib/gcp-projects.js': {
          listProjects: () => Promise.resolve([{ id: 'project1' }, { id: 'project2' }]),
        },
      });

      registerTools(server);

      const handler = server.registerTool.mock.calls.find(call => call.arguments[0] === 'list_projects').arguments[2];
      const result = await handler({});

      assert.deepStrictEqual(result, {
        content: [{
          type: 'text',
          text: 'Available GCP Projects:\n- project1\n- project2'
        }]
      });
    });
  });

  describe('create_project', () => {
    it('should create a project with a provided id', async () => {
      const server = {
        registerTool: mock.fn(),
      };

      const { registerTools } = await esmock('../tools.js', {
        '../lib/gcp-projects.js': {
          createProjectAndAttachBilling: (projectId) => Promise.resolve({ projectId: projectId, billingMessage: 'billing message' }),
        },
      });

      registerTools(server);

      const handler = server.registerTool.mock.calls.find(call => call.arguments[0] === 'create_project').arguments[2];
      const result = await handler({ projectId: 'my-project' });

      assert.deepStrictEqual(result, {
        content: [{
          type: 'text',
          text: 'Successfully created GCP project with ID "my-project". You can now use this project ID for deployments.'
        }]
      });
    });

    it('should create a project with a generated id', async () => {
      const server = {
        registerTool: mock.fn(),
      };

      const { registerTools } = await esmock('../tools.js', {
        '../lib/gcp-projects.js': {
          createProjectAndAttachBilling: () => Promise.resolve({ projectId: 'generated-project', billingMessage: 'billing message' }),
        },
      });

      registerTools(server);

      const handler = server.registerTool.mock.calls.find(call => call.arguments[0] === 'create_project').arguments[2];
      const result = await handler({});

      assert.deepStrictEqual(result, {
        content: [{
          type: 'text',
          text: 'Successfully created GCP project with ID "generated-project". You can now use this project ID for deployments.'
        }]
      });
    });
  });
});