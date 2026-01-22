import assert from 'node:assert/strict';
import { describe, it, mock, beforeEach, afterEach } from 'node:test';
import esmock from 'esmock';

describe('triggerCloudBuild', () => {
  const mockBuildId = 'mock-build-id';
  // bW9jay1idWlsZC1pZA== is Buffer.from('mock-build-id').toString('base64')
  const base64BuildId = 'bW9jay1idWlsZC1pZA==';
  const goodSubmitBuildResponse = [
    {
      buildOperation: {
        name: `projects/mock-project/locations/mock-location/operations/${base64BuildId}`,
      },
    },
  ];
  const mockSuccessResult = {
    id: mockBuildId,
    status: 'SUCCESS',
    results: { images: [{ name: 'gcr.io/mock-project/mock-image' }] },
  };
  const mockFailureResult = {
    id: mockBuildId,
    status: 'FAILURE',
    logUrl: 'http://mock-log-url.com',
    results: { images: [{ name: 'gcr.io/mock-project/mock-image' }] },
  };

  let logAndProgressMock;
  let getServiceMock;
  let createServiceMock;
  let updateServiceMock;
  let servicePathMock;
  let locationPathMock;
  let submitBuildMock;
  let getBuildMock;
  let getEntriesMock;
  let context;
  let setTimeoutMock;
  let checkServiceMock;

  beforeEach(() => {
    logAndProgressMock = mock.fn();
    checkServiceMock = mock.fn(() => Promise.resolve(false));
    getServiceMock = mock.fn(() => Promise.reject({ code: 5 })); // Default: service not found
    createServiceMock = mock.fn(() => Promise.resolve());
    updateServiceMock = mock.fn(() => Promise.resolve());
    servicePathMock = mock.fn(
      (projectId, location, serviceId) =>
        `projects/${projectId}/locations/${location}/services/${serviceId}`
    );
    locationPathMock = mock.fn(
      (projectId, location) => `projects/${projectId}/locations/${location}`
    );
    submitBuildMock = mock.fn(() => Promise.resolve(goodSubmitBuildResponse));
    getBuildMock = mock.fn(() => Promise.resolve([mockSuccessResult]));
    getEntriesMock = mock.fn(() =>
      Promise.resolve([[{ data: 'log line 1' }, { data: 'log line 2' }]])
    );
    setTimeoutMock = mock.fn((cb) => cb());
    mock.method(global, 'setTimeout', setTimeoutMock);

    context = {
      runClient: {
        getService: getServiceMock,
        createService: createServiceMock,
        updateService: updateServiceMock,
        servicePath: servicePathMock,
        locationPath: locationPathMock,
      },
      buildsClient: {
        submitBuild: submitBuildMock,
      },
      cloudBuildClient: {
        getBuild: getBuildMock,
      },
      loggingClient: {
        getEntries: getEntriesMock,
      },
    };
  });

  afterEach(() => {
    mock.restoreAll();
  });

  async function getTriggerCloudBuild() {
    return await esmock('../../../lib/cloud-api/build.js', {
      '../../../lib/cloud-api/helpers.js': {
        callWithRetry: (fn) => fn(),
      },
      '../../../lib/util/helpers.js': {
        logAndProgress: logAndProgressMock,
      },
      '../../../lib/cloud-api/run.js': {
        checkCloudRunServiceExists: checkServiceMock,
      },
      '../../../lib/clients.js': {
        getRunClient: () => Promise.resolve(context.runClient),
        getBuildsClient: () => Promise.resolve(context.buildsClient),
        getCloudBuildClient: () => Promise.resolve(context.cloudBuildClient),
        getLoggingClient: () => Promise.resolve(context.loggingClient),
      },
    });
  }

  it('should run successfully and create service when service does not exist', async () => {
    const { triggerCloudBuild } = await getTriggerCloudBuild();
    const result = await triggerCloudBuild(
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
    assert.strictEqual(checkServiceMock.mock.callCount(), 1);
    assert.strictEqual(submitBuildMock.mock.callCount(), 1);
    assert.strictEqual(getBuildMock.mock.callCount(), 1);
    assert.strictEqual(createServiceMock.mock.callCount(), 1); // 1 dry run
    assert.strictEqual(updateServiceMock.mock.callCount(), 0);

    const { calls: logCalls } = logAndProgressMock.mock;
    assert.match(logCalls[0].arguments[0], /Performing dry-run creation/);
    assert.match(logCalls[1].arguments[0], /Dry-run validation successful/);
    assert.match(logCalls[2].arguments[0], /Initiating Cloud Build/);
    assert.match(logCalls[3].arguments[0], /Cloud Build job started/);
    assert.match(logCalls[4].arguments[0], /completed successfully/);
    assert.match(logCalls[5].arguments[0], /Image built/);
  });

  it('should run successfully and update service when service exists', async () => {
    checkServiceMock.mock.mockImplementation(() => Promise.resolve(true));
    const { triggerCloudBuild } = await getTriggerCloudBuild();
    await triggerCloudBuild(
      'mock-project',
      'mock-location',
      'mock-bucket',
      'mock-blob',
      'mock-repo',
      'gcr.io/mock-project/mock-image',
      true,
      () => {}
    );

    assert.strictEqual(checkServiceMock.mock.callCount(), 1);
    assert.strictEqual(submitBuildMock.mock.callCount(), 1);
    assert.strictEqual(getBuildMock.mock.callCount(), 1);
    assert.strictEqual(createServiceMock.mock.callCount(), 0);
    assert.strictEqual(updateServiceMock.mock.callCount(), 1); // 1 dry run
    const { calls: logCalls } = logAndProgressMock.mock;
    assert.match(logCalls[0].arguments[0], /Performing dry-run update/);
  });

  it('should use buildpacks when no Dockerfile is present', async () => {
    const { triggerCloudBuild } = await getTriggerCloudBuild();
    const result = await triggerCloudBuild(
      'mock-project',
      'mock-location',
      'mock-bucket',
      'mock-blob',
      'mock-repo',
      'gcr.io/mock-project/mock-image',
      false,
      () => {}
    );

    assert.deepStrictEqual(result, mockSuccessResult);
    assert.strictEqual(submitBuildMock.mock.callCount(), 1);
    const submitBuildRequest = submitBuildMock.mock.calls[0].arguments[0];
    assert.deepStrictEqual(submitBuildRequest.buildpackBuild, {});
    assert.strictEqual(submitBuildRequest.dockerBuild, undefined);
  });

  it('should use docker build when Dockerfile is present', async () => {
    const { triggerCloudBuild } = await getTriggerCloudBuild();
    await triggerCloudBuild(
      'mock-project',
      'mock-location',
      'mock-bucket',
      'mock-blob',
      'mock-repo',
      'gcr.io/mock-project/mock-image',
      true, // hasDockerfile = true
      () => {}
    );

    assert.strictEqual(submitBuildMock.mock.callCount(), 1);
    const submitBuildRequest = submitBuildMock.mock.calls[0].arguments[0];
    assert.deepStrictEqual(submitBuildRequest.dockerBuild, {});
    assert.strictEqual(submitBuildRequest.buildpackBuild, undefined);
  });

  it('should poll for build status until completion', async () => {
    const mockWorkingResult = { id: mockBuildId, status: 'WORKING' };
    let getBuildCallCount = 0;
    getBuildMock = mock.fn(() => {
      getBuildCallCount++;
      if (getBuildCallCount === 1) {
        return Promise.resolve([mockWorkingResult]);
      }
      return Promise.resolve([mockSuccessResult]);
    });
    context.cloudBuildClient.getBuild = getBuildMock;

    const { triggerCloudBuild } = await getTriggerCloudBuild();
    await triggerCloudBuild(
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
    assert.match(logCalls[4].arguments[0], /Build status: WORKING/);
    assert.match(logCalls[5].arguments[0], /completed successfully/);
  });

  it('should throw an error for a failed build and fetch logs', async () => {
    getBuildMock = mock.fn(() => Promise.resolve([mockFailureResult]));
    context.cloudBuildClient.getBuild = getBuildMock;

    const { triggerCloudBuild } = await getTriggerCloudBuild();
    await assert.rejects(
      () =>
        triggerCloudBuild(
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
        assert.match(err.message, /Build mock-build-id failed/);
        assert.match(err.message, /log line 1/);
        assert.match(err.message, /log line 2/);
        return true;
      }
    );

    assert.strictEqual(getBuildMock.mock.callCount(), 1);
    assert.strictEqual(getEntriesMock.mock.callCount(), 1);
    assert.strictEqual(setTimeoutMock.mock.callCount(), 1);
    assert.strictEqual(setTimeoutMock.mock.calls[0].arguments[1], 10000);

    const { calls: logCalls } = logAndProgressMock.mock;
    assert.match(logCalls[4].arguments[0], /failed with status: FAILURE/);
    assert.match(logCalls[5].arguments[0], /Build logs:/);
    assert.match(logCalls[6].arguments[0], /Attempting to fetch last/);
    assert.match(logCalls[7].arguments[0], /Successfully fetched snippet/);
  });

  it('should throw if dry-run creation fails', async () => {
    createServiceMock = mock.fn(() =>
      Promise.reject(new Error('Dry run fail'))
    );
    context.runClient.createService = createServiceMock;
    const { triggerCloudBuild } = await getTriggerCloudBuild();
    await assert.rejects(
      () =>
        triggerCloudBuild(
          'mock-project',
          'mock-location',
          'mock-bucket',
          'mock-blob',
          'mock-repo',
          'gcr.io/mock-project/mock-image',
          true,
          () => {}
        ),
      /Dry-run deployment failed: Dry run fail/
    );
    assert.strictEqual(submitBuildMock.mock.callCount(), 0);
  });

  it('should throw if dry-run update fails', async () => {
    checkServiceMock.mock.mockImplementation(() => Promise.resolve(true));
    updateServiceMock = mock.fn(() =>
      Promise.reject(new Error('Dry run fail'))
    );
    context.runClient.updateService = updateServiceMock;
    const { triggerCloudBuild } = await getTriggerCloudBuild();
    await assert.rejects(
      () =>
        triggerCloudBuild(
          'mock-project',
          'mock-location',
          'mock-bucket',
          'mock-blob',
          'mock-repo',
          'gcr.io/mock-project/mock-image',
          true,
          () => {}
        ),
      /Dry-run deployment failed: Dry run fail/
    );
    assert.strictEqual(submitBuildMock.mock.callCount(), 0);
  });

  it('should throw if checkCloudRunServiceExists fails with unexpected error', async () => {
    checkServiceMock.mock.mockImplementation(() =>
      Promise.reject(new Error('Permission denied'))
    );
    const { triggerCloudBuild } = await getTriggerCloudBuild();
    await assert.rejects(
      () =>
        triggerCloudBuild(
          'mock-project',
          'mock-location',
          'mock-bucket',
          'mock-blob',
          'mock-repo',
          'gcr.io/mock-project/mock-image',
          true,
          () => {}
        ),
      /Permission denied/
    );
  });

  it('should throw if submitBuild fails', async () => {
    submitBuildMock = mock.fn(() => Promise.reject(new Error('Submit failed')));
    context.buildsClient.submitBuild = submitBuildMock;
    const { triggerCloudBuild } = await getTriggerCloudBuild();
    await assert.rejects(
      () =>
        triggerCloudBuild(
          'mock-project',
          'mock-location',
          'mock-bucket',
          'mock-blob',
          'mock-repo',
          'gcr.io/mock-project/mock-image',
          true,
          () => {}
        ),
      /Submit failed/
    );
  });

  it('should handle failed build when no logs are found', async () => {
    getBuildMock = mock.fn(() => Promise.resolve([mockFailureResult]));
    getEntriesMock = mock.fn(() => Promise.resolve([[]])); // No log entries
    context.cloudBuildClient.getBuild = getBuildMock;
    context.loggingClient.getEntries = getEntriesMock;

    const { triggerCloudBuild } = await getTriggerCloudBuild();
    await assert.rejects(
      () =>
        triggerCloudBuild(
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
        assert.match(err.message, /Build mock-build-id failed/);
        assert.doesNotMatch(err.message, /Last log lines from build/);
        return true;
      }
    );

    const { calls: logCalls } = logAndProgressMock.mock;
    assert.match(logCalls[6].arguments[0], /Attempting to fetch last/);
    assert.match(logCalls[7].arguments[0], /No specific log entries retrieved/);
  });

  it('should handle error when fetching logs for a failed build', async () => {
    getBuildMock = mock.fn(() => Promise.resolve([mockFailureResult]));
    getEntriesMock = mock.fn(() =>
      Promise.reject(new Error('Log fetch error'))
    );
    context.cloudBuildClient.getBuild = getBuildMock;
    context.loggingClient.getEntries = getEntriesMock;

    const { triggerCloudBuild } = await getTriggerCloudBuild();
    await assert.rejects(
      () =>
        triggerCloudBuild(
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
        assert.match(err.message, /Build mock-build-id failed/);
        assert.doesNotMatch(err.message, /Last log lines from build/);
        return true;
      }
    );

    const { calls: logCalls } = logAndProgressMock.mock;
    assert.match(logCalls[6].arguments[0], /Attempting to fetch last/);
    assert.match(
      logCalls[7].arguments[0],
      /Failed to fetch build logs snippet/
    );
  });
});
