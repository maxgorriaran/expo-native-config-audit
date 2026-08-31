import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, unlinkSync, symlinkSync, cpSync } from 'node:fs';
import { join } from 'node:path';
import { audit } from '../src/audit.mjs';
import { fixture, paths, options, temporary, change, read } from './helpers.mjs';

test('matching source declarations with three target configurations and an extension', () => {
  const result = audit(options(fixture));
  assert.equal(result.exitCode, 0, JSON.stringify(result));
  assert.equal(result.checks.length, 14);
  assert.ok(result.notes.some(note => note.includes('1 other target(s) and 2 other')));
  assert.ok(result.checks.every(check => check.status === 'match'));
});

const drift = [
  ['ios identifier', paths.project, 'org.example.sample;', 'org.example.changed;', 'ios.id'],
  ['ios version', paths.project, 'MARKETING_VERSION = 2.4.0', 'MARKETING_VERSION = 9.0.0', 'ios.version'],
  ['ios build', paths.project, 'CURRENT_PROJECT_VERSION = 17', 'CURRENT_PROJECT_VERSION = 18', 'ios.build'],
  ['ios scheme', paths.plist, '<string>sample-ios</string>', '', 'ios.scheme.sample-ios'],
  ['ios permission', paths.plist, 'Capture a sample photo.', 'Different description.', 'ios.permission.required.NSCameraUsageDescription'],
  ['android identifier', paths.gradle, "applicationId 'org.example.sample'", "applicationId 'org.example.changed'", 'android.id'],
  ['android version', paths.gradle, "versionName '2.4.0'", "versionName '9.0.0'", 'android.version'],
  ['android build', paths.gradle, 'versionCode 17', 'versionCode 18', 'android.build'],
  ['android scheme', paths.manifest, '<data android:scheme="sample-auth" />', '', 'android.scheme.sample-auth'],
  ['required android permission', paths.manifest, '<uses-permission android:name="android.permission.CAMERA" />', '', 'android.permission.required.android.permission.CAMERA'],
  ['blocked permission actually declared', paths.manifest, ' tools:node="remove"', '', 'android.permission.blocked.android.permission.RECORD_AUDIO'],
  ['absence is not a blocking marker', paths.manifest, '<uses-permission android:name="android.permission.RECORD_AUDIO" tools:node="remove" />', '', 'android.permission.blocked.android.permission.RECORD_AUDIO'],
];
for (const [name, file, from, to, id] of drift) test(name, t => {
  const root = temporary(t); change(root, file, text => text.replace(from, to));
  const result = audit(options(root));
  assert.equal(result.exitCode, 1, JSON.stringify(result));
  assert.deepEqual(result.checks.filter(check => check.status === 'drift').map(check => check.id), [id]);
});

