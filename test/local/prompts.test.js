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
    it('should return the checklist message', async () => {
      const server = {
        registerPrompt: mock.fn(),
      };
      registerPrompts(server);
      const handler = server.registerPrompt.mock.calls[0].arguments[2];
      const result = await handler({});
      assert.deepStrictEqual(result, {
        messages: [
          {
            role: 'user',
            content: {
              type: 'text',
              text: `You are a Cloud Run deploy assistant. Perform the checks below and then, if everything looks OK, use the deploy_local_folder tool to deploy the current folder.

Checklist (run these analyses against the repository):

1) Confirm target project, service name, and region:
   - If an explicit project, service name, or region is configured in the environment or repo, state them. If not, propose sensible defaults (project from gcloud config, service name = current directory name, region = us-central1).

2) Port handling:
   - Detect whether the application listens on port 8080 or uses the PORT environment variable (e.g., process.env.PORT). Search common entry points and server files and state the evidence.

3) Dockerfile vs Buildpacks:
   - Detect whether a Dockerfile exists at the repository root. If one exists, report whether the Dockerfile clearly exposes or uses port 8080 or the PORT env var.
   - If there is no Dockerfile, analyze language, package.json, and build scripts to determine whether Buildpacks are likely to succeed. Provide a short justification: "Likely" or "Unlikely" and 1–2 lines of reasoning.

4) Preconditions and credentials:
   - If gcloud credentials or an active project are missing, ask the user before proceeding.

5) Summary and action:
   - Summarize findings in a single concise paragraph.
   - If everything looks deployable, call the deploy_local_folder tool with the chosen service name, project, and region and include a one-line justification for why deploy is safe.
   - If issues are detected, explain the blocking issues and ask the user for confirmation or corrective steps before deploying.

When using tools to read files, prefer exact file references (for example, package.json, Dockerfile, and common server entrypoints). Keep the output concise and actionable. Only proceed with deploy_local_folder after the user confirms or after automatic checks pass and credentials/project are available.`,
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
