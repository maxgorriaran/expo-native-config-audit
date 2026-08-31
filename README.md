# Expo Native Config Audit

Read-only Node CLI comparing selected **static declarations** in Expo app.json
and native iOS/Android files. Reports drift without changing an app or executing
its configuration. Complements Expo Doctor; never disables its checks.

**Local v0.1 preview, not a published release.** No public install command exists.
Licensed under MIT; the package remains marked private to prevent npm publication.
This is not certification of an effective build, permission consent, or release
readiness. No blanket Expo SDK compatibility claim is made.

## Try the synthetic example

Requires Node 22 or newer and npm, on macOS or Linux. From this project folder:

```sh
npm ci --ignore-scripts
npm run demo
npm run demo -- --format json
npm test
npm run smoke:package
```

The demo uses original synthetic fixtures, including three iOS target
configurations and an extension. They are parser fixtures, not buildable apps.

For a selected app, use its app root and explicit native paths:

```sh
node bin/audit.mjs --root /path/to/app --platform both \
  --ios-project ios/Sample.xcodeproj/project.pbxproj \
  --ios-plist ios/Sample/Info.plist \
  --ios-target Sample --ios-configuration Release \
  --android-gradle android/app/build.gradle \
  --android-manifest android/app/src/main/AndroidManifest.xml \
  --format json
```

Paths other than `--root` must be relative to that root. Use `--platform ios` or
`--platform android` with only that platform's selections. `--config` defaults
to `app.json`; a nested app.json can be explicitly selected for a monorepo.
No directory discovery, target guessing, writes, subprocesses, network requests,
dependency loading from the audited app, or environment-file reads occur.

## Exact support boundary

| Input | Supported | Incomplete (exit 2) |
| --- | --- | --- |
| Expo | Strict UTF-8 app.json; root object or `expo` wrapper; explicit identifiers/builds; root/platform versions and string/array schemes | Dynamic sibling app.config.js/ts/mjs/cjs/mts/cts; competing app.config.json; nonempty config plugins; inferred values; custom Android intentFilters |
| iOS project | Bounded OpenStep dictionaries, arrays, strings; comments; selected application target and one named configuration; project settings then target settings | xcconfig inheritance; custom source roots; conditional settings; unsupported escapes/data syntax; ambiguous/missing target/configuration |
| iOS plist | XML dict/array/string/integer/boolean values; conventional Apple plist DOCTYPE (not fetched); explicit plist binding via INFOPLIST_FILE | Binary plist; other value types; DTD/entity declarations; generated/preprocessed plist; INFOPLIST_KEY overrides |
| iOS identity/version/build | Literal CFBundleIdentifier, CFBundleShortVersionString, CFBundleVersion; or exact references to PRODUCT_BUNDLE_IDENTIFIER, MARKETING_VERSION, CURRENT_PROJECT_VERSION | Other substitutions, missing native values; covered fields overridden through Expo ios.infoPlist |
| Android | One selected module's build.gradle and src/main/AndroidManifest.xml; literal grammar below | Kotlin DSL, buildTypes, flavors, suffixes, scripts, expressions, variables, custom source sets, duplicate/competing assignments |
| Schemes | Required set inclusion; root/platform declarations combined; iOS CFBundleURLTypes; Android VIEW + DEFAULT + BROWSABLE in one intent filter | Scheme placeholders, restricted data attributes, missing filter structure, merger directives on filters |
| iOS permissions | Explicit NSCameraUsageDescription and NSMicrophoneUsageDescription equality | Other requested usage-description keys, nonliteral descriptions; no plugin-derived policy |
| Android permissions | Explicit CAMERA/RECORD_AUDIO requirements and fully qualified blockedPermissions; native uses-permission plus tools:node="remove" | Other requested permissions, SDK/attribute qualifiers, duplicate declarations, other merger directives |

Platform `version` takes precedence over root `version`. Versions accept numeric
strings with one to three components. iOS build numbers are numeric strings;
Android versionCode is a positive safe integer. This subset is not store validation.

INFOPLIST_FILE must be relative to the Xcode project source directory and resolve
within the selected app root. Absolute paths and root escapes are unsupported.
Binding checks do not depend on the terminal's working directory.

Literal plist fields are compared directly. The corresponding Xcode build
setting is consulted only when the plist references it. Unselected targets and
configurations are counted and explicitly unaudited, including extensions.
Build scripts, command-line settings, dependencies and effective native builds
are never resolved.

### Deliberately narrow Gradle grammar

An optional `plugins { id 'com.android.application' }` block may precede one
`android { ... }` block. Only these fields are accepted:

- `android`: optional literal namespace; compileSdk or compileSdkVersion;
  one defaultConfig block.
- `defaultConfig`: required applicationId, versionName, versionCode; optional
  minSdk/minSdkVersion and targetSdk/targetSdkVersion.

