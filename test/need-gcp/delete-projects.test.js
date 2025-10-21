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
import { deleteProject } from '../../lib/cloud-api/projects.js';
import { ProjectsClient } from '@google-cloud/resource-manager';

/**
 * Deletes all projects under a given parent that have a project ID starting with 'test-mcp'.
 * @param {string} parent - The parent resource name, e.g., 'folders/123' or 'organizations/456'.
 */
async function deleteAllTestProjects(parent) {
  if (!parent || !parent.includes('/')) {
    throw new Error(
      'Invalid parent format. Expected folders/123 or organizations/456.'
    );
  }

  const [parentTypePlural, parentId] = parent.split('/');
  const parentType = parentTypePlural.slice(0, -1); // folder or organization
  const query = `parent.type=${parentType} parent.id=${parentId}`;

  console.log(
    `Searching for projects under parent ${parent} with query: "${query}"`
  );

  const client = new ProjectsClient();
  const projectsToDelete = [];

  try {
    for await (const project of client.searchProjectsAsync({ query })) {
      if (
        project.projectId &&
        project.state === 'ACTIVE' &&
        (project.projectId.startsWith('test-mcp') ||
          project.projectId.startsWith('mcp')) &&
        project.projectId !== 'cloud-run-mcp-server-testing' &&
        project.projectId !== 'cloud-run-mcp-prod'
      ) {
        projectsToDelete.push(project.projectId);
      }
    }
  } catch (error) {
    console.error('Error searching for projects:', error.message);
    throw error;
  }

  if (projectsToDelete.length === 0) {
    console.log('No active projects starting with "test-mcp" found to delete.');
    return;
  }

  console.log(
    `Found ${projectsToDelete.length} projects to delete. The following projects will be deleted:`
  );
  projectsToDelete.forEach((projectId) => console.log(`- ${projectId}`));

  const results = await Promise.allSettled(
    projectsToDelete.map((projectId) => deleteProject(projectId))
  );

  results.forEach((result, index) => {
    if (result.status === 'rejected') {
      console.error(
        `Failed to delete project ${projectsToDelete[index]}: ${result.reason.message}`
      );
    }
  });
}

test('Deletes all projects starting with test-mcp under GCP_PARENT', async () => {
  const parent = process.env.GCP_PARENT;
  if (!parent) {
    throw new Error(
      'GCP_PARENT environment variable not set. It must be set to a folder or organization, e.g., folders/12345.'
    );
  }
  await deleteAllTestProjects(parent);
});
