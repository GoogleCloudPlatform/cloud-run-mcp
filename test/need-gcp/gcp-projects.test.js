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

import { test } from 'node:test';
import assert from 'node:assert';
import {
  createProjectAndAttachBilling,
  deleteProject,
  generateProjectId,
} from '../../lib/cloud-api/projects.js';

test('should create a new project and attach billing', async () => {
  console.log('Attempting to create a new project and attach billing...');
  let newProjectResult = null;

  const projectId = 'test-' + generateProjectId(); // e.g., test-mcp-cvc-cvc format
  console.log(`Generated project ID: ${projectId}`);

  // Parent is required because service accounts cannot create projects without a parent.
  const parent = process.env.GCP_PARENT || process.argv[2];
  console.log(`Using parent: ${parent}`);

  try {
    newProjectResult = await createProjectAndAttachBilling(projectId, parent);
    assert(newProjectResult, 'newProjectResult should not be null');
    assert(
      newProjectResult.projectId,
      'newProjectResult.projectId should not be null'
    );
    assert(
      newProjectResult.billingMessage,
      'newProjectResult.billingMessage should not be null'
    );
    assert(
      newProjectResult.billingMessage.startsWith(
        `Project ${newProjectResult.projectId} created successfully.`
      ),
      'newProjectResult.billingMessage should start with success message'
    );

    console.log(`Successfully created project: ${newProjectResult.projectId}`);
    console.log(newProjectResult.billingMessage);
  } finally {
    if (newProjectResult && newProjectResult.projectId) {
      console.log(
        `Attempting to delete project: ${newProjectResult.projectId}`
      );
      try {
        await deleteProject(newProjectResult.projectId);
        console.log(
          `Successfully deleted project: ${newProjectResult.projectId}`
        );
      } catch (error) {
        console.error(
          `Error deleting project ${newProjectResult.projectId}:`,
          error
        );
      }
    }
  }
});
