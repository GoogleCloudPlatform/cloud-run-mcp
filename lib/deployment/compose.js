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

import path from 'path';
import { promises as fsPromises } from 'fs';
import os from 'os';
import util from 'util';
import { execFile } from 'child_process';
import crypto from 'crypto';
import { logAndProgress } from '../util/helpers.js';
import { uploadDirectory } from './helpers.js';
import { TEMP_PATHS } from './constants.js';
import { ensureRepositoryDownloaded } from '../util/artifacts.js';
import {
  ensureStorageBucketExists,
  uploadToStorageBucket,
  grantBucketAccess,
} from '../cloud-api/storage.js';
import { zipFiles } from '../util/archive.js';
import { getProjectNumber } from '../util/helpers.js';
import { ensureApisEnabled } from '../cloud-api/helpers.js';
import {
  getSecret,
  createSecret,
  addSecretVersion,
  addSecretAccessorBinding,
} from '../cloud-api/secrets.js';

const execFileAsync = util.promisify(execFile);

const RUN_COMPOSE_BIN = 'run-compose';
const RUN_COMPOSE_VERSION = '1.0.0';

// TODO: Move to production project
const AR_PROJECT = 'test-project-123456';
const AR_LOCATION = 'us-west1';
const AR_REPOSITORY = 'run-compose';

const ARCH_MAPPING = {
  linux_x64: 'x86-64',
  darwin_arm64: 'darwin-arm64',
};

const _MAX_BUCKET_NAME_LENGTH = 63;
const _HASH_LENGTH = 8;
const SHA1 = 'sha1';
const COMPOSE_SUFFIX = 'compose';
const HEX_ENCODING = 'hex';

/**
 * Gets the architecture key for the current platform.
 * @returns {string|null} The architecture key or null if not supported.
 */
function getRunComposeArchitectureKey() {
  const platform = process.platform;
  const arch = process.arch;

  if (platform === 'linux' && arch === 'x64') {
    return 'linux_x64';
  } else if (platform === 'darwin' && arch === 'arm64') {
    return 'darwin_arm64';
  }
  return null;
}

/**
 * Ensures run-compose binary is downloaded and returns its path.
 * @param {string} accessToken - Access token for authentication.
 * @param {function} progressCallback - Progress callback.
 * @returns {Promise<string|null>} The path to the downloaded binary or null if it fails.
 */
export async function runCompose(accessToken, progressCallback) {
  const binDir = path.join(
    os.homedir(),
    TEMP_PATHS.BASE,
    TEMP_PATHS.BIN_SUBDIR
  );
  const key = getRunComposeArchitectureKey();
  if (!key) {
    await logAndProgress(
      `run-compose is not supported on ${process.platform} ${process.arch}.`,
      progressCallback,
      'debug'
    );
    return null;
  }

  const arch = ARCH_MAPPING[key];
  const binPath = path.join(binDir, RUN_COMPOSE_BIN);

  const binPathResult = await ensureRepositoryDownloaded(
    binPath,
    {
      project: AR_PROJECT,
      location: AR_LOCATION,
      repository: AR_REPOSITORY,
      artifactPath: `${arch}:${RUN_COMPOSE_VERSION}:${RUN_COMPOSE_BIN}`,
      displayName: 'run-compose',
    },
    accessToken,
    progressCallback
  );

  if (!binPathResult) {
    return null;
  }

  return binPathResult;
}

/**
 * Gets resource configuration for a compose file using the run-compose binary.
 *
 * @param {string} binPath - Path to the run-compose binary.
 * @param {string} composeFilePath - Path to the compose.yaml file.
 * @param {string} region - The Google Cloud region.
 * @param {function} progressCallback - Optional callback for progress updates.
 * @returns {Promise<string>} The output from the resource command.
 */
