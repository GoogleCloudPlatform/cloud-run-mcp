import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const packageJsonPath = path.resolve(__dirname, '..', '..', 'package.json');
const mcpServerPath = path.resolve(__dirname, '..', '..', 'mcp-server.js');

describe('The repository is properly structured to be executed using npx', () => {
  test('package.json should be at the root', () => {
    assert.ok(
      fs.existsSync(packageJsonPath),
      'package.json not found at the project root'
    );
  });

  test('package.json should have a bin attribute for cloud-run-mcp', () => {
    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));
    assert.ok(packageJson.bin, 'bin attribute not found in package.json');
    assert.ok(
      packageJson.bin['cloud-run-mcp'],
      'cloud-run-mcp not found in bin attribute'
    );
  });

  test('mcp-server.js should start with #!/usr/bin/env node', () => {
    const mcpServerContent = fs.readFileSync(mcpServerPath, 'utf-8');
    assert.ok(
      mcpServerContent.startsWith('#!/usr/bin/env node'),
      'mcp-server.js does not start with #!/usr/bin/env node'
    );
  });
});
