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

import { test } from 'node:test';
import assert from 'node:assert';
import {
  getServiceLogs,
  listServices,
} from '../../lib/cloud-run-services.js';

/**
 * Gets service details from GOOGLE_CLOUD_PROJECT or command line arguments.
 * @returns {{projectId: string, region: string, serviceId: string}} The service details
 */
function getServiceDetails() {
  const projectId = process.env.GOOGLE_CLOUD_PROJECT || process.argv[2];
  const [, , arg1, arg2, arg3] = process.argv;

  let region = 'europe-west1';
  let serviceId;

  if (process.env.GOOGLE_CLOUD_PROJECT) {
    region = arg1 || 'europe-west1';
    serviceId = arg2;
  } else {
    region = arg2 || 'europe-west1';
    serviceId = arg3;
  }

  if (!projectId) {
    console.error(
      'Usage: node <script> <projectId> [region] [serviceId] or set GOOGLE_CLOUD_PROJECT'
    );
    process.exit(1);
  }

  console.log(`Using:
Project ID: ${projectId}
Region: ${region}`);
  if (serviceId) {
    console.log(`Service ID: ${serviceId}`);
  }

  return { projectId, region, serviceId };
}

const { projectId, region, serviceId } = getServiceDetails();

test('should list services', async () => {
  const services = await listServices(projectId, region);
  assert(Array.isArray(services), 'services should be an array');
  console.log('Services found:', services.length);
});

test('should fetch service logs', async () => {
  if (!serviceId) {
    console.log('Skipping service log test: no serviceId provided.');
    return;
  }

  console.log(
    `
Fetching logs for service "${serviceId}" in project "${projectId}" (region: ${region})...`
  );

  const result = await getServiceLogs(projectId, region, serviceId);

  if (result.logs) {
    console.log('\nLog entries:');
    console.log(result.logs);
  } else {
    console.log('No logs found for this service.');
  }
});


