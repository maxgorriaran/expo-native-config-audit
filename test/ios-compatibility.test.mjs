import test from 'node:test';
import assert from 'node:assert/strict';
import { audit } from '../src/audit.mjs';
import { readIos } from '../src/readers/ios.mjs';
import { temporary, paths, options, change, read, treeHash } from './helpers.mjs';

const signing = '"CODE_SIGN_IDENTITY[sdk=iphoneos*]" = "iPhone Developer";';
const configurations = ['Debug', 'Release'];
// Original synthetic declarations, not copied generated project source.
function project(signAt = 'both', additions = {}) {
  return `{ objects = {
    ROOT = { isa = PBXProject; targets = (APP,); buildConfigurationList = PROJECT_CONFIGS; };
    APP = { isa = PBXNativeTarget; name = Sample; productType = "com.apple.product-type.application"; buildConfigurationList = APP_CONFIGS; };
    PROJECT_CONFIGS = { isa = XCConfigurationList; buildConfigurations = (PROJECT_Debug, PROJECT_Release,); };
    APP_CONFIGS = { isa = XCConfigurationList; buildConfigurations = (APP_Debug, APP_Release,); };
    ${['PROJECT', 'APP'].flatMap(owner => configurations.map(name => `
      ${owner}_${name} = { isa = XCBuildConfiguration; name = ${name}; buildSettings = {
        ${owner === 'APP' ? 'PRODUCT_BUNDLE_IDENTIFIER = org.example.sample; MARKETING_VERSION = 2.4.0; CURRENT_PROJECT_VERSION = 17; INFOPLIST_FILE = Sample/Info.plist;' : ''}
        ${signAt === 'both' || signAt === owner ? signing : ''}
        ${additions[`${owner}_${name}`] ?? ''}
      }; };`)).join('\n')}
  }; rootObject = ROOT; }`;
}
function setup(t, source = project()) {
  const root = temporary(t);
  change(root, paths.project, () => source);
  return root;
}
function checked(root, configuration = 'Release', platform = 'ios') {
  const before = treeHash(root);
  const result = audit({ ...options(root), platform, 'ios-configuration': configuration });
  assert.equal(treeHash(root), before, 'Audit must not alter the fixture');
  return result;
}
function expectUnsupported(root, configuration, issue = 'ios.UNSUPPORTED_SETTINGS') {
  const result = checked(root, configuration);
  assert.equal(result.exitCode, 2, JSON.stringify(result));
  assert.equal(result.coverage, 'incomplete');
  assert.ok(result.issues.some(item => item.id === issue), JSON.stringify(result));
}
const xmlString = value => `<string>${value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')}</string>`;
function nativeSchemes(root, values, raw = false) {
  change(root, paths.plist, text => text.replace(
    /<key>CFBundleURLTypes<\/key><array>[\s\S]*?<\/dict><\/array>/,
    `<key>CFBundleURLTypes</key><array><dict><key>CFBundleURLSchemes</key><array>${raw ? values : values.map(xmlString).join('')}</array></dict></array>`
  ));
}
const requested = ['sample', 'sample-auth', 'sample-ios'];

