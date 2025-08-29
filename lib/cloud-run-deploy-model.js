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

import { deployImage, zipFiles, uploadToStorageBucket, ensureArtifactRegistryRepoExists, triggerCloudBuild } from './cloud-run-deploy.js';
import { ensureApisEnabled } from './gcp-api-helpers.js';
import { Storage } from '@google-cloud/storage';
import https from 'https';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs/promises';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const SYNC_FUNCTION_NAME = 'gcs-sync-function-v1';

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

function calculateResources(model) {
  return {
    cpu: '8',
    memory: '32Gi',
    gpu: '1',
  };
}

async function deploySyncFunction(projectId, region, progressCallback) {
  logAndProgress(`Deploying helper function to sync models...`, progressCallback);
  const functionSourcePath = path.resolve(__dirname, '../gcs-sync-function');
  
  const filesToZip = [
    { filename: 'package.json', content: await fs.readFile(path.join(functionSourcePath, 'package.json')) },
    { filename: 'index.js', content: await fs.readFile(path.join(functionSourcePath, 'index.js')) },
    { filename: 'Dockerfile', content: await fs.readFile(path.join(functionSourcePath, 'Dockerfile')) },
  ];

  const imageName = `gcs-sync-function`;
  const imageUrl = `${region}-docker.pkg.dev/${projectId}/cloud-run-mcp/${imageName}:latest`;

  const storage = new Storage({ projectId });
  const bucketName = `${projectId}-source-bucket`;
  const bucket = await ensureStorageBucketExists(storage, bucketName, region, progressCallback);

  const zipBuffer = await zipFiles(filesToZip, progressCallback);
  const zipFileName = `${imageName}-source.zip`;
  await uploadToStorageBucket(bucket, zipBuffer, zipFileName, progressCallback);

  await ensureArtifactRegistryRepoExists(projectId, region, 'cloud-run-mcp', 'DOCKER', progressCallback);

  const buildResult = await triggerCloudBuild(
    projectId,
    region,
    bucketName,
    zipFileName,
    'cloud-run-mcp',
    imageUrl,
    true, // hasDockerfile
    progressCallback
  );

  const builtImageUrl = buildResult.results.images[0].name;

  const service = await deployImage({
    projectId,
    serviceName: SYNC_FUNCTION_NAME,
    region,
    imageUrl: builtImageUrl,
    progressCallback,
    skipIamCheck: false, 
    resources: { cpu: '2', memory: '4Gi' },
    containerPort: 8080,
  });

  logAndProgress(`Sync function deployed successfully: ${service.uri}`, progressCallback);
  return service;
}

async function getSyncFunction(projectId, region, progressCallback) {
    const { ServicesClient } = (await import('@google-cloud/run')).v2;
    const runClient = new ServicesClient({ projectId });
    const servicePath = runClient.servicePath(projectId, region, SYNC_FUNCTION_NAME);
    
    try {
        const [service] = await runClient.getService({ name: servicePath });
        return service;
    } catch (error) {
        if (error.code === 5) { // NOT_FOUND
            return null;
        }
        throw error;
    }
}

async function invokeSyncFunction(serviceUri, modelId, bucketName, hfToken, progressCallback) {
    logAndProgress(`Invoking sync function at ${serviceUri}...`, progressCallback);
    
    const { GoogleAuth } = await import('google-auth-library');
    const auth = new GoogleAuth({
        scopes: 'https://www.googleapis.com/auth/cloud-platform'
    });
    const client = await auth.getIdTokenClient(serviceUri);
    
    const response = await client.request({
        url: `${serviceUri}/sync`,
        method: 'POST',
        data: { modelId, bucketName, hfToken },
        responseType: 'stream'
    });

    return new Promise((resolve, reject) => {
        response.data.on('data', (chunk) => {
            progressCallback({ level: 'info', data: chunk.toString() });
        });
        response.data.on('end', () => {
            logAndProgress('Sync function invocation complete.', progressCallback);
            resolve();
        });
        response.data.on('error', (err) => {
            logAndProgress(`Error streaming response from sync function: ${err.message}`, progressCallback, 'error');
            reject(err);
        });
    });
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
  await ensureApisEnabled(projectId, ['storage.googleapis.com', 'run.googleapis.com', 'cloudbuild.googleapis.com', 'artifactregistry.googleapis.com'], progressCallback);
  logAndProgress('APIs enabled.', progressCallback);

  const storage = new Storage({ projectId });
  const bucketName = gcsBucket || `${projectId}-cloud-run-models`;
  logAndProgress(`Using GCS bucket: ${bucketName}`, progressCallback);
  await ensureStorageBucketExists(storage, bucketName, region, progressCallback);

  let imageUrl;
  const containerArgs = [];
  const containerEnv = [];
  let containerPort = 8080;

  logAndProgress(`Configuring container for framework: ${framework}...`, progressCallback);
  if (framework === 'ollama') {
    imageUrl = 'ollama/ollama';
    containerPort = 11434;
    containerEnv.push({ name: 'OLLAMA_MODELS', value: '/models' });
    logAndProgress(`Using Ollama image: ${imageUrl} on port ${containerPort}. Models will be read from /models.`, progressCallback);
  } else if (framework === 'vllm') {
    let syncFunction = await getSyncFunction(projectId, region, progressCallback);
    if (!syncFunction) {
        logAndProgress('Sync function not found. Deploying for the first time...', progressCallback);
        syncFunction = await deploySyncFunction(projectId, region, progressCallback);
    } else {
        logAndProgress('Found existing sync function.', progressCallback);
    }

    logAndProgress(`Syncing model ${model} to GCS using the helper function. This may take a while...`, progressCallback);
    await invokeSyncFunction(syncFunction.uri, model, bucketName, hfToken, progressCallback);
    
    containerPort = 8000;
    imageUrl = 'vllm/vllm-openai';
    containerArgs.push('--model', `/models/${model}`);
    containerArgs.push('--max-model-len', '4096');
    containerEnv.push({ name: 'HF_HUB_OFFLINE', value: '1' });
    logAndProgress(`Using standard vLLM image: ${imageUrl}. Model will be loaded from GCS mount.`, progressCallback);
  } else {
    throw new Error(`Unsupported framework: ${framework}`);
  }

  logAndProgress('Calculating required resources...', progressCallback);
  const resources = calculateResources(model);
  logAndProgress(`Resources calculated: ${resources.cpu} CPU, ${resources.memory} Memory, ${resources.gpu} GPU.`, progressCallback);

  const finalServiceName = serviceName || `${framework}-${model.replace(/[^a-z0-9]/gi, '-')}`;
  logAndProgress(`Deploying container image to Cloud Run service: ${finalServiceName}...`, progressCallback);
  
  const deployOptions = {
    projectId,
    serviceName: finalServiceName,
    region,
    imageUrl,
    containerArgs,
    containerEnv,
    containerPort,
    resources,
    progressCallback,
    gcsBucket: bucketName,
  };

  const service = await deployImage(deployOptions);

  logAndProgress(`Service object received: ${JSON.stringify(service)}`, progressCallback);

  if (framework === 'ollama' && service.uri) {
    logAndProgress(`Triggering Ollama to download model ${model}. This may take a while...`, progressCallback);
    await triggerOllamaPull(service.uri, model, progressCallback);
  }

  return service;
}
