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

import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert';
import {
  getCloudRunRegions,
  resetCachedRegions,
} from '../../lib/util/helpers.js';
import { clients } from '../../lib/clients.js';

/**
 * Waits for a specific string to appear in a stream's output.
 * This is useful for synchronizing tests with asynchronous child processes,
 * ensuring that a server or process has started and emitted an
 * expected "ready" message before proceeding with test assertions.
 *
 * @param {ReadableStream} stream - The stream to listen to (e.g., process.stdout or process.stderr).
 * @param {string} str - The string to wait for in the stream's output.
 * @param {number} [timeoutMs=7000] - The maximum time in milliseconds to wait before rejecting.
 * @returns {Promise<string>} A promise that resolves with the accumulated data
 *   when the string is found, or rejects if the timeout is reached.
 */
export async function waitForString(stream, str, timeoutMs = 7000) {
  let accumulatedData = '';
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      stream.removeListener('data', onData);
      reject(
        new Error(`waitForString timed out after ${timeoutMs}ms waiting for "${str}".
Saw:
${accumulatedData}`)
      );
    }, timeoutMs);

    function onData(data) {
      accumulatedData += data.toString();
      if (accumulatedData.includes(str)) {
        clearTimeout(timeout);
        stream.removeListener('data', onData);
        resolve(accumulatedData);
      }
    }
    stream.on('data', onData);
  });
}

describe('getCloudRunRegions', () => {
  beforeEach(() => {
    resetCachedRegions();
    // Clear the compute map to ensure isolation between tests
    clients.compute.clear();
  });

  test('returns list of regions using a mock injected into the clients cache', async () => {
    const projectId = 'test-project-1';
    const accessToken = 'token-1';
    // Match the key generation logic
    const key = projectId + accessToken;

    const mockRegions = [{ name: 'us-central1' }, { name: 'europe-west1' }];

    const mockComputeClient = {
      list: async () => [mockRegions],
    };

    clients.compute.set(key, mockComputeClient);

    const regions = await getCloudRunRegions(projectId, accessToken);
    assert.deepStrictEqual(regions, ['us-central1', 'europe-west1']);
  });

  test('caches the regions after first call', async () => {
    const projectId = 'test-project-2';
    const accessToken = 'token-2';
    const key = projectId + accessToken;

    let callCount = 0;
    const mockRegions = [{ name: 'us-central1' }];
    const mockComputeClient = {
      list: async () => {
        callCount++;
        return [mockRegions];
      },
    };

    clients.compute.set(key, mockComputeClient);

    await getCloudRunRegions(projectId, accessToken);
    const regions = await getCloudRunRegions(projectId, accessToken);

    assert.strictEqual(callCount, 1);
    assert.deepStrictEqual(regions, ['us-central1']);
  });

  test('using different accessToken allows isolated client mocks', async () => {
    const projectId = 'test-project-3';

    const regionsA = [{ name: 'region-a' }];
    const regionsB = [{ name: 'region-b' }];

    clients.compute.set(projectId + 'token-a', {
      list: async () => [regionsA],
    });
    clients.compute.set(projectId + 'token-b', {
      list: async () => [regionsB],
    });

    const resA = await getCloudRunRegions(projectId, 'token-a');
    resetCachedRegions();
    const resB = await getCloudRunRegions(projectId, 'token-b');

    assert.deepStrictEqual(resA, ['region-a']);
    assert.deepStrictEqual(resB, ['region-b']);
  });
});
