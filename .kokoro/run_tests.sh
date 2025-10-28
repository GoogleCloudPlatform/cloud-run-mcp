#!/bin/bash
#
# Copyright 2022 Google LLC
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.

# Fail on any error.
set -xe

# cd to project root
cd "$(dirname "$0")"/..

# Install dependencies
npm install

# Run tests
npm run test:workflows # Run tests related to all workflows
npm run test:projects # Run tests related to GCP projects
npm run test:services # Run tests related to services
npm run test:deploy # Run tests related to deployments
npm run test:gcp-auth # Run tests related to GCP authentication