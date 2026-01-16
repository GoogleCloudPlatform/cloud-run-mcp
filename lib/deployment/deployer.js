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

import { callWithRetry, ensureApisEnabled } from '../cloud-api/helpers.js';
import { zipFiles } from '../util/archive.js';
import {
  ensureStorageBucketExists,
  uploadToStorageBucket,
} from '../cloud-api/storage.js';
import { ensureArtifactRegistryRepoExists } from '../cloud-api/registry.js';
import { triggerCloudBuild } from '../cloud-api/build.js';
import { logAndProgress } from '../util/helpers.js';
import { checkCloudRunServiceExists } from '../cloud-api/run.js';
import {
  canDeployWithoutBuild,
  createDirectSourceDeploymentContainer,
  makeFileDeploymentMetadata,
} from './helpers.js';
import {
  prepareSourceDirectory,
  installDependencies,
  cleanupTempDirectory,
} from './source-processor.js';

import {
  DEPLOYMENT_CONFIG,
  DEPLOYMENT_TYPES,
  MAX_ALLOWED_DIRECT_SOURCE_SIZE_BYTES,
  REQUIRED_APIS,
} from './constants.js';

/**
 * Deploys or updates a Cloud Run service with the specified container image.
 * If the service exists, it's updated; otherwise, a new service is created.
 * The service is configured to be publicly accessible.
 *
 * @async
 * @param {object} context - The context object containing clients and other parameters.
 * @param {string} projectId - The Google Cloud project ID.
 * @param {string} location - The Google Cloud region for the deployment.
 * @param {string} serviceId - The ID for the Cloud Run service.
 * @param {string} imgUrl - The URL of the container image to deploy.
 * @param {function(object): void} [progressCallback] - Optional callback for progress updates.
 * @returns {Promise<object>} A promise that resolves with the Cloud Run service object upon successful deployment or update.
 * @throws {Error} If the deployment or update process fails.
 */
