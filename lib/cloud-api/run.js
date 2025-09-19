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

import protofiles from 'google-proto-files';
import { callWithRetry, ensureApisEnabled } from './helpers.js';
import { logAndProgress } from '../util/helpers.js';

let runClient;
let serviceUsageClient;
let loggingClient;

async function listCloudRunLocations(projectId) {
  if (!runClient) {
    const { v2 } = await import('@google-cloud/run').v2;
    const { ServicesClient } = v2;
    runClient = new ServicesClient({ projectId });
  }

  // The request object for listLocationsAsync
  const request = {
    name: `projects/${projectId}`,
  };

  const availableLocations = [];
  try {
    console.log('Listing Cloud Run supported locations:');
    const iterable = runClient.listLocationsAsync(request);
    for await (const location of iterable) {
      if(location.labels.initialized) {
        console.log(`${location.locationId}: ${location.name}`);
        availableLocations.push(location.locationId);
      };
    }
  } catch (err) {
    console.error('Error listing locations:', err);
  }
  return availableLocations;
}

/**
 * Lists all Cloud Run services in a given project and location.
 * @param {string} projectId - The Google Cloud project ID.
 * @param {string} location - The Google Cloud location (e.g., 'europe-west1').
 * @returns {Promise<Array<object>>} - A promise that resolves to an array of service objects.
 */
export async function listServices(projectId) {
  if (!runClient) {
    const { v2 } = await import('@google-cloud/run');
    const { ServicesClient } = v2;
    const { ServiceUsageClient } = await import('@google-cloud/service-usage');
    runClient = new ServicesClient({ projectId });
    serviceUsageClient = new ServiceUsageClient({ projectId });
  }
  const context = {
      runClient: runClient,
      serviceUsageClient: serviceUsageClient,
  };
  await ensureApisEnabled(context, projectId, ['run.googleapis.com']);
  const locations = await listCloudRunLocations(projectId);

  const allServices = {};
  for(const location of locations) {
    const parent = runClient.locationPath(projectId, location);

    try {
      console.log(
        `Listing Cloud Run services in project ${projectId}, location ${location}...`
      );
      const [services] = await callWithRetry(
        () => runClient.listServices({ parent }),
        'listServices'
      );
      allServices[location] = services;
    } catch (error) {
      console.error(`Error listing Cloud Run services:`, error);
      throw error;
    }
  }
  return allServices;
}

/**
 * Gets details for a specific Cloud Run service.
 * @param {string} projectId - The Google Cloud project ID.
 * @param {string} location - The Google Cloud location (e.g., 'europe-west1').
 * @param {string} serviceId - The ID of the Cloud Run service.
 * @returns {Promise<object>} - A promise that resolves to the service object.
 */
export async function getService(projectId, location, serviceId) {
  if (!runClient) {
    const { v2 } = await import('@google-cloud/run');
    const { ServicesClient } = v2;
    runClient = new ServicesClient({ projectId });
  }

  const servicePath = runClient.servicePath(projectId, location, serviceId);

  try {
    console.log(
      `Getting details for Cloud Run service ${serviceId} in project ${projectId}, location ${location}...`
    );
    const [service] = await callWithRetry(
      () => runClient.getService({ name: servicePath }),
      'getService'
    );
    return service;
  } catch (error) {
    console.error(
      `Error getting details for Cloud Run service ${serviceId}:`,
      error
    );
    // Check if the error is a "not found" error (gRPC code 5)
    if (error.code === 5) {
      console.log(`Cloud Run service ${serviceId} not found.`);
      return null; // Or throw a custom error, or handle as needed
    }
    throw error; // Re-throw other errors
  }
}

/**
 * Fetches a paginated list of logs for a specific Cloud Run service.
 * @param {string} projectId - The Google Cloud project ID.
 * @param {string} location - The Google Cloud location (e.g., 'europe-west1').
 * @param {string} serviceId - The ID of the Cloud Run service.
 * @param {string} [requestOptions] - The token for the next page of results.
 * @returns {Promise<{logs: string, requestOptions: object | undefined }>} - A promise that resolves to an object with log entries and a token for the next page.
 */
