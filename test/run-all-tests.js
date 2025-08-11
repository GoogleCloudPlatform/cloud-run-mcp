
import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';

const runTestsInDir = (dir) => {
  const testFiles = fs.readdirSync(dir).filter(file => file.endsWith('.js'));
  for (const file of testFiles) {
    const test = path.join(dir, file);
    try {
      console.log(`Running: ${test}`);
      execSync(`node ${test}`, { stdio: 'inherit' });
    } catch (error) {
      console.error(`Failed to run: ${test}`);
      process.exit(1);
    }
  }
};

console.log('Running unit tests...');
runTestsInDir('test/unit');

console.log('Running integration tests...');
runTestsInDir('test/integration');