async function deployToCloudRun(
  context,
  projectId,
  location,
  serviceId,
  imgUrl,
  progressCallback,
  skipIamCheck,
  deploymentType,
  zippedSourceContainer,
  runtime
) {
  const parent = context.runClient.locationPath(projectId, location);
  const servicePath = context.runClient.servicePath(
    projectId,
    location,
    serviceId
  );
  const revisionName = `${serviceId}-${Date.now()}`; // Generate a unique revision name

  const containers =
    deploymentType === DEPLOYMENT_TYPES.NO_BUILD
      ? [zippedSourceContainer]
      : [{ image: imgUrl }];

  const service = {
    template: {
      revision: revisionName,
      containers,
    },
    labels: {
      'created-by': DEPLOYMENT_CONFIG.LABEL_CREATED_BY,
      'deployment-type': deploymentType,
      runtime: runtime,
    },
  };

  // Conditionally set invokerIamDisabled based on the skipIamCheck flag
  if (skipIamCheck) {
    service.invokerIamDisabled = true;
  }

  try {
    const exists = await checkCloudRunServiceExists(
      context,
      projectId,
      location,
      serviceId,
      progressCallback
    );

    // Always perform a dry run first for general validation
    try {
      await logAndProgress(
        `Performing dry run for service ${serviceId}...`,
        progressCallback,
        'debug'
      );
      const dryRunServiceConfig = JSON.parse(JSON.stringify(service)); // Deep copy for dry run

      if (exists) {
        dryRunServiceConfig.name = servicePath;
        await callWithRetry(
          () =>
            context.runClient.updateService({
              service: dryRunServiceConfig,
              validateOnly: true,
            }),
          `updateService (dry run) ${serviceId}`
        );
      } else {
        await callWithRetry(
          () =>
            context.runClient.createService({
              parent: parent,
              service: dryRunServiceConfig,
              serviceId: serviceId,
              validateOnly: true,
            }),
          `createService (dry run) ${serviceId}`
        );
      }
      await logAndProgress(
        `Dry run successful for ${serviceId} with current configuration.`,
        progressCallback,
        'debug'
      );
    } catch (dryRunError) {
      await logAndProgress(
        `Dry run for ${serviceId} failed: ${dryRunError.message}`,
        progressCallback,
        'warn'
      );

      // Check if the error is related to invokerIamDisabled (this is a heuristic)
      if (
        skipIamCheck &&
        dryRunError.message &&
        (dryRunError.message.toLowerCase().includes('invokeriamdisabled') ||
          dryRunError.message.toLowerCase().includes('iam policy violation') ||
          dryRunError.code === 3) /* INVALID_ARGUMENT */
      ) {
        await logAndProgress(
          `Dry run suggests 'invokerIamDisabled' is not allowed or invalid. Attempting deployment without it.`,
          progressCallback,
          'warn'
        );
        delete service.invokerIamDisabled; // Modify the main service object for actual deployment
      } else {
        // For any other validation errors, rethrow to stop the deployment
        const errorMessage = `Dry run validation failed for service ${serviceId}: ${dryRunError.message}`;
        await logAndProgress(errorMessage, progressCallback, 'error');
        throw new Error(errorMessage);
      }
    }

    let operation;
    if (exists) {
      await logAndProgress(
        `Updating existing service ${serviceId}...`,
        progressCallback
      );
      service.name = servicePath;
      [operation] = await callWithRetry(
        () => context.runClient.updateService({ service }),
        `updateService ${serviceId}`
      );
    } else {
      await logAndProgress(
        `Creating new service ${serviceId}...`,
        progressCallback
      );
      [operation] = await callWithRetry(
        () =>
          context.runClient.createService({
            parent: parent,
            service: service, // 'service' object might have invokerIamDisabled removed
            serviceId: serviceId,
          }),
        `createService ${serviceId}`
      );
    }

    await logAndProgress(
      `Deploying ${serviceId} to Cloud Run...`,
      progressCallback
    );
    const [response] = await operation.promise();

    await logAndProgress(
      `Service deployed/updated successfully: ${response.uri}`,
      progressCallback
    );
    return response;
  } catch (error) {
    const errorMessage = `Error deploying/updating service ${serviceId}: ${error.message}`;
    console.error(`Error deploying/updating service ${serviceId}:`, error);
    await logAndProgress(errorMessage, progressCallback, 'error');
    throw error;
  }
}

/**
 * Handles deployment directly from source via a zipped archive (no Cloud Build).
 * This function prepares the source code, installs dependencies, zips the code,
 * uploads it to Google Cloud Storage, and then deploys it to Cloud Run
 * using the direct source deployment mechanism.
 *
 * @param {object} context - The context object containing various GCP clients.
 * @param {string} projectId - The Google Cloud project ID.
 * @param {string} region - The Google Cloud region for the deployment.
 * @param {string} serviceName - The name of the Cloud Run service.
 * @param {Array<string|{filename: string, content: Buffer|string}>} files - Files to deploy.
 * @param {string} bucketName - The name of the GCS bucket to use for staging.
 * @param {object} deploymentAttrs - Deployment attributes detected from the source.
 * @param {string} [deploymentAttrs.runtime] - The detected runtime (e.g., 'nodejs').
 * @param {string[]} [deploymentAttrs.cmd] - The command to run the application.
 * @param {string[]} [deploymentAttrs.args] - The arguments for the command.
 * @param {string} [deploymentAttrs.baseImage] - The base image to use for the deployment.
 * @param {function(object): void} [progressCallback] - Optional callback for progress updates.
 * @param {boolean} [skipIamCheck=false] - Whether to skip the IAM check during Cloud Run service creation/update.
 * @returns {Promise<object>} A promise that resolves with the deployed Cloud Run service object.
 * @throws {Error} If any part of the deployment process fails.
 */
