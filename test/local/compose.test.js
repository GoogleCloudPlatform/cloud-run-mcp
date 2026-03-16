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
});
