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

import { deployImage } from './cloud-run-deploy.js';
import { ensureApisEnabled } from './gcp-api-helpers.js';
import { Storage } from '@google-cloud/storage';
import https from 'https';

/**
 * Helper function to log a message and call the progress callback.
 * @param {string} message - The message to log.
 * @param {function(object): void} [progressCallback] - Optional callback for progress updates.
 * @param {'debug' | 'info' | 'warn' | 'error'} [severity='info'] - The severity level of the message.
 */
async function logAndProgress(message, progressCallback, severity = 'info') {
  switch (severity) {
    case 'error':
      console.error(message);
      break;
    case 'warn':
    case 'info':
    case 'debug':
    default:
      console.log(message);
      break;
  }
  if (progressCallback) {
    progressCallback({ level: severity, data: message });
  }
}

async function triggerOllamaPull(serviceUrl, model, progressCallback) {
  const MAX_RETRIES = 3;
  const RETRY_DELAY_MS = 10000; // 10 seconds

  for (let i = 0; i < MAX_RETRIES; i++) {
    try {
      await new Promise((resolve, reject) => {
        const pullUrl = new URL(`${serviceUrl}/api/pull`);
        const postData = JSON.stringify({ model: model });

        const options = {
          hostname: pullUrl.hostname,
          path: pullUrl.pathname,
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(postData),
          },
        };

        const req = https.request(options, (res) => {
          if (res.statusCode === 403) {
            logAndProgress(
              `Ollama pull request failed with status: 403. The deployed service requires authentication. Please redeploy the service and allow unauthenticated requests.`,
              progressCallback,
              'error'
            );
            return resolve();
          } else if (res.statusCode === 503) {
            logAndProgress(`Ollama service is not yet available (503). Retrying in ${RETRY_DELAY_MS / 1000} seconds...`, progressCallback, 'warn');
            return reject(new Error('Service Unavailable'));
          }

          logAndProgress(`Ollama pull request acknowledged with status: ${res.statusCode}. Model download is proceeding in the background.`, progressCallback);
          resolve();
        });

        req.on('error', (e) => {
          logAndProgress(`Failed to trigger Ollama pull: ${e.message}`, progressCallback, 'warn');
          resolve();
        });

        req.setTimeout(10000, () => {
          logAndProgress('Ollama pull request timed out. The download may still be proceeding in the background.', progressCallback, 'warn');
          req.destroy();
          resolve();
        });

        req.write(postData);
        req.end();
      });
      return; // Success
    } catch (error) {
      if (i < MAX_RETRIES - 1) {
        await new Promise(res => setTimeout(res, RETRY_DELAY_MS));
      } else {
        logAndProgress('Ollama service did not become available. Please check the service logs.', progressCallback, 'error');
      }
    }
  }
}

async function ensureStorageBucketExists(
  storage,
  bucketName,
  location = 'us',
  progressCallback
) {
  const bucket = storage.bucket(bucketName);
  try {
    const [exists] = await bucket.exists();
    if (exists) {
      logAndProgress(`Bucket ${bucketName} already exists.`, progressCallback);
      return bucket;
    } else {
      logAndProgress(`Bucket ${bucketName} does not exist. Creating in location ${location}...`, progressCallback);
      const [createdBucket] = await storage.createBucket(bucketName, { location });
      logAndProgress(`Storage bucket ${createdBucket.name} created successfully in ${location}.`, progressCallback);
      return createdBucket;
    }
  } catch (error) {
    logAndProgress(`Error checking/creating bucket ${bucketName}: ${error.message}`, progressCallback, 'error');
    throw error;
  }
}

// Placeholder for resource calculation logic
function calculateResources(model) {
  // This will be implemented in a future version.
  // For now, return a default configuration.
  // For optimal performance, 8 vCPU and 32Gi of memory are recommended.
  return {
    cpu: '8',
    memory: '32Gi',
    gpu: '1',
  };
}

export async function deployModel({
  projectId,
  region,
  serviceName,
  framework,
  model,
  hfToken,
  gcsBucket,
  progressCallback,
}) {
  logAndProgress(`Starting deployment of model ${model} with framework ${framework}...`, progressCallback);

  logAndProgress('Ensuring required APIs are enabled...', progressCallback);
  await ensureApisEnabled(projectId, ['storage.googleapis.com'], progressCallback);
  logAndProgress('APIs enabled.', progressCallback);

  const storage = new Storage({ projectId });
  const bucketName = gcsBucket || `${projectId}-cloud-run-models`;
  logAndProgress(`Using GCS bucket: ${bucketName}`, progressCallback);
  await ensureStorageBucketExists(storage, bucketName, region, progressCallback);

  let imageUrl;
  const containerArgs = [];
  const containerEnv = [];
  let containerPort = 8080; // Default port

  logAndProgress(`Configuring container for framework: ${framework}...`, progressCallback);
  if (framework === 'ollama') {
    imageUrl = 'ollama/ollama';
    containerPort = 11434; // Ollama's default port
    containerEnv.push({ name: 'OLLAMA_MODELS', value: '/models' });
    logAndProgress(`Using Ollama image: ${imageUrl} on port ${containerPort}. Models will be read from /models.`, progressCallback);
  } else if (framework === 'vllm') {
    imageUrl = 'vllm/vllm-openai';
    containerArgs.push('--model', '/models');
    logAndProgress(`Using vLLM image: ${imageUrl}. Model path set to /models.`, progressCallback);
  } else {
    throw new Error(`Unsupported framework: ${framework}`);
  }

  if (hfToken) {
    containerEnv.push({ name: 'HF_TOKEN', value: hfToken });
    logAndProgress('Hugging Face token has been set.', progressCallback);
  }

  logAndProgress('Calculating required resources...', progressCallback);
  const resources = calculateResources(model);
  logAndProgress(`Resources calculated: ${resources.cpu} CPU, ${resources.memory} Memory, ${resources.gpu} GPU.`, progressCallback);

  const finalServiceName = serviceName || `${framework}-${model.replace(/[^a-z0-9]/gi, '-')}`;
  logAndProgress(`Deploying container image to Cloud Run service: ${finalServiceName}...`, progressCallback);
  const service = await deployImage({
    projectId,
    serviceName: finalServiceName,
    region,
    imageUrl,
    containerArgs,
    containerEnv,
    containerPort,
    resources,
    gcsBucket: bucketName,
    progressCallback,
  });

  logAndProgress(`Service object received: ${JSON.stringify(service)}`, progressCallback);

  if (framework === 'ollama' && service.uri) {
    logAndProgress(`Triggering Ollama to download model ${model}. This may take a while...`, progressCallback);
    await triggerOllamaPull(service.uri, model, progressCallback);
  }

  logAndProgress('Model deployment to Cloud Run completed.', progressCallback);
  return service;
}
