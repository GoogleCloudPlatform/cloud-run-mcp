import assert from 'node:assert/strict';
import { describe, it, mock } from 'node:test';
import esmock from 'esmock';

describe('triggerCloudBuild', () => {
  it('should return a successful build and log correct messages', async () => {
    const mockBuildId = 'mock-build-id';
    const mockSuccessResult = {
      id: mockBuildId,
      status: 'SUCCESS',
      results: { images: [{ name: 'gcr.io/mock-project/mock-image' }] },
    };

    const getBuildMock = mock.fn(() => Promise.resolve([mockSuccessResult]));
    const logAndProgressMock = mock.fn();

    const { triggerCloudBuild } = await esmock(
      '../../../lib/cloud-api/build.js',
      {
        '../../../lib/cloud-api/helpers.js': {
          callWithRetry: (fn) => fn(), // Directly execute the function
        },
        '../../../lib/util/helpers.js': {
          logAndProgress: logAndProgressMock,
        },
      }
    );

    const context = {
      cloudBuildClient: {
        createBuild: mock.fn(() =>
          Promise.resolve([
            {
              metadata: {
                build: {
                  id: mockBuildId,
                },
              },
            },
          ])
        ),
        getBuild: getBuildMock,
      },
    };

    const result = await triggerCloudBuild(
      context,
      'mock-project',
      'mock-location',
      'mock-bucket',
      'mock-blob',
      'mock-repo',
      'gcr.io/mock-project/mock-image',
      true,
      () => {}
    );

    assert.deepStrictEqual(result, mockSuccessResult);
    assert.strictEqual(
      context.cloudBuildClient.createBuild.mock.callCount(),
      1
    );
    assert.strictEqual(context.cloudBuildClient.getBuild.mock.callCount(), 1);

    const { calls: logCalls } = logAndProgressMock.mock;
    assert.match(logCalls[0].arguments[0], /Initiating Cloud Build/);
    assert.match(logCalls[1].arguments[0], /Cloud Build job started/);
    assert.match(logCalls[2].arguments[0], /completed successfully/);
    assert.match(logCalls[3].arguments[0], /Image built/);
  });

  it('should throw an error for a failed build and log correct messages', async () => {
    const mockBuildId = 'mock-build-id-failure';
    const mockFailureResult = {
      id: mockBuildId,
      status: 'FAILURE',
      logUrl: 'http://mock-log-url.com',
    };

    const getBuildMock = mock.fn(() => Promise.resolve([mockFailureResult]));
    const logAndProgressMock = mock.fn();
    const setTimeoutMock = mock.fn((resolve) => resolve());
    mock.method(global, 'setTimeout', setTimeoutMock);

    const { triggerCloudBuild } = await esmock(
      '../../../lib/cloud-api/build.js',
      {
        '../../../lib/cloud-api/helpers.js': {
          callWithRetry: (fn) => fn(),
        },
        '../../../lib/util/helpers.js': {
          logAndProgress: logAndProgressMock,
        },
      }
    );

    const context = {
      cloudBuildClient: {
        createBuild: mock.fn(() =>
          Promise.resolve([
            {
              metadata: {
                build: {
                  id: mockBuildId,
                },
              },
            },
          ])
        ),
        getBuild: getBuildMock,
      },
      loggingClient: {
        getEntries: mock.fn(() =>
          Promise.resolve([[{ data: 'log line 1' }, { data: 'log line 2' }]])
        ),
      },
    };

    await assert.rejects(
      () =>
        triggerCloudBuild(
          context,
          'mock-project',
          'mock-location',
          'mock-bucket',
          'mock-blob',
          'mock-repo',
          'gcr.io/mock-project/mock-image',
          true,
          () => {}
        ),
      (err) => {
        assert.match(err.message, /Build mock-build-id-failure failed/);
        assert.match(err.message, /log line 1/);
        assert.match(err.message, /log line 2/);
        return true;
      }
    );

    assert.strictEqual(
      context.cloudBuildClient.createBuild.mock.callCount(),
      1
    );
    assert.strictEqual(context.cloudBuildClient.getBuild.mock.callCount(), 1);
    assert.strictEqual(context.loggingClient.getEntries.mock.callCount(), 1);
    assert.strictEqual(setTimeoutMock.mock.callCount(), 1);
    assert.strictEqual(setTimeoutMock.mock.calls[0].arguments[1], 10000);

    const { calls: logCalls } = logAndProgressMock.mock;
    assert.match(logCalls[0].arguments[0], /Initiating Cloud Build/);
    assert.match(logCalls[1].arguments[0], /Cloud Build job started/);
    assert.match(logCalls[2].arguments[0], /failed with status: FAILURE/);
    assert.match(logCalls[3].arguments[0], /Build logs:/);
    assert.match(logCalls[4].arguments[0], /Attempting to fetch last/);
    assert.match(logCalls[5].arguments[0], /Successfully fetched snippet/);
  });

  it('should use buildpacks when no Dockerfile is present', async () => {
    const mockBuildId = 'mock-build-id-buildpacks';
    const mockSuccessResult = {
      id: mockBuildId,
      status: 'SUCCESS',
      results: { images: [{ name: 'gcr.io/mock-project/mock-image' }] },
    };

    const getBuildMock = mock.fn(() => Promise.resolve([mockSuccessResult]));
    const createBuildMock = mock.fn(() =>
      Promise.resolve([
        {
          metadata: {
            build: {
              id: mockBuildId,
            },
          },
        },
      ])
    );

    const { triggerCloudBuild } = await esmock(
      '../../../lib/cloud-api/build.js',
      {
        '../../../lib/cloud-api/helpers.js': {
          callWithRetry: (fn) => fn(),
        },
        '../../../lib/util/helpers.js': {
          logAndProgress: () => {},
        },
      }
    );

    const context = {
      cloudBuildClient: {
        createBuild: createBuildMock,
        getBuild: getBuildMock,
      },
    };

    await triggerCloudBuild(
      context,
      'mock-project',
      'mock-location',
      'mock-bucket',
      'mock-blob',
      'mock-repo',
      'gcr.io/mock-project/mock-image',
      false, // hasDockerfile = false
      () => {}
    );

    assert.strictEqual(createBuildMock.mock.callCount(), 1);
    const buildArg = createBuildMock.mock.calls[0].arguments[0].build;
    const buildStep = buildArg.steps[0];
    assert.strictEqual(buildStep.name, 'gcr.io/k8s-skaffold/pack');
  });

  it('should poll for build status until completion', async () => {
    const mockBuildId = 'mock-build-id-polling';
    const mockWorkingResult = { id: mockBuildId, status: 'WORKING' };
    const mockSuccessResult = {
      id: mockBuildId,
      status: 'SUCCESS',
      results: { images: [{ name: 'gcr.io/mock-project/mock-image' }] },
    };

    let getBuildCallCount = 0;
    const getBuildMock = mock.fn(() => {
      getBuildCallCount++;
      if (getBuildCallCount === 1) {
        return Promise.resolve([mockWorkingResult]);
      }
      return Promise.resolve([mockSuccessResult]);
    });

    const logAndProgressMock = mock.fn();
    const setTimeoutMock = mock.fn((resolve) => resolve());
    mock.method(global, 'setTimeout', setTimeoutMock);

    const { triggerCloudBuild } = await esmock(
      '../../../lib/cloud-api/build.js',
      {
        '../../../lib/cloud-api/helpers.js': {
          callWithRetry: (fn) => fn(),
        },
        '../../../lib/util/helpers.js': {
          logAndProgress: logAndProgressMock,
        },
      }
    );

    const context = {
      cloudBuildClient: {
        createBuild: mock.fn(() =>
          Promise.resolve([
            {
              metadata: {
                build: {
                  id: mockBuildId,
                },
              },
            },
          ])
        ),
        getBuild: getBuildMock,
      },
    };

    await triggerCloudBuild(
      context,
      'mock-project',
      'mock-location',
      'mock-bucket',
      'mock-blob',
      'mock-repo',
      'gcr.io/mock-project/mock-image',
      true,
      () => {}
    );

    assert.strictEqual(getBuildMock.mock.callCount(), 2);
    assert.strictEqual(setTimeoutMock.mock.callCount(), 1);
    assert.strictEqual(setTimeoutMock.mock.calls[0].arguments[1], 5000);
    const { calls: logCalls } = logAndProgressMock.mock;
    assert.match(logCalls[0].arguments[0], /Initiating Cloud Build/);
    assert.match(logCalls[1].arguments[0], /Cloud Build job started/);
    assert.match(logCalls[2].arguments[0], /Build status: WORKING/);
    assert.match(logCalls[3].arguments[0], /completed successfully/);
    assert.match(logCalls[4].arguments[0], /Image built/);
  });

  it('should handle failed build when no logs are found', async () => {
    const mockBuildId = 'mock-build-id-no-logs';
    const mockFailureResult = {
      id: mockBuildId,
      status: 'FAILURE',
      logUrl: 'http://mock-log-url.com',
    };

    const getBuildMock = mock.fn(() => Promise.resolve([mockFailureResult]));
    const logAndProgressMock = mock.fn();

    const { triggerCloudBuild } = await esmock(
      '../../../lib/cloud-api/build.js',
      {
        '../../../lib/cloud-api/helpers.js': {
          callWithRetry: (fn) => fn(),
        },
        '../../../lib/util/helpers.js': {
          logAndProgress: logAndProgressMock,
        },
      }
    );

    const context = {
      cloudBuildClient: {
        createBuild: mock.fn(() =>
          Promise.resolve([
            {
              metadata: {
                build: {
                  id: mockBuildId,
                },
              },
            },
          ])
        ),
        getBuild: getBuildMock,
      },
      loggingClient: {
        getEntries: mock.fn(() => Promise.resolve([[]])), // No log entries
      },
    };

    await assert.rejects(
      () =>
        triggerCloudBuild(
          context,
          'mock-project',
          'mock-location',
          'mock-bucket',
          'mock-blob',
          'mock-repo',
          'gcr.io/mock-project/mock-image',
          true,
          () => {}
        ),
      (err) => {
        assert.match(err.message, /Build mock-build-id-no-logs failed/);
        assert.doesNotMatch(err.message, /Last log lines/);
        return true;
      }
    );

    const { calls: logCalls } = logAndProgressMock.mock;
    assert.match(logCalls[0].arguments[0], /Initiating Cloud Build/);
    assert.match(logCalls[1].arguments[0], /Cloud Build job started/);
    assert.match(logCalls[2].arguments[0], /failed with status: FAILURE/);
    assert.match(logCalls[3].arguments[0], /Build logs:/);
    assert.match(logCalls[4].arguments[0], /Attempting to fetch last/);
    assert.match(logCalls[5].arguments[0], /No specific log entries retrieved/);
  });

  it('should handle error when fetching logs for a failed build', async () => {
    const mockBuildId = 'mock-build-id-log-error';
    const mockFailureResult = {
      id: mockBuildId,
      status: 'FAILURE',
      logUrl: 'http://mock-log-url.com',
    };

    const getBuildMock = mock.fn(() => Promise.resolve([mockFailureResult]));
    const logAndProgressMock = mock.fn();

    const { triggerCloudBuild } = await esmock(
      '../../../lib/cloud-api/build.js',
      {
        '../../../lib/cloud-api/helpers.js': {
          callWithRetry: (fn) => fn(),
        },
        '../../../lib/util/helpers.js': {
          logAndProgress: logAndProgressMock,
        },
      }
    );

    const context = {
      cloudBuildClient: {
        createBuild: mock.fn(() =>
          Promise.resolve([
            {
              metadata: {
                build: {
                  id: mockBuildId,
                },
              },
            },
          ])
        ),
        getBuild: getBuildMock,
      },
      loggingClient: {
        getEntries: mock.fn(() => Promise.reject(new Error('Log fetch error'))),
      },
    };

    await assert.rejects(
      () =>
        triggerCloudBuild(
          context,
          'mock-project',
          'mock-location',
          'mock-bucket',
          'mock-blob',
          'mock-repo',
          'gcr.io/mock-project/mock-image',
          true,
          () => {}
        ),
      (err) => {
        assert.match(err.message, /Build mock-build-id-log-error failed/);
        assert.doesNotMatch(err.message, /Last log lines/);
        return true;
      }
    );

    const { calls: logCalls } = logAndProgressMock.mock;
    assert.match(logCalls[0].arguments[0], /Initiating Cloud Build/);
    assert.match(logCalls[1].arguments[0], /Cloud Build job started/);
    assert.match(logCalls[2].arguments[0], /failed with status: FAILURE/);
    assert.match(logCalls[3].arguments[0], /Build logs:/);
    assert.match(logCalls[4].arguments[0], /Attempting to fetch last/);
    assert.match(
      logCalls[5].arguments[0],
      /Failed to fetch build logs snippet/
    );
  });
});
