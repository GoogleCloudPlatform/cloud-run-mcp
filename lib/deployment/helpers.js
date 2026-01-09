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
import fs from 'fs';
import { DEPLOYMENT_CONFIG, RUNTIMES } from './constants.js';

/**
 * Checks if the input is a single folder path.
 * @param {Array<string|Object>} files - Array of file paths or file objects.
 * @returns {boolean} - true if files contains exactly one string which is a directory.
 */
function isFolder(files) {
  if (files.length !== 1 || typeof files[0] !== 'string') return false;
  try {
    return fs.statSync(files[0]).isDirectory();
  } catch {
    return false;
  }
}

/**
 * Checks if a Dockerfile exists in the provided files array.
 * @param {Array<string|Object>} files - An array of file paths or objects with filename properties.
 * @returns {boolean} - Returns true if a Dockerfile is found, false otherwise.
 */
function checkIfDockerFileExists(files) {
  if (isFolder(files)) {
    // Handle folder deployment: check for Dockerfile inside the folder
    return (
      fs.existsSync(path.join(files[0], 'Dockerfile')) ||
      fs.existsSync(path.join(files[0], 'dockerfile'))
    );
  }

  // Handle file list deployment or file content deployment
  return files.some((file) => {
    const name = typeof file === 'string' ? file : file.filename;
    return path.basename(name).toLowerCase() === 'dockerfile';
  });
}

/**
 * Checks if the provided folder appears to be a Node.js project.
 * @param {string[]} files - Array of file paths.
 * @returns {boolean}
 */
function checkIfNodeJsRuntime(files) {
  const packageJsonPath = path.join(files[0], 'package.json');
  return fs.existsSync(packageJsonPath);
}

/**
 * Extracts deployment attributes from package.json.
 * @param {string[]} files - Array of file paths (expects a single folder).
 * @returns {Object}
 */
function getNodeJsDeploymentAttrs(files) {
  const packageJsonPath = path.join(files[0], 'package.json');
  let packageJson;

  try {
    packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));
  } catch (error) {
    // If package.json exists but is invalid, we can't extract attributes.
    return getEmptyDeploymentAttrs();
  }

  const startScript = packageJson?.scripts?.start;

  if (!startScript || typeof startScript !== 'string') {
    return getEmptyDeploymentAttrs();
  }

  if (packageJson?.engines?.node) {
    return getEmptyDeploymentAttrs();
  }

  // Handle multiple spaces properly
  const parts = startScript.trim().split(/\s+/);

  return {
    runtime: RUNTIMES.NODEJS,
    cmd: [parts[0]],
    args: parts.slice(1),
    baseImage: DEPLOYMENT_CONFIG.DEFAULT_NODE_BASE_IMAGE, // latest default base image
  };
}

function getEmptyDeploymentAttrs() {
  return {
    runtime: undefined,
    cmd: undefined,
    args: undefined,
    baseImage: undefined,
  };
}

/**
 * Determines deployment attributes based on the file list/folder content.
 * @param {string[]} files - Array of file paths.
 * @returns {Object} Deployment attributes.
 */
function getDeploymentAttrs(files) {
  if (!isFolder(files)) {
    // TODO: support file list deployment runtime detection
    return getEmptyDeploymentAttrs();
  }

  // Currently only support detection of NodeJs runtime
  if (checkIfNodeJsRuntime(files)) {
    return getNodeJsDeploymentAttrs(files);
  } else {
    return getEmptyDeploymentAttrs();
  }
}

/**
 * Creates metadata for the file deployment.
 * @param {string[]} files
 * @returns {Object}
 */
export function makeFileDeploymentMetadata(files) {
  return {
    hasDockerfile: checkIfDockerFileExists(files),
    deploymentAttrs: getDeploymentAttrs(files),
  };
}

/**
 * Checks if a zip-based source deployment (no-build) is feasible.
 */
export function checkIfZipDeploymentFeasible({
  hasDockerfile,
  deploymentAttrs,
}) {
  return (
    !hasDockerfile &&
    deploymentAttrs &&
    deploymentAttrs.runtime &&
    deploymentAttrs.cmd &&
    deploymentAttrs.args
  );
}

/**
 * Creates the container spec for a direct source deployment.
 */
export function createDirectSourceDeploymentContainer({
  bucketName,
  fileName,
  deploymentAttrs,
}) {
  return {
    image: 'scratch',
    baseImageUri: deploymentAttrs.baseImage,
    sourceCode: {
      cloudStorageSource: {
        bucket: bucketName,
        object: fileName,
      },
    },
    command: deploymentAttrs.cmd,
    args: deploymentAttrs.args,
  };
}