async function deployWithZip(
  context,
  projectId,
  region,
  serviceName,
  files,
  bucketName,
  deploymentAttrs,
  progressCallback,
  skipIamCheck
) {
  await logAndProgress(
    `Attempting direct source deployment...`,
    progressCallback
  );

  let tempDir;

  try {
    tempDir = await prepareSourceDirectory(files);
    await installDependencies(tempDir, deploymentAttrs);

    const archiveBuffer = await zipFiles([tempDir], true, progressCallback);
    const archiveName = DEPLOYMENT_CONFIG.TARGZ_FILE_NAME;

    if (archiveBuffer.length > MAX_ALLOWED_DIRECT_SOURCE_SIZE_BYTES) {
      const errorMsg = `Warning: Source archive size (${(
        archiveBuffer.length /
        (1024 * 1024)
      ).toFixed(
        2
      )} MiB) exceeds the ${MAX_ALLOWED_DIRECT_SOURCE_SIZE_BYTES / (1024 * 1024)} MiB limit.`;
      await logAndProgress(errorMsg, progressCallback, 'warn');
      throw new Error('Archive size exceeds limit');
    }

    const bucket = await ensureStorageBucketExists(
      context,
      bucketName,
      region,
      progressCallback
    );

    await uploadToStorageBucket(
      context,
      bucket,
      archiveBuffer,
      archiveName,
      progressCallback
    );
    await logAndProgress('Source code uploaded successfully', progressCallback);

    const container = createDirectSourceDeploymentContainer({
      bucketName,
      fileName: archiveName,
      deploymentAttrs,
    });

    const service = await deployToCloudRun(
      context,
      projectId,
      region,
      serviceName,
      undefined,
      progressCallback,
      skipIamCheck,
      DEPLOYMENT_TYPES.NO_BUILD,
      container,
      deploymentAttrs.runtime
    );

    return service;
  } finally {
    await cleanupTempDirectory(tempDir);
  }
}

/**
 * Handles deployment using Google Cloud Build.
 * This function zips the source code, uploads it to Google Cloud Storage,
 * triggers a Cloud Build job to build a container image, pushes the image
 * to Artifact Registry, and then deploys the image to Cloud Run.
 *
 * @param {object} context - The context object containing various GCP clients.
 * @param {string} projectId - The Google Cloud project ID.
 * @param {string} region - The Google Cloud region for the deployment.
 * @param {string} serviceName - The name of the Cloud Run service.
 * @param {Array<string|{filename: string, content: Buffer|string}>} files - Files to deploy.
 * @param {boolean} hasDockerfile - Whether a Dockerfile is present in the files.
 * @param {string} bucketName - The name of the GCS bucket to use for staging.
 * @param {function(object): void} [progressCallback] - Optional callback for progress updates.
 * @param {boolean} [skipIamCheck=false] - Whether to skip the IAM check during Cloud Run service creation/update.
 * @returns {Promise<object>} A promise that resolves with the deployed Cloud Run service object.
 * @throws {Error} If any part of the build or deployment process fails.
 */
async function deployWithBuild(
  context,
  projectId,
  region,
  serviceName,
  files,
  hasDockerfile,
  bucketName,
  progressCallback,
  skipIamCheck
) {
  const imageUrl = `${region}-docker.pkg.dev/${projectId}/${DEPLOYMENT_CONFIG.REPO_NAME}/${serviceName}:${DEPLOYMENT_CONFIG.IMAGE_TAG}`;

  const bucket = await ensureStorageBucketExists(
    context,
    bucketName,
    region,
    progressCallback
  );

  const archiveBuffer = await zipFiles(files, false, progressCallback);
  const archiveName = DEPLOYMENT_CONFIG.ZIP_FILE_NAME;

  await uploadToStorageBucket(
    context,
    bucket,
    archiveBuffer,
    archiveName,
    progressCallback
  );
  await logAndProgress('Source code uploaded successfully', progressCallback);

  await ensureArtifactRegistryRepoExists(
    context,
    projectId,
    region,
    DEPLOYMENT_CONFIG.REPO_NAME,
    'DOCKER',
    progressCallback
  );

  await logAndProgress(`Dockerfile: ${hasDockerfile}`, progressCallback);

  const buildResult = await triggerCloudBuild(
    context,
    projectId,
    region,
    bucketName,
    archiveName,
    DEPLOYMENT_CONFIG.REPO_NAME,
    imageUrl,
    hasDockerfile,
    progressCallback
  );

  const builtImageUrl = buildResult.results.images[0].name;

  const service = await deployToCloudRun(
    context,
    projectId,
    region,
    serviceName,
    builtImageUrl,
    progressCallback,
    skipIamCheck,
    DEPLOYMENT_TYPES.WITH_BUILD
  );

  await logAndProgress(`Deployment completed successfully`, progressCallback);
  return service;
}