for (const configuration of configurations) {
  for (const owner of ['PROJECT', 'APP', 'both']) test(`${configuration}: exact signing exception in ${owner} preserves matches and field drift`, t => {
    const root = setup(t, project(owner));
    nativeSchemes(root, [...requested, 'Com.Example.Extra']);
    const match = checked(root, configuration);
    assert.equal(match.exitCode, 0, JSON.stringify(match));
    assert.equal(match.checks.length, 7);
    assert.ok(match.checks.every(item => item.status === 'match'));
    change(root, 'app.json', text => {
      const config = JSON.parse(text);
      config.expo.ios.bundleIdentifier = 'org.example.changed';
      config.expo.version = '2.5.0'; config.expo.ios.buildNumber = '18';
      return JSON.stringify(config);
    });
    const drift = checked(root, configuration);
    assert.equal(drift.exitCode, 1);
    assert.deepEqual(drift.checks.filter(item => item.status === 'drift').map(item => item.id), ['ios.build', 'ios.id', 'ios.version']);
  });
  for (const key of ['PRODUCT_BUNDLE_IDENTIFIER', 'MARKETING_VERSION', 'CURRENT_PROJECT_VERSION', 'INFOPLIST_FILE', 'INFOPLIST_EXPAND_BUILD_SETTINGS', 'UNKNOWN_SETTING', 'CODE_SIGN_STYLE']) {
    test(`${configuration}: conditional ${key} remains unsupported beside signing exception`, t => {
      const root = setup(t, project('both', { [`APP_${configuration}`]: `"${key}[sdk=iphoneos*]" = YES;` }));
      expectUnsupported(root, configuration);
    });
  }
  for (const declaration of [
    '"CODE_SIGN_IDENTITY[sdk=iphonesimulator*]" = "iPhone Developer";',
    '"CODE_SIGN_IDENTITY[sdk=iphoneos*][arch=arm64]" = "iPhone Developer";',
    '"CODE_SIGN_IDENTITY[sdk=iphoneos*]" = "Apple Development";',
    '"CODE_SIGN_IDENTITY[sdk=iphoneos*]" = "";',
    '"CODE_SIGN_IDENTITY[sdk=iphoneos*]" = "$(inherited)";',
    '"CODE_SIGN_IDENTITY[sdk=iphoneos*]" = ("iPhone Developer",);',
    '"CODE_SIGN_IDENTITY[sdk=iphoneos*]" = { identity = "iPhone Developer"; };',
  ]) test(`${configuration}: rejects signing near-miss ${declaration}`, t => {
    const root = setup(t, project().replaceAll(signing, declaration));
    expectUnsupported(root, configuration);
  });
  test(`${configuration}: unselected unsupported settings remain unaudited`, t => {
    const other = configuration === 'Debug' ? 'Release' : 'Debug';
    const root = setup(t, project('both', { [`APP_${other}`]: '"CURRENT_PROJECT_VERSION[sdk=iphoneos*]" = 99;' }));
    const result = checked(root, configuration);
    assert.equal(result.exitCode, 0);
    assert.ok(result.notes.some(note => note.includes('1 other target configuration(s)')));
  });
  for (const setting of ['GENERATE_INFOPLIST_FILE = YES;', 'INFOPLIST_PREPROCESS = YES;', 'INFOPLIST_KEY_CFBundleVersion = 99;', 'INFOPLIST_EXPAND_BUILD_SETTINGS = NO;', 'INFOPLIST_EXPAND_BUILD_SETTINGS = "$(inherited)";']) {
    test(`${configuration}: signing exception does not bypass ${setting}`, t => {
      const root = setup(t, project('both', { [`APP_${configuration}`]: setting }));
      expectUnsupported(root, configuration);
    });
  }
  test(`${configuration}: literal plist versions retain precedence over Xcode versions`, t => {
    const root = setup(t, project().replaceAll('MARKETING_VERSION = 2.4.0', 'MARKETING_VERSION = 1.0').replaceAll('CURRENT_PROJECT_VERSION = 17', 'CURRENT_PROJECT_VERSION = 1'));
    change(root, paths.plist, text => text.replace('$(MARKETING_VERSION)', '2.4.0').replace('$(CURRENT_PROJECT_VERSION)', '17'));
    assert.equal(checked(root, configuration).exitCode, 0);
  });
}

