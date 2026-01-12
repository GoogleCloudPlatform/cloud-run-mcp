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

import { ensureBillingEnabled } from './billing.js';

const PREREQUISITE_APIS = [
  'serviceusage.googleapis.com',
  'cloudbilling.googleapis.com',
];

/**
 * Calls a function with retry logic for GCP API calls.
 * Retries on gRPC error code 7 (PERMISSION_DENIED).
 * @param {Function} fn The function to call.
 * @param {string} description A description of the function being called, for logging.
 * @returns {Promise<any>} The result of the function.
 */
export async function callWithRetry(fn, description) {
  const maxRetries = 7;
  const initialBackoff = 1000; // 1 second
  let retries = 0;

  while (true) {
    try {
      return await fn();
    } catch (error) {
      if (error.code === 7 && retries < maxRetries) {
        retries++;
        let backoff;
        if (retries === 1) {
          backoff = 15000; // 15 seconds for the first retry
        } else {
          backoff = initialBackoff * Math.pow(2, retries - 2);
        }
        console.warn(
          `API call "${description}" failed with PERMISSION_DENIED. Retrying in ${
            backoff / 1000
          }s... (attempt ${retries}/${maxRetries})`
        );
        await new Promise((resolve) => setTimeout(resolve, backoff));
      } else {
        throw error;
      }
    }
  }
}

/**
 * Checks if a single Google Cloud API is enabled and enables it if not.
 *
 * @param {object} serviceUsageClient - The Service Usage client.
 * @param {string} serviceName - The full name of the service (e.g., 'projects/my-project/services/run.googleapis.com').
 * @param {string} api - The API identifier (e.g., 'run.googleapis.com').
 * @param {function(string, string=): void} progressCallback - A function to call with progress updates.
 * @returns {Promise<void>} A promise that resolves when the API is enabled.
 * @throws {Error} If the API fails to enable or if there's an issue checking its status.
 */
async function checkAndEnableApi(
  serviceUsageClient,
  serviceName,
  api,
  progressCallback
) {
  const [service] = await callWithRetry(
    () => serviceUsageClient.getService({ name: serviceName }),
    `getService ${api}`
  );
  if (service.state !== 'ENABLED') {
    const message = `API [${api}] is not enabled. Enabling...`;
    console.log(message);
    if (progressCallback) progressCallback({ level: 'info', data: message });

    const [operation] = await callWithRetry(
      () => serviceUsageClient.enableService({ name: serviceName }),
      `enableService ${api}`
    );
    await operation.promise();
  }
}

/**
 * Enables a single Google Cloud API with retry logic.
 * @param {object} serviceUsageClient - The Service Usage client.
 * @param {string} projectId - The Google Cloud project ID.
 * @param {string} api - The API identifier (e.g., 'run.googleapis.com').
 * @param {function(string, string=): void} progressCallback - A function to call with progress updates.
 * @returns {Promise<void>} A promise that resolves when the API is enabled.
 * @throws {Error} If the API fails to enable or if there's an issue checking its status.
 */
export async function enableApiWithRetry(
  serviceUsageClient,
  projectId,
  api,
  progressCallback
) {
  const serviceName = `projects/${projectId}/services/${api}`;
  try {
    await checkAndEnableApi(
      serviceUsageClient,
      serviceName,
      api,
      progressCallback
    );
  } catch (error) {
    // First attempt failed, log a warning and retry once after a delay.
    const warnMsg = `Failed to check/enable ${api}, retrying in 1s...`;
    console.warn(warnMsg);
    if (progressCallback) progressCallback({ level: 'warn', data: warnMsg });

    await new Promise((resolve) => setTimeout(resolve, 1000));
    try {
      await checkAndEnableApi(
        serviceUsageClient,
        serviceName,
        api,
        progressCallback
      );
    } catch (retryError) {
      // If the retry also fails, throw an error.
      const errorMessage = `Failed to ensure API [${api}] is enabled after retry. Please check manually.`;
      console.error(errorMessage, retryError);
      if (progressCallback)
        progressCallback({ level: 'error', data: errorMessage });
      throw new Error(errorMessage);
    }
  }
}

/**
 * Ensures that the specified Google Cloud APIs are enabled for the given project.
 * If an API is not enabled, it attempts to enable it.  Retries any failure once after 1s.
 * Throws an error if an API cannot be enabled.
 *
 * @async
 * @param {object} context - The context object containing clients and other parameters.
 * @param {string} projectId - The Google Cloud project ID.
 * @param {string[]} apis - An array of API identifiers to check and enable (e.g., 'run.googleapis.com').
 * @param {function(string, string=): void} progressCallback - A function to call with progress updates.
 * The first argument is the message, the optional second argument is the type ('error', 'warning', 'info').
 * @throws {Error} If an API fails to enable or if there's an issue checking its status.
 * @returns {Promise<void>} A promise that resolves when all specified APIs are enabled.
 */
export async function ensureApisEnabled(
  context,
  projectId,
  apis,
  progressCallback
) {
  for (const api of PREREQUISITE_APIS) {
    await enableApiWithRetry(
      context.serviceUsageClient,
      projectId,
      api,
      progressCallback
    );
  }

  // Before enabling other APIs, ensure billing is enabled.
  await ensureBillingEnabled(context, projectId, progressCallback);

  const message = 'Checking and enabling required APIs...';
  console.log(message);
  if (progressCallback) progressCallback({ level: 'info', data: message });

  for (const api of apis) {
    await enableApiWithRetry(
      context.serviceUsageClient,
      projectId,
      api,
      progressCallback
    );
  }
  const successMsg = 'All required APIs are enabled.';
  console.log(successMsg);
  if (progressCallback) progressCallback({ level: 'info', data: successMsg });
}