export async function getServiceLogs(
  projectId,
  location,
  serviceId,
  requestOptions
) {
  if (!loggingClient) {
    const { Logging } = await import('@google-cloud/logging');
    loggingClient = new Logging({ projectId });
  }

  try {
    const LOG_SEVERITY = 'DEFAULT'; // e.g., 'DEFAULT', 'INFO', 'WARNING', 'ERROR'
    const PAGE_SIZE = 100; // Number of log entries to retrieve per page

    const filter = `resource.type="cloud_run_revision"
                    resource.labels.service_name="${serviceId}"
                    resource.labels.location="${location}"
                    severity>=${LOG_SEVERITY}`;

    console.log(
      `Fetching logs for Cloud Run service ${serviceId} in project ${projectId}, location ${location}...`
    );

    // Options for the getEntries API call
    const options = requestOptions || {
      filter: filter,
      orderBy: 'timestamp desc', // Get the latest logs first
      pageSize: PAGE_SIZE,
    };
    console.log(`Request options: ${JSON.stringify(options)}`);

    // getEntries returns the entries and the full API response
    const [entries, nextRequestOptions, apiResponse] = await callWithRetry(
      () => loggingClient.getEntries(options),
      'getEntries'
    );

    const formattedLogLines = entries
      .map((entry) => formatLogEntry(entry))
      .join('\n');

    // The nextPageToken is available in the apiResponse object
    const nextOptions = apiResponse?.nextPageToken
      ? nextRequestOptions
      : undefined;

    return {
      logs: formattedLogLines,
      requestOptions: nextOptions,
    };
  } catch (error) {
    console.error(
      `Error fetching logs for Cloud Run service ${serviceId}:`,
      error
    );
    throw error;
  }
}

/**
 * Formats a single log entry for display.
 * @param {object} entry - A log entry object from the Cloud Logging API.
 * @returns {string} - A formatted string representation of the log entry.
 */
function formatLogEntry(entry) {
  const timestampStr = entry.metadata.timestamp.toISOString() || 'N/A';
  const severity = entry.metadata.severity || 'N/A';
  let responseData = '';
  if (entry.metadata.httpRequest) {
    const responseMethod = entry.metadata.httpRequest.requestMethod;
    const responseCode = entry.metadata.httpRequest.status;
    const requestUrl = entry.metadata.httpRequest.requestUrl;
    const responseSize = entry.metadata.httpRequest.responseSize;
    responseData = `HTTP Request: ${responseMethod} StatusCode: ${responseCode} ResponseSize: ${responseSize} Byte - ${requestUrl}`;
  }

  let data = '';
  if (entry.data && entry.data.value) {
    const protopath = protofiles.getProtoPath(
      '../google/cloud/audit/audit_log.proto'
    );
    const root = protofiles.loadSync(protopath);
    const type = root.lookupType('google.cloud.audit.AuditLog');
    const value = type.decode(entry.data.value);
    data = `${value.methodName}: ${value.status?.message || ''}${value.authenticationInfo?.principalEmail || ''}`;
  } else if (entry.data) {
    data = entry.data;
  }
  return `[${timestampStr}] [${severity}] ${responseData} ${data}`;
}

/**
 * Checks if a Cloud Run service already exists.
 *
 * @async
 * @param {object} context - The context object containing clients and other parameters.
 * @param {string} projectId - The Google Cloud project ID.
 * @param {string} location - The Google Cloud region where the service is located.
 * @param {string} serviceId - The ID of the Cloud Run service.
 * @param {function(object): void} [progressCallback] - Optional callback for progress updates.
 * @returns {Promise<boolean>} A promise that resolves to true if the service exists, false otherwise.
 * @throws {Error} If there's an error checking the service (other than not found).
 */
export async function checkCloudRunServiceExists(
  context,
  projectId,
  location,
  serviceId,
  progressCallback
) {
  const parent = context.runClient.locationPath(projectId, location);
  const servicePath = context.runClient.servicePath(
    projectId,
    location,
    serviceId
  );
  try {
    await callWithRetry(
      () => context.runClient.getService({ name: servicePath }),
      `getService ${serviceId}`
    );
    await logAndProgress(
      `Cloud Run service ${serviceId} already exists.`,
      progressCallback
    );
    return true;
  } catch (error) {
    if (error.code === 5) {
      await logAndProgress(
        `Cloud Run service ${serviceId} does not exist.`,
        progressCallback
      );
      return false;
    }
    const errorMessage = `Error checking Cloud Run service ${serviceId}: ${error.message}`;
    console.error(`Error checking Cloud Run service ${serviceId}:`, error);
    await logAndProgress(errorMessage, progressCallback, 'error');
    throw error;
  }
}
