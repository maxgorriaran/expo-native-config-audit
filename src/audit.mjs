import { reader } from './read-inputs.mjs';
import { readExpo } from './readers/expo.mjs';
import { readIos } from './readers/ios.mjs';
import { readAndroid } from './readers/android.mjs';
import { compare } from './compare.mjs';
import { report } from './report.mjs';
import { InputError, requireInput as need } from './errors.mjs';

export function audit(options) {
  const platforms = options.platform === 'both' ? ['android', 'ios'] : [options.platform];
  const scope = { platforms, config: options.config };
  if (platforms.includes('ios')) scope.ios = { project: options['ios-project'], plist: options['ios-plist'], target: options['ios-target'], configuration: options['ios-configuration'] };
  if (platforms.includes('android')) scope.android = { gradle: options['android-gradle'], manifest: options['android-manifest'] };
  const issues = [], actual = {}, notes = ['Only selected source declarations are audited; effective builds, merged manifests, other targets/configurations and runtime behavior are not proved.'];
  const issue = (platform, error) => issues.push({ id: `${platform}.${error instanceof InputError ? error.code : 'INVALID_INPUT'}`, message: error instanceof InputError ? error.message : 'Cannot interpret the selected input.' });
  let input, expected;
  try { input = reader(options.root); input.checkStatic(options.config); expected = readExpo(input.read(options.config), platforms); }
  catch (error) { issue('input', error); return report(scope, [], issues, notes); }
  for (const platform of platforms) {
    try {
      if (platform === 'ios') {
        need(scope.ios.project.endsWith('/project.pbxproj') && scope.ios.plist.endsWith('.plist'), 'UNSUPPORTED_LAYOUT', 'Select project.pbxproj and an XML .plist file.');
        actual.ios = readIos(input.read(scope.ios.project), input.read(scope.ios.plist), scope.ios);
        notes.push(`iOS: ${actual.ios.unauditedTargets} other target(s) and ${actual.ios.unauditedConfigurations} other target configuration(s) are not audited.`);
      } else {
        need(scope.android.gradle.endsWith('build.gradle') && scope.android.manifest.endsWith('/src/main/AndroidManifest.xml'), 'UNSUPPORTED_LAYOUT', 'Select build.gradle and its main AndroidManifest.xml.');
        actual.android = readAndroid(input.read(scope.android.gradle), input.read(scope.android.manifest), scope.android);
        notes.push(`Android: ${actual.android.extraPermissions} other permission declaration(s) are outside the supported subset.`);
      }
      for (const family of ['schemes', 'permissions']) {
        if (family === 'schemes' ? expected[platform].schemes.length === 0 : Object.keys(expected[platform].permissions.required).length + expected[platform].permissions.blocked.length === 0) notes.push(`${platform}: no explicit ${family} checks requested.`);
      }
    } catch (error) { issue(platform, error); }
  }
  return report(scope, compare(expected, actual), issues, notes);
}
