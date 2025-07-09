

import { GoogleAuth } from 'google-auth-library';
import http from 'http';
import https from 'https';
import { URL } from 'url';
import process from 'process';

// Global variables for authentication and token management
let idTokenClient = null;
let cachedIdToken = null;
let tokenRefreshTimeout = null;

const TOKEN_REFRESH_BUFFER_SECONDS = 300; // Refresh token 5 minutes before it expires

// Global variable to accumulate incoming data from stdin
let incomingDataBuffer = '';

/**
 * Fetches an OIDC identity token for the given audience.
 * Caches the token and schedules its refresh.
 * @param {string} audience - The target URL for which the token is being requested.
 * @returns {Promise<string>} The OIDC identity token.
 */
async function getOrRefreshIdToken(audience) {
  if (!idTokenClient) {
    const auth = new GoogleAuth();
    // Use `getIdTokenClient` which automatically handles audience and token refresh logic
    idTokenClient = await auth.getIdTokenClient(audience);
  }

  // If a token is already cached and valid for a reasonable time, return it
  if (cachedIdToken) {
    const decodedToken = decodeJwt(cachedIdToken);
    const expiryTimeMs = decodedToken.exp * 1000;
    if (expiryTimeMs > Date.now() + (TOKEN_REFRESH_BUFFER_SECONDS * 1000)) {
      // Token is still valid for more than the buffer time
      return cachedIdToken;
    }
  }

  // Fetch a new token
  try {
    const newTokenResponse = await idTokenClient.idTokenProvider.fetchIdToken(audience);
    cachedIdToken = newTokenResponse; // The `fetchIdToken` directly returns the token string
    console.error(`mcp-run-proxy: Successfully fetched new OIDC token.`);

    // Decode the token to get its expiration time and schedule a refresh
    const decodedToken = decodeJwt(cachedIdToken);
    const expiresInSeconds = decodedToken.exp - (Date.now() / 1000);

    if (tokenRefreshTimeout) {
      clearTimeout(tokenRefreshTimeout);
    }

    const refreshDelayMs = Math.max(0, (expiresInSeconds - TOKEN_REFRESH_BUFFER_SECONDS) * 1000);
    tokenRefreshTimeout = setTimeout(async () => {
      console.error('mcp-run-proxy: OIDC token nearing expiration, refreshing...');
      // Re-call getOrRefreshIdToken to fetch a new token
      try {
        await getOrRefreshIdToken(audience);
      } catch (refreshError) {
        console.error(`mcp-run-proxy: ERROR refreshing OIDC token: ${refreshError.message}`);
      }
    }, refreshDelayMs);

    return cachedIdToken;
  } catch (error) {
    console.error(`mcp-run-proxy: ERROR fetching OIDC token: ${error.message}`);
    console.error(`Please ensure your local 'gcloud' credentials are set up via 'gcloud auth application-default login',`);
    console.error(`or that the environment variable GOOGLE_APPLICATION_CREDENTIALS points to a valid service account key.`);
    process.exit(1); // Exit if initial token cannot be obtained
  }
}

/**
 * Decodes a JWT token to extract its payload.
 * @param {string} token - The JWT token string.
 * @returns {object} The decoded JWT payload.
 */
function decodeJwt(token) {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) {
      throw new Error('Invalid JWT format');
    }
    const payload = JSON.parse(Buffer.from(parts[1], 'base64').toString('utf8'));
    return payload;
  } catch (error) {
    console.error(`mcp-run-proxy: Error decoding JWT: ${error.message}`);
    throw error;
  }
}

/**
 * Handles incoming data from stdin, proxies it to the target Cloud Run URL
 * with an OIDC token, and streams the response back to stdout.
 * @param {string} targetUrl - The Cloud Run service URL to proxy requests to.
 */
