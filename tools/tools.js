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

import {
  registerListProjectsTool,
  registerCreateProjectTool,
  registerListServicesTool,
  registerGetServiceTool,
  registerGetServiceLogTool,
  registerDeployLocalFolderTool,
  registerDeployFileContentsTool,
  registerDeployContainerImageTool,
} from './register-tools.js';

export const registerTools = (
  server,
  options = {}
) => {
  registerListProjectsTool(server, options);
  registerCreateProjectTool(server, options);
  registerListServicesTool(server, options);
  registerGetServiceTool(server, options);
  registerGetServiceLogTool(server, options);
  registerDeployLocalFolderTool(server, options);
  registerDeployFileContentsTool(server, options);
  registerDeployContainerImageTool(server, options);
};

export const registerToolsRemote = (
  server,
  options = {}
) => {
  // For remote, use the same registration functions but with effective project/region passed in options
  registerListServicesTool(server, options);
  registerGetServiceTool(server, options);
  registerGetServiceLogTool(server, options);
  registerDeployFileContentsTool(server, options);
  registerDeployContainerImageTool(server, options);
};

