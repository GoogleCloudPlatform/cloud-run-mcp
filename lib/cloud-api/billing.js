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

/**
 * Lists all accessible Google Cloud Billing Accounts.
 * @async
 * @function listBillingAccounts
 * @returns {Promise<Array<{name: string, displayName: string, open: boolean}>>} A promise that resolves to an array of billing account objects,
 * each with 'name', 'displayName', and 'open' status. Returns an empty array on error.
 */
export async function listBillingAccounts() {
  const { CloudBillingClient } = await import('@google-cloud/billing');
  const client = new CloudBillingClient();
  try {
    const [accounts] = await client.listBillingAccounts();
    if (!accounts || accounts.length === 0) {
      console.log('No billing accounts found.');
      return [];
    }
    return accounts.map((account) => ({
      name: account.name, // e.g., billingAccounts/0X0X0X-0X0X0X-0X0X0X
      displayName: account.displayName,
      open: account.open,
    }));
  } catch (error) {
    console.error('Error listing GCP billing accounts:', error);
    return [];
  }
}

/**
 * Attaches a Google Cloud Project to a specified Billing Account.
 * @async
 * @function attachProjectToBillingAccount
 * @param {string} projectId - The ID of the project to attach.
 * @param {string} billingAccountName - The resource name of the billing account (e.g., 'billingAccounts/0X0X0X-0X0X0X-0X0X0X').
 * @returns {Promise<object|null>} A promise that resolves to the updated project billing information object if successful, or null on error.
 */
export async function attachProjectToBillingAccount(
  projectId,
  billingAccountName
) {
  const { CloudBillingClient } = await import('@google-cloud/billing');
  const client = new CloudBillingClient();
  const projectName = `projects/${projectId}`;

  if (!projectId) {
    console.error('Error: projectId is required.');
    return null;
  }
  if (
    !billingAccountName ||
    !billingAccountName.startsWith('billingAccounts/')
  ) {
    console.error(
      'Error: billingAccountName is required and must be in the format "billingAccounts/XXXXXX-XXXXXX-XXXXXX".'
    );
    return null;
  }

  try {
    console.log(
      `Attempting to attach project ${projectId} to billing account ${billingAccountName}...`
    );
    const [updatedBillingInfo] = await client.updateProjectBillingInfo({
      name: projectName,
      projectBillingInfo: {
        billingAccountName: billingAccountName,
      },
    });
    console.log(
      `Successfully attached project ${projectId} to billing account ${billingAccountName}.`
    );
    console.log(`Billing enabled: ${updatedBillingInfo.billingEnabled}`);
    return updatedBillingInfo;
  } catch (error) {
    console.error(
      `Error attaching project ${projectId} to billing account ${billingAccountName}:`,
      error.message || error
    );
    // Log more details if available, e.g. error.details
    // if (error.details) console.error("Error details:", error.details);
    return null;
  }
}

/**
 * Checks if billing is enabled for a given project.
 * @async
 * @function isBillingEnabled
 * @param {string} projectId - The ID of the project to check.
 * @returns {Promise<boolean>} A promise that resolves to true if billing is enabled, false otherwise.
 */
export async function isBillingEnabled(projectId) {
  const { CloudBillingClient } = await import('@google-cloud/billing');
  const client = new CloudBillingClient();
  const projectName = `projects/${projectId}`;
  try {
    // getProjectBillingInfo requires cloudbilling.googleapis.com API to check billing status
    // https://docs.cloud.google.com/billing/docs/reference/rest/v1/projects/getBillingInfo
    const [billingInfo] = await client.getProjectBillingInfo({
      name: projectName,
    });
    return billingInfo.billingEnabled;
  } catch (error) {
    console.error(
      `Error checking billing status for project ${projectId}:`,
      error.message || error
    );
    return false;
  }
}

/**
 * Ensures billing is enabled for a project. If not, attempts to enable it
 * by attaching the single open billing account if one is found.
 * @param {object} context - The context object containing clients and other parameters.
 * @param {string} projectId The project ID to check billing for.
 * @param {function} progressCallback A callback function for progress updates.
 */
export async function ensureBillingEnabled(
  context,
  projectId,
  progressCallback
) {
  if (!(await isBillingEnabled(projectId))) {
    // Billing is disabled, try to fix it.
    const accounts = await listBillingAccounts();

    if (accounts && accounts.length === 1 && accounts[0].open) {
      // Exactly one open account found, try to attach it.
      const account = accounts[0];
      const attemptMessage = `Billing is not enabled for project ${projectId}. Found one open billing account: ${account.displayName} (${account.name}). Attempting to attach it...`;
      console.log(attemptMessage);
      if (progressCallback)
        progressCallback({ level: 'info', data: attemptMessage });

      const attachmentResult = await attachProjectToBillingAccount(
        projectId,
        account.name
      );

      if (!attachmentResult || !attachmentResult.billingEnabled) {
        const attachFailMessage = `Failed to automatically attach project ${projectId} to billing account ${account.name}. Please enable billing manually: https://console.cloud.google.com/billing/linkedaccount?project=${projectId}`;
        if (progressCallback)
          progressCallback({ level: 'error', data: attachFailMessage });
        throw new Error(attachFailMessage);
      }
      const attachSuccessMessage = `Successfully attached project ${projectId} to billing account ${account.name}.`;
      console.log(attachSuccessMessage);
      if (progressCallback)
        progressCallback({ level: 'info', data: attachSuccessMessage });
      // If we get here, billing is now enabled, and we can proceed to API checks.
    } else {
      // Cannot auto-attach. Throw error.
      let reason;
      if (!accounts || accounts.length === 0) {
        reason = 'no billing accounts were found';
      } else if (accounts.length > 1) {
        reason = 'multiple billing accounts were found';
      } else {
        reason = `the only available billing account '${accounts[0].displayName}' is not open`;
      }
      const errorMessage = `Billing is not enabled for project ${projectId}, and it could not be enabled automatically because ${reason}. Please enable billing to use Google Cloud services: https://console.cloud.google.com/billing/linkedaccount?project=${projectId}`;
      if (progressCallback)
        progressCallback({ level: 'error', data: errorMessage });
      throw new Error(errorMessage);
    }
  }
}
