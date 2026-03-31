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

import { getProjectsClient } from '../clients.js';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

/**
 * Helper function to log a message and call the progress callback.
 * @param {string} message - The message to log.
 * @param {function(object): void} [progressCallback] - Optional callback for progress updates.
 * @param {'debug' | 'info' | 'warn' | 'error'} [severity='info'] - The severity level of the message.
 */
export async function logAndProgress(
  message,
  progressCallback,
  severity = 'info'
) {
  switch (severity) {
    case 'error':
      console.error(message);
      break;
    case 'warn':
    case 'info':
    case 'debug':
    default:
      console.log(message);
      break;
  }
  if (progressCallback) {
    progressCallback({ level: severity, data: message });
  }
}

/**
 * Extracts the access token from the Authorization header.
 * @param {string} authorizationHeader - The Authorization header string.
 * @returns {string | undefined} - The extracted access token or undefined if not found.
 */
export function extractAccessToken(authorizationHeader) {
  if (!authorizationHeader) {
    return undefined;
  }
  return authorizationHeader.split(' ')[1];
}

/**
 * Gets the project number for a given project ID.
 * @param {string} projectId - The Google Cloud project ID.
 * @param {string} accessToken - Access token for authentication.
 * @returns {Promise<string>} The project number.
 */
export async function getProjectNumber(projectId, accessToken) {
  const projectsClient = await getProjectsClient(accessToken);
  const [project] = await projectsClient.getProject({
    name: `projects/${projectId}`,
  });
  // project.name is in the format "projects/123456"
  const parts = project.name.split('/');
  return parts.length > 1 ? parts[1] : project.projectNumber;
}

/**
 * Calculates a SHA256 fingerprint of a directory.
 * Matches the logic in gcloud run compose builder.py.
 * @param {string} dirPath - The directory to fingerprint.
 * @returns {Promise<string>} The SHA256 hex digest.
 */
export async function calculateSourceFingerprint(dirPath) {
  const hash = crypto.createHash('sha256');

  // Helper for recursive walk matching Python's deterministic order
  async function walk(currentDir) {
    const entries = await fs.promises.readdir(currentDir, {
      withFileTypes: true,
    });

    // Sort entries to match deterministic order (dirs and files sorted)
    entries.sort((a, b) => a.name.localeCompare(b.name));

    // Handle files first (matching filenames.sort() in builder.py's walk)
    for (const entry of entries) {
      if (entry.isFile()) {
        const filePath = path.join(currentDir, entry.name);
        const relPath = path.relative(dirPath, filePath);

        // Update hash with relative path
        hash.update(relPath);

        // Update hash with file content
        const content = await fs.promises.readFile(filePath);
        hash.update(content);
      }
    }

    // Then recurse into directories
    for (const entry of entries) {
      if (entry.isDirectory()) {
        await walk(path.join(currentDir, entry.name));
      }
    }
  }

  await walk(dirPath);
  return hash.digest('hex');
}

/**
 * Sanitizes a string for use as a Cloud Run service name.
 * Only lowercase, digits, and hyphens are allowed.
 * Must begin with a letter and cannot end with a hyphen.
 * @param {string} name - The name to sanitize.
 * @returns {string} The sanitized name.
 */
export function sanitizeCloudRunServiceName(name) {
  let sanitized = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-') // Replace non-alphanumeric with hyphen
    .replace(/^-+|-+$/g, ''); // Remove leading/trailing hyphens

  // Ensure it starts with a letter if possible
  if (sanitized.length > 0 && !/^[a-z]/.test(sanitized)) {
    sanitized = 's-' + sanitized;
  }

  // Cap at 49 characters (Cloud Run limit is usually 50-63 depending on API, 49 is safe)
  return sanitized.slice(0, 49).replace(/-$/, '');
}
