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
import { registerPrompts } from '../prompts.js';

describe('registerPrompts', () => {
  it('should register deploy and logs prompts', () => {
    const server = {
      prompt: mock.fn(),
    };

    registerPrompts(server);

    assert.strictEqual(server.prompt.mock.callCount(), 2);
    assert.strictEqual(server.prompt.mock.calls[0].arguments[0], 'deploy');
    assert.strictEqual(server.prompt.mock.calls[1].arguments[0], 'logs');
  });

  describe('deploy prompt', () => {
    it('should use the provided name', async () => {
      const server = {
        prompt: mock.fn(),
      };
      registerPrompts(server);
      const handler = server.prompt.mock.calls[0].arguments[3];
      const result = await handler({ name: 'my-service' });
      assert.deepStrictEqual(result, {
        messages: [{
          role: "user",
          content: {
            type: 'text',
            text: `deploy_local_folder({folderPath: '.', service: 'my-service'})`
          }
        }]
      });
    });

    it('should use DEFAULT_SERVICE_NAME env var', async () => {
      const server = {
        prompt: mock.fn(),
      };
      process.env.DEFAULT_SERVICE_NAME = 'default-service';
      registerPrompts(server);
      const handler = server.prompt.mock.calls[0].arguments[3];
      const result = await handler({});
      assert.deepStrictEqual(result, {
        messages: [{
          role: "user",
          content: {
            type: 'text',
            text: `deploy_local_folder({folderPath: '.', service: 'default-service'})`
          }
        }]
      });
      delete process.env.DEFAULT_SERVICE_NAME;
    });

    it('should use PWD env var', async () => {
      const server = {
        prompt: mock.fn(),
      };
      process.env.PWD = '/path/to/my-project';
      registerPrompts(server);
      const handler = server.prompt.mock.calls[0].arguments[3];
      const result = await handler({});
      assert.deepStrictEqual(result, {
        messages: [{
          role: "user",
          content: {
            type: 'text',
            text: `deploy_local_folder({folderPath: '.', service: '/path/to/my-project'})`
          }
        }]
      });
      delete process.env.PWD;
    });
  });

  describe('logs prompt', () => {
    it('should use the provided service name', async () => {
      const server = {
        prompt: mock.fn(),
      };
      registerPrompts(server);
      const handler = server.prompt.mock.calls[1].arguments[3];
      const result = await handler({ service: 'my-service' });
      assert.deepStrictEqual(result, {
        messages: [{
          role: "user",
          content: {
            type: 'text',
            text: `get_service_log({service: 'my-service'})`
          }
        }]
      });
    });

    it('should use DEFAULT_SERVICE_NAME env var', async () => {
      const server = {
        prompt: mock.fn(),
      };
      process.env.DEFAULT_SERVICE_NAME = 'default-service';
      registerPrompts(server);
      const handler = server.prompt.mock.calls[1].arguments[3];
      const result = await handler({});
      assert.deepStrictEqual(result, {
        messages: [{
          role: "user",
          content: {
            type: 'text',
            text: `get_service_log({service: 'default-service'})`
          }
        }]
      });
      delete process.env.DEFAULT_SERVICE_NAME;
    });

    it('should use PWD env var', async () => {
      const server = {
        prompt: mock.fn(),
      };
      process.env.PWD = '/path/to/my-project';
      registerPrompts(server);
      const handler = server.prompt.mock.calls[1].arguments[3];
      const result = await handler({});
      assert.deepStrictEqual(result, {
        messages: [{
          role: "user",
          content: {
            type: 'text',
            text: `get_service_log({service: '/path/to/my-project'})`
          }
        }]
      });
      delete process.env.PWD;
    });
  });
});
