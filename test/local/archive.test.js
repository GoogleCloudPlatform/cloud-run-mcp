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

import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { zipFiles } from '../../lib/util/archive.js';

describe('Archive Utility (zipFiles)', () => {
  let tempDir;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'archive-test-'));
  });

  afterEach(() => {
    if (tempDir && fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  test('creates a valid zip archive in memory from buffer objects', async () => {
    const files = [
      { filename: 'file1.txt', content: 'Hello World' },
      { filename: 'file2.json', content: JSON.stringify({ key: 'value' }) },
    ];

    const zipBuffer = await zipFiles(files, false);
    assert.ok(Buffer.isBuffer(zipBuffer));
    assert.ok(zipBuffer.length > 0);
  });

  test('creates a valid tar.gz archive in memory from buffer objects', async () => {
    const files = [{ filename: 'file1.txt', content: 'Hello World Tar' }];

    const tarBuffer = await zipFiles(files, true);
    assert.ok(Buffer.isBuffer(tarBuffer));
    assert.ok(tarBuffer.length > 0);
  });

  test('creates archive from actual file paths on disk', async () => {
    const testFilePath = path.join(tempDir, 'sample.txt');
    fs.writeFileSync(testFilePath, 'Sample file content');

    const zipBuffer = await zipFiles([testFilePath], false);
    assert.ok(Buffer.isBuffer(zipBuffer));
    assert.ok(zipBuffer.length > 0);
  });

  test('creates archive from directory path on disk', async () => {
    const subDir = path.join(tempDir, 'subdir');
    fs.mkdirSync(subDir);
    fs.writeFileSync(path.join(subDir, 'nested.txt'), 'Nested content');

    const zipBuffer = await zipFiles([subDir], false);
    assert.ok(Buffer.isBuffer(zipBuffer));
    assert.ok(zipBuffer.length > 0);
  });

  test('throws error if file path does not exist', async () => {
    const nonExistentPath = path.join(tempDir, 'does-not-exist.txt');
    await assert.rejects(
      async () => {
        await zipFiles([nonExistentPath], false);
      },
      {
        message: new RegExp(
          `File or directory not found: ${nonExistentPath.replace(/\\/g, '\\\\')}`
        ),
      }
    );
  });
});
