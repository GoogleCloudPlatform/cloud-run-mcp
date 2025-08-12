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

import { deploy, deployImage } from '../../lib/cloud-run-deploy.js';
import readline from 'readline/promises';
import { stdin as input, stdout as output } from 'process';
import fs from 'fs/promises';
import path from 'path';

/**
 * Gets the project ID from command line arguments or prompts the user.
 * If "new" is provided, it returns undefined to trigger new project creation.
 * @returns {Promise<string|undefined>} The Google Cloud project ID or undefined.
 */
async function getProjectId() {
  let projectIdInput = process.argv[2]; // Get the third element (index 2) which is the first argument

  if (!projectIdInput) {
    const rl = readline.createInterface({ input, output });
    projectIdInput = await rl.question(
      'Please enter your Google Cloud project ID: '
    );
    rl.close();
  }

  if (!projectIdInput || projectIdInput.trim() === '') {
    console.error('No project ID provided. Exiting.');
    process.exit(1);
  }
  if (projectIdInput.toLowerCase() === 'new') {
    console.error(
      'Project creation ("new") is now handled by test-create-project.js. Please provide an existing project ID. Exiting.'
    );
    process.exit(1);
  }
  console.log(`Using Project ID: ${projectIdInput}`);
  return projectIdInput;
}

const projectIdToUse = await getProjectId();

// Configuration for Go deployment with Dockerfile
const configGoWithDockerfile = {
  projectId: projectIdToUse, // Use the obtained project ID
  serviceName: 'example-go-app-docker', // Name of the Cloud Run service
  region: 'europe-west1', // Google Cloud region
  files: [
    'example-sources-to-deploy/main.go',
    'example-sources-to-deploy/go.mod',
    'example-sources-to-deploy/Dockerfile',
  ],
};

// Configuration for Go deployment without Dockerfile (using buildpacks)
const configGoWithoutDockerfile = {
  projectId: projectIdToUse,
  serviceName: 'example-go-app-buildpack',
  region: 'europe-west1',
  files: [
    'example-sources-to-deploy/main.go',
    'example-sources-to-deploy/go.mod',
    // Dockerfile is intentionally omitted here
  ],
};

// Configuration for Go deployment with file content (using buildpacks)
const configGoWithContent = {
  projectId: projectIdToUse,
  serviceName: 'example-go-app-content',
  region: 'europe-west1',
  files: [], // To be populated with file content
};

// Configuration for a deployment that is expected to fail
const configFailingBuild = {
  projectId: projectIdToUse,
  serviceName: 'example-failing-app',
  region: 'europe-west1',
  files: [
    {
      filename: 'main.txt',
      content:
        'This is not a valid application source file and should cause a build failure.',
    },
  ],
};

// Configuration for deploying a container image
const configImageDeploy = {
  projectId: projectIdToUse,
  serviceName: 'hello-from-image',
  region: 'europe-west1',
  imageUrl: 'gcr.io/cloudrun/hello',
};

try {
  console.log('\n--- Testing container image deployment ---');
  await deployImage(configImageDeploy);
  console.log('--- Container image deployment test completed ---');

  console.log('\n--- Testing intentionally failing build ---');
  try {
    await deploy(configFailingBuild);
    // If deploy doesn't throw an error, then the test has failed because it was expected to fail.
    console.error(
      'Deployment test failed: The build with invalid files succeeded when it was expected to fail.'
    );
    process.exit(1);
  } catch (error) {
    console.log('Intentionally failing build test completed as expected.');
  }

  console.log('--- Testing Go deployment with Dockerfile ---');
  await deploy(configGoWithDockerfile);
  console.log('--- Go deployment with Dockerfile test completed ---');

  console.log(
    '\n--- Testing Go deployment without Dockerfile (Buildpacks) ---'
  );
  await deploy(configGoWithoutDockerfile);
  console.log(
    '--- Go deployment without Dockerfile (Buildpacks) test completed ---'
  );

  console.log('\n--- Testing Go deployment with file content (Buildpacks) ---');
  const mainGoContent = await fs.readFile(
    path.resolve('example-sources-to-deploy/main.go'),
    'utf-8'
  );
  const goModContent = await fs.readFile(
    path.resolve('example-sources-to-deploy/go.mod'),
    'utf-8'
  );
  configGoWithContent.files = [
    { filename: 'main.go', content: mainGoContent },
    { filename: 'go.mod', content: goModContent },
  ];
  await deploy(configGoWithContent);
  console.log(
    '--- Go deployment with file content (Buildpacks) test completed ---'
  );
} catch (error) {
  console.error('An unexpected error occurred in the test script:', error);
  process.exit(1);
}
