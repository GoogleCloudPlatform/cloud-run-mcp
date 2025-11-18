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
import session from 'express-session';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { requireBearerAuth } from "@modelcontextprotocol/sdk/server/auth/middleware/bearerAuth.js";
import {
  mcpAuthMetadataRouter,
  getOAuthProtectedResourceMetadataUrl,
} from "@modelcontextprotocol/sdk/server/auth/router.js";
// Support SSE for backward compatibility
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
// Support stdio, as it is easier to use locally
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { registerTools, registerToolsRemote } from './tools/tools.js';
import { SetLevelRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { registerPrompts } from './prompts.js';
import { checkGCP } from './lib/cloud-api/metadata.js';
import { ensureGCPCredentials, oauth2Client } from './lib/cloud-api/auth.js';
import 'dotenv/config';

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

const HTTP_REDIRECT = 301;
const SIGN_IN_SUCCESS_URL =
  'https://cloud.google.com/sdk/auth_success';
const SIGN_IN_FAILURE_URL =
  'https://cloud.google.com/sdk/auth_failure';


async function ensureOAuthTokenInEnv(req, res) {
  try {
    console.log('Verifying token');
    if(req.headers.authorization===undefined) throw new Error('No authorization header');
    console.log('Verifying token: Authorization header found');
    verifyToken(req.headers.authorization.split(' ')[1]);

  } catch (error) {
    console.error('Authentication failed:', error);
    res.status(401)
    .set('WWW-Authenticate', 'Bearer realm="OAuth", resource_metadata="http://localhost:8080/.well-known/oauth-protected-resource"')
    .json({
      jsonrpc: '2.0',
      error: {
        code: -32600,
        message: 'Unauthorized',
      },
      id: null
    });
    console.log(res);
    return res;
  };
}

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

async function verifyToken(token) {
      try {
        const {tokens} = await oauth2Client.getToken(code);
        console.log('Obtained tokens:', tokens);
        const ticket = await oauth2Client.verifyIdToken({
          idToken: tokens.id_token,
          audience: '764086051850-6qr4p6gpi6hn506pt8ejuq83di341hur.apps.googleusercontent.com',
        });
        const payload = ticket.getPayload(); 
        console.log('User authenticated:', payload);
      } catch (error) {
        console.error('Error verifying token:', error);
        throw new Error('Invalid ID token');
      }
    }

const mcpPostHandler = async (req, res) => {
  console.log('/mcp POST Received:', req.body);
  if(req.body.method === 'tools/call') {
    await ensureOAuthTokenInEnv(req, res);
  }
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
  //gcpCredentialsAvailable = await ensureGCPCredentials();
  gcpCredentialsAvailable = false;
  const app = express();
  app.use(express.json());
  //app.use(session({
  //  secret:process.env.SESSION_SECRET,
  //  resave:false,
  //  saveUninitialized:true,
  //}));

  app.get('/.well-known/oauth-protected-resource', (req, res) => {
    console.log('Call to well-known/oauth-protected-resource received');
    res.json(
      {
        resource: "http://localhost:8080/mcp",
        authorization_servers: [
          "http://localhost:8080/auth/google"
        ],
        authorization_endpoint: "http://localhost:8080/auth/google",
        scopes_supported: [
          "openid",
          "https://www.googleapis.com/auth/userinfo.email"
        ],
        bearer_methods_supported: [
          "header"
        ]
      }
    );
    res.status(200).send();
  });

  app.get('/authorize', async (req, res) => {
    console.log('Initiating Google OAuth2 flow');
    const authUrl = oauth2Client.generateAuthUrl({
      access_type: 'offline',
      scope: [
        'openid',
        'https://www.googleapis.com/auth/userinfo.email',
        'https://www.googleapis.com/auth/cloud-platform',
        'https://www.googleapis.com/auth/appengine.admin',
        'https://www.googleapis.com/auth/sqlservice.login',
        'https://www.googleapis.com/auth/compute',
        'https://www.googleapis.com/auth/accounts.reauth',
      ],
    });
    //res.redirect(authUrl);
    console.log('Redirecting to:', authUrl);
    res.writeHead(HTTP_REDIRECT, { Location: authUrl });
    res.end();
    return Promise.resolve();
  });

  app.get('/google/oauth/callback', async (req, res) => {
    console.log('OAuth2 callback received');
    console.log('Query parameters:', req.query);
    console.log('Response object:', res);
    const code = req.query.code;

    try {
      const {tokens} = await oauth2Client.getToken(code);
      console.log('Obtained tokens:', tokens);
      const ticket = await oauth2Client.verifyIdToken({
        idToken: tokens.id_token,
        audience: '764086051850-6qr4p6gpi6hn506pt8ejuq83di341hur.apps.googleusercontent.com',
      });
      oauth2Client.setCredentials(tokens);
      const payload = ticket.getPayload(); 
      console.log('User authenticated:', payload);
      res.writeHead(HTTP_REDIRECT, { Location: SIGN_IN_SUCCESS_URL });
      res.end();
      return Promise.resolve();
    } catch (error) {
      res.writeHead(HTTP_REDIRECT, { Location: SIGN_IN_FAILURE_URL });
      console.error(
        `ERROR: Oauth2 callback processing failed: ${error.message}`
      );
      res.end();
      return Promise.reject(error);
    }
    //res.end();
    //res.send('Authentication successful! You can close this window.')
  });

  app.post('/mcp', mcpPostHandler);

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
