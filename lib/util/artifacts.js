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

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { logAndProgress } from './helpers.js';
import { getArtifactRegistryClient } from '../clients.js';

const AR_HOST = 'https://artifactregistry.googleapis.com';
const AR_DOWNLOAD_PATH_PREFIX = '/download/v1/';
const AR_DOWNLOAD_URL_SUFFIX = ':download?alt=media';

/**
 * Checks if the existing binary is up to date by comparing its SHA256 hash with the remote metadata.
 * If the binary is out of date, it removes it.
 * @param {string} binPath - Path to the local binary.
 * @param {object} artifactParams - Parameters for the remote artifact.
 * @param {string} artifactParams.project - Artifact Registry project.
 * @param {string} artifactParams.location - Artifact Registry location.
 * @param {string} artifactParams.repository - Artifact Registry repository.
 * @param {string} artifactParams.artifactPath - Path to the artifact within the repository.
 * @param {string} artifactParams.displayName - A friendly name for logging.
 * @param {string} accessToken - Access token for authentication.
 * @param {function} progressCallback - Progress callback.
 * @returns {Promise<boolean>} True if the binary is up to date, false otherwise.
 */
export async function isBinaryUpToDate(
  binPath,
  artifactParams,
  accessToken,
  progressCallback
) {
  const { project, location, repository, artifactPath, displayName } =
    artifactParams;

  if (!fs.existsSync(binPath)) {
    return false;
  }

  try {
    await logAndProgress(
      `Checking for ${displayName} updates...`,
      progressCallback,
      'debug'
    );

    const artifactRegistryClient = await getArtifactRegistryClient(
      project,
      accessToken
    );
    const resourceName = artifactRegistryClient.filePath(
      project,
      location,
      repository,
      artifactPath
    );

    const [file] = await artifactRegistryClient.getFile({ name: resourceName });
    const remoteSha256Base64 = file.hashes?.find(
      (h) => h.type === 'SHA256'
    )?.value;

    if (!remoteSha256Base64) {
      return false; // Cannot verify, download new binary
    }

    const remoteSha256Hex = Buffer.from(remoteSha256Base64, 'base64').toString(
      'hex'
    );
    const localFileContent = fs.readFileSync(binPath);
    const localSha256Hex = crypto
      .createHash('sha256')
      .update(localFileContent)
      .digest('hex');

    if (remoteSha256Hex === localSha256Hex) {
      await logAndProgress(
        `${displayName} binary is up to date.`,
        progressCallback,
        'debug'
      );
      return true;
    }

    await logAndProgress(
      `${displayName} binary is out of date. Removing existing binary.`,
      progressCallback,
      'debug'
    );
    fs.unlinkSync(binPath);
    return false;
  } catch (error) {
    await logAndProgress(
      `Could not check for ${displayName} updates: ${error.message}. Downloading the new binary.`,
      progressCallback,
      'debug'
    );
    return false; // On error, fallback to downloading the new binary
  }
}

/**
 * Downloads a binary from Artifact Registry if it doesn't exist or is out of date.
 * @param {string} binPath - Path where the binary should be stored.
 * @param {object} artifactParams - Parameters for the remote artifact.
 * @param {string} artifactParams.project - Artifact Registry project.
 * @param {string} artifactParams.location - Artifact Registry location.
 * @param {string} artifactParams.repository - Artifact Registry repository.
 * @param {string} artifactParams.artifactPath - Path to the artifact within the repository.
 * @param {string} artifactParams.displayName - A friendly name for logging.
 * @param {string} accessToken - Access token for authentication.
 * @param {function} progressCallback - Progress callback.
 * @returns {Promise<string|null>} Path to the binary or null if it fails.
 */
export async function ensureRepositoryDownloaded(
  binPath,
  artifactParams,
  accessToken,
  progressCallback
) {
  const { project, location, repository, artifactPath, displayName } =
    artifactParams;
  const binDir = path.dirname(binPath);

  if (
    await isBinaryUpToDate(
      binPath,
      artifactParams,
      accessToken,
      progressCallback
    )
  ) {
    return binPath;
  }

  await logAndProgress(`Downloading ${displayName}...`, progressCallback);

  try {
    if (!fs.existsSync(binDir)) {
      fs.mkdirSync(binDir, { recursive: true });
    }

    const artifactRegistryClient = await getArtifactRegistryClient(
      project,
      accessToken
    );
    const resourceName = artifactRegistryClient.filePath(
      project,
      location,
      repository,
      artifactPath
    );

    const url = `${AR_HOST}${AR_DOWNLOAD_PATH_PREFIX}${resourceName}${AR_DOWNLOAD_URL_SUFFIX}`;
    const response = await artifactRegistryClient.auth.request({
      url,
      responseType: 'stream',
    });

    const dest = fs.createWriteStream(binPath);
    await new Promise((resolve, reject) => {
      response.data.pipe(dest).on('finish', resolve).on('error', reject);
    });

    fs.chmodSync(binPath, '755');
    return binPath;
  } catch (error) {
    await logAndProgress(
      `Failed to download ${displayName}: ${error.message}`,
      progressCallback,
      'debug'
    );
    return null;
  }
}
