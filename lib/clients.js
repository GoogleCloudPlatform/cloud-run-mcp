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

import { OAuth2Client } from 'google-auth-library';
import { GCLOUD_AUTH } from '../constants.js';

const CLIENT_ID = process.env.GOOGLE_OAUTH_CLIENT_ID;
const CLIENT_SECRET = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
const REDIRECT_URI = process.env.GOOGLE_OAUTH_REDIRECT_URI;
const AUTHORIZATION_HEADER = 'Authorization';
const BEARER_PREFIX = 'Bearer';
const CLOUD_PLATFORM_SCOPE = 'https://www.googleapis.com/auth/cloud-platform';

function keyGenerator(projectId, accessToken) {
  return accessToken !== GCLOUD_AUTH ? projectId + accessToken : projectId;
}

export const clients = {
  run: new Map(),
  builds: new Map(),
  serviceUsage: new Map(),
  storage: new Map(),
  cloudBuild: new Map(),
  artifactRegistry: new Map(),
  logging: new Map(),
  billing: new Map(),
  projects: new Map(),
  runV1: new Map(),
  oauth: new Map(),
};

function getAuthClient(accessToken) {
  return {
    getRequestHeaders: () => {
      const headers = new Map();
      headers.set(AUTHORIZATION_HEADER, `${BEARER_PREFIX} ${accessToken}`);
      return headers;
    },
  };
}

/**
 * Wraps an OAuth2Client to be compatible with gRPC-based Google Cloud clients.
 *
 * Some Google Cloud SDK clients (like Cloud Run, Service Usage, etc.) use gRPC
 * and expect the `getRequestHeaders()` method of the auth client to return a
 * `Map` of headers. However, the standard `OAuth2Client` from `google-auth-library`
 * returns a plain Javascript object (e.g., `{ Authorization: 'Bearer ...' }`).
 *
 * This wrapper uses a Proxy to intercept calls to `getRequestHeaders`. It calls
 * the original method and converts the result from a plain object to a `Map`
 * if necessary, ensuring compatibility with gRPC-based clients while maintaining
 * the original behavior for other properties.
 *
 * @param {OAuth2Client} authClient - The original OAuth2Client instance.
 * @returns {Proxy<OAuth2Client>} A proxy compatible with gRPC clients.
 */
function wrapForGrpc(authClient) {
  return new Proxy(authClient, {
    get(target, prop, receiver) {
      if (prop === 'getRequestHeaders') {
        return async (...args) => {
          const headers = await target.getRequestHeaders(...args);
          if (headers instanceof Map) {
            return headers;
          }
          // Convert plain object (from OAuth2Client) to Map (expected by grpc-js)
          const headerMap = new Map();
          for (const [k, v] of Object.entries(headers)) {
            headerMap.set(k, v);
          }
          return headerMap;
        };
      }
      return Reflect.get(target, prop, receiver);
    },
  });
}

// Services that use HTTP/REST (or prefer Object headers) instead of gRPC (Map headers)
const HTTP_SERVICES = ['storage', 'logging'];

export async function getClient(
  service,
  key,
  loadClient,
  options = {},
  accessToken = null
) {
  if (!clients[service].has(key)) {
    const ClientClass = await loadClient();
    const finalOptions = { ...options };
    if (accessToken && accessToken !== GCLOUD_AUTH) {
      const oauthClient = await getOAuthClient(accessToken);
      // Storage and Logging use HTTP and expect the native OAuth2Client (headers as Object).
      // Other services (Run, ServiceUsage, etc.) use gRPC and expect headers as Map.
      if (HTTP_SERVICES.includes(service)) {
        finalOptions.authClient = oauthClient;
      } else {
        finalOptions.authClient = wrapForGrpc(oauthClient);
      }
    }
    clients[service].set(key, new ClientClass(finalOptions));
  }
  return clients[service].get(key);
}

