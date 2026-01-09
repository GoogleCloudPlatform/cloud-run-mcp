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
    readFileSync: mock.fn(),
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

  test('makeFileDeploymentMetadata correctly identifies Node.js project attributes', async () => {
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

    // Mock readFileSync for package.json
    fsMock.readFileSync.mock.mockImplementation(() =>
      JSON.stringify({
        scripts: { start: 'node server.js' },
      })
    );

    const result = deploymentHelpers.makeFileDeploymentMetadata([folderPath]);

    assert.equal(result.hasDockerfile, false);
    assert.equal(result.deploymentAttrs.runtime, 'nodejs');
    assert.deepEqual(result.deploymentAttrs.cmd, ['node']);
    assert.deepEqual(result.deploymentAttrs.args, ['server.js']);
  });

  test('makeFileDeploymentMetadata ignores Node.js if engines.node is present', async () => {
    const deploymentHelpers = await esmock('../../lib/deployment/helpers.js', {
      fs: fsMock,
    });

    const folderPath = '/absolute/path/to/node-app-engines';

    fsMock.statSync.mock.mockImplementation(() => ({
      isDirectory: () => true,
    }));

    fsMock.existsSync.mock.mockImplementation((p) => {
      if (p.endsWith('package.json')) return true;
      return false;
    });

    fsMock.readFileSync.mock.mockImplementation(() =>
      JSON.stringify({
        scripts: { start: 'node server.js' },
        engines: { node: '>=14' },
      })
    );

    const result = deploymentHelpers.makeFileDeploymentMetadata([folderPath]);

    assert.equal(result.deploymentAttrs.runtime, undefined);
  });

  test('makeFileDeploymentMetadata handles invalid package.json gracefully', async () => {
    const deploymentHelpers = await esmock('../../lib/deployment/helpers.js', {
      fs: fsMock,
    });

    const folderPath = '/absolute/path/to/bad-json-app';

    fsMock.statSync.mock.mockImplementation(() => ({
      isDirectory: () => true,
    }));

    fsMock.existsSync.mock.mockImplementation((p) => {
      if (p.endsWith('package.json')) return true;
      return false;
    });

    // Mock readFileSync to return invalid JSON
    fsMock.readFileSync.mock.mockImplementation(() => '{ invalid json }');

    const result = deploymentHelpers.makeFileDeploymentMetadata([folderPath]);

    // Should return empty deployment attrs
    assert.equal(result.deploymentAttrs.runtime, undefined);
  });

  test('checkIfZipDeploymentFeasible returns true for valid Node.js zip deploy', async () => {
    const deploymentHelpers = await esmock('../../lib/deployment/helpers.js', {
      fs: fsMock,
    });

    const metadata = {
      hasDockerfile: false,
      deploymentAttrs: {
        runtime: 'nodejs',
        cmd: ['node'],
        args: ['index.js'],
        baseImage: 'base-image',
      },
    };

    assert.equal(
      deploymentHelpers.checkIfZipDeploymentFeasible(metadata),
      true
    );
  });

  test('checkIfZipDeploymentFeasible returns false if Dockerfile exists', async () => {
    const deploymentHelpers = await esmock('../../lib/deployment/helpers.js', {
      fs: fsMock,
    });

    const metadata = {
      hasDockerfile: true,
      deploymentAttrs: {
        runtime: 'nodejs',
        cmd: ['node'],
        args: ['index.js'],
      },
    };

    assert.equal(
      deploymentHelpers.checkIfZipDeploymentFeasible(metadata),
      false
    );
  });

  test('createDirectSourceDeploymentContainer creates correct object', async () => {
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
      image: DEPLOYMENT_CONFIG.NO_BUILD_IMAGE_TAG,
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

  test('makeFileDeploymentMetadata handles invalid package.json gracefully', async () => {
    const deploymentHelpers = await esmock('../../lib/deployment/helpers.js', {
      fs: fsMock,
    });

    const folderPath = '/absolute/path/to/bad-json-app';

    fsMock.statSync.mock.mockImplementation(() => ({
      isDirectory: () => true,
    }));

    fsMock.existsSync.mock.mockImplementation((p) => {
      if (p.endsWith('package.json')) return true;
      return false;
    });

    // Mock readFileSync to return invalid JSON
    fsMock.readFileSync.mock.mockImplementation(() => '{ invalid json }');

    const result = deploymentHelpers.makeFileDeploymentMetadata([folderPath]);

    // Should return empty deployment attrs
    assert.equal(result.deploymentAttrs.runtime, undefined);
  });
});
