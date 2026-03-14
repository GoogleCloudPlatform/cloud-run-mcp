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
    assert.strictEqual(call.arguments[1].project, 'shrutimantri-tastyburborn1');
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
});
