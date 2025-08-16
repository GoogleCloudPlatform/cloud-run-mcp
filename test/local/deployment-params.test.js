import assert from 'node:assert/strict';
import { describe, it, mock } from 'node:test';
import esmock from 'esmock';

describe('Deployment Parameters', () => {
  it('should pass port and gpuZonalRedundancy to deploy function', async () => {
    const server = {
      registerTool: mock.fn(),
    };

    const deployMock = mock.fn(() => Promise.resolve({ uri: 'my-uri' }));

    const { registerTools } = await esmock('../../tools.js', {
      '../../lib/cloud-run-deploy.js': {
        deploy: deployMock,
      },
    });

    registerTools(server, { gcpCredentialsAvailable: true });

    const handler = server.registerTool.mock.calls.find(
      (call) => call.arguments[0] === 'deploy_local_files'
    ).arguments[2];

    await handler(
      {
        project: 'my-project',
        region: 'my-region',
        service: 'my-service',
        files: ['file1'],
        port: 8080,
        gpuZonalRedundancy: false,
      },
      { sendNotification: mock.fn() }
    );

    assert.strictEqual(deployMock.mock.callCount(), 1);
    const deployArgs = deployMock.mock.calls[0].arguments[0];
    assert.strictEqual(deployArgs.port, 8080);
    assert.strictEqual(deployArgs.gpuZonalRedundancy, false);
  });

  it('should pass port and gpuZonalRedundancy to deployImage function', async () => {
    const server = {
      registerTool: mock.fn(),
    };

    const deployImageMock = mock.fn(() => Promise.resolve({ uri: 'my-uri' }));

    const { registerTools } = await esmock('../../tools.js', {
      '../../lib/cloud-run-deploy.js': {
        deployImage: deployImageMock,
      },
    });

    registerTools(server, { gcpCredentialsAvailable: true });

    const handler = server.registerTool.mock.calls.find(
      (call) => call.arguments[0] === 'deploy_container_image'
    ).arguments[2];

    await handler(
      {
        project: 'my-project',
        region: 'my-region',
        service: 'my-service',
        imageUrl: 'gcr.io/my-project/my-image',
        port: 9090,
        gpuZonalRedundancy: true,
      },
      { sendNotification: mock.fn() }
    );

    assert.strictEqual(deployImageMock.mock.callCount(), 1);
    const deployImageArgs = deployImageMock.mock.calls[0].arguments[0];
    assert.strictEqual(deployImageArgs.port, 9090);
    assert.strictEqual(deployImageArgs.gpuZonalRedundancy, true);
  });
});
