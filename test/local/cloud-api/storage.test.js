import assert from 'node:assert/strict';
import { describe, it, mock, beforeEach, afterEach } from 'node:test';
import esmock from 'esmock';

describe('Storage API', () => {
  let storageApi;
  let logAndProgressMock;
  let callWithRetryMock;
  let getStorageClientMock;
  let getProjectNumberMock;
  let mockStorage;
  let mockBucket;

  beforeEach(async () => {
    logAndProgressMock = mock.fn();
    callWithRetryMock = mock.fn((fn) => fn());
    getProjectNumberMock = mock.fn(() => Promise.resolve('123456'));

    mockBucket = {
      name: 'test-bucket',
      exists: mock.fn(() => Promise.resolve([false])),
      getMetadata: mock.fn(() =>
        Promise.resolve([{ projectNumber: '123456' }])
      ),
      file: mock.fn((blobName) => ({
        name: blobName,
        save: mock.fn(() => Promise.resolve()),
        getMetadata: mock.fn(() =>
          Promise.resolve([{ generation: '999888777' }])
        ),
      })),
      iam: {
        getPolicy: mock.fn(() => Promise.resolve([{ bindings: [] }])),
        setPolicy: mock.fn(() => Promise.resolve()),
      },
    };

    mockStorage = {
      bucket: mock.fn(() => mockBucket),
      createBucket: mock.fn(() => Promise.resolve([mockBucket])),
    };

    getStorageClientMock = mock.fn(() => Promise.resolve(mockStorage));

    storageApi = await esmock('../../../lib/cloud-api/storage.js', {
      '../../../lib/util/helpers.js': {
        logAndProgress: logAndProgressMock,
        getProjectNumber: getProjectNumberMock,
      },
      '../../../lib/cloud-api/helpers.js': {
        callWithRetry: callWithRetryMock,
      },
      '../../../lib/clients.js': {
        getStorageClient: getStorageClientMock,
      },
    });
  });

  afterEach(() => {
    mock.restoreAll();
  });

  describe('grantBucketAccess', () => {
    it('should grant access if member does not have role', async () => {
      const testBucket = {
        name: 'test-bucket',
        iam: {
          getPolicy: mock.fn(() => Promise.resolve([{ bindings: [] }])),
          setPolicy: mock.fn(() => Promise.resolve()),
        },
      };
      await storageApi.grantBucketAccess(
        testBucket,
        'roles/storage.objectAdmin',
        'serviceAccount:test@example.com'
      );

      assert.strictEqual(testBucket.iam.getPolicy.mock.callCount(), 1);
      assert.strictEqual(testBucket.iam.setPolicy.mock.callCount(), 1);

      const setPolicyCall = testBucket.iam.setPolicy.mock.calls[0];
      const updatedPolicy = setPolicyCall.arguments[0];
      assert.deepStrictEqual(updatedPolicy.bindings, [
        {
          role: 'roles/storage.objectAdmin',
          members: ['serviceAccount:test@example.com'],
        },
      ]);
    });

    it('should add to existing role bindings if role exists but member is missing', async () => {
      const testBucket = {
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
        testBucket,
        'roles/storage.objectAdmin',
        'serviceAccount:test@example.com'
      );

      assert.strictEqual(testBucket.iam.setPolicy.mock.callCount(), 1);
      const updatedPolicy = testBucket.iam.setPolicy.mock.calls[0].arguments[0];
      const binding = updatedPolicy.bindings.find(
        (b) => b.role === 'roles/storage.objectAdmin'
      );
      assert.ok(binding.members.includes('serviceAccount:test@example.com'));
      assert.ok(
        binding.members.includes('serviceAccount:existing@example.com')
      );
    });

    it('should not call setPolicy if member already has role', async () => {
      const testBucket = {
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
        testBucket,
        'roles/storage.objectAdmin',
        'serviceAccount:test@example.com'
      );

      assert.strictEqual(testBucket.iam.getPolicy.mock.callCount(), 1);
      assert.strictEqual(testBucket.iam.setPolicy.mock.callCount(), 0);
    });

    it('should handle errors gracefully by logging a warning instead of throwing', async () => {
      const testBucket = {
        name: 'test-bucket',
        iam: {
          getPolicy: mock.fn(() =>
            Promise.reject(new Error('IAM Permission Denied'))
          ),
          setPolicy: mock.fn(),
        },
      };

      await storageApi.grantBucketAccess(
        testBucket,
        'roles/storage.objectAdmin',
        'serviceAccount:test@example.com'
      );

      const errorLogs = logAndProgressMock.mock.calls.filter(
        (c) => c.arguments[2] === 'warn'
      );
      assert.ok(errorLogs.length > 0);
      assert.ok(errorLogs[0].arguments[0].includes('IAM Permission Denied'));
    });
  });

  describe('ensureStorageBucketExists', () => {
    it('should return bucket if it exists and ownership matches', async () => {
      mockBucket.exists.mock.mockImplementation(() => Promise.resolve([true]));
      mockBucket.getMetadata.mock.mockImplementation(() =>
        Promise.resolve([{ projectNumber: '123456' }])
      );

      const result = await storageApi.ensureStorageBucketExists(
        'test-project',
        'test-bucket',
        'us-central1',
        'token'
      );

      assert.strictEqual(result, mockBucket);
      assert.strictEqual(mockStorage.createBucket.mock.callCount(), 0);
    });

    it('should create bucket without labels if none provided', async () => {
      mockBucket.exists.mock.mockImplementation(() => Promise.resolve([false]));
      mockStorage.createBucket.mock.mockImplementation((name, options) =>
        Promise.resolve([mockBucket])
      );

      const result = await storageApi.ensureStorageBucketExists(
        'test-project',
        'test-bucket',
        'us-central1',
        'token'
      );

      assert.strictEqual(result, mockBucket);
      assert.strictEqual(mockStorage.createBucket.mock.callCount(), 1);
      const call = mockStorage.createBucket.mock.calls[0];
      assert.strictEqual(call.arguments[0], 'test-bucket');
      assert.deepStrictEqual(call.arguments[1], { location: 'us-central1' });
    });

    it('should create bucket with labels if provided', async () => {
      mockBucket.exists.mock.mockImplementation(() => Promise.resolve([false]));
      mockStorage.createBucket.mock.mockImplementation((name, options) =>
        Promise.resolve([mockBucket])
      );

      const labels = { key: 'value' };
      const result = await storageApi.ensureStorageBucketExists(
        'test-project',
        'test-bucket',
        'us-central1',
        'token',
        labels,
        false
      );

      assert.strictEqual(result, mockBucket);
      assert.strictEqual(mockStorage.createBucket.mock.callCount(), 1);
      const call = mockStorage.createBucket.mock.calls[0];
      assert.strictEqual(call.arguments[0], 'test-bucket');
      assert.deepStrictEqual(call.arguments[1], {
        location: 'us-central1',
        metadata: { labels: labels },
      });
    });

    it('should fall back to randomized bucket if primary bucket belongs to a different project', async () => {
      let callCount = 0;
      mockBucket.exists.mock.mockImplementation(() => {
        callCount++;
        return Promise.resolve([callCount === 1]);
      });
      mockBucket.getMetadata.mock.mockImplementation(() =>
        Promise.resolve([{ projectNumber: '999999' }])
      );

      mockStorage.createBucket.mock.mockImplementation((name) =>
        Promise.resolve([{ name }])
      );

      const result = await storageApi.ensureStorageBucketExists(
        'test-project',
        'test-bucket',
        'us-central1',
        'token'
      );

      assert.ok(result.name.startsWith('test-bucket-'));
      assert.notStrictEqual(result.name, 'test-bucket');
      assert.strictEqual(mockStorage.createBucket.mock.callCount(), 1);
    });

    it('should throw security error if fallback bucket also fails project ownership check', async () => {
      mockBucket.exists.mock.mockImplementation(() => Promise.resolve([true]));
      mockBucket.getMetadata.mock.mockImplementation(() =>
        Promise.resolve([{ projectNumber: '999999' }])
      );

      await assert.rejects(async () => {
        await storageApi.ensureStorageBucketExists(
          'test-project',
          'test-bucket',
          'us-central1',
          'token',
          undefined,
          true
        );
      }, /Security Error: Fallback bucket test-bucket belongs to project number 999999/);
    });
  });

  describe('uploadToStorageBucket', () => {
    it('should upload buffer and return file with generation metadata', async () => {
      const result = await storageApi.uploadToStorageBucket(
        mockBucket,
        Buffer.from('test data'),
        'source.tar.gz'
      );

      assert.strictEqual(result.name, 'source.tar.gz');
      assert.strictEqual(mockBucket.file.mock.callCount(), 2);
    });
  });
});
