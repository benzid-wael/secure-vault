# Changelog

All notable changes to SecureVault are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).
Design detail for the environment-vault (`vault env`) features lives in
[`docs/environments/SPEC.md`](docs/environments/SPEC.md); the CLI reference is
[`README.cli.md`](README.cli.md).

## [Unreleased] — [0.1.8] — 2026-07-05

### Added — v1.8 · Native config & file secrets

Deliver secrets into native mobile builds (iOS/Android, Firebase, signing)
without a daemon. Vault stays format-agnostic: it renders templates and
materializes files, and never parses a third-party build-config format.

- **`vault env set --in <path> [--encode base64]`** — ingest a file as a
  variable value instead of passing it on the command line. `--encode base64`
  stores binary blobs (Firebase plists, keystores) as text; reading from disk
  also avoids shell-escaping and `ARG_MAX` limits on large secrets.
- **`vault env file <key> --out <path> [--decode base64] [--mode 0600]`** —
  materialize a single variable to a file (blob delivery). Written `0600` by
  default, parent directories created, optionally base64-decoded byte-for-byte.
- **File templating (`.vtpl`)** — a plain-text template in _any_ format
  (`.xcconfig`, `Info.plist`, `gradle.properties`, XML, JSON…) with `{{KEY}}`
  placeholders that resolve to environment values. Vault never parses the target
  format, so one engine covers every text format. Substitution is single-pass
  (a value containing `{{OTHER}}` is not re-expanded), a missing key is a hard
  error, and opt-in filters `{{KEY | json|xml|base64}}` escape values with
  format-special characters. The `{{ }}` delimiter deliberately avoids `$( )` /
  `${ }` so the build system's own tokens pass through untouched.
- **Delivery manifest** — declare every artifact for an environment in `.vaultrc`
  under `deliver[]`, where each entry is exactly one of `format` (native
  `dotenv`/`json`, with an optional `keys` subset), `from` (a single variable as
  a blob, optional `decode`), or `template` (a `.vtpl`; output path defaults to
  the template path minus `.vtpl`).
  - **`vault env apply [env] [--dry-run]`** — write every declared artifact
    (environment resolved from the argument, `.vaultrc` `"env"`, or `VAULT_ENV`).
    `--dry-run` resolves and validates without writing.
  - **`vault env clean [--dry-run]`** — securely remove exactly the declared
    artifacts (3-pass overwrite). A `.vtpl` template source is never deleted.
  - Artifact paths resolve relative to the `.vaultrc` location, so both commands
    behave identically from the project root or any subdirectory.

### Added — v1.9 · Scaffolding & DX

- **`vault env init --preset react-native`** — creates the vault and scaffolds a
  ready-to-use setup: a starter `.vaultrc` manifest, an
  `ios/Config/Secrets.xcconfig.vtpl` template, `SECURE_VAULT_SETUP.md` (with
  Xcode/Gradle snippets), and `.gitignore` entries for the delivered artifacts.
  Non-destructive (existing files are skipped, `.gitignore` reconciled
  idempotently); an unknown preset fails before the vault is created.
- **`vault env doctor`** — read-only diagnosis of the delivery wiring: manifest
  validity, template files present, `.gitignore` coverage of delivered
  artifacts, and a vault-present check. With a non-interactive password it also
  verifies every variable the manifest references resolves in the environment.
  Warnings pass; only real errors (invalid manifest, missing template,
  unresolved variables) exit non-zero.

### Changed

- `loadProjectConfig` is now a thin wrapper over a directory-aware
  `findProjectConfig`, so `apply`/`clean` know where `.vaultrc` lives. Existing
  behavior is unchanged.

### Docs

- SPEC at Revision 10: new §8.5 (File Templating), §6.3 output-format guardrail,
  the v1.8/v1.9 milestones (§13.4.1/§13.4.2), and the resolved v2.0 G12
  lock↔mount contract (§13.5).
- New `docs/environments/MOBILE-INTEGRATION-GAPS.md` gap analysis + task
  breakdown.
- `README.cli.md`: "Delivering secrets to files" section.

## [0.1.7] — 2026-07-02

Baseline for this changelog. For the history of `0.1.7` and earlier releases,
see the Git tags and the changelog in
[`docs/environments/SPEC.md`](docs/environments/SPEC.md) (Appendix C).

[Unreleased]: https://github.com/benzid-wael/secure-vault/compare/v0.1.7...HEAD
[0.1.7]: https://github.com/benzid-wael/secure-vault/releases/tag/v0.1.7
