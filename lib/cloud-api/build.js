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
  getCloudBuildClient,
  getLoggingClient,
  getRunClient,
  getBuildsClient,
} from '../clients.js';
import { callWithRetry } from './helpers.js';
import { logAndProgress } from '../util/helpers.js';
import { checkCloudRunServiceExists } from './run.js';

const DELAY_WAIT_FOR_BUILD_LOGS = 10000; // 10 seconds delay to allow logs to propagate
const BUILD_LOGS_LINES_TO_FETCH = 100; // Number of log lines to fetch for build logs snippet

/**
 * Triggers a Google Cloud Build job to build a container image from source code in a GCS bucket.
 * It uses either a Dockerfile found in the source or Google Cloud Buildpacks if no Dockerfile is present.
 * It performs a dry-run deployment check before starting the build.
 * Waits for the build to complete and returns the build result.
 *
 * @async
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
  projectId,
  location,
  sourceBucketName,
  sourceBlobName,
  targetRepoName,
  targetImageUrl,
  hasDockerfile,
  progressCallback
) {
  const serviceName = targetImageUrl.split('/').pop().split(/[:@]/)[0];
  const parent = `projects/${projectId}/locations/${location}`;
  const serviceFullName = `${parent}/services/${serviceName}`;
  const buildsClient = await getBuildsClient(projectId);
  const runClient = await getRunClient(projectId);
  const serviceExists = await checkCloudRunServiceExists(
    projectId,
    location,
    serviceName,
    progressCallback
  );
  const cloudBuildClient = await getCloudBuildClient(projectId);
  const loggingClient = await getLoggingClient(projectId);
  let buildSteps;

  const servicePatch = {
    template: {
      containers: [{ image: targetImageUrl }],
    },
  };

  try {
    if (serviceExists) {
      await logAndProgress(
        `Performing dry-run update for service ${serviceName}...`,
        progressCallback
      );
      servicePatch.name = serviceFullName;
      await callWithRetry(
        () =>
          runClient.updateService({
            service: servicePatch,
            validateOnly: true,
          }),
        'run.updateService-dryrun'
      );
    } else {
      await logAndProgress(
        `Performing dry-run creation for service ${serviceName}...`,
        progressCallback
      );
      await callWithRetry(
        () =>
          runClient.createService({
            parent: parent,
            service: servicePatch,
            serviceId: serviceName,
            validateOnly: true,
          }),
        'run.createService-dryrun'
      );
    }
    await logAndProgress(
      `Dry-run validation successful.`,
      progressCallback,
      'debug'
    );
  } catch (err) {
    await logAndProgress(
      `Dry-run validation failed for service ${serviceName}.`,
      progressCallback,
      'error'
    );
    throw new Error(`Dry-run deployment failed: ${err.message}`);
  }

  const request = {
    parent: `projects/${projectId}/locations/${location}`,
    storageSource: {
      bucket: sourceBucketName,
      object: sourceBlobName,
    },
    imageUri: targetImageUrl,
    client: 'cloud-run-mcp',
  };
  if (hasDockerfile) {
    request.dockerBuild = {};
  } else {
    request.buildpackBuild = {};
  }

  await logAndProgress(
    `Initiating Cloud Build for gs://${sourceBucketName}/${sourceBlobName} in ${location}...`,
    progressCallback
  );

  const [submitBuildResponse] = await callWithRetry(
    () => buildsClient.submitBuild(request),
    'builds.submitBuild'
  );
  await logAndProgress(`Cloud Build job started...`, progressCallback);
  const encodedBuildId = submitBuildResponse.buildOperation.name
    .split('/')
    .pop();
  const buildId = Buffer.from(encodedBuildId, 'base64').toString('ascii');
  let completedBuild;
  while (true) {
    const [getBuildOperation] = await callWithRetry(
      () =>
        cloudBuildClient.getBuild({
          name: `projects/${projectId}/locations/${location}/builds/${buildId}`,
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
    const builtImage = completedBuild.results.images[0].name;
    await logAndProgress(`Image built: ${builtImage}`, progressCallback);

    return completedBuild;
  } else {
    const failureMessage = `Cloud Build job ${buildId} failed with status: ${completedBuild.status}`;
    await logAndProgress(failureMessage, progressCallback, 'error');
    const logsMessage = `Build logs: ${completedBuild.logUrl}`;
    await logAndProgress(logsMessage, progressCallback); // Log URL is info, failure is error

    let buildLogsSnippet = `\n\nRefer to Log URL for full details: ${completedBuild.logUrl}`; // Default snippet
    try {
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
