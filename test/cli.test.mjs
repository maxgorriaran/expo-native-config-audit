import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { fixture, cli, args, run, temporary, treeHash, change, paths } from './helpers.mjs';

test('JSON CLI is deterministic, portable, and non-mutating', t => {
  const root = temporary(t), before = treeHash(root);
  const first = run(root, ['--format', 'json']);
  assert.equal(first.status, 0, first.stdout);
  assert.equal(first.stderr, '');
  assert.equal(run(root, ['--format', 'json']).stdout, first.stdout);
  assert.equal(run(fixture, ['--format', 'json']).stdout, first.stdout);
  assert.equal(JSON.parse(first.stdout).exitCode, 0);
  assert.equal(treeHash(root), before);
  assert.ok(!first.stdout.includes(root));
});
test('text CLI describes its proof boundary', () => {
  const result = run(fixture);
  assert.equal(result.status, 0);
  assert.match(result.stdout, /Selected declaration checks match/);
  assert.match(result.stdout, /runtime behavior are not proved/);
});
test('CLI reports drift and does not mutate target', t => {
  const root = temporary(t); change(root, paths.gradle, text => text.replace('versionCode 17', 'versionCode 18'));
  const before = treeHash(root); const result = run(root, ['--format=json']);
  assert.equal(result.status, 1);
  assert.equal(JSON.parse(result.stdout).outcome, 'drift');
  assert.equal(treeHash(root), before);
});
test('invalid, duplicate and missing flags have stable JSON diagnostics', () => {
  for (const flags of [[], ['--unknown'], ['--platform', 'both'], [...args(fixture), '--platform', 'ios']]) {
    const result = spawnSync(process.execPath, [cli, ...flags, '--format=json'], { encoding: 'utf8' });
    assert.equal(result.status, 2);
    assert.equal(JSON.parse(result.stdout).issues[0].id, 'cli.INVALID_ARGUMENTS');
    assert.equal(result.stderr, '');
  }
});
test('single platform selection does not read the other platform', () => {
  const selection = ['--root', fixture, '--platform', 'android', '--android-gradle', paths.gradle, '--android-manifest', paths.manifest];
  const result = spawnSync(process.execPath, [cli, ...selection, '--format', 'json'], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stdout);
  assert.deepEqual(JSON.parse(result.stdout).scope.platforms, ['android']);
});

function fromDirectories(root, directories) {
  return directories.map(cwd => {
    const result = spawnSync(process.execPath, [cli, ...args(root), '--format=json'], { cwd, encoding: 'utf8', timeout: 10000 });
    assert.equal(result.error, undefined);
    assert.equal(result.stderr, '');
    return { status: result.status, output: result.stdout, report: JSON.parse(result.stdout) };
  });
}

test('supported relative plist binding is independent of caller cwd', t => {
  const root = temporary(t), other = temporary(t), before = treeHash(root);
  const results = fromDirectories(root, [process.cwd(), root, other]);
  assert.ok(results.every(result => result.status === 0));
  assert.ok(results.every(result => result.output === results[0].output));
  assert.equal(treeHash(root), before);
});

test('absolute plist binding outside audit root fails from every caller cwd', t => {
  const root = temporary(t), other = temporary(t);
  const outside = resolve(paths.plist);
  change(root, paths.project, text => text.replace('INFOPLIST_FILE = Sample/Info.plist;', `INFOPLIST_FILE = "${outside}";`));
  const before = treeHash(root);
  const results = fromDirectories(root, [process.cwd(), root, other]);
  for (const result of results) {
    assert.equal(result.status, 2);
    assert.equal(result.report.coverage, 'incomplete');
    assert.ok(result.report.issues.some(issue => issue.id === 'ios.UNSUPPORTED_SETTINGS'));
  }
  assert.ok(results.every(result => result.output === results[0].output));
  assert.equal(treeHash(root), before);
});

for (const binding of ['../../../Info.plist', 'C:/outside/Info.plist']) test(`rejects unsafe plist binding ${binding}`, t => {
  const root = temporary(t);
  change(root, paths.project, text => text.replace('INFOPLIST_FILE = Sample/Info.plist;', `INFOPLIST_FILE = "${binding}";`));
  const result = run(root, ['--format=json']);
  assert.equal(result.status, 2);
  assert.ok(JSON.parse(result.stdout).issues.some(issue => issue.id === 'ios.UNSUPPORTED_SETTINGS'));
});

