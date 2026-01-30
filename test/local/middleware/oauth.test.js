import { describe, it, mock, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import esmock from 'esmock';

describe('oauthMiddleware', () => {
  let req;
  let res;
  let next;
  let originalEnv;

  beforeEach(() => {
    originalEnv = process.env;
    process.env = { ...originalEnv };
    req = {
      headers: {},
      body: {},
    };
    res = {
      headersSent: false,
      status: mock.fn(() => res),
      json: mock.fn(),
    };
    next = mock.fn();
  });

  afterEach(() => {
    process.env = originalEnv;
    mock.restoreAll();
  });

  it('should call next() if OAUTH_ENABLED is not "true"', async () => {
    process.env.OAUTH_ENABLED = 'false';
    const { oauthMiddleware } = await esmock('../../../lib/middleware/oauth.js', {});

    await oauthMiddleware(req, res, next);

    assert.strictEqual(next.mock.callCount(), 1);
    assert.strictEqual(res.status.mock.callCount(), 0);
  });

  it('should call next() if method is not tools/call', async () => {
    process.env.OAUTH_ENABLED = 'true';
    req.body.method = 'other/method';
    
    // We don't verify token if it's not a tool call (based on current implementation)
    // So we don't need to mock successful verification here
    const { oauthMiddleware } = await esmock('../../../lib/middleware/oauth.js', {});

    await oauthMiddleware(req, res, next);

    assert.strictEqual(next.mock.callCount(), 1);
  });

  it('should return 401 if Authorization header is missing for tool call', async () => {
    process.env.OAUTH_ENABLED = 'true';
    req.body.method = 'tools/call';
    
    const { oauthMiddleware } = await esmock('../../../lib/middleware/oauth.js', {});

    await oauthMiddleware(req, res, next);

    assert.strictEqual(next.mock.callCount(), 0);
    assert.strictEqual(res.status.mock.callCount(), 1);
    assert.deepStrictEqual(res.status.mock.calls[0].arguments, [401]);
    assert.strictEqual(res.json.mock.callCount(), 1);
  });

  it('should verify token and call next() for valid tool call', async () => {
    process.env.OAUTH_ENABLED = 'true';
    req.body.method = 'tools/call';
    req.headers.authorization = 'Bearer valid-token';

    const mockGetTokenInfo = mock.fn(async () => ({ aud: 'valid-audience' }));
    const mockGetOAuthClient = mock.fn(async () => ({
      getTokenInfo: mockGetTokenInfo,
    }));

    const { oauthMiddleware } = await esmock('../../../lib/middleware/oauth.js', {
      '../../../lib/clients.js': {
        getOAuthClient: mockGetOAuthClient,
      },
    });

    await oauthMiddleware(req, res, next);

    assert.strictEqual(next.mock.callCount(), 1);
    assert.strictEqual(mockGetOAuthClient.mock.callCount(), 1);
    assert.strictEqual(mockGetTokenInfo.mock.callCount(), 1);
  });

  it('should return 401 if token verification fails', async () => {
    process.env.OAUTH_ENABLED = 'true';
    req.body.method = 'tools/call';
    req.headers.authorization = 'Bearer invalid-token';

    const mockGetOAuthClient = mock.fn(async () => ({
      getTokenInfo: async () => { throw new Error('Invalid token'); },
    }));

    const { oauthMiddleware } = await esmock('../../../lib/middleware/oauth.js', {
      '../../../lib/clients.js': {
        getOAuthClient: mockGetOAuthClient,
      },
    });

    await oauthMiddleware(req, res, next);

    assert.strictEqual(next.mock.callCount(), 0);
    assert.strictEqual(res.status.mock.callCount(), 1);
    assert.deepStrictEqual(res.status.mock.calls[0].arguments, [401]);
  });

  it('should return 401 if audience does not match', async () => {
    process.env.OAUTH_ENABLED = 'true';
    process.env.GOOGLE_OAUTH_AUDIENCE = 'expected-audience';
    req.body.method = 'tools/call';
    req.headers.authorization = 'Bearer valid-token-wrong-audience';

    const mockGetTokenInfo = mock.fn(async () => ({ aud: 'wrong-audience' }));
    const mockGetOAuthClient = mock.fn(async () => ({
      getTokenInfo: mockGetTokenInfo,
    }));

    const { oauthMiddleware } = await esmock('../../../lib/middleware/oauth.js', {
      '../../../lib/clients.js': {
        getOAuthClient: mockGetOAuthClient,
      },
    });

    await oauthMiddleware(req, res, next);

    assert.strictEqual(next.mock.callCount(), 0);
    assert.strictEqual(res.status.mock.callCount(), 1);
    assert.deepStrictEqual(res.status.mock.calls[0].arguments, [401]);
  });
});
