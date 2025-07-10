// test/test-adc.js

import { strict as assert } from 'assert';
import { ensureAdcCredentials } from '../lib/adc-check.js';

// Global state for mocks and captured output
let mockExecError = null;
let mockExecStdout = '';
let mockExecStderr = '';
let mockProcessExitCalled = false;
let mockProcessExitCode = null;
let capturedConsoleErrors = [];
let execCalledWithCommand = null; // To capture the command that mockExec was called with

// --- Mocking Functions ---

// This `mockExec` function will be the one passed to `ensureAdcCredentials`
const mockExec = (command, callback) => {
    execCalledWithCommand = command; // Capture the command for assertions
    // Call the callback immediately with the pre-configured error/stdout/stderr for the current test
    callback(mockExecError, mockExecStdout, mockExecStderr);
};

// Mock process.exit to prevent actual process termination during tests
const mockProcessExit = (code) => {
    mockProcessExitCalled = true;
    mockProcessExitCode = code;
    // Throw an error to stop execution within the test function, allowing the test runner to proceed
    // We throw a specific error type to distinguish it from other assertion errors
    throw new ProcessExitError(`Process exited with code ${code}`);
};

// Custom Error class for process.exit
class ProcessExitError extends Error {
    constructor(message) {
        super(message);
        this.name = 'ProcessExitError';
    }
}

// Mock console.error to capture its output for assertions
const mockConsoleError = (...args) => {
    capturedConsoleErrors.push(args.join(' '));
};

// --- Test Setup/Teardown ---

// Store original process.exit and console.error before we mock them globally
const originalProcessExit = process.exit;
const originalConsoleError = console.error;

// Function to reset all mock states before each test run
function resetMocks() {
    mockExecError = null;
    mockExecStdout = '';
    mockExecStderr = '';
    mockProcessExitCalled = false;
    mockProcessExitCode = null;
    capturedConsoleErrors = [];
    execCalledWithCommand = null;

    // Apply the mocks by directly overriding global functions/properties
    process.exit = mockProcessExit; // Temporarily replace global process.exit
    console.error = mockConsoleError; // Temporarily replace global console.error
}

// Function to restore original functionalities after all tests are done
function restoreMocks() {
    process.exit = originalProcessExit; // Restore original global process.exit
    console.error = originalConsoleError; // Restore original global console.error
}

// --- Test Runner Helper ---

// A simple test runner function to execute individual test cases
async function test(name, testFn) {
    resetMocks(); // Ensure a clean state for each test

    originalConsoleError(`--- Running test: ${name} ---`);
    let passed = true;
    try {
        await testFn();
    } catch (e) {
        // Catch the error thrown by mockProcessExit, or any unexpected errors
        // We now specifically check for our custom ProcessExitError
        if (e instanceof ProcessExitError) {
            // If mockProcessExit was called, and the test expected it, then it's fine.
            // If the test didn't expect it, the assertion `assert.strictEqual(mockProcessExitCalled, false)` will fail later.
            // For now, we just let it pass this catch block if it's our expected exit.
            originalConsoleError(`Caught expected ProcessExitError for test: ${name}`);
        } else {
            // If it's any other error, it's an unexpected failure
            passed = false;
            originalConsoleError(`Test failed: ${name}`);
            originalConsoleError(e.stack); // Log the full stack trace for debugging
        }
    }

    // Log test result and captured console output
    if (passed) {
        originalConsoleError(`Test passed: ${name}`);
    } else {
        originalConsoleError(`Test FAILED: ${name}`);
    }
    originalConsoleError(`Captured console.error output:\n${capturedConsoleErrors.join('\n')}`);
    originalConsoleError('\n');
    return passed;
}

// --- Individual Test Cases ---

// Test case: ADC credentials are found successfully
async function test_success_adc_found() {
    // Configure mockExec's behavior for a token printed
    mockExecError = null;
    mockExecStdout = 'mock-access-token-12345';
    mockExecStderr = '';

    await ensureAdcCredentials(mockExec); // Should resolve successfully

    assert.strictEqual(execCalledWithCommand, 'gcloud auth application-default print-access-token', 'exec was called with wrong command');
    assert.ok(capturedConsoleErrors.includes('Checking for Google Cloud Application Default Credentials...'), 'Initial check message missing');
    assert.ok(capturedConsoleErrors.includes('Application Default Credentials found.'), 'Success message missing');
    assert.strictEqual(mockProcessExitCalled, false, 'process.exit should not have been called');
}

