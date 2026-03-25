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

describe('secrets.js', () => {
  let mockSecretManagerClient;
  let getSecretMock, getSecretImpl;
  let createSecretMock, createSecretImpl;
  let addSecretVersionMock, addSecretVersionImpl;
  let getIamPolicyMock, getIamPolicyImpl;
  let setIamPolicyMock, setIamPolicyImpl;
  let logAndProgressMock;
  let secrets;

  const projectId = 'test-project';
  const secretName = 'test-secret';
  const accessToken = 'test-token';

  beforeEach(async () => {
    getSecretImpl = () => Promise.reject({ code: 5 });
    getSecretMock = mock.fn((...args) => getSecretImpl(...args));

    createSecretImpl = () => Promise.resolve([{}]);
    createSecretMock = mock.fn((...args) => createSecretImpl(...args));

    addSecretVersionImpl = () => Promise.resolve([{}]);
    addSecretVersionMock = mock.fn((...args) => addSecretVersionImpl(...args));

    getIamPolicyImpl = () => Promise.resolve([{}]);
    getIamPolicyMock = mock.fn((...args) => getIamPolicyImpl(...args));

    setIamPolicyImpl = () => Promise.resolve([{}]);
    setIamPolicyMock = mock.fn((...args) => setIamPolicyImpl(...args));

    logAndProgressMock = mock.fn();

    mockSecretManagerClient = {
      getSecret: getSecretMock,
      createSecret: createSecretMock,
      addSecretVersion: addSecretVersionMock,
      getIamPolicy: getIamPolicyMock,
      setIamPolicy: setIamPolicyMock,
    };

    secrets = await esmock('../../../lib/cloud-api/secrets.js', {
      '../../../lib/clients.js': {
        getSecretManagerClient: () => Promise.resolve(mockSecretManagerClient),
      },
      '../../../lib/util/helpers.js': {
        logAndProgress: logAndProgressMock,
      },
    });
  });

  afterEach(() => {
    mock.restoreAll();
  });

  describe('getSecret', () => {
    it('should return secret metadata if it exists', async () => {
      const mockSecret = { name: `projects/${projectId}/secrets/${secretName}` };
      getSecretImpl = () => Promise.resolve([mockSecret]);

      const result = await secrets.getSecret(projectId, secretName, accessToken);

      assert.deepEqual(result, mockSecret);
      assert.equal(getSecretMock.mock.callCount(), 1);
      assert.deepEqual(getSecretMock.mock.calls[0].arguments[0], {
        name: `projects/${projectId}/secrets/${secretName}`,
      });
    });

    it('should return null if secret does not exist (error code 5)', async () => {
      getSecretImpl = () => Promise.reject({ code: 5 });

      const result = await secrets.getSecret(projectId, secretName, accessToken);

      assert.strictEqual(result, null);
    });

    it('should throw error for other error codes', async () => {
      getSecretImpl = () => Promise.reject({ code: 3 });

      await assert.rejects(
        () => secrets.getSecret(projectId, secretName, accessToken),
        { code: 3 }
      );
    });
  });

  describe('createSecret', () => {
    it('should create a secret successfully', async () => {
      const mockSecret = { name: `projects/${projectId}/secrets/${secretName}` };
      createSecretImpl = () => Promise.resolve([mockSecret]);

      const result = await secrets.createSecret(
        projectId,
        secretName,
        accessToken,
        () => { }
      );

      assert.deepEqual(result, mockSecret);
      assert.equal(createSecretMock.mock.callCount(), 1);
      assert.deepEqual(createSecretMock.mock.calls[0].arguments[0], {
        parent: `projects/${projectId}`,
        secretId: secretName,
        secret: {
          replication: {
            automatic: {},
          },
        },
      });
    });
  });

  describe('addSecretVersion', () => {
    it('should add a secret version successfully', async () => {
      const mockVersion = {
        name: `projects/${projectId}/secrets/${secretName}/versions/1`,
      };
      addSecretVersionImpl = () => Promise.resolve([mockVersion]);
      const content = 'secret-content';

      const result = await secrets.addSecretVersion(
        projectId,
        secretName,
        content,
        accessToken,
        () => { }
      );

      assert.deepEqual(result, mockVersion);
      assert.equal(addSecretVersionMock.mock.callCount(), 1);
      assert.deepEqual(addSecretVersionMock.mock.calls[0].arguments[0], {
        parent: `projects/${projectId}/secrets/${secretName}`,
        payload: {
          data: Buffer.from(content),
        },
      });
    });
  });

  describe('getSecretIamPolicy', () => {
    it('should return IAM policy successfully', async () => {
      const mockPolicy = { bindings: [] };
      getIamPolicyImpl = () => Promise.resolve([mockPolicy]);

      const result = await secrets.getSecretIamPolicy(
        projectId,
        secretName,
        accessToken
      );

      assert.deepEqual(result, mockPolicy);
      assert.equal(getIamPolicyMock.mock.callCount(), 1);
    });
  });

  describe('setSecretIamPolicy', () => {
    it('should set IAM policy successfully', async () => {
      const mockPolicy = { bindings: [] };
      setIamPolicyImpl = () => Promise.resolve([mockPolicy]);

      const result = await secrets.setSecretIamPolicy(
        projectId,
        secretName,
        mockPolicy,
        accessToken,
        () => { }
      );

      assert.deepEqual(result, mockPolicy);
      assert.equal(setIamPolicyMock.mock.callCount(), 1);
    });
  });

  describe('addSecretAccessorBinding', () => {
    it('should add binding if it does not exist', async () => {
      const initialPolicy = { bindings: [] };
      const updatedPolicy = {
        bindings: [
          {
            role: 'roles/secretmanager.secretAccessor',
            members: ['serviceAccount:test-sa'],
          },
        ],
      };

      getIamPolicyImpl = () => Promise.resolve([initialPolicy]);
      setIamPolicyImpl = () => Promise.resolve([updatedPolicy]);

      const result = await secrets.addSecretAccessorBinding(
        projectId,
        secretName,
        'serviceAccount:test-sa',
        accessToken,
        () => { }
      );

      assert.deepEqual(result, updatedPolicy);
      assert.equal(setIamPolicyMock.mock.callCount(), 1);
      assert.deepEqual(
        setIamPolicyMock.mock.calls[0].arguments[0].policy,
        updatedPolicy
      );
    });

    it('should not update if binding already exists', async () => {
      const existingPolicy = {
        bindings: [
          {
            role: 'roles/secretmanager.secretAccessor',
            members: ['serviceAccount:test-sa'],
          },
        ],
      };

      getIamPolicyImpl = () => Promise.resolve([existingPolicy]);

      const result = await secrets.addSecretAccessorBinding(
        projectId,
        secretName,
        'serviceAccount:test-sa',
        accessToken,
        () => { }
      );

      assert.deepEqual(result, existingPolicy);
      assert.equal(setIamPolicyMock.mock.callCount(), 0);
    });
  });
});
