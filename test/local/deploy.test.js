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
import path from 'path';

describe('Deploy Compose', () => {
  const projectId = 'test-project';
  const region = 'us-central1';
  const accessToken = 'test-token';
  const composeFilePath = '/abs/path/to/compose.yaml';
  const files = [path.dirname(composeFilePath)];

  test('successfully deploys a simple compose file with one source-built service', async () => {
    // Setup mocks
    const prepareSourceDirectoryMock = mock.fn(async () => '/tmp/temp-dir');
    const getProjectNumberMock = mock.fn(async () => '123456789');
    const downloadRunComposeMock = mock.fn(
      async () => '/usr/local/bin/run-compose'
    );
    const resourceComposeMock = mock.fn(async () =>
      JSON.stringify({
        source_builds: {
          web: { context: 'app' },
        },
      })
    );
    const translateComposeMock = mock.fn(async () =>
      JSON.stringify({
        services: {
          web: 'web.yaml',
        },
      })
    );
    const triggerCloudBuildMock = mock.fn(async () => ({
      results: {
        images: [
          {
            name: 'us-central1-docker.pkg.dev/test-project/mcp-cloud-run-deployments/web:latest',
          },
        ],
      },
    }));
    const ensureArtifactRegistryRepoExistsMock = mock.fn();
    const ensureStorageBucketExistsMock = mock.fn(async () => ({}));
    const uploadToStorageBucketMock = mock.fn();
    const zipFilesMock = mock.fn(async () => Buffer.from('dummy zip content'));
    const cleanupTempDirectoryMock = mock.fn();
    const getRunV1ClientMock = mock.fn(async () => ({
      namespaces: {
        services: {
          replaceService: mock.fn(async () => ({
            data: { metadata: { name: 'web' } },
          })),
          create: mock.fn(),
        },
      },
    }));
    const fsMock = {
      existsSync: mock.fn(() => true),
      readFileSync: mock.fn(() => 'name: web\nmetadata:\n  name: web'),
      promises: {
        mkdtemp: mock.fn(async () => '/tmp/random-dir'),
      },
    };
    const logAndProgressMock = mock.fn();

    // Import with mocks
    const { deployCompose } = await esmock('../../lib/deployment/deployer.js', {
      '../../lib/deployment/source-processor.js': {
        prepareSourceDirectory: prepareSourceDirectoryMock,
        cleanupTempDirectory: cleanupTempDirectoryMock,
      },
      '../../lib/util/helpers.js': {
        getProjectNumber: getProjectNumberMock,
        logAndProgress: logAndProgressMock,
      },
      '../../lib/deployment/compose.js': {
        runCompose: downloadRunComposeMock,
        resourceCompose: resourceComposeMock,
        translateCompose: translateComposeMock,
      },
      '../../lib/cloud-api/build.js': {
        triggerCloudBuild: triggerCloudBuildMock,
      },
      '../../lib/cloud-api/registry.js': {
        ensureArtifactRegistryRepoExists: ensureArtifactRegistryRepoExistsMock,
      },
      '../../lib/util/archive.js': {
        zipFiles: zipFilesMock,
      },
      '../../lib/cloud-api/storage.js': {
        ensureStorageBucketExists: ensureStorageBucketExistsMock,
        uploadToStorageBucket: uploadToStorageBucketMock,
      },
      '../../lib/clients.js': {
        getRunV1Client: getRunV1ClientMock,
      },
      fs: fsMock,
      path: path,
    });

    const result = await deployCompose({
      projectId,
      region,
      files,
      composeFilePath,
      accessToken,
      progressCallback: logAndProgressMock,
    });

    // Validations
    assert.ok(result);
    assert.equal(result.message, '1 services deployed from compose file');
    assert.equal(prepareSourceDirectoryMock.mock.callCount(), 1);
    assert.equal(resourceComposeMock.mock.callCount(), 1);
    assert.equal(translateComposeMock.mock.callCount(), 1);
    assert.equal(triggerCloudBuildMock.mock.callCount(), 1);
    assert.equal(cleanupTempDirectoryMock.mock.callCount(), 1);

    // Verify triggerCloudBuild was called with correctly updated image tag
    const buildCall = triggerCloudBuildMock.mock.calls[0];
    assert.equal(
      buildCall.arguments[5],
      'us-central1-docker.pkg.dev/test-project/mcp-cloud-run-deployments/web:latest'
    );
  });

  test('failure in prepareSourceDirectory triggers cleanup and rethrows', async () => {
    const error = new Error('Preparation failed');
    const prepareSourceDirectoryMock = mock.fn(async () => {
      throw error;
    });
    const logAndProgressMock = mock.fn();
    const cleanupTempDirectoryMock = mock.fn();

    const { deployCompose } = await esmock('../../lib/deployment/deployer.js', {
      '../../lib/deployment/source-processor.js': {
        prepareSourceDirectory: prepareSourceDirectoryMock,
        cleanupTempDirectory: cleanupTempDirectoryMock,
      },
      '../../lib/util/helpers.js': {
        logAndProgress: logAndProgressMock,
      },
    });

    await assert.rejects(
      deployCompose({
        projectId,
        region,
        files,
        composeFilePath,
        accessToken,
        progressCallback: logAndProgressMock,
      }),
      error
    );

    assert.equal(
      logAndProgressMock.mock.calls.some(
        (call) => call.arguments[2] === 'error'
      ),
      true
    );
  });
});