Strings use single/double quotes; numeric fields use canonical decimal integers
(`0` or a nonzero digit followed by digits). Leading-zero forms such as `021`
are unsupported (exit 2), not interpreted as decimal. versionCode must still be
positive. An `=` is optional. Statements need newlines or semicolons. Comments are ignored.
Namespace is deliberately not compared with applicationId. No unknown block
or statement is silently skipped. Many normal generated Expo Gradle files will
therefore return unsupported in this preview. Do not simplify a working app's
build scripts to obtain a green result.

### Permissions and coverage

A required Android permission must have a positive declaration. A blocked
permission must have an explicit removal marker, not merely be absent from the
selected main manifest. The final merged manifest is not inspected. Other
native permissions are outside the requested subset, not automatically drift.
Extra native schemes are allowed. An absent Expo scheme or permission request
is noted as not requested; it does not claim permission completeness.

Reports include a schema version, selected scope, stable check IDs, coverage,
checks, issues and notes. Expected/actual values appear only for identifiers,
versions/builds and requested schemes. Permission descriptions are compared
without printing them. No root absolute path, timestamps or full input dumps
are included. These reports can still contain app identifiers; review them
before sharing.

| Exit | Meaning |
| --- | --- |
| 0 | Every requested declaration check is supported and matches |
| 1 | Complete requested coverage with drift |
| 2 | Invalid, unsupported or incomplete input; takes precedence over drift |

Missing native files/required fields are incomplete, not an all-clear. When one
native platform is unsupported, the report retains findings from the other.
No selections or invalid flags also return 2. Help returns 0 without auditing.

## Safety and implementation

Original ESM comparison core, bounded file readers, strict recursive-descent
JSON/OpenStep subset parsing, and one pinned XML dependency: @xmldom/xmldom
0.9.12 (MIT). Its license ships with its separately installed npm package.
There is no framework, compiler, Expo dependency, auto-fix or native tool call.

Inputs are limited to 512 KiB each, 60,000 lexical tokens, nesting depth 48,
and 30,000 XML nodes. Duplicate keys, malformed encodings and trailing content
are rejected. Input paths beneath the canonical root cannot traverse parents
or symlink components. Reads use
regular-file checks, bounded buffers and per-file change checks. This is not
an OS sandbox or an atomic snapshot of a concurrently edited tree; audit stable
local files. No claim of a completed independent security review is made.

`src/compare.mjs` exports `compare(expected, actual)` for already normalized
platform declarations. Input validation belongs to the readers. CLI orchestration
is separate from the pure comparator and report formatting.

## Verification and publication gates

Observed locally on macOS: all 94 tests and the fresh-consumer package smoke
passed on Node 22.23.2 and 24.20.0 (also on the local Node 25.8.2 runtime).
The package inventory contained 14 intended files, including LICENSE. Source and fresh-consumer
dependency audits reported no known vulnerabilities at verification time.
These results are synthetic/local evidence only, not real-app acceptance.

`npm test` covers deliberate drift, matching declarations, malformed and
unsupported forms, ambiguous selections, unsafe paths, deterministic CLI output,
private-value omission and target non-mutation. `npm run smoke:package` packs
locally, inspects its actual allowlisted inventory, installs into a temporary
consumer, and exercises the installed executable for exit codes 0/1/2. It
cleans up the temporary package and consumer. It never publishes.

The package exports only bin/, src/, README.md, LICENSE and package.json. Private local
notes, tests, fixtures and workflows are excluded. `.gitignore` is not relied
on for packaging. The privacy scan is bounded supporting evidence, not proof
that every possible secret is absent.

Hosted CI on August 31, 2026 passed all four macOS/Linux and Node 22/24 jobs:
94 tests and fresh-consumer package checks in each job. See the
[run for source commit 8156a8d](https://github.com/maxgorriaran/expo-native-config-audit/actions/runs/33403400630).
GitHub reported a non-blocking Node runtime deprecation warning for the v4
checkout/setup actions; those steps completed successfully.

An independent bounded review accepted the source/package at 8156a8d with
limitations after the Gradle integer correction. Neither local nor hosted synthetic checks
establish real-app compatibility, simulator/device behavior or release readiness.
Publication still requires explicit authorization of the final candidate.

## License

Copyright (c) 2026 AutonoMax Innovations LLC.

The project uses the [MIT License](LICENSE). The separately installed
@xmldom/xmldom dependency retains its own MIT copyright and permission notices.
License selection does not authorize publication or establish release readiness.

## Format references

- [Expo app configuration and resolution](https://docs.expo.dev/workflow/configuration/)
- [Expo configuration schema](https://docs.expo.dev/versions/v54.0.0/config/app/)
- [Expo Doctor app-config/native warning](https://docs.expo.dev/versions/v54.0.0/config/package-json/#appconfigfieldsnotsyncedcheck)
- [Expo permission declarations](https://docs.expo.dev/guides/permissions/)
- [Android manifest merging](https://developer.android.com/build/manage-manifests)

Expo Doctor warns about app configuration coexisting with native directories
that EAS Build will not synchronize. This CLI adds bounded field comparisons;
it does not replace Doctor, native generation, build validation or runtime QA.