/**
 * Deploys a service to Google Cloud Run.
 * @param {object} config - The deployment configuration.
 * @param {string} config.projectId - The Google Cloud project ID.
 * @param {string} [config.serviceName='app'] - The name of the Cloud Run service. Defaults to 'app'.
 * @param {string} [config.region='europe-west1'] - The Google Cloud region for deployment. Defaults to 'europe-west1'.
 * @param {Array<string|{filename: string, content: Buffer|string}>} config.files - An array of file paths or file objects (with `filename` and `content`) to deploy.
 * @param {function(object): void} [config.progressCallback] - Optional callback for progress updates.
 * @returns {Promise<object>} A promise that resolves with the deployed Cloud Run service object.
 * @throws {Error} If deployment fails or required configuration is missing.
 */
export async function deploy({
  projectId,
  serviceName,
  region,
  files,
  progressCallback,
  skipIamCheck,
}) {
  if (!projectId) {
    const errorMsg =
      'Error: projectId is required in the configuration object.';
    await logAndProgress(errorMsg, progressCallback, 'error');
    throw new Error(errorMsg);
  }

  if (!serviceName) {
    const errorMsg =
      'Error: serviceName is required in the configuration object.';
    await logAndProgress(errorMsg, progressCallback, 'error');
    throw new Error(errorMsg);
  }

  if (!files || !Array.isArray(files) || files.length === 0) {
    const errorMsg =
      'Error: files array is required in the configuration object.';
    await logAndProgress(errorMsg, progressCallback, 'error');
    if (typeof process !== 'undefined' && process.exit) {
      process.exit(1);
    } else {
      throw new Error(errorMsg);
    }
  }

  const { Storage } = await import('@google-cloud/storage');
  const { CloudBuildClient } = await import('@google-cloud/cloudbuild');
  const { ArtifactRegistryClient } = await import(
    '@google-cloud/artifact-registry'
  );
  const { v2: CloudRunV2Module } = await import('@google-cloud/run');
  const { ServicesClient, BuildsClient } = CloudRunV2Module;
  const { ServiceUsageClient } = await import('@google-cloud/service-usage');
  const { Logging } = await import('@google-cloud/logging');

  try {
    const context = {
      storage: new Storage({ projectId }),
      cloudBuildClient: new CloudBuildClient({ projectId }),
      artifactRegistryClient: new ArtifactRegistryClient({ projectId }),
      runClient: new ServicesClient({ projectId }),
      buildsClient: new BuildsClient({ projectId }),
      serviceUsageClient: new ServiceUsageClient({ projectId }),
      loggingClient: new Logging({ projectId }),
    };

    await ensureApisEnabled(
      context,
      projectId,
      REQUIRED_APIS.SOURCE_DEPLOY,
      progressCallback
    );

    const bucketName = `${projectId}-source-bucket`;

    await logAndProgress(`Project: ${projectId}`, progressCallback);
    await logAndProgress(`Region: ${region}`, progressCallback);
    await logAndProgress(`Service Name: ${serviceName}`, progressCallback);
    await logAndProgress(`Files to deploy: ${files.length}`, progressCallback);

    // Determines if we can use the direct source deployment (no Cloud Build)
    const { hasDockerfile, deploymentAttrs } =
      makeFileDeploymentMetadata(files);

    await logAndProgress(`Dockerfile: ${hasDockerfile}`, progressCallback);

    if (canDeployWithoutBuild({ hasDockerfile, deploymentAttrs })) {
      try {
        return await deployWithZip(
          context,
          projectId,
          region,
          serviceName,
          files,
          bucketName,
          deploymentAttrs,
          progressCallback,
          skipIamCheck
        );
      } catch (error) {
        await logAndProgress(
          `Failed to deploy directly from source: ${error.message}. Retrying to deploy using Cloud Build...`,
          progressCallback,
          'warn'
        );
      }
    }

    return await deployWithBuild(
      context,
      projectId,
      region,
      serviceName,
      files,
      hasDockerfile,
      bucketName,
      progressCallback,
      skipIamCheck
    );
  } catch (error) {
    const deployFailedMessage = `Deployment Failed: ${error.message}`;
    console.error(`Deployment Failed`, error);
    await logAndProgress(deployFailedMessage, progressCallback, 'error');
    throw error;
  }
}

