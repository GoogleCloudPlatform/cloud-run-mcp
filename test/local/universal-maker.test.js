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
    chmodSync: mock.fn(),
    readFileSync: mock.fn(),
    rmSync: mock.fn(),
    unlinkSync: mock.fn(),
    createWriteStream: mock.fn(),
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

  const clientsMock = {
    getArtifactRegistryClient: mock.fn(),
  };

  test('runUniversalMaker skips download if binary exists and runs successfully', async () => {
    fsMock.existsSync.mock.resetCalls();
    fsMock.readFileSync.mock.resetCalls();
    childProcessMock.exec.mock.resetCalls();

    const localContent = 'local content';
    const sha256 = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';

    cryptoMock.createHash.mock.mockImplementation(() => ({
      update: mock.fn(() => ({
        digest: mock.fn(() => sha256),
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

    // Mock Artifact Registry client
    const artifactRegistryClientMock = {
      filePath: mock.fn((p, l, r, f) => `projects/${p}/locations/${l}/repositories/${r}/files/${f}`),
      getFile: mock.fn(() => [{
        hashes: [{ type: 'SHA256', value: Buffer.from(sha256, 'hex').toString('base64') }]
      }]),
    };
    clientsMock.getArtifactRegistryClient.mock.mockImplementation(() => artifactRegistryClientMock);

    const um = await esmock('../../lib/deployment/universal-maker.js', {
      fs: fsMock,
      child_process: childProcessMock,
      os: osMock,
      crypto: cryptoMock,
      '../../lib/util/helpers.js': helpersMock,
      '../../lib/clients.js': clientsMock,
    });

    // Mock exec only for binary execution
    childProcessMock.exec.mock.mockImplementation((cmd, cb) => {
      cb(null, { stdout: '', stderr: '' });
    });

    // runUniversalMaker(appDir, accessToken, progressCallback)
    const result = await um.runUniversalMaker('/app/dir', 'fake-token', mock.fn());

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

    let downloaded = false;

    // Mock binary missing first, then exists after "download"
    fsMock.existsSync.mock.mockImplementation((p) => {
      if (p.includes('universal_maker')) return downloaded;
      if (p.includes('build_output.json')) return true;
      return true; // for dir checks
    });

    // Mock Artifact Registry client for download
    const artifactRegistryClientMock = {
      filePath: mock.fn((p, l, r, f) => `projects/${p}/locations/${l}/repositories/${r}/files/${f}`),
      getFile: mock.fn(() => [{ hashes: [] }]), // trigger download
      auth: {
        request: mock.fn(() => {
          downloaded = true;
          return {
            data: {
              pipe: (dest) => {
                setTimeout(() => dest.emit('finish'), 10);
                return dest;
              }
            }
          };
        }),
      },
    };
    clientsMock.getArtifactRegistryClient.mock.mockImplementation(() => artifactRegistryClientMock);

    const writeStreamMock = {
      on: mock.fn(function (event, cb) {
        if (event === 'finish') this.finishCb = cb;
        return this;
      }),
      emit: mock.fn(function (event) {
        if (event === 'finish' && this.finishCb) this.finishCb();
      }),
      pipeFrom: mock.fn()
    };
    fsMock.createWriteStream = mock.fn(() => writeStreamMock);

    fsMock.readFileSync.mock.mockImplementation(() =>
      JSON.stringify({ command: 'npm', args: ['start'] })
    );

    const um = await esmock('../../lib/deployment/universal-maker.js', {
      fs: fsMock,
      child_process: childProcessMock,
      os: osMock,
      crypto: cryptoMock,
      '../../lib/util/helpers.js': helpersMock,
      '../../lib/clients.js': clientsMock,
    });

    // Mock exec only for binary execution
    childProcessMock.exec.mock.mockImplementation((cmd, cb) => {
      cb(null, { stdout: '', stderr: '' });
    });

    // runUniversalMaker(appDir, accessToken, progressCallback)
    const result = await um.runUniversalMaker('/app/dir', 'fake-token', mock.fn());

    assert.ok(result);
    assert.equal(result.command, 'npm');
    assert.ok(downloaded);
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
        '../../lib/clients.js': clientsMock,
      });

      const result = await um.runUniversalMaker('/app/dir', 'fake-token', mock.fn());
      assert.equal(result, null);
    } finally {
      Object.defineProperty(process, 'platform', { value: originalPlatform });
    }
  });
});
