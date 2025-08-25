import assert from 'node:assert/strict';
import { describe, it, mock } from 'node:test';
import esmock from 'esmock';

describe('Tool Notifications', () => {
  it('should send notifications during deployment', async () => {
    const server = {
      registerTool: mock.fn(),
    };

  const { registerTools } = await esmock('../../tools/tools.js', {
      '../../lib/cloud-run-deploy.js': {
        deploy: () => Promise.resolve({ uri: 'my-uri' }),
      },
    });

    registerTools(server, { gcpCredentialsAvailable: true });

    const handler = server.registerTool.mock.calls.find(
      (call) => call.arguments[0] === 'deploy_local_folder'
    ).arguments[2];

    const sendNotification = mock.fn();

    await handler(
      {
        project: 'my-project',
        region: 'my-region',
        service: 'my-service',
        folderPath: '/my/folder',
      },
      { sendNotification }
    );

    assert.strictEqual(sendNotification.mock.callCount(), 1);
    assert.deepStrictEqual(sendNotification.mock.calls[0].arguments[0], {
      method: 'notifications/message',
      params: {
        level: 'info',
        data: 'Starting deployment of local folder for service my-service in project my-project...',
      },
    });
  });
});
