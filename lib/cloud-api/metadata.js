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

// Helper function to fetch data from GCP metadata server
/**
 * Fetches metadata from the Google Cloud metadata server.
 *
 * @param {string} path - The metadata path to fetch (e.g., `/computeMetadata/v1/...`).
 * @returns {Promise<string>} A promise that resolves to the metadata value as a string.
 * @throws {Error} If the metadata request fails with a non-OK status.
 */
async function fetchMetadata(path) {
  const response = await fetch(`http://metadata.google.internal${path}`, {
    headers: {
      'Metadata-Flavor': 'Google',
    },
  });
  if (!response.ok) {
    throw new Error(`Metadata request failed with status ${response.status}`);
  }
  return await response.text();
}

/**
 * Checks if the GCP metadata server is available and retrieves project ID and region.
 * @returns {Promise<Object|null>} A promise that resolves to an object { project: string, region: string } or null if not available or an error occurs.
 */
export async function checkGCP() {
  try {
    const projectId = await fetchMetadata(
      '/computeMetadata/v1/project/project-id'
    );
    // Expected format: projects/PROJECT_NUMBER/regions/REGION_NAME
    const regionPath = await fetchMetadata(
      '/computeMetadata/v1/instance/region'
    );

    if (projectId && regionPath) {
      const regionParts = regionPath.split('/');
      const region = regionParts[regionParts.length - 1];
      return { project: projectId, region: region };
    }
    return null;
  } catch (error) {
    // Intentionally suppress error logging for cleaner output if metadata server is not available.
    // console.warn('Failed to fetch GCP metadata:', error.message); // Uncomment for debugging
    return null;
  }
}
