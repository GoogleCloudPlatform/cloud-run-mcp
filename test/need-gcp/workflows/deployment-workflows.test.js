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

import fs from 'fs/promises';
import assert from 'node:assert';
import { test } from 'node:test';
import path from 'path';

import { deploy, deployImage } from '../../../lib/deployment/deployer.js';
import {
  setSourceDeployProjectPermissions,
  setupProject,
} from '../test-helpers.js';

test('Scenario-1: Starting deployment of hello image...', async (testContext) => {
  const projectId = await setupProject(testContext);
  const configImageDeploy = {
    projectId: projectId,
    serviceName: 'hello-scenario',
    region: 'europe-west1',
    imageUrl: 'gcr.io/cloudrun/hello',
  };
  await deployImage(configImageDeploy);

  console.log('Scenario-1: Deployment completed.');
});

test('Scenario-2: Starting deployment with invalid files...', async (testContext) => {
  const projectId = await setupProject(testContext);
  await setSourceDeployProjectPermissions(projectId);
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
  await assert.rejects(
    deploy(configFailingBuild),
    { message: /ERROR: failed to detect: no buildpacks participating/ },
    'Deployment should have failed with a buildpack detection error'
  );
});

test('Scenario-3: Starting deployment of Go app with file content...', async (testContext) => {
  const projectId = await setupProject(testContext);
  await setSourceDeployProjectPermissions(projectId);
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
  console.log('Scenario-3: Deployment completed.');
});
