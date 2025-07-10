#!/usr/bin/env node

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

import express from 'express';
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
// Support SSE for backward compatibility
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
// Support stdio, as it is easier to use locally
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { registerTools, registerToolsRemote } from './tools.js';
import { checkGCP } from './lib/gcp-metadata.js';
import { exec as childProcessExec } from 'child_process';
import 'dotenv/config';

const gcpInfo = await checkGCP();

/**
 * Ensure that console.log and console.error are compatible with stdio.
 * (Right now, it just disables them)
 */
function makeLoggingCompatibleWithStdio() {
  // redirect all console.log (which usually go to to stdout) to stderr.
  console.log = console.error;
}

function shouldStartStdio() {
  if(process.env.GCP_STDIO){
    return true;
  }
  if (gcpInfo && gcpInfo.project) {
    return false;
  }
  return true;
}

/**
 * Checks for the presence of Google Cloud Application Default Credentials (ADC)
 * by attempting to print an access token. If ADC are not found, it logs an
 * error message and exits the process, instructing the user on how to set them up.
 * This check is only performed when the server is running in a local/stdio environment.
 * @async
 * @param {function} exec - The child_process.exec function to use for executing commands.
 * @returns {Promise<void>} A promise that resolves if ADC are found, or rejects and exits the process if not.
 */
export async function ensureAdcCredentials(exec) {
  return new Promise((resolve, reject) => {
    console.error('Checking for Google Cloud Application Default Credentials...');
    exec('gcloud auth application-default print-access-token', (error, stdout, stderr) => {
      if (error) {
        // Check if the error is specifically due to missing ADC
        if (stderr.includes('Your default credentials were not found') ||
            stderr.includes('To set up Application Default Credentials')) {
          console.error('ERROR: Google Cloud Application Default Credentials are not set up.');
          console.error('Please run the following command to set them up:');
          console.error('gcloud auth application-default login');
          process.exit(1);
        } else {
          // For any other type of error, reject the promise with the original error
          console.error('An unexpected error occurred while checking for ADC credentials:');
          console.error(stderr); // Log the actual stderr for debugging
          reject(error); // Reject with the original error object
        }
      } else {
        console.error('Application Default Credentials found.');
        resolve();
      }
    });
  });
}

if(shouldStartStdio()) {
  makeLoggingCompatibleWithStdio();
  await ensureAdcCredentials(childProcessExec);
};

// Read default configurations from environment variables
const envProjectId = process.env.GOOGLE_CLOUD_PROJECT || undefined;
const envRegion = process.env.GOOGLE_CLOUD_REGION; 
const defaultServiceName = process.env.DEFAULT_SERVICE_NAME; 
const skipIamCheck = process.env.SKIP_IAM_CHECK !== 'false';

async function getServer () {
  // Create an MCP server with implementation details
  const server = new McpServer({
    name: 'cloud-run',
    version: '1.0.0',
  }, { capabilities: { logging: {} } });

  // Get GCP metadata info once
  const gcpInfo = await checkGCP();

  // Determine the effective project and region based on priority: Env Var > GCP Metadata > Hardcoded default
  const effectiveProjectId = envProjectId || (gcpInfo && gcpInfo.project) || undefined;
  const effectiveRegion = envRegion || (gcpInfo && gcpInfo.region) || 'europe-west1';

  if (shouldStartStdio() || !(gcpInfo && gcpInfo.project)) {
    console.log('Using tools optimized for local or stdio mode.');
    // Pass the determined defaults to the local tool registration
    await registerTools(server, {
      defaultProjectId: effectiveProjectId,
      defaultRegion: effectiveRegion,
      defaultServiceName,
      skipIamCheck
    });
  } else {
    console.log(`Running on GCP project: ${effectiveProjectId}, region: ${effectiveRegion}. Using tools optimized for remote use.`);
    // Pass the determined defaults to the remote tool registration
    await registerToolsRemote(server, {
      defaultProjectId: effectiveProjectId,
      defaultRegion: effectiveRegion,
      defaultServiceName,
      skipIamCheck
    });
  }

  return server;
}

// stdio
if (shouldStartStdio()) {
  const stdioTransport = new StdioServerTransport();
  const server = await getServer();
  await server.connect(stdioTransport);
  console.log('Cloud Run MCP server stdio transport connected');
} else {
  console.log('Running on GCP, stdio transport will not be started.');

  const app = express();
  app.use(express.json());

  app.post('/mcp', async (req, res) => {
    console.log('/mcp Received:', req.body);
    const server = await getServer();
    try {
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
      });
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
      res.on('close', () => {
        console.log('Request closed');
        transport.close();
        server.close();
      });
    } catch (error) {
      console.error('Error handling MCP request:', error);
      if (!res.headersSent) {
        res.status(500).json({
          jsonrpc: '2.0',
          error: {
            code: -32603,
            message: 'Internal server error',
          },
          id: null,
        });
      }
    }
  });

  app.get('/mcp', async (req, res) => {
    console.log('Received GET MCP request');
    res.writeHead(405).end(JSON.stringify({
      jsonrpc: "2.0",
      error: {
        code: -32000,
        message: "Method not allowed."
      },
      id: null
    }));
  });

  app.delete('/mcp', async (req, res) => {
    console.log('Received DELETE MCP request');
    res.writeHead(405).end(JSON.stringify({
      jsonrpc: "2.0",
      error: {
        code: -32000,
        message: "Method not allowed."
      },
      id: null
    }));
  });

  // Support SSE for baackward compatibility
  const sseTransports = {};

  // Legacy SSE endpoint for older clients
  app.get('/sse', async (req, res) => {
    console.log('/sse Received:', req.body);
    const server = await getServer();
    // Create SSE transport for legacy clients
    const transport = new SSEServerTransport('/messages', res);
    sseTransports[transport.sessionId] = transport;
    
    res.on("close", () => {
      delete sseTransports[transport.sessionId];
    });
    
    await server.connect(transport);
  });

  // Legacy message endpoint for older clients
  app.post('/messages', async (req, res) => {
    console.log('/messages Received:', req.body);
    const sessionId = req.query.sessionId;
    const transport = sseTransports[sessionId];
    if (transport) {
      await transport.handlePostMessage(req, res, req.body);
    } else {
      res.status(400).send('No transport found for sessionId');
    }
  });

  // Start the server
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => {
    console.log(`Cloud Run MCP server listening on port ${PORT}`);
  });
}

// Handle server shutdown
process.on('SIGINT', async () => {
  console.log('Shutting down server...');
  process.exit(0);
});