/**
 * Gets a Cloud Run Services Client for the specified project.
 * @param {string} projectId - The Google Cloud project ID.
 * @returns {Promise<import('@google-cloud/run').v2.ServicesClient>}
 */
export async function getRunClient(projectId, accessToken = GCLOUD_AUTH) {
  const key = keyGenerator(projectId, accessToken);
  return getClient(
    'run',
    key,
    async () => (await import('@google-cloud/run')).v2.ServicesClient,
    { projectId },
    accessToken
  );
}

/**
 * Gets a Cloud Run Build Client for the specified project.
 * @param {string} projectId - The Google Cloud project ID.
 * @returns {Promise<import('@google-cloud/run').v2.BuildsClient>}
 */
export async function getBuildsClient(projectId, accessToken = GCLOUD_AUTH) {
  const key = keyGenerator(projectId, accessToken);
  return getClient(
    'builds',
    key,
    async () => (await import('@google-cloud/run')).v2.BuildsClient,
    { projectId },
    accessToken
  );
}

/**
 * Gets a Service Usage Client for the specified project.
 * @param {string} projectId - The Google Cloud project ID.
 * @returns {Promise<import('@google-cloud/service-usage').ServiceUsageClient>}
 */
export async function getServiceUsageClient(
  projectId,
  accessToken = GCLOUD_AUTH
) {
  const key = keyGenerator(projectId, accessToken);
  return getClient(
    'serviceUsage',
    key,
    async () =>
      (await import('@google-cloud/service-usage')).ServiceUsageClient,
    { projectId },
    accessToken
  );
}

/**
 * Gets a Storage Client for the specified project.
 * @param {string} projectId - The Google Cloud project ID.
 * @returns {Promise<import('@google-cloud/storage').Storage>}
 */
export async function getStorageClient(projectId, accessToken = GCLOUD_AUTH) {
  const key = keyGenerator(projectId, accessToken);
  return getClient(
    'storage',
    key,
    async () => (await import('@google-cloud/storage')).Storage,
    { projectId },
    accessToken
  );
}

/**
 * Gets a Cloud Build Client for the specified project.
 * @param {string} projectId - The Google Cloud project ID.
 * @returns {Promise<import('@google-cloud/cloudbuild').CloudBuildClient>}
 */
export async function getCloudBuildClient(
  projectId,
  accessToken = GCLOUD_AUTH
) {
  const key = keyGenerator(projectId, accessToken);
  return getClient(
    'cloudBuild',
    key,
    async () => (await import('@google-cloud/cloudbuild')).CloudBuildClient,
    { projectId },
    accessToken
  );
}

/**
 * Gets an Artifact Registry Client for the specified project.
 * @param {string} projectId - The Google Cloud project ID.
 * @returns {Promise<import('@google-cloud/artifact-registry').ArtifactRegistryClient>}
 */
export async function getArtifactRegistryClient(
  projectId,
  accessToken = GCLOUD_AUTH
) {
  const key = keyGenerator(projectId, accessToken);
  return getClient(
    'artifactRegistry',
    key,
    async () =>
      (await import('@google-cloud/artifact-registry')).ArtifactRegistryClient,
    { projectId },
    accessToken
  );
}

/**
 * Gets a Logging Client for the specified project.
 * @param {string} projectId - The Google Cloud project ID.
 * @returns {Promise<import('@google-cloud/logging').Logging>}
 */
export async function getLoggingClient(projectId, accessToken = GCLOUD_AUTH) {
  const key = keyGenerator(projectId, accessToken);
  return getClient(
    'logging',
    key,
    async () => (await import('@google-cloud/logging')).Logging,
    { projectId },
    accessToken
  );
}

/**
 * Gets a Billing Client for the specified project.
 * Note: BillingClient usually doesn't take projectId in constructor for listing accounts,
 * but might for project billing info. We will cache by projectId anyway or 'global' if projectId is null.
 * @param {string} [projectId] - The Google Cloud project ID (optional).
 * @returns {Promise<import('@google-cloud/billing').CloudBillingClient>}
 */
