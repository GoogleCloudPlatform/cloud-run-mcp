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

import assert from 'node:assert/strict';
import { describe, it, mock, beforeEach, afterEach } from 'node:test';
import esmock from 'esmock';

describe('ensureApisEnabled', () => {
  let billingMocks;
  let ensureApisEnabled;
  let mockServiceUsageClient;
  let mockProgressCallback;
  const projectId = 'test-project';
  const apis = ['test-api.googleapis.com'];

  beforeEach(async () => {
    billingMocks = {
      isBillingEnabled: mock.fn(),
      listBillingAccounts: mock.fn(),
      attachProjectToBillingAccount: mock.fn(),
    };
    const helpers = await esmock('../../lib/cloud-api/helpers.js', {
      '../../lib/cloud-api/billing.js': billingMocks,
    });
    ensureApisEnabled = helpers.ensureApisEnabled;
    mockServiceUsageClient = {
      getService: mock.fn(),
      enableService: mock.fn(() => [{ promise: () => Promise.resolve() }]),
    };
    mockProgressCallback = mock.fn();
  });

  afterEach(() => {
    mock.restoreAll();
  });

  describe('Billing Enabled', () => {
    it('should do nothing if API is already enabled', async () => {
      billingMocks.isBillingEnabled.mock.mockImplementation(() =>
        Promise.resolve(true)
      );
      mockServiceUsageClient.getService.mock.mockImplementation(() =>
        Promise.resolve([{ state: 'ENABLED' }])
      );

      await ensureApisEnabled(
        { serviceUsageClient: mockServiceUsageClient },
        projectId,
        apis,
        mockProgressCallback
      );

      assert.strictEqual(mockServiceUsageClient.getService.mock.callCount(), 1);
      assert.strictEqual(
        mockServiceUsageClient.enableService.mock.callCount(),
        0
      );
    });

    it('should enable API if it is disabled', async () => {
      billingMocks.isBillingEnabled.mock.mockImplementation(() =>
        Promise.resolve(true)
      );
      mockServiceUsageClient.getService.mock.mockImplementation(() =>
        Promise.resolve([{ state: 'DISABLED' }])
      );

      await ensureApisEnabled(
        { serviceUsageClient: mockServiceUsageClient },
        projectId,
        apis,
        mockProgressCallback
      );

      assert.strictEqual(mockServiceUsageClient.getService.mock.callCount(), 1);
      assert.strictEqual(
        mockServiceUsageClient.enableService.mock.callCount(),
        1
      );
    });

    it('should retry enabling API if checkAndEnableApi fails once', async () => {
      billingMocks.isBillingEnabled.mock.mockImplementation(() =>
        Promise.resolve(true)
      );
      let getServiceCallCount = 0;
      mockServiceUsageClient.getService.mock.mockImplementation(() => {
        getServiceCallCount++;
        if (getServiceCallCount === 1) {
          return Promise.reject(new Error('First fail'));
        }
        return Promise.resolve([{ state: 'ENABLED' }]);
      });

      await ensureApisEnabled(
        { serviceUsageClient: mockServiceUsageClient },
        projectId,
        apis,
        mockProgressCallback
      );

      assert.strictEqual(mockServiceUsageClient.getService.mock.callCount(), 2);
      assert.strictEqual(
        mockServiceUsageClient.enableService.mock.callCount(),
        0
      );
    });

    it('should throw if checkAndEnableApi fails after retry', async () => {
      billingMocks.isBillingEnabled.mock.mockImplementation(() =>
        Promise.resolve(true)
      );
      mockServiceUsageClient.getService.mock.mockImplementation(() =>
        Promise.reject(new Error('Always fail'))
      );

      await assert.rejects(
        () =>
          ensureApisEnabled(
            { serviceUsageClient: mockServiceUsageClient },
            projectId,
            apis,
            mockProgressCallback
          ),
        {
          message:
            'Failed to ensure API [test-api.googleapis.com] is enabled after retry. Please check manually.',
        }
      );
      assert.strictEqual(mockServiceUsageClient.getService.mock.callCount(), 2);
    });
  });

  describe('Billing Disabled', () => {
    it('should throw if no billing accounts are found', async () => {
      billingMocks.isBillingEnabled.mock.mockImplementation(() =>
        Promise.resolve(false)
      );
      billingMocks.listBillingAccounts.mock.mockImplementation(() =>
        Promise.resolve([])
      );

      await assert.rejects(
        () =>
          ensureApisEnabled(
            { serviceUsageClient: mockServiceUsageClient },
            projectId,
            apis,
            mockProgressCallback
          ),
        {
          message: `Billing is not enabled for project ${projectId}, and it could not be enabled automatically because no billing accounts were found. Please enable billing to use Google Cloud services: https://console.cloud.google.com/billing/linkedaccount?project=${projectId}`,
        }
      );
    });

    it('should throw if multiple billing accounts are found', async () => {
      billingMocks.isBillingEnabled.mock.mockImplementation(() =>
        Promise.resolve(false)
      );
      billingMocks.listBillingAccounts.mock.mockImplementation(() =>
        Promise.resolve([{}, {}])
      );

      await assert.rejects(
        () =>
          ensureApisEnabled(
            { serviceUsageClient: mockServiceUsageClient },
            projectId,
            apis,
            mockProgressCallback
          ),
        {
          message: `Billing is not enabled for project ${projectId}, and it could not be enabled automatically because multiple billing accounts were found. Please enable billing to use Google Cloud services: https://console.cloud.google.com/billing/linkedaccount?project=${projectId}`,
        }
      );
    });

    it('should throw if the only billing account is not open', async () => {
      billingMocks.isBillingEnabled.mock.mockImplementation(() =>
        Promise.resolve(false)
      );
      billingMocks.listBillingAccounts.mock.mockImplementation(() =>
        Promise.resolve([{ displayName: 'Closed Account', open: false }])
      );

      await assert.rejects(
        () =>
          ensureApisEnabled(
            { serviceUsageClient: mockServiceUsageClient },
            projectId,
            apis,
            mockProgressCallback
          ),
        {
          message: `Billing is not enabled for project ${projectId}, and it could not be enabled automatically because the only available billing account 'Closed Account' is not open. Please enable billing to use Google Cloud services: https://console.cloud.google.com/billing/linkedaccount?project=${projectId}`,
        }
      );
    });

    it('should attach billing and enable API if one open account is found', async () => {
      billingMocks.isBillingEnabled.mock.mockImplementation(() =>
        Promise.resolve(false)
      );
      billingMocks.listBillingAccounts.mock.mockImplementation(() =>
        Promise.resolve([
          {
            name: 'billingAccounts/123',
            displayName: 'Open Account',
            open: true,
          },
        ])
      );
      billingMocks.attachProjectToBillingAccount.mock.mockImplementation(() =>
        Promise.resolve({ billingEnabled: true })
      );
      mockServiceUsageClient.getService.mock.mockImplementation(() =>
        Promise.resolve([{ state: 'ENABLED' }])
      );

      await ensureApisEnabled(
        { serviceUsageClient: mockServiceUsageClient },
        projectId,
        apis,
        mockProgressCallback
      );

      assert.strictEqual(
        billingMocks.attachProjectToBillingAccount.mock.callCount(),
        1
      );
      assert.strictEqual(mockServiceUsageClient.getService.mock.callCount(), 1);
      assert.strictEqual(
        mockServiceUsageClient.enableService.mock.callCount(),
        0
      );
    });

    it('should throw if attaching the billing account fails', async () => {
      billingMocks.isBillingEnabled.mock.mockImplementation(() =>
        Promise.resolve(false)
      );
      billingMocks.listBillingAccounts.mock.mockImplementation(() =>
        Promise.resolve([
          {
            name: 'billingAccounts/123',
            displayName: 'Open Account',
            open: true,
          },
        ])
      );
      billingMocks.attachProjectToBillingAccount.mock.mockImplementation(() =>
        Promise.resolve({ billingEnabled: false })
      );

      await assert.rejects(
        () =>
          ensureApisEnabled(
            { serviceUsageClient: mockServiceUsageClient },
            projectId,
            apis,
            mockProgressCallback
          ),
        {
          message: `Failed to automatically attach project ${projectId} to billing account billingAccounts/123. Please enable billing manually: https://console.cloud.google.com/billing/linkedaccount?project=${projectId}`,
        }
      );
      assert.strictEqual(
        billingMocks.attachProjectToBillingAccount.mock.callCount(),
        1
      );
    });
  });
});
