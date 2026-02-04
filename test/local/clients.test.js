import { test, describe } from 'node:test';
import assert from 'node:assert';
import { getClient } from '../../lib/clients.js';

describe('getClient Helper', () => {
  class MockClient {
    constructor(options) {
      this.options = options;
    }
  }

  test('creates new client instance with authClient when access token provided', async () => {
    const projectId = 'test-project-1';
    const accessToken = 'fake-token-1';
    const service = 'run'; // Must match keys in lib/clients.js clients object
    const key = projectId + accessToken;

    const client = await getClient(
      service,
      key,
      async () => MockClient,
      { projectId },
      accessToken
    );

    assert.ok(client instanceof MockClient);
    assert.strictEqual(client.options.projectId, projectId);
    assert.ok(client.options.authClient);

    const headers = await client.options.authClient.getRequestHeaders();
    // 'run' is a gRPC service, so it should be wrapped to return a Map
    assert.ok(headers instanceof Map);
    assert.strictEqual(headers.get('Authorization'), 'Bearer fake-token-1');
  });

  test('creates new client instance WITHOUT authClient when NO access token provided', async () => {
    const projectId = 'test-project-2';
    const service = 'run';
    const key = projectId;

    const client = await getClient(
      service,
      key,
      async () => MockClient,
      { projectId },
      null
    );

    assert.ok(client instanceof MockClient);
    assert.strictEqual(client.options.projectId, projectId);
    assert.strictEqual(client.options.authClient, undefined);
  });

  test('caches client instances by key', async () => {
    const projectId = 'test-project-3';
    const accessToken = 'token-A';
    const service = 'run';
    const key = projectId + accessToken;

    const client1 = await getClient(
      service,
      key,
      async () => MockClient,
      { projectId },
      accessToken
    );

    const client2 = await getClient(
      service,
      key,
      async () => MockClient,
      { projectId },
      accessToken
    );

    assert.strictEqual(client1, client2);
  });

  test('creates DIFFERENT client instances for different keys', async () => {
    const projectId = 'test-project-4';
    const service = 'run';

    const client1 = await getClient(
      service,
      projectId + 'token-A',
      async () => MockClient,
      { projectId },
      'token-A'
    );

    const client2 = await getClient(
      service,
      projectId + 'token-B',
      async () => MockClient,
      { projectId },
      'token-B'
    );

    assert.notStrictEqual(client1, client2);

    const h1 = await client1.options.authClient.getRequestHeaders();
    assert.ok(h1 instanceof Map);
    assert.strictEqual(h1.get('Authorization'), 'Bearer token-A');

    const h2 = await client2.options.authClient.getRequestHeaders();
    assert.ok(h2 instanceof Map);
    assert.strictEqual(h2.get('Authorization'), 'Bearer token-B');
  });

  test('supports different services', async () => {
    const projectId = 'test-project-5';
    const accessToken = 'token-C';

    const runClient = await getClient(
      'run',
      projectId + accessToken,
      async () => MockClient,
      { projectId },
      accessToken
    );

    const storageClient = await getClient(
      'storage',
      projectId + accessToken,
      async () => MockClient,
      { projectId },
      accessToken
    );

    assert.notStrictEqual(runClient, storageClient); // Different maps
    assert.ok(runClient.options.authClient);
    assert.ok(storageClient.options.authClient);

    const runHeaders = await runClient.options.authClient.getRequestHeaders();
    assert.ok(runHeaders instanceof Map, 'Run client headers should be a Map');

    const storageHeaders =
      await storageClient.options.authClient.getRequestHeaders();
    assert.ok(
      !(storageHeaders instanceof Map),
      'Storage client headers should NOT be a Map'
    );
    assert.strictEqual(storageHeaders.Authorization, `Bearer ${accessToken}`);

    const loggingClient = await getClient(
      'logging',
      projectId + accessToken,
      async () => MockClient,
      { projectId },
      accessToken
    );
    const loggingHeaders =
      await loggingClient.options.authClient.getRequestHeaders();
    assert.ok(
      !(loggingHeaders instanceof Map),
      'Logging client headers should NOT be a Map'
    );
    assert.strictEqual(loggingHeaders.Authorization, `Bearer ${accessToken}`);
  });

  test('passes additional options correctly', async () => {
    const projectId = 'test-project-6';
    const service = 'run';
    const extraOpt = 'foo';

    const client = await getClient(
      service,
      projectId,
      async () => MockClient,
      { projectId, extraOpt },
      null
    );

    assert.strictEqual(client.options.extraOpt, extraOpt);
  });
});
