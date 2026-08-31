import { dirname, join, normalize } from 'node:path';
import { tokenize } from '../syntax.mjs';
import { children, parseXml } from './xml.mjs';
import { ANDROID_PERMISSIONS, schemes } from './expo.mjs';
import { requireInput as need, nonempty } from '../errors.mjs';

const ANDROID = 'http://schemas.android.com/apk/res/android';
const TOOLS = 'http://schemas.android.com/tools';

export function readGradle(text) {
  const tokens = tokenize(text, 'gradle'); let i = 0;
  const take = (type, name) => {
    const token = tokens[i++];
    need(token?.type === type && (name === undefined || token.value === name), 'UNSUPPORTED_GRADLE', 'Gradle is outside the supported literal declaration grammar.');
    return token;
  };
  function statementEnd() {
    if (tokens[i]?.type === ';') { i++; return; }
    need(!tokens[i] || tokens[i].type === '}' || /[\r\n]/.test(text.slice(tokens[i - 1].end, tokens[i].start)), 'INVALID_GRADLE', 'Gradle statements require a newline or semicolon.');
  }
  const seen = new Set(); const values = Object.create(null);
  const strings = new Set(['namespace', 'applicationId', 'versionName']);
  function block(context) {
    take('{');
    while (tokens[i]?.type !== '}') {
      const name = take('word').value;
      const key = `${context}.${name}`;
      need(!seen.has(key), 'UNSUPPORTED_GRADLE', 'Duplicate Gradle declarations are unsupported.'); seen.add(key);
      if (context === 'android' && name === 'defaultConfig') { block('defaultConfig'); statementEnd(); continue; }
      const allowed = context === 'android' ? ['namespace', 'compileSdk', 'compileSdkVersion'] : ['applicationId', 'versionName', 'versionCode', 'minSdk', 'minSdkVersion', 'targetSdk', 'targetSdkVersion'];
      need(allowed.includes(name), 'UNSUPPORTED_GRADLE', 'Computed values, build types, flavors and unrecognized Gradle statements are unsupported.');
      if (tokens[i]?.type === '=') i++;
      const token = take(strings.has(name) ? 'string' : 'word');
      // Groovy interprets leading-zero integers as octal; this subset is decimal-only.
      need(strings.has(name) ? nonempty(token.value) && !token.value.includes('$') : /^(0|[1-9]\d*)$/.test(token.value) && Number.isSafeInteger(Number(token.value)), 'UNSUPPORTED_GRADLE', 'Gradle values must be literal strings or canonical decimal integers.');
      values[name] = strings.has(name) ? token.value : Number(token.value);
      statementEnd();
    }
    take('}');
  }
  if (tokens[i]?.value === 'plugins') {
    take('word', 'plugins'); take('{'); take('word', 'id'); take('string', 'com.android.application');
    statementEnd(); take('}'); statementEnd();
  }
  take('word', 'android'); block('android');
  if (tokens[i]?.type === ';') i++;
  need(i === tokens.length, 'UNSUPPORTED_GRADLE', 'Additional Gradle logic is unsupported.');
  for (const names of [['compileSdk', 'compileSdkVersion'], ['minSdk', 'minSdkVersion'], ['targetSdk', 'targetSdkVersion']]) {
    need(names.filter(name => Object.hasOwn(values, name)).length <= 1, 'UNSUPPORTED_GRADLE', 'Competing Gradle aliases are unsupported.');
  }
  need(nonempty(values.applicationId) && nonempty(values.versionName) && Number.isSafeInteger(values.versionCode) && values.versionCode > 0, 'MISSING_FIELD', 'Gradle must declare applicationId, versionName and positive versionCode.');
  // Namespace identifies generated code; it is deliberately not treated as applicationId.
  return { id: values.applicationId, version: values.versionName, build: values.versionCode };
}

