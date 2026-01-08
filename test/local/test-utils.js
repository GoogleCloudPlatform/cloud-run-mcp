/**
 * Waits for a specific string to appear in a stream's output.
 * This is useful for synchronizing tests with asynchronous child processes,
 * ensuring that a server or process has started and emitted an
 * expected "ready" message before proceeding with test assertions.
 *
 * @param {ReadableStream} stream - The stream to listen to (e.g., process.stdout or process.stderr).
 * @param {string} str - The string to wait for in the stream's output.
 * @param {number} [timeoutMs=7000] - The maximum time in milliseconds to wait before rejecting.
 * @returns {Promise<string>} A promise that resolves with the accumulated data
 *   when the string is found, or rejects if the timeout is reached.
 */
export async function waitForString(stream, str, timeoutMs = 7000) {
  let accumulatedData = '';
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      stream.removeListener('data', onData);
      reject(
        new Error(`waitForString timed out after ${timeoutMs}ms waiting for "${str}".
Saw:
${accumulatedData}`)
      );
    }, timeoutMs);

    function onData(data) {
      accumulatedData += data.toString();
      if (accumulatedData.includes(str)) {
        clearTimeout(timeout);
        stream.removeListener('data', onData);
        resolve(accumulatedData);
      }
    }
    stream.on('data', onData);
  });
}
