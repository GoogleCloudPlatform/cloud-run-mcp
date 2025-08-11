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
import { createProjectAndAttachBilling } from '../lib/gcp-projects.js';

/**
 * Prompts the user for an optional project ID or allows them to proceed with auto-generation.
 * Checks for a project ID from command line arguments first.
 * @returns {Promise<string|undefined>} The Google Cloud project ID or undefined if auto-generation is chosen.
 */
async function getOptionalProjectId() {
  let projectIdInput = process.argv[2]; // Get the third element (index 2) which is the first argument

  if (projectIdInput && projectIdInput.trim() !== '') {
    console.log(`Using Project ID from command line argument: ${projectIdInput.trim()}`);
    return projectIdInput.trim();
  }

  const rl = readline.createInterface({ input, output });
  projectIdInput = await rl.question('Enter a specific Project ID to use (or press Enter to auto-generate): ');
  rl.close();

  if (projectIdInput && projectIdInput.trim() !== '') {
    console.log(`Attempting to create project with specified ID: ${projectIdInput.trim()}`);
    return projectIdInput.trim();
  }
  console.log('No Project ID specified. An ID will be auto-generated.');
  return undefined;
}

async function main() {
  try {
    const optionalProjectId = await getOptionalProjectId();
    console.log('Attempting to create a new project and attach billing...');
    const newProjectResult = await createProjectAndAttachBilling(optionalProjectId);

    if (newProjectResult && newProjectResult.projectId) {
      console.log(`Successfully created project: ${newProjectResult.projectId}`);
      console.log(newProjectResult.billingMessage);
      console.log("\nProject creation test completed successfully.");
    } else {
      console.error('Failed to create a new project or retrieve project details.');
      process.exit(1);
    }
  } catch (error) {
    console.error('Error during project creation test:', error.message);
    process.exit(1);
  }
}

main();
