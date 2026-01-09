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

import path from 'node:path';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import util from 'node:util';
import { exec } from 'node:child_process';
import { TEMP_PATHS, RUNTIMES } from './constants.js';
import { logAndProgress } from '../util/helpers.js';

const execAsync = util.promisify(exec);

/**
 * Prepares a temporary directory with the source code for deployment.
 * Handles both file paths and content objects.
 *
 * @param {Array<string|{filename: string, content: string|Buffer}>} files - Files to deploy.
 * @param {function(object): void} [progressCallback] - Optional callback for progress updates.
 * @returns {Promise<string>} The path to the prepared temporary directory.
 */
export async function prepareSourceDirectory(files, progressCallback) {
  const homeDir = os.homedir();
  const tempBaseDir = path.join(homeDir, TEMP_PATHS.BASE, TEMP_PATHS.SUBDIR);
  const sourceName = path.basename(files[0]);

  const tempDir = path.join(tempBaseDir, `${sourceName}-${Date.now()}`);

  await logAndProgress(
    `Preparing temporary directory: ${tempDir}`,
    progressCallback
  );

  // Creates a temporary directory to store the source code.
  await fsp.mkdir(tempDir, { recursive: true });

  // Copies the source code to the temporary directory.
  for (const file of files) {
    const stats = await fsp.stat(file);
    if (stats.isDirectory()) {
      // Copy directory contents
      await execAsync(`cp -R "${file}/." "${tempDir}/"`);
    } else {
      const destPath = path.join(tempDir, path.basename(file));
      await fsp.copyFile(file, destPath);
    }
  }

  return tempDir;
}

/**
 * Generic wrapper to install dependencies for the detected runtime.
 *
 * @param {string} targetDir - The directory containing the source code.
 * @param {Object} deploymentAttrs - Deployment attributes containing runtime info.
 * @param {function(object): void} [progressCallback] - Optional callback for progress updates.
 */
export async function installDependencies(
  targetDir,
  deploymentAttrs,
  progressCallback
) {
  switch (deploymentAttrs?.runtime) {
    case RUNTIMES.NODEJS:
      await installNodeDependencies(targetDir, progressCallback);
      break;
    default:
      await logAndProgress(
        `No specific dependency installation logic for runtime: ${deploymentAttrs?.runtime}`,
        progressCallback,
        'debug'
      );
  }
}

/**
 * Installs Node.js dependencies in the target directory if a package.json exists.
 * Skips if node_modules already exists (assumed pre-installed or copied).
 *
 * @param {string} targetDir - The directory containing the source code.
 * @param {function(object): void} [progressCallback] - Optional callback for progress updates.
 */
export async function installNodeDependencies(targetDir, progressCallback) {
  const nodeModulesPath = path.join(targetDir, 'node_modules');

  if (fs.existsSync(nodeModulesPath)) {
    await logAndProgress(
      `Existing node_modules detected. Skipping dependency installation.`,
      progressCallback
    );
    return;
  }

  await logAndProgress(
    `Running npm install in ${targetDir}...`,
    progressCallback
  );

  // Check for lock file to decide between install and ci
  const hasLockFile = fs.existsSync(path.join(targetDir, 'package-lock.json'));
  const npmCommand = hasLockFile
    ? 'npm ci --omit=dev'
    : 'npm install --omit=dev';

  try {
    await execAsync(npmCommand, { cwd: targetDir });
    await logAndProgress(
      `${npmCommand} completed successfully`,
      progressCallback
    );
  } catch (e) {
    await logAndProgress(
      `Dependency installation failed: ${e.message}`,
      progressCallback,
      'warn'
    );
    // We don't throw here to allow deployment to proceed even if install might have issues,
    // or maybe the user wants to handle it. But typically for source deploy failure is bad.
    // The original code caught it and logged warning, so we preserve that behavior.
  }
}

/**
 * Cleans up the temporary directory.
 *
 * @param {string} dirPath - Path to the directory to remove.
 */
export async function cleanupTempDirectory(dirPath) {
  if (!dirPath) return;

  try {
    if (fs.existsSync(dirPath)) {
      await fsp.rm(dirPath, { recursive: true, force: true });
    }
  } catch (cleanupError) {
    console.error(`Failed to cleanup temp directory ${dirPath}:`, cleanupError);
  }
}
