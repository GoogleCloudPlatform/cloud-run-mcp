import { test, describe } from 'node:test';
import assert from 'node:assert';
import {
  getRunClient,
  getServiceUsageClient,
  getStorageClient,
  getCloudBuildClient,
  getArtifactRegistryClient,
  getLoggingClient,
  getBillingClient,
  getProjectsClient,
} from '../../lib/clients.js';

describe('Client Factory Caching', () => {
  test('getRunClient returns the same instance for the same projectId', async () => {
    const projectId = 'test-project-run';
    const client1 = await getRunClient(projectId);
    const client2 = await getRunClient(projectId);
    assert.strictEqual(
      client1,
      client2,
      'Run clients should be the same instance'
    );
  });

  test('getRunClient returns different instances for different projectIds', async () => {
    const client1 = await getRunClient('project-1');
    const client2 = await getRunClient('project-2');
    assert.notStrictEqual(
      client1,
      client2,
      'Run clients should be different instances'
    );
  });

  test('getServiceUsageClient caches instances', async () => {
    const projectId = 'test-project-usage';
    const client1 = await getServiceUsageClient(projectId);
    const client2 = await getServiceUsageClient(projectId);
    assert.strictEqual(client1, client2);
  });

  test('getStorageClient caches instances', async () => {
    const projectId = 'test-project-storage';
    const client1 = await getStorageClient(projectId);
    const client2 = await getStorageClient(projectId);
    assert.strictEqual(client1, client2);
  });

  test('getCloudBuildClient caches instances', async () => {
    const projectId = 'test-project-build';
    const client1 = await getCloudBuildClient(projectId);
    const client2 = await getCloudBuildClient(projectId);
    assert.strictEqual(client1, client2);
  });

  test('getArtifactRegistryClient caches instances', async () => {
    const projectId = 'test-project-artifact';
    const client1 = await getArtifactRegistryClient(projectId);
    const client2 = await getArtifactRegistryClient(projectId);
    assert.strictEqual(client1, client2);
  });

  test('getLoggingClient caches instances', async () => {
    const projectId = 'test-project-logging';
    const client1 = await getLoggingClient(projectId);
    const client2 = await getLoggingClient(projectId);
    assert.strictEqual(client1, client2);
  });

  test('getBillingClient caches instances', async () => {
    const client1 = await getBillingClient();
    const client2 = await getBillingClient();
    assert.strictEqual(client1, client2);
  });

  test('getBillingClient with explicit projectId caches separately', async () => {
    const projectId = 'billing-project-1';
    const client1 = await getBillingClient(projectId);
    const client2 = await getBillingClient(projectId);
    const globalClient = await getBillingClient();

    assert.strictEqual(client1, client2);
    assert.notStrictEqual(client1, globalClient);
  });

  test('getProjectsClient caches instances', async () => {
    const client1 = await getProjectsClient();
    const client2 = await getProjectsClient();
    assert.strictEqual(client1, client2);
  });
});
