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

// Configuration
const REPO_NAME = 'mcp-cloud-run-deployments';
const ZIP_FILE_NAME = 'source.zip';
const IMAGE_TAG = 'latest';

// APIs required for deploying from source code.
const REQUIRED_APIS_FOR_SOURCE_DEPLOY = [
  'iam.googleapis.com',
  'storage.googleapis.com',
  'cloudbuild.googleapis.com',
  'artifactregistry.googleapis.com',
  'run.googleapis.com',
];

// APIs required for deploying a container image.
const REQUIRED_APIS_FOR_IMAGE_DEPLOY = ['run.googleapis.com'];

const DELAY_WAIT_FOR_BUILD_LOGS = 10000; // 10 seconds delay to allow logs to propagate
const BUILD_LOGS_LINES_TO_FETCH = 100; // Number of log lines to fetch for build logs snippet

// Initialize Clients
let storage;
let cloudBuildClient;
let artifactRegistryClient;
let runClient;

/**
 * Helper function to log a message and call the progress callback.
 * @param {string} message - The message to log.
 * @param {function(object): void} [progressCallback] - Optional callback for progress updates.
 * @param {'debug' | 'info' | 'warn' | 'error'} [severity='info'] - The severity level of the message.
 */
async function logAndProgress(message, progressCallback, severity = 'info') {
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
  const [service] = await serviceUsageClient.getService({
    name: serviceName,
  });
  if (service.state !== 'ENABLED') {
    await logAndProgress(
      `API [${api}] is not enabled. Enabling...`,
      progressCallback
    );
    const [operation] = await serviceUsageClient.enableService({
      name: serviceName,
    });
    await operation.promise();
  }
}

/**
 * Ensures that the specified Google Cloud APIs are enabled for the given project.
 * If an API is not enabled, it attempts to enable it.  Retries any failure once after 1s.
 * Throws an error if an API cannot be enabled.
 *
 * @async
 * @param {string} projectId - The Google Cloud project ID.
 * @param {string[]} apis - An array of API identifiers to check and enable (e.g., 'run.googleapis.com').
 * @param {function(string, string=): void} progressCallback - A function to call with progress updates.
 * The first argument is the message, the optional second argument is the type ('error', 'warning', 'info').
 * @throws {Error} If an API fails to enable or if there's an issue checking its status.
 * @returns {Promise<void>} A promise that resolves when all specified APIs are enabled.
 */
async function ensureApisEnabled(projectId, apis, progressCallback) {
  const { ServiceUsageClient } = await import('@google-cloud/service-usage');
  const serviceUsageClient = new ServiceUsageClient({ projectId });
  await logAndProgress(
    'Checking and enabling required APIs...',
    progressCallback
  );

  for (const api of apis) {
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
      await logAndProgress(
        `Failed to check/enable ${api}, retrying in 1s...`,
        progressCallback,
        'warn'
      );
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
        await logAndProgress(errorMessage, progressCallback, 'error');
        throw new Error(errorMessage);
      }
    }
  }
  await logAndProgress('All required APIs are enabled.', progressCallback);
}

/**
 * Checks if a Cloud Run service already exists.
 *
 * @async
 * @param {string} projectId - The Google Cloud project ID.
 * @param {string} location - The Google Cloud region where the service is located.
 * @param {string} serviceId - The ID of the Cloud Run service.
 * @param {function(object): void} [progressCallback] - Optional callback for progress updates.
 * @returns {Promise<boolean>} A promise that resolves to true if the service exists, false otherwise.
 * @throws {Error} If there's an error checking the service (other than not found).
 */
async function checkCloudRunServiceExists(
  projectId,
  location,
  serviceId,
  progressCallback
) {
  const parent = runClient.locationPath(projectId, location);
  const servicePath = runClient.servicePath(projectId, location, serviceId);
  try {
    await runClient.getService({ name: servicePath });
    await logAndProgress(
      `Cloud Run service ${serviceId} already exists.`,
      progressCallback
    );
    return true;
  } catch (error) {
    if (error.code === 5) {
      await logAndProgress(
        `Cloud Run service ${serviceId} does not exist.`,
        progressCallback
      );
      return false;
    }
    const errorMessage = `Error checking Cloud Run service ${serviceId}: ${error.message}`;
    console.error(`Error checking Cloud Run service ${serviceId}:`, error);
    await logAndProgress(errorMessage, progressCallback, 'error');
    throw error;
  }
}

