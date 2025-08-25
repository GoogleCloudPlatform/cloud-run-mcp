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

import { describe, test } from 'node:test';
import assert from 'node:assert';
import { deploy, deployImage } from '../../lib/cloud-run-deploy.js';
import fs from 'fs/promises';
import path from 'path';

const projectId = process.env.GOOGLE_CLOUD_PROJECT || process.argv[2];
if (!projectId) {
  console.error(
    'Usage: node <script> <projectId> or set GOOGLE_CLOUD_PROJECT'
  );
  process.exit(1);
}

describe('Cloud Run Deployments', () => {
  test('should deploy a container image', async () => {
    const configImageDeploy = {
      projectId: projectId,
      serviceName: 'hello-from-image',
      region: 'europe-west1',
      imageUrl: 'gcr.io/cloudrun/hello',
    };
    await deployImage(configImageDeploy);
  });

  test('should fail to deploy with invalid files', async () => {
    const configFailingBuild = {
      projectId: projectId,
      serviceName: 'example-failing-app',
      region: 'europe-west1',
      files: [
        {
          filename: 'main.txt',
          content:
            'This is not a valid application source file and should cause a build failure.',
        },
      ],
    };
    await assert.rejects(deploy(configFailingBuild));
  });

  

  test('should deploy a Go app with file content (Buildpacks)', async () => {
    const mainGoContent = await fs.readFile(
      path.resolve('example-sources-to-deploy/main.go'),
      'utf-8'
    );
    const goModContent = await fs.readFile(
      path.resolve('example-sources-to-deploy/go.mod'),
      'utf-8'
    );
    const configGoWithContent = {
      projectId: projectId,
      serviceName: 'example-go-app-content',
      region: 'europe-west1',
      files: [
        { filename: 'main.go', content: mainGoContent },
        { filename: 'go.mod', content: goModContent },
      ],
    };
    await deploy(configGoWithContent);
  });

  test('should fail to deploy without a service name', async () => {
    const config = {
      projectId: projectId,
      region: 'europe-west1',
      files: ['example-sources-to-deploy/main.go'],
    };
    await assert.rejects(deploy(config), {
      message: 'Error: serviceName is required in the configuration object.',
    });
  });

  test('should fail to deploy image without a service name', async () => {
    const config = {
      projectId: projectId,
      region: 'europe-west1',
      imageUrl: 'gcr.io/cloudrun/hello',
    };
    await assert.rejects(deployImage(config), {
      message: 'Error: serviceName is required in the configuration object.',
    });
  });

  test('should fail to deploy without a project id', async () => {
    const config = {
      serviceName: 'hello-from-image',
      region: 'europe-west1',
      files: ['example-sources-to-deploy/main.go'],
    };
    await assert.rejects(deploy(config), {
      message: 'Error: projectId is required in the configuration object.',
    });
  });

  test('should fail to deploy image without a project id', async () => {
    const config = {
      serviceName: 'hello-from-image',
      region: 'europe-west1',
      imageUrl: 'gcr.io/cloudrun/hello',
    };
    await assert.rejects(deployImage(config), {
      message: 'Error: projectId is required in the configuration object.',
    });
  });
});