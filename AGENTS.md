# Project instructions

## Scope and authority

This project is a small read-only Expo/native configuration auditor, not an
agent harness, app generator, deployment system, or replacement for Expo Doctor.
Start by reading README.md and checking the exact working directory and Git
state. Before Git initialization, report that this is an uninitialized folder;
do not mistake a parent repository for this project.

The bootstrap handoff authorizes context intake and a bounded implementation
proposal only. Implementation, source copying, Git initialization, dependency
installation, commits, remote creation, push, PR creation, license selection,
package publication, or visibility changes need the corresponding user approval.
Later explicit user instructions can authorize those steps.

## Source and privacy boundaries

- Other product repositories are read-only references, never write targets.
- Do not copy a donor repository, its history, user data, internal records,
  private configuration, binary assets, or broad directories into this project.
- Never read .env files, credentials, clinical or client records, or production
  configuration values. Do not run donor scripts that load them indirectly.
- The ignored .local directory contains private handoff material. Never stage,
  force-add, package, upload, or publish it. An eventual package must use an
  explicit files allowlist; .gitignore alone is not a publication guarantee.
- Ownership and source provenance must be resolved before code export or public
  licensing. Do not assume access to a private repository establishes rights.

## Engineering boundaries

- Prefer a small Node CLI, a separately testable pure comparison core, and
  narrowly scoped file readers. Do not introduce a framework without a need.
- Initial scope is identifiers, versions/build numbers, schemes, and permissions.
- Exclude auto-fix, prebuild, archives, signing, icon auditing, provider checks,
  accounts, telemetry, server components, and simulator control from v0.1.
- Audit inputs are untrusted. Bound reads, constrain paths, reject unsafe file
  types/symlinks as appropriate, and handle malformed or unsupported input.
- Do not evaluate app.config.js/ts, run Gradle, invoke Xcode, execute commands
  supplied in manifests, source shell files, or install audited-app dependencies.
- Support multiple targets/build configurations explicitly or report them as
  unsupported; do not assume exactly two configurations or compare every target
  against the app identifier. Unsupported coverage cannot produce an all-clear.
- Permissions need platform-specific rules. Do not imply static parity proves
  runtime consent or inspect unknown configuration fields indiscriminately.
- Do not disable Expo Doctor or other checks in consumer projects.
- Use only synthetic fixtures. Keep output deterministic and portable.

## Verification and handoff

Separate source inspection, unit/fixture tests, CLI integration, package/fresh
consumer installation, hosted CI, and actual mobile runtime/release proof.
Passing a unit test does not prove the other layers.

When implementation is authorized, test deliberate drift, matching values,
missing files/fields, malformed formats, alternate supported layouts, multiple
targets, unsafe paths, unsupported dynamic config, deterministic output, and
target non-mutation. Agree CLI exit-code semantics before writing the CLI.

Preserve unrelated changes. Stage literal reviewed paths only when authorized.
Never commit or publish merely to satisfy a proposed posting date. Keep the
README honest about what exists and what remains unverified.
