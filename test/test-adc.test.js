// test/adc-check.test.js
import { ensureAdcCredentials } from '../lib/adc-check.js';

jest.mock('google-auth-library', () => {
    const mockClient = {
        getAccessToken: jest.fn(() => Promise.resolve({ token: 'mock-token' })),
    };
    const mockGoogleAuthInstance = {
        getClient: jest.fn(() => Promise.resolve(mockClient)),
    };
    const MockGoogleAuthConstructor = jest.fn(() => mockGoogleAuthInstance);

    return {
        GoogleAuth: MockGoogleAuthConstructor,
        _mockClient: mockClient,
        _mockGoogleAuthInstance: mockGoogleAuthInstance,
        _MockGoogleAuthConstructor: MockGoogleAuthConstructor,
    };
});

import { _mockClient, _mockGoogleAuthInstance, _MockGoogleAuthConstructor } from 'google-auth-library';

describe('ensureAdcCredentials', () => {
    let consoleErrorSpy;
    let processExitSpy;
    let consoleOutput = [];

    beforeEach(() => {
        _mockClient.getAccessToken.mockClear();
        _mockGoogleAuthInstance.getClient.mockClear();
        _MockGoogleAuthConstructor.mockClear();

        consoleOutput = [];
        consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation((...args) => {
            consoleOutput.push(args.map(a => String(a)).join(' '));
        });
        processExitSpy = jest.spyOn(process, 'exit').mockImplementation((code) => {
            throw new Error(`process.exit called with code ${code}`);
        });
    });

    afterEach(() => {
        consoleErrorSpy.mockRestore();
        processExitSpy.mockRestore();
    });

    test('should resolve and log success if ADC are found', async () => {
        await ensureAdcCredentials();

        expect(_MockGoogleAuthConstructor).toHaveBeenCalledTimes(1);
        expect(_mockGoogleAuthInstance.getClient).toHaveBeenCalledTimes(1);
        expect(_mockClient.getAccessToken).toHaveBeenCalledTimes(1);

        expect(consoleOutput[0]).toContain('Checking for Google Cloud Application Default Credentials...');
        expect(consoleOutput).toContain('Application Default Credentials found.');
        expect(processExitSpy).not.toHaveBeenCalled();
    });

    test('should log an error and exit if getClient fails', async () => {
        const errorMessage = 'Could not load the default credentials';
        _mockGoogleAuthInstance.getClient.mockRejectedValueOnce(new Error(errorMessage));

        await expect(ensureAdcCredentials()).rejects.toThrow(`process.exit called with code 1`);

        expect(_MockGoogleAuthConstructor).toHaveBeenCalledTimes(1);
        expect(_mockGoogleAuthInstance.getClient).toHaveBeenCalledTimes(1);
        expect(_mockClient.getAccessToken).not.toHaveBeenCalled();

        expect(consoleOutput).toContain('ERROR: Google Cloud Application Default Credentials are not set up.');
        expect(consoleOutput).toContain('Please run the following command to set them up for local development:');
        expect(consoleOutput).toContain('gcloud auth application-default login');
        expect(consoleOutput).toContain('An unexpected error occurred during credential verification.');
        expect(consoleOutput).toContain(`\nOriginal error message from Google Auth Library: ${errorMessage}`);
        expect(processExitSpy).toHaveBeenCalledWith(1);
    });

    test('should log an error and exit if getAccessToken fails', async () => {
        const errorMessage = 'No credentials available to authorize the request';
        _mockClient.getAccessToken.mockRejectedValueOnce(new Error(errorMessage));

        await expect(ensureAdcCredentials()).rejects.toThrow(`process.exit called with code 1`);

        expect(_MockGoogleAuthConstructor).toHaveBeenCalledTimes(1);
        expect(_mockGoogleAuthInstance.getClient).toHaveBeenCalledTimes(1);
        expect(_mockClient.getAccessToken).toHaveBeenCalledTimes(1);

        expect(consoleOutput).toContain('ERROR: Google Cloud Application Default Credentials are not set up.');
        expect(consoleOutput).toContain('Please run the following command to set them up for local development:');
        expect(consoleOutput).toContain('gcloud auth application-default login');
        expect(consoleOutput).toContain('An unexpected error occurred during credential verification.');
        expect(consoleOutput).toContain(`\nOriginal error message from Google Auth Library: ${errorMessage}`);
        expect(processExitSpy).toHaveBeenCalledWith(1);
    });

    test('should log an HTTP error and exit if error.response.status is present', async () => {
        const httpError = new Error('Request failed with status code 403');
        httpError.response = { status: 403 };
        _mockClient.getAccessToken.mockRejectedValueOnce(httpError);

        await expect(ensureAdcCredentials()).rejects.toThrow(`process.exit called with code 1`);

        expect(_MockGoogleAuthConstructor).toHaveBeenCalledTimes(1);
        expect(_mockGoogleAuthInstance.getClient).toHaveBeenCalledTimes(1);
        expect(consoleOutput).toContain('ERROR: Google Cloud Application Default Credentials are not set up.');
        expect(consoleOutput).toContain('Please run the following command to set them up for local development:');
        expect(consoleOutput).toContain('gcloud auth application-default login');
        expect(consoleOutput).toContain('An HTTP error occurred (Status: 403). This often means misconfigured, expired credentials, or a network issue.');
        expect(consoleOutput).toContain(`\nOriginal error message from Google Auth Library: ${httpError.message}`);
        expect(processExitSpy).toHaveBeenCalledWith(1);
    });

    test('should log an unexpected error and exit for other error types', async () => {
        const unexpectedError = new TypeError('Something unexpected happened');
        _mockClient.getAccessToken.mockRejectedValueOnce(unexpectedError);

        await expect(ensureAdcCredentials()).rejects.toThrow(`process.exit called with code 1`);

        expect(_MockGoogleAuthConstructor).toHaveBeenCalledTimes(1);
        expect(_mockGoogleAuthInstance.getClient).toHaveBeenCalledTimes(1);
        expect(consoleOutput).toContain('ERROR: Google Cloud Application Default Credentials are not set up.');
        expect(consoleOutput).toContain('Please run the following command to set them up for local development:');
        expect(consoleOutput).toContain('gcloud auth application-default login');
        expect(consoleOutput).toContain('An unexpected error occurred during credential verification (e.g., malformed response or invalid type).');
        expect(consoleOutput).toContain(`\nOriginal error message from Google Auth Library: ${unexpectedError.message}`);
        expect(processExitSpy).toHaveBeenCalledWith(1);
    });

    test('should include error stack if available (if uncommented in original function)', async () => {
        const errorWithStack = new Error('Test Error with Stack');
        errorWithStack.stack = 'Error: Test Error with Stack\n    at anonymous...';
        _mockClient.getAccessToken.mockRejectedValueOnce(errorWithStack);

        await expect(ensureAdcCredentials()).rejects.toThrow(`process.exit called with code 1`);

        expect(consoleOutput).toContain(`Error stack: ${errorWithStack.stack}`);
        expect(processExitSpy).toHaveBeenCalledWith(1);
    });
});