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

import { createMcpExpressApp } from '@modelcontextprotocol/sdk/server/express.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
// Support SSE for backward compatibility
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
// Support stdio, as it is easier to use locally
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { registerTools, registerToolsRemote } from './tools/tools.js';
import { SetLevelRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { registerPrompts } from './prompts.js';
import { checkGCP } from './lib/cloud-api/metadata.js';
import { ensureGCPCredentials } from './lib/cloud-api/auth.js';
import '@dotenvx/dotenvx/config';
import {
  SCOPES,
  BEARER_METHODS_SUPPORTED,
  RESPONSE_TYPES_SUPPORTED,
} from './constants.js';

const gcpInfo = await checkGCP();
let gcpCredentialsAvailable = false;

/**
 * Ensure that console.log and console.error are compatible with stdio.
 * (Right now, it just disables them)
 */
function makeLoggingCompatibleWithStdio() {
  // redirect all console.log (which usually go to to stdout) to stderr.
  console.log = console.error;
}

function shouldStartStdio() {
  if (process.env.GCP_STDIO === 'false' || (gcpInfo && gcpInfo.project)) {
    return false;
  }
  return true;
}

if (shouldStartStdio()) {
  makeLoggingCompatibleWithStdio();
}

// Read default configurations from environment variables
const envProjectId = process.env.GOOGLE_CLOUD_PROJECT || undefined;
const envRegion = process.env.GOOGLE_CLOUD_REGION;
const defaultServiceName = process.env.DEFAULT_SERVICE_NAME;
const skipIamCheck = process.env.SKIP_IAM_CHECK !== 'false';
const enableHostValidation = process.env.ENABLE_HOST_VALIDATION === 'true';
const allowedHosts = process.env.ALLOWED_HOSTS
  ? process.env.ALLOWED_HOSTS.split(',')
  : undefined;

async function getServer() {
  // Create an MCP server with implementation details
  const server = new McpServer(
    {
      name: 'cloud-run',
      version: '1.0.0',
    },
    { capabilities: { logging: {} } }
  );

  // this is no-op handler is required for mcp-inspector to function due to a mismatch between the SDK mcp-inspector
  server.server.setRequestHandler(SetLevelRequestSchema, (request) => {
    console.log(`Log Level: ${request.params.level}`);
    return {};
  });

  // Get GCP metadata info once
  const gcpInfo = await checkGCP();

  // Determine the effective project and region based on priority: Env Var > GCP Metadata > Hardcoded default
  const effectiveProjectId =
    envProjectId || (gcpInfo && gcpInfo.project) || undefined;
  const effectiveRegion =
    envRegion || (gcpInfo && gcpInfo.region) || 'europe-west1';

  if (shouldStartStdio() || !(gcpInfo && gcpInfo.project)) {
    console.log('Using tools optimized for local or stdio mode.');
    // Pass the determined defaults to the local tool registration
    await registerTools(server, {
      defaultProjectId: effectiveProjectId,
      defaultRegion: effectiveRegion,
      defaultServiceName,
      skipIamCheck,
      gcpCredentialsAvailable,
    });
  } else {
    console.log(
      `Running on GCP project: ${effectiveProjectId}, region: ${effectiveRegion}. Using tools optimized for remote use.`
    );
    // Pass the determined defaults to the remote tool registration
    await registerToolsRemote(server, {
      defaultProjectId: effectiveProjectId,
      defaultRegion: effectiveRegion,
      defaultServiceName,
      skipIamCheck,
      gcpCredentialsAvailable,
    });
  }

  // Register prompts with the server
  registerPrompts(server);

  return server;
}

const getOAuthProtectedResource = (req, res) => {
  console.log('Call to well-known/oauth-protected-resource received');
  res.json({
    resource: process.env.OAUTH_PROTECTED_RESOURCE,
    authorization_servers: [process.env.OAUTH_AUTHORIZATION_SERVER],
    scopes_supported: [SCOPES.OPENID, SCOPES.EMAIL, SCOPES.CLOUD_PLATFORM],
    bearer_methods_supported: [...BEARER_METHODS_SUPPORTED],
  });
  res.status(200).send();
};

const getOAuthAuthorizationServer = (req, res) => {
  console.log('Call to well-known/oauth-authorization-server received');
  res.json({
    issuer: process.env.OAUTH_PROTECTED_RESOURCE,
    authorization_endpoint: process.env.OAUTH_AUTHORIZATION_ENDPOINT,
    token_endpoint: process.env.OAUTH_TOKEN_ENDPOINT,
    scopes_supported: [SCOPES.OPENID, SCOPES.EMAIL, SCOPES.CLOUD_PLATFORM],
    response_types_supported: [...RESPONSE_TYPES_SUPPORTED],
  });
  res.status(200).send();
};

// stdio
if (shouldStartStdio()) {
  gcpCredentialsAvailable = await ensureGCPCredentials();
  const stdioTransport = new StdioServerTransport();
  const server = await getServer();
  await server.connect(stdioTransport);
  console.log('Cloud Run MCP server stdio transport connected');
} else {
  // non-stdio mode
  console.log('Stdio transport mode is turned off.');
  gcpCredentialsAvailable = await ensureGCPCredentials();

  const app = enableHostValidation
    ? createMcpExpressApp({ allowedHosts })
    : createMcpExpressApp({ host: null });

  if (!enableHostValidation) {
    console.warn(
      `Warning: Server is running without DNS rebinding protection. ` +
        'Consider enabling host validation by passing env variable ENABLE_HOST_VALIDATION=true and adding the ALLOWED_HOSTS to restrict allowed hosts'
    );
  }

  app.get('/.well-known/oauth-protected-resource', getOAuthProtectedResource);

  app.get(
    '/.well-known/oauth-authorization-server',
    getOAuthAuthorizationServer
  );

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
    res.writeHead(405).end(
      JSON.stringify({
        jsonrpc: '2.0',
        error: {
          code: -32000,
          message: 'Method not allowed.',
        },
        id: null,
      })
    );
  });

  app.delete('/mcp', async (req, res) => {
    console.log('Received DELETE MCP request');
    res.writeHead(405).end(
      JSON.stringify({
        jsonrpc: '2.0',
        error: {
          code: -32000,
          message: 'Method not allowed.',
        },
        id: null,
      })
    );
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

    res.on('close', () => {
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