/**
 * Deploys or updates a Cloud Run service with the specified container image.
 * If the service exists, it's updated; otherwise, a new service is created.
 * The service is configured to be publicly accessible.
 *
 * @async
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
  skipIamCheck
) {
  const parent = runClient.locationPath(projectId, location);
  const servicePath = runClient.servicePath(projectId, location, serviceId);
  const revisionName = `${serviceId}-${Date.now()}`; // Generate a unique revision name

  const service = {
    template: {
      revision: revisionName,
      containers: [{ image: imgUrl }],
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
        await runClient.updateService({
          service: dryRunServiceConfig,
          validateOnly: true,
        });
      } else {
        await runClient.createService({
          parent: parent,
          service: dryRunServiceConfig,
          serviceId: serviceId,
          validateOnly: true,
        });
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
      [operation] = await runClient.updateService({ service });
    } else {
      await logAndProgress(
        `Creating new service ${serviceId}...`,
        progressCallback
      );
      [operation] = await runClient.createService({
        parent: parent,
        service: service, // 'service' object might have invokerIamDisabled removed
        serviceId: serviceId,
      });
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
 * Ensures that a Google Cloud Storage bucket exists.
 * If the bucket does not exist, it attempts to create it in the specified location.
 *
 * @async
 * @param {string} bucketName - The name of the storage bucket.
 * @param {string} [location='us'] - The location to create the bucket in if it doesn't exist. Defaults to 'us'.
 * @param {function(object): void} [progressCallback] - Optional callback for progress updates.
 * @returns {Promise<import('@google-cloud/storage').Bucket>} A promise that resolves with the GCS Bucket object.
 * @throws {Error} If there's an error checking or creating the bucket.
 */
async function ensureStorageBucketExists(
  bucketName,
  location = 'us',
  progressCallback
) {
  const bucket = storage.bucket(bucketName);
  try {
    const [exists] = await bucket.exists();
    if (exists) {
      await logAndProgress(
        `Bucket ${bucketName} already exists.`,
        progressCallback
      );
      return bucket;
    } else {
      await logAndProgress(
        `Bucket ${bucketName} does not exist. Creating in location ${location}...`,
        progressCallback
      );
      try {
        const [createdBucket] = await storage.createBucket(bucketName, {
          location: location,
        });
        await logAndProgress(
          `Storage bucket ${createdBucket.name} created successfully in ${location}.`,
          progressCallback
        );
        return createdBucket;
      } catch (createError) {
        const errorMessage = `Failed to create storage bucket ${bucketName}. Error details: ${createError.message}`;
        console.error(
          `Failed to create storage bucket ${bucketName}. Error details:`,
          createError
        );
        await logAndProgress(errorMessage, progressCallback, 'error');
        throw createError;
      }
    }
  } catch (error) {
    const errorMessage = `Error checking/creating bucket ${bucketName}: ${error.message}`;
    console.error(`Error checking/creating bucket ${bucketName}:`, error);
    await logAndProgress(errorMessage, progressCallback, 'error');
    throw error;
  }
}

/**
 * Creates a zip archive in memory from a list of file paths and/or file objects.
 * File objects should have `filename` (string) and `content` (Buffer or string) properties.
 *
 * @param {Array<string|{filename: string, content: Buffer|string}>} files - An array of items to zip.
 * Each item can be a string representing a file/directory path, or an object
 * with `filename` and `content` properties for in-memory files.
 * @param {function(object): void} [progressCallback] - Optional callback for progress updates.
 * @returns {Promise<Buffer>} A promise that resolves with a Buffer containing the zip data.
 * @throws {Error} If an input file path is not found, an input item has an invalid format, or an archiver error occurs.
 */
