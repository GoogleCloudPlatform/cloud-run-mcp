/*
Copyright 2025 Google LLC

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    https://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS-IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
*/

import express from 'express';
import { Storage } from '@google-cloud/storage';
import { Readable, Transform } from 'stream';

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 8080;

app.post('/sync', async (req, res) => {
  const { modelId, bucketName, hfToken } = req.body;

  if (!modelId || !bucketName) {
    return res.status(400).send('Missing modelId or bucketName');
  }

  res.writeHead(200, {
    'Content-Type': 'text/plain',
    'Transfer-Encoding': 'chunked'
  });

  const log = (message) => {
    console.log(message);
    res.write(message + '\n');
  };

  try {
    const storage = new Storage();
    await syncModelToGCS(storage, modelId, bucketName, hfToken, log);
    log('Sync completed successfully.');
  } catch (error) {
    log(`Error during sync: ${error.message}`);
    console.error(error);
  } finally {
    res.end();
  }
});

async function syncModelToGCS(storage, modelId, bucketName, hfToken, log) {
  log(`Starting sync of model ${modelId} to GCS bucket ${bucketName}.`);
  const bucket = storage.bucket(bucketName);
  const modelPathPrefix = modelId;

  const headers = {};
  if (hfToken) {
    headers['Authorization'] = `Bearer ${hfToken}`;
  }
  const modelApiUrl = `https://huggingface.co/api/models/${modelId}`;
  const response = await fetch(modelApiUrl, { headers });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Failed to fetch model info from Hugging Face Hub: ${response.status} ${errorText}`);
  }

  const modelInfo = await response.json();
  const modelFiles = modelInfo.siblings || [];

  if (modelFiles.length === 0) {
    log(`No files found for model ${modelId}. Nothing to sync.`);
    return;
  }

  log(`Found ${modelFiles.length} files for model ${modelId}. Starting sync...`);

  for (const file of modelFiles) {
    const relativePath = file.rfilename;
    const gcsPath = `${modelPathPrefix}/${relativePath}`;
    const gcsFile = bucket.file(gcsPath);

    const [exists] = await gcsFile.exists();
    if (exists) {
      log(`File ${relativePath} already exists in GCS. Skipping.`);
      continue;
    }

    log(`File ${relativePath} not found in GCS. Downloading...`);
    const downloadUrl = `https://huggingface.co/${modelId}/resolve/main/${relativePath}`;
    const downloadResponse = await fetch(downloadUrl, { headers });

    if (!downloadResponse.ok) {
      log(`Failed to download ${relativePath}: ${downloadResponse.statusText}`);
      continue;
    }

    await new Promise((resolve, reject) => {
      const totalSize = Number(downloadResponse.headers.get('content-length')) || 0;
      let downloadedSize = 0;
      let lastReportedPercentage = -1;

      const downloadStream = Readable.fromWeb(downloadResponse.body);
      
      const progressStream = new Transform({
        transform(chunk, encoding, callback) {
          if (totalSize > 0) {
            downloadedSize += chunk.length;
            const percentage = Math.floor((downloadedSize / totalSize) * 100);
            if (percentage >= lastReportedPercentage + 5) {
              log(`Downloading ${relativePath}: ${percentage}% complete...`);
              lastReportedPercentage = percentage;
            }
          }
          this.push(chunk);
          callback();
        }
      });

      downloadStream
        .pipe(progressStream)
        .pipe(gcsFile.createWriteStream())
        .on('finish', () => {
          if (totalSize > 0 && lastReportedPercentage < 100) {
            log(`Downloading ${relativePath}: 100% complete...`);
          }
          log(`Successfully uploaded ${relativePath} to GCS.`);
          resolve();
        })
        .on('error', reject);
    });
  }
}

app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});
