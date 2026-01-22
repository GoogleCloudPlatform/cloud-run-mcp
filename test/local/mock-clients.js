import { mock } from 'node:test';

/**
 * Creates a mock Cloud Build Client.
 * @param {object} [overrides] - Optional overrides for methods.
 * @returns {object} A mock Cloud Build Client.
 */
export function getMockCloudBuildClient(overrides = {}) {
  return {
    createBuild:
      overrides.createBuild ||
      mock.fn(() =>
        Promise.resolve([
          {
            metadata: {
              build: {
                id: 'default-mock-build-id',
              },
            },
          },
        ])
      ),
    getBuild:
      overrides.getBuild ||
      mock.fn(() =>
        Promise.resolve([
          {
            id: 'default-mock-build-id',
            status: 'SUCCESS',
          },
        ])
      ),
    ...overrides,
  };
}
