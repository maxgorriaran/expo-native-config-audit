#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { audit } from '../src/audit.mjs';
import { report, formatText } from '../src/report.mjs';

const help = `Expo Native Config Audit (local v0.1 preview)
Usage: expo-native-config-audit --root DIR --platform ios|android|both [options]
  --config app.json            Static input relative to root (default app.json)
  --ios-project PATH          Selected project.pbxproj relative to root
  --ios-plist PATH            Selected XML Info.plist relative to root
  --ios-target NAME           Application target name
  --ios-configuration NAME    One project/target configuration, e.g. Release
  --android-gradle PATH       Selected module build.gradle relative to root
  --android-manifest PATH     That module's src/main/AndroidManifest.xml
  --format text|json          Deterministic output (default text)
  --help                     Show this help
Exit 0: selected declarations match; 1: drift; 2: incomplete/unsupported input.
No config execution, native commands, writes, network or runtime validation.
`;
let result, format = process.argv.includes('--format=json') || process.argv.some((arg, index) => arg === '--format' && process.argv[index + 1] === 'json') ? 'json' : 'text';
try {
  const names = ['root', 'platform', 'config', 'ios-project', 'ios-plist', 'ios-target', 'ios-configuration', 'android-gradle', 'android-manifest', 'format'];
  const { values, tokens } = parseArgs({ options: { ...Object.fromEntries(names.map(name => [name, { type: 'string' }])), help: { type: 'boolean' } }, strict: true, allowPositionals: false, tokens: true });
  const flags = tokens.filter(token => token.kind === 'option').map(token => token.name);
  if (new Set(flags).size !== flags.length) throw new Error('Duplicate flags');
  if (values.help) { process.stdout.write(help); process.exit(0); }
  if (!values.root || !['ios', 'android', 'both'].includes(values.platform) || (values.format && !['text', 'json'].includes(values.format))) throw new Error('Invalid flags');
  const required = values.platform === 'both' ? names.slice(3, 9) : values.platform === 'ios' ? names.slice(3, 7) : names.slice(7, 9);
  if (required.some(name => !values[name])) throw new Error('Missing selection');
  if (names.slice(3, 9).some(name => !required.includes(name) && values[name])) throw new Error('Unexpected platform selection');
  if (Object.values(values).some(value => typeof value === 'string' && (value.length > 2048 || /[\x00-\x1f\x7f]/.test(value)))) throw new Error('Invalid flags');
  format = values.format ?? 'text';
  result = audit({ ...values, config: values.config ?? 'app.json' });
} catch {
  result = report({}, [], [{ id: 'cli.INVALID_ARGUMENTS', message: 'Invalid or incomplete arguments. Use --help for required selections.' }], []);
}
process.stdout.write(format === 'json' ? JSON.stringify(result, null, 2) + '\n' : formatText(result));
process.exitCode = result.exitCode;