export async function getBillingClient(
  projectId = 'global',
  accessToken = GCLOUD_AUTH
) {
  const key = keyGenerator(projectId, accessToken);
  return getClient(
    'billing',
    key,
    async () => (await import('@google-cloud/billing')).CloudBillingClient,
    projectId !== 'global' ? { projectId } : {},
    accessToken
  );
}

/**
 * Gets a Projects Client (Resource Manager).
 * @returns {Promise<import('@google-cloud/resource-manager').ProjectsClient>}
 */
export async function getProjectsClient(accessToken = GCLOUD_AUTH) {
  const key = keyGenerator('global', accessToken);
  return getClient(
    'projects',
    key,
    async () => (await import('@google-cloud/resource-manager')).ProjectsClient,
    {},
    accessToken
  );
}


/**
 * Gets an OAuth2 Client for the specified access token.
 * @param {string} accessToken - The access token.
 * @returns {Promise<OAuth2Client>}
 */
export async function getOAuthClient(accessToken) {
  // Use the access token itself as the key since it's unique per session/user
  if (!clients.oauth.has(accessToken)) {
    const client = new OAuth2Client(CLIENT_ID, CLIENT_SECRET, REDIRECT_URI);
    client.setCredentials({ access_token: accessToken });
    clients.oauth.set(accessToken, client);
  }

  return clients.oauth.get(accessToken);
}

/**
 * Gets a Cloud Run v1 Client (from googleapis).
 * @param {string} projectId - The Google Cloud project ID.
 * @param {string} accessToken - Access token for authentication.
 * @param {string} [region] - The Google Cloud region (optional).
 * @returns {Promise<import('googleapis').run_v1.Run>}
 */
export async function getRunV1Client(
  projectId,
  accessToken = GCLOUD_AUTH,
  region = null
) {
  const key = keyGenerator(projectId, accessToken);
  if (!clients.runV1.has(key)) {
    const { google } = await import('googleapis');
    const options = { version: 'v1' };

    if (accessToken && accessToken !== GCLOUD_AUTH) {
      options.auth = await getOAuthClient(accessToken);
    } else {
      // Use Application Default Credentials for GCLOUD_AUTH
      const auth = new google.auth.GoogleAuth({
        scopes: [CLOUD_PLATFORM_SCOPE],
        projectId: projectId,
      });
      options.auth = auth;
    }

    if (region) {
      const availableRegions = await getCloudRunRegions(projectId, accessToken);
      if (!availableRegions.includes(region)) {
        throw new Error(`Invalid region: ${region}.`);
      }
      options.rootUrl = `https://${region}-run.googleapis.com/`;
    }
    clients.runV1.set(key, google.run(options));
  }
  return clients.runV1.get(key);
}

let cachedRegions = null;

/**
 * Resets the cached regions. Used for testing.
 */
export function resetCachedRegions() {
  cachedRegions = null;
}

/**
 * Returns a list of supported Cloud Run regions by fetching them from Compute Engine API.
 * This is the SDK equivalent of `gcloud compute regions list`.
 * Note: This is not moved to utils as it is required by getRunV1Client. Moving it to utils
 * would lead to circular dependency.
 * @param {string} projectId - The project ID to fetch regions for.
 * @param {string} accessToken - The access token for authentication.
 * @returns {Promise<string[]>}
 */
export async function getCloudRunRegions(projectId, accessToken) {
  if (cachedRegions) {
    return cachedRegions;
  }
  const runClient = await getRunClient(projectId, accessToken);
  const iterable = runClient.listLocationsAsync({
    name: `projects/${projectId}`,
  });

  const regions = [];
  for await (const region of iterable) {
    regions.push(region.locationId);
  }

  cachedRegions = regions;
  return cachedRegions;
}
