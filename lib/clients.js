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

const AUTHORIZATION_HEADER = 'Authorization';
const BEARER_PREFIX = 'Bearer';
const GCLOUD_AUTH = 'gcloud_auth';

function keyGenerator(projectId, accessToken) {
  return accessToken !== GCLOUD_AUTH ? projectId + accessToken : projectId;
}

const clients = {
  run: new Map(),
  builds: new Map(),
  serviceUsage: new Map(),
  storage: new Map(),
  cloudBuild: new Map(),
  artifactRegistry: new Map(),
  logging: new Map(),
  billing: new Map(),
  projects: new Map(),
};

export function getAuthClient(accessToken) {
  return {
    getRequestHeaders: () => {
      const headers = new Map();
      headers.set(AUTHORIZATION_HEADER, `${BEARER_PREFIX} ${accessToken}`);
      return headers;
    },
  };
}

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
      finalOptions.authClient = getAuthClient(accessToken);
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
    {},
    accessToken
  );
}

/**
 * Gets a Projects Client (Resource Manager).
 * @returns {Promise<import('@google-cloud/resource-manager').ProjectsClient>}
 */
export async function getProjectsClient(accessToken = GCLOUD_AUTH) {
  const key = accessToken !== GCLOUD_AUTH ? 'global' + accessToken : 'global';
  return getClient(
    'projects',
    key,
    async () => (await import('@google-cloud/resource-manager')).ProjectsClient,
    {},
    accessToken
  );
}
