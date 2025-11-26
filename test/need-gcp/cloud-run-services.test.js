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
import { getService, getServiceLogs, listServices } from '../../lib/cloud-api/run.js';
import assert from 'node:assert';

/**
 * Get the GCP project ID from GOOGLE_CLOUD_PROJECT or command line argument.
 * @returns {string} The GCP project ID
 */
function getProjectId() {
  const projectId = process.env.GOOGLE_CLOUD_PROJECT || process.argv[2];
  if (!projectId) {
    console.error(
      'Usage: node <script> <projectId> or set GOOGLE_CLOUD_PROJECT'
    );
    process.exit(1);
  }
  console.log(`Using Project ID: ${projectId}`);
  return projectId;
}

/**
 * Gets service details from GOOGLE_CLOUD_PROJECT or command line arguments.
 * @returns {{projectId: string, region: string, serviceId: string}} The service details
 */
async function getServiceDetails() {
  const projectId = getProjectId();
  let region, serviceId;

  try {
    const allServices = await listServices(projectId);

    if (!allServices || Object.keys(allServices).length === 0) {
      assert.fail('No services found for the given project.');
    }

    const regions = Object.keys(allServices);
    region = regions[0];

    if (!allServices[region] || allServices[region].length === 0) {
      assert.fail(`No services found in region: ${region}`);
    }

    const serviceName = allServices[region][0].name;
    serviceId = serviceName.split('/').pop();
    console.log(`Using region - ${region} and service ID - ${serviceId}`);

    return { projectId, region, serviceId };
  } catch (error) {
    // Better error handling for the API call itself
    console.error('Error fetching services:', error.message);
    throw error; // Re-throw the error to fail the test
  }
}

test('should list services', async () => {
  const projectId = getProjectId();
  const services = await listServices(projectId);
  console.log('Services found:', services ? Object.keys(services) : 'None');
  console.log('All Services', services);
});

test('should fetch service logs', async () => {
  const { projectId, region, serviceId } = await getServiceDetails();

  const result = await getServiceLogs(projectId, region, serviceId);

  if (result.logs) {
    console.log('\nLog entries:');
    console.log(result.logs);
  } else {
    console.log('No logs found for this service.');
  }
});

test('should get service details', async () => {
  const { projectId, region, serviceId } = await getServiceDetails();
  const service = await getService(projectId, region, serviceId);
  assert(service, 'Service should not be null');
  assert.strictEqual(service.name.split('/').pop(), serviceId);
  console.log('Service details fetched successfully');
});
