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

import {
  listBillingAccounts,
  attachProjectToBillingAccount,
} from './gcp-billing-accounts.js';

/**
 * Lists all accessible Google Cloud Platform projects.
 * @async
 * @function listProjects
 * @returns {Promise<Array<{id: string}>>} A promise that resolves to an array of project objects, each with an 'id' property. Returns an empty array on error.
 */
export async function listProjects() {
  const { ProjectsClient } = await import('@google-cloud/resource-manager');
  const client = new ProjectsClient();
  try {
    const [projects] = await client.searchProjects();
    return projects.map((project) => ({
      id: project.projectId,
    }));
  } catch (error) {
    console.error('Error listing GCP projects:', error);
    return [];
  }
}

/**
 * Creates a new Google Cloud Platform project.
 * @async
 * @function createProject
 * @param {string} [projectId] - Optional. The desired ID for the new project. If not provided, a compliant ID will be generated automatically (e.g., app-cvc-cvc).
 * @returns {Promise<{projectId: string}|null>} A promise that resolves to an object containing the new project's ID.
 */
export async function createProject(projectId) {
  const { ProjectsClient } = await import('@google-cloud/resource-manager');
  const client = new ProjectsClient();
  let projectIdToUse = projectId;

  if (!projectIdToUse) {
    const consonants = 'bcdfghjklmnpqrstvwxyz';
    const vowels = 'aeiou';

    const getRandomChar = (source) =>
      source.charAt(Math.floor(Math.random() * source.length));

    const generateCVC = () => {
      const c1 = getRandomChar(consonants);
      const v = getRandomChar(vowels);
      const c2 = getRandomChar(consonants);
      return `${c1}${v}${c2}`;
    };

    const cvc1 = generateCVC();
    const cvc2 = generateCVC();
    projectIdToUse = `mcp-${cvc1}-${cvc2}`;
    console.log(`Project ID not provided, generated ID: ${projectIdToUse}`);
  }

  try {
    const projectPayload = { projectId: projectIdToUse };

    console.log(`Attempting to create project with ID: ${projectIdToUse}`);

    const [operation] = await client.createProject({ project: projectPayload });

    const [createdProjectResponse] = await operation.promise();

    console.log(
      `Project ${createdProjectResponse.projectId} created successfully.`
    );
    return {
      projectId: createdProjectResponse.projectId,
    };
  } catch (error) {
    console.error(
      `Error creating GCP project ${projectIdToUse}:`,
      error.message
    );
    throw error; // Re-throw to be caught by the caller
  }
}

/**
 * Creates a new Google Cloud Platform project and attempts to attach it to the first available billing account.
 * @async
 * @function createProjectAndAttachBilling
 * @param {string} [projectIdParam] - Optional. The desired ID for the new project.
 * @returns {Promise<{projectId: string, billingMessage: string}>} A promise that resolves to an object containing the project ID and a billing status message.
 */
export async function createProjectAndAttachBilling(projectIdParam) {
  let newProject;
  try {
    newProject = await createProject(projectIdParam);
  } catch (error) {
    throw new Error(`Failed to create project: ${error.message}`);
  }

  if (!newProject || !newProject.projectId) {
    throw new Error('Project creation did not return a valid project ID.');
  }

  const { projectId } = newProject;
  let billingMessage = `Project ${projectId} created.`;

  try {
    const billingAccounts = await listBillingAccounts();
    if (billingAccounts && billingAccounts.length > 0) {
      const firstBillingAccount = billingAccounts.find((acc) => acc.open); // Prefer an open account
      if (firstBillingAccount) {
        console.log(
          `Found billing account: ${firstBillingAccount.displayName} (${firstBillingAccount.name}). Attempting to attach project ${projectId}.`
        );
        const billingInfo = await attachProjectToBillingAccount(
          projectId,
          firstBillingAccount.name
        );
        if (billingInfo && billingInfo.billingEnabled) {
          billingMessage += ` Successfully attached to billing account ${firstBillingAccount.displayName}.`;
        } else {
          billingMessage += ` Could not attach to billing account ${firstBillingAccount.displayName} or billing not enabled. Please check manually. Console: https://console.cloud.google.com/billing/linkedaccount?project=${projectId}`;
        }
      } else {
        const allBillingAccounts = billingAccounts
          .map((b) => `${b.displayName} (Open: ${b.open})`)
          .join(', ');
        billingMessage += ` No open billing accounts found. Available (may not be usable): ${allBillingAccounts || 'None'}. Please link billing manually: https://console.cloud.google.com/billing/linkedaccount?project=${projectId}`;
      }
    } else {
      billingMessage +=
        ' No billing accounts found. Please link billing manually: https://console.cloud.google.com/billing/linkedaccount?project=${projectId}';
    }
  } catch (billingError) {
    console.error(
      `Error during billing operations for project ${projectId}:`,
      billingError
    );
    billingMessage += ` Error during billing operations: ${billingError.message}. Please check manually: https://console.cloud.google.com/billing/linkedaccount?project=${projectId}`;
  }

  return { projectId, billingMessage };
}