test('iOS native schemes canonicalize ASCII case, sort and deduplicate without extra checks', t => {
  const root = setup(t);
  nativeSchemes(root, ['SAMPLE', 'sample-auth', 'Sample-Ios', 'Com.Example.Extra', 'sample', 'com.example.extra']);
  const result = checked(root);
  assert.equal(result.exitCode, 0, JSON.stringify(result));
  assert.deepEqual(result.checks.filter(item => item.id.startsWith('ios.scheme.')).map(item => item.id), requested.map(value => `ios.scheme.${value}`));
  const native = readIos(read(root, paths.project), read(root, paths.plist), { project: paths.project, plist: paths.plist, target: 'Sample', configuration: 'Release' });
  assert.deepEqual(native.schemes, ['com.example.extra', ...requested]);
});
test('valid extra native scheme cannot satisfy a missing requested scheme', t => {
  const root = setup(t); nativeSchemes(root, ['sample', 'sample-auth', 'Com.Example.Extra']);
  const result = checked(root);
  assert.equal(result.exitCode, 1);
  assert.deepEqual(result.checks.filter(item => item.status === 'drift'), [{ id: 'ios.scheme.sample-ios', status: 'drift', expected: 'sample-ios', actual: null }]);
});
for (const value of ['', 'with space', 'name\n', 'name\r', 'name\t', 'éxample', '1sample', 'sample:', 'sample://host', 'sample/path', 'sample_name', '$(SCHEME)', '${scheme}', 's'.repeat(257)]) {
  test(`invalid extra iOS scheme ${JSON.stringify(value)} cannot hide behind requested matches`, t => {
    const root = setup(t); nativeSchemes(root, [...requested, value]);
    expectUnsupported(root, 'Release', 'ios.INVALID_SCHEME');
  });
}
for (const fragment of ['<integer>7</integer>', '<true/>', '<array><string>nested</string></array>', '<dict/>']) {
  test(`non-string native scheme ${fragment} is unsupported`, t => {
    const root = setup(t); nativeSchemes(root, requested.map(xmlString).join('') + fragment, true);
    expectUnsupported(root, 'Release', 'ios.INVALID_SCHEME');
  });
}
test('iOS scheme limits apply before deduplication, across URL types', t => {
  const root = setup(t);
  nativeSchemes(root, [...requested, 's'.repeat(256), ...Array(124).fill('SAMPLE')]);
  assert.equal(checked(root).exitCode, 0);
  change(root, paths.plist, text => text.replace('</dict></array>', '</dict><dict><key>CFBundleURLSchemes</key><array><string>sample</string></array></dict></array>'));
  expectUnsupported(root, 'Release', 'ios.INVALID_SCHEME');
});
test('no requested schemes: valid extras do not add checks; invalid extras still reject', t => {
  const root = setup(t);
  change(root, 'app.json', text => { const config = JSON.parse(text); delete config.expo.scheme; delete config.expo.ios.scheme; return JSON.stringify(config); });
  nativeSchemes(root, ['Com.Example.Extra']);
  const result = checked(root);
  assert.equal(result.exitCode, 0);
  assert.ok(!result.checks.some(item => item.id.startsWith('ios.scheme.')));
  assert.ok(result.notes.includes('ios: no explicit schemes checks requested.'));
  nativeSchemes(root, ['$(EXTRA)']); expectUnsupported(root, 'Release', 'ios.INVALID_SCHEME');
});
test('iOS canonicalization does not relax requested Expo schemes or Android native schemes', t => {
  const root = setup(t); nativeSchemes(root, ['SAMPLE', 'sample-auth', 'sample-ios']);
  assert.equal(checked(root, 'Release', 'both').exitCode, 0);
  change(root, paths.manifest, text => text.replace('android:scheme="sample"', 'android:scheme="SAMPLE"'));
  const result = checked(root, 'Release', 'both');
  assert.equal(result.exitCode, 2);
  assert.ok(result.issues.some(item => item.id === 'android.INVALID_SCHEME'));
  assert.ok(result.checks.some(item => item.id === 'ios.scheme.sample' && item.status === 'match'));
  change(root, 'app.json', text => { const config = JSON.parse(text); config.expo.scheme = 'SAMPLE'; return JSON.stringify(config); });
  assert.equal(checked(root).issues[0].id, 'input.INVALID_SCHEME');
});
