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
import { getOAuthClient } from '../clients.js';
import { extractAccessToken } from '../util/helpers.js';

/**
 * Verifies the validity of an access token and checks the audience.
 * @param {string} accessToken - The access token to verify.
 * @param {string} [audience] - Audience to check against the token's audience.
 * @returns {Promise<object>} - The token info if valid.
 * @throws {Error} - If the token is invalid or the audience does not match.
 */
async function verifyAccessToken(accessToken, audience) {
  console.log('Verifying access token...');
  const client = await getOAuthClient(accessToken);
  const tokenInfo = await client.getTokenInfo(accessToken);

  //An expired token will not have audience
  if (audience && tokenInfo.aud !== audience) {
    throw new Error(`Invalid audience: expected ${audience}`);
  }

  console.log('Access token verified successfully.');
  return tokenInfo;
}

export async function ensureOAuthTokenInEnv(req, res) {
  const audience = process.env.GOOGLE_OAUTH_AUDIENCE;
  console.log('Verifiy token');
  if (req.headers.authorization === undefined) {
    console.log('No authorization header found in request');
    throw new Error('No authorization header');
  }
  console.log('Verifying token: Authorization header found');
  const accessToken = extractAccessToken(req.headers.authorization);
  await verifyAccessToken(accessToken, audience);
  console.log('Token verified');
}

/**
 * Checks for the presence of properly setup Google Cloud Platform (GCP) authentication
 * using the official Google Auth Library for Node.js. If GCP auth is not found, it logs an
 * error message and returns false.
 * @async
 * @returns {Promise<boolean>} A promise that resolves to true if GCP auth are found, and false otherwise.
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
    return true;
  } catch (error) {
    console.error(
      'ERROR: Google Cloud Application Default Credentials are not set up.'
    );

    if (error.response && error.response.status) {
      console.error(
        `An HTTP error occurred (Status: ${error.response.status}). This often means misconfigured, expired credentials, or a network issue.`
      );
    } else if (error instanceof TypeError) {
      // Catches TypeErrors specifically, which might indicate a malformed response or unexpected data type
      console.error(
        'An unexpected error occurred during credential verification (e.g., malformed response or invalid type).'
      );
    } else {
      // General fallback for any other unexpected errors
      console.error(
        'An unexpected error occurred during credential verification.'
      );
    }

    console.error('\nFor more details or alternative setup methods, consider:');
    console.error(
      '1. If running locally, run: gcloud auth application-default login.'
    );
    console.error(
      '2. Ensuring the `GOOGLE_APPLICATION_CREDENTIALS` environment variable points to a valid service account key file.'
    );
    console.error(
      '3. If on a Google Cloud environment (e.g., GCE, Cloud Run), verify the associated service account has necessary permissions.'
    );
    console.error(
      `\nOriginal error message from Google Auth Library: ${error.message}`
    );

    // Print the stack for debugging
    if (error.stack) {
      console.error('Error stack:', error.stack);
    }
    return false;
  }
}
