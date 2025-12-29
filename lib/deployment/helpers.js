import path from 'path';
import fs from 'fs';

export function isFolder(files) {
  return (
    files.length === 1 &&
    typeof files[0] === 'string' &&
    fs.statSync(files[0]).isDirectory()
  );
}

/**
 * Checks if a Dockerfile exists in the provided files array.
 * @param {Array<string|Object>} files - An array of file paths or objects with filename properties.
 * @returns {boolean} - Returns true if a Dockerfile is found, false otherwise.
 */
export function checkIfDockerFileExists(files) {
  let hasDockerfile = false;
  if (isFolder(files)) {
    // Handle folder deployment: check for Dockerfile inside the folder
    const dockerfilePath = path.join(files[0], 'Dockerfile');
    const dockerfilePathLowerCase = path.join(files[0], 'dockerfile');
    if (
      fs.existsSync(dockerfilePath) ||
      fs.existsSync(dockerfilePathLowerCase)
    ) {
      hasDockerfile = true;
    }
  } else {
    // Handle file list deployment or file content deployment
    for (const file of files) {
      if (typeof file === 'string') {
        if (path.basename(file).toLowerCase() === 'dockerfile') {
          hasDockerfile = true;
          break;
        }
      } else if (typeof file === 'object' && file.filename) {
        if (path.basename(file.filename).toLowerCase() === 'dockerfile') {
          hasDockerfile = true;
          break;
        }
      }
    }
  }
  return hasDockerfile;
}

export function checkIfNodeJsRuntime(files) {
  if (!isFolder(files)) return false; // Can't determine the runtime for a file list deployment

  const packageJsonPath = path.join(files[0], 'package.json');
  if (!fs.existsSync(packageJsonPath)) {
    return null;
  }

  const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));
  if (!packageJson.scripts || !packageJson.scripts.start) {
    return null;
  }

  return packageJson;
}

export function createNodeJSNoBuildSourceContainer({
  bucketName,
  filename,
  startScript,
}) {
  return {
    image: 'scratch',
    baseImageUri: 'nodejs22',
    sourceCode: {
      cloudStorageSource: {
        bucket: bucketName,
        object: filename,
      },
    },
    command: [startScript.split(' ')[0]],
    args: startScript.split(' ').slice(1),
  };
}
