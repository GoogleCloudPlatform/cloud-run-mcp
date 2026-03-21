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
import { describe, it, mock } from 'node:test';
import esmock from 'esmock';

describe('Cloud Run API Helpers', () => {
  const projectId = 'test-project';
  const location = 'europe-west1';
  const serviceId = 'test-service';
  const accessToken = 'test-token';
  const resource = `projects/${projectId}/locations/${location}/services/${serviceId}`;

  it('setServicePublicAccess should set IAM policy for allUsers', async () => {
    const setIamPolicyMock = mock.fn(async () => ({}));
    const runClientMock = {
      setIamPolicy: setIamPolicyMock,
      servicePath: mock.fn(() => resource),
    };

    const getRunClientMock = mock.fn(async () => runClientMock);
    const logAndProgressMock = mock.fn();
    const callWithRetryMock = mock.fn((fn) => fn());

    const { setServicePublicAccess } = await esmock(
      '../../../lib/cloud-api/run.js',
      {
        '../../../lib/clients.js': {
          getRunClient: getRunClientMock,
        },
        '../../../lib/cloud-api/helpers.js': {
          callWithRetry: callWithRetryMock,
        },
        '../../../lib/util/helpers.js': {
          logAndProgress: logAndProgressMock,
        },
      }
    );

    await setServicePublicAccess(
      projectId,
      location,
      serviceId,
      accessToken,
      logAndProgressMock
    );

    assert.equal(getRunClientMock.mock.callCount(), 1);
    assert.deepEqual(getRunClientMock.mock.calls[0].arguments, [
      projectId,
      accessToken,
    ]);

    assert.equal(setIamPolicyMock.mock.callCount(), 1);
    const setIamPolicyRequest = setIamPolicyMock.mock.calls[0].arguments[0];
    assert.equal(setIamPolicyRequest.resource, resource);
    assert.deepEqual(setIamPolicyRequest.policy.bindings[0], {
      role: 'roles/run.invoker',
      members: ['allUsers'],
    });

    assert.ok(
      logAndProgressMock.mock.calls.some((call) =>
        call.arguments[0].includes(
          `Setting public access for service ${serviceId}`
        )
      )
    );
  });

  it('setServicePublicAccess should throw if setIamPolicy fails', async () => {
    const error = new Error('IAM Update Failed');
    const setIamPolicyMock = mock.fn(async () => {
      throw error;
    });
    const runClientMock = {
      setIamPolicy: setIamPolicyMock,
      servicePath: mock.fn(() => resource),
    };

    const getRunClientMock = mock.fn(async () => runClientMock);
    const logAndProgressMock = mock.fn();

    const { setServicePublicAccess } = await esmock(
      '../../../lib/cloud-api/run.js',
      {
        '../../../lib/clients.js': {
          getRunClient: getRunClientMock,
        },
        '../../../lib/cloud-api/helpers.js': {
          callWithRetry: (fn) => fn(),
        },
        '../../../lib/util/helpers.js': {
          logAndProgress: logAndProgressMock,
        },
      }
    );

    await assert.rejects(
      setServicePublicAccess(
        projectId,
        location,
        serviceId,
        accessToken,
        logAndProgressMock
      ),
      error
    );
  });
});
