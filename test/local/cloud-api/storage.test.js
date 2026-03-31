import assert from 'node:assert/strict';
import { describe, it, mock, beforeEach, afterEach } from 'node:test';
import esmock from 'esmock';

describe('grantBucketAccess', () => {
  let storageApi;
  let logAndProgressMock;
  let callWithRetryMock;

  beforeEach(async () => {
    logAndProgressMock = mock.fn();
    // Use the actual path to helpers based on where storage.js is
    // storage.js is in lib/cloud-api/
    // util/helpers.js is in lib/util/
    // cloud-api/helpers.js is in lib/cloud-api/

    callWithRetryMock = mock.fn((fn) => fn());

    storageApi = await esmock('../../../lib/cloud-api/storage.js', {
      '../../../lib/util/helpers.js': {
        logAndProgress: logAndProgressMock,
      },
      '../../../lib/cloud-api/helpers.js': {
        callWithRetry: callWithRetryMock,
      },
    });
  });

  afterEach(() => {
    mock.restoreAll();
  });

  it('should grant access if member does not have role', async () => {
    const mockBucket = {
      name: 'test-bucket',
      iam: {
        getPolicy: mock.fn(() => Promise.resolve([{ bindings: [] }])),
        setPolicy: mock.fn(() => Promise.resolve()),
      },
    };

    await storageApi.grantBucketAccess(
      mockBucket,
      'roles/storage.objectAdmin',
      'serviceAccount:test@example.com'
    );

    // Should call getPolicy once
    assert.strictEqual(mockBucket.iam.getPolicy.mock.callCount(), 1);
    // Should call setPolicy once
    assert.strictEqual(mockBucket.iam.setPolicy.mock.callCount(), 1);

    // Verify the binding was added
    const setPolicyCall = mockBucket.iam.setPolicy.mock.calls[0];
    const updatedPolicy = setPolicyCall.arguments[0];
    assert.deepStrictEqual(updatedPolicy.bindings, [
      {
        role: 'roles/storage.objectAdmin',
        members: ['serviceAccount:test@example.com'],
      },
    ]);
  });

  it('should add to existing role bindings if role exists but member is missing', async () => {
    const mockBucket = {
      name: 'test-bucket',
      iam: {
        getPolicy: mock.fn(() =>
          Promise.resolve([
            {
              bindings: [
                {
                  role: 'roles/storage.objectAdmin',
                  members: ['serviceAccount:existing@example.com'],
                },
              ],
            },
          ])
        ),
        setPolicy: mock.fn(() => Promise.resolve()),
      },
    };

    await storageApi.grantBucketAccess(
      mockBucket,
      'roles/storage.objectAdmin',
      'serviceAccount:test@example.com'
    );

    assert.strictEqual(mockBucket.iam.setPolicy.mock.callCount(), 1);
    const updatedPolicy = mockBucket.iam.setPolicy.mock.calls[0].arguments[0];
    const binding = updatedPolicy.bindings.find(
      (b) => b.role === 'roles/storage.objectAdmin'
    );
    assert.ok(binding.members.includes('serviceAccount:test@example.com'));
    assert.ok(binding.members.includes('serviceAccount:existing@example.com'));
  });

  it('should not call setPolicy if member already has role', async () => {
    const mockBucket = {
      name: 'test-bucket',
      iam: {
        getPolicy: mock.fn(() =>
          Promise.resolve([
            {
              bindings: [
                {
                  role: 'roles/storage.objectAdmin',
                  members: ['serviceAccount:test@example.com'],
                },
              ],
            },
          ])
        ),
        setPolicy: mock.fn(() => Promise.resolve()),
      },
    };

    await storageApi.grantBucketAccess(
      mockBucket,
      'roles/storage.objectAdmin',
      'serviceAccount:test@example.com'
    );

    assert.strictEqual(mockBucket.iam.getPolicy.mock.callCount(), 1);
    assert.strictEqual(mockBucket.iam.setPolicy.mock.callCount(), 0);
  });

  it('should handle errors gracefully by logging a warning instead of throwing', async () => {
    const mockBucket = {
      name: 'test-bucket',
      iam: {
        getPolicy: mock.fn(() =>
          Promise.reject(new Error('IAM Permission Denied'))
        ),
        setPolicy: mock.fn(),
      },
    };

    // This should not throw
    await storageApi.grantBucketAccess(
      mockBucket,
      'roles/storage.objectAdmin',
      'serviceAccount:test@example.com'
    );

    // Verify warning was logged
    const errorLogs = logAndProgressMock.mock.calls.filter(
      (c) => c.arguments[2] === 'warn'
    );
    assert.ok(errorLogs.length > 0);
    assert.ok(errorLogs[0].arguments[0].includes('IAM Permission Denied'));
  });
});