export async function resourceCompose(
  binPath,
  composeFilePath,
  region,
  progressCallback
) {
  try {
    const parentDir = path.dirname(composeFilePath);
    await logAndProgress(
      `Running command: ${binPath} resource ${composeFilePath} --region ${region} --out .`,
      progressCallback,
      'debug'
    );

    const { stdout, stderr } = await execFileAsync(
      binPath,
      ['resource', composeFilePath, '--region', region, '--out', '.'],
      { cwd: parentDir }
    );

    if (stderr) {
      await logAndProgress(
        `run-compose resource stderr: ${stderr}`,
        progressCallback,
        'warn'
      );
    }
    return stdout;
  } catch (error) {
    const errorMsg = `Failed to get resources for compose file: ${error.message}`;
    await logAndProgress(errorMsg, progressCallback, 'error');
    throw new Error(errorMsg);
  }
}

/**
 * Translates a compose file using the run-compose binary.
 *
 * @param {string} binPath - Path to the run-compose binary.
 * @param {string} composeFilePath - Path to the compose.yaml file.
 * @param {string} region - The Google Cloud region.
 * @param {string} projectNumber - The Google Cloud project number.
 * @param {function} progressCallback - Optional callback for progress updates.
 * @param {object} [resourcesConfig] - Optional resource configuration.
 * @returns {Promise<string>} The output from the translation command.
 */
export async function translateCompose(
  binPath,
  composeFilePath,
  region,
  projectNumber,
  progressCallback,
  resourcesConfig = null
) {
  try {
    const parentDir = path.dirname(composeFilePath);
    await logAndProgress(
      `Translating compose file ${composeFilePath}...`,
      progressCallback
    );
    const args = [
      'translate',
      composeFilePath,
      '--region',
      region,
      '--project-number',
      projectNumber,
      '--out',
      '.',
    ];

    if (resourcesConfig) {
      const configStr = JSON.stringify(resourcesConfig);
      args.push('--resources-config', configStr);
    }

    await logAndProgress(
      `Running command: "${binPath}" ${args.join(' ')}`,
      progressCallback,
      'debug'
    );

    const { stdout, stderr } = await execFileAsync(binPath, args, {
      cwd: parentDir,
    });

    if (stderr) {
      await logAndProgress(
        `run-compose translate stderr: ${stderr}`,
        progressCallback,
        'warn'
      );
    }

    await logAndProgress(
      'Compose file translated successfully.',
      progressCallback
    );
    return stdout;
  } catch (error) {
    const errorMsg = `Failed to translate compose file: ${error.message}`;
    await logAndProgress(errorMsg, progressCallback, 'error');
    throw new Error(errorMsg);
  }
}

/**
 * Handle volumes defined in resourcesConfig (bind volumes and named volumes)
 * @param {Object} resourcesConfig - resourcesConfig received from `run-compose resource` call
 * @param {string} accessToken - access token for authentication
 * @param {string} projectId - GCP project id
 * @param {string} region - GCP region
 * @param {string} folderPath - Path to the folder containing the source code
 * @param {function} progressCallback - Callback function to report progress
 * @returns {Promise<Object>} - Completed resourcesConfig object
 */
export async function composeVolumes(
  resourcesConfig,
  accessToken,
  projectId,
  region,
  folderPath,
  progressCallback
) {
  const hasBindVolumes =
    resourcesConfig.volumes && resourcesConfig.volumes.bind_mount;
  const hasNamedVolumes =
    resourcesConfig.volumes && resourcesConfig.volumes.named_volume;

  if (hasBindVolumes || hasNamedVolumes) {
    const projectNumber = await getProjectNumber(projectId, accessToken);
    const projectName = resourcesConfig.project;
    const sanitizedComposeProjectName = projectName
      .toLowerCase()
      .replace(/[^a-z0-9]/g, '-')
      .replace(/-+/g, '-');

    const bucketNameCandidate = `${projectNumber}-${sanitizedComposeProjectName}-${region}-${COMPOSE_SUFFIX}`;
    let bucketName = bucketNameCandidate;
    if (bucketNameCandidate.length > _MAX_BUCKET_NAME_LENGTH) {
      const projectHash = crypto
        .createHash(SHA1)
        .update(sanitizedComposeProjectName)
        .digest(HEX_ENCODING)
        .slice(0, _HASH_LENGTH);
      bucketName = `${projectNumber}-${projectHash}-${region}-${COMPOSE_SUFFIX}`;
    }

    resourcesConfig.volumes = resourcesConfig.volumes || {};
    resourcesConfig.volumes.bucket_name = bucketName;

    if (hasBindVolumes) {
      await handleBindMounts(
        resourcesConfig,
        projectId,
        projectNumber,
        bucketName,
        region,
        folderPath,
        accessToken,
        progressCallback
      );
    }

    if (hasNamedVolumes) {
      await handleNamedVolumes(
        resourcesConfig,
        projectId,
        projectNumber,
        bucketName,
        region,
        accessToken,
        progressCallback
      );
    }
  }

  return resourcesConfig;
}