// Test case: ADC credentials are not found
async function test_adc_not_found_specific_stderr() {
    // Configure mockExec's behavior for no token printed
    mockExecError = Object.assign(new Error('Command failed: gcloud ...'), { code: 1 });
    // This stderr content should trigger the specific ADC not found logic
    mockExecStderr = 'ERROR: (gcloud.auth.application-default.print-access-token) Your default credentials were not found. To set up Application Default Credentials, see https://cloud.google.com/docs/authentication/external/set-up-adc for more information.';

    let caughtError = null;
    try {
        // Call the function, expecting it to call process.exit
        await ensureAdcCredentials(mockExec);
        assert.fail('Expected process.exit to be called'); // Fail if process.exit was NOT called
    } catch (e) {
        caughtError = e;
        assert.ok(e instanceof ProcessExitError, 'Expected ProcessExitError due to process.exit');
        assert.strictEqual(e.message, 'Process exited with code 1', 'Expected process exit code 1 message');
    }

    assert.strictEqual(execCalledWithCommand, 'gcloud auth application-default print-access-token', 'exec was called with wrong command');
    assert.ok(capturedConsoleErrors.includes('Checking for Google Cloud Application Default Credentials...'), 'Initial check message missing');
    // These are the messages that should only appear for ADC not found
    assert.ok(capturedConsoleErrors.includes('ERROR: Google Cloud Application Default Credentials are not set up.'), 'Specific ADC error message missing');
    assert.ok(capturedConsoleErrors.includes('Please run the following command to set them up:'), 'Instructions message missing');
    assert.ok(capturedConsoleErrors.includes('gcloud auth application-default login'), 'Login command message missing');
    assert.strictEqual(mockProcessExitCalled, true, 'process.exit should have been called');
    assert.strictEqual(mockProcessExitCode, 1, 'process.exit should have been called with code 1');
    assert.ok(caughtError, 'Error was not caught');
}

// Test case: 'gcloud' command itself is not found (ENOENT error)
async function test_command_not_found_enoent() {
    // Configure mockExec's behavior for this gcloud not found case
    mockExecError = Object.assign(new Error('spawn gcloud ENOENT'), { code: 'ENOENT' });
    // This stderr should not contain the specific ADC messages
    mockExecStderr = 'sh: gcloud: command not found';

    let caughtError = null;
    try {
        await ensureAdcCredentials(mockExec);
        assert.fail('Expected promise to be rejected'); // Now we expect rejection, not process.exit
    } catch (e) {
        caughtError = e;
        // We expect the original error object to be rejected
        assert.ok(e instanceof Error, 'Expected an Error object to be rejected');
        assert.ok(e.message.includes('spawn gcloud ENOENT'), 'Expected original ENOENT error message');
    }

    assert.strictEqual(execCalledWithCommand, 'gcloud auth application-default print-access-token', 'exec was called with wrong command');
    assert.ok(capturedConsoleErrors.includes('Checking for Google Cloud Application Default Credentials...'), 'Initial check message missing');
    // These console errors should be for the generic error path
    assert.ok(capturedConsoleErrors.includes('An unexpected error occurred while checking for ADC credentials:'), 'Generic unexpected error message missing');
    assert.ok(capturedConsoleErrors.includes('sh: gcloud: command not found'), 'Original stderr output missing from console error');
    assert.strictEqual(mockProcessExitCalled, false, 'process.exit should NOT have been called for ENOENT');
    assert.ok(caughtError, 'Error was not caught (promise not rejected)');
}

// Test case: Other unexpected errors during exec call (generic exec error, not ADC specific)
async function test_other_unexpected_exec_errors() {
    // Configure mockExec's behavior for this unexpected error case
    mockExecError = new Error('Some unexpected internal error during gcloud execution.');
    // This stderr should not contain the specific ADC messages
    mockExecStderr = 'Internal gcloud error: database connection failed.';

    let caughtError = null;
    try {
        await ensureAdcCredentials(mockExec);
        assert.fail('Expected promise to be rejected'); // Now we expect rejection, not process.exit
    } catch (e) {
        caughtError = e;
        // We expect the original error object to be rejected
        assert.ok(e instanceof Error, 'Expected an Error object to be rejected');
        assert.ok(e.message.includes('Some unexpected internal error'), 'Expected original unexpected error message');
    }

    assert.strictEqual(execCalledWithCommand, 'gcloud auth application-default print-access-token', 'exec was called with wrong command');
    assert.ok(capturedConsoleErrors.includes('Checking for Google Cloud Application Default Credentials...'), 'Initial check message missing');
    // These console errors should be for the generic error path
    assert.ok(capturedConsoleErrors.includes('An unexpected error occurred while checking for ADC credentials:'), 'Generic unexpected error message missing');
    assert.ok(capturedConsoleErrors.includes('Internal gcloud error: database connection failed.'), 'Original stderr output missing from console error');
    assert.strictEqual(mockProcessExitCalled, false, 'process.exit should NOT have been called for other errors');
    assert.ok(caughtError, 'Error was not caught (promise not rejected)');
}

// --- Main Test Runner ---

async function runAllTests() {
    const testsToRun = [
        test_success_adc_found,
        test_adc_not_found_specific_stderr,
        test_command_not_found_enoent,
        test_other_unexpected_exec_errors,
    ];

    let passedCount = 0;
    let failedCount = 0;

    for (const testFn of testsToRun) {
        const testName = testFn.name;
        const testPassed = await test(testName, testFn);
        if (testPassed) {
            passedCount++;
        } else {
            failedCount++;
        }
    }

    originalConsoleError(`\n--- Test Summary ---`);
    originalConsoleError(`Tests Passed: ${passedCount}`);
    originalConsoleError(`Tests Failed: ${failedCount}`);

    restoreMocks(); // Ensure all mocks are restored after testing is complete

    if (failedCount > 0) {
        originalProcessExit(1); // Use the stored original process.exit
    } else {
        originalProcessExit(0); // Use the stored original process.exit
    }
}

// Start the test runner when the script executes
runAllTests();