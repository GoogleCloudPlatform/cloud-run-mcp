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

describe('Universal Maker', () => {
  const fsMock = {
    existsSync: mock.fn(),
    mkdirSync: mock.fn(),
    readFileSync: mock.fn(),
    rmSync: mock.fn(),
  };

  const childProcessMock = {
    exec: mock.fn(),
  };

  const osMock = {
    homedir: () => '/home/user',
    tmpdir: () => '/tmp',
  };

  const helpersMock = {
    logAndProgress: mock.fn(),
  };

  const artifactsMock = {
    ensureRepositoryDownloaded: mock.fn(),
  };

  test('runUniversalMaker skips download if binary exists and runs successfully', async () => {
    fsMock.existsSync.mock.resetCalls();
    fsMock.readFileSync.mock.resetCalls();
    childProcessMock.exec.mock.resetCalls();
    artifactsMock.ensureRepositoryDownloaded.mock.resetCalls();

    // Mock binary exists and is up to date
    artifactsMock.ensureRepositoryDownloaded.mock.mockImplementation(() => '/home/user/.cloud-run-mcp/bin/universal_maker');

    fsMock.existsSync.mock.mockImplementation((p) => {
      if (p.includes('build_output.json')) return true;
      return false;
    });

    fsMock.readFileSync.mock.mockImplementation((p) => {
      if (p.includes('build_output.json')) {
        return JSON.stringify({
          command: 'node',
          args: ['index.js'],
          runtime: 'nodejs20',
          envVars: { DEBUG: 'true' },
        });
      }
      return '';
    });

    const um = await esmock('../../lib/deployment/universal-maker.js', {
      fs: fsMock,
      child_process: childProcessMock,
      os: osMock,
      '../../lib/util/helpers.js': helpersMock,
      '../../lib/util/artifacts.js': artifactsMock,
    });

    // Mock exec only for binary execution
    childProcessMock.exec.mock.mockImplementation((cmd, cb) => {
      cb(null, { stdout: '', stderr: '' });
    });

    // runUniversalMaker(appDir, accessToken, progressCallback)
    const result = await um.runUniversalMaker(
      '/app/dir',
      'fake-token',
      mock.fn()
    );

    assert.ok(result);
    assert.equal(result.command, 'node');
    assert.deepEqual(result.args, ['index.js']);
    assert.equal(result.runtime, 'nodejs20');

    // Verify ensureRepositoryDownloaded was called
    assert.strictEqual(artifactsMock.ensureRepositoryDownloaded.mock.callCount(), 1);
  });

  test('runUniversalMaker behaves correctly when binary fails to download', async () => {
    artifactsMock.ensureRepositoryDownloaded.mock.resetCalls();
    artifactsMock.ensureRepositoryDownloaded.mock.mockImplementation(() => null);

    const um = await esmock('../../lib/deployment/universal-maker.js', {
      fs: fsMock,
      child_process: childProcessMock,
      os: osMock,
      '../../lib/util/helpers.js': helpersMock,
      '../../lib/util/artifacts.js': artifactsMock,
    });

    const result = await um.runUniversalMaker(
      '/app/dir',
      'fake-token',
      mock.fn()
    );

    assert.equal(result, null);
    assert.strictEqual(artifactsMock.ensureRepositoryDownloaded.mock.callCount(), 1);
  });

  test('runUniversalMaker returns null if binary not supported on platform', async () => {
    // Save original platform
    const originalPlatform = process.platform;
    Object.defineProperty(process, 'platform', { value: 'win32' });

    try {
      const um = await esmock('../../lib/deployment/universal-maker.js', {
        fs: fsMock,
        child_process: childProcessMock,
        os: osMock,
        '../../lib/util/helpers.js': helpersMock,
        '../../lib/util/artifacts.js': artifactsMock,
      });

      const result = await um.runUniversalMaker(
        '/app/dir',
        'fake-token',
        mock.fn()
      );
      assert.equal(result, null);
    } finally {
      Object.defineProperty(process, 'platform', { value: originalPlatform });
    }
  });
});
