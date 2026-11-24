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

import crypto from 'node:crypto';
import path from 'node:path';
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

  test('createDirectSourceDeploymentContainer pins generation as string when provided', async () => {
    const deploymentHelpers = await esmock('../../lib/deployment/helpers.js', {
      fs: fsMock,
    });

    const input = {
      bucketName: 'test-bucket',
      fileName: 'source/1700000000-deadbeef-1234567890abcdef.tar.gz',
      generation: 9007199254740993n,
      deploymentAttrs: {
        cmd: ['node'],
        args: ['server.js'],
        baseImage: 'nodejs22',
      },
    };

    const result =
      deploymentHelpers.createDirectSourceDeploymentContainer(input);

    assert.deepEqual(result.sourceCode.cloudStorageSource, {
      bucket: 'test-bucket',
      object: 'source/1700000000-deadbeef-1234567890abcdef.tar.gz',
      generation: '9007199254740993',
    });

    const emptyGenResult =
      deploymentHelpers.createDirectSourceDeploymentContainer({
        ...input,
        generation: '   ',
      });
    assert.deepEqual(emptyGenResult.sourceCode.cloudStorageSource, {
      bucket: 'test-bucket',
      object: 'source/1700000000-deadbeef-1234567890abcdef.tar.gz',
    });
  });

  test('generateStagingArchiveName includes content hash and unique random nonce', async () => {
    const deploymentHelpers = await esmock('../../lib/deployment/helpers.js', {
      fs: fsMock,
    });

    const archiveBuffer = Buffer.from('sample source archive content');
    const expectedHash = crypto
      .createHash('sha256')
      .update(archiveBuffer)
      .digest('hex');

    const zipName1 = deploymentHelpers.generateStagingArchiveName(
      archiveBuffer,
      'zip'
    );
    const zipName2 = deploymentHelpers.generateStagingArchiveName(
      archiveBuffer,
      'zip'
    );
    const targzName = deploymentHelpers.generateStagingArchiveName(
      archiveBuffer,
      '.tar.gz'
    );

    assert.match(
      zipName1,
      new RegExp(`^source/\\d+-${expectedHash}-[0-9a-f]{16}\\.zip$`)
    );
    assert.notEqual(zipName1, zipName2);
    assert.match(
      targzName,
      new RegExp(`^source/\\d+-${expectedHash}-[0-9a-f]{16}\\.tar\\.gz$`)
    );
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
    assert.strictEqual(call1.arguments[3], undefined);
    assert.strictEqual(call1.arguments[4], progressCallback);

    // Verify second upload (subdir level)
    const call2 = uploadToStorageBucketMock.mock.calls[1];
    assert.ok(call2.arguments[2].endsWith('prefix/subdir/file2.txt'));
    assert.strictEqual(call2.arguments[3], undefined);
    assert.strictEqual(call2.arguments[4], progressCallback);
  });

  test('uploadDirectory rejects symlinks resolving outside rootDir', async () => {
    const fsReal = await import('fs');
    const os = await import('os');
    const uploadToStorageBucketMock = mock.fn(async () => ({}));

    const tmpRoot = await fsReal.promises.mkdtemp(
      path.join(os.tmpdir(), 'cloud-run-mcp-upload-test-')
    );
    const projectDir = path.join(tmpRoot, 'project');
    const dataDir = path.join(projectDir, 'data');
    const outsideFile = path.join(tmpRoot, 'secret.txt');
    await fsReal.promises.mkdir(dataDir, { recursive: true });
    await fsReal.promises.writeFile(outsideFile, 'top-secret');
    await fsReal.promises.symlink(outsideFile, path.join(dataDir, 'leak.txt'));

    try {
      const deploymentHelpers = await esmock(
        '../../lib/deployment/helpers.js',
        {
          '../../lib/cloud-api/storage.js': {
            uploadToStorageBucket: uploadToStorageBucketMock,
          },
        }
      );

      await assert.rejects(
        deploymentHelpers.uploadDirectory(
          { name: 'test-bucket' },
          dataDir,
          'bind_mounts/web/data',
          mock.fn(),
          projectDir
        ),
        /symlink resolving outside the project directory/
      );
      assert.strictEqual(uploadToStorageBucketMock.mock.callCount(), 0);
    } finally {
      await fsReal.promises.rm(tmpRoot, { recursive: true, force: true });
    }
  });

  test('uploadDirectory allows symlinks resolving inside rootDir', async () => {
    const fsReal = await import('fs');
    const os = await import('os');
    const uploadToStorageBucketMock = mock.fn(async () => ({}));

    const tmpRoot = await fsReal.promises.mkdtemp(
      path.join(os.tmpdir(), 'cloud-run-mcp-upload-ok-')
    );
    const projectDir = path.join(tmpRoot, 'project');
    const dataDir = path.join(projectDir, 'data');
    const sharedFile = path.join(projectDir, 'shared.txt');
    await fsReal.promises.mkdir(dataDir, { recursive: true });
    await fsReal.promises.writeFile(sharedFile, 'shared-content');
    await fsReal.promises.symlink(sharedFile, path.join(dataDir, 'linked.txt'));

    try {
      const deploymentHelpers = await esmock(
        '../../lib/deployment/helpers.js',
        {
          '../../lib/cloud-api/storage.js': {
            uploadToStorageBucket: uploadToStorageBucketMock,
          },
        }
      );

      await deploymentHelpers.uploadDirectory(
        { name: 'test-bucket' },
        dataDir,
        'bind_mounts/web/data',
        mock.fn(),
        projectDir
      );
      assert.strictEqual(uploadToStorageBucketMock.mock.callCount(), 1);
      assert.strictEqual(
        uploadToStorageBucketMock.mock.calls[0].arguments[2],
        'bind_mounts/web/data/linked.txt'
      );
    } finally {
      await fsReal.promises.rm(tmpRoot, { recursive: true, force: true });
    }
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
