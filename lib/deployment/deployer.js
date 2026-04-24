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

import { getRunClient } from '../clients.js';
import { callWithRetry, ensureApisEnabled } from '../cloud-api/helpers.js';
import { zipFiles } from '../util/archive.js';
import {
  ensureStorageBucketExists,
  uploadToStorageBucket,
} from '../cloud-api/storage.js';
import { ensureArtifactRegistryRepoExists } from '../cloud-api/registry.js';
import { triggerCloudBuild, composeBuild } from '../cloud-api/build.js';
import {
  logAndProgress,
  sanitizeCloudRunServiceName,
} from '../util/helpers.js';
import {
  checkCloudRunServiceExists,
  setServicePublicAccess,
} from '../cloud-api/run.js';
import {
  canDeployWithoutBuild,
  createDirectSourceDeploymentContainer,
  makeFileDeploymentMetadata,
  getServiceNameForComposeApp,
} from './helpers.js';
import {
  prepareSourceDirectory,
  cleanupTempDirectory,
} from './source-processor.js';
import { runUniversalMaker } from './universal-maker.js';

import {
  DEPLOYMENT_CONFIG,
  DEPLOYMENT_TYPES,
  MAX_ALLOWED_DIRECT_SOURCE_SIZE_BYTES,
  REQUIRED_APIS,
  RUNTIMES,
} from './constants.js';
import path from 'path';
import fs from 'fs';
import yaml from 'js-yaml';
import { getRunV1Client } from '../clients.js';
import {
  runCompose as downloadRunCompose,
  resourceCompose,
  translateCompose,
  composeVolumes,
  composeSecrets,
} from './compose.js';
import { getProjectNumber } from '../util/helpers.js';

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
  projectId,
  location,
  serviceId,
  imgUrl,
  progressCallback,
  skipIamCheck,
  deploymentType,
  accessToken,
  zippedSourceContainer,
  runtime,
  ingress
) {
  const runClient = await getRunClient(projectId, accessToken);
  const parent = runClient.locationPath(projectId, location);
  const servicePath = runClient.servicePath(projectId, location, serviceId);
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
    client: DEPLOYMENT_CONFIG.LABEL_CREATED_BY,
  };
  if (ingress) {
    service.ingress = ingress;
  }

  // Conditionally set invokerIamDisabled based on the skipIamCheck flag
  if (skipIamCheck) {
    service.invokerIamDisabled = true;
  }

  try {
    const exists = await checkCloudRunServiceExists(
      projectId,
      location,
      serviceId,
      accessToken,
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
            runClient.updateService({
              service: dryRunServiceConfig,
              validateOnly: true,
            }),
          `updateService (dry run) ${serviceId}`
        );
      } else {
        await callWithRetry(
          () =>
            runClient.createService({
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
        () => runClient.updateService({ service }),
        `updateService ${serviceId}`
      );
    } else {
      await logAndProgress(
        `Creating new service ${serviceId}...`,
        progressCallback
      );
      [operation] = await callWithRetry(
        () =>
          runClient.createService({
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
  projectId,
  region,
  serviceName,
  files,
  bucketName,
  deploymentAttrs,
  progressCallback,
  skipIamCheck,
  accessToken,
  ingress
) {
  await logAndProgress(
    `Attempting direct source deployment...`,
    progressCallback
  );

  let tempDir;

  try {
    tempDir = await prepareSourceDirectory(files);

    if (
      deploymentAttrs.runtime === RUNTIMES.NODEJS ||
      deploymentAttrs.runtime === RUNTIMES.PYTHON
    ) {
      deploymentAttrs = await updateDeploymentAttrsWithUniversalMaker(
        tempDir,
        deploymentAttrs,
        accessToken,
        progressCallback
      );
    }

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
      projectId,
      bucketName,
      region,
      accessToken,
      progressCallback
    );

    await uploadToStorageBucket(
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
      projectId,
      region,
      serviceName,
      undefined,
      progressCallback,
      skipIamCheck,
      DEPLOYMENT_TYPES.NO_BUILD,
      accessToken,
      container,
      deploymentAttrs.runtime,
      ingress
    );

    await logAndProgress(
      `Deployment completed successfully with zip deploy`,
      progressCallback
    );
    return service;
  } finally {
    await cleanupTempDirectory(tempDir);
  }
}

/**
 * Updates deployment attributes using result from Universal Maker.
 *
 * @async
 * @param {string} tempDir - Path to the temporary source directory.
 * @param {object} deploymentAttrs - The initial deployment attributes.
 * @param {function(object): void} [progressCallback] - Optional callback for progress updates.
 * @returns {Promise<object>} A promise that resolves with the updated deployment attributes.
 */
async function updateDeploymentAttrsWithUniversalMaker(
  tempDir,
  deploymentAttrs,
  accessToken,
  progressCallback
) {
  const umResult = await runUniversalMaker(
    tempDir,
    accessToken,
    progressCallback
  );
  if (umResult) {
    await logAndProgress(
      'Updating deployment attributes using Universal Maker results.',
      progressCallback
    );
    return {
      ...deploymentAttrs,
      baseImage: umResult.runtime || deploymentAttrs.baseImage,
      runtime: umResult.runtime || deploymentAttrs.runtime,
      cmd: umResult.command ? [umResult.command] : deploymentAttrs.cmd,
      args: umResult.args || deploymentAttrs.args,
      envVars: umResult.envVars || {},
    };
  }
  return deploymentAttrs;
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
  projectId,
  region,
  serviceName,
  files,
  hasDockerfile,
  bucketName,
  progressCallback,
  skipIamCheck,
  accessToken,
  ingress
) {
  const imageUrl = `${region}-docker.pkg.dev/${projectId}/${DEPLOYMENT_CONFIG.REPO_NAME}/${serviceName}:${DEPLOYMENT_CONFIG.IMAGE_TAG}`;

  const bucket = await ensureStorageBucketExists(
    projectId,
    bucketName,
    region,
    accessToken,
    progressCallback
  );

  const archiveBuffer = await zipFiles(files, false, progressCallback);
  const archiveName = DEPLOYMENT_CONFIG.ZIP_FILE_NAME;

  await uploadToStorageBucket(
    bucket,
    archiveBuffer,
    archiveName,
    progressCallback
  );
  await logAndProgress('Source code uploaded successfully', progressCallback);

  await ensureArtifactRegistryRepoExists(
    projectId,
    accessToken,
    region,
    DEPLOYMENT_CONFIG.REPO_NAME,
    'DOCKER',
    progressCallback
  );

  await logAndProgress(`Dockerfile: ${hasDockerfile}`, progressCallback);

  const buildResult = await triggerCloudBuild(
    projectId,
    region,
    bucketName,
    archiveName,
    DEPLOYMENT_CONFIG.REPO_NAME,
    imageUrl,
    hasDockerfile,
    accessToken,
    progressCallback,
    ingress
  );

  const builtImageUrl = buildResult.results.images[0].name;

  const service = await deployToCloudRun(
    projectId,
    region,
    serviceName,
    builtImageUrl,
    progressCallback,
    skipIamCheck,
    DEPLOYMENT_TYPES.WITH_BUILD,
    accessToken,
    undefined,
    undefined,
    ingress
  );

  await logAndProgress(
    `Deployment completed successfully with source build deploy`,
    progressCallback
  );
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
  accessToken,
  ingress,
}) {
  if (!projectId) {
    const errorMsg =
      'Error: projectId is required in the configuration object.';
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

  // Determines if we can use the direct source deployment (no Cloud Build) or compose deployment
  const { hasDockerfile, composeFilePath, deploymentAttrs } =
    makeFileDeploymentMetadata(files);

  if (composeFilePath) {
    if (!serviceName) {
      serviceName = getServiceNameForComposeApp(files, composeFilePath);
    }
    return await deployCompose({
      projectId,
      serviceName,
      region,
      files,
      composeFilePath,
      progressCallback,
      skipIamCheck,
      accessToken,
    });
  }

  if (!serviceName) {
    const errorMsg =
      'Error: serviceName is required in the configuration object.';
    await logAndProgress(errorMsg, progressCallback, 'error');
    throw new Error(errorMsg);
  }

  try {
    await ensureApisEnabled(
      projectId,
      REQUIRED_APIS.SOURCE_DEPLOY,
      accessToken,
      progressCallback
    );

    const bucketName = `${projectId}-source-bucket`;

    await logAndProgress(`Project: ${projectId}`, progressCallback);
    await logAndProgress(`Region: ${region}`, progressCallback);
    await logAndProgress(`Service Name: ${serviceName}`, progressCallback);
    await logAndProgress(`Files to deploy: ${files.length}`, progressCallback);

    await logAndProgress(`Dockerfile: ${hasDockerfile}`, progressCallback);

    if (canDeployWithoutBuild({ hasDockerfile, deploymentAttrs })) {
      try {
        return await deployWithZip(
          projectId,
          region,
          serviceName,
          files,
          bucketName,
          deploymentAttrs,
          progressCallback,
          skipIamCheck,
          accessToken,
          ingress
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
      projectId,
      region,
      serviceName,
      files,
      hasDockerfile,
      bucketName,
      progressCallback,
      skipIamCheck,
      accessToken,
      ingress
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
  accessToken,
  ingress,
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

  try {
    await ensureApisEnabled(
      projectId,
      REQUIRED_APIS.IMAGE_DEPLOY,
      accessToken,
      progressCallback
    );

    await logAndProgress(`Project: ${projectId}`, progressCallback);
    await logAndProgress(`Region: ${region}`, progressCallback);
    await logAndProgress(`Service Name: ${serviceName}`, progressCallback);
    await logAndProgress(`Image URL: ${imageUrl}`, progressCallback);

    const service = await deployToCloudRun(
      projectId,
      region,
      serviceName,
      imageUrl,
      progressCallback,
      skipIamCheck,
      DEPLOYMENT_TYPES.IMAGE,
      accessToken,
      undefined,
      undefined,
      ingress
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

/**
 * Deploys services defined in a compose.yaml file to Cloud Run.
 *
 * @async
 * @param {object} config - The deployment configuration.
 * @param {string} config.projectId - The Google Cloud project ID.
 * @param {string} [config.serviceName] - The name of the Cloud Run service.
 * @param {string} [config.region] - The Google Cloud region for deployment.
 * @param {Array<string>} config.files - An array of paths to include in the source bundle.
 * @param {string} config.composeFilePath - The absolute path to the compose configuration file.
 * @param {function(object): void} [config.progressCallback] - Optional callback for progress updates.
 * @param {boolean} [config.skipIamCheck=false] - Whether to skip the IAM check (if true, will attempt to set public access).
 * @param {string} [config.accessToken] - Access token for authentication.
 * @returns {Promise<object>} A promise that resolves with the deployment result.
 * @throws {Error} If deployment fails or required configuration is missing.
 */
export async function deployCompose({
  projectId,
  serviceName,
  region,
  files,
  composeFilePath,
  progressCallback,
  skipIamCheck,
  accessToken,
}) {
  let tempDir;
  try {
    tempDir = await prepareSourceDirectory(files, progressCallback);
    const tempComposeFilePath = path.join(
      tempDir,
      path.basename(composeFilePath)
    );
    const folderPath = tempDir;
    const projectNumber = await getProjectNumber(projectId, accessToken);
    const binPath = await downloadRunCompose(accessToken, progressCallback);

    // Get resource configuration
    const resourceOutput = await resourceCompose(
      binPath,
      tempComposeFilePath,
      region,
      progressCallback
    );
    let resourcesConfig = JSON.parse(resourceOutput);
    if (serviceName) {
      resourcesConfig.project = serviceName;
    }

    // Handle source builds if any
    if (resourcesConfig.source_builds) {
      resourcesConfig = await composeBuild(
        resourcesConfig,
        accessToken,
        projectId,
        region,
        folderPath,
        progressCallback
      );
    }

    // Handle volumes (bind and named)
    resourcesConfig = await composeVolumes(
      resourcesConfig,
      accessToken,
      projectId,
      region,
      folderPath,
      progressCallback
    );

    // Handle secrets
    resourcesConfig = await composeSecrets(
      resourcesConfig,
      accessToken,
      projectId,
      folderPath,
      progressCallback
    );

    const result = await translateCompose(
      binPath,
      tempComposeFilePath,
      region,
      projectNumber,
      progressCallback,
      resourcesConfig
    );

    const translation = JSON.parse(result);
    const deploymentItems = [];

    if (translation.models) {
      for (const [name, yamlPath] of Object.entries(translation.models)) {
        deploymentItems.push({ name, yamlPath, type: 'model' });
      }
    }
    if (translation.services) {
      for (const [name, yamlPath] of Object.entries(translation.services)) {
        deploymentItems.push({ name, yamlPath, type: 'service' });
      }
    }

    const deploymentResults = {};
    const runV1Client = await getRunV1Client(projectId, accessToken, region);

    for (const { name: rawName, yamlPath, type } of deploymentItems) {
      const serviceName = sanitizeCloudRunServiceName(rawName);
      const fullYamlPath = path.join(folderPath, yamlPath);
      await logAndProgress(
        `Deploying ${type} ${serviceName} using configuration from ${fullYamlPath}...`,
        progressCallback
      );

      const serviceConfig = yaml.load(
        await fs.promises.readFile(fullYamlPath, 'utf8')
      );

      // Ensure the metadata name is sanitized to match
      serviceConfig.metadata = serviceConfig.metadata || {};
      serviceConfig.metadata.name = serviceName;

      // The name for replaceService in v1 is namespaces/{project}/services/{service}
      const name = `namespaces/${projectId}/services/${serviceName}`;
      const parent = `namespaces/${projectId}`;

      let response;
      try {
        response = await runV1Client.namespaces.services.replaceService({
          name,
          requestBody: serviceConfig,
        });
      } catch (error) {
        if (error.code === 404) {
          await logAndProgress(
            `${type.charAt(0).toUpperCase() + type.slice(1)} ${serviceName} does not exist. Creating it...`,
            progressCallback
          );
          response = await runV1Client.namespaces.services.create({
            parent,
            requestBody: serviceConfig,
          });
        } else {
          throw error;
        }
      }

      await logAndProgress(
        `${type.charAt(0).toUpperCase() + type.slice(1)} ${serviceName} deployed successfully.`,
        progressCallback
      );

      // Set public access if skipIamCheck is enabled
      try {
        if (skipIamCheck) {
          await setServicePublicAccess(
            projectId,
            region,
            serviceName,
            accessToken,
            progressCallback
          );
        }
      } catch (error) {
        await logAndProgress(
          `Failed to set public access for ${type} ${serviceName}: ${error.message}`,
          progressCallback,
          'warn'
        );
      }
      if (type === 'service') {
        const deployedService = response.data || response;
        const serviceUrl = deployedService.status?.url;

        deploymentResults['service'] = serviceName;
        deploymentResults['uri'] = serviceUrl;
      }
    }

    return deploymentResults;
  } catch (error) {
    const errorMsg = `Deployment (compose) failed: ${error.message}`;
    await logAndProgress(errorMsg, progressCallback, 'error');
    throw error;
  } finally {
    if (tempDir) {
      await cleanupTempDirectory(tempDir);
    }
  }
}
