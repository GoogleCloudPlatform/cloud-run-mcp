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
import { callWithRetry } from '../../lib/cloud-api/helpers.js';

/**
 * Gets project number from project ID.
 * @param {string} projectId
 * @returns {Promise<string>} project number
 */
export async function getProjectNumber(projectId) {
  const { ProjectsClient } = await import('@google-cloud/resource-manager');
  const client = new ProjectsClient();
  try {
    const [project] = await client.getProject({
      name: `projects/${projectId}`,
    });
    // project.name is in format projects/123456
    return project.name.split('/')[1];
  } catch (error) {
    console.error(
      `Error getting project number for project ${projectId}:`,
      error.message
    );
    throw error;
  }
}

/**
 * Creates a service account.
 * @param {string} projectId The project ID.
 * @param {string} accountId The service account ID.
 * @param {string} displayName The service account display name.
 * @returns {Promise<string>} service account email.
 */
export async function createServiceAccount(projectId, accountId, displayName) {
  const { IAMClient } = await import('@google-cloud/iam');
  const client = new IAMClient();
  try {
    const [sa] = await client.createServiceAccount({
      name: `projects/${projectId}`,
      accountId,
      serviceAccount: {
        displayName,
      },
    });
    return sa.email;
  } catch (error) {
    console.error(
      `Error creating service account for project ${projectId}:`,
      error.message
    );
    throw error;
  }
}

/**
 * Adds an IAM policy binding to a project.
 * @param {string} projectId The project ID.
 * @param {string} member The member to add, e.g., 'user:foo@example.com'.
 * @param {string} role The role to grant, e.g., 'roles/viewer'.
 */
export async function addIamPolicyBinding(projectId, member, role) {
  const { ProjectsClient } = await import('@google-cloud/resource-manager');
  const client = new ProjectsClient();

  console.log(
    `Adding IAM binding for ${member} with role ${role} to project ${projectId}`
  );

  try {
    const [policy] = await client.getIamPolicy({
      resource: `projects/${projectId}`,
    });

    console.log('Current IAM Policy:', JSON.stringify(policy, null, 2));

    // Check if the binding already exists
    const binding = policy.bindings.find((b) => b.role === role);
    if (binding) {
      if (!binding.members.includes(member)) {
        binding.members.push(member);
      }
    } else {
      policy.bindings.push({
        role: role,
        members: [member],
      });
    }

    console.log('Updated IAM Policy:', JSON.stringify(policy, null, 2));

    // Set the updated policy
    await client.setIamPolicy({
      resource: `projects/${projectId}`,
      policy: policy,
    });

    console.log(
      `Successfully added IAM binding for ${member} with role ${role} to project ${projectId}`
    );
  } catch (error) {
    console.error(
      `Error adding IAM policy binding to project ${projectId}:`,
      error.message
    );
    throw error;
  }
}

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

  // // Create custom service account for Cloud Build.
  // const buildServiceAccount = await createServiceAccount(
  //   newProjectResult.projectId,
  //   'cloud-build-sa',
  //   'Cloud Build Service Account'
  // );
  // const buildServiceAccountMember = `serviceAccount:${buildServiceAccount}`;

  // // It needs cloud build builder to be able to run builds.
  // await addIamPolicyBinding(
  //   newProjectResult.projectId,
  //   buildServiceAccountMember,
  //   'roles/cloudbuild.builds.builder'
  // );

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

  console.log('Adding editor role to Compute SA...');
  const projectNumber = await getProjectNumber(newProjectResult.projectId);
  const member = `serviceAccount:${projectNumber}-compute@developer.gserviceaccount.com`;
  await callWithRetry(
    () =>
      addIamPolicyBinding(newProjectResult.projectId, member, 'roles/editor'),
    `addIamPolicyBinding roles/editor to ${member}`
  );
  console.log('Compute SA editor role added.');

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
  try {
    await deploy(configFailingBuild);
  } catch (error) {
    console.log('blah blah', error);
  }

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
