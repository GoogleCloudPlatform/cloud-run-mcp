/*
Copyright 2025 Google LLC

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
you may obtain a copy of the License at

    https://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
*/

import { z } from 'zod';
import { deploy, deployImage } from './lib/cloud-run-deploy.js';
import { zipFiles } from './lib/archive.js';
import {
  listServices,
  getService,
  getServiceLogs,
} from './lib/cloud-run-services.js';
import {
  listProjects,
  createProjectAndAttachBilling,
} from './lib/gcp-projects.js';

import { ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js';

function createProgressCallback(sendNotification) {
  return (progress) => {
    sendNotification({
      method: 'notifications/message',
      params: { level: progress.level || 'info', data: progress.data },
    });
  };
}

function gcpTool(gcpCredentialsAvailable, fn) {
  if (!gcpCredentialsAvailable) {
    return () => ({
      content: [
        {
          type: 'text',
          text: 'GCP credentials are not available. Please configure your environment.',
        },
      ],
    });
  }
  return fn;
}

export const registerTools = (
  server,
  {
    defaultProjectId,
    defaultRegion,
    defaultServiceName,
    skipIamCheck,
    gcpCredentialsAvailable,
  } = {}
) => {
  // Tool to list GCP projects
  server.registerTool(
    'list_projects',
    {
      description: 'Lists available GCP projects',
      inputSchema: {},
    },
    gcpTool(gcpCredentialsAvailable, async () => {
      try {
        const projects = await listProjects();
        return {
          content: [
            {
              type: 'text',
              text: `Available GCP Projects:\n${projects.map((p) => `- ${p.id}`).join('\n')}`,
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: 'text',
              text: `Error listing GCP projects: ${error.message}`,
            },
          ],
        };
      }
    })
  );

  // Tool to create a new GCP project
  server.registerTool(
    'create_project',
    {
      description:
        'Creates a new GCP project and attempts to attach it to the first available billing account. A project ID can be optionally specified; otherwise it will be automatically generated.',
      inputSchema: {
        projectId: z
          .string()
          .optional()
          .describe(
            'Optional. The desired ID for the new GCP project. If not provided, an ID will be auto-generated.'
          ),
      },
    },
    gcpTool(gcpCredentialsAvailable, async ({ projectId }) => {
      if (
        projectId !== undefined &&
        (typeof projectId !== 'string' || projectId.trim() === '')
      ) {
        return {
          content: [
            {
              type: 'text',
              text: 'Error: If provided, Project ID must be a non-empty string.',
            },
          ],
        };
      }
      try {
        const result = await createProjectAndAttachBilling(projectId);
        return {
          content: [
            {
              type: 'text',
              text: `Successfully created GCP project with ID "${result.projectId}". You can now use this project ID for deployments.`,
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: 'text',
              text: `Error creating GCP project or attaching billing: ${error.message}`,
            },
          ],
        };
      }
    })
  );

  // Listing Cloud Run services
  server.registerTool(
    'list_services',
    {
      description: 'Lists Cloud Run services in a given project and region.',
      inputSchema: {
        project: z
          .string()
          .describe('Google Cloud project ID')
          .default(defaultProjectId),
        region: z
          .string()
          .describe('Region where the services are located')
          .default(defaultRegion),
      },
    },
    gcpTool(gcpCredentialsAvailable, async ({ project, region }) => {
      if (typeof project !== 'string') {
        return {
          content: [
            {
              type: 'text',
              text: 'Error: Project ID must be provided and be a non-empty string.',
            },
          ],
        };
      }

      try {
        const services = await listServices(project, region);
        const serviceList = services
          .map((s) => {
            const serviceName = s.name.split('/').pop();
            return `- ${serviceName} (URL: ${s.uri})`;
          })
          .join('\n');
        return {
          content: [
            {
              type: 'text',
              text: `Services in project ${project} (location ${region}):\n${serviceList}`,
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: 'text',
              text: `Error listing services for project ${project} (region ${region}): ${error.message}`,
            },
          ],
        };
      }
    })
  );

  // Dynamic resource for getting a specific service
  server.registerTool(
    'get_service',
    {
      description: 'Gets details for a specific Cloud Run service.',
      inputSchema: {
        project: z
          .string()
          .describe('Google Cloud project ID containing the service')
          .default(defaultProjectId),
        region: z
          .string()
          .describe('Region where the service is located')
          .default(defaultRegion),
        service: z
          .string()
          .describe('Name of the Cloud Run service')
          .default(defaultServiceName),
      },
    },
    gcpTool(gcpCredentialsAvailable, async ({ project, region, service }) => {
      if (typeof project !== 'string') {
        return {
          content: [
            { type: 'text', text: 'Error: Project ID must be provided.' },
          ],
        };
      }
      if (typeof service !== 'string') {
        return {
          content: [
            { type: 'text', text: 'Error: Service name must be provided.' },
          ],
        };
      }
      try {
        const serviceDetails = await getService(project, region, service);
        if (serviceDetails) {
          return {
            content: [
              {
                type: 'text',
                text: `Name: ${service}\nRegion: ${region}\nProject: ${project}\nURL: ${serviceDetails.uri}\nLast deployed by: ${serviceDetails.lastModifier}`,
              },
            ],
          };
        } else {
          return {
            content: [
              {
                type: 'text',
                text: `Service ${service} not found in project ${project} (region ${region}).`,
              },
            ],
          };
        }
      } catch (error) {
        return {
          content: [
            {
              type: 'text',
              text: `Error getting service ${service} in project ${project} (region ${region}): ${error.message}`,
            },
          ],
        };
      }
    })
  );

  // Logs for a service
  server.registerTool(
    'get_service_log',
    {
      description:
        'Gets Logs and Error Messages for a specific Cloud Run service.',
      inputSchema: {
        project: z
          .string()
          .describe('Google Cloud project ID containing the service')
          .default(defaultProjectId),
        region: z
          .string()
          .describe('Region where the service is located')
          .default(defaultRegion),
        service: z
          .string()
          .describe('Name of the Cloud Run service')
          .default(defaultServiceName),
      },
    },
    gcpTool(gcpCredentialsAvailable, async ({ project, region, service }) => {
      let allLogs = [];
      let requestOptions;
      try {
        do {
          // Fetch a page of logs
          const response = await getServiceLogs(
            project,
            region,
            service,
            requestOptions
          );

          if (response.logs) {
            allLogs.push(response.logs);
          }

          // Set the requestOptions incl pagintion token for the next iteration

          requestOptions = response.requestOptions;
        } while (requestOptions); // Continue as long as there is a next page token
        return {
          content: [
            {
              type: 'text',
              text: allLogs.join('\n'),
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: 'text',
              text: `Error getting Logs for service ${service} in project ${project} (region ${region}): ${error.message}`,
            },
          ],
        };
      }
    })
  );

  server.registerTool(
    'deploy_local_files',
    {
      description:
        'Deploy local files to Cloud Run. Takes an array of absolute file paths from the local filesystem that will be deployed. Use this tool if the files exists on the user local filesystem.',
      inputSchema: {
        project: z
          .string()
          .describe(
            'Google Cloud project ID. Do not select it yourself, make sure the user provides or confirms the project ID.'
          )
          .default(defaultProjectId),
        region: z
          .string()
          .optional()
          .default(defaultRegion)
          .describe('Region to deploy the service to'),
        service: z
          .string()
          .optional()
          .default(defaultServiceName)
          .describe('Name of the Cloud Run service to deploy to'),
        files: z
          .array(z.string())
          .describe(
            'Array of absolute file paths to deploy (e.g. ["/home/user/project/src/index.js", "/home/user/project/package.json"])'
          ),
      },
    },
    gcpTool(
      gcpCredentialsAvailable,
      async ({ project, region, service, files }, { sendNotification }) => {
        if (typeof project !== 'string') {
          throw new Error(
            'Project must specified, please prompt the user for a valid existing Google Cloud project ID.'
          );
        }
        if (typeof files !== 'object' || !Array.isArray(files)) {
          throw new Error('Files must specified');
        }
        if (files.length === 0) {
          throw new Error('No files specified for deployment');
        }

        const progressCallback = createProgressCallback(sendNotification);

        // Deploy to Cloud Run
        try {
          await progressCallback({
            data: `Starting deployment of local files for service ${service} in project ${project}...`,
          });

          const { zipBuffer, hasDockerfile } = await zipFiles(
            files,
            progressCallback
          );

          const response = await deploy({
            projectId: project,
            serviceName: service,
            region: region,
            zipBuffer,
            hasDockerfile,
            skipIamCheck: skipIamCheck, // Pass the new flag
            progressCallback,
          });
          return {
            content: [
              {
                type: 'text',
                text: `Cloud Run service ${service} deployed in project ${project}\nCloud Console: https://console.cloud.google.com/run/detail/${region}/${service}?project=${project}\nService URL: ${response.uri}`,
              },
            ],
          };
        } catch (error) {
          return {
            content: [
              {
                type: 'text',
                text: `Error deploying to Cloud Run: ${error.message || error}`,
              },
            ],
          };
        }
      }
    )
  );

  server.registerTool(
    'deploy_local_folder',
    {
      description:
        'Deploy a local folder to Cloud Run. Takes an absolute folder path from the local filesystem that will be deployed. Use this tool if the entire folder content needs to be deployed.',
      inputSchema: {
        project: z
          .string()
          .describe(
            'Google Cloud project ID. Do not select it yourself, make sure the user provides or confirms the project ID.'
          )
          .default(defaultProjectId),
        region: z
          .string()
          .optional()
          .default(defaultRegion)
          .describe('Region to deploy the service to'),
        service: z
          .string()
          .optional()
          .default(defaultServiceName)
          .describe('Name of the Cloud Run service to deploy to'),
        folderPath: z
          .string()
          .describe(
            'Absolute path to the folder to deploy (e.g. "/home/user/project/src")'
          ),
      },
    },
    gcpTool(
      gcpCredentialsAvailable,
      async (
        { project, region, service, folderPath },
        { sendNotification }
      ) => {
        if (typeof project !== 'string') {
          throw new Error(
            'Project must be specified, please prompt the user for a valid existing Google Cloud project ID.'
          );
        }
        if (typeof folderPath !== 'string' || folderPath.trim() === '') {
          throw new Error(
            'Folder path must be specified and be a non-empty string.'
          );
        }

        const progressCallback = createProgressCallback(sendNotification);

        // Deploy to Cloud Run
        try {
          await progressCallback({
            data: `Starting deployment of local folder for service ${service} in project ${project}...`,
          });

          const { zipBuffer, hasDockerfile } = await zipFiles(
            [folderPath],
            progressCallback
          );

          const response = await deploy({
            projectId: project,
            serviceName: service,
            region: region,
            zipBuffer,
            hasDockerfile,
            skipIamCheck: skipIamCheck, // Pass the new flag
            progressCallback,
          });
          return {
            content: [
              {
                type: 'text',
                text: `Cloud Run service ${service} deployed from folder ${folderPath} in project ${project}\nCloud Console: https://console.cloud.google.com/run/detail/${region}/${service}?project=${project}\nService URL: ${response.uri}`,
              },
            ],
          };
        } catch (error) {
          return {
            content: [
              {
                type: 'text',
                text: `Error deploying folder to Cloud Run: ${error.message || error}`,
              },
            ],
          };
        }
      }
    )
  );

  server.registerTool(
    'deploy_file_contents',
    {
      description:
        'Deploy files to Cloud Run by providing their contents directly. Takes an array of file objects containing filename and content. Use this tool if the files only exist in the current chat context.',
      inputSchema: {
        project: z
          .string()
          .describe(
            'Google Cloud project ID. Leave unset for the app to be deployed in a new project. If provided, make sure the user confirms the project ID they want to deploy to.'
          )
          .default(defaultProjectId),
        region: z
          .string()
          .optional()
          .default(defaultRegion)
          .describe('Region to deploy the service to'),
        service: z
          .string()
          .optional()
          .default(defaultServiceName)
          .describe('Name of the Cloud Run service to deploy to'),
        files: z
          .array(
            z.object({
              filename: z
                .string()
                .describe(
                  'Name and path of the file (e.g. "src/index.js" or "data/config.json")'
                ),
              content: z
                .string()
                .optional()
                .describe('Text content of the file'),
            })
          )
          .describe('Array of file objects containing filename and content'),
      },
    },
    gcpTool(
      gcpCredentialsAvailable,
      async ({ project, region, service, files }, { sendNotification }) => {
        if (typeof project !== 'string') {
          throw new Error(
            'Project must specified, please prompt the user for a valid existing Google Cloud project ID.'
          );
        }
        if (typeof files !== 'object' || !Array.isArray(files)) {
          throw new Error('Files must be specified');
        }
        if (files.length === 0) {
          throw new Error('No files specified for deployment');
        }

        // Validate that each file has either content
        for (const file of files) {
          if (!file.content) {
            throw new Error(`File ${file.filename} must have content`);
          }
        }

        const progressCallback = createProgressCallback(sendNotification);

        // Deploy to Cloud Run
        try {
          await progressCallback({
            data: `Starting deployment of file contents for service ${service} in project ${project}...`,
          });

          const { zipBuffer, hasDockerfile } = await zipFiles(
            files,
            progressCallback
          );

          const response = await deploy({
            projectId: project,
            serviceName: service,
            region: region,
            zipBuffer,
            hasDockerfile,
            skipIamCheck: skipIamCheck, // Pass the new flag
            progressCallback,
          });
          return {
            content: [
              {
                type: 'text',
                text: `Cloud Run service ${service} deployed in project ${project}\nCloud Console: https://console.cloud.google.com/run/detail/${region}/${service}?project=${project}\nService URL: ${response.uri}`,
              },
            ],
          };
        } catch (error) {
          return {
            content: [
              {
                type: 'text',
                text: `Error deploying to Cloud Run: ${error.message || error}`,
              },
            ],
          };
        }
      }
    )
  );

  server.registerTool(
    'deploy_container_image',
    {
      description:
        'Deploys a container image to Cloud Run. Use this tool if the user provides a container image URL.',
      inputSchema: {
        project: z
          .string()
          .describe(
            'Google Cloud project ID. Do not select it yourself, make sure the user provides or confirms the project ID.'
          )
          .default(defaultProjectId),
        region: z
          .string()
          .optional()
          .default(defaultRegion)
          .describe('Region to deploy the service to'),
        service: z
          .string()
          .optional()
          .default(defaultServiceName)
          .describe('Name of the Cloud Run service to deploy to'),
        imageUrl: z
          .string()
          .describe(
            'The URL of the container image to deploy (e.g. "gcr.io/cloudrun/hello")'
          ),
      },
    },
    gcpTool(
      gcpCredentialsAvailable,
      async ({ project, region, service, imageUrl }, { sendNotification }) => {
        if (typeof project !== 'string') {
          throw new Error(
            'Project must specified, please prompt the user for a valid existing Google Cloud project ID.'
          );
        }
        if (typeof imageUrl !== 'string' || imageUrl.trim() === '') {
          throw new Error(
            'Container image URL must be specified and be a non-empty string.'
          );
        }

        const progressCallback = createProgressCallback(sendNotification);

        // Deploy to Cloud Run
        try {
          const response = await deployImage({
            projectId: project,
            serviceName: service,
            region: region,
            imageUrl: imageUrl,
            skipIamCheck: skipIamCheck,
            progressCallback,
          });
          return {
            content: [
              {
                type: 'text',
                text: `Cloud Run service ${service} deployed in project ${project}\nCloud Console: https://console.cloud.google.com/run/detail/${region}/${service}?project=${project}\nService URL: ${response.uri}`,
              },
            ],
          };
        } catch (error) {
          return {
            content: [
              {
                type: 'text',
                text: `Error deploying to Cloud Run: ${error.message || error}`,
              },
            ],
          };
        }
      }
    )
  );
};

export const registerToolsRemote = async (
  server,
  {
    defaultProjectId,
    defaultRegion,
    defaultServiceName,
    skipIamCheck = false,
    gcpCredentialsAvailable,
  } = {}
) => {
  // We no longer call checkGCP here; the effective defaults are passed in.
  const currentProject = defaultProjectId; // Use the passed effective project ID
  const currentRegion = defaultRegion; // Use the passed effective region

  if (!currentProject) {
    throw new Error(
      'Cannot register remote tools: GCP project ID could not be determined. Please ensure GOOGLE_CLOUD_PROJECT environment variable is set or the server is running on GCP.'
    );
  }

  // Listing Cloud Run services (Remote)
  server.registerTool(
    'list_services',
    {
      description: `Lists Cloud Run services in GCP project ${currentProject} and a given region.`,
      inputSchema: {
        region: z
          .string()
          .describe('Region where the services are located')
          .default(currentRegion),
      },
    },
    gcpTool(gcpCredentialsAvailable, async ({ region }) => {
      try {
        const services = await listServices(currentProject, region);
        const serviceList = services
          .map((s) => {
            const serviceName = s.name.split('/').pop();
            return `- ${serviceName} (URL: ${s.uri})`;
          })
          .join('\n');
        return {
          content: [
            {
              type: 'text',
              text: `Services in project ${currentProject} (location ${region}):\n${serviceList}`,
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: 'text',
              text: `Error listing services for project ${currentProject} (region ${currentRegion}): ${error.message}`,
            },
          ],
        };
      }
    })
  );

  // Dynamic resource for getting a specific service (Remote)
  server.registerTool(
    'get_service',
    {
      description: `Gets details for a specific Cloud Run service in GCP project ${currentProject}.`,
      inputSchema: {
        region: z
          .string()
          .describe('Region where the service is located')
          .default(currentRegion),
        service: z
          .string()
          .describe('Name of the Cloud Run service')
          .default(defaultServiceName),
      },
    },
    gcpTool(gcpCredentialsAvailable, async ({ region, service }) => {
      if (typeof service !== 'string') {
        return {
          content: [
            { type: 'text', text: 'Error: Service name must be provided.' },
          ],
        };
      }
      try {
        const serviceDetails = await getService(
          currentProject,
          region,
          service
        );
        if (serviceDetails) {
          return {
            content: [
              {
                type: 'text',
                text: `Name: ${service}\nRegion: ${region}\nProject: ${currentProject}\nURL: ${serviceDetails.uri}\nLast deployed by: ${serviceDetails.lastModifier}`,
              },
            ],
          };
        } else {
          return {
            content: [
              {
                type: 'text',
                text: `Service ${service} not found in project ${currentProject} (region ${currentRegion}).`,
              },
            ],
          };
        }
      } catch (error) {
        return {
          content: [
            {
              type: 'text',
              text: `Error getting service ${service} in project ${currentProject} (region ${currentRegion}): ${error.message}`,
            },
          ],
        };
      }
    })
  );

  // Logs for a service
  server.registerTool(
    'get_service_log',
    {
      description:
        'Gets Logs and Error Messages for a specific Cloud Run service.',
      inputSchema: {
        project: z
          .string()
          .describe('Google Cloud project ID containing the service')
          .default(currentProject), // Use currentProject
        region: z
          .string()
          .describe('Region where the service is located')
          .default(currentRegion), // Use currentRegion
        service: z
          .string()
          .describe('Name of the Cloud Run service')
          .default(defaultServiceName),
      },
    },
    gcpTool(gcpCredentialsAvailable, async ({ project, region, service }) => {
      let allLogs = [];
      let requestOptions;
      try {
        do {
          // Fetch a page of logs
          const response = await getServiceLogs(
            project,
            region,
            service,
            requestOptions
          );

          if (response.logs) {
            allLogs.push(response.logs);
          }

          // Set the requestOptions incl pagintion token for the next iteration

          requestOptions = response.requestOptions;
        } while (requestOptions); // Continue as long as there is a next page token
        return {
          content: [
            {
              type: 'text',
              text: allLogs.join('\n'),
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: 'text',
              text: `Error getting Logs for service ${service} in project ${project} (region ${region}): ${error.message}`,
            },
          ],
        };
      }
    })
  );

  // Deploy file contents to Cloud Run (Remote)
  server.registerTool(
    'deploy_file_contents',
    {
      description: `Deploy files to Cloud Run by providing their contents directly to the GCP project ${currentProject}.`,
      inputSchema: {
        region: z
          .string()
          .optional()
          .default(currentRegion)
          .describe('Region to deploy the service to'),
        service: z
          .string()
          .optional()
          .default(defaultServiceName)
          .describe('Name of the Cloud Run service to deploy to'), // Use defaultServiceName
        files: z
          .array(
            z.object({
              filename: z
                .string()
                .describe(
                  'Name and path of the file (e.g. "src/index.js" or "data/config.json")'
                ),
              content: z.string().describe('Text content of the file'),
            })
          )
          .describe('Array of file objects containing filename and content'),
      },
    },
    gcpTool(
      gcpCredentialsAvailable,
      async ({ region, service, files }, { sendNotification }) => {
        console.log(
          `New deploy request (remote): ${JSON.stringify({ project: currentProject, region, service, files })}`
        );

        if (!files || !Array.isArray(files) || files.length === 0) {
          throw new Error('Error: files array is required and must not be empty.');
        }

        // Validate that each file has content
        for (const file of files) {
          if (!file.content) {
            throw new Error(`File ${file.filename} must have content`);
          }
        }

        const progressCallback = createProgressCallback(sendNotification);

        // Deploy to Cloud Run
        try {
          await progressCallback({
            data: `Starting deployment of file contents for service ${service} in project ${currentProject}...`,
          });

          const { zipBuffer, hasDockerfile } = await zipFiles(
            files,
            progressCallback
          );

          const response = await deploy({
            projectId: currentProject,
            serviceName: service,
            region: region,
            zipBuffer,
            hasDockerfile,
            skipIamCheck: skipIamCheck, // Pass the new flag
            progressCallback,
          });
          return {
            content: [
              {
                type: 'text',
                text: `Cloud Run service ${service} deployed in project ${currentProject}\nCloud Console: https://console.cloud.google.com/run/detail/${region}/${service}?project=${currentProject}\nService URL: ${response.uri}`,
              },
            ],
          };
        } catch (error) {
          return {
            content: [
              {
                type: 'text',
                text: `Error deploying to Cloud Run: ${error.message || error}`,
              },
            ],
          };
        }
      }
    )
  );

  server.registerTool(
    'deploy_container_image',
    {
      description: `Deploys a container image to Cloud Run in the GCP project ${currentProject}. Use this tool if the user provides a container image URL.`,
      inputSchema: {
        region: z
          .string()
          .optional()
          .default(currentRegion)
          .describe('Region to deploy the service to'),
        service: z
          .string()
          .optional()
          .default(defaultServiceName)
          .describe('Name of the Cloud Run service to deploy to'),
        imageUrl: z
          .string()
          .describe(
            'The URL of the container image to deploy (e.g. "gcr.io/cloudrun/hello")'
          ),
      },
    },
    gcpTool(
      gcpCredentialsAvailable,
      async ({ region, service, imageUrl }, { sendNotification }) => {
        if (typeof imageUrl !== 'string' || imageUrl.trim() === '') {
          throw new Error(
            'Container image URL must be specified and be a non-empty string.'
          );
        }

        const progressCallback = createProgressCallback(sendNotification);

        // Deploy to Cloud Run
        try {
          await progressCallback({
            data: `Starting deployment of container image for service ${service} in project ${currentProject}...`,
          });
          const response = await deployImage({
            projectId: currentProject,
            serviceName: service,
            region: region,
            imageUrl: imageUrl,
            skipIamCheck: skipIamCheck,
            progressCallback,
          });
          return {
            content: [
              {
                type: 'text',
                text: `Cloud Run service ${service} deployed in project ${currentProject}\nCloud Console: https://console.cloud.google.com/run/detail/${region}/${service}?project=${currentProject}\nService URL: ${response.uri}`,
              },
            ],
          };
        } catch (error) {
          return {
            content: [
              {
                type: 'text',
                text: `Error deploying to Cloud Run: ${error.message || error}`,
              },
            ],
          };
        }
      }
    )
  );
};
