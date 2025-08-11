import { execSync } from 'child_process';

const tests = [
  'npm run test:deploy',
  'npm run test:service-logs',
  'npm run test:gcp-auth',
  'npm run test:create-project',
  'npm run test:prompts',
];

for (const test of tests) {
  try {
    console.log(`Running: ${test}`);
    execSync(test, { stdio: 'inherit' });
  } catch (error) {
    console.error(`Failed to run: ${test}`);
    process.exit(1);
  }
}
