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
} from './billing.js';
import { getProjectsClient } from '../clients.js';

/**
 * Lists all accessible Google Cloud Platform projects.
 * @async
 * @function listProjects
 * @returns {Promise<Array<{id: string}>>} A promise that resolves to an array of project objects, each with an 'id' property. Returns an empty array on error.
 */
export async function listProjects() {
  const client = await getProjectsClient();
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
 * Creates a compliant GCP project ID in the format 'mcp-cvc-cvc', where 'c' is a consonant and 'v' is a vowel.
 * @function generateProjectId
 * @returns {string} A randomly generated, compliant GCP project ID in the format 'mcp-cvc-cvc'.
 */
export function generateProjectId() {
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
  return `mcp-${cvc1}-${cvc2}`;
}

/**
 * Creates a new Google Cloud Platform project.
 * @async
 * @function createProject
 * @param {string} [projectId] - Optional. The desired ID for the new project. If not provided, a compliant ID will be generated automatically (e.g., app-cvc-cvc).
 * @param {string} [parent] - Optional. The resource name of the parent under which the project is to be created. e.g., "organizations/123" or "folders/456".
 * @returns {Promise<{projectId: string}|null>} A promise that resolves to an object containing the new project's ID.
 */
export async function createProject(projectId, parent) {
  const client = await getProjectsClient();
  let projectIdToUse = projectId;

  if (!projectIdToUse) {
    projectIdToUse = generateProjectId();
    console.log(`Project ID not provided, generated ID: ${projectIdToUse}`);
  }

  try {
    const projectPayload = { projectId: projectIdToUse, parent };

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
 * @param {string} [parent] - Optional. The resource name of the parent under which the project is to be created. e.g., "organizations/123" or "folders/456".
 * @returns {Promise<{projectId: string, billingMessage: string}>} A promise that resolves to an object containing the project ID and a billing status message.
 */
export async function createProjectAndAttachBilling(projectIdParam, parent) {
  let newProject;
  try {
    newProject = await createProject(projectIdParam, parent);
  } catch (error) {
    throw new Error(`Failed to create project: ${error.message}`);
  }

  if (!newProject || !newProject.projectId) {
    throw new Error('Project creation did not return a valid project ID.');
  }

  const { projectId } = newProject;
  let billingMessage = `Project ${projectId} created successfully.`;

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
          billingMessage += ` It has been attached to billing account ${firstBillingAccount.displayName}.`;
        } else {
          billingMessage += ` However, it could not be attached to billing account ${firstBillingAccount.displayName} or billing not enabled. Please check manually: https://console.cloud.google.com/billing/linkedaccount?project=${projectId}`;
        }
      } else {
        const allBillingAccounts = billingAccounts
          .map((b) => `${b.displayName} (Open: ${b.open})`)
          .join(', ');
        billingMessage += ` However, no open billing accounts were found. Available (may not be usable): ${allBillingAccounts || 'None'}. Please link billing manually: https://console.cloud.google.com/billing/linkedaccount?project=${projectId}`;
      }
    } else {
      billingMessage += ` However, no billing accounts were found. Please link billing manually: https://console.cloud.google.com/billing/linkedaccount?project=${projectId}`;
    }
  } catch (billingError) {
    console.error(
      `Error during billing operations for project ${projectId}:`,
      billingError
    );
    billingMessage += ` However, an error occurred during billing operations: ${billingError.message}. Please check manually: https://console.cloud.google.com/billing/linkedaccount?project=${projectId}`;
  }

  return { projectId, billingMessage };
}

/**
 * Deletes a Google Cloud Platform project.
 * @async
 * @function deleteProject
 * @param {string} projectId - The ID of the project to delete.
 * @returns {Promise<void>} A promise that resolves when the delete operation is initiated.
 */
export async function deleteProject(projectId) {
  const client = await getProjectsClient();
  try {
    console.log(`Attempting to delete project with ID: ${projectId}`);
    await client.deleteProject({ name: `projects/${projectId}` });
    console.log(`Project ${projectId} deletion initiated successfully.`);
  } catch (error) {
    console.error(`Error deleting GCP project ${projectId}:`, error.message);
    throw error; // Re-throw to be caught by the caller
  }
}
