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
