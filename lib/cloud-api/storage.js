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

import { callWithRetry } from './helpers.js';

/**
 * Ensures that a Google Cloud Storage bucket exists.
 * If the bucket does not exist, it attempts to create it in the specified location.
 *
 * @async
 * @param {object} context - The context object containing clients and other parameters.
 * @param {string} bucketName - The name of the storage bucket.
 * @param {string} [location='us'] - The location to create the bucket in if it doesn't exist. Defaults to 'us'.
 * @param {function(object): void} [progressCallback] - Optional callback for progress updates.
 * @returns {Promise<import('@google-cloud/storage').Bucket>} A promise that resolves with the GCS Bucket object.
 * @throws {Error} If there's an error checking or creating the bucket.
 */
export async function ensureStorageBucketExists(
  context,
  bucketName,
  location = 'us',
  progressCallback
) {
  const bucket = context.storage.bucket(bucketName);
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
          () =>
            context.storage.createBucket(bucketName, { location: location }),
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
 * Uploads a buffer to a specified Google Cloud Storage bucket and blob name.
 *
 * @async
 * @param {object} context - The context object containing clients and other parameters.
 * @param {import('@google-cloud/storage').Bucket} bucket - The Google Cloud Storage bucket object.
 * @param {Buffer} buffer - The buffer containing the data to upload.
 * @param {string} destinationBlobName - The name for the blob in the bucket.
 * @param {function(object): void} [progressCallback] - Optional callback for progress updates.
 * @returns {Promise<import('@google-cloud/storage').File>} A promise that resolves with the GCS File object representing the uploaded blob.
 * @throws {Error} If the upload fails.
 */
export async function uploadToStorageBucket(
  context,
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
