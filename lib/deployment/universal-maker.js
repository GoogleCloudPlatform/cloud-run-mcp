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

import { exec } from 'child_process';
import fs from 'fs';
import path from 'path';
import os from 'os';
import util from 'util';
import crypto from 'crypto';
import { logAndProgress } from '../util/helpers.js';
import { TEMP_PATHS } from './constants.js';
import { getArtifactRegistryClient } from '../clients.js';
import { GCLOUD_AUTH } from '../../constants.js';

const execAsync = util.promisify(exec);

const UNIVERSAL_MAKER_BIN = 'universal_maker';
const UM_VERSION = '1.0.0';

const AR_HOST = 'https://artifactregistry.googleapis.com';
const AR_PROJECT = 'serverless-runtimes-qa';
const AR_LOCATION = 'us-central1';
const AR_REPOSITORY = 'universal-maker';
const AR_DOWNLOAD_PATH_PREFIX = '/download/v1/';
const AR_DOWNLOAD_URL_SUFFIX = ':download?alt=media';

const ARCH_MAPPING = {
  linux_x64: 'x86-64',
  darwin_arm64: 'darwin-arm64',
};

/**
 * Gets the architecture key for the current platform.
 * @returns {string|null} The architecture key or null if not supported.
 */
function getUniversalMakerArchitectureKey() {
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
 * Checks if the existing binary is up to date by comparing its SHA256 mash with the remote metadata.
 * If the binary is out of date, it removes it.
 * @param {string} binPath - Path to the local binary.
 * @param {string} arch - Current architecture.
 * @param {string} accessToken - Access token for authentication.
 * @param {function} progressCallback - Progress callback.
 * @returns {Promise<boolean>} True if the binary is up to date (or if updating fails), false otherwise.
 */
async function isBinaryUpToDate(
  binPath,
  arch,
  accessToken,
  progressCallback
) {
  if (!fs.existsSync(binPath)) {
    return false;
  }

  try {
    await logAndProgress(
      'Checking for Universal Maker updates...',
      progressCallback,
      'debug'
    );

    const artifactRegistryClient = await getArtifactRegistryClient(
      AR_PROJECT,
      accessToken
    );
    const resourceName = artifactRegistryClient.filePath(
      AR_PROJECT,
      AR_LOCATION,
      AR_REPOSITORY,
      `${arch}:${UM_VERSION}:${UNIVERSAL_MAKER_BIN}`
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
        'Universal Maker binary is up to date.',
        progressCallback,
        'debug'
      );
      return true;
    }

    await logAndProgress(
      'Universal Maker binary is out of date. Removing existing binary.',
      progressCallback,
      'debug'
    );
    fs.unlinkSync(binPath);
    return false;
  } catch (error) {
    await logAndProgress(
      `Could not check for Universal Maker updates: ${error.message}. Downloading the new binary.`,
      progressCallback,
      'debug'
    );
    return false; // On error, fallback to downloading the new binary
  }
}

/**
 * Downloads the universal maker binary if it doesn't exist.
 * @param {string} binDir - Directory to store the binary.
 * @param {string} accessToken - Access token for authentication.
 * @param {function} progressCallback - Progress callback.
 * @returns {Promise<string|null>} Path to the binary or null if not supported.
 */
async function ensureUniversalMaker(
  binDir,
  accessToken,
  progressCallback
) {
  const key = getUniversalMakerArchitectureKey();

  if (!key) {
    await logAndProgress(
      `Universal Maker is not supported on ${process.platform} ${process.arch}.`,
      progressCallback,
      'debug'
    );
    return null;
  }

  const binPath = path.join(binDir, UNIVERSAL_MAKER_BIN);
  const arch = ARCH_MAPPING[key];

  if (
    await isBinaryUpToDate(binPath, arch, accessToken, progressCallback)
  ) {
    return binPath;
  }

  await logAndProgress(`Downloading Universal Maker...`, progressCallback);

  try {
    if (!fs.existsSync(binDir)) {
      fs.mkdirSync(binDir, { recursive: true });
    }

    const artifactRegistryClient = await getArtifactRegistryClient(
      AR_PROJECT,
      accessToken
    );
    const resourceName = artifactRegistryClient.filePath(
      AR_PROJECT,
      AR_LOCATION,
      AR_REPOSITORY,
      `${arch}:${UM_VERSION}:${UNIVERSAL_MAKER_BIN}`
    );

    const url = `${AR_HOST}${AR_DOWNLOAD_PATH_PREFIX}${resourceName}${AR_DOWNLOAD_URL_SUFFIX}`;
    const response = await artifactRegistryClient.auth.request({
      url,
      responseType: 'stream',
    });

    const dest = fs.createWriteStream(binPath);
    await new Promise((resolve, reject) => {
      response.data
        .pipe(dest)
        .on('finish', resolve)
        .on('error', reject);
    });

    fs.chmodSync(binPath, '755');
    return binPath;
  } catch (error) {
    await logAndProgress(
      `Failed to download Universal Maker: ${error.message}`,
      progressCallback,
      'debug'
    );
    return null;
  }
}

/**
 * Runs Universal Maker on the given application directory.
 * @param {string} appDir - Directory containing the application source.
 * @param {function} progressCallback - Progress callback.
 * @param {string} accessToken - Access token for authentication.
 * @returns {Promise<object|null>} The parsed build_output.json or null.
 */
export async function runUniversalMaker(
  appDir,
  accessToken,
  progressCallback
) {
  const binDir = path.join(
    os.homedir(),
    TEMP_PATHS.BASE,
    TEMP_PATHS.BIN_SUBDIR
  );
  const binPath = await ensureUniversalMaker(
    binDir,
    accessToken,
    progressCallback
  );

  if (!binPath) {
    return null;
  }

  const outputDir = path.join(os.tmpdir(), `um-output-${Date.now()}`);
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  try {
    // ./universal_maker -application_dir <source_code_path> -output_dir <output_results_path> -output_format json
    await logAndProgress(
      `Running Universal Maker: ${binPath} -application_dir ${appDir} -output_dir ${outputDir} -output_format json`,
      progressCallback,
      'debug'
    );
    const command = `"${binPath}" -application_dir "${appDir}" -output_dir "${outputDir}" -output_format json`;
    await execAsync(command);

    const outputPath = path.join(outputDir, 'build_output.json');
    if (fs.existsSync(outputPath)) {
      const output = JSON.parse(fs.readFileSync(outputPath, 'utf-8'));
      await logAndProgress(
        'Universal Maker completed successfully.',
        progressCallback
      );
      return output;
    } else {
      await logAndProgress(
        'Universal Maker did not produce build_output.json',
        progressCallback,
        'debug'
      );
      return null;
    }
  } catch (error) {
    await logAndProgress(
      `Universal Maker failed: ${error.message}`,
      progressCallback,
      'debug'
    );
    return null;
  } finally {
    // Cleanup output dir
    try {
      if (fs.existsSync(outputDir)) {
        fs.rmSync(outputDir, { recursive: true, force: true });
      }
    } catch (e) {
      // ignore cleanup errors
    }
  }
}