const unsupported = [
  ['missing required config', 'app.json', text => text.replace('"buildNumber": "17",', '')],
  ['duplicate json key', 'app.json', text => text.replace('"version": "2.4.0"', '"version": "2.4.0", "version": "9"')],
  ['trailing json content', 'app.json', text => text + '{}'],
  ['malformed json', 'app.json', () => '{'],
  ['plugin effects', 'app.json', text => text.replace('"name": "Sample",', '"name": "Sample", "plugins": ["example-plugin"],')],
  ['unknown requested permission', 'app.json', text => text.replace('"CAMERA"', '"ACCESS_FINE_LOCATION"')],
  ['conflicting required and blocked', 'app.json', text => text.replace('android.permission.RECORD_AUDIO', 'android.permission.CAMERA')],
  ['unsupported iOS usage key', 'app.json', text => text.replace('NSCameraUsageDescription', 'NSLocationWhenInUseUsageDescription')],
  ['xcconfig inheritance', paths.project, text => text.replace('name = Release; buildSettings', 'name = Release; baseConfigurationReference = BASE; buildSettings')],
  ['unresolved build setting', paths.project, text => text.replace('CURRENT_PROJECT_VERSION = 17', 'CURRENT_PROJECT_VERSION = "$(inherited)"')],
  ['wrong plist binding', paths.project, text => text.replace('Sample/Info.plist', 'Other/Info.plist')],
  ['duplicate pbx key', paths.project, text => text.replace('rootObject = PROJECT;', 'rootObject = PROJECT; rootObject = OTHER;')],
  ['trailing pbx data', paths.project, text => text + 'arbitrary'],
  ['conditional build setting', paths.project, text => text.replace('CURRENT_PROJECT_VERSION = 17', '"CURRENT_PROJECT_VERSION[sdk=iphoneos*]" = 17')],
  ['generated plist', paths.project, text => text.replace('CURRENT_PROJECT_VERSION = 17;', 'CURRENT_PROJECT_VERSION = 17; GENERATE_INFOPLIST_FILE = YES;')],
  ['plist overrides', paths.project, text => text.replace('CURRENT_PROJECT_VERSION = 17;', 'CURRENT_PROJECT_VERSION = 17; INFOPLIST_KEY_CFBundleVersion = 22;')],
  ['custom Xcode source root', paths.project, text => text.replace('isa = PBXProject;', 'isa = PBXProject; projectDirPath = ../other;')],
  ['garbage plist container text', paths.plist, text => text.replace('<plist version="1.0"><dict>', '<plist version="1.0"><dict>garbage')],
  ['malformed XML', paths.plist, text => text.replace('</dict></plist>', '</plist>')],
  ['entity expansion', paths.plist, () => '<!DOCTYPE plist [<!ENTITY private SYSTEM "file:///not-read">]><plist><dict/></plist>'],
  ['duplicate plist key', paths.plist, text => text.replace('<key>CFBundleVersion</key>', '<key>CFBundleIdentifier</key>')],
  ['Gradle expression', paths.gradle, text => text.replace('versionCode 17', 'versionCode rootProject.versionCode')],
  ['Gradle duplicate', paths.gradle, text => text.replace('versionCode 17', 'versionCode 17\nversionCode 99')],
  ['Gradle variable interpolation', paths.gradle, text => text.replace('org.example.sample', '${applicationId}')],
  ['Gradle override block', paths.gradle, text => text.replace('compileSdk 35', 'buildTypes { debug { applicationIdSuffix ".debug" } }\ncompileSdk 35')],
  ['Gradle trailing logic', paths.gradle, text => text + '\napply from: "other.gradle"'],
  ['Gradle missing separator', paths.gradle, text => text.replace('versionCode 17\n        versionName', 'versionCode 17 versionName')],
  ['SDK-qualified permission', paths.manifest, text => text.replace('android.permission.CAMERA"', 'android.permission.CAMERA" android:maxSdkVersion="32"')],
  ['wrong tools namespace', paths.manifest, text => text.replace('http://schemas.android.com/tools', 'https://example.invalid/tools')],
  ['missing browsable category', paths.manifest, text => text.replace('android.intent.category.BROWSABLE', 'android.intent.category.OTHER')],
  ['placeholder scheme', paths.manifest, text => text.replace('android:scheme="sample"', 'android:scheme="${scheme}"')],
  ['removed intent filter', paths.manifest, text => text.replace('<intent-filter>', '<intent-filter tools:node="remove">')],
  ['namespaced manifest', paths.manifest, text => text.replace('<manifest ', '<manifest xmlns="https://example.invalid/" ')],
];
for (const [name, file, transform] of unsupported) test(name, t => {
  const root = temporary(t); change(root, file, transform);
  const result = audit(options(root));
  assert.equal(result.exitCode, 2, JSON.stringify(result));
  assert.equal(result.coverage, 'incomplete');
});

for (const name of ['app.config.json', 'app.config.js', 'app.config.ts', 'app.config.mjs', 'app.config.cjs', 'app.config.mts', 'app.config.cts']) test(`rejects competing ${name} without execution`, t => {
  const root = temporary(t);
  writeFileSync(join(root, name), 'throw new Error("MUST NEVER EXECUTE")');
  assert.equal(audit(options(root)).issues[0].id, 'input.UNSUPPORTED_CONFIG');
});
test('incomplete takes precedence while preserving supported platform drift', t => {
  const root = temporary(t);
  change(root, paths.project, text => text.replace('CURRENT_PROJECT_VERSION = 17', 'CURRENT_PROJECT_VERSION = 18'));
  change(root, paths.gradle, text => text + 'unknown');
  const result = audit(options(root));
  assert.equal(result.exitCode, 2);
  assert.ok(result.checks.some(check => check.id === 'ios.build' && check.status === 'drift'));
});
test('comments cannot satisfy missing native declarations', t => {
  const root = temporary(t);
  change(root, paths.gradle, text => text.replace('versionCode 17', '// versionCode 17'));
  assert.equal(audit(options(root)).exitCode, 2);
});
test('static root wrapper, platform override and literal iOS plist fields', t => {
  const root = temporary(t);
  change(root, 'app.json', text => { const value = JSON.parse(text).expo; value.version = '9.0'; value.ios.version = '2.4.0'; value.android.version = '2.4.0'; return JSON.stringify(value); });
  change(root, paths.plist, text => text.replace('$(PRODUCT_BUNDLE_IDENTIFIER)', 'org.example.sample').replace('$(MARKETING_VERSION)', '2.4.0').replace('$(CURRENT_PROJECT_VERSION)', '17'));
  assert.equal(audit(options(root)).exitCode, 0);
});
test('selecting extension or unknown configuration is unsupported', () => {
  assert.equal(audit({ ...options(fixture), 'ios-target': 'SampleWidget' }).exitCode, 2);
  assert.equal(audit({ ...options(fixture), 'ios-configuration': 'Unknown' }).exitCode, 2);
});
test('missing file does not pass', t => {
  const root = temporary(t); unlinkSync(join(root, paths.plist));
  assert.equal(audit(options(root)).exitCode, 2);
});
test('alternate module directory with spaces and app root layout', t => {
  const root = temporary(t); mkdirSync(join(root, 'apps/client app'), { recursive: true });
  cpSync(join(root, 'native'), join(root, 'apps/client app/native'), { recursive: true });
  cpSync(join(root, 'app.json'), join(root, 'apps/client app/app.json'));
  const opts = options(root);
  for (const key of ['config', 'ios-project', 'ios-plist', 'android-gradle', 'android-manifest']) opts[key] = 'apps/client app/' + opts[key];
  assert.equal(audit(opts).exitCode, 0);
});
test('wrong manifest selection is unsupported', t => {
  const root = temporary(t); writeFileSync(join(root, 'Other.xml'), read(root, paths.manifest));
  assert.equal(audit({ ...options(root), 'android-manifest': 'Other.xml' }).exitCode, 2);
});
for (const [name, path] of [['absolute', '/outside/app.json'], ['traversal', '../app.json'], ['directory', 'native'], ['Windows separator', '..\\app.json']]) test(`rejects ${name} path`, () => {
  assert.equal(audit({ ...options(fixture), 'ios-plist': path }).exitCode, 2);
});
test('symlink file is rejected', t => {
  const root = temporary(t); unlinkSync(join(root, paths.plist)); symlinkSync(join(fixture, paths.plist), join(root, paths.plist));
  assert.equal(audit(options(root)).exitCode, 2);
});
test('oversized and invalid UTF-8 input are rejected', t => {
  const root = temporary(t);
  writeFileSync(join(root, 'app.json'), ' '.repeat(512 * 1024 + 1));
  assert.equal(audit(options(root)).issues[0].id, 'input.INPUT_LIMIT');
  writeFileSync(join(root, 'app.json'), Buffer.from([0xff, 0xfe]));
  assert.equal(audit(options(root)).issues[0].id, 'input.INVALID_ENCODING');
});
test('permission descriptions and unrelated private values never appear in reports', t => {
  const root = temporary(t);
  change(root, 'app.json', text => { const json = JSON.parse(text); json.expo.extra = { private: 'PRIVATE_SENTINEL' }; json.expo.ios.infoPlist.NSCameraUsageDescription = 'PRIVATE_DESCRIPTION'; return JSON.stringify(json); });
  const result = audit(options(root));
  assert.equal(result.exitCode, 1);
  assert.ok(!JSON.stringify(result).includes('PRIVATE_'));
});
