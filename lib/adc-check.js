// lib/adc-check.js

/**
 * Checks for the presence of Google Cloud Application Default Credentials (ADC)
 * by attempting to print an access token. If ADC are not found, it logs an
 * error message and exits the process, instructing the user on how to set them up.
 * This check is only performed when the server is running in a local/stdio environment.
 * @async
 * @param {function} exec - The child_process.exec function to use for executing commands.
 * @returns {Promise<void>} A promise that resolves if ADC are found, or rejects and exits the process if not.
 */
export async function ensureAdcCredentials(exec) {
  return new Promise((resolve, reject) => {
    console.error('Checking for Google Cloud Application Default Credentials...');
    exec('gcloud auth application-default print-access-token', (error, stdout, stderr) => {
      if (error) {
        // Check if the error is specifically due to missing ADC
        if (stderr.includes('Your default credentials were not found') ||
            stderr.includes('To set up Application Default Credentials')) {
          console.error('ERROR: Google Cloud Application Default Credentials are not set up.');
          console.error('Please run the following command to set them up:');
          console.error('gcloud auth application-default login');
          process.exit(1);
        } else {
          // For any other type of error, reject the promise with the original error
          console.error('An unexpected error occurred while checking for ADC credentials:');
          console.error(stderr); // Log the actual stderr for debugging
          reject(error); // Reject with the original error object
        }
      } else {
        console.error('Application Default Credentials found.');
        resolve();
      }
    });
  });
}