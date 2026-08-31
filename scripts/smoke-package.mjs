// Local packaging only. Never publishes or changes audited projects.
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, cpSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { args, fixture, paths, treeHash } from '../test/helpers.mjs';

const source = fileURLToPath(new URL('../', import.meta.url));
const scratch = mkdtempSync(join(tmpdir(), 'native-audit-consumer-'));
function command(cmd, argv, cwd) {
  const result = spawnSync(cmd, argv, { cwd, encoding: 'utf8', timeout: 60000, env: { ...process.env, NODE_PATH: '' } });
  if (result.error) throw result.error;
  assert.equal(result.status, 0, `${cmd} failed: ${result.stderr}`);
  return result.stdout;
}
try {
  const metadata = JSON.parse(readFileSync(join(source, 'package.json'), 'utf8'));
  const lock = JSON.parse(readFileSync(join(source, 'package-lock.json'), 'utf8'));
  assert.equal(metadata.license, 'MIT');
  assert.equal(metadata.private, true, 'Publication safeguard must remain enabled');
  assert.equal(lock.packages[''].license, metadata.license);
  const license = readFileSync(join(source, 'LICENSE'), 'utf8');
  assert.match(license, /^MIT License\r?\n\r?\nCopyright \(c\) \d{4} \S[^\r\n]*\r?\n/);
  assert.ok(!/<(?:YEAR|COPYRIGHT HOLDER)>/.test(license), 'License notice must be finalized');
  assert.ok(license.includes('Permission is hereby granted, free of charge,'));
  assert.ok(license.includes('THE SOFTWARE IS PROVIDED "AS IS"'));
  const packed = JSON.parse(command('npm', ['pack', '--ignore-scripts', '--json', '--pack-destination', scratch], source))[0];
  const inventory = packed.files.map(item => item.path).sort();
  assert.ok(inventory.includes('bin/audit.mjs') && inventory.includes('src/compare.mjs'));
  assert.ok(inventory.includes('LICENSE'), 'Package must include the license notice');
  for (const name of inventory) assert.match(name, /^(?:package\.json|README\.md|LICENSE|(?:bin|src)\/[A-Za-z0-9/.-]+\.mjs)$/);
  const consumer = join(scratch, 'consumer'), target = join(scratch, 'synthetic target');
  mkdirSync(consumer); cpSync(fixture, target, { recursive: true });
  writeFileSync(join(consumer, 'package.json'), JSON.stringify({ name: 'audit-smoke-consumer', version: '1.0.0', private: true }));
  command('npm', ['install', '--ignore-scripts', '--no-fund', '--no-audit', join(scratch, packed.filename)], consumer);
  const installed = join(consumer, 'node_modules/expo-native-config-audit');
  function installedFiles(folder, prefix = '') {
    return readdirSync(folder, { withFileTypes: true }).flatMap(item => item.isDirectory() ? installedFiles(join(folder, item.name), prefix + item.name + '/') : [prefix + item.name]);
  }
  assert.deepEqual(installedFiles(installed).sort(), inventory);
  assert.equal(readFileSync(join(installed, 'LICENSE'), 'utf8'), license);
  const installedMetadata = JSON.parse(readFileSync(join(installed, 'package.json'), 'utf8'));
  assert.equal(installedMetadata.license, 'MIT');
  assert.equal(installedMetadata.private, true);
  assert.equal(
    readFileSync(join(consumer, 'node_modules/@xmldom/xmldom/LICENSE'), 'utf8'),
    readFileSync(join(source, 'node_modules/@xmldom/xmldom/LICENSE'), 'utf8'),
    'Dependency copyright and permission notices must remain intact'
  );
  for (const name of inventory) {
    const text = readFileSync(join(installed, name), 'utf8');
    assert.ok(!/(?:\/Users\/|\.local\/HANDOFF|PRIVATE_SENTINEL|BEGIN (?:RSA |EC )?PRIVATE KEY)/.test(text), 'Unexpected private material in package');
  }
  const before = treeHash(target);
  const executable = join(consumer, 'node_modules/.bin/expo-native-config-audit');
  const invoke = () => spawnSync(executable, [...args(target), '--format=json'], { cwd: consumer, encoding: 'utf8', timeout: 10000, env: { ...process.env, NODE_PATH: '' } });
  const match = invoke(); assert.equal(match.status, 0, match.stdout || match.stderr);
  assert.equal(JSON.parse(match.stdout).checks.length, 14);
  assert.equal(invoke().stdout, match.stdout);
  assert.equal(treeHash(target), before);
  for (const [name, transform, issue] of [
    [paths.project, text => text.replace('INFOPLIST_FILE =', 'INFOPLIST_EXPAND_BUILD_SETTINGS = NO; INFOPLIST_FILE ='), 'ios.UNSUPPORTED_SETTINGS'],
    [paths.manifest, text => text.replace('</intent-filter>', '<uri-relative-filter-group><data android:query="preview" /></uri-relative-filter-group></intent-filter>'), 'android.UNSUPPORTED_SCHEME'],
  ]) {
    const selected = join(target, name), original = readFileSync(selected, 'utf8');
    writeFileSync(selected, transform(original));
    const unsupportedBefore = treeHash(target), unsupported = invoke();
    assert.equal(unsupported.status, 2, unsupported.stdout);
    assert.ok(JSON.parse(unsupported.stdout).issues.some(item => item.id === issue));
    assert.equal(treeHash(target), unsupportedBefore);
    writeFileSync(selected, original);
  }
  assert.equal(treeHash(target), before);
  writeFileSync(join(target, paths.gradle), readFileSync(join(target, paths.gradle), 'utf8').replace('versionCode 17', 'versionCode 18'));
  const driftBefore = treeHash(target), drift = invoke();
  assert.equal(drift.status, 1, drift.stdout); assert.equal(treeHash(target), driftBefore);
  writeFileSync(join(target, 'app.config.js'), 'throw new Error("must not execute")');
  const unsupportedBefore = treeHash(target), unsupported = invoke();
  assert.equal(unsupported.status, 2, unsupported.stdout); assert.equal(treeHash(target), unsupportedBefore);
  command('npm', ['audit', '--omit=dev'], consumer);
  console.log(JSON.stringify({ status: 'PASS', packageFiles: inventory, checks: ['installed executable', 'matching declarations', 'drift exit 1', 'unsupported exit 2', 'disabled plist expansion exit 2', 'URI-relative filter group exit 2', 'deterministic output', 'target non-mutation', 'package inventory and bounded privacy scan', 'MIT metadata and packaged notice', 'private publication safeguard', 'dependency notices preserved', 'consumer dependency audit'] }, null, 2));
} finally { rmSync(scratch, { recursive: true, force: true }); }
