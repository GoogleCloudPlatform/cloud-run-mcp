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
      promises: {
        mkdtemp: mock.fn(async () => '/tmp/random-dir'),
        readFile: mock.fn(async () => 'name: web'),
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
        composeVolumes: mock.fn(async (resourcesConfig) => resourcesConfig),
      },
      '../../lib/cloud-api/build.js': {
        triggerCloudBuild: triggerCloudBuildMock,
        composeBuild: mock.fn(
          async (resourcesConfig, token, pId, reg, fPath, cb) => {
            for (const serviceName in resourcesConfig.source_builds) {
              const imageUrl = `${reg}-docker.pkg.dev/${pId}/mcp-cloud-run-deployments/${serviceName}:latest`;
              const buildResult = await triggerCloudBuildMock(
                pId,
                reg,
                'bucket',
                'blob',
                'repo',
                imageUrl,
                true,
                token,
                cb
              );
              resourcesConfig.source_builds[serviceName].image_id =
                buildResult.results.images[0].name;
            }
            return resourcesConfig;
          }
        ),
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

  test('calls composeSecrets during deployment', async () => {
    const composeSecretsMock = mock.fn(
      async (resourcesConfig) => resourcesConfig
    );
    const prepareSourceDirectoryMock = mock.fn(async () => '/tmp/temp-dir');
    const downloadRunComposeMock = mock.fn(async () => '/bin/run-compose');
    const resourceComposeMock = mock.fn(async () => JSON.stringify({}));
    const translateComposeMock = mock.fn(async () =>
      JSON.stringify({ services: {} })
    );
    const getProjectNumberMock = mock.fn(async () => '123456');
    const cleanupTempDirectoryMock = mock.fn();

    const { deployCompose } = await esmock('../../lib/deployment/deployer.js', {
      '../../lib/deployment/source-processor.js': {
        prepareSourceDirectory: prepareSourceDirectoryMock,
        cleanupTempDirectory: cleanupTempDirectoryMock,
      },
      '../../lib/util/helpers.js': {
        getProjectNumber: getProjectNumberMock,
        logAndProgress: mock.fn(),
      },
      '../../lib/deployment/compose.js': {
        runCompose: downloadRunComposeMock,
        resourceCompose: resourceComposeMock,
        translateCompose: translateComposeMock,
        composeVolumes: mock.fn(async (resourcesConfig) => resourcesConfig),
        composeSecrets: composeSecretsMock,
      },
      '../../lib/clients.js': {
        getRunV1Client: mock.fn(async () => ({ namespaces: { services: {} } })),
      },
      fs: {
        promises: {
          readFile: mock.fn(async () => 'name: web'),
        },
      },
      path: path,
    });

    await deployCompose({
      projectId,
      region,
      files,
      composeFilePath,
      accessToken,
      progressCallback: mock.fn(),
    });

    assert.strictEqual(composeSecretsMock.mock.callCount(), 1);
  });

  test('successfully deploys models and services in correct order', async () => {
    const prepareSourceDirectoryMock = mock.fn(async () => '/tmp/temp-dir');
    const getProjectNumberMock = mock.fn(async () => '123456');
    const downloadRunComposeMock = mock.fn(async () => '/bin/run-compose');
    const resourceComposeMock = mock.fn(async () => JSON.stringify({}));
    const translateComposeMock = mock.fn(async () =>
      JSON.stringify({
        models: { 'my-model': 'model.yaml' },
        services: { 'my-app': 'app.yaml' },
      })
    );

    const deployedServices = [];
    const replaceServiceMock = mock.fn(async (params) => {
      // Extract service name from namespaces/{p}/services/{s}
      const serviceName = params.name.split('/').pop();
      deployedServices.push(serviceName);
      return { data: { status: { url: `https://${serviceName}.a.run.app` } } };
    });

    const getRunV1ClientMock = mock.fn(async () => ({
      namespaces: {
        services: {
          replaceService: replaceServiceMock,
        },
      },
    }));

    const { deployCompose } = await esmock('../../lib/deployment/deployer.js', {
      '../../lib/deployment/source-processor.js': {
        prepareSourceDirectory: prepareSourceDirectoryMock,
        cleanupTempDirectory: mock.fn(),
      },
      '../../lib/util/helpers.js': {
        getProjectNumber: getProjectNumberMock,
        logAndProgress: mock.fn(),
      },
      '../../lib/deployment/compose.js': {
        runCompose: downloadRunComposeMock,
        resourceCompose: resourceComposeMock,
        translateCompose: translateComposeMock,
        composeVolumes: mock.fn(async (resourcesConfig) => resourcesConfig),
        composeSecrets: mock.fn(async (resourcesConfig) => resourcesConfig),
      },
      '../../lib/clients.js': {
        getRunV1Client: getRunV1ClientMock,
      },
      fs: {
        promises: {
          readFile: mock.fn(async () => 'name: dummy'),
        },
      },
      path: path,
    });

    const result = await deployCompose({
      projectId,
      region,
      files,
      composeFilePath,
      accessToken,
      progressCallback: mock.fn(),
    });

    assert.ok(result);
    assert.strictEqual(result.message, '2 services deployed from compose file');
    assert.strictEqual(deployedServices.length, 2);
    // Verify order: models first
    assert.strictEqual(deployedServices[0], 'my-model');
    assert.strictEqual(deployedServices[1], 'my-app');
  });

  test('sanitizes service names with underscores', async () => {
    const rawServiceName = 'ai-model-test_web';
    const sanitizedName = 'ai-model-test-web';

    const prepareSourceDirectoryMock = mock.fn(async () => '/tmp/temp-dir');
    const getProjectNumberMock = mock.fn(async () => '123456');
    const downloadRunComposeMock = mock.fn(async () => '/bin/run-compose');
    const translateComposeMock = mock.fn(async () =>
      JSON.stringify({
        services: { [rawServiceName]: 'web.yaml' },
      })
    );

    const replaceServiceMock = mock.fn(async (params) => {
      return { data: { metadata: { name: params.name.split('/').pop() } } };
    });

    const { deployCompose } = await esmock('../../lib/deployment/deployer.js', {
      '../../lib/deployment/source-processor.js': {
        prepareSourceDirectory: prepareSourceDirectoryMock,
        cleanupTempDirectory: mock.fn(),
      },
      '../../lib/util/helpers.js': {
        getProjectNumber: getProjectNumberMock,
        logAndProgress: mock.fn(),
        sanitizeCloudRunServiceName: (name) =>
          name
            .toLowerCase()
            .replace(/[^a-z0-9]/g, '-')
            .replace(/^-+|-+$/g, ''),
      },
      '../../lib/deployment/compose.js': {
        runCompose: downloadRunComposeMock,
        resourceCompose: mock.fn(async () => JSON.stringify({})),
        translateCompose: translateComposeMock,
        composeVolumes: mock.fn(async (resourcesConfig) => resourcesConfig),
        composeSecrets: mock.fn(async (resourcesConfig) => resourcesConfig),
      },
      '../../lib/cloud-api/build.js': {
        composeBuild: mock.fn(async (rc) => rc),
      },
      '../../lib/clients.js': {
        getRunV1Client: mock.fn(async () => ({
          namespaces: { services: { replaceService: replaceServiceMock } },
        })),
      },
      fs: {
        promises: {
          readFile: mock.fn(async () => 'metadata:\n  name: ai-model-test_web'),
        },
      },
      path: path,
    });

    await deployCompose({
      projectId,
      region,
      files,
      composeFilePath,
      accessToken,
      progressCallback: mock.fn(),
    });

    assert.strictEqual(replaceServiceMock.mock.callCount(), 1);
    const call = replaceServiceMock.mock.calls[0];

    // Verify name in URL was sanitized
    assert.strictEqual(
      call.arguments[0].name,
      `namespaces/${projectId}/services/${sanitizedName}`
    );

    // Verify name in requestBody metadata was sanitized
    assert.strictEqual(
      call.arguments[0].requestBody.metadata.name,
      sanitizedName
    );
  });
});
