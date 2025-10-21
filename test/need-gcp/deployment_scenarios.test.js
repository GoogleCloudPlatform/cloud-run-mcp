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
  deleteProject,
} from '../../lib/cloud-api/projects.js';
import { deployImage, deploy } from '../../lib/deployment/deployer.js';
import {
  callWithRetry,
  ensureApisEnabled,
} from '../../lib/cloud-api/helpers.js';

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

async function setupProject(testContext, isSourceDeploy = false) {
  const projectId = 'test-' + generateProjectId();
  console.log(`Generated project ID: ${projectId}`);
  const parent = process.env.GCP_PARENT || process.argv[2];
  const newProjectResult = await createProjectAndAttachBilling(
    projectId,
    parent
  );
  assert(
    newProjectResult?.projectId,
    `Project creation failed for ${projectId}`
  );
  console.log(`Successfully created project: ${newProjectResult.projectId}`);
  console.log(newProjectResult.billingMessage);

  testContext.after(async () => {
    try {
      await deleteProject(projectId);
    } catch (e) {
      console.error(`Failed to delete project ${projectId}:`, e.message);
    }
  });

  if (isSourceDeploy) {
    const { ServiceUsageClient } = await import('@google-cloud/service-usage');
    const serviceUsageClient = new ServiceUsageClient({ projectId });
    const context = {
      serviceUsageClient: serviceUsageClient,
    };
    await ensureApisEnabled(context, projectId, ['run.googleapis.com']);
    console.log('Adding editor role to Compute SA...');
    const projectNumber = await getProjectNumber(newProjectResult.projectId);
    const member = `serviceAccount:${projectNumber}-compute@developer.gserviceaccount.com`;
    await callWithRetry(
      () =>
        addIamPolicyBinding(newProjectResult.projectId, member, 'roles/editor'),
      `addIamPolicyBinding roles/editor to ${member}`
    );
    console.log('Compute SA editor role added.');
  }
  return projectId;
}

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
  const projectId = await setupProject(testContext, true);
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
  const projectId = await setupProject(testContext, true);
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