async function zipFiles(files, progressCallback) {
  const path = await import('path');
  const fs = await import('fs');
  const archiver = (await import('archiver')).default;

  return new Promise((resolve, reject) => {
    logAndProgress('Creating in-memory zip archive...', progressCallback);
    const chunks = [];
    const archive = archiver('zip', {
      zlib: { level: 9 },
    });

    archive.on('data', (chunk) => chunks.push(chunk));
    archive.on('end', () => {
      logAndProgress(
        `Files zipped successfully. Total size: ${archive.pointer()} bytes`,
        progressCallback
      );
      resolve(Buffer.concat(chunks));
    });

    archive.on('warning', (err) => {
      const warningMessage = `Archiver warning: ${err}`;
      logAndProgress(warningMessage, progressCallback, 'warn');
      if (err.code !== 'ENOENT') {
        // ENOENT is often just a warning, others might be more critical for zip
        reject(err);
      }
    });

    archive.on('error', (err) => {
      const errorMessage = `Archiver error: ${err.message}`;
      console.error(errorMessage, err);
      logAndProgress(errorMessage, progressCallback, 'error');
      reject(err);
    });

    files.forEach((file) => {
      if (typeof file === 'object' && 'filename' in file && 'content' in file) {
        archive.append(file.content, { name: file.filename });
      } else if (typeof file === 'string') {
        let pathInput = file;

        // This is a "hack" to better support WSL on Windows. AI agents tend to send path that start with '/c' in that case. Re-write it to '/mnt/c'
        if (pathInput.startsWith('/c')) {
          pathInput = `/mnt${pathInput}`;
        }
        const filePath = path.resolve(pathInput);
        if (!fs.existsSync(filePath)) {
          throw new Error(`File or directory not found: ${filePath}`);
        }

        const stats = fs.statSync(filePath);
        if (stats.isDirectory()) {
          archive.directory(filePath, false);
        } else {
          archive.file(filePath, { name: path.basename(filePath) });
        }
      } else {
        throw new Error(`Invalid file format: ${JSON.stringify(file)}`);
      }
    });

    archive.finalize();
  });
}

/**
 * Uploads a buffer to a specified Google Cloud Storage bucket and blob name.
 *
 * @async
 * @param {import('@google-cloud/storage').Bucket} bucket - The Google Cloud Storage bucket object.
 * @param {Buffer} buffer - The buffer containing the data to upload.
 * @param {string} destinationBlobName - The name for the blob in the bucket.
 * @param {function(object): void} [progressCallback] - Optional callback for progress updates.
 * @returns {Promise<import('@google-cloud/storage').File>} A promise that resolves with the GCS File object representing the uploaded blob.
 * @throws {Error} If the upload fails.
 */
