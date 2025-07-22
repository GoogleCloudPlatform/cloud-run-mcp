// lib/adc-check.js
import { GoogleAuth } from 'google-auth-library';

/**
 * Checks for the presence of Google Cloud Application Default Credentials (ADC)
 * using the official Google Auth Library for Node.js. If ADC are not found, it logs an
 * error message and exits the process, instructing the user on how to set them up.
 * This check is primarily for local/stdio environments where explicit setup is often needed.
 * @async
 * @returns {Promise<void>} A promise that resolves if ADC are found, or rejects and exits the process if not.
 */
export async function ensureAdcCredentials() {
    console.error('Checking for Google Cloud Application Default Credentials...');
    try {
        const auth = new GoogleAuth();
        // Attempt to get credentials. This will throw an error if ADC are not found.
        const client = await auth.getClient();
        // Attempt to get an access token to verify credentials are usable.
        // This is done because getClient() might succeed but credentials might be invalid/expired.
        await client.getAccessToken();

        console.error('Application Default Credentials found.');
    } catch (error) {
        console.error('ERROR: Google Cloud Application Default Credentials are not set up.');
        console.error('Please run the following command to set them up for local development:');
        console.error('gcloud auth application-default login');

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
        console.error('1. Ensuring the `GOOGLE_APPLICATION_CREDENTIALS` environment variable points to a valid service account key file.');
        console.error('2. If on a Google Cloud environment (e.g., GCE, Cloud Run), verify the associated service account has necessary permissions.');
        console.error(`\nOriginal error message from Google Auth Library: ${error.message}`);

        // Print the stack for debugging
        if (error.stack) {
            console.error('Error stack:', error.stack);
        }
        process.exit(1);
    }
}
