# Changelog

All notable changes to SecureVault are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).
Design detail for the environment-vault (`vault env`) features lives in
[`docs/environments/SPEC.md`](docs/environments/SPEC.md); the CLI reference is
[`README.cli.md`](README.cli.md).

## [Unreleased]

### Security

- **No more built-in `default` vault.** The desktop app created a `default`
  vault with the password `changeme123` on every launch where it was missing,
  so every install had a vault anyone could open. First launch now asks you to
  create a vault with your own password. An existing `default` vault is kept;
  if it still uses `changeme123`, the app warns after unlock and links to
  **Change password**.
- **Deleting a desktop vault always needs its password.** Only the `default`
  vault required one; any other vault could be deleted without it.

## [0.2.0-rc.1] — 2026-10-15

First v0.2.0 pre-release. Desktop vaults are re-keyed to 600,000 PBKDF2
iterations the first time they're unlocked; see **Changed**.

### Added

- **`vault env set <key> --value-stdin`** — read the value from stdin, so a
  secret never appears in `ps`, shell history or an editor temp file. One
  trailing newline is dropped; multi-line values are kept. Works with
  `--encode`. The password must come from `--password-file` or
  `VAULT_ENV_PASSWORD`, since stdin carries the value.

### Added — v2.0 · Agent (slice 7a, developer preview)

- **`vault env agent start|stop|status|lock|unlock`** — a background session
  daemon so unlocked builds don't re-prompt. Enforces the resolved security
  contract: two-tier lock (soft idle-lock keeps mounts + refuses new requests;
  hard lock on sleep/max-lifetime/explicit wipes them; the idle timer resets only
  on user-authenticated actions — G28), a **request-scoped protocol** (`status`
  is metadata-only, `get-env` serves one named env / key subset, no enumeration
  or dump-all — G23), over a newline-JSON Unix socket in a `0700` dir.
  `VAULT_AGENT_DIR` overrides the runtime location.
- **`vault env agent mount|mounts|unmount`** — opt-in live delivery: `mount`
  materializes the `.vaultrc` manifest as plaintext files for the whole session,
  `mounts` lists them, `unmount` securely wipes them (all, or one `--path`).
  Mounting pulls vars through the request-scoped session, so it is refused while
  locked (I2), and every mount is tracked so a hard lock / stop wipes the set as
  a group (G26). Mounts are **watched**: a file a build deletes out from under it
  is re-materialized (the watch is stopped before any secure delete, so an
  unmount / wipe is never re-created). `mount` is **opt-in behind `--force`** and
  prints the highest-risk-mode warning — without it the CLI refuses and points to
  `vault env run` for scoped delivery (the default GUI path, mode B). Completes
  gap-doc Task 8 (G11/G18/G26).
- **`vault env agent exec <env> -- <cmd>`** — spawn-based delivery (G24): the
  daemon runs the command as its own child with the scoped env injected, so the
  secret **never crosses the socket and never touches disk** — it lives only in
  the child's memory for the run (§5.4 mode A, the safest delivery mode). The
  child's stdout/stderr are relayed back to the CLI, the exit code propagates,
  and Ctrl-C tears the child down. Refused while locked (I2); `--merge` layers
  vault vars over the full env (default is `clean`, allowlist only).
- **`vault env agent audit [--verify]`** — append-only, **hash-chained** audit
  log (G27): every unlock (including rejected ones), env access (with its
  source — mount/exec/raw), explicit lock, and auto-lock is recorded with
  metadata only (type, env name, result — **never values**). Each entry hashes
  the previous one, so editing or deleting any earlier entry is detectable;
  `--verify` walks the chain and fails on the first break. The chain resumes
  across daemon restarts. (Per-release biometric approval and client PID/binary
  attribution need Secure Enclave / peer-cred and remain 7b.)
- **Preview caveat:** the key is held in memory and the process is **not yet
  hardened** (no `mlock`/anti-ptrace/HW-KEK, no peer-cred) — those land in 7b and
  are required before production use. Spawn-based delivery (G24) is in via
  `agent exec`; peer-cred on the socket is still pending. See
  `docs/environments/AGENT-DESIGN.md` §7.

### Security

- **Master password no longer passed to child processes.** `vault env run
--merge`, `vault env shell --merge`, `vault env agent exec --merge` and the
  editor opened by `vault env edit` inherited `VAULT_ENV_PASSWORD`. It is now
  dropped from every child env, in every mode, even when allowlisted.
- **Desktop app no longer logs vault data.** `loadVault()` printed the whole
  vault file to the console, and creating the default vault printed its
  recovery key.
- **Desktop app: the master password no longer lives in the UI.** The window
  sends it once to unlock (or create / recover) a vault; the main process keeps
  it for the session and every other request names only the vault. Recovery no
  longer hands the password back to the window, and the window no longer logs
  decrypted entries to its console.
- **Desktop app auto-locks** when the computer sleeps or its screen locks.
- **Desktop app: tighter IPC.** Only the main window's top frame can call the
  vault API. Vault names are validated, and no name can reach a file outside the
  vault directory (desktop and CLI). Rolling a vault back to its backup requires
  it to be unlocked.
- **Desktop export / import use native file dialogs.** Export asks where to save
  instead of taking a typed path, and import uses only the file you pick, so the
  page can no longer write or read arbitrary paths.