/**
 * Handles uploading and configuring bind mounts for Cloud Run Compose.
 * @param {Object} resourcesConfig - The resource configuration to update.
 * @param {string} projectId - GCP project ID.
 * @param {string} projectNumber - GCP project number.
 * @param {string} bucketName - Staging bucket name.
 * @param {string} region - GCP region.
 * @param {string} folderPath - Local path to the compose project.
 * @param {string} accessToken - OAuth2 access token.
 * @param {Function} progressCallback - Callback for progress updates.
 */
async function handleBindMounts(
  resourcesConfig,
  projectId,
  projectNumber,
  bucketName,
  region,
  folderPath,
  accessToken,
  progressCallback
) {
  const computeServiceAccount = `serviceAccount:${projectNumber}-compute@developer.gserviceaccount.com`;

  // Explicitly ensure the bucket exists in the project
  const bucket = await ensureStorageBucketExists(
    projectId,
    bucketName,
    region,
    accessToken,
    progressCallback
  );

  await grantBucketAccess(
    bucket,
    'roles/storage.objectAdmin',
    computeServiceAccount,
    progressCallback
  );

  const bindMountsData = resourcesConfig.volumes.bind_mount;

  // Handle both Map (serviceName -> mounts) and potential direct mounts list
  const entries = Array.isArray(bindMountsData)
    ? [['direct', bindMountsData]]
    : Object.entries(bindMountsData);

  for (const [serviceName, mounts] of entries) {
    // Ensure mounts is an array
    const mountsArray = Array.isArray(mounts) ? mounts : [mounts];

    for (const mount of mountsArray) {
      const source = mount.source || mount.path; // handle both naming conventions
      if (!source) continue;

      const fullSourcePath = path.resolve(folderPath, source);

      try {
        await fsPromises.access(fullSourcePath);
      } catch {
        const errorMsg = `Bind mount source '${source}' for service '${serviceName}' does not exist.`;
        await logAndProgress(errorMsg, progressCallback, 'error');
        throw new Error(errorMsg);
      }

      let gcsPath;
      const relativeSourcePath = path.relative(folderPath, fullSourcePath);

      if (relativeSourcePath === '' || relativeSourcePath === '.') {
        gcsPath = `bind_mounts/${serviceName}`;
      } else {
        const sourceBasename = path.basename(fullSourcePath);
        gcsPath = `bind_mounts/${serviceName}/${sourceBasename}`;
      }

      mount.mount_source = gcsPath;
      // Also update volume_id for backward compatibility if needed
      mount.volume_id = `gs://${bucketName}/${gcsPath}`;

      const stats = await fsPromises.stat(fullSourcePath);
      if (stats.isDirectory()) {
        await logAndProgress(
          `Uploading bind mount directory ${source} for service ${serviceName} to gs://${bucketName}/${gcsPath}/...`,
          progressCallback
        );
        await uploadDirectory(
          bucket,
          fullSourcePath,
          gcsPath,
          progressCallback
        );
      } else {
        await logAndProgress(
          `Uploading bind mount file ${source} for service ${serviceName} to gs://${bucketName}/${gcsPath}...`,
          progressCallback
        );
        const fileBuffer = await fsPromises.readFile(fullSourcePath);
        await uploadToStorageBucket(
          bucket,
          fileBuffer,
          gcsPath,
          progressCallback
        );
      }
    }
  }
}

