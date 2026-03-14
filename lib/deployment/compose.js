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
import os from 'os';
import { logAndProgress } from '../util/helpers.js';
import { TEMP_PATHS } from './constants.js';
import { ensureRepositoryDownloaded } from '../util/artifacts.js';

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
