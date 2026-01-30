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

import { getArtifactRegistryClient } from '../clients.js';
import { callWithRetry } from './helpers.js';
import { logAndProgress } from '../util/helpers.js';

/**
 * Ensures that an Artifact Registry repository exists.
 * If the repository does not exist, it attempts to create it with the specified format.
 *
 * @async
 * @param {string} projectId - The Google Cloud project ID.
 * @param {string} location - The Google Cloud region for the repository.
 * @param {string} repositoryId - The ID for the Artifact Registry repository.
 * @param {string} [format='DOCKER'] - The format of the repository (e.g., 'DOCKER', 'NPM'). Defaults to 'DOCKER'.
 * @param {function(object): void} [progressCallback] - Optional callback for progress updates.
 * @returns {Promise<object>} A promise that resolves with the Artifact Registry repository object.
 * @throws {Error} If there's an error checking or creating the repository.
 */
export async function ensureArtifactRegistryRepoExists(
  projectId,
  accessToken,
  location,
  repositoryId,
  format = 'DOCKER',
  progressCallback
) {
  const artifactRegistryClient = await getArtifactRegistryClient(projectId, accessToken);
  const parent = `projects/${projectId}/locations/${location}`;
  const repoPath = artifactRegistryClient.repositoryPath(
    projectId,
    location,
    repositoryId
  );

  try {
    const [repository] = await callWithRetry(
      () => artifactRegistryClient.getRepository({ name: repoPath }),
      `artifactRegistry.getRepository ${repositoryId}`
    );
    await logAndProgress(
      `Repository ${repositoryId} already exists in ${location}.`,
      progressCallback
    );
    return repository;
  } catch (error) {
    if (error.code === 5) {
      await logAndProgress(
        `Repository ${repositoryId} does not exist in ${location}. Creating...`,
        progressCallback
      );
      const repositoryToCreate = {
        format: format,
      };

      const [operation] = await callWithRetry(
        () =>
          artifactRegistryClient.createRepository({
            parent: parent,
            repository: repositoryToCreate,
            repositoryId: repositoryId,
          }),
        `artifactRegistry.createRepository ${repositoryId}`
      );
      await logAndProgress(
        `Creating Artifact Registry repository ${repositoryId}...`,
        progressCallback
      );
      const [result] = await operation.promise();
      await logAndProgress(
        `Artifact Registry repository ${result.name} created successfully.`,
        progressCallback
      );
      return result;
    } else {
      const errorMessage = `Error checking/creating repository ${repositoryId}: ${error.message}`;
      console.error(
        `Error checking/creating repository ${repositoryId}:`,
        error
      );
      await logAndProgress(errorMessage, progressCallback, 'error');
      throw error;
    }
  }
}
