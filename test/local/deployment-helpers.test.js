/*
Copyright 2025 Google LLC

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    https://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
*/

import { test, describe, mock } from 'node:test';
import assert from 'node:assert/strict';
import esmock from 'esmock';
import { DEPLOYMENT_CONFIG } from '../../lib/deployment/constants.js';

describe('Deployment Helpers', () => {
  const fsMock = {
    statSync: mock.fn(),
    existsSync: mock.fn(),
    promises: {
      readdir: mock.fn(),
      readFile: mock.fn(),
    },
  };

  test('makeFileDeploymentMetadata correctly identifies Dockerfile in folder', async () => {
    const deploymentHelpers = await esmock('../../lib/deployment/helpers.js', {
      fs: fsMock,
    });

    const folderPath = '/absolute/path/to/folder';

    // Mock isFolder logic
    fsMock.statSync.mock.mockImplementation(() => ({
      isDirectory: () => true,
    }));

    // Mock Dockerfile check
    fsMock.existsSync.mock.mockImplementation((filePath) => {
      if (filePath.endsWith('Dockerfile') || filePath.endsWith('dockerfile'))
        return true;
      return false;
    });

    const result = deploymentHelpers.makeFileDeploymentMetadata([folderPath]);

    assert.equal(result.hasDockerfile, true);
  });

  test('makeFileDeploymentMetadata correctly identifies Node.js project', async () => {
    const deploymentHelpers = await esmock('../../lib/deployment/helpers.js', {
      fs: fsMock,
    });

    const folderPath = '/absolute/path/to/node-app';

    // Mock isFolder
    fsMock.statSync.mock.mockImplementation(() => ({
      isDirectory: () => true,
    }));

    // Mock existsSync
    fsMock.existsSync.mock.mockImplementation((p) => {
      if (p.endsWith('Dockerfile')) return false;
      if (p.endsWith('package.json')) return true;
      return false;
    });

    const result = deploymentHelpers.makeFileDeploymentMetadata([folderPath]);

    assert.equal(result.hasDockerfile, false);
    assert.equal(result.deploymentAttrs.runtime, 'nodejs');
  });

  test('canDeployWithoutBuild returns true for valid Node.js project', async () => {
    const deploymentHelpers = await esmock('../../lib/deployment/helpers.js', {
      fs: fsMock,
    });

    const metadata = {
      hasDockerfile: false,
      deploymentAttrs: {
        runtime: 'nodejs',
      },
    };

    assert.equal(deploymentHelpers.canDeployWithoutBuild(metadata), true);
  });

  test('canDeployWithoutBuild returns false if Dockerfile exists', async () => {
    const deploymentHelpers = await esmock('../../lib/deployment/helpers.js', {
      fs: fsMock,
    });

    const metadata = {
      hasDockerfile: true,
      deploymentAttrs: {
        runtime: 'nodejs',
      },
    };

    assert.equal(deploymentHelpers.canDeployWithoutBuild(metadata), false);
  });

  test('createDirectSourceDeploymentContainer creates correct object without envVars', async () => {
    const deploymentHelpers = await esmock('../../lib/deployment/helpers.js', {
      fs: fsMock,
    });

    const input = {
      bucketName: 'test-bucket',
      fileName: 'source.tar.gz',
      deploymentAttrs: {
        cmd: ['node'],
        args: ['server.js'],
        baseImage: 'gcr.io/google-appengine/nodejs',
      },
    };

    const result =
      deploymentHelpers.createDirectSourceDeploymentContainer(input);

    assert.deepEqual(result, {
      image: DEPLOYMENT_CONFIG.NO_BUILD_IMAGE_TYPE,
      baseImageUri: 'gcr.io/google-appengine/nodejs',
      sourceCode: {
        cloudStorageSource: {
          bucket: 'test-bucket',
          object: 'source.tar.gz',
        },
      },
      command: ['node'],
      args: ['server.js'],
    });
  });

  test('createDirectSourceDeploymentContainer creates correct object with envVars', async () => {
    const deploymentHelpers = await esmock('../../lib/deployment/helpers.js', {
      fs: fsMock,
    });

    const input = {
      bucketName: 'test-bucket',
      fileName: 'source.tar.gz',
      deploymentAttrs: {
        cmd: ['node'],
        args: ['server.js'],
        baseImage: 'gcr.io/google-appengine/nodejs',
        envVars: {
          PORT: '8080',
          NODE_ENV: 'production',
        },
      },
    };

    const result =
      deploymentHelpers.createDirectSourceDeploymentContainer(input);

    assert.deepEqual(result, {
      image: DEPLOYMENT_CONFIG.NO_BUILD_IMAGE_TYPE,
      baseImageUri: 'gcr.io/google-appengine/nodejs',
      sourceCode: {
        cloudStorageSource: {
          bucket: 'test-bucket',
          object: 'source.tar.gz',
        },
      },
      command: ['node'],
      args: ['server.js'],
      env: [
        { name: 'PORT', value: '8080' },
        { name: 'NODE_ENV', value: 'production' },
      ],
    });
  });

  test('uploadDirectory recursively uploads files', async () => {
    const uploadToStorageBucketMock = mock.fn(async () => ({}));
    const readFileMock = mock.fn(async () => Buffer.from('content'));

    // Create a setup for each call to differentiate directory depth
    fsMock.promises.readdir.mock.resetCalls();
    fsMock.promises.readdir.mock.mockImplementation(async (p) => {
      if (p.endsWith('subdir')) {
        return [{ name: 'file2.txt', isDirectory: () => false }];
      }
      return [
        { name: 'file1.txt', isDirectory: () => false },
        { name: 'subdir', isDirectory: () => true },
      ];
    });

    const deploymentHelpers = await esmock('../../lib/deployment/helpers.js', {
      fs: {
        ...fsMock,
        promises: {
          ...fsMock.promises,
          readFile: readFileMock,
        },
        default: {
          ...fsMock,
          promises: {
            ...fsMock.promises,
            readFile: readFileMock,
          },
        },
      },
      '../../lib/cloud-api/storage.js': {
        uploadToStorageBucket: uploadToStorageBucketMock,
      },
    });

    const bucket = { name: 'test-bucket' };
    const localPath = '/local/path';
    const gcsPrefix = 'prefix';
    const progressCallback = mock.fn();

    await deploymentHelpers.uploadDirectory(
      bucket,
      localPath,
      gcsPrefix,
      progressCallback
    );

    assert.strictEqual(uploadToStorageBucketMock.mock.callCount(), 2);

    // Verify first upload (root level)
    const call1 = uploadToStorageBucketMock.mock.calls[0];
    assert.ok(call1.arguments[2].endsWith('prefix/file1.txt'));

    // Verify second upload (subdir level)
    const call2 = uploadToStorageBucketMock.mock.calls[1];
    assert.ok(call2.arguments[2].endsWith('prefix/subdir/file2.txt'));
  });

  test('makeFileDeploymentMetadata correctly identifies compose file in folder', async () => {
    const deploymentHelpers = await esmock('../../lib/deployment/helpers.js', {
      fs: fsMock,
    });

    const folderPath = '/absolute/path/to/folder';

    fsMock.statSync.mock.mockImplementation(() => ({
      isDirectory: () => true,
    }));

    fsMock.existsSync.mock.mockImplementation((filePath) => {
      if (filePath.endsWith('compose.yaml')) return true;
      return false;
    });

    const result = deploymentHelpers.makeFileDeploymentMetadata([folderPath]);

    assert.ok(result.composeFilePath.endsWith('compose.yaml'));
  });

  test('makeFileDeploymentMetadata correctly identifies compose file in file list', async () => {
    const deploymentHelpers = await esmock('../../lib/deployment/helpers.js', {
      fs: fsMock,
    });

    const files = ['src/main.js', 'docker-compose.yml'];

    fsMock.statSync.mock.mockImplementation(() => ({
      isDirectory: () => false,
    }));

    const result = deploymentHelpers.makeFileDeploymentMetadata(files);

    assert.strictEqual(result.composeFilePath, 'docker-compose.yml');
  });

  test('getServiceNameForComposeApp extracts name correctly', async () => {
    const yamlMock = {
      load: mock.fn(() => ({ name: 'my-compose-app' })),
    };
    const readFileSyncMock = mock.fn(() => 'name: my-compose-app');
    const deploymentHelpers = await esmock('../../lib/deployment/helpers.js', {
      fs: {
        ...fsMock,
        readFileSync: readFileSyncMock,
      },
      'js-yaml': yamlMock,
    });

    // Mock folder check
    fsMock.statSync.mock.mockImplementation(() => ({
      isDirectory: () => true,
    }));

    const result = deploymentHelpers.getServiceNameForComposeApp(
      ['/path'],
      '/path/compose.yaml'
    );
    assert.strictEqual(result, 'my-compose-app');
    assert.strictEqual(readFileSyncMock.mock.callCount(), 1);
  });

  test('getServiceNameForComposeApp returns default name if not in file', async () => {
    const yamlMock = {
      load: mock.fn(() => ({})),
    };
    const readFileSyncMock = mock.fn(() => 'services: {}');
    const deploymentHelpers = await esmock('../../lib/deployment/helpers.js', {
      fs: {
        ...fsMock,
        readFileSync: readFileSyncMock,
      },
      'js-yaml': yamlMock,
    });

    fsMock.statSync.mock.mockImplementation(() => ({
      isDirectory: () => true,
    }));

    const result = deploymentHelpers.getServiceNameForComposeApp(
      ['/path'],
      '/path/compose.yaml'
    );
    assert.ok(result.startsWith('composeApp-'));
    assert.strictEqual(result.length, 11 + 16); // "composeApp-" (11) + 8 bytes hex (16)
  });

  test('makeFileDeploymentMetadata correctly identifies compose file as an object', async () => {
    const deploymentHelpers = await esmock('../../lib/deployment/helpers.js', {
      fs: fsMock,
    });

    const files = [{ filename: 'compose.yaml', content: '...' }];

    fsMock.statSync.mock.mockImplementation(() => ({
      isDirectory: () => false,
    }));

    const result = deploymentHelpers.makeFileDeploymentMetadata(files);

    assert.strictEqual(result.composeFilePath, 'compose.yaml');
  });

  test('makeFileDeploymentMetadata returns null for composeFilePath if no compose file exists', async () => {
    const deploymentHelpers = await esmock('../../lib/deployment/helpers.js', {
      fs: fsMock,
    });

    const files = ['Dockerfile', 'index.js'];

    fsMock.statSync.mock.mockImplementation(() => ({
      isDirectory: () => false,
    }));

    const result = deploymentHelpers.makeFileDeploymentMetadata(files);

    assert.strictEqual(result.composeFilePath, null);
  });
});
