import { getOAuthClient } from '../clients.js';
import { extractAccessToken } from '../util/helpers.js';

const TOOLS_CALL_METHOD = 'tools/call';

/**
 * Verifies the validity of an access token and checks the audience.
 * @param {string} accessToken - The access token to verify.
 * @param {string} [audience] - Audience to check against the token's audience.
 * @returns {Promise<object>} - The token info if valid.
 * @throws {Error} - If the token is invalid or the audience does not match.
 */
async function verifyAccessToken(accessToken, audience) {
  try {
    console.log('Verifying access token...');
    console.log('Access token:', accessToken);
    const client = await getOAuthClient(accessToken);
    const tokenInfo = await client.getTokenInfo(accessToken);

    //An expired token will not have audience
    if (audience && tokenInfo.aud !== audience) {
      throw new Error(`Invalid audience: expected ${audience}`);
    }

    console.log('Access token verified successfully.');
    return tokenInfo;
  } catch (error) {
    console.error('Error verifying access token:', error);
    throw error;
  }
}

/**
 * Ensures that a valid OAuth token is present in the request headers
 * and verifies it against the configured audience.
 * @param {object} req - The request object.
 * @param {object} res - The response object.
 * @throws {Error} - If the token is missing or invalid.
 */
async function ensureOAuthTokenInEnv(req, res) {
  try {
    const audience = process.env.GOOGLE_OAUTH_AUDIENCE;
    console.log('Verifying token');
    if (req.headers.authorization === undefined) {
      console.log('No authorization header found in request');
      throw new Error('No authorization header');
    }
    console.log('Verifying token: Authorization header found');
    await verifyAccessToken(
      extractAccessToken(req.headers.authorization),
      audience
    );
    console.log('Token verified');
  } catch (error) {
    console.error('Authentication failed: ', error);
    throw error;
  }
}

/**
 * Middleware to check for OAuth token if OAuth is enabled.
 * If OAUTH_ENABLED is 'true', it verifies the Authorization header.
 *
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 */
export const oauthMiddleware = async (req, res, next) => {
  //If OAUTH_ENABLED is not true or the request is not a tools/call, skip the middleware
  if (
    process.env.OAUTH_ENABLED !== 'true' ||
    req.body.method !== TOOLS_CALL_METHOD
  ) {
    return next();
  }

  try {
    await ensureOAuthTokenInEnv(req, res);
    next();
  } catch (error) {
    console.error('OAuth Middleware Error:', error);
    // ensureOAuthTokenInEnv throws an error if auth fails.
    // We catch it and send a 401 response.
    res.status(401).json({
      jsonrpc: '2.0',
      error: {
        code: -32001, // Custom auth error code or standard -32000
        message: 'Authentication failed',
        data: error.message,
      },
      id: null,
    });
  }
};
