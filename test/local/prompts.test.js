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
import { registerPrompts } from '../../prompts.js';

describe('registerPrompts', () => {
  it('should register deploy and logs prompts', () => {
    const server = {
      registerPrompt: mock.fn(),
    };

    registerPrompts(server);

    assert.strictEqual(server.registerPrompt.mock.callCount(), 2);
    assert.strictEqual(
      server.registerPrompt.mock.calls[0].arguments[0],
      'deploy'
    );
    assert.strictEqual(
      server.registerPrompt.mock.calls[1].arguments[0],
      'logs'
    );
  });

  describe('deploy prompt', () => {
    it('should use the provided name', async () => {
      const server = {
        registerPrompt: mock.fn(),
      };
      registerPrompts(server);
      const handler = server.registerPrompt.mock.calls[0].arguments[2];
      const result = await handler({ name: 'my-service' });
      assert.deepStrictEqual(result, {
        messages: [
          {
            role: 'user',
            content: {
              type: 'text',
              text: `Use the deploy_local_folder tool to deploy the current folder. The service name should be my-service`,
            },
          },
        ],
      });
    });

    it('should use the current directory name', async () => {
      const server = {
        registerPrompt: mock.fn(),
      };
      registerPrompts(server);
      const handler = server.registerPrompt.mock.calls[0].arguments[2];
      const result = await handler({});
      const serviceName =
        'a name for the application based on the current working directory.';
      assert.deepStrictEqual(result, {
        messages: [
          {
            role: 'user',
            content: {
              type: 'text',
              text: `Use the deploy_local_folder tool to deploy the current folder. The service name should be ${serviceName}`,
            },
          },
        ],
      });
    });

    it('should use the provided project and region', async () => {
      const server = {
        registerPrompt: mock.fn(),
      };
      registerPrompts(server);
      const handler = server.registerPrompt.mock.calls[0].arguments[2];
      const result = await handler({
        name: 'my-service',
        project: 'my-project',
        region: 'my-region',
      });
      assert.deepStrictEqual(result, {
        messages: [
          {
            role: 'user',
            content: {
              type: 'text',
              text: `Use the deploy_local_folder tool to deploy the current folder in project my-project in region my-region. The service name should be my-service`,
            },
          },
        ],
      });
    });
  });

  describe('logs prompt', () => {
    it('should use the provided service name', async () => {
      const server = {
        registerPrompt: mock.fn(),
      };
      registerPrompts(server);
      const handler = server.registerPrompt.mock.calls[1].arguments[2];
      const result = await handler({ service: 'my-service' });
      assert.deepStrictEqual(result, {
        messages: [
          {
            role: 'user',
            content: {
              type: 'text',
              text: `Use get_service_log to get logs for the service my-service`,
            },
          },
        ],
      });
    });

    it('should use the current directory name for the service name', async () => {
      const server = {
        registerPrompt: mock.fn(),
      };
      registerPrompts(server);
      const handler = server.registerPrompt.mock.calls[1].arguments[2];
      const result = await handler({});
      const serviceName = 'named for the current working directory';
      assert.deepStrictEqual(result, {
        messages: [
          {
            role: 'user',
            content: {
              type: 'text',
              text: `Use get_service_log to get logs for the service ${serviceName}`,
            },
          },
        ],
      });
    });

    it('should use the provided project and region', async () => {
      const server = {
        registerPrompt: mock.fn(),
      };
      registerPrompts(server);
      const handler = server.registerPrompt.mock.calls[1].arguments[2];
      const result = await handler({
        service: 'my-service',
        project: 'my-project',
        region: 'my-region',
      });
      assert.deepStrictEqual(result, {
        messages: [
          {
            role: 'user',
            content: {
              type: 'text',
              text: `Use get_service_log to get logs in project my-project in region my-region for the service my-service`,
            },
          },
        ],
      });
    });
  });
});
