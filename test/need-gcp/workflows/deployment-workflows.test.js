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

import fs from 'fs/promises';
import assert from 'node:assert';
import { test, describe, before, after } from 'node:test';
import path from 'path';

import { deploy, deployImage } from '../../../lib/deployment/deployer.js';
import {
  cleanupProject,
  setSourceDeployProjectPermissions,
  setupProject,
} from '../test-helpers.js';

describe('Deployment workflows', () => {
  let projectId;

  before(async () => {
    try {
      projectId = await setupProject();
      await setSourceDeployProjectPermissions(projectId);
    } catch (err) {
      console.error('Error during project creation and setup:', err);
      throw err;
    }
  });

  test('Scenario-1: Starting deployment of hello image...', async () => {
    const configImageDeploy = {
      projectId: projectId,
      serviceName: 'hello-scenario',
      region: 'us-central1',
      imageUrl: 'gcr.io/cloudrun/hello',
    };
    await deployImage(configImageDeploy);

    console.log('Scenario-1: Deployment completed.');
  });

  test('Scenario-2: Starting deployment with invalid files...', async () => {
    const configFailingBuild = {
      projectId: projectId,
      serviceName: 'example-failing-app',
      region: 'us-central1',
      files: [
        {
          filename: 'main.txt',
          content:
            'This is not a valid application source file and should cause a build failure.',
        },
      ],
    };
    await assert.rejects(
      deploy(configFailingBuild),
      { message: /ERROR: failed to detect: no buildpacks participating/ },
      'Deployment should have failed with a buildpack detection error'
    );
  });

  test('Scenario-3: Starting deployment of Go app with file content...', async () => {
    const mainGoContent = await fs.readFile(
      path.resolve('example-sources-to-deploy/golang/main.go'),
      'utf-8'
    );
    const goModContent = await fs.readFile(
      path.resolve('example-sources-to-deploy/golang/go.mod'),
      'utf-8'
    );
    const configGoWithContent = {
      projectId: projectId,
      serviceName: 'example-go-app-content',
      region: 'us-central1',
      files: [
        { filename: 'main.go', content: mainGoContent },
        { filename: 'go.mod', content: goModContent },
      ],
    };
    await deploy(configGoWithContent);
    console.log('Scenario-3: Deployment completed.');
  });

  test('Scenario-4: Starting deployment of pip-based Python app with folder path... uses zip deploy', async () => {
    const configPipProject = {
      projectId: projectId,
      serviceName: 'example-pip-project-folder-path',
      region: 'us-central1',
      files: ['example-sources-to-deploy/python/pip-project'],
    };
    let successMessage = '';
    configPipProject.progressCallback = (p) => {
      if (p.data === 'Deployment completed successfully with zip deploy') {
        successMessage = p.data;
      }
    };
    await deploy(configPipProject);
    assert.strictEqual(
      successMessage,
      'Deployment completed successfully with zip deploy'
    );
    console.log('Scenario-4: Deployment completed.');
  });

  test('Scenario-5: Starting deployment of pip-based Python app with file-based content... uses source build deploy', async () => {
    const mainPyContent = await fs.readFile(
      path.resolve('example-sources-to-deploy/python/pip-project/main.py'),
      'utf-8'
    );
    const requirementsTxtContent = await fs.readFile(
      path.resolve(
        'example-sources-to-deploy/python/pip-project/requirements.txt'
      ),
      'utf-8'
    );
    const configPipProject = {
      projectId: projectId,
      serviceName: 'example-pip-project-file-content',
      region: 'us-central1',
      files: [
        { filename: 'main.py', content: mainPyContent },
        { filename: 'requirements.txt', content: requirementsTxtContent },
      ],
    };
    let successMessage = '';
    configPipProject.progressCallback = (p) => {
      if (
        p.data === 'Deployment completed successfully with source build deploy'
      ) {
        successMessage = p.data;
      }
    };
    await deploy(configPipProject);
    assert.strictEqual(
      successMessage,
      'Deployment completed successfully with source build deploy'
    );
    console.log('Scenario-5: Deployment completed.');
  });

  test('Scenario-6: Starting deployment of pyproject-based Python app with folder path... uses zip deploy', async () => {
    const configPyprojectProject = {
      projectId: projectId,
      serviceName: 'example-pyproject-project-folder-path',
      region: 'us-central1',
      files: ['example-sources-to-deploy/python/pyproject-project'],
    };
    let successMessage = '';
    configPyprojectProject.progressCallback = (p) => {
      if (p.data === 'Deployment completed successfully with zip deploy') {
        successMessage = p.data;
      }
    };
    await deploy(configPyprojectProject);
    assert.strictEqual(
      successMessage,
      'Deployment completed successfully with zip deploy'
    );
    console.log('Scenario-6: Deployment completed.');
  });

  test('Scenario-7: Starting deployment of pyproject-based Python app with file-based content... uses source build deploy', async () => {
    const mainPyContent = await fs.readFile(
      path.resolve(
        'example-sources-to-deploy/python/pyproject-project/main.py'
      ),
      'utf-8'
    );
    const pyprojectContent = await fs.readFile(
      path.resolve(
        'example-sources-to-deploy/python/pyproject-project/pyproject.toml'
      ),
      'utf-8'
    );
    const configPyprojectProject = {
      projectId: projectId,
      serviceName: 'example-pyproject-project-file-content',
      region: 'us-central1',
      files: [
        { filename: 'main.py', content: mainPyContent },
        { filename: 'pyproject.toml', content: pyprojectContent },
      ],
    };
    let successMessage = '';
    configPyprojectProject.progressCallback = (p) => {
      if (
        p.data === 'Deployment completed successfully with source build deploy'
      ) {
        successMessage = p.data;
      }
    };
    await deploy(configPyprojectProject);
    assert.strictEqual(
      successMessage,
      'Deployment completed successfully with source build deploy'
    );
    console.log('Scenario-7: Deployment completed.');
  });
  test('Scenario-8: Starting deployment of Node.js app with folder path... uses zip deploy', async () => {
    const configNodeProject = {
      projectId: projectId,
      serviceName: 'example-node-project-folder-path',
      region: 'us-central1',
      files: ['example-sources-to-deploy/nodejs'],
    };
    let successMessage = '';
    configNodeProject.progressCallback = (p) => {
      if (p.data === 'Deployment completed successfully with zip deploy') {
        successMessage = p.data;
      }
    };
    await deploy(configNodeProject);
    assert.strictEqual(
      successMessage,
      'Deployment completed successfully with zip deploy'
    );
    console.log('Scenario-8: Deployment completed.');
  });

  test('Scenario-9: Starting deployment of Node.js app with file content... uses build deploy', async () => {
    const packageJsonContent = await fs.readFile(
      path.resolve('example-sources-to-deploy/nodejs/package.json'),
      'utf-8'
    );
    const indexJsContent = await fs.readFile(
      path.resolve('example-sources-to-deploy/nodejs/index.js'),
      'utf-8'
    );
    const configNodeWithContent = {
      projectId: projectId,
      serviceName: 'example-node-app-content',
      region: 'us-central1',
      files: [
        { filename: 'package.json', content: packageJsonContent },
        { filename: 'index.js', content: indexJsContent },
      ],
    };
    let successMessage = '';
    configNodeWithContent.progressCallback = (p) => {
      if (
        p.data === 'Deployment completed successfully with source build deploy'
      ) {
        successMessage = p.data;
      }
    };
    await deploy(configNodeWithContent);
    assert.strictEqual(
      successMessage,
      'Deployment completed successfully with source build deploy'
    );
    console.log('Scenario-9: Deployment completed.');
  });

  after(async () => {
    // Clean up: delete the project created for tests
    cleanupProject(projectId);
  });
});
