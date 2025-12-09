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
