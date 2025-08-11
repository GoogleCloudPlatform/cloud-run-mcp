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

import readline from 'readline/promises';
import { stdin as input, stdout as output } from 'process';
import { getServiceLogs } from '../lib/cloud-run-services.js';

/**
 * Prompts the user for required service information
 * @returns {Promise<{projectId: string, region: string, serviceId: string}>} The service details
 */
async function getServiceDetails() {
  const rl = readline.createInterface({ input, output });

  // Check command line arguments first
  const [, , projectId, region = 'europe-west1', serviceId] = process.argv;

  if (projectId && serviceId) {
    console.log(`Using command line arguments:
Project ID: ${projectId}
Region: ${region}
Service ID: ${serviceId}`);
    rl.close();
    return { projectId, region, serviceId };
  }

  // If not provided via command line, prompt for the values
  const projectIdInput = await rl.question('Enter the Project ID: ');
  const regionInput = await rl.question('Enter the region (press Enter for europe-west1): ');
  const serviceIdInput = await rl.question('Enter the Service ID: ');
  
  rl.close();

  return {
    projectId: projectIdInput.trim(),
    region: regionInput.trim() || 'europe-west1',
    serviceId: serviceIdInput.trim()
  };
}

async function main() {
  try {
    const { projectId, region, serviceId } = await getServiceDetails();

    if (!projectId || !serviceId) {
      console.error('Both Project ID and Service ID are required.');
      process.exit(1);
    }

    console.log(`\nFetching logs for service "${serviceId}" in project "${projectId}" (region: ${region})...`);
    
    let requestOptions;
    let pageCount = 0;
    const MAX_PAGES = 3; // Limit the number of pages to avoid too much output

    do {
      const result = await getServiceLogs(projectId, region, serviceId, requestOptions);
      
      if (result.logs) {
        console.log('\nLog entries:');
        console.log(result.logs);
      } else {
        console.log('No logs found for this service.');
      }

      requestOptions = result.requestOptions;
      pageCount++;

      if (requestOptions && pageCount < MAX_PAGES) {
        const rl = readline.createInterface({ input, output });
        const answer = await rl.question('\nFetch more logs? (y/N): ');
        rl.close();
        
        if (answer.toLowerCase() !== 'y') {
          break;
        }
      }
    } while (requestOptions && pageCount < MAX_PAGES);

    console.log("\nService logs test completed successfully.");
  } catch (error) {
    console.error('Error during service logs test:', error.message);
    process.exit(1);
  }
}

main();
