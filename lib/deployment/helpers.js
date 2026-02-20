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
  for (const file of files) {
    if (typeof file === 'string') {
      if (path.basename(file).toLowerCase() === 'dockerfile') {
        return true;
      }
    } else if (typeof file === 'object' && file.filename) {
      if (path.basename(file.filename).toLowerCase() === 'dockerfile') {
        return true;
      }
    }
  }
  return false;
}

/**
 * Checks if the provided folder appears to be a Node.js project.
 * It looks for a `package.json` file in the root of the first path in the `files` array.
 * @param {string[]} files - Array of file paths
 * @returns {boolean}
 */
function checkIfNodeJsRuntime(files) {
  const packageJsonPath = path.join(files[0], 'package.json');
  return fs.existsSync(packageJsonPath);
}

/**
 * Checks if the provided folder appears to be a Python project.
 * It looks for a `requirements.txt` or `pyproject.toml` file in the root of the first path in the `files` array.
 * @param {string[]} files - Array of file paths
 * @returns {boolean}
 */
function checkIfPythonRuntime(files) {
  const requirementsTxtPath = path.join(files[0], 'requirements.txt');
  const pyprojectTomlPath = path.join(files[0], 'pyproject.toml');
  return fs.existsSync(requirementsTxtPath) || fs.existsSync(pyprojectTomlPath);
}

/**
 * Returns an empty deployment attributes object.
 * This is used as a default or when attributes cannot be determined.
 * @returns {{runtime: undefined, cmd: undefined, args: undefined, baseImage: undefined}}
 */
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
 * @param {Array<string|Object>} files - Array of file paths or file objects.
 * @returns {{runtime: string|undefined, baseImage: string|undefined}} Deployment attributes object.
 */
function getDeploymentAttrs(files) {
  console.log('Getting deployment attributes');
  // Currently only support detection of NodeJs runtime
  if (
    !isFolder(files) ||
    !(checkIfNodeJsRuntime(files) || checkIfPythonRuntime(files))
  ) {
    // TODO: support file list deployment runtime detection
    return getEmptyDeploymentAttrs();
  }
  if (checkIfPythonRuntime(files)) {
    return {
      runtime: RUNTIMES.PYTHON,
      baseImage: DEPLOYMENT_CONFIG.DEFAULT_PYTHON_BASE_IMAGE,
    };
  }
  return {
    runtime: RUNTIMES.NODEJS,
    baseImage: DEPLOYMENT_CONFIG.DEFAULT_NODE_BASE_IMAGE,
  };
}

/**
 * Creates metadata for the file deployment, including Dockerfile presence and runtime attributes.
 * @param {Array<string|Object>} files - Array of file paths or file objects to be deployed.
 * @returns {{hasDockerfile: boolean, deploymentAttrs: {runtime: string|undefined, cmd: string[]|undefined, args: string[]|undefined, baseImage: string|undefined}}} Metadata object.
 */
export function makeFileDeploymentMetadata(files) {
  return {
    hasDockerfile: checkIfDockerFileExists(files),
    deploymentAttrs: getDeploymentAttrs(files),
  };
}

/**
 * Checks if a zip-based source deployment (no-build) is feasible.
 * @param {object} metadata - The deployment metadata.
 * @param {boolean} metadata.hasDockerfile - Whether a Dockerfile is present.
 * @param {{runtime: string|undefined, cmd: string[]|undefined, args: string[]|undefined}} metadata.deploymentAttrs - Deployment attributes.
 * @returns {boolean} True if zip deployment is feasible.
 */
export function canDeployWithoutBuild({ hasDockerfile, deploymentAttrs }) {
  return !!(!hasDockerfile && deploymentAttrs && deploymentAttrs.runtime);
}

/**
 * Creates the container spec for a direct source deployment (no Cloud Build).
 * @param {object} params - The parameters for creating the container spec.
 * @param {string} params.bucketName - The GCS bucket name where the source is uploaded.
 * @param {string} params.fileName - The GCS object name (eg., source.tar.gz).
 * @param {{cmd: string[], args: string[], baseImage: string}} params.deploymentAttrs - Deployment attributes including command, args, and the base image to use.
 * @returns {object} The container specification object for the Cloud Run service.
 */
export function createDirectSourceDeploymentContainer({
  bucketName,
  fileName,
  deploymentAttrs,
}) {
  const container = {
    image: DEPLOYMENT_CONFIG.NO_BUILD_IMAGE_TYPE,
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

  // Add environment variables if provided
  if (deploymentAttrs.envVars && typeof deploymentAttrs.envVars === 'object') {
    container.env = Object.entries(deploymentAttrs.envVars).map(
      ([name, value]) => ({
        name,
        value: String(value),
      })
    );
  }

  return container;
}
