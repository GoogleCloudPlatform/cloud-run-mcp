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

import { getComputeClient } from '../clients.js';

/**
 * Helper function to log a message and call the progress callback.
 * @param {string} message - The message to log.
 * @param {function(object): void} [progressCallback] - Optional callback for progress updates.
 * @param {'debug' | 'info' | 'warn' | 'error'} [severity='info'] - The severity level of the message.
 */
export async function logAndProgress(
  message,
  progressCallback,
  severity = 'info'
) {
  switch (severity) {
    case 'error':
      console.error(message);
      break;
    case 'warn':
    case 'info':
    case 'debug':
    default:
      console.log(message);
      break;
  }
  if (progressCallback) {
    progressCallback({ level: severity, data: message });
  }
}

/**
 * Extracts the access token from the Authorization header.
 * @param {string} authorizationHeader - The Authorization header string.
 * @returns {string | undefined} - The extracted access token or undefined if not found.
 */
export function extractAccessToken(authorizationHeader) {
  if (!authorizationHeader) {
    return undefined;
  }
  return authorizationHeader.split(' ')[1];
}

let cachedRegions = null;

/**
 * Resets the cached regions. Used for testing.
 */
export function resetCachedRegions() {
  cachedRegions = null;
}

/**
 * Returns a list of supported Cloud Run regions by fetching them from Compute Engine API.
 * This is the SDK equivalent of `gcloud compute regions list`.
 * @param {string} projectId - The project ID to fetch regions for.
 * @param {string} accessToken - The access token for authentication.
 * @returns {Promise<string[]>}
 */
export async function getCloudRunRegions(projectId, accessToken) {
  if (cachedRegions) {
    return cachedRegions;
  }
  const regionsClient = await getComputeClient(projectId, accessToken);
  const [regions] = await regionsClient.list({
    project: projectId,
  });

  cachedRegions = regions.map((r) => r.name);
  return cachedRegions;
}
