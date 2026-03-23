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
import fs from 'fs';

describe('Artifact Utilities', () => {
  const fsMock = {
    existsSync: mock.fn(),
    mkdirSync: mock.fn(),
    chmodSync: mock.fn(),
    readFileSync: mock.fn(),
    unlinkSync: mock.fn(),
    createWriteStream: mock.fn(),
  };

  const cryptoMock = {
    createHash: mock.fn(),
  };

  const helpersMock = {
    logAndProgress: mock.fn(),
  };

  const clientsMock = {
    getArtifactRegistryClient: mock.fn(),
  };

  const artifactParams = {
    project: 'test-project',
    location: 'test-location',
    repository: 'test-repo',
    artifactPath: 'test-path:1.0:bin',
    displayName: 'Test Binary',
  };

  const sha256 =
    'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';

  test('isBinaryUpToDate returns true if hashes match', async () => {
    fsMock.existsSync.mock.mockImplementation(() => true);
    fsMock.readFileSync.mock.mockImplementation(() => 'local-content');
    cryptoMock.createHash.mock.mockImplementation(() => ({
      update: mock.fn(() => ({
        digest: mock.fn(() => sha256),
      })),
    }));

    const artifactRegistryClientMock = {
      filePath: mock.fn(() => 'resource-name'),
      getFile: mock.fn(() => [
        {
          hashes: [
            {
              type: 'SHA256',
              value: Buffer.from(sha256, 'hex').toString('base64'),
            },
          ],
        },
      ]),
    };
    clientsMock.getArtifactRegistryClient.mock.mockImplementation(
      () => artifactRegistryClientMock
    );

    const { isBinaryUpToDate } = await esmock('../../lib/util/artifacts.js', {
      fs: fsMock,
      crypto: cryptoMock,
      '../../lib/util/helpers.js': helpersMock,
      '../../lib/clients.js': clientsMock,
    });

    const result = await isBinaryUpToDate(
      '/bin/path',
      artifactParams,
      'token',
      mock.fn()
    );
    assert.strictEqual(result, true);
  });

  test('isBinaryUpToDate returns false and unlinks if hashes do not match', async () => {
    fsMock.existsSync.mock.mockImplementation(() => true);
    fsMock.readFileSync.mock.mockImplementation(() => 'local-content');
    fsMock.unlinkSync.mock.resetCalls();

    cryptoMock.createHash.mock.mockImplementation(() => ({
      update: mock.fn(() => ({
        digest: mock.fn(() => 'different-hash'),
      })),
    }));

    const artifactRegistryClientMock = {
      filePath: mock.fn(() => 'resource-name'),
      getFile: mock.fn(() => [
        {
          hashes: [
            {
              type: 'SHA256',
              value: Buffer.from(sha256, 'hex').toString('base64'),
            },
          ],
        },
      ]),
    };
    clientsMock.getArtifactRegistryClient.mock.mockImplementation(
      () => artifactRegistryClientMock
    );

    const { isBinaryUpToDate } = await esmock('../../lib/util/artifacts.js', {
      fs: fsMock,
      crypto: cryptoMock,
      '../../lib/util/helpers.js': helpersMock,
      '../../lib/clients.js': clientsMock,
    });

    const result = await isBinaryUpToDate(
      '/bin/path',
      artifactParams,
      'token',
      mock.fn()
    );
    assert.strictEqual(result, false);
    assert.strictEqual(fsMock.unlinkSync.mock.callCount(), 1);
  });

  test('ensureRepositoryDownloaded downloads binary if it does not exist', async () => {
    fsMock.existsSync.mock.mockImplementation((p) => {
      if (p === '/bin/path') return false;
      return true;
    });
    fsMock.createWriteStream.mock.resetCalls();

    const artifactRegistryClientMock = {
      filePath: mock.fn(() => 'resource-name'),
      getFile: mock.fn(() => [{ hashes: [] }]),
      auth: {
        request: mock.fn(() => ({
          data: {
            pipe: (dest) => {
              setTimeout(() => dest.emit('finish'), 10);
              return dest;
            },
          },
        })),
      },
    };
    clientsMock.getArtifactRegistryClient.mock.mockImplementation(
      () => artifactRegistryClientMock
    );

    const writeStreamMock = {
      on: mock.fn(function (event, cb) {
        if (event === 'finish') this.finishCb = cb;
        return this;
      }),
      emit: mock.fn(function (event) {
        if (event === 'finish' && this.finishCb) this.finishCb();
      }),
    };
    fsMock.createWriteStream.mock.mockImplementation(() => writeStreamMock);

    const { ensureRepositoryDownloaded } = await esmock(
      '../../lib/util/artifacts.js',
      {
        fs: fsMock,
        crypto: cryptoMock,
        '../../lib/util/helpers.js': helpersMock,
        '../../lib/clients.js': clientsMock,
      }
    );

    const result = await ensureRepositoryDownloaded(
      '/bin/path',
      artifactParams,
      'token',
      mock.fn()
    );
    assert.strictEqual(result, '/bin/path');
    assert.strictEqual(fsMock.createWriteStream.mock.callCount(), 1);
  });
});

describe('Utility Helpers', () => {
  test('extractAccessToken correctly extracts token from Bearer header', async () => {
    const { extractAccessToken } = await import('../../lib/util/helpers.js');

    assert.equal(extractAccessToken('Bearer my-token'), 'my-token');
    assert.equal(extractAccessToken(''), undefined);
    assert.equal(extractAccessToken(null), undefined);
  });

  describe('getProjectNumber', () => {
    test('extracts project number from name in projects/NNNN format', async () => {
      const getProjectMock = mock.fn(async () => [
        { name: 'projects/123456789' },
      ]);
      const getProjectsClientMock = mock.fn(async () => ({
        getProject: getProjectMock,
      }));

      const { getProjectNumber } = await esmock('../../lib/util/helpers.js', {
        '../../lib/clients.js': {
          getProjectsClient: getProjectsClientMock,
        },
      });

      const projectId = 'test-project';
      const accessToken = 'test-token';
      const result = await getProjectNumber(projectId, accessToken);

      assert.equal(result, '123456789');
      assert.equal(getProjectsClientMock.mock.callCount(), 1);
      assert.equal(
        getProjectMock.mock.calls[0].arguments[0].name,
        'projects/test-project'
      );
    });

    test('falls back to projectNumber property if name structure is unexpected', async () => {
      const getProjectMock = mock.fn(async () => [
        { name: 'unexpected', projectNumber: '987654321' },
      ]);
      const getProjectsClientMock = mock.fn(async () => ({
        getProject: getProjectMock,
      }));

      const { getProjectNumber } = await esmock('../../lib/util/helpers.js', {
        '../../lib/clients.js': {
          getProjectsClient: getProjectsClientMock,
        },
      });

      const result = await getProjectNumber('test-project', 'test-token');

      assert.equal(result, '987654321');
    });
  });
});
