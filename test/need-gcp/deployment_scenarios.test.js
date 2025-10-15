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

import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'fs/promises';
import path from 'path';
import {
  createProjectAndAttachBilling,
  generateProjectId,
} from '../../lib/cloud-api/projects.js';
import { deployImage, deploy } from '../../lib/deployment/deployer.js';

test('should create a project and deploy hello image to it', async () => {
  console.log('Attempting to create a new project and deploy to it...');
  let newProjectResult = null;

  const projectId = 'test-' + generateProjectId(); // e.g., test-mcp-cvc-cvc format
  console.log(`Generated project ID: ${projectId}`);

  // Parent is required because service accounts cannot create projects without a parent.
  const parent = process.env.GCP_PARENT || process.argv[2];
  console.log(`Using parent: ${parent}`);

  newProjectResult = await createProjectAndAttachBilling(projectId, parent);
  assert(newProjectResult, 'newProjectResult should not be null');
  assert(
    newProjectResult.projectId,
    'newProjectResult.projectId should not be null'
  );

  console.log(`Successfully created project: ${newProjectResult.projectId}`);
  console.log(newProjectResult.billingMessage);

  console.log(`Deploying to project: ${newProjectResult.projectId}`);

  console.log('Scenario-1: Starting deployment of hello image...');
  const configImageDeploy = {
    projectId: newProjectResult.projectId,
    serviceName: 'hello-scenario',
    region: 'europe-west1',
    imageUrl: 'gcr.io/cloudrun/hello',
  };
  await deployImage(configImageDeploy);

  console.log('Scenario-1: Deployment completed.');

  console.log('Scenario-2: Starting deployment with invalid files...');
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
  console.log('Scenario-2: Deployment failed as expected.');

  console.log('Scenario-3: Starting deployment of Go app with file content...');
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

  console.log(
    `Successfully deployed to project: ${newProjectResult.projectId}`
  );
});
