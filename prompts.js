/*
 * Copyright 2025 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     https://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
import { z } from "zod";
import { basename } from 'path';

export const registerPrompts = (server) => {
  // Prompts will be registered here.
  server.prompt(
    "deploy",
    "Deploys the current working directory to Cloud Run.",
    {
      name: z.string().describe("Name of the Cloud Run service to deploy to.  Defaults to the name of the current directory").optional(),
    },
    async ({ name }) => {
      const serviceName = name || basename(process.cwd());
      return {
        messages: [{
          role: "user",
          content: {
            type: 'text',
            text: `deploy_local_folder({folderPath: '.', service: '${serviceName}'})`
          }
        }]
      };
    }
  );

  server.prompt(
    "logs",
    "Gets the logs for a Cloud Run service.",
    {
      service: z.string().describe("Name of the Cloud Run service. Defaults to the name of the current directory.").optional(),
    },
    async ({ name }) => {
      const serviceName = name || basename(process.cwd());
      return {
        messages: [{
          role: "user",
          content: {
            type: 'text',
            text: `get_service_log({service: '${serviceName}'})`
          }
        }]
      };
    }
  );
};
