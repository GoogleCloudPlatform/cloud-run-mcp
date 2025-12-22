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
import { checkIfDockerFileExists, checkIfNodeJsRuntime } from './helpers.js';

// Configuration
const REPO_NAME = 'mcp-cloud-run-deployments';
const ZIP_FILE_NAME = 'source.zip';
const TARGZ_FILE_NAME = 'source.tar.gz';
const IMAGE_TAG = 'latest';

// APIs required for deploying from source code.
const REQUIRED_APIS_FOR_SOURCE_DEPLOY = [
  'iam.googleapis.com',
  'storage.googleapis.com',
  'cloudbuild.googleapis.com',
  'artifactregistry.googleapis.com',
  'run.googleapis.com',
  'serviceusage.googleapis.com',
];

// APIs required for deploying a container image.
const REQUIRED_APIS_FOR_IMAGE_DEPLOY = [
  'run.googleapis.com',
  'serviceusage.googleapis.com',
];

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
  zipSourceCode,
  packageJson
) {
  const parent = context.runClient.locationPath(projectId, location);
  const servicePath = context.runClient.servicePath(
    projectId,
    location,
    serviceId
  );
  const revisionName = `${serviceId}-${Date.now()}`; // Generate a unique revision name

  const startScript = packageJson?.scripts?.start;
  const containers = zipSourceCode
    ? [
        {
          image: 'scratch',
          baseImageUri: 'nodejs22',
          sourceCode: {
            cloudStorageSource: zipSourceCode,
          },
          command: [startScript.split(' ')[0]],
          args: startScript.split(' ').slice(1),
        },
      ]
    : [{ image: imgUrl }];

  const service = {
    template: {
      revision: revisionName,
      containers,
    },
    labels: {
      'created-by': 'cloud-run-mcp',
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

  const path = await import('path');
  const fs = await import('fs');
  const { Storage } = await import('@google-cloud/storage');
  const { CloudBuildClient } = await import('@google-cloud/cloudbuild');
  const { ArtifactRegistryClient } = await import(
    '@google-cloud/artifact-registry'
  );
  const { v2: CloudRunV2Module } = await import('@google-cloud/run');
  const { ServicesClient } = CloudRunV2Module;
  const { ServiceUsageClient } = await import('@google-cloud/service-usage');
  const { Logging } = await import('@google-cloud/logging');

  try {
    const context = {
      storage: new Storage({ projectId }),
      cloudBuildClient: new CloudBuildClient({ projectId }),
      artifactRegistryClient: new ArtifactRegistryClient({ projectId }),
      runClient: new ServicesClient({ projectId }),
      serviceUsageClient: new ServiceUsageClient({ projectId }),
      loggingClient: new Logging({ projectId }),
    };

    await ensureApisEnabled(
      context,
      projectId,
      REQUIRED_APIS_FOR_SOURCE_DEPLOY,
      progressCallback
    );

    const bucketName = `${projectId}-source-bucket`;
    const imageUrl = `${region}-docker.pkg.dev/${projectId}/${REPO_NAME}/${serviceName}:${IMAGE_TAG}`;

    await logAndProgress(`Project: ${projectId}`, progressCallback);
    await logAndProgress(`Region: ${region}`, progressCallback);
    await logAndProgress(`Service Name: ${serviceName}`, progressCallback);
    await logAndProgress(`Files to deploy: ${files.length}`, progressCallback);

    let archiveBuffer;
    let archiveName = ZIP_FILE_NAME;

    let canDoZipDeployment = false;
    const packageJson = checkIfNodeJsRuntime(files);
    canDoZipDeployment = packageJson?.scripts?.start;
    if (canDoZipDeployment) {
      await logAndProgress(
        `Node.js runtime detected with start script`,
        progressCallback
      );

      const os = await import('node:os');
      const { exec } = await import('node:child_process');
      const util = await import('node:util');
      const execAsync = util.promisify(exec);

      const homeDir = os.homedir();
      const tempBaseDir = path.join(homeDir, 'tmp', 'cloud-run');
      const tempDir = path.join(tempBaseDir, `source-${Date.now()}`);

      await logAndProgress(
        `Preparing temporary directory: ${tempDir}`,
        progressCallback
      );

      if (!fs.existsSync(tempBaseDir)) {
        fs.mkdirSync(tempBaseDir, { recursive: true });
      }
      fs.mkdirSync(tempDir, { recursive: true });

      // Copy files to temp directory
      for (const file of files) {
        if (typeof file === 'string') {
          const stats = fs.statSync(file);
          if (stats.isDirectory()) {
            // Use CP to recursive copy
            await execAsync(`cp -R "${file}/." "${tempDir}/"`);
          } else {
            const destPath = path.join(tempDir, path.basename(file));
            fs.copyFileSync(file, destPath);
          }
        } else if (typeof file === 'object' && file.filename) {
          const destPath = path.join(tempDir, file.filename);
          const destDir = path.dirname(destPath);
          if (!fs.existsSync(destDir)) {
            fs.mkdirSync(destDir, { recursive: true });
          }
          fs.writeFileSync(destPath, file.content);
        }
      }

      await logAndProgress(
        `Running npm install in ${tempDir}...`,
        progressCallback
      );
      try {
        await execAsync('npm install', { cwd: tempDir });
        await logAndProgress(
          'npm install completed successfully',
          progressCallback
        );
      } catch (e) {
        await logAndProgress(
          `npm install failed: ${e.message}`,
          progressCallback,
          'warn'
        );
      }

      await logAndProgress('Creating tar.gz archive...', progressCallback);
      archiveBuffer = await zipFiles([tempDir], true, progressCallback);
      archiveName = TARGZ_FILE_NAME;

      const MAX_ARCHIVE_SIZE_BYTES = 250 * 1024 * 1024; // 250 MiB
      if (archiveBuffer.length > MAX_ARCHIVE_SIZE_BYTES) {
        const errorMsg = `Warning: Source archive size (${(
          archiveBuffer.length /
          (1024 * 1024)
        ).toFixed(2)} MiB) exceeds the 250 MiB limit.`;
        await logAndProgress(errorMsg, progressCallback, 'warn');
        canDoZipDeployment = false;
        archiveBuffer = undefined;
      }
    }

    const bucket = await ensureStorageBucketExists(
      context,
      bucketName,
      region,
      progressCallback
    );

    if (!canDoZipDeployment) {
      archiveBuffer = await zipFiles(files, false, progressCallback);
    }

    await uploadToStorageBucket(
      context,
      bucket,
      archiveBuffer,
      archiveName,
      progressCallback
    );
    await logAndProgress('Source code uploaded successfully', progressCallback);

    if (canDoZipDeployment) {
      try {
        const zipSourceCode = {
          bucket: bucketName,
          object: TARGZ_FILE_NAME,
        };
        const service = await deployToCloudRun(
          context,
          projectId,
          region,
          serviceName,
          undefined,
          progressCallback,
          skipIamCheck,
          zipSourceCode,
          packageJson
        );
        return service;
      } catch (error) {
        await logAndProgress(
          `Failed to deploy as a Zip: ${error.message}`,
          progressCallback,
          'warn'
        );
        await logAndProgress(
          `Retrying to deploy using Cloud Build...`,
          progressCallback
        );
      }
    }

    await ensureArtifactRegistryRepoExists(
      context,
      projectId,
      region,
      REPO_NAME,
      'DOCKER',
      progressCallback
    );

    const hasDockerfile = checkIfDockerFileExists(files);
    await logAndProgress(`Dockerfile: ${hasDockerfile}`, progressCallback);

    const buildResult = await triggerCloudBuild(
      context,
      projectId,
      region,
      bucketName,
      ZIP_FILE_NAME,
      REPO_NAME,
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
      skipIamCheck
    );

    await logAndProgress(`Deployment Completed Successfully`, progressCallback);
    return service;
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
      REQUIRED_APIS_FOR_IMAGE_DEPLOY,
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
      skipIamCheck
    );

    await logAndProgress(`Deployment Completed Successfully`, progressCallback);
    return service;
  } catch (error) {
    const deployFailedMessage = `Deployment Failed: ${error.message}`;
    console.error(`Deployment Failed`, error);
    await logAndProgress(deployFailedMessage, progressCallback, 'error');
    throw error;
  }
}