/**
 * Handles ensuring buckets exist for named volumes using GCS.
 * @param {Object} resourcesConfig - The resource configuration.
 * @param {string} projectId - GCP project ID.
 * @param {string} projectNumber - GCP project number.
 * @param {string} bucketName - Staging bucket name.
 * @param {string} region - GCP region.
 * @param {string} accessToken - OAuth2 access token.
 * @param {Function} progressCallback - Callback for progress updates.
 */
async function handleNamedVolumes(
  resourcesConfig,
  projectId,
  projectNumber,
  bucketName,
  region,
  accessToken,
  progressCallback
) {
  const namedVolumes = resourcesConfig.volumes.named_volume;
  if (!namedVolumes || Object.keys(namedVolumes).length === 0) {
    return;
  }

  const computeServiceAccount = `serviceAccount:${projectNumber}-compute@developer.gserviceaccount.com`;

  // Ensure the shared staging bucket exists
  const bucket = await ensureStorageBucketExists(
    projectId,
    bucketName,
    region,
    accessToken,
    progressCallback
  );

  // Grant access to the compute service account
  await grantBucketAccess(
    bucket,
    'roles/storage.objectAdmin',
    computeServiceAccount,
    progressCallback
  );
}

/**
 * Handle secrets defined in resourcesConfig.
 * @param {Object} resourcesConfig - resourcesConfig received from `run-compose resource` call.
 * @param {string} accessToken - access token for authentication.
 * @param {string} projectId - GCP project ID.
 * @param {string} folderPath - Path to the folder containing the source code.
 * @param {function} progressCallback - Callback function to report progress.
 * @returns {Promise<Object>} - Completed resourcesConfig object.
 */
export async function composeSecrets(
  resourcesConfig,
  accessToken,
  projectId,
  folderPath,
  progressCallback
) {
  if (
    !resourcesConfig.secrets ||
    Object.keys(resourcesConfig.secrets).length === 0
  ) {
    return resourcesConfig;
  }

  // Ensure Secret Manager API is enabled
  await ensureApisEnabled(
    projectId,
    ['secretmanager.googleapis.com'],
    accessToken,
    progressCallback
  );

  const projectNumber = await getProjectNumber(projectId, accessToken);
  const computeServiceAccount = `${projectNumber}-compute@developer.gserviceaccount.com`;

  const secretEntries = Object.entries(resourcesConfig.secrets);

  for (const [secretName, secretConfig] of secretEntries) {
    // Expected structure in secretConfig: { name, file, mount }
    if (!secretConfig.name || !secretConfig.file || !secretConfig.mount) {
      await logAndProgress(
        `Secret configuration for ${secretName} is incomplete. 'name', 'file' and 'mount' are required.`,
        progressCallback,
        'warn'
      );
      continue;
    }

    const fullFilePath = path.resolve(folderPath, secretConfig.file);
    try {
      await fsPromises.access(fullFilePath);
    } catch {
      const errorMsg = `Secret file not found: ${fullFilePath}`;
      await logAndProgress(errorMsg, progressCallback, 'error');
      throw new Error(errorMsg);
    }

    const secretId = secretConfig.name;

    // Check if secret exists
    let secret = await getSecret(projectId, secretId, accessToken);
    if (!secret) {
      secret = await createSecret(
        projectId,
        secretId,
        accessToken,
        progressCallback
      );
    }

    // Add IAM policy binding
    await addSecretAccessorBinding(
      projectId,
      secretId,
      `serviceAccount:${computeServiceAccount}`,
      accessToken,
      progressCallback
    );

    // Add secret version
    const secretContent = await fsPromises.readFile(fullFilePath);
    const version = await addSecretVersion(
      projectId,
      secretId,
      secretContent,
      accessToken,
      progressCallback
    );

    // Update secret_version in config
    secretConfig.secret_version = version.name;

    await logAndProgress(
      `Secret '${secretId}' version '${version.name}' prepared for usage.`,
      progressCallback
    );
  }

  return resourcesConfig;
}
