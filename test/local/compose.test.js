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

import { test, describe, mock, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import esmock from 'esmock';
import path from 'path';

describe('Compose Deployment', () => {
  const osMock = {
    homedir: () => '/home/user',
  };

  const helpersMock = {
    logAndProgress: mock.fn(),
  };

  const artifactsMock = {
    ensureRepositoryDownloaded: mock.fn(),
  };

  const childProcessMock = {
    execFile: mock.fn(),
  };

  test('runCompose successfully ensures download', async () => {
    artifactsMock.ensureRepositoryDownloaded.mock.resetCalls();
    artifactsMock.ensureRepositoryDownloaded.mock.mockImplementation(
      () => '/home/user/.cloud-run-mcp/bin/run-compose'
    );

    const compose = await esmock('../../lib/deployment/compose.js', {
      os: osMock,
      '../../lib/util/helpers.js': helpersMock,
      '../../lib/util/artifacts.js': artifactsMock,
    });

    try {
      const result = await compose.runCompose('fake-token', mock.fn());

      assert.strictEqual(result, '/home/user/.cloud-run-mcp/bin/run-compose');
      assert.strictEqual(
        artifactsMock.ensureRepositoryDownloaded.mock.callCount(),
        1
      );

      // Verify parameters passed to ensureRepositoryDownloaded
      const call = artifactsMock.ensureRepositoryDownloaded.mock.calls[0];
      assert.strictEqual(
        call.arguments[0],
        '/home/user/.cloud-run-mcp/bin/run-compose'
      );
      assert.strictEqual(call.arguments[1].project, 'test-project-123456');
      assert.strictEqual(call.arguments[1].location, 'us-west1');
      assert.strictEqual(call.arguments[1].repository, 'run-compose');
      assert.strictEqual(call.arguments[2], 'fake-token');
    } finally {
      // No need to restore env since we didn't use it
    }
  });

  test('runCompose returns null if download fails', async () => {
    artifactsMock.ensureRepositoryDownloaded.mock.resetCalls();
    artifactsMock.ensureRepositoryDownloaded.mock.mockImplementation(
      () => null
    );

    const compose = await esmock('../../lib/deployment/compose.js', {
      os: osMock,
      '../../lib/util/helpers.js': helpersMock,
      '../../lib/util/artifacts.js': artifactsMock,
    });

    const result = await compose.runCompose('fake-token', mock.fn());

    assert.strictEqual(result, null);
    assert.strictEqual(
      artifactsMock.ensureRepositoryDownloaded.mock.callCount(),
      1
    );
  });

  test('runCompose returns null if platform not supported', async () => {
    // Save original platform
    const originalPlatform = process.platform;
    Object.defineProperty(process, 'platform', {
      value: 'win32',
      configurable: true,
    });

    try {
      const compose = await esmock('../../lib/deployment/compose.js', {
        os: osMock,
        '../../lib/util/helpers.js': helpersMock,
        '../../lib/util/artifacts.js': artifactsMock,
      });

      const result = await compose.runCompose('fake-token', mock.fn());
      assert.strictEqual(result, null);
    } finally {
      Object.defineProperty(process, 'platform', {
        value: originalPlatform,
        configurable: true,
      });
    }
  });

  test('resourceCompose returns stdout on success', async () => {
    childProcessMock.execFile.mock.resetCalls();
    childProcessMock.execFile.mock.mockImplementation(
      (file, args, opts, cb) => {
        if (typeof opts === 'function') {
          cb = opts;
        }
        cb(null, { stdout: '{"resources": []}', stderr: '' });
      }
    );

    const compose = await esmock('../../lib/deployment/compose.js', {
      child_process: childProcessMock,
      '../../lib/util/helpers.js': helpersMock,
    });

    const result = await compose.resourceCompose(
      '/bin/run-compose',
      '/path/to/compose.yaml',
      'us-central1',
      mock.fn()
    );

    assert.strictEqual(result, '{"resources": []}');
    assert.strictEqual(childProcessMock.execFile.mock.callCount(), 1);
    const call = childProcessMock.execFile.mock.calls[0];
    assert.strictEqual(call.arguments[0], '/bin/run-compose');
    assert.deepEqual(call.arguments[1], [
      'resource',
      '/path/to/compose.yaml',
      '--region',
      'us-central1',
      '--out',
      '.',
    ]);
    assert.strictEqual(call.arguments[2].cwd, '/path/to');
  });

  test('resourceCompose logs warning on stderr but returns stdout', async () => {
    childProcessMock.execFile.mock.resetCalls();
    helpersMock.logAndProgress.mock.resetCalls();
    childProcessMock.execFile.mock.mockImplementation(
      (file, args, opts, cb) => {
        if (typeof opts === 'function') {
          cb = opts;
        }
        cb(null, { stdout: 'output', stderr: 'some warning' });
      }
    );

    const compose = await esmock('../../lib/deployment/compose.js', {
      child_process: childProcessMock,
      '../../lib/util/helpers.js': helpersMock,
    });

    const result = await compose.resourceCompose(
      '/bin/run-compose',
      '/path/to/compose.yaml',
      'us-central1',
      mock.fn()
    );

    assert.strictEqual(result, 'output');
    // Verify logAndProgress was called with warn for stderr
    const warnCall = helpersMock.logAndProgress.mock.calls.find(
      (c) => c.arguments[2] === 'warn'
    );
    assert.ok(warnCall);
    assert.ok(warnCall.arguments[0].includes('some warning'));
  });

  test('resourceCompose throws error if execFile fails', async () => {
    childProcessMock.execFile.mock.resetCalls();
    childProcessMock.execFile.mock.mockImplementation(
      (file, args, opts, cb) => {
        if (typeof opts === 'function') {
          cb = opts;
        }
        cb(new Error('execFile failed'), { stdout: '', stderr: '' });
      }
    );

    const compose = await esmock('../../lib/deployment/compose.js', {
      child_process: childProcessMock,
      '../../lib/util/helpers.js': helpersMock,
    });

    await assert.rejects(
      compose.resourceCompose(
        '/bin/run-compose',
        '/path/to/compose.yaml',
        'us-central1',
        mock.fn()
      ),
      {
        message: /Failed to get resources for compose file: execFile failed/,
      }
    );
  });

  test('translateCompose returns stdout on success', async () => {
    childProcessMock.execFile.mock.resetCalls();
    childProcessMock.execFile.mock.mockImplementation(
      (file, args, opts, cb) => {
        if (typeof opts === 'function') {
          cb = opts;
        }
        cb(null, { stdout: 'translated output', stderr: '' });
      }
    );

    const compose = await esmock('../../lib/deployment/compose.js', {
      child_process: childProcessMock,
      '../../lib/util/helpers.js': helpersMock,
    });

    const result = await compose.translateCompose(
      '/bin/run-compose',
      '/path/to/compose.yaml',
      'us-central1',
      '123456789',
      mock.fn()
    );

    assert.strictEqual(result, 'translated output');
    assert.strictEqual(childProcessMock.execFile.mock.callCount(), 1);
    const call = childProcessMock.execFile.mock.calls[0];
    assert.strictEqual(call.arguments[0], '/bin/run-compose');
    assert.strictEqual(call.arguments[1][0], 'translate');
    assert.strictEqual(call.arguments[1][1], '/path/to/compose.yaml');
    assert.strictEqual(call.arguments[1][7], '.'); // Currently it's '.'
    assert.strictEqual(call.arguments[2].cwd, '/path/to');
  });

  test('translateCompose handles resourcesConfig', async () => {
    childProcessMock.execFile.mock.resetCalls();
    childProcessMock.execFile.mock.mockImplementation(
      (file, args, opts, cb) => {
        if (typeof opts === 'function') {
          cb = opts;
        }
        cb(null, { stdout: 'translated output with config', stderr: '' });
      }
    );

    const compose = await esmock('../../lib/deployment/compose.js', {
      child_process: childProcessMock,
      '../../lib/util/helpers.js': helpersMock,
    });

    const resourcesConfig = { some: 'config' };
    const result = await compose.translateCompose(
      '/bin/run-compose',
      '/path/to/compose.yaml',
      'us-central1',
      '123456789',
      mock.fn(),
      resourcesConfig
    );

    assert.strictEqual(result, 'translated output with config');
    const call = childProcessMock.execFile.mock.calls[0];
    const args = call.arguments[1];
    assert.ok(args.includes('--resources-config'));
    assert.ok(args.includes(JSON.stringify(resourcesConfig)));
  });

  test('translateCompose throws error if execFile fails', async () => {
    childProcessMock.execFile.mock.resetCalls();
    childProcessMock.execFile.mock.mockImplementation(
      (file, args, opts, cb) => {
        if (typeof opts === 'function') {
          cb = opts;
        }
        cb(new Error('translation failed'), { stdout: '', stderr: '' });
      }
    );

    const compose = await esmock('../../lib/deployment/compose.js', {
      child_process: childProcessMock,
      '../../lib/util/helpers.js': helpersMock,
    });

    await assert.rejects(
      compose.translateCompose(
        '/bin/run-compose',
        '/path/to/compose.yaml',
        'us-central1',
        '123456789',
        mock.fn()
      ),
      {
        message: /Failed to translate compose file: translation failed/,
      }
    );
  });

  describe('composeVolumes', () => {
    const getProjectNumberMock = mock.fn(async () => '987654321');
    const ensureStorageBucketExistsMock = mock.fn(async () => ({
      name: 'mock-bucket',
    }));
    const uploadToStorageBucketMock = mock.fn(async () => ({}));
    const uploadDirectoryMock = mock.fn(async () => {});
    const grantBucketAccessMock = mock.fn(async () => { });
    const fsMock = {};
    const fsPromisesMock = {
      access: mock.fn(async () => {}),
      stat: mock.fn(async () => ({ isDirectory: () => true })),
      readFile: mock.fn(async () => Buffer.from('file-content')),
    };

    beforeEach(() => {
      getProjectNumberMock.mock.resetCalls();
      ensureStorageBucketExistsMock.mock.resetCalls();
      uploadToStorageBucketMock.mock.resetCalls();
      uploadDirectoryMock.mock.resetCalls();
      grantBucketAccessMock.mock.resetCalls();
    });

    const setupCompose = async () => {
      return await esmock('../../lib/deployment/compose.js', {
        '../../lib/util/helpers.js': {
          ...helpersMock,
          getProjectNumber: getProjectNumberMock,
        },
        '../../lib/cloud-api/storage.js': {
          ensureStorageBucketExists: ensureStorageBucketExistsMock,
          uploadToStorageBucket: uploadToStorageBucketMock,
          grantBucketAccess: grantBucketAccessMock,
        },
        '../../lib/deployment/helpers.js': {
          uploadDirectory: uploadDirectoryMock,
        },
        fs: {
          ...fsMock,
          promises: fsPromisesMock,
          default: {
            ...fsMock,
            promises: fsPromisesMock,
          },
        },
        path: {
          ...path,
          resolve: (...args) => path.resolve(...args),
          relative: (from, to) => path.relative(from, to),
          basename: (p) => path.basename(p),
        },
      });
    };

    test('should return resourcesConfig unchanged if no volumes present', async () => {
      const compose = await setupCompose();
      const resourcesConfig = { project: 'test-project' };
      const result = await compose.composeVolumes(
        resourcesConfig,
        'token',
        'project-id',
        'us-central1',
        '/f-path',
        mock.fn()
      );
      assert.deepEqual(result, resourcesConfig);
    });

    test('should handle bind mounts (directories)', async () => {
      const compose = await setupCompose();
      const resourcesConfig = {
        project: 'my-project',
        volumes: {
          bind_mount: {
            web: [{ source: './data', target: '/app/data' }],
          },
        },
      };

      fsPromisesMock.access.mock.mockImplementation(async () => {});
      fsPromisesMock.stat.mock.mockImplementation(async () => ({
        isDirectory: () => true,
      }));

      const result = await compose.composeVolumes(
        resourcesConfig,
        'token',
        'project-id',
        'us-central1',
        '/app-dir',
        mock.fn()
      );

      assert.ok(result.volumes.bucket_name);
      assert.ok(
        result.volumes.bind_mount.web[0].mount_source.includes(
          'bind_mounts/web/data'
        )
      );
      assert.strictEqual(uploadDirectoryMock.mock.callCount(), 1);
      // Called once in handleBindMounts
      assert.strictEqual(ensureStorageBucketExistsMock.mock.callCount(), 1);
      assert.strictEqual(grantBucketAccessMock.mock.callCount(), 1);
      // Called once in composeVolumes (for naming) and once in handleBindMounts (for IAM)
      assert.strictEqual(getProjectNumberMock.mock.callCount(), 2);
    });

    test('should handle long project names with hashing', async () => {
      const compose = await setupCompose();
      const longProjectName =
        'very-long-project-name-that-exceeds-the-maximum-limit-for-bucket-names';
      const resourcesConfig = {
        project: longProjectName,
        volumes: {
          bind_mount: {
            web: [{ source: './data' }],
          },
        },
      };

      const result = await compose.composeVolumes(
        resourcesConfig,
        'token',
        'project-id',
        'us-central1',
        '/app-dir',
        mock.fn()
      );

      const bucketName = result.volumes.bucket_name;
      assert.ok(bucketName.length <= 63);
      // Verify hashing (the first digits are project number, then hash)
      assert.ok(bucketName.startsWith('987654321-'));
      assert.ok(bucketName.endsWith('-us-central1-compose'));
    });

    test('should handle named volumes', async () => {
      const compose = await setupCompose();
      ensureStorageBucketExistsMock.mock.resetCalls();
      const resourcesConfig = {
        project: 'my-project',
        volumes: {
          named_volume: {
            'my-vol': { name: 'my-vol' },
          },
        },
      };

      await compose.composeVolumes(
        resourcesConfig,
        'token',
        'project-id',
        'us-central1',
        '/app-dir',
        mock.fn()
      );

      // Should call ensureStorageBucketExists for the default bucketName
      const calls = ensureStorageBucketExistsMock.mock.calls;
      assert.strictEqual(calls.length, 1);
      // Bucket name is constructed from project number, sanitized name, region, and suffix
      const bucketName = calls[0].arguments[1];
      assert.ok(bucketName.startsWith('987654321-my-project-us-central1-compose'));
    });
  });

  describe('composeSecrets', () => {
    const getProjectNumberMock = mock.fn(async () => '123456789');
    const ensureApisEnabledMock = mock.fn(async () => {});
    const getSecretMock = mock.fn();
    const createSecretMock = mock.fn();
    const addSecretAccessorBindingMock = mock.fn();
    const addSecretVersionMock = mock.fn();
    const fsPromisesMock = {
      access: mock.fn(async () => {}),
      readFile: mock.fn(async () => Buffer.from('secret-data')),
    };

    const setupCompose = async () => {
      return await esmock('../../lib/deployment/compose.js', {
        '../../lib/util/helpers.js': {
          ...helpersMock,
          getProjectNumber: getProjectNumberMock,
        },
        '../../lib/cloud-api/helpers.js': {
          ensureApisEnabled: ensureApisEnabledMock,
        },
        '../../lib/cloud-api/secrets.js': {
          getSecret: getSecretMock,
          createSecret: createSecretMock,
          addSecretVersion: addSecretVersionMock,
          addSecretAccessorBinding: addSecretAccessorBindingMock,
        },
        fs: {
          promises: fsPromisesMock,
          default: {
            promises: fsPromisesMock,
          },
        },
      });
    };

    test('should return resourcesConfig unchanged if no secrets present', async () => {
      const compose = await setupCompose();
      const resourcesConfig = { project: 'test-project' };
      const result = await compose.composeSecrets(
        resourcesConfig,
        'token',
        'project-id',
        '/f-path',
        mock.fn()
      );
      assert.deepEqual(result, resourcesConfig);
    });

    test('should provision secrets and update resourcesConfig', async () => {
      const compose = await setupCompose();
      const resourcesConfig = {
        project: 'my-project',
        secrets: {
          'my-secret': {
            name: 'target-secret-name',
            file: './my_secret.txt',
            mount: 'my-secret',
          },
        },
      };

      getSecretMock.mock.mockImplementation(async () => null); // Secret doesn't exist
      createSecretMock.mock.mockImplementation(async () => ({
        name: 'target-secret-name',
      }));
      addSecretVersionMock.mock.mockImplementation(async () => ({
        name: 'projects/p/secrets/s/versions/1',
      }));
      addSecretAccessorBindingMock.mock.mockImplementation(async () => ({}));

      const result = await compose.composeSecrets(
        resourcesConfig,
        'token',
        'project-id',
        '/app-dir',
        mock.fn()
      );

      assert.strictEqual(
        result.secrets['my-secret'].secret_version,
        'projects/p/secrets/s/versions/1'
      );
      assert.strictEqual(ensureApisEnabledMock.mock.callCount(), 1);
      assert.strictEqual(createSecretMock.mock.callCount(), 1);
      assert.strictEqual(addSecretVersionMock.mock.callCount(), 1);
      assert.strictEqual(addSecretAccessorBindingMock.mock.callCount(), 1);
    });

    test('should skip provisioning if secret config is incomplete', async () => {
      const compose = await setupCompose();
      const resourcesConfig = {
        project: 'my-project',
        secrets: {
          'bad-secret': {
            name: 'only-name',
            // missing file and mount
          },
        },
      };

      ensureApisEnabledMock.mock.resetCalls();

      const result = await compose.composeSecrets(
        resourcesConfig,
        'token',
        'project-id',
        '/app-dir',
        mock.fn()
      );

      assert.strictEqual(
        result.secrets['bad-secret'].secret_version,
        undefined
      );
      assert.strictEqual(ensureApisEnabledMock.mock.callCount(), 1);
    });
  });
});
