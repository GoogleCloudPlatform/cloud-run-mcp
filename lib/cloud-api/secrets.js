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

import { getSecretManagerClient } from '../clients.js';
import { logAndProgress } from '../util/helpers.js';

/**
 * Retrieves secret metadata.
 * @param {string} projectId - GCP project ID.
 * @param {string} secretName - Name of the secret.
 * @param {string} accessToken - OAuth2 access token.
 * @returns {Promise<Object|null>} Secret data or null if not found.
 */
export async function getSecret(projectId, secretName, accessToken) {
  const secretManager = await getSecretManagerClient(projectId, accessToken);
  try {
    const [res] = await secretManager.getSecret({
      name: `projects/${projectId}/secrets/${secretName}`,
    });
    return res;
  } catch (err) {
    if (err.code === 5) {
      // NOT_FOUND in gRPC
      return null;
    }
    throw err;
  }
}

/**
 * Creates a new secret in Secret Manager.
 * @param {string} projectId - GCP project ID.
 * @param {string} secretName - Name of the secret to create.
 * @param {string} accessToken - OAuth2 access token.
 * @param {Function} progressCallback - Progress reporting callback.
 * @returns {Promise<Object>} The created secret.
 */
export async function createSecret(
  projectId,
  secretName,
  accessToken,
  progressCallback
) {
  const secretManager = await getSecretManagerClient(projectId, accessToken);
  await logAndProgress(`Creating secret '${secretName}'...`, progressCallback);
  const [res] = await secretManager.createSecret({
    parent: `projects/${projectId}`,
    secretId: secretName,
    secret: {
      replication: {
        automatic: {},
      },
    },
  });
  return res;
}

/**
 * Adds a new version to an existing secret.
 * @param {string} projectId - GCP project ID.
 * @param {string} secretName - Name of the secret.
 * @param {Buffer|string} content - Secret content.
 * @param {string} accessToken - OAuth2 access token.
 * @param {Function} progressCallback - Progress reporting callback.
 * @returns {Promise<Object>} Information about the created version.
 */
export async function addSecretVersion(
  projectId,
  secretName,
  content,
  accessToken,
  progressCallback
) {
  const secretManager = await getSecretManagerClient(projectId, accessToken);
  await logAndProgress(
    `Adding new version to secret '${secretName}'...`,
    progressCallback
  );

  const payload =
    typeof content === 'string' ? Buffer.from(content) : content;

  const [res] = await secretManager.addSecretVersion({
    parent: `projects/${projectId}/secrets/${secretName}`,
    payload: {
      data: payload,
    },
  });
  return res;
}

/**
 * Gets the IAM policy for a secret.
 * @param {string} projectId - GCP project ID.
 * @param {string} secretName - Name of the secret.
 * @param {string} accessToken - OAuth2 access token.
 * @returns {Promise<Object>} The IAM policy.
 */
export async function getSecretIamPolicy(projectId, secretName, accessToken) {
  const secretManager = await getSecretManagerClient(projectId, accessToken);
  const [res] = await secretManager.getIamPolicy({
    resource: `projects/${projectId}/secrets/${secretName}`,
  });
  return res;
}

/**
 * Sets the IAM policy for a secret.
 * @param {string} projectId - GCP project ID.
 * @param {string} secretName - Name of the secret.
 * @param {Object} policy - The IAM policy to set.
 * @param {string} accessToken - OAuth2 access token.
 * @param {Function} progressCallback - Progress reporting callback.
 * @returns {Promise<Object>} Result of the policy update.
 */
export async function setSecretIamPolicy(
  projectId,
  secretName,
  policy,
  accessToken,
  progressCallback
) {
  const secretManager = await getSecretManagerClient(projectId, accessToken);
  await logAndProgress(
    `Updating IAM policy for secret '${secretName}'...`,
    progressCallback
  );
  const [res] = await secretManager.setIamPolicy({
    resource: `projects/${projectId}/secrets/${secretName}`,
    policy: policy,
  });
  return res;
}

/**
 * Adds a role binding to a secret's IAM policy.
 * @param {string} projectId - GCP project ID.
 * @param {string} secretName - Name of the secret.
 * @param {string} member - Member to add (e.g. 'serviceAccount:...').
 * @param {string} accessToken - OAuth2 access token.
 * @param {Function} progressCallback - Progress reporting callback.
 * @returns {Promise<Object>} Final IAM policy.
 */
export async function addSecretAccessorBinding(
  projectId,
  secretName,
  member,
  accessToken,
  progressCallback
) {
  const policy = await getSecretIamPolicy(projectId, secretName, accessToken);
  const role = 'roles/secretmanager.secretAccessor';

  policy.bindings = policy.bindings || [];
  const binding = policy.bindings.find((b) => b.role === role);

  if (binding) {
    if (binding.members.includes(member)) {
      return policy;
    }
    binding.members.push(member);
  } else {
    policy.bindings.push({
      role: role,
      members: [member],
    });
  }

  return setSecretIamPolicy(
    projectId,
    secretName,
    policy,
    accessToken,
    progressCallback
  );
}
