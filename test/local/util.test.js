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

  describe('calculateSourceFingerprint', () => {
    test('calculates SHA256 of directory content deterministically', async () => {
      const fsMock = {
        promises: {
          readdir: mock.fn(async (dir) => {
            if (dir === '/src') {
              return [
                {
                  name: 'b.txt',
                  isFile: () => true,
                  isDirectory: () => false,
                },
                {
                  name: 'a.txt',
                  isFile: () => true,
                  isDirectory: () => false,
                },
                {
                  name: 'subdir',
                  isFile: () => false,
                  isDirectory: () => true,
                },
              ];
            }
            if (dir === '/src/subdir') {
              return [
                {
                  name: 'c.txt',
                  isFile: () => true,
                  isDirectory: () => false,
                },
              ];
            }
            return [];
          }),
          readFile: mock.fn(
            async (file) => `content of ${path.basename(file)}`
          ),
        },
      };

      const { calculateSourceFingerprint } = await esmock(
        '../../lib/util/helpers.js',
        {
          'node:fs': { promises: fsMock.promises },
        }
      );

      const result = await calculateSourceFingerprint('/src');
      assert.ok(result);
      assert.equal(typeof result, 'string');
      assert.equal(result.length, 64); // SHA256 hex length

      // Verify readdir calls (recursive)
      assert.equal(fsMock.promises.readdir.mock.callCount(), 2);
    });
  });

  describe('sanitizeCloudRunServiceName', () => {
    test('sanitizes various inputs correctly', async () => {
      const { sanitizeCloudRunServiceName } =
        await import('../../lib/util/helpers.js');

      assert.equal(
        sanitizeCloudRunServiceName('My-Service_Name'),
        'my-service-name'
      );
      assert.equal(sanitizeCloudRunServiceName('123service'), 's-123service');
      assert.equal(sanitizeCloudRunServiceName('-start-end-'), 'start-end');
      assert.equal(
        sanitizeCloudRunServiceName('a'.repeat(100)),
        'a'.repeat(49)
      );
      assert.equal(
        sanitizeCloudRunServiceName('Special!@#$%Chars'),
        'special-chars'
      );
    });
  });

  describe('sanitizeLabelValue', () => {
    test('sanitizes various inputs correctly', async () => {
      const { sanitizeLabelValue } = await import('../../lib/util/helpers.js');

      assert.equal(sanitizeLabelValue(''), '');
      assert.equal(sanitizeLabelValue(null), '');
      assert.equal(sanitizeLabelValue(undefined), '');
      assert.equal(sanitizeLabelValue('valid-label'), 'valid-label');
      assert.equal(sanitizeLabelValue('Upper-Case'), 'upper-case');
      assert.equal(sanitizeLabelValue('invalid@char'), 'invalid-char');
      assert.equal(
        sanitizeLabelValue('1starts-with-number'),
        '1starts-with-number'
      );
      assert.equal(
        sanitizeLabelValue('-starts-with-dash'),
        '-starts-with-dash'
      );
      assert.equal(sanitizeLabelValue('a'.repeat(70)), 'a'.repeat(63));
      assert.equal(sanitizeLabelValue(12345), '12345');
      assert.equal(sanitizeLabelValue(0), '0');
      assert.equal(sanitizeLabelValue(true), 'true');
      assert.equal(sanitizeLabelValue(false), 'false');
    });
  });

  describe('isPathContained and resolveContainedPath', () => {
    test('isPathContained correctly checks path containment', async () => {
      const { isPathContained } = await import('../../lib/util/helpers.js');

      assert.strictEqual(isPathContained('/tmp/app', '/tmp/app'), true);
      assert.strictEqual(
        isPathContained('/tmp/app', '/tmp/app/sub/file.txt'),
        true
      );
      assert.strictEqual(
        isPathContained('/tmp/app', '/tmp/app/..hidden'),
        true
      );
      assert.strictEqual(isPathContained('/tmp/app', '/tmp'), false);
      assert.strictEqual(
        isPathContained('/tmp/app', '/tmp/app-other/file.txt'),
        false
      );
      assert.strictEqual(isPathContained('/tmp/app', '/etc/passwd'), false);
    });

    test('resolveContainedPath resolves valid relative paths and rejects traversal', async () => {
      const { resolveContainedPath } =
        await import('../../lib/util/helpers.js');
      const os = await import('os');
      const tmpRoot = await fs.promises.mkdtemp(
        path.join(os.tmpdir(), 'cloud-run-mcp-path-test-')
      );
      const projectDir = path.join(tmpRoot, 'project');
      const outsideDir = path.join(tmpRoot, 'project-other');
      await fs.promises.mkdir(path.join(projectDir, 'sub'), {
        recursive: true,
      });
      await fs.promises.mkdir(outsideDir, { recursive: true });

      const insideFile = path.join(projectDir, 'sub', 'ok.txt');
      const outsideFile = path.join(outsideDir, 'secret.txt');
      await fs.promises.writeFile(insideFile, 'ok');
      await fs.promises.writeFile(outsideFile, 'secret');
      await fs.promises.symlink(
        outsideFile,
        path.join(projectDir, 'escape-link')
      );
      await fs.promises.symlink(insideFile, path.join(projectDir, 'safe-link'));

      try {
        const realProjectDir = await fs.promises.realpath(projectDir);
        const realInsideFile = await fs.promises.realpath(insideFile);

        assert.strictEqual(
          await resolveContainedPath(projectDir, '.'),
          realProjectDir
        );
        assert.strictEqual(
          await resolveContainedPath(projectDir, './sub/ok.txt'),
          realInsideFile
        );
        assert.strictEqual(
          await resolveContainedPath(projectDir, 'sub/../sub/ok.txt'),
          realInsideFile
        );
        assert.strictEqual(
          await resolveContainedPath(projectDir, 'safe-link'),
          realInsideFile
        );
        // Non-existent path inside project returns lexical path for caller ENOENT handling
        assert.strictEqual(
          await resolveContainedPath(projectDir, './missing.txt'),
          path.resolve(projectDir, 'missing.txt')
        );

        // Rejects invalid / empty / null-byte paths
        await assert.rejects(
          resolveContainedPath(projectDir, ''),
          /must be a non-empty string/
        );
        await assert.rejects(
          resolveContainedPath(projectDir, 'ok\0.txt'),
          /invalid null bytes/
        );

        // Rejects absolute paths
        await assert.rejects(
          resolveContainedPath(projectDir, outsideFile),
          /must be a relative path/
        );

        // Rejects parent traversal
        await assert.rejects(
          resolveContainedPath(projectDir, '../project-other/secret.txt'),
          /resolves outside the project directory/
        );

        // Rejects symlink escaping projectDir
        await assert.rejects(
          resolveContainedPath(projectDir, 'escape-link'),
          /resolves outside the project directory/
        );
      } finally {
        await fs.promises.rm(tmpRoot, { recursive: true, force: true });
      }
    });
  });
});
