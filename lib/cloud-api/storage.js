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

import { getStorageClient } from '../clients.js';
import { callWithRetry } from './helpers.js';
import { logAndProgress } from '../util/helpers.js';

/**
 * Ensures that a Google Cloud Storage bucket exists.
 * If the bucket does not exist, it attempts to create it in the specified location.
 *
 * @async
 * @param {string} projectId - The Google Cloud project ID.
 * @param {string} bucketName - The name of the storage bucket.
 * @param {string} [location] - The location to create the bucket in if it doesn't exist.
 * @param {string} [accessToken] - Optional access token.
 * @param {function(object): void} [progressCallback] - Optional callback for progress updates.
 * @returns {Promise<import('@google-cloud/storage').Bucket>} A promise that resolves with the GCS Bucket object.
 * @throws {Error} If there's an error checking or creating the bucket.
 */
export async function ensureStorageBucketExists(
  projectId,
  bucketName,
  location,
  accessToken,
  progressCallback
) {
  const storage = await getStorageClient(projectId, accessToken);
  const bucket = storage.bucket(bucketName);
  try {
    const [exists] = await callWithRetry(
      () => bucket.exists(),
      `storage.bucket.exists ${bucketName}`
    );

    if (exists) {
      await logAndProgress(
        `Bucket ${bucketName} already exists.`,
        progressCallback
      );
      return bucket;
    } else {
      await logAndProgress(
        `Bucket ${bucketName} does not exist. Creating in location ${location}...`,
        progressCallback
      );
      try {
        const [createdBucket] = await callWithRetry(
          () => storage.createBucket(bucketName, { location: location }),
          `storage.createBucket ${bucketName}`
        );
        await logAndProgress(
          `Storage bucket ${createdBucket.name} created successfully in ${location}.`,
          progressCallback
        );
        return createdBucket;
      } catch (createError) {
        const errorMessage = `Failed to create storage bucket ${bucketName}. Error details: ${createError.message}`;
        console.error(
          `Failed to create storage bucket ${bucketName}. Error details:`,
          createError
        );
        await logAndProgress(errorMessage, progressCallback, 'error');
        throw createError;
      }
    }
  } catch (error) {
    const errorMessage = `Error checking/creating bucket ${bucketName}: ${error.message}`;
    console.error(`Error checking/creating bucket ${bucketName}:`, error);
    await logAndProgress(errorMessage, progressCallback, 'error');
    throw error;
  }
}

/**
 * Uploads a buffer to a Cloud Storage bucket.
 *
 * @async
 * @param {import('@google-cloud/storage').Bucket} bucket - The GCS Bucket object.
 * @param {Buffer} buffer - The buffer content to upload.
 * @param {string} destinationBlobName - The destination path in the bucket.
 * @param {function(object): void} [progressCallback] - Optional callback for progress updates.
 * @returns {Promise<import('@google-cloud/storage').File>} A promise that resolves with the File object.
 */
export async function uploadToStorageBucket(
  bucket,
  buffer,
  destinationBlobName,
  progressCallback
) {
  try {
    await logAndProgress(
      `Uploading buffer to gs://${bucket.name}/${destinationBlobName}...`,
      progressCallback
    );
    await callWithRetry(
      () => bucket.file(destinationBlobName).save(buffer),
      `storage.bucket.file.save ${destinationBlobName}`
    );
    await logAndProgress(
      `File ${destinationBlobName} uploaded successfully to gs://${bucket.name}/${destinationBlobName}.`,
      progressCallback
    );
    return bucket.file(destinationBlobName);
  } catch (error) {
    const errorMessage = `Error uploading buffer: ${error.message}`;
    console.error(`Error uploading buffer:`, error);
    await logAndProgress(errorMessage, progressCallback, 'error');
    throw error;
  }
}

/**
 * Grants a specific role to a member on a GCS bucket.
 *
 * @async
 * @param {import('@google-cloud/storage').Bucket} bucket - The GCS Bucket object.
 * @param {string} role - The role to grant (e.g., 'roles/storage.objectAdmin').
 * @param {string} member - The member to grant the role to (e.g., 'serviceAccount:xyz@example.com').
 * @param {function(object): void} [progressCallback] - Optional callback for progress updates.
 * @returns {Promise<void>}
 */
export async function grantBucketAccess(
  bucket,
  role,
  member,
  progressCallback
) {
  try {
    await logAndProgress(
      `Granting ${role} to ${member} on bucket ${bucket.name}...`,
      progressCallback
    );
    const [policy] = await callWithRetry(
      () => bucket.iam.getPolicy({ requestedPolicyVersion: 3 }),
      `storage.bucket.iam.getPolicy ${bucket.name}`
    );

    // Check if member already has the role
    const binding = policy.bindings.find((b) => b.role === role);
    if (binding && binding.members.includes(member)) {
      await logAndProgress(
        `${member} already has ${role} on bucket ${bucket.name}.`,
        progressCallback
      );
      return;
    }

    if (binding) {
      binding.members.push(member);
    } else {
      policy.bindings.push({ role: role, members: [member] });
    }

    await callWithRetry(
      () => bucket.iam.setPolicy(policy),
      `storage.bucket.iam.setPolicy ${bucket.name}`
    );
    await logAndProgress(
      `Successfully granted ${role} to ${member} on bucket ${bucket.name}.`,
      progressCallback
    );
  } catch (error) {
    const errorMessage = `Error granting access to bucket ${bucket.name}: ${error.message}`;
    await logAndProgress(errorMessage, progressCallback, 'warn');
  }
}
