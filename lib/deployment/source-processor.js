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
 * Installs Node.js dependencies in the target directory if a package.json exists.
 * Skips if node_modules already exists (assumed pre-installed or copied).
 *
 * @param {string} targetDir - The directory containing the source code.
 */
async function installNodeDependencies(targetDir) {
  const nodeModulesPath = path.join(targetDir, 'node_modules');

  if (fs.existsSync(nodeModulesPath)) {
    console.log(
      `Existing node_modules detected. Skipping dependency installation.`
    );
    return;
  }

  // Check for lock file to decide between install and ci
  const hasLockFile = fs.existsSync(path.join(targetDir, 'package-lock.json'));
  const npmCommand = hasLockFile
    ? 'npm ci --omit=dev'
    : 'npm install --omit=dev';

  try {
    await execAsync(npmCommand, { cwd: targetDir });
    console.log(`${npmCommand} completed successfully`);
  } catch (e) {
    console.log(`Dependency installation failed: ${e.message}`);
  }
}

/**
 * Generic wrapper to install dependencies for the detected runtime.
 *
 * @param {string} targetDir - The directory containing the source code.
 * @param {Object} deploymentAttrs - Deployment attributes containing runtime info.
 */
export async function installDependencies(targetDir, deploymentAttrs) {
  switch (deploymentAttrs?.runtime) {
    case RUNTIMES.NODEJS:
      await installNodeDependencies(targetDir);
      break;
    default:
      console.log(
        `No specific dependency installation logic for runtime: ${deploymentAttrs?.runtime}`
      );
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
