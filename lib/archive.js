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

import { logAndProgress } from './logging.js';
import path from 'path';
import fs from 'fs';
import archiver from 'archiver';

export async function prepareFileMap(files, progressCallback) {
  const fileMap = {};
  let commonBaseDir = '';

  // Determine the type of input and find the common base directory
  if (files.every((file) => typeof file === 'string')) {
    // This handles `deploy_local_files` and `deploy_local_folder`.
    // For `deploy_local_folder`, the input is a single directory path.
    // For `deploy_local_files`, the input is an array of file and/or directory paths.

    const filePaths = files.map((file) => {
      let pathInput = file;
      // This is a "hack" to better support WSL on Windows.
      if (pathInput.startsWith('/c')) {
        pathInput = `/mnt${pathInput}`;
      }
      return path.resolve(pathInput);
    });

    if (filePaths.length > 0) {
      if (filePaths.length === 1 && fs.statSync(filePaths[0]).isDirectory()) {
        // Case: `deploy_local_folder` - The base directory is the folder path provided.
        commonBaseDir = filePaths[0];
      } else {
        // Case: `deploy_local_files` - The base directory is the lowest common parent directory.
        const firstPathParts = filePaths[0].split(path.sep);
        commonBaseDir = firstPathParts
          .slice(
            0,
            firstPathParts.length - (fs.statSync(filePaths[0]).isDirectory() ? 0 : 1)
          )
          .join(path.sep);

        for (let i = 1; i < filePaths.length; i++) {
          const currentPath = filePaths[i];
          while (!currentPath.startsWith(commonBaseDir)) {
            commonBaseDir = path.dirname(commonBaseDir);
          }
        }
      }
    }
  } else if (files.every((file) => typeof file === 'object' && 'filename' in file && 'content' in file)) {
    // Case: `deploy_file_contents` - The base directory is the root of the virtual file system.
    commonBaseDir = '';
  }

  async function addFileToMap(filePath) {
    let pathInput = filePath;
    if (pathInput.startsWith('/c')) {
      pathInput = `/mnt${pathInput}`;
    }
    const resolvedPath = path.resolve(pathInput);
    if (!fs.existsSync(resolvedPath)) {
      throw new Error(`File or directory not found: ${resolvedPath}`);
    }

    const stats = fs.statSync(resolvedPath);
    if (stats.isDirectory()) {
      const items = fs.readdirSync(resolvedPath);
      for (const item of items) {
        await addFileToMap(path.join(resolvedPath, item));
      }
    } else {
      const relativePath = path.relative(commonBaseDir, resolvedPath);
      fileMap[relativePath] = { sourcePath: resolvedPath };
    }
  }

  for (const file of files) {
    if (typeof file === 'string') {
      await addFileToMap(file);
    } else if (
      typeof file === 'object' &&
      'filename' in file &&
      'content' in file
    ) {
      fileMap[file.filename] = { content: file.content };
    } else {
      throw new Error(`Invalid file format: ${JSON.stringify(file)}`);
    }
  }

  return fileMap;
}

export async function createArchive(fileMap, progressCallback) {
  const archive = archiver('zip', {
    zlib: { level: 9 },
  });

  archive.on('warning', (err) => {
    const warningMessage = `Archiver warning: ${err}`;
    logAndProgress(warningMessage, progressCallback, 'warn');
  });

  archive.on('error', (err) => {
    const errorMessage = `Archiver error: ${err.message}`;
    console.error(errorMessage, err);
    logAndProgress(errorMessage, progressCallback, 'error');
    throw err;
  });

  for (const [destinationPath, fileInfo] of Object.entries(fileMap)) {
    if (fileInfo.sourcePath) {
      archive.file(fileInfo.sourcePath, { name: destinationPath });
    } else if (fileInfo.content) {
      archive.append(fileInfo.content, { name: destinationPath });
    }
  }

  return archive;
}

async function getArchiveBuffer(archive) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    archive.on('data', (chunk) => chunks.push(chunk));
    archive.on('end', () => resolve(Buffer.concat(chunks)));
    archive.on('error', reject);
    archive.finalize();
  });
}

export async function zipFiles(files, progressCallback) {
  logAndProgress('Preparing file map...', progressCallback);
  const fileMap = await prepareFileMap(files, progressCallback);

  logAndProgress('Creating zip archive...', progressCallback);
  const archive = await createArchive(fileMap, progressCallback);

  logAndProgress('Buffering zip archive...', progressCallback);
  const zipBuffer = await getArchiveBuffer(archive);

  logAndProgress(
    `Files zipped successfully. Total size: ${zipBuffer.length} bytes`,
    progressCallback
  );

  const hasDockerfile = Object.keys(fileMap).some(
    (name) => name.toLowerCase() === 'dockerfile'
  );

  return { zipBuffer, hasDockerfile };
}
