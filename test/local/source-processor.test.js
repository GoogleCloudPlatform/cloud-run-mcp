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

describe('Source Processor', () => {
  const fspMock = {
    mkdir: mock.fn(),
    stat: mock.fn(),
    copyFile: mock.fn(),
    rm: mock.fn(),
  };

  const childProcessMock = {
    exec: mock.fn(),
  };

  test('prepareSourceDirectory creates temp dir and copies files', async () => {
    const sourceProcessor = await esmock(
      '../../lib/deployment/source-processor.js',
      {
        'node:fs/promises': fspMock,
        'node:child_process': childProcessMock,
      }
    );

    const files = ['/path/to/source/file1.js', '/path/to/source/dir1'];

    fspMock.stat.mock.mockImplementation(async (filePath) => {
      if (filePath.endsWith('dir1')) return { isDirectory: () => true };
      return { isDirectory: () => false };
    });

    // Mock exec for directory copy (cp -R)
    childProcessMock.exec.mock.mockImplementation((cmd, callback) => {
      // Handle sync callback for util.promisify
      if (callback) callback(null, 'ok', '');
    });

    const progressCallback = mock.fn();

    const tempDir = await sourceProcessor.prepareSourceDirectory(
      files,
      progressCallback
    );

    assert.ok(
      tempDir.includes('file1.js-'),
      'Temp dir should have expected prefix (based on first filename)'
    );

    assert.equal(fspMock.mkdir.mock.callCount(), 1);
    assert.equal(fspMock.copyFile.mock.callCount(), 1); // for file1.js

    // Check if cp -R was called for dir1
    const execCalls = childProcessMock.exec.mock.calls;
    const cpCall = execCalls.find((call) =>
      call.arguments[0].startsWith('cp -R')
    );
    assert.ok(cpCall, 'Should call cp -R for directories');
  });

  test('installDependencies runs npm install for Node.js', async () => {
    // We need to mock fs.existsSync as well
    const fsMock = {
      existsSync: mock.fn(),
    };

    const sourceProcessor = await esmock(
      '../../lib/deployment/source-processor.js',
      {
        'node:fs': fsMock,
        'node:fs/promises': fspMock,
        'node:child_process': childProcessMock,
      }
    );

    const targetDir = '/temp/dir';
    const deploymentAttrs = {
      runtime: 'nodejs',
      cmd: ['node', 'server.js'],
      args: ['server.js'],
      baseImage: 'node:22',
    };
    const progressCallback = mock.fn();

    // Mock existsSync
    fsMock.existsSync.mock.mockImplementation((p) => {
      if (p.includes('node_modules')) return false; // not installed yet
      if (p.includes('package-lock.json')) return false; // no lock file
      return false;
    });

    // Mock exec for npm install
    childProcessMock.exec.mock.mockImplementation((cmd, opts, callback) => {
      if (typeof opts === 'function') callback = opts;
      if (callback) callback(null, 'ok', '');
    });

    await sourceProcessor.installDependencies(
      targetDir,
      deploymentAttrs,
      progressCallback
    );

    const calls = childProcessMock.exec.mock.calls;
    const npmCall = calls.find((call) =>
      call.arguments[0].includes('npm install')
    );
    assert.ok(npmCall, 'Should run npm install');
    assert.strictEqual(npmCall.arguments[1].cwd, targetDir);
  });

  test('installDependencies uses npm ci if lockfile exists', async () => {
    const fsMock = {
      existsSync: mock.fn(),
    };

    const sourceProcessor = await esmock(
      '../../lib/deployment/source-processor.js',
      {
        'node:fs': fsMock,
        'node:child_process': childProcessMock,
      }
    );

    const targetDir = '/temp/dir';
    const deploymentAttrs = {
      runtime: 'nodejs',
      cmd: ['node', 'server.js'],
      args: ['server.js'],
      baseImage: 'node:22',
    };

    // Mock existsSync
    fsMock.existsSync.mock.mockImplementation((p) => {
      if (p.includes('node_modules')) return false;
      if (p.includes('package-lock.json')) return true; // has lock file
      return false;
    });

    childProcessMock.exec.mock.mockImplementation((cmd, opts, callback) => {
      if (typeof opts === 'function') callback = opts;
      if (callback) callback(null, 'ok', '');
    });

    await sourceProcessor.installDependencies(
      targetDir,
      deploymentAttrs,
      () => {}
    );

    const calls = childProcessMock.exec.mock.calls;
    const npmCall = calls.find((call) => call.arguments[0].includes('npm ci'));
    assert.ok(npmCall, 'Should run npm ci');
  });

  test('installDependencies skips if node_modules exists', async () => {
    const fsMock = {
      existsSync: mock.fn(),
    };

    const sourceProcessor = await esmock(
      '../../lib/deployment/source-processor.js',
      {
        'node:fs': fsMock,
        'node:child_process': childProcessMock,
      }
    );

    fsMock.existsSync.mock.mockImplementation((p) => {
      if (p.includes('node_modules')) return true;
      return false;
    });

    // clear mock calls
    childProcessMock.exec.mock.resetCalls();

    await sourceProcessor.installDependencies(
      '/dir',
      {
        runtime: 'nodejs',
        cmd: ['node', 'server.js'],
        args: ['server.js'],
        baseImage: 'node:22',
      },
      () => {}
    );

    assert.equal(childProcessMock.exec.mock.callCount(), 0);
  });

  test('installDependencies logs warn on failure but does not throw', async () => {
    const fsMock = { existsSync: mock.fn(() => false) };
    const sourceProcessor = await esmock(
      '../../lib/deployment/source-processor.js',
      {
        'node:fs': fsMock,
        'node:child_process': childProcessMock,
      }
    );

    childProcessMock.exec.mock.mockImplementation((cmd, opts, callback) => {
      if (typeof opts === 'function') callback = opts;
      callback(new Error('npm failed'));
    });

    const consoleLogMock = mock.method(console, 'log');

    await assert.doesNotReject(async () => {
      await sourceProcessor.installDependencies('/dir', { runtime: 'nodejs' });
    });

    assert.equal(
      consoleLogMock.mock.callCount(),
      1,
      'console.log should be called once'
    );
    const logArgs = consoleLogMock.mock.calls[0].arguments;
    assert.ok(
      logArgs[0].includes('Dependency installation failed: npm failed'),
      'console.log should contain the error message'
    );

    consoleLogMock.mock.restore();
  });

  test('cleanupTempDirectory removes directory', async () => {
    const fsMock = {
      existsSync: mock.fn(() => true),
    };

    const sourceProcessor = await esmock(
      '../../lib/deployment/source-processor.js',
      {
        'node:fs': fsMock,
        'node:fs/promises': fspMock,
      }
    );

    await sourceProcessor.cleanupTempDirectory('/temp/dir');

    assert.equal(fspMock.rm.mock.callCount(), 1);
    assert.deepEqual(fspMock.rm.mock.calls[0].arguments[0], '/temp/dir');
  });

  test('cleanupTempDirectory logs error on failure but does not throw', async () => {
    const fsMock = { existsSync: mock.fn(() => true) };
    // mock fsp.rm to throw
    const fspMockThrow = {
      rm: mock.fn(async () => {
        throw new Error('rm failed');
      }),
    };

    const consoleErrorMock = mock.method(console, 'error');

    const sourceProcessor = await esmock(
      '../../lib/deployment/source-processor.js',
      {
        'node:fs': fsMock,
        'node:fs/promises': fspMockThrow,
      }
    );

    await sourceProcessor.cleanupTempDirectory('/dir');

    assert.equal(consoleErrorMock.mock.callCount(), 1);
    assert.ok(
      consoleErrorMock.mock.calls[0].arguments[1].message.includes('rm failed')
    );

    consoleErrorMock.mock.restore();
  });
});
