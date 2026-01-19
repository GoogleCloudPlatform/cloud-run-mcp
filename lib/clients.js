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

/**
 * Gets a Cloud Run Services Client for the specified project.
 * @param {string} projectId - The Google Cloud project ID.
 * @returns {Promise<import('@google-cloud/run').v2.ServicesClient>}
 */
export async function getRunClient(projectId) {
  if (!clients.run.has(projectId)) {
    const { v2 } = await import('@google-cloud/run');
    const { ServicesClient } = v2;
    clients.run.set(projectId, new ServicesClient({ projectId }));
  }
  return clients.run.get(projectId);
}

/**
 * Gets a Cloud Run Build Client for the specified project.
 * @param {string} projectId - The Google Cloud project ID.
 * @returns {Promise<import('@google-cloud/run').v2.BuildsClient>}
 */
export async function getBuildsClient(projectId) {
  if (!clients.builds[projectId]) {
    const { v2 } = await import('@google-cloud/run');
    const { BuildsClient } = v2;
    clients.builds[projectId] = new BuildsClient({ projectId });
  }
  return clients.builds[projectId];
}

/**
 * Gets a Service Usage Client for the specified project.
 * @param {string} projectId - The Google Cloud project ID.
 * @returns {Promise<import('@google-cloud/service-usage').ServiceUsageClient>}
 */
export async function getServiceUsageClient(projectId) {
  if (!clients.serviceUsage.has(projectId)) {
    const { ServiceUsageClient } = await import('@google-cloud/service-usage');
    clients.serviceUsage.set(projectId, new ServiceUsageClient({ projectId }));
  }
  return clients.serviceUsage.get(projectId);
}

/**
 * Gets a Storage Client for the specified project.
 * @param {string} projectId - The Google Cloud project ID.
 * @returns {Promise<import('@google-cloud/storage').Storage>}
 */
export async function getStorageClient(projectId) {
  if (!clients.storage.has(projectId)) {
    const { Storage } = await import('@google-cloud/storage');
    clients.storage.set(projectId, new Storage({ projectId }));
  }
  return clients.storage.get(projectId);
}

/**
 * Gets a Cloud Build Client for the specified project.
 * @param {string} projectId - The Google Cloud project ID.
 * @returns {Promise<import('@google-cloud/cloudbuild').CloudBuildClient>}
 */
export async function getCloudBuildClient(projectId) {
  if (!clients.cloudBuild.has(projectId)) {
    const { CloudBuildClient } = await import('@google-cloud/cloudbuild');
    clients.cloudBuild.set(projectId, new CloudBuildClient({ projectId }));
  }
  return clients.cloudBuild.get(projectId);
}

/**
 * Gets an Artifact Registry Client for the specified project.
 * @param {string} projectId - The Google Cloud project ID.
 * @returns {Promise<import('@google-cloud/artifact-registry').ArtifactRegistryClient>}
 */
export async function getArtifactRegistryClient(projectId) {
  if (!clients.artifactRegistry.has(projectId)) {
    const { ArtifactRegistryClient } = await import(
      '@google-cloud/artifact-registry'
    );
    clients.artifactRegistry.set(
      projectId,
      new ArtifactRegistryClient({
        projectId,
      })
    );
  }
  return clients.artifactRegistry.get(projectId);
}

/**
 * Gets a Logging Client for the specified project.
 * @param {string} projectId - The Google Cloud project ID.
 * @returns {Promise<import('@google-cloud/logging').Logging>}
 */
export async function getLoggingClient(projectId) {
  if (!clients.logging.has(projectId)) {
    const { Logging } = await import('@google-cloud/logging');
    clients.logging.set(projectId, new Logging({ projectId }));
  }
  return clients.logging.get(projectId);
}

/**
 * Gets a Billing Client for the specified project.
 * Note: BillingClient usually doesn't take projectId in constructor for listing accounts,
 * but might for project billing info. We will cache by projectId anyway or 'global' if projectId is null.
 * @param {string} [projectId] - The Google Cloud project ID (optional).
 * @returns {Promise<import('@google-cloud/billing').CloudBillingClient>}
 */
export async function getBillingClient(projectId = 'global') {
  if (!clients.billing.has(projectId)) {
    const { CloudBillingClient } = await import('@google-cloud/billing');
    clients.billing.set(projectId, new CloudBillingClient());
  }
  return clients.billing.get(projectId);
}

/**
 * Gets a Projects Client (Resource Manager).
 * @returns {Promise<import('@google-cloud/resource-manager').ProjectsClient>}
 */
export async function getProjectsClient() {
  const cacheKey = 'global';
  if (!clients.projects.has(cacheKey)) {
    const { ProjectsClient } = await import('@google-cloud/resource-manager');
    clients.projects.set(cacheKey, new ProjectsClient());
  }
  return clients.projects.get(cacheKey);
}
