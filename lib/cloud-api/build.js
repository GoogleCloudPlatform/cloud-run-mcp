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

import { callWithRetry } from './helpers.js';

const DELAY_WAIT_FOR_BUILD_LOGS = 10000; // 10 seconds delay to allow logs to propagate
const BUILD_LOGS_LINES_TO_FETCH = 100; // Number of log lines to fetch for build logs snippet

/**
 * Triggers a Google Cloud Build job to build a container image from source code in a GCS bucket.
 * It uses either a Dockerfile found in the source or Google Cloud Buildpacks if no Dockerfile is present.
 * Waits for the build to complete and returns the build result.
 *
 * @async
 * @param {object} context - The context object containing clients and other parameters.
 * @param {string} projectId - The Google Cloud project ID.
 * @param {string} location - The Google Cloud region for the build.
 * @param {string} sourceBucketName - The GCS bucket name where the source code (zip) is stored.
 * @param {string} sourceBlobName - The GCS blob name (the zip file) for the source code.
 * @param {string} targetRepoName - The name of the target Artifact Registry repository (used for context, not directly in build steps).
 * @param {string} targetImageUrl - The full Artifact Registry URL for the image to be built (e.g., `location-docker.pkg.dev/project/repo/image:tag`).
 * @param {boolean} hasDockerfile - Indicates whether a Dockerfile is present in the source to guide the build process.
 * @param {function(object): void} [progressCallback] - Optional callback for progress updates.
 * @returns {Promise<object>} A promise that resolves with the completed Cloud Build object.
 * @throws {Error} If the Cloud Build job fails, times out, or encounters an error during initiation or execution.
 */
export async function triggerCloudBuild(
  context,
  projectId,
  location,
  sourceBucketName,
  sourceBlobName,
  targetRepoName,
  targetImageUrl,
  hasDockerfile,
  progressCallback
) {
  let buildSteps;

  if (hasDockerfile) {
    buildSteps = [
      {
        name: 'gcr.io/cloud-builders/docker',
        args: ['build', '-t', targetImageUrl, '.'],
        dir: '/workspace',
      },
    ];
  } else {
    buildSteps = [
      {
        name: 'gcr.io/k8s-skaffold/pack',
        entrypoint: 'pack',
        args: [
          'build',
          targetImageUrl,
          '--builder',
          'gcr.io/buildpacks/builder:latest',
        ],
        dir: '/workspace',
      },
    ];
  }

  const build = {
    source: {
      storageSource: {
        bucket: sourceBucketName,
        object: sourceBlobName,
      },
    },
    steps: buildSteps,
    images: [targetImageUrl],
  };

  await logAndProgress(
    `Initiating Cloud Build for gs://${sourceBucketName}/${sourceBlobName} in ${location}...`,
    progressCallback
  );
  const [operation] = await callWithRetry(
    () =>
      context.cloudBuildClient.createBuild({
        projectId: projectId,
        build: build,
      }),
    'cloudBuild.createBuild'
  );

  await logAndProgress(`Cloud Build job started...`, progressCallback);
  const buildId = operation.metadata.build.id;
  let completedBuild;
  while (true) {
    const [getBuildOperation] = await callWithRetry(
      () =>
        context.cloudBuildClient.getBuild({
          projectId: projectId,
          id: buildId,
        }),
      `cloudBuild.getBuild ${buildId}`
    );
    if (
      ['SUCCESS', 'FAILURE', 'INTERNAL_ERROR', 'TIMEOUT', 'CANCELLED'].includes(
        getBuildOperation.status
      )
    ) {
      completedBuild = getBuildOperation;
      break;
    }
    await logAndProgress(
      `Build status: ${getBuildOperation.status}. Waiting...`,
      progressCallback,
      'debug'
    );
    await new Promise((resolve) => setTimeout(resolve, 5000));
  }

  if (completedBuild.status === 'SUCCESS') {
    await logAndProgress(
      `Cloud Build job ${buildId} completed successfully.`,
      progressCallback
    );
    await logAndProgress(
      `Image built: ${completedBuild.results.images[0].name}`,
      progressCallback
    );
    return completedBuild;
  } else {
    const failureMessage = `Cloud Build job ${buildId} failed with status: ${completedBuild.status}`;
    await logAndProgress(failureMessage, progressCallback, 'error');
    const logsMessage = `Build logs: ${completedBuild.logUrl}`;
    await logAndProgress(logsMessage, progressCallback); // Log URL is info, failure is error

    let buildLogsSnippet = `\n\nRefer to Log URL for full details: ${completedBuild.logUrl}`; // Default snippet
    try {
      const { Logging } = await import('@google-cloud/logging');
      const loggingClient = new Logging({ projectId });

      const logFilter = `resource.type="build" AND resource.labels.build_id="${buildId}"`;
      await logAndProgress(
        `Attempting to fetch last ${BUILD_LOGS_LINES_TO_FETCH} log lines for build ${buildId}...`,
        progressCallback,
        'debug'
      );

      // Wait for a short period to allow logs to propagate
      await new Promise((resolve) =>
        setTimeout(resolve, DELAY_WAIT_FOR_BUILD_LOGS)
      );

      // Fetch the most recent N log entries
      const [entries] = await callWithRetry(
        () =>
          loggingClient.getEntries({
            filter: logFilter,
            orderBy: 'timestamp desc', // Get latest logs first
            pageSize: BUILD_LOGS_LINES_TO_FETCH,
          }),
        `logging.getEntries for build ${buildId}`
      );

      if (entries && entries.length > 0) {
        // Entries are newest first, reverse for chronological order of the snippet
        const logLines = entries.reverse().map((entry) => entry.data || '');
        if (logLines.length > 0) {
          buildLogsSnippet = `\n\nLast ${logLines.length} log lines from build ${buildId}:\n${logLines.join('\n')}`;
          await logAndProgress(
            `Successfully fetched snippet of build logs for ${buildId}.`,
            progressCallback,
            'info'
          );
        }
      } else {
        await logAndProgress(
          `No specific log entries retrieved for build ${buildId}. ${buildLogsSnippet}`,
          progressCallback,
          'warn'
        );
      }
    } catch (logError) {
      console.error(`Error fetching build logs for ${buildId}:`, logError);
      await logAndProgress(
        `Failed to fetch build logs snippet: ${logError.message}. ${buildLogsSnippet}`,
        progressCallback,
        'warn'
      );
      // buildLogsSnippet already contains the Log URL as a fallback
    }
    throw new Error(`Build ${buildId} failed.${buildLogsSnippet}`);
  }
}
