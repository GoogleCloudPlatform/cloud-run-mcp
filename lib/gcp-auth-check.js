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

import { GoogleAuth } from 'google-auth-library';

/**
 * Checks for the presence of properly setup Google Cloud Platform (GCP) authentication
 * using the official Google Auth Library for Node.js. If GCP auth is not found, it logs an
 * error message and exits the process, instructing the user on how to set them up.
 * This check is primarily for local/stdio environments where explicit setup is often needed.
 * @async
 * @returns {Promise<void>} A promise that resolves if GCP auth are found, or rejects and exits the process if not.
 */
export async function ensureGCPCredentials() {
    console.error('Checking for Google Cloud Application Default Credentials...');
    try {
        const auth = new GoogleAuth();
        // Attempt to get credentials. This will throw an error if ADC are not found.
        const client = await auth.getClient();
        // Attempt to get an access token to verify credentials are usable.
        // This is done because getClient() might succeed but credentials might be invalid/expired.
        await client.getAccessToken();

        console.log('Application Default Credentials found.');
    } catch (error) {
        console.error('ERROR: Google Cloud Application Default Credentials are not set up.');

        if (error.response && error.response.status) {
            console.error(`An HTTP error occurred (Status: ${error.response.status}). This often means misconfigured, expired credentials, or a network issue.`);
        } else if (error instanceof TypeError) {
            // Catches TypeErrors specifically, which might indicate a malformed response or unexpected data type
            console.error('An unexpected error occurred during credential verification (e.g., malformed response or invalid type).');
        } else {
            // General fallback for any other unexpected errors
            console.error('An unexpected error occurred during credential verification.');
        }

        console.error('\nFor more details or alternative setup methods, consider:');
        console.error('1. If running locally, run: gcloud auth application-default login.');
        console.error('2. Ensuring the `GOOGLE_APPLICATION_CREDENTIALS` environment variable points to a valid service account key file.');
        console.error('3. If on a Google Cloud environment (e.g., GCE, Cloud Run), verify the associated service account has necessary permissions.');
        console.error(`\nOriginal error message from Google Auth Library: ${error.message}`);

        // Print the stack for debugging
        if (error.stack) {
            console.error('Error stack:', error.stack);
        }
        process.exit(1);
    }
}