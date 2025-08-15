import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..', '..');
const geminiExtensionJsonPath = path.resolve(rootDir, 'gemini-extension.json');

describe('Gemini CLI extension', () => {
  test('gemini-extension.json should be at the root', () => {
    assert.ok(
      fs.existsSync(geminiExtensionJsonPath),
      'gemini-extension.json not found at the project root'
    );
  });

  test('contextFileName from gemini-extension.json should exist', () => {
    const geminiExtensionJson = JSON.parse(
      fs.readFileSync(geminiExtensionJsonPath, 'utf-8')
    );
    const contextFileName = geminiExtensionJson.contextFileName;
    assert.ok(
      contextFileName,
      'contextFileName not found in gemini-extension.json'
    );
    const contextFilePath = path.resolve(rootDir, contextFileName);
    assert.ok(
      fs.existsSync(contextFilePath),
      `context file name '${contextFileName}' not found`
    );
  });
});
