import { fileURLToPath } from 'node:url';
import { readFileSync, mkdtempSync, cpSync, rmSync, writeFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';

export const fixture = fileURLToPath(new URL('./fixtures/matching/', import.meta.url));
export const cli = fileURLToPath(new URL('../bin/audit.mjs', import.meta.url));
export const paths = {
  project: 'native/ios/Sample.xcodeproj/project.pbxproj',
  plist: 'native/ios/Sample/Info.plist',
  gradle: 'native/android/sample/build.gradle',
  manifest: 'native/android/sample/src/main/AndroidManifest.xml',
};
export const options = root => ({ root, platform: 'both', config: 'app.json', 'ios-project': paths.project, 'ios-plist': paths.plist, 'ios-target': 'Sample', 'ios-configuration': 'Release', 'android-gradle': paths.gradle, 'android-manifest': paths.manifest });
export const args = root => Object.entries(options(root)).flatMap(([name, value]) => [`--${name}`, value]);
export const read = (root, name) => readFileSync(join(root, name), 'utf8');
export const change = (root, name, transform) => writeFileSync(join(root, name), transform(read(root, name)));
export function temporary(t) {
  const root = mkdtempSync(join(tmpdir(), 'native audit fixture '));
  cpSync(fixture, root, { recursive: true });
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
}
export function run(root, extra = []) {
  const result = spawnSync(process.execPath, [cli, ...args(root), ...extra], { encoding: 'utf8', timeout: 10000 });
  if (result.error) throw result.error;
  return result;
}
export function treeHash(root) {
  const hash = createHash('sha256');
  function walk(folder) {
    for (const item of readdirSync(join(root, folder), { withFileTypes: true }).sort((a, b) => a.name < b.name ? -1 : 1)) {
      const name = join(folder, item.name);
      hash.update(name); hash.update('\0');
      if (item.isDirectory()) walk(name); else hash.update(readFileSync(join(root, name)));
      hash.update('\0');
    }
  }
  walk(''); return hash.digest('hex');
}
