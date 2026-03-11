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
import { logAndProgress } from '../util/helpers.js';
import { TEMP_PATHS } from './constants.js';
import { ensureRepositoryDownloaded } from '../util/artifacts.js';

const execAsync = util.promisify(exec);

const UNIVERSAL_MAKER_BIN = 'universal_maker';
const UM_VERSION = '1.0.0';

const AR_PROJECT = 'serverless-runtimes';
const AR_LOCATION = 'us-central1';
const AR_REPOSITORY = 'universal-maker';

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
 * Runs Universal Maker on the given application directory.
 * @param {string} appDir - Directory containing the application source.
 * @param {function} progressCallback - Progress callback.
 * @param {string} accessToken - Access token for authentication.
 * @returns {Promise<object|null>} The parsed build_output.json or null.
 */
export async function runUniversalMaker(appDir, accessToken, progressCallback) {
  const binDir = path.join(
    os.homedir(),
    TEMP_PATHS.BASE,
    TEMP_PATHS.BIN_SUBDIR
  );
  const key = getUniversalMakerArchitectureKey();
  if (!key) {
    await logAndProgress(
      `Universal Maker is not supported on ${process.platform} ${process.arch}.`,
      progressCallback,
      'debug'
    );
    return null;
  }

  const arch = ARCH_MAPPING[key];
  const binPath = path.join(binDir, UNIVERSAL_MAKER_BIN);

  const binPathResult = await ensureRepositoryDownloaded(
    binPath,
    {
      project: AR_PROJECT,
      location: AR_LOCATION,
      repository: AR_REPOSITORY,
      artifactPath: `${arch}:${UM_VERSION}:${UNIVERSAL_MAKER_BIN}`,
      displayName: 'Universal Maker',
    },
    accessToken,
    progressCallback
  );

  if (!binPathResult) {
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