async function uploadToStorageBucket(
  bucket,
  buffer,
  destinationBlobName,
  progressCallback
) {
  try {
    await logAndProgress(
      `Uploading buffer to gs://${bucket.name}/${destinationBlobName}...`,
      progressCallback
    );
    await bucket.file(destinationBlobName).save(buffer);
    await logAndProgress(
      `File ${destinationBlobName} uploaded successfully to gs://${bucket.name}/${destinationBlobName}.`,
      progressCallback
    );
    return bucket.file(destinationBlobName);
  } catch (error) {
    const errorMessage = `Error uploading buffer: ${error.message}`;
    console.error(`Error uploading buffer:`, error);
    await logAndProgress(errorMessage, progressCallback, 'error');
    throw error;
  }
}

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
async function ensureArtifactRegistryRepoExists(
  projectId,
  location,
  repositoryId,
  format = 'DOCKER',
  progressCallback
) {
  const parent = `projects/${projectId}/locations/${location}`;
  const repoPath = artifactRegistryClient.repositoryPath(
    projectId,
    location,
    repositoryId
  );

  try {
    const [repository] = await artifactRegistryClient.getRepository({
      name: repoPath,
    });
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
      try {
        const [operation] = await artifactRegistryClient.createRepository({
          parent: parent,
          repository: repositoryToCreate,
          repositoryId: repositoryId,
        });
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
      } catch (createError) {
        const errorMessage = `Failed to create Artifact Registry repository ${repositoryId}. Error details: ${createError.message}`;
        console.error(
          `Failed to create Artifact Registry repository ${repositoryId}. Error details:`,
          createError
        );
        await logAndProgress(errorMessage, progressCallback, 'error');
        throw createError;
      }
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

/**
 * Triggers a Google Cloud Build job to build a container image from source code in a GCS bucket.
 * It uses either a Dockerfile found in the source or Google Cloud Buildpacks if no Dockerfile is present.
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
async function triggerCloudBuild(
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
  const [operation] = await cloudBuildClient.createBuild({
    projectId: projectId,
    build: build,
  });

  await logAndProgress(`Cloud Build job started...`, progressCallback);
  const buildId = operation.metadata.build.id;
  let completedBuild;
  while (true) {
    const [getBuildOperation] = await cloudBuildClient.getBuild({
      projectId: projectId,
      id: buildId,
    });
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
      const [entries] = await loggingClient.getEntries({
        filter: logFilter,
        orderBy: 'timestamp desc', // Get latest logs first
        pageSize: BUILD_LOGS_LINES_TO_FETCH,
      });

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

/**
 * Deploys a service to Google Cloud Run.
 * @param {object} config - The deployment configuration.
 * @param {string} config.projectId - The Google Cloud project ID.
 * @param {string} [config.serviceName='app'] - The name of the Cloud Run service. Defaults to 'app'.
 * @param {string} [config.region='europe-west1'] - The Google Cloud region for deployment. Defaults to 'europe-west1'.
 * @param {Array<string|{filename: string, content: Buffer|string}>} config.files - An array of file paths or file objects (with `filename` and `content`) to deploy.
 * @param {function(object): void} [config.progressCallback] - Optional callback for progress updates. Receives an object with `level` and `data` properties.
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
    process.exit(1);
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

  try {
    await ensureApisEnabled(
      projectId,
      REQUIRED_APIS_FOR_SOURCE_DEPLOY,
      progressCallback
    );

    storage = new Storage({ projectId });
    cloudBuildClient = new CloudBuildClient({ projectId });
    artifactRegistryClient = new ArtifactRegistryClient({ projectId });
    runClient = new ServicesClient({ projectId });

    const bucketName = `${projectId}-source-bucket`;
    const imageUrl = `${region}-docker.pkg.dev/${projectId}/${REPO_NAME}/${serviceName}:${IMAGE_TAG}`;

    await logAndProgress(`Project: ${projectId}`, progressCallback);
    await logAndProgress(`Region: ${region}`, progressCallback);
    await logAndProgress(`Service Name: ${serviceName}`, progressCallback);
    await logAndProgress(`Files to deploy: ${files.length}`, progressCallback);

    let hasDockerfile = false;
    if (
      files.length === 1 &&
      typeof files[0] === 'string' &&
      fs.statSync(files[0]).isDirectory()
    ) {
      // Handle folder deployment: check for Dockerfile inside the folder
      const dockerfilePath = path.join(files[0], 'Dockerfile');
      const dockerfilePathLowerCase = path.join(files[0], 'dockerfile');
      if (
        fs.existsSync(dockerfilePath) ||
        fs.existsSync(dockerfilePathLowerCase)
      ) {
        hasDockerfile = true;
      }
    } else {
      // Handle file list deployment or file content deployment
      for (const file of files) {
        if (typeof file === 'string') {
          if (path.basename(file).toLowerCase() === 'dockerfile') {
            hasDockerfile = true;
            break;
          }
        } else if (typeof file === 'object' && file.filename) {
          if (path.basename(file.filename).toLowerCase() === 'dockerfile') {
            hasDockerfile = true;
            break;
          }
        }
      }
    }
    await logAndProgress(`Dockerfile: ${hasDockerfile}`, progressCallback);

    const bucket = await ensureStorageBucketExists(
      bucketName,
      region,
      progressCallback
    );

    const zipBuffer = await zipFiles(files, progressCallback);
    await uploadToStorageBucket(
      bucket,
      zipBuffer,
      ZIP_FILE_NAME,
      progressCallback
    );
    await logAndProgress('Source code uploaded successfully', progressCallback);

    await ensureArtifactRegistryRepoExists(
      projectId,
      region,
      REPO_NAME,
      'DOCKER',
      progressCallback
    );

    const buildResult = await triggerCloudBuild(
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
 * @param {function(object): void} [config.progressCallback] - Optional callback for progress updates. Receives an object with `level` and `data` properties.
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
    process.exit(1);
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

  try {
    await ensureApisEnabled(
      projectId,
      REQUIRED_APIS_FOR_IMAGE_DEPLOY,
      progressCallback
    );

    runClient = new ServicesClient({ projectId });

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