export function readAndroid(gradleText, manifestText, selection) {
  need(selection.gradle.endsWith('/build.gradle') || selection.gradle === 'build.gradle', 'UNSUPPORTED_GRADLE', 'Select a Groovy build.gradle file.');
  need(normalize(selection.manifest) === join(dirname(selection.gradle), 'src/main/AndroidManifest.xml'), 'MANIFEST_SELECTION_MISMATCH', 'Select the main manifest belonging to the selected module.');
  const values = readGradle(gradleText);
  const manifest = parseXml(manifestText, 'manifest');
  need(manifest.tagName === 'manifest', 'INVALID_MANIFEST', 'Expected a manifest document.');
  function validate(node) {
    need(!node.namespaceURI, 'UNSUPPORTED_MANIFEST', 'Namespaced manifest elements are unsupported.');
    need(node.tagName !== 'uri-relative-filter-group', 'UNSUPPORTED_SCHEME', 'URI-relative filter groups and their nested restrictions are unsupported.');
    for (const attribute of Array.from(node.attributes)) {
      if (attribute.namespaceURI !== TOOLS) continue;
      need(node.tagName === 'uses-permission' && attribute.localName === 'node' && attribute.value === 'remove', 'UNSUPPORTED_MANIFEST', 'Only permission removal merger directives are supported.');
    }
    for (const child of children(node)) validate(child);
  }
  validate(manifest);
  const applications = children(manifest).filter(node => node.tagName === 'application');
  need(applications.length === 1, 'INVALID_MANIFEST', 'Expected one application element.');
  const attr = (node, name) => node.getAttributeNS(ANDROID, name);
  const permissions = { required: Object.create(null), blocked: [] };
  let extraPermissions = 0;
  const declared = new Set();
  for (const node of children(manifest)) {
    if (!node.tagName.startsWith('uses-permission')) continue;
    need(node.tagName === 'uses-permission', 'UNSUPPORTED_PERMISSION', 'SDK-qualified permission elements are unsupported.');
    const name = attr(node, 'name');
    need(nonempty(name) && !name.includes('$'), 'INVALID_PERMISSION', 'Manifest permission names must be literal.');
    need(!declared.has(name), 'UNSUPPORTED_PERMISSION', 'Duplicate permission declarations are unsupported.'); declared.add(name);
    const attributes = Array.from(node.attributes).filter(item => item.namespaceURI !== 'http://www.w3.org/2000/xmlns/');
    need(attributes.every(item => (item.namespaceURI === ANDROID && item.localName === 'name') || (item.namespaceURI === TOOLS && item.localName === 'node' && item.value === 'remove')), 'UNSUPPORTED_PERMISSION', 'Conditional permission attributes and other merger directives are unsupported.');
    if (!ANDROID_PERMISSIONS.includes(name)) { extraPermissions++; continue; }
    if (node.getAttributeNS(TOOLS, 'node') === 'remove') permissions.blocked.push(name);
    else permissions.required[name] = true;
  }
  const declaredSchemes = [];
  for (const activity of children(applications[0])) {
    if (!['activity', 'activity-alias'].includes(activity.tagName)) continue;
    for (const filter of children(activity).filter(node => node.tagName === 'intent-filter')) {
      const parts = children(filter);
      const data = parts.filter(node => node.tagName === 'data' && node.hasAttributeNS(ANDROID, 'scheme'));
      if (!data.length) continue;
      need(parts.some(node => node.tagName === 'action' && attr(node, 'name') === 'android.intent.action.VIEW') && ['android.intent.category.BROWSABLE', 'android.intent.category.DEFAULT'].every(category => parts.some(node => node.tagName === 'category' && attr(node, 'name') === category)), 'UNSUPPORTED_SCHEME', 'Scheme declarations require VIEW, BROWSABLE and DEFAULT in the same intent filter.');
      for (const node of parts.filter(item => item.tagName === 'data')) {
        need(Array.from(node.attributes).every(item => item.namespaceURI === ANDROID && item.localName === 'scheme'), 'UNSUPPORTED_SCHEME', 'Restricted or indirect intent-filter data is unsupported.');
      }
      for (const node of data) declaredSchemes.push(attr(node, 'scheme'));
    }
  }
  return { ...values, schemes: schemes(declaredSchemes), permissions, extraPermissions };
}
