import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { cli, treeHash } from './helpers.mjs';

test('documented version-drift example reproduces exact output without changing inputs', () => {
  const root = fileURLToPath(new URL('../examples/version-drift/', import.meta.url));
  const before = treeHash(root);
  const args = [cli, '--root', root, '--platform', 'android',
    '--android-gradle', 'android/app/build.gradle',
    '--android-manifest', 'android/app/src/main/AndroidManifest.xml'];
  const invoke = extra => spawnSync(process.execPath, [...args, ...extra], { encoding: 'utf8', timeout: 10000 });
  const text = invoke([]);
  assert.equal(text.status, 1, text.stdout);
  assert.equal(text.stderr, '');
  assert.equal(text.stdout, readFileSync(new URL('../examples/version-drift/expected-output.txt', import.meta.url), 'utf8'));
  const json = invoke(['--format=json']);
  assert.equal(json.status, 1, json.stdout);
  const report = JSON.parse(json.stdout);
  assert.equal(report.coverage, 'complete-for-selected-declarations');
  assert.deepEqual(report.checks.filter(item => item.status === 'drift'), [
    { id: 'android.build', status: 'drift', expected: 43, actual: 42 },
    { id: 'android.version', status: 'drift', expected: '1.3.0', actual: '1.2.0' },
  ]);
  assert.equal(treeHash(root), before);
});
