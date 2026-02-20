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

const execAsync = util.promisify(exec);

const UNIVERSAL_MAKER_BIN = 'universal_maker';
const DOWNLOAD_URLS = {
  linux_x64:
    'https://artifactregistry.googleapis.com/download/v1/projects/serverless-runtimes-qa/locations/us-central1/repositories/universal-maker/files/x86-64%3A1.0.0%3Auniversal_maker:download?alt=media',
  darwin_arm64:
    'https://artifactregistry.googleapis.com/download/v1/projects/serverless-runtimes-qa/locations/us-central1/repositories/universal-maker/files/darwin-arm64%3A1.0.0%3Auniversal_maker:download?alt=media',
};

const AR_DOWNLOAD_PATH_PREFIX = '/download/v1/';
const AR_METADATA_PATH_PREFIX = '/v1/';
const AR_DOWNLOAD_URL_SUFFIX = ':download?alt=media';

/**
 * Checks if the existing binary is up to date by comparing its SHA256 mash with the remote metadata.
 * If the binary is out of date, it removes it.
 * @param {string} binPath - Path to the local binary.
 * @param {string} metadataUrl - URL to fetch the remote metadata.
 * @param {function} progressCallback - Progress callback.
 * @returns {Promise<boolean>} True if the binary is up to date (or if updating fails), false otherwise.
 */
async function isBinaryUpToDate(binPath, metadataUrl, progressCallback) {
  if (!fs.existsSync(binPath)) {
    return false;
  }

  try {
    await logAndProgress(
      'Checking for Universal Maker updates...',
      progressCallback,
      'debug'
    );
    const { stdout } = await execAsync(`curl -sL "${metadataUrl}"`);
    const metadata = JSON.parse(stdout);
    const remoteSha256Base64 = metadata.hashes?.find(
      (h) => h.type === 'SHA256'
    )?.value;

    if (!remoteSha256Base64) {
      return true; // Cannot verify, assume up to date
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
      `Could not check for Universal Maker updates: ${error.message}. Using existing binary.`,
      progressCallback,
      'debug'
    );
    return true; // On error, fallback to existing binary
  }
}

/**
 * Downloads the universal maker binary if it doesn't exist.
 * @param {string} binDir - Directory to store the binary.
 * @param {function} progressCallback - Progress callback.
 * @returns {Promise<string|null>} Path to the binary or null if not supported.
 */
async function ensureUniversalMaker(binDir, progressCallback) {
  const platform = process.platform;
  const arch = process.arch;
  let key = '';

  if (platform === 'linux' && arch === 'x64') {
    key = 'linux_x64';
  } else if (platform === 'darwin' && arch === 'arm64') {
    key = 'darwin_arm64';
  } else {
    await logAndProgress(
      `Universal Maker is not supported on ${platform} ${arch}.`,
      progressCallback,
      'debug'
    );
    return null;
  }

  const binPath = path.join(binDir, UNIVERSAL_MAKER_BIN);
  const url = DOWNLOAD_URLS[key];
  const metadataUrl = url
    .replace(AR_DOWNLOAD_PATH_PREFIX, AR_METADATA_PATH_PREFIX)
    .replace(AR_DOWNLOAD_URL_SUFFIX, '');

  if (await isBinaryUpToDate(binPath, metadataUrl, progressCallback)) {
    return binPath;
  }

  await logAndProgress(
    `Downloading Universal Maker for ${key}...`,
    progressCallback
  );

  try {
    if (!fs.existsSync(binDir)) {
      fs.mkdirSync(binDir, { recursive: true });
    }
    // Using curl as it's likely available and supports the redirect/alt=media
    await execAsync(`curl -L -o "${binPath}" "${url}"`);
    fs.chmodSync(binPath, '755');
    return binPath;
  } catch (error) {
    await logAndProgress(
      `Failed to download Universal Maker: ${error.message}`,
      progressCallback,
      'warn'
    );
    return null;
  }
}

/**
 * Runs Universal Maker on the given application directory.
 * @param {string} appDir - Directory containing the application source.
 * @param {function} progressCallback - Progress callback.
 * @returns {Promise<object|null>} The parsed build_output.json or null.
 */
export async function runUniversalMaker(appDir, progressCallback) {
  const binDir = path.join(os.homedir(), '.cloud-run-mcp', 'bin');
  const binPath = await ensureUniversalMaker(binDir, progressCallback);

  if (!binPath) {
    return null;
  }

  const outputDir = path.join(os.tmpdir(), `um-output-${Date.now()}`);
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  try {
    await logAndProgress('Running Universal Maker...', progressCallback);
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
        'warn'
      );
      return null;
    }
  } catch (error) {
    await logAndProgress(
      `Universal Maker failed: ${error.message}`,
      progressCallback,
      'warn'
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
