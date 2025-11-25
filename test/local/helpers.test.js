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
    delete process.env.SKIP_API_DELAY;
  });

  beforeEach(() => {
    process.env.SKIP_API_DELAY = 'true';
  });

  describe('API Pre-checks', () => {
    it('should enable serviceusage, cloudbilling, then check billing and enable api list', async () => {
      billingMocks.isBillingEnabled.mock.mockImplementation(() =>
        Promise.resolve(true)
      );
      // Return DISABLED for all APIs
      mockServiceUsageClient.getService.mock.mockImplementation(() =>
        Promise.resolve([{ state: 'DISABLED' }])
      );

      await ensureApisEnabled(
        { serviceUsageClient: mockServiceUsageClient },
        projectId,
        apis,
        mockProgressCallback
      );

      // getService should be called for serviceusage, cloudbilling, and the test api
      assert.strictEqual(mockServiceUsageClient.getService.mock.callCount(), 3);
      assert.match(
        mockServiceUsageClient.getService.mock.calls[0].arguments[0].name,
        /serviceusage\.googleapis\.com/
      );
      assert.match(
        mockServiceUsageClient.getService.mock.calls[1].arguments[0].name,
        /cloudbilling\.googleapis\.com/
      );
      assert.match(
        mockServiceUsageClient.getService.mock.calls[2].arguments[0].name,
        /test-api\.googleapis\.com/
      );

      // enableService should be called for serviceusage, cloudbilling, and the test api
      assert.strictEqual(
        mockServiceUsageClient.enableService.mock.callCount(),
        3
      );
      assert.match(
        mockServiceUsageClient.enableService.mock.calls[0].arguments[0].name,
        /serviceusage\.googleapis\.com/
      );
      assert.match(
        mockServiceUsageClient.enableService.mock.calls[1].arguments[0].name,
        /cloudbilling\.googleapis\.com/
      );
      assert.match(
        mockServiceUsageClient.enableService.mock.calls[2].arguments[0].name,
        /test-api\.googleapis\.com/
      );

      // isBillingEnabled should be called once
      assert.strictEqual(billingMocks.isBillingEnabled.mock.callCount(), 1);
    });

    it('should only check billing and api list if prereq APIs enabled', async () => {
      billingMocks.isBillingEnabled.mock.mockImplementation(() =>
        Promise.resolve(true)
      );
      // Only disable the test API
      mockServiceUsageClient.getService.mock.mockImplementation(({ name }) => {
        if (name.includes('test-api')) {
          return Promise.resolve([{ state: 'DISABLED' }]);
        }
        return Promise.resolve([{ state: 'ENABLED' }]);
      });

      await ensureApisEnabled(
        { serviceUsageClient: mockServiceUsageClient },
        projectId,
        apis,
        mockProgressCallback
      );

      // getService should be called for serviceusage, cloudbilling, and the test api
      assert.strictEqual(mockServiceUsageClient.getService.mock.callCount(), 3);
      // enableService should only be called for the test api
      assert.strictEqual(
        mockServiceUsageClient.enableService.mock.callCount(),
        1
      );
      assert.match(
        mockServiceUsageClient.enableService.mock.calls[0].arguments[0].name,
        /test-api\.googleapis\.com/
      );
      // isBillingEnabled should be called once
      assert.strictEqual(billingMocks.isBillingEnabled.mock.callCount(), 1);
    });
  });

  describe('Billing Enabled', () => {
    it('should do nothing if all APIs are already enabled', async () => {
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

      assert.strictEqual(mockServiceUsageClient.getService.mock.callCount(), 3);
      assert.strictEqual(
        mockServiceUsageClient.enableService.mock.callCount(),
        0
      );
    });

    it('should enable API if it is disabled', async () => {
      billingMocks.isBillingEnabled.mock.mockImplementation(() =>
        Promise.resolve(true)
      );
      mockServiceUsageClient.getService.mock.mockImplementation(({ name }) => {
        if (name.includes('test-api')) {
          return Promise.resolve([{ state: 'DISABLED' }]);
        }
        return Promise.resolve([{ state: 'ENABLED' }]);
      });

      await ensureApisEnabled(
        { serviceUsageClient: mockServiceUsageClient },
        projectId,
        apis,
        mockProgressCallback
      );

      assert.strictEqual(mockServiceUsageClient.getService.mock.callCount(), 3);
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
      mockServiceUsageClient.getService.mock.mockImplementation(({ name }) => {
        // Ensure pre-checks pass
        if (name.includes('serviceusage') || name.includes('cloudbilling')) {
          return Promise.resolve([{ state: 'ENABLED' }]);
        }
        // Fail only for test-api on the first attempt
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

      assert.strictEqual(mockServiceUsageClient.getService.mock.callCount(), 4); // 2 pre-checks + 2 attempts for test-api
      assert.strictEqual(
        mockServiceUsageClient.enableService.mock.callCount(),
        0
      );
    });

    it('should throw if checkAndEnableApi fails after retry', async () => {
      billingMocks.isBillingEnabled.mock.mockImplementation(() =>
        Promise.resolve(true)
      );
      mockServiceUsageClient.getService.mock.mockImplementation(({ name }) => {
        // Ensure pre-checks pass
        if (name.includes('serviceusage') || name.includes('cloudbilling')) {
          return Promise.resolve([{ state: 'ENABLED' }]);
        }
        // Fail only for test-api
        return Promise.reject(new Error('Always fail'));
      });

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
      assert.strictEqual(mockServiceUsageClient.getService.mock.callCount(), 4); // 2 pre-checks + 2 attempts for test-api
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
      mockServiceUsageClient.getService.mock.mockImplementation(() =>
        Promise.resolve([{ state: 'ENABLED' }])
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
      mockServiceUsageClient.getService.mock.mockImplementation(() =>
        Promise.resolve([{ state: 'ENABLED' }])
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
      mockServiceUsageClient.getService.mock.mockImplementation(() =>
        Promise.resolve([{ state: 'ENABLED' }])
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
      assert.strictEqual(mockServiceUsageClient.getService.mock.callCount(), 3);
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
      mockServiceUsageClient.getService.mock.mockImplementation(() =>
        Promise.resolve([{ state: 'ENABLED' }])
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
