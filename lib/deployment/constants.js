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

export const DEPLOYMENT_CONFIG = {
  REPO_NAME: 'mcp-cloud-run-deployments',
  ZIP_FILE_NAME: 'source.zip',
  TARGZ_FILE_NAME: 'source.tar.gz',
  IMAGE_TAG: 'latest',
  LABEL_CREATED_BY: 'cloud-run-mcp',
  DEFAULT_NODE_BASE_IMAGE: 'nodejs22',
  NO_BUILD_IMAGE_TAG: 'scratch',
};

export const TEMP_PATHS = {
  BASE: '.cloud-run-mcp',
  SUBDIR: 'source',
};

export const REQUIRED_APIS = {
  SOURCE_DEPLOY: [
    'serviceusage.googleapis.com',
    'iam.googleapis.com',
    'storage.googleapis.com',
    'cloudbuild.googleapis.com',
    'artifactregistry.googleapis.com',
    'run.googleapis.com',
  ],
  IMAGE_DEPLOY: ['serviceusage.googleapis.com', 'run.googleapis.com'],
};

export const DEPLOYMENT_TYPES = {
  NO_BUILD: 'no-build',
  IMAGE: 'image',
  WITH_BUILD: 'with-build',
};

export const RUNTIMES = {
  NODEJS: 'nodejs',
};
