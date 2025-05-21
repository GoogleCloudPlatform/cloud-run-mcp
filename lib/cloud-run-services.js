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

import protofiles from 'google-proto-files'

let runClient;
let loggingClient;

/**
 * Lists all Cloud Run services in a given project and location.
 * @param {string} projectId - The Google Cloud project ID.
 * @param {string} location - The Google Cloud location (e.g., 'europe-west1').
 * @returns {Promise<Array<object>>} - A promise that resolves to an array of service objects.
 */
export async function listServices(projectId, location) {
  // TODO make location optional, if not provided, list all services from all regions
  if (!runClient) {
    const { v2 } = await import('@google-cloud/run');
    const { ServicesClient } = v2;
    runClient = new ServicesClient({ projectId });
  }
  const parent = runClient.locationPath(projectId, location);

  try {
    console.log(`Listing Cloud Run services in project ${projectId}, location ${location}...`);
    const [services] = await runClient.listServices({ parent });
    return services;
  } catch (error) {
    console.error(`Error listing Cloud Run services:`, error);
    throw error;
  }
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
    console.log(`Getting details for Cloud Run service ${serviceId} in project ${projectId}, location ${location}...`);
    const [service] = await runClient.getService({ name: servicePath });
    return service;
  } catch (error) {
    console.error(`Error getting details for Cloud Run service ${serviceId}:`, error);
    // Check if the error is a "not found" error (gRPC code 5)
    if (error.code === 5) {
      console.log(`Cloud Run service ${serviceId} not found.`);
      return null; // Or throw a custom error, or handle as needed
    }
    throw error; // Re-throw other errors
  }
}

/**
 * Fetches logs for a specific Cloud Run service.
 * @param {string} projectId - The Google Cloud project ID.
 * @param {string} location - The Google Cloud location (e.g., 'europe-west1').
 * @param {string} serviceId - The ID of the Cloud Run service.
 * @returns {Promise<Array<object>>} - A promise that resolves to an array of log entry objects.
 */
export async function getServiceLogs(projectId, location, serviceId) {
  if (!loggingClient) {
    const { Logging } = await import('@google-cloud/logging');
    loggingClient = new Logging({ projectId });
  }

  try {
    const LOG_SEVERITY = 'DEFAULT'; // e.g., 'DEFAULT', 'INFO', 'WARNING', 'ERROR'
    const PAGE_SIZE = 50;       // Number of log entries to retrieve

    const filter = `resource.type="cloud_run_revision"
                    resource.labels.service_name="${serviceId}"
                    resource.labels.location="${location}"
                    severity>=${LOG_SEVERITY}`;

    console.log(`Getting details for Cloud Run service ${serviceId} in project ${projectId}, location ${location}...`);

    const [entries] = await loggingClient.getEntries({
      filter: filter,
      orderBy: 'timestamp desc', // Get the latest logs first
      pageSize: PAGE_SIZE,
    });

    // return entries; // Original return
    const formattedLogLines = entries.map(entry => formatLogEntry(entry)).join('\n');
    return formattedLogLines
  } catch (error) {
    console.error(`Error fetching logs for Cloud Run service ${serviceId}:`, error);
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
  let responseData = ''
  if (entry.metadata.httpRequest) {
    const responseMethod = entry.metadata.httpRequest.requestMethod;
    const responseCode = entry.metadata.httpRequest.status;
    const requestUrl = entry.metadata.httpRequest.requestUrl;
    const responseSize = entry.metadata.httpRequest.responseSize;
    responseData = `HTTP Request: ${responseMethod} StatusCode: ${responseCode} ResponseSize: ${responseSize} Byte - ${requestUrl}`
  }

  let data = ''
  if (entry.data && entry.data.value) {
    const protopath = protofiles.getProtoPath('../google/cloud/audit/audit_log.proto')
    const root = protofiles.loadSync(protopath)
    const type = root.lookupType('google.cloud.audit.AuditLog')
    const value = type.decode(entry.data.value)
    data = `${value.methodName}: ${value.status?.message || ''}${value.authenticationInfo?.principalEmail || ''}`
  } else if (entry.data) {
    data = entry.data
  }
  return `[${timestampStr}] [${severity}] ${responseData} ${data}`;
}
