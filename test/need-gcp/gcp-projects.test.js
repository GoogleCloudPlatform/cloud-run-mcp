/*
Copyright 2025 Google LLC

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    https://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
*/

import { test } from 'node:test';
import { setupProject } from './test-helpers.js';

test('should create 100 projects and attach billing', async (t) => {
  console.log('Attempting to create 100 new projects and attach billing...');
  const promises = [];
  for (let i = 0; i < 100; i++) {
    promises.push(setupProject(t));
  }
  await Promise.all(promises);
  console.log('Successfully created 100 projects.');
});