/**
 * Deploys a container image to Google Cloud Run.
 * @param {object} config - The deployment configuration.
 * @param {string} config.projectId - The Google Cloud project ID.
 * @param {string} [config.serviceName='app'] - The name of the Cloud Run service. Defaults to 'app'.
 * @param {string} [config.region='europe-west1'] - The Google Cloud region for deployment. Defaults to 'europe-west1'.
 * @param {string} config.imageUrl - The URL of the container image to deploy.
 * @param {function(object): void} [config.progressCallback] - Optional callback for progress updates.
 * @param {boolean} [config.skipIamCheck=false] - Whether to skip the IAM check.
 * @returns {Promise<object>} A promise that resolves with the deployed Cloud Run service object.
 * @throws {Error} If deployment fails or required configuration is missing.
 */
export async function deployImage({
  projectId,
  serviceName,
  region,
  imageUrl,
  progressCallback,
  skipIamCheck,
}) {
  if (!projectId) {
    const errorMsg =
      'Error: projectId is required in the configuration object.';
    await logAndProgress(errorMsg, progressCallback, 'error');
    throw new Error(errorMsg);
  }

  if (!serviceName) {
    const errorMsg =
      'Error: serviceName is required in the configuration object.';
    await logAndProgress(errorMsg, progressCallback, 'error');
    throw new Error(errorMsg);
  }

  if (!imageUrl) {
    const errorMsg = 'Error: imageUrl is required in the configuration object.';
    await logAndProgress(errorMsg, progressCallback, 'error');
    if (typeof process !== 'undefined' && process.exit) {
      process.exit(1);
    } else {
      throw new Error(errorMsg);
    }
  }

  const { v2: CloudRunV2Module } = await import('@google-cloud/run');
  const { ServicesClient } = CloudRunV2Module;
  const { ServiceUsageClient } = await import('@google-cloud/service-usage');

  try {
    const context = {
      runClient: new ServicesClient({ projectId }),
      serviceUsageClient: new ServiceUsageClient({ projectId }),
    };

    await ensureApisEnabled(
      context,
      projectId,
      REQUIRED_APIS.IMAGE_DEPLOY,
      progressCallback
    );

    await logAndProgress(`Project: ${projectId}`, progressCallback);
    await logAndProgress(`Region: ${region}`, progressCallback);
    await logAndProgress(`Service Name: ${serviceName}`, progressCallback);
    await logAndProgress(`Image URL: ${imageUrl}`, progressCallback);

    const service = await deployToCloudRun(
      context,
      projectId,
      region,
      serviceName,
      imageUrl,
      progressCallback,
      skipIamCheck,
      DEPLOYMENT_TYPES.IMAGE
    );

    await logAndProgress(`Deployment completed successfully`, progressCallback);
    return service;
  } catch (error) {
    const deployFailedMessage = `Deployment Failed: ${error.message}`;
    console.error(`Deployment Failed`, error);
    await logAndProgress(deployFailedMessage, progressCallback, 'error');
    throw error;
  }
}