### Changed

- **Stronger key derivation: PBKDF2-SHA512 at 600,000 iterations** (was
  100,000). Each vault records the count it was written with, so older vaults
  keep opening.
  - Desktop vaults are upgraded automatically the first time they're unlocked.
    Your recovery key keeps working. "Recover with previous password" is
    unavailable until your next password change, because that data can't be
    re-protected without the previous password.
  - CLI environment vaults upgrade on their next write.
  - Unlocking and each CLI command take roughly 0.25 s longer; the desktop app
    caches keys while a vault is unlocked, and a CLI write reuses the key it
    just derived to read the vault instead of deriving a new one.
- **One password policy everywhere.** The desktop forms used a looser strength
  score than the main process and the CLI, so a password like `Password123`
  passed the form and then failed to save. All three now use the same rules:
  8–128 characters with an uppercase letter, a lowercase letter, a digit and a
  special character (any non-alphanumeric character counts).
- **Deleted desktop vaults keep at most 5 copies.** Deleting a vault leaves a
  `<name>.vault.deleted.<ts>` copy; only the 5 newest per vault name are now
  kept, so old encrypted copies (some under retired passwords) no longer pile
  up.

### Removed

- `SecretQuestionRecoveryService`, `UsbRecoveryService`, the
  `useEntryManagement` hook and `VaultService.encryptVault`: unused, and none
  of them worked.

### Fixed

- **Desktop list shows each entry type with its own fields.** Every entry was
  drawn as a password (username, URL, masked password), so a WiFi network, an
  SSH key or a card showed empty or wrong fields. Each card now shows its type's
  icon, colour and fields, masks its secret (a multi-line secret such as a
  private key reveals as a block), and its menu copies that type's fields. Form
  hints such as "MM/YY" moved from field labels to the hint under the field.
- **Desktop main process starts again.** The Electron main bundle was built as
  browser code, which replaced `import.meta` and `process.env` with `{}`: it
  crashed on load (`fileURLToPath` received `undefined`) and dev mode could never
  be detected. It is now built for Node.
- **Desktop dev mode renders again.** With Vite 8.0.16 the dev server's
  dependency pre-bundling dropped an import inside MUI/Emotion, so the window
  stayed blank (`init_emotion_react_browser_development_esm is not defined`).
  Fixed by upgrading Vite to 8.3.4. `npm run dev:main` now rebuilds the main
  process first, and when the dev server isn't running the error page says to
  start it (`npm run dev:renderer`, or `npm run dev:electron` for both).
- **Desktop startup no longer races on the default vault.** The window asks for
  the vault list twice at startup; both requests could create the `default`
  vault at once (different recovery keys, and with atomic writes a failed
  rename). Creation is now shared, and every atomic write uses its own temp
  file.
- **Desktop vault writes are crash-safe.** Saving, creating, importing and
  updating settings wrote the vault file in place; a crash mid-write could
  corrupt it. All writes now go through a temp file and an atomic rename.
- **Backups no longer outlive a password change.** The CLI's `<vault>.bak` and
  the desktop app's `.vault.backup` kept the vault encrypted under the old
  password, so a retired (possibly leaked) password still opened it, and the
  desktop "Restore backup" undid the change. After a password change, or the
  600k key upgrade, the CLI `.bak` is refreshed from the new file and the
  desktop backup is removed. `vault env change-password` also re-encrypts the
  vault's `.deleted.<ts>` snapshots under the new password, and lists any it
  can't open (taken before an earlier password change) so you can remove them.
- Password-recovery metadata missing one of its two required fields is now
  treated as invalid and regenerated, instead of being accepted.
- **`vault recover` works.** It crashed on an undefined variable, always
  reported success because the recovery was never awaited, and printed the vault
  file and recovery metadata. It now writes `<name>-recovered[-N].vault`, never
  overwrites an earlier copy, and exits non-zero on failure.

### Docs

- **`AGENT-DESIGN.md` §8 — "Why the rest of 7b can't ship in pure Node"**: a
  plain-language breakdown of each deferred native capability (peer-cred, no
  core dumps, anti-debug, `mlock`, hardened runtime, HW-backed KEK, biometric
  approval) — what it is, the attack it blocks, why Node has no API for it, and
  what it would take (native addon / launchd / entitlements / signing).

## [0.1.9] — 2026-07-05

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

## [0.1.8] — 2026-07-05

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

## [0.1.7] — 2026-07-02

Baseline for this changelog. For the history of `0.1.7` and earlier releases,
see the Git tags and the changelog in
[`docs/environments/SPEC.md`](docs/environments/SPEC.md) (Appendix C).

[Unreleased]: https://github.com/benzid-wael/secure-vault/compare/v0.2.0-rc.1...HEAD
[0.2.0-rc.1]: https://github.com/benzid-wael/secure-vault/compare/v0.1.9...v0.2.0-rc.1
[0.1.9]: https://github.com/benzid-wael/secure-vault/compare/v0.1.8...v0.1.9
[0.1.8]: https://github.com/benzid-wael/secure-vault/compare/v0.1.7...v0.1.8
[0.1.7]: https://github.com/benzid-wael/secure-vault/releases/tag/v0.1.7
