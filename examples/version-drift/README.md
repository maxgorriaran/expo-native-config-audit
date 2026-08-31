# Version bump with stale native declarations

Scenario: a developer updates app.json to version 1.3.0 / build 43, but the
checked-in native Android module still declares version 1.2.0 / build 42.
The auditor detects those two mismatches while the identifier and scheme match.

These are original synthetic files using conventional app/module paths and
literal declarations accepted by the CLI. They illustrate a realistic maintenance
mistake; they are not an exported Expo project, a buildable app, or evidence of
real-app compatibility. Do not remove logic from a working Gradle project to fit
this example. Ordinary Expo-generated Gradle files may return unsupported.

From the repository root, after `npm ci --ignore-scripts`:

```sh
node bin/audit.mjs --root examples/version-drift --platform android \
  --android-gradle android/app/build.gradle \
  --android-manifest android/app/src/main/AndroidManifest.xml
```

The command intentionally exits **1** (drift), not 0. Its exact text output is
checked into [expected-output.txt](expected-output.txt) and tested against the
executable. The two drift lines are:

```text
DRIFT android.build expected=43 actual=42
DRIFT android.version expected="1.3.0" actual="1.2.0"
```

Add `--format json` to inspect the full structured report. The CLI does not fix
or rewrite these files. A developer must decide which version declarations are
intended, update the appropriate source through their own workflow, and still
validate the effective native build separately.
