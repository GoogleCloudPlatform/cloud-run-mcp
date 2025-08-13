/*
Copyright 2025 Google LLC

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    https://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES, OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
*/

import assert from 'node:assert/strict';
import { describe, it, mock, beforeEach, afterEach } from 'node:test';
import { GoogleAuth } from 'google-auth-library';
import { ensureGCPCredentials } from '../../lib/gcp-auth-check.js';

describe('ensureGCPCredentials', () => {
  let originalConsoleLog;
  let originalConsoleError;

  let capturedConsoleOutput;

  let consoleLogMockFn;
  let consoleErrorMockFn;

  let getClientMock;
  let getAccessTokenMock;

  beforeEach(() => {
    // Store original methods
    originalConsoleLog = console.log;
    originalConsoleError = console.error;

    capturedConsoleOutput = []; // Reset for each test

    // Create mock.fn instances and assign them to global console/process
    consoleLogMockFn = mock.fn((...args) => {
      capturedConsoleOutput.push(args.join(' '));
    });
    consoleErrorMockFn = mock.fn((...args) => {
      capturedConsoleOutput.push(args.join(' '));
    });

    // Overwrite the global console and process methods
    console.log = consoleLogMockFn;
    console.error = consoleErrorMockFn;

    // Mock GoogleAuth.prototype.getClient and AuthClient.prototype.getAccessToken.
    const mockClient = {
      getAccessToken: mock.fn(async () => ({ token: 'mock-token' })),
    };
    getAccessTokenMock = mockClient.getAccessToken;
    getClientMock = mock.method(
      GoogleAuth.prototype,
      'getClient',
      async () => mockClient
    );
  });

  afterEach(() => {
    // Restore original methods
    console.log = originalConsoleLog;
    console.error = originalConsoleError;

    // Restore other mocks created with `mock.method`
    mock.restoreAll();
  });

  it('should return true when ADC are found', async () => {
    const result = await ensureGCPCredentials();
    assert.strictEqual(result, true, 'Should return true on success');

    assert.deepStrictEqual(
      capturedConsoleOutput,
      [
        'Checking for Google Cloud Application Default Credentials...',
        'Application Default Credentials found.',
      ],
      'Console output should indicate successful ADC discovery'
    );

    assert.strictEqual(
      consoleErrorMockFn.mock.callCount(),
      1,
      'console.error should be called once (checking message)'
    );
    assert.strictEqual(
      consoleLogMockFn.mock.callCount(),
      1,
      'console.log should be called once (for success message)'
    );

    assert.strictEqual(
      getClientMock.mock.callCount(),
      1,
      'GoogleAuth.getClient should be called once'
    );
    assert.strictEqual(
      getAccessTokenMock.mock.callCount(),
      1,
      'client.getAccessToken should be called once'
    );
  });

  it('should return false and log error when ADC are not found (generic error)', async () => {
    const errorMessage = 'Failed to find credentials.';
    const errorWithStack = new Error(errorMessage);
    getClientMock.mock.mockImplementation(async () => {
      throw errorWithStack;
    });

    const result = await ensureGCPCredentials();
    assert.strictEqual(result, false, 'Should return false on failure');

    const expectedOutput = [
      'Checking for Google Cloud Application Default Credentials...',
      'ERROR: Google Cloud Application Default Credentials are not set up.',
      'An unexpected error occurred during credential verification.',
      '\nFor more details or alternative setup methods, consider:',
      '1. If running locally, run: gcloud auth application-default login.',
      '2. Ensuring the `GOOGLE_APPLICATION_CREDENTIALS` environment variable points to a valid service account key file.',
      '3. If on a Google Cloud environment (e.g., GCE, Cloud Run), verify the associated service account has necessary permissions.',
      `\nOriginal error message from Google Auth Library: ${errorMessage}`,
      `Error stack: ${errorWithStack.stack}`,
    ];
    assert.deepStrictEqual(
      capturedConsoleOutput,
      expectedOutput,
      'Console output should match generic error messages'
    );
  });

  it('should return false and log HTTP error when google-auth-library throws an HTTP error', async () => {
    const httpErrorMessage = 'Request failed with status code 401';
    const httpError = new Error(httpErrorMessage);
    httpError.response = { status: 401 };
    const errorWithStack = httpError;

    getClientMock.mock.mockImplementation(async () => {
      throw httpError;
    });

    const result = await ensureGCPCredentials();
    assert.strictEqual(result, false, 'Should return false on failure');

    const expectedOutput = [
      'Checking for Google Cloud Application Default Credentials...',
      'ERROR: Google Cloud Application Default Credentials are not set up.',
      `An HTTP error occurred (Status: 401). This often means misconfigured, expired credentials, or a network issue.`,
      '\nFor more details or alternative setup methods, consider:',
      '1. If running locally, run: gcloud auth application-default login.',
      '2. Ensuring the `GOOGLE_APPLICATION_CREDENTIALS` environment variable points to a valid service account key file.',
      '3. If on a Google Cloud environment (e.g., GCE, Cloud Run), verify the associated service account has necessary permissions.',
      `\nOriginal error message from Google Auth Library: ${httpErrorMessage}`,
      `Error stack: ${errorWithStack.stack}`,
    ];
    assert.deepStrictEqual(
      capturedConsoleOutput,
      expectedOutput,
      'Console output should match HTTP error messages'
    );
  });

  it('should return false and log TypeError when google-auth-library throws a TypeError', async () => {
    const typeErrorMessage = 'Unexpected token in JSON at position 0';
    const typeError = new TypeError(typeErrorMessage);
    const errorWithStack = typeError;

    getClientMock.mock.mockImplementation(async () => {
      throw typeError;
    });

    const result = await ensureGCPCredentials();
    assert.strictEqual(result, false, 'Should return false on failure');

    const expectedOutput = [
      'Checking for Google Cloud Application Default Credentials...',
      'ERROR: Google Cloud Application Default Credentials are not set up.',
      'An unexpected error occurred during credential verification (e.g., malformed response or invalid type).',
      '\nFor more details or alternative setup methods, consider:',
      '1. If running locally, run: gcloud auth application-default login.',
      '2. Ensuring the `GOOGLE_APPLICATION_CREDENTIALS` environment variable points to a valid service account key file.',
      '3. If on a Google Cloud environment (e.g., GCE, Cloud Run), verify the associated service account has necessary permissions.',
      `\nOriginal error message from Google Auth Library: ${typeErrorMessage}`,
      `Error stack: ${errorWithStack.stack}`,
    ];
    assert.deepStrictEqual(
      capturedConsoleOutput,
      expectedOutput,
      'Console output should match TypeError messages'
    );
  });

  it('should return false and log general unexpected error for other errors', async () => {
    const unknownErrorMessage = 'Something unexpected happened.';
    const unknownError = new Error(unknownErrorMessage);
    const errorWithStack = unknownError;

    getClientMock.mock.mockImplementation(async () => {
      throw unknownError;
    });

    const result = await ensureGCPCredentials();
    assert.strictEqual(result, false, 'Should return false on failure');

    const expectedOutput = [
      'Checking for Google Cloud Application Default Credentials...',
      'ERROR: Google Cloud Application Default Credentials are not set up.',
      'An unexpected error occurred during credential verification.',
      '\nFor more details or alternative setup methods, consider:',
      '1. If running locally, run: gcloud auth application-default login.',
      '2. Ensuring the `GOOGLE_APPLICATION_CREDENTIALS` environment variable points to a valid service account key file.',
      '3. If on a Google Cloud environment (e.g., GCE, Cloud Run), verify the associated service account has necessary permissions.',
      `\nOriginal error message from Google Auth Library: ${unknownErrorMessage}`,
      `Error stack: ${errorWithStack.stack}`,
    ];
    assert.deepStrictEqual(
      capturedConsoleOutput,
      expectedOutput,
      'Console output should match general error messages'
    );
  });
});
