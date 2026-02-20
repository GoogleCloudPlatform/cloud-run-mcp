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

describe('Universal Maker', () => {
  const fsMock = {
    existsSync: mock.fn(),
    mkdirSync: mock.fn(),
    chmodSync: mock.fn(),
    readFileSync: mock.fn(),
    rmSync: mock.fn(),
    unlinkSync: mock.fn(),
  };

  const cryptoMock = {
    createHash: mock.fn(),
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

  test('runUniversalMaker skips download if binary exists and runs successfully', async () => {
    fsMock.existsSync.mock.resetCalls();
    fsMock.readFileSync.mock.resetCalls();
    childProcessMock.exec.mock.resetCalls();

    const um = await esmock('../../lib/deployment/universal-maker.js', {
      fs: fsMock,
      child_process: childProcessMock,
      os: osMock,
      crypto: cryptoMock,
      '../../lib/util/helpers.js': helpersMock,
    });

    const localContent = 'local content';
    const sha256 = '8db9f600450531c34988770b0cc88f28fa699134'; // Dummy hex

    cryptoMock.createHash.mock.mockImplementation(() => ({
      update: mock.fn().mockImplementation(() => ({
        digest: mock.fn().mockImplementation(() => sha256),
      })),
    }));

    // Mock binary exists
    fsMock.existsSync.mock.mockImplementation((p) => {
      if (p.includes('universal_maker')) return true;
      if (p.includes('build_output.json')) return true;
      return false;
    });

    fsMock.readFileSync.mock.mockImplementation((p) => {
      if (p.includes('universal_maker')) return localContent;
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

    // Mock exec for metadata AND binary execution
    childProcessMock.exec.mock.mockImplementation((cmd, cb) => {
      if (cmd.includes('curl') && !cmd.includes('-o')) {
        // Metadata call
        const metadata = {
          hashes: [
            {
              type: 'SHA256',
              value: Buffer.from(sha256, 'hex').toString('base64'),
            },
          ],
        };
        cb(null, { stdout: JSON.stringify(metadata), stderr: '' });
      } else {
        cb(null, { stdout: '', stderr: '' });
      }
    });

    const result = await um.runUniversalMaker('/app/dir', mock.fn());

    assert.ok(result);
    assert.equal(result.command, 'node');
    assert.deepEqual(result.args, ['index.js']);
    assert.equal(result.runtime, 'nodejs20');

    // Verify bin check was performed
    const binExistsCall = fsMock.existsSync.mock.calls.find((c) =>
      c.arguments[0].includes('universal_maker')
    );
    assert.ok(binExistsCall);
  });

  test('runUniversalMaker downloads binary if missing', async () => {
    fsMock.existsSync.mock.resetCalls();
    fsMock.readFileSync.mock.resetCalls();
    childProcessMock.exec.mock.resetCalls();

    const um = await esmock('../../lib/deployment/universal-maker.js', {
      fs: fsMock,
      child_process: childProcessMock,
      os: osMock,
      crypto: cryptoMock,
      '../../lib/util/helpers.js': helpersMock,
    });

    let downloaded = false;

    // Mock binary missing first, then exists after "download"
    fsMock.existsSync.mock.mockImplementation((p) => {
      if (p.includes('universal_maker')) return downloaded;
      if (p.includes('build_output.json')) return true;
      return true; // for dir checks
    });

    // Mock exec for curl and binary execution
    childProcessMock.exec.mock.mockImplementation((cmd, cb) => {
      if (cmd.includes('curl')) {
        downloaded = true;
      }
      cb(null, { stdout: '', stderr: '' });
    });

    fsMock.readFileSync.mock.mockImplementation(() =>
      JSON.stringify({ command: 'npm', args: ['start'] })
    );

    const result = await um.runUniversalMaker('/app/dir', mock.fn());

    assert.ok(result);
    assert.equal(result.command, 'npm');

    // Verify curl was called
    const curlCall = childProcessMock.exec.mock.calls.find((c) =>
      c.arguments[0].includes('curl')
    );
    assert.ok(curlCall);
    assert.ok(curlCall.arguments[0].includes('curl -L -o'));
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
        crypto: cryptoMock,
        '../../lib/util/helpers.js': helpersMock,
      });

      const result = await um.runUniversalMaker('/app/dir', mock.fn());
      assert.equal(result, null);
    } finally {
      Object.defineProperty(process, 'platform', { value: originalPlatform });
    }
  });
});
