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

import { logAndProgress } from './helpers.js';

/**
 * Creates a zip archive in memory from a list of file paths and/or file objects.
 * File objects should have `filename` (string) and `content` (Buffer or string) properties.
 *
 * @param {Array<string|{filename: string, content: Buffer|string}>} files - An array of items to zip.
 * Each item can be a string representing a file/directory path, or an object
 * with `filename` and `content` properties for in-memory files.
 * @param {function(object): void} [progressCallback] - Optional callback for progress updates.
 * @returns {Promise<Buffer>} A promise that resolves with a Buffer containing the zip data.
 * @throws {Error} If an input file path is not found, an input item has an invalid format, or an archiver error occurs.
 */
export async function zipFiles(files, progressCallback) {
  const path = await import('path');
  const fs = await import('fs');
  const archiver = (await import('archiver')).default;

  return new Promise((resolve, reject) => {
    logAndProgress('Creating in-memory zip archive...', progressCallback);
    const chunks = [];
    const archive = archiver('zip', {
      zlib: { level: 9 },
    });

    archive.on('data', (chunk) => chunks.push(chunk));
    archive.on('end', () => {
      logAndProgress(
        `Files zipped successfully. Total size: ${archive.pointer()} bytes`,
        progressCallback
      );
      resolve(Buffer.concat(chunks));
    });

    archive.on('warning', (err) => {
      const warningMessage = `Archiver warning: ${err}`;
      logAndProgress(warningMessage, progressCallback, 'warn');
      if (err.code !== 'ENOENT') {
        // ENOENT is often just a warning, others might be more critical for zip
        reject(err);
      }
    });

    archive.on('error', (err) => {
      const errorMessage = `Archiver error: ${err.message}`;
      console.error(errorMessage, err);
      logAndProgress(errorMessage, progressCallback, 'error');
      reject(err);
    });

    files.forEach((file) => {
      if (typeof file === 'object' && 'filename' in file && 'content' in file) {
        archive.append(file.content, { name: file.filename });
      } else if (typeof file === 'string') {
        let pathInput = file;

        // This is a "hack" to better support WSL on Windows. AI agents tend to send path that start with '/c' in that case. Re-write it to '/mnt/c'
        if (pathInput.startsWith('/c')) {
          pathInput = `/mnt${pathInput}`;
        }
        const filePath = path.resolve(pathInput);
        if (!fs.existsSync(filePath)) {
          throw new Error(`File or directory not found: ${filePath}`);
        }

        const stats = fs.statSync(filePath);
        if (stats.isDirectory()) {
          archive.directory(filePath, false);
        } else {
          archive.file(filePath, { name: path.basename(filePath) });
        }
      } else {
        throw new Error(`Invalid file format: ${JSON.stringify(file)}`);
      }
    });

    archive.finalize();
  });
}

/**
 * Reads a local archive file (zip or tar.gz) and returns it as a buffer.
 * @param {string} filePath - Path to the archive file.
 * @returns {Promise<Buffer>} The file content as a buffer.
 */
export async function readArchive(filePath) {
  const fs = await import('fs');

  if (!fs.existsSync(filePath)) {
    throw new Error(`Archive file not found: ${filePath}`);
  }

  return fs.readFileSync(filePath);
}
