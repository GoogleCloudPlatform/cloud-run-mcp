import path from 'path';
import fs from 'fs';

/**
 * Checks if a Dockerfile exists in the provided files array.
 * @param {Array<string|Object>} files - An array of file paths or objects with filename properties.
 * @returns {boolean} - Returns true if a Dockerfile is found, false otherwise.
 */
export function checkIfDockerFileExists(files) {
  let hasDockerfile = false;
  if (
    files.length === 1 &&
    typeof files[0] === 'string' &&
    fs.statSync(files[0]).isDirectory()
  ) {
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
