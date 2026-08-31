import test from 'node:test';
import assert from 'node:assert/strict';
import { temporary, change, paths, run, treeHash } from './helpers.mjs';

const literalPlist = text => text
  .replace('$(PRODUCT_BUNDLE_IDENTIFIER)', 'org.example.sample')
  .replace('$(MARKETING_VERSION)', '2.4.0')
  .replace('$(CURRENT_PROJECT_VERSION)', '17');
const targetExpansion = (text, value) => text.replace('INFOPLIST_FILE =', `INFOPLIST_EXPAND_BUILD_SETTINGS = ${value}; INFOPLIST_FILE =`);
const projectExpansion = (text, value) => text.replace('MARKETING_VERSION = 2.4.0;', `MARKETING_VERSION = 2.4.0; INFOPLIST_EXPAND_BUILD_SETTINGS = ${value};`);

function check(root, exit, issue) {
  const before = treeHash(root), result = run(root, ['--format=json']);
  assert.equal(result.status, exit, result.stdout);
  assert.equal(result.stderr, '');
  const report = JSON.parse(result.stdout);
  if (issue) {
    assert.equal(report.coverage, 'incomplete');
    assert.ok(report.issues.some(item => item.id === issue), result.stdout);
  }
  assert.equal(run(root, ['--format=json']).stdout, result.stdout);
  assert.equal(treeHash(root), before);
  return report;
}

for (const [setting, literal] of [
  ['PRODUCT_BUNDLE_IDENTIFIER', 'org.example.sample'],
  ['MARKETING_VERSION', '2.4.0'],
  ['CURRENT_PROJECT_VERSION', '17'],
]) {
  for (const reference of [`$(${setting})`, '${' + setting + '}']) {
    test(`disabled expansion rejects the sole covered reference ${reference}`, t => {
      const root = temporary(t);
      change(root, paths.project, text => targetExpansion(text, 'NO'));
      change(root, paths.plist, text => literalPlist(text).replace(`<string>${literal}</string>`, `<string>${reference}</string>`));
      const result = check(root, 2, 'ios.UNSUPPORTED_SETTINGS');
      assert.ok(!result.checks.some(item => item.id.startsWith('ios.') && item.status === 'match'));
      assert.ok(result.checks.some(item => item.id === 'android.build' && item.status === 'match'));
    });
  }
}

for (const [name, transform, exit] of [
  ['project NO inherited', text => projectExpansion(text, 'NO'), 2],
  ['target YES overrides project NO', text => targetExpansion(projectExpansion(text, 'NO'), 'YES'), 0],
  ['target NO overrides project YES', text => targetExpansion(projectExpansion(text, 'YES'), 'NO'), 2],
  ['explicit YES', text => targetExpansion(text, 'YES'), 0],
  ['unresolved expansion value', text => targetExpansion(text, '"$(inherited)"'), 2],
  ['unknown expansion value', text => targetExpansion(text, 'MAYBE'), 2],
]) test(`plist expansion setting: ${name}`, t => {
  const root = temporary(t);
  change(root, paths.project, transform);
  check(root, exit, exit === 2 ? 'ios.UNSUPPORTED_SETTINGS' : undefined);
});

test('disabled expansion still permits literal covered plist values', t => {
  const root = temporary(t);
  change(root, paths.project, text => targetExpansion(text, 'NO'));
  change(root, paths.plist, literalPlist);
  check(root, 0);
});

test('unsupported expansion takes precedence over supported Android drift', t => {
  const root = temporary(t);
  change(root, paths.project, text => targetExpansion(text, 'NO'));
  change(root, paths.gradle, text => text.replace('versionCode 17', 'versionCode 18'));
  const result = check(root, 2, 'ios.UNSUPPORTED_SETTINGS');
  assert.ok(result.checks.some(item => item.id === 'android.build' && item.status === 'drift'));
});

for (const attribute of ['query', 'fragment', 'pathPrefix']) {
  for (const allow of ['true', 'false']) test(`URI group ${attribute} with allow=${allow} is unsupported`, t => {
    const root = temporary(t);
    change(root, paths.manifest, text => text.replace('</intent-filter>', `<uri-relative-filter-group android:allow="${allow}"><data android:${attribute}="preview" /></uri-relative-filter-group></intent-filter>`));
    const result = check(root, 2, 'android.UNSUPPORTED_SCHEME');
    assert.ok(!result.checks.some(item => item.id.startsWith('android.') && item.status === 'match'));
    assert.ok(result.checks.some(item => item.id === 'ios.build' && item.status === 'match'));
  });
}

test('URI groups cannot bypass validation in a filter without a direct scheme', t => {
  const root = temporary(t);
  change(root, paths.manifest, text => text.replace('</activity>', '<intent-filter><uri-relative-filter-group><data android:query="preview" /></uri-relative-filter-group></intent-filter></activity>'));
  check(root, 2, 'android.UNSUPPORTED_SCHEME');
});

test('URI groups on activity aliases are unsupported', t => {
  const root = temporary(t);
  change(root, paths.manifest, text => text.replace('<activity ', '<activity-alias ').replace('</activity>', '</activity-alias>').replace('</intent-filter>', '<uri-relative-filter-group><data android:query="preview" /></uri-relative-filter-group></intent-filter>'));
  check(root, 2, 'android.UNSUPPORTED_SCHEME');
});
