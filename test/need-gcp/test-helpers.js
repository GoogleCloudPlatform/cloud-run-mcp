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
import assert from 'node:assert';
import {
  createProjectAndAttachBilling,
  deleteProject,
  generateProjectId,
} from '../../lib/cloud-api/projects.js';
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
      `Successfully added IAM binding for ${member} with role ${
        role
      } to project ${projectId}`
    );
  } catch (error) {
    console.error(
      `Error adding IAM policy binding to project ${projectId}:`,
      error.message
    );
    throw error;
  }
}

/**
 * Create project, attach billing.
 * @returns {Promise<string>} projectId
 */
export async function setupProject() {
  const projectId = 'test-' + generateProjectId();
  console.log(`Generated project ID: ${projectId}`);
  const parent = process.env.GCP_PARENT || process.argv[2];
  const newProjectResult = await createProjectAndAttachBilling(
    projectId,
    parent
  );
  assert(newProjectResult, 'newProjectResult should not be null');
  assert(
    newProjectResult.projectId,
    'newProjectResult.projectId should not be null'
  );
  assert(
    newProjectResult.billingMessage,
    'newProjectResult.billingMessage should not be null'
  );
  assert(
    newProjectResult.billingMessage.startsWith(
      `Project ${newProjectResult.projectId} created successfully.`
    ),
    'newProjectResult.billingMessage should start with success message'
  );
  console.log(`Successfully created project: ${newProjectResult.projectId}`);
  console.log(newProjectResult.billingMessage);

  return projectId;
}

/**
 * Delete project
 * @param {string} projectId
 */
export async function cleanupProject(projectId) {
  try {
    await deleteProject(projectId);
    console.log(`Successfully deleted project: ${projectId}`);
  } catch (e) {
    console.error(`Failed to delete project ${projectId}:`, e.message);
  }
}

/**
 * Enable APIs and set IAM permissions for source deployments.
 * Note: This function is only needed for Cloud Build since it uses the compute
 * default service account. The compute service account needs the editor role to
 * deploy to Cloud Run, which is usually granted by default, but in this case we
 * ensure it due to restrictions in some organizations.
 * @param {string} projectId
 */
export async function setSourceDeployProjectPermissions(projectId) {
  const { ServiceUsageClient } = await import('@google-cloud/service-usage');
  const serviceUsageClient = new ServiceUsageClient({ projectId });
  const context = {
    serviceUsageClient: serviceUsageClient,
  };
  await ensureApisEnabled(context, projectId, [
    'run.googleapis.com',
    'cloudbilling.googleapis.com',
  ]);
  console.log('Adding editor role to Compute SA...');
  const projectNumber = await getProjectNumber(projectId);
  const member = `serviceAccount:${projectNumber}-compute@developer.gserviceaccount.com`;
  await callWithRetry(
    () => addIamPolicyBinding(projectId, member, 'roles/editor'),
    `addIamPolicyBinding roles/editor to ${member}`
  );
  console.log('Compute SA editor role added.');
}