for (const [name, content] of [['vertical tab', '\u000b'], ['form feed', '\u000c'], ['NBSP', '\u00a0']]) test(`CLI rejects JSON ${name}`, t => {
  const root = temporary(t);
  change(root, 'app.json', text => content + text);
  const before = treeHash(root), result = run(root, ['--format=json']);
  assert.equal(result.status, 2);
  assert.equal(JSON.parse(result.stdout).coverage, 'incomplete');
  assert.equal(treeHash(root), before);
});

for (const content of ['garbage', '<![CDATA[garbage]]>', '\u00a0']) test(`CLI rejects invalid plist root content ${JSON.stringify(content)}`, t => {
  const root = temporary(t);
  change(root, paths.plist, text => text.replace('<plist version="1.0"><dict>', `<plist version="1.0">${content}<dict>`));
  const before = treeHash(root), result = run(root, ['--format=json']);
  assert.equal(result.status, 2);
  assert.ok(JSON.parse(result.stdout).issues.some(issue => issue.id === 'ios.INVALID_PLIST'));
  assert.equal(treeHash(root), before);
});

for (const [literal, expected] of [['021', 21], ['017', 17], ['018', 18]]) test(`CLI rejects leading-zero Gradle versionCode ${literal}`, t => {
  const root = temporary(t);
  change(root, paths.gradle, text => text.replace('versionCode 17', `versionCode ${literal}`));
  change(root, 'app.json', text => {
    const config = JSON.parse(text);
    config.expo.android.versionCode = expected;
    return JSON.stringify(config);
  });
  const before = treeHash(root), result = run(root, ['--format=json']);
  const report = JSON.parse(result.stdout);
  assert.equal(result.status, 2, result.stdout);
  assert.equal(report.coverage, 'incomplete');
  assert.ok(report.issues.some(issue => issue.id === 'android.UNSUPPORTED_GRADLE'));
  assert.ok(!report.checks.some(check => check.id === 'android.build' && check.status === 'match'));
  assert.equal(run(root, ['--format=json']).stdout, result.stdout);
  assert.equal(treeHash(root), before);
});

const sdkDeclarations = [
  ['compileSdk 35', 'compileSdk'], ['compileSdk 35', 'compileSdkVersion'],
  ['minSdk 24', 'minSdk'], ['minSdk 24', 'minSdkVersion'],
  ['targetSdk 35', 'targetSdk'], ['targetSdk 35', 'targetSdkVersion'],
];

test('CLI rejects leading-zero integers in every SDK declaration alias', t => {
  for (const [original, field] of sdkDeclarations) {
    const root = temporary(t);
    change(root, paths.gradle, text => text.replace(original, `${field} = 035`));
    const before = treeHash(root), result = run(root, ['--format=json']);
    assert.equal(result.status, 2, `${field}: ${result.stdout}`);
    assert.ok(JSON.parse(result.stdout).issues.some(issue => issue.id === 'android.UNSUPPORTED_GRADLE'));
    assert.equal(treeHash(root), before);
  }
});

test('CLI retains canonical zero syntax for unaudited SDK declarations', t => {
  for (const [original, field] of sdkDeclarations) {
    const root = temporary(t);
    change(root, paths.gradle, text => text.replace(original, `${field} = 0`));
    const before = treeHash(root), result = run(root, ['--format=json']);
    assert.equal(result.status, 0, `${field}: ${result.stdout}`);
    assert.equal(treeHash(root), before);
  }
});

test('CLI still rejects zero versionCode after numeric syntax validation', t => {
  const root = temporary(t);
  change(root, paths.gradle, text => text.replace('versionCode 17', 'versionCode 0'));
  const before = treeHash(root), result = run(root, ['--format=json']);
  assert.equal(result.status, 2, result.stdout);
  assert.ok(JSON.parse(result.stdout).issues.some(issue => issue.id === 'android.MISSING_FIELD'));
  assert.equal(treeHash(root), before);
});
