import { posix } from 'node:path';
import { parseData } from '../syntax.mjs';
import { parsePlist } from './xml.mjs';
import { IOS_PERMISSIONS, schemes } from './expo.mjs';
import { requireInput as need, object, nonempty } from '../errors.mjs';

export function readIos(projectText, plistText, selection) {
  const project = parseData(projectText, 'pbx');
  const objects = project.objects;
  need(object(objects), 'INVALID_PROJECT', 'Missing Xcode objects dictionary.');
  const ref = (id, isa) => {
    const item = typeof id === 'string' && Object.hasOwn(objects, id) ? objects[id] : undefined;
    need(object(item) && item.isa === isa, 'INVALID_PROJECT', 'Invalid Xcode object reference.'); return item;
  };
  const root = ref(project.rootObject, 'PBXProject');
  need(!root.projectDirPath && !root.projectRoot, 'UNSUPPORTED_SETTINGS', 'Custom Xcode project source roots are unsupported.');
  need(Array.isArray(root.targets), 'INVALID_PROJECT', 'Missing target list.');
  const targets = root.targets.map(id => objects[id]);
  need(targets.every(object), 'INVALID_PROJECT', 'Invalid target reference.');
  const chosen = targets.filter(item => item.isa === 'PBXNativeTarget' && item.name === selection.target);
  need(chosen.length === 1 && chosen[0].productType === 'com.apple.product-type.application', 'UNSUPPORTED_TARGET', 'Select exactly one application target by name.');
  function configuration(id) {
    const list = ref(id, 'XCConfigurationList');
    need(Array.isArray(list.buildConfigurations), 'INVALID_PROJECT', 'Invalid configuration list.');
    const configurations = list.buildConfigurations.map(key => ref(key, 'XCBuildConfiguration'));
    const matches = configurations.filter(item => item.name === selection.configuration);
    need(matches.length === 1, 'UNSUPPORTED_CONFIGURATION', 'Select one existing configuration in both project and target.');
    const item = matches[0];
    need(!item.baseConfigurationReference && object(item.buildSettings), 'UNSUPPORTED_SETTINGS', 'xcconfig inheritance or missing build settings is unsupported.');
    const settings = item.buildSettings;
    need(!Object.keys(settings).some(key => key.includes('[')), 'UNSUPPORTED_SETTINGS', 'Conditional build settings are unsupported.');
    return { settings, count: configurations.length };
  }
  const projectConfig = configuration(root.buildConfigurationList);
  const targetConfig = configuration(chosen[0].buildConfigurationList);
  const settings = { ...projectConfig.settings, ...targetConfig.settings };
  need(!['YES', true].includes(settings.GENERATE_INFOPLIST_FILE), 'UNSUPPORTED_SETTINGS', 'Generated Info.plist is unsupported.');
  need(!Object.keys(settings).some(key => key.startsWith('INFOPLIST_KEY_')), 'UNSUPPORTED_SETTINGS', 'Info.plist build-setting overrides are unsupported.');
  need(!['YES', true].includes(settings.INFOPLIST_PREPROCESS), 'UNSUPPORTED_SETTINGS', 'Info.plist preprocessing is unsupported.');
  need(nonempty(settings.INFOPLIST_FILE) && !settings.INFOPLIST_FILE.includes('$'), 'UNSUPPORTED_SETTINGS', 'A literal INFOPLIST_FILE binding is required.');
  const binding = settings.INFOPLIST_FILE;
  need(!posix.isAbsolute(binding) && !binding.includes('\\') && !/^[A-Za-z]:/.test(binding), 'UNSUPPORTED_SETTINGS', 'INFOPLIST_FILE must be a relative path within the selected app root.');
  // Selections are already validated as app-root-relative paths by the reader.
  // Keep this comparison in that coordinate system, never the caller's cwd.
  const sourceRoot = posix.dirname(posix.dirname(selection.project));
  const boundPlist = posix.normalize(posix.join(sourceRoot, binding));
  need(boundPlist !== '..' && !boundPlist.startsWith('../'), 'UNSUPPORTED_SETTINGS', 'INFOPLIST_FILE must remain within the selected app root.');
  need(boundPlist === posix.normalize(selection.plist), 'PLIST_SELECTION_MISMATCH', 'Selected plist does not match the selected target/configuration.');
  const plist = parsePlist(plistText);
  need(object(plist), 'INVALID_PLIST', 'Expected a plist dictionary.');
  function field(key, setting) {
    const value = plist[key];
    if (value === `$(${setting})` || value === '${' + setting + '}') {
      need(nonempty(settings[setting]) && !settings[setting].includes('$'), 'UNSUPPORTED_SETTINGS', 'A covered build setting is missing or unresolved.');
      return settings[setting];
    }
    need(nonempty(value) && !value.includes('$'), 'UNSUPPORTED_SETTINGS', 'A covered plist field is missing or unresolved.');
    return value;
  }
  const types = plist.CFBundleURLTypes ?? [];
  need(Array.isArray(types) && types.every(item => object(item) && Array.isArray(item.CFBundleURLSchemes)), 'INVALID_SCHEME', 'Invalid iOS URL type declarations.');
  const permissions = { required: Object.create(null), blocked: [] };
  for (const key of IOS_PERMISSIONS) {
    if (Object.hasOwn(plist, key)) {
      need(typeof plist[key] === 'string' && plist[key].length <= 4096 && !plist[key].includes('$'), 'UNSUPPORTED_PERMISSION', 'Native usage descriptions must be literal strings.');
      permissions.required[key] = plist[key];
    }
  }
  return {
    id: field('CFBundleIdentifier', 'PRODUCT_BUNDLE_IDENTIFIER'),
    version: field('CFBundleShortVersionString', 'MARKETING_VERSION'),
    build: field('CFBundleVersion', 'CURRENT_PROJECT_VERSION'),
    schemes: schemes(types.flatMap(item => item.CFBundleURLSchemes)), permissions,
    unauditedTargets: targets.length - 1,
    unauditedConfigurations: targetConfig.count - 1,
  };
}
