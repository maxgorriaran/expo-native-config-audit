import { parseData } from '../syntax.mjs';
import { requireInput as need, object, nonempty } from '../errors.mjs';

export const IOS_PERMISSIONS = ['NSCameraUsageDescription', 'NSMicrophoneUsageDescription'];
export const ANDROID_PERMISSIONS = ['android.permission.CAMERA', 'android.permission.RECORD_AUDIO'];
export function schemes(value) {
  const list = value === undefined ? [] : typeof value === 'string' ? [value] : value;
  need(Array.isArray(list) && list.length <= 128 && list.every(item => typeof item === 'string' && /^[a-z][a-z0-9+.-]*$/.test(item) && item.length <= 256), 'INVALID_SCHEME', 'Schemes must be literal scheme strings or arrays.');
  return [...new Set(list)].sort();
}
export function readExpo(text, platforms) {
  const root = parseData(text);
  need(object(root), 'INVALID_CONFIG', 'Expected an app configuration object.');
  const expo = Object.hasOwn(root, 'expo') ? root.expo : root;
  need(object(expo), 'INVALID_CONFIG', 'Expected an Expo configuration object.');
  need(expo.plugins === undefined || (Array.isArray(expo.plugins) && expo.plugins.length === 0), 'UNSUPPORTED_PLUGINS', 'Config plugins may alter audited declarations; plugin resolution is unsupported.');
  const result = {};
  for (const platform of platforms) {
    const config = expo[platform];
    need(object(config), 'MISSING_FIELD', 'Selected platform configuration is required.');
    const id = platform === 'ios' ? config.bundleIdentifier : config.package;
    const version = config.version ?? expo.version;
    const build = platform === 'ios' ? config.buildNumber : config.versionCode;
    need(nonempty(id) && /^[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)+$/.test(id), 'MISSING_FIELD', 'A literal platform identifier is required.');
    need(nonempty(version) && /^\d+(?:\.\d+){0,2}$/.test(version), 'INVALID_VERSION', 'An explicit numeric version string is required.');
    need(platform === 'ios' ? nonempty(build) && /^\d+(?:\.\d+){0,2}$/.test(build) : Number.isSafeInteger(build) && build > 0, 'INVALID_BUILD', 'An explicit platform build number is required.');
    const permissions = { required: Object.create(null), blocked: [] };
    if (platform === 'ios') {
      const plist = config.infoPlist ?? {};
      need(object(plist), 'INVALID_CONFIG', 'ios.infoPlist must be an object.');
      // Audit no arbitrary values, but reject declaration overrides of covered keys.
      need(!['CFBundleIdentifier', 'CFBundleVersion', 'CFBundleShortVersionString', 'CFBundleURLTypes'].some(key => Object.hasOwn(plist, key)), 'UNSUPPORTED_OVERRIDE', 'Covered values overridden via ios.infoPlist are unsupported.');
      for (const key of Object.keys(plist)) {
        if (!key.endsWith('UsageDescription')) continue;
        need(IOS_PERMISSIONS.includes(key), 'UNSUPPORTED_PERMISSION', 'A requested iOS usage description is outside the supported subset.');
        need(typeof plist[key] === 'string' && plist[key].trim().length > 0 && plist[key].length <= 4096 && !plist[key].includes('$'), 'INVALID_PERMISSION', 'Usage descriptions must be explicit nonempty strings.');
        permissions.required[key] = plist[key];
      }
    } else {
      need(config.intentFilters === undefined || (Array.isArray(config.intentFilters) && config.intentFilters.length === 0), 'UNSUPPORTED_SCHEME', 'Custom Android intentFilters are unsupported.');
      for (const field of ['permissions', 'blockedPermissions']) {
        const list = config[field] ?? [];
        need(Array.isArray(list) && list.every(item => typeof item === 'string'), 'INVALID_PERMISSION', 'Permission declarations must be arrays of strings.');
        for (let item of list) {
          if (field === 'permissions' && !item.includes('.')) item = `android.permission.${item}`;
          need(ANDROID_PERMISSIONS.includes(item), 'UNSUPPORTED_PERMISSION', 'A requested Android permission is outside the supported subset.');
          if (field === 'permissions') permissions.required[item] = true;
          else permissions.blocked.push(item);
        }
      }
      need(!permissions.blocked.some(item => Object.hasOwn(permissions.required, item)), 'INVALID_PERMISSION', 'A permission cannot be both required and blocked.');
      permissions.blocked = [...new Set(permissions.blocked)].sort();
    }
    result[platform] = { id, version, build, schemes: [...new Set([...schemes(expo.scheme), ...schemes(config.scheme)])].sort(), permissions };
  }
  return result;
}