async function startProxy(targetUrl) {
  const parsedUrl = new URL(targetUrl);
  const protocol = parsedUrl.protocol === 'https:' ? https : http;

  // Accumulate all data chunks from stdin
  process.stdin.on('data', (chunk) => {
    incomingDataBuffer += chunk.toString(); // Assuming the stdin payload is UTF-8 JSON
  });

  // When stdin signals it's done sending data (i.e., the Python client's payload is complete)
  process.stdin.on('end', async () => {
    console.error('mcp-run-proxy: stdin closed. Proceeding to send accumulated request to Cloud Run.');

    let idToken;
    try {
      idToken = await getOrRefreshIdToken(targetUrl);
    } catch (error) {
      // Error already logged by getOrRefreshIdToken, it will also exit the process
      return;
    }

    const requestOptions = {
      method: 'POST', // MCP uses post requests
      headers: {
        'Content-Type': 'application/json', // What you are sending
        'Authorization': `Bearer ${idToken}`,
        'Accept': 'application/json',      // What you are willing to receive
        // Set Host header to match the original target URL for Cloud Run
        'Host': parsedUrl.host,
      },
      hostname: parsedUrl.hostname,
      port: parsedUrl.port || (parsedUrl.protocol === 'https:' ? 443 : 80),
      path: parsedUrl.pathname + parsedUrl.search,
    };

    // For debugging, confirm headers and body size
    console.error('mcp-run-proxy: Request headers being sent:', requestOptions.headers);
    console.error('mcp-run-proxy: Request body size (bytes):', Buffer.byteLength(incomingDataBuffer, 'utf8'));

    // Create the single HTTP request to Cloud Run
    const proxyReq = protocol.request(requestOptions, (proxyRes) => {
      let responseBody = '';

      proxyRes.on('data', (d) => {
        responseBody += d.toString(); // Accumulate the response body from Cloud Run
      });

      proxyRes.on('end', () => {
        console.error('mcp-run-proxy: Proxy response from Cloud Run ended. Status:', proxyRes.statusCode);

        try {
          // Assuming Cloud Run server returns a full JSON-RPC response
          const parsedResponse = JSON.parse(responseBody);
          // Write the complete parsed JSON-RPC response to stdout, followed by a newline
          process.stdout.write(JSON.stringify(parsedResponse) + '\n');
        } catch (jsonParseError) {
          console.error(`mcp-run-proxy: Error parsing JSON response from Cloud Run: ${jsonParseError.message}`);
          console.error(`mcp-run-proxy: Raw response body received: ${responseBody}`);
          // Send a structured error back if parsing fails
          process.stdout.write(JSON.stringify({
            jsonrpc: "2.0",
            error: {
              code: -32700, // Parse error
              message: `Proxy received malformed JSON from Cloud Run: ${jsonParseError.message}`,
              data: responseBody // Include raw body for debugging
            },
            id: null
          }) + '\n');
        }

        // End the stdout stream and exit the proxy process after the response is complete
        if (tokenRefreshTimeout) {
          clearTimeout(tokenRefreshTimeout);
        }
        process.exit(0); // Exit after processing one full request/response cycle
      });
    });

    proxyReq.on('error', (e) => {
      console.error(`mcp-run-proxy: Proxy request error to Cloud Run: ${e.message}`);
      // Send error back to stdout in MCP format
      process.stdout.write(JSON.stringify({
        jsonrpc: "2.0",
        error: {
          code: -32000, // Internal error
          message: `Proxy failed to connect to Cloud Run service: ${e.message}`,
        },
        id: null
      }) + '\n'); // Add newline for client's readline()
      if (tokenRefreshTimeout) {
        clearTimeout(tokenRefreshTimeout);
      }
      process.exit(1); // Exit on critical error
    });

    // Write the full accumulated data to the single proxy request and end it
    proxyReq.write(incomingDataBuffer);
    proxyReq.end(); // IMPORTANT: This ends the request *after* all data is written
  });

  process.stdin.on('error', (err) => {
    console.error(`mcp-run-proxy: stdin stream error: ${err.message}`);
    if (tokenRefreshTimeout) {
      clearTimeout(tokenRefreshTimeout);
    }
    process.exit(1);
  });

  console.error(`mcp-run-proxy: Proxy started for: ${targetUrl}. Waiting for stdin input from client.`);
}

// Main execution
(async () => {
  const args = process.argv.slice(2);
  if (args.length !== 1) {
    console.error("Usage: mcp-run-proxy <CLOUD_RUN_SERVICE_URL>");
    process.exit(1);
  }
  const targetCloudRunUrl = args[0];

  // Perform an initial token fetch and ensure we can connect
  await getOrRefreshIdToken(targetCloudRunUrl); // This will exit if no credentials

  startProxy(targetCloudRunUrl);
})();