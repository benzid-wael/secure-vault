# Changelog

All notable changes to SecureVault are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).
Design detail for the environment-vault (`vault env`) features lives in
[`docs/environments/SPEC.md`](docs/environments/SPEC.md); the CLI reference is
[`README.cli.md`](README.cli.md).

## [Unreleased]

### Added

- **A key file as a second factor for password vaults** (desktop app).
  Settings → **Key file** → **Require a Key File…** makes a small `.svkey`
  file (or uses one you have) that's needed with the master password to
  unlock the vault: a copied vault and its password open nothing without
  it. Keep it away from the vault (a USB stick) and keep a copy.
  - The app remembers where the key file was last used (never its
    content), so unlocking is one step while it's there; with a saved
    password, one click.
  - If the key file or the password is lost, the vault's recovery key
    opens it alone, then asks for a new password and key file. In the
    CLI, `vault recover` writes a copy that opens with a new password.
  - The key file can be changed, or turned off again (back to the
    password alone, with a new recovery key).
  - The vault is rewritten in format 2, which older versions of
    SecureVault can't open; turn the key file off before going back to
    one. An export of such a vault can't be imported yet.
- **Open a password vault from any folder** (desktop app). **Open…** in the
  vault list picks a `.vault` file anywhere (a shared drive, a USB stick); it's
  listed with its location, kept across restarts, and unlocked, saved and
  backed up in place. Removing it from the list leaves the file; the app
  never deletes it. Environment vaults are refused there.
- **Remember a vault's password on this computer** (desktop app). Tick
  **Remember on this computer** when unlocking a password vault: the
  password is kept encrypted by the system keychain (macOS Keychain, DPAPI,
  or the Linux Secret Service; not offered without one), and clicking the
  vault later unlocks it, after Touch ID where the Mac has it. Off by
  default, per vault. A saved password follows a password change made in
  the app, is dropped when the vault is deleted or the password no longer
  works, and **Forget saved password** in the unlocked vault or **Forget
  all saved passwords** in Settings removes it.
- **Environment vaults can bind their header to their contents** (vault
  format 2). Changing the file's plaintext header (its format version,
  features or key settings) then makes it refuse to open with "…'s header was
  changed after it was written", instead of being trusted. This version
  reads format 2 and keeps such a vault in format 2, but still writes format
  1: a later release starts writing format 2, and earlier versions can't
  open it at all, so upgrade every machine that uses a vault before then.
- **Key comments in env vaults.** `vault env set KEY value --comment "…"`
  stores a note about a key (`--comment ""` removes it); `vault env show`
  prints it under the key. Later writes keep it. An older CLI or app that
  writes the vault drops comments from the version it writes, so upgrade
  every machine that writes a vault before you rely on them.
- **`vault env export --comments`** writes key comments as `#` lines above
  each key, and **`vault env import --comments`** reads the `#` lines
  directly above a key back as its comment.
- **`vault env set --secret`** marks a key sensitive again.
- **Vaults record the format features they use**, and every tool from this
  version on checks them. A vault with key comments says so in its header.
  A CLI or app that meets a feature it doesn't know reads the vault but
  refuses to change it (the CLI exits with the new code 15,
  `ENV_VAULT_NEWER_FORMAT`; the app opens it read-only) and says how to
  upgrade, instead of silently dropping the data on save. Password vaults
  follow the same rule. `vault env doctor` reports the vault's format.
  Versions released before this one don't check: upgrade every machine that
  writes a vault before using key comments.
- **`npm run test:e2e`** — end-to-end checks that build the desktop app and
  drive its real window: first launch, unlocking and upgrading an older vault,
  export / import, manual lock and auto-lock (sleep and screen lock),
  recovery-key unlock, and changing the password from Settings. Each scenario
  runs with its own empty home directory.

### Changed

- **Copied secrets are cleared from the clipboard after 30 seconds** in
  the desktop app: passwords, PINs, card numbers, CVVs, private keys, note
  content, grid-card codes (including the automatic copy on lookup) and the
  recovery key. Nothing is cleared if you've copied something else since.
  Usernames, URLs and other plain fields stay on the clipboard. The message
  after a copy says when a secret is cleared.
- **`vault env import <env> a.env b.env` imports every file.** Before, each
  file replaced the one before it, so only the last file's keys were left.
  Now the files make one version with the keys of all of them; a later file
  wins on a repeated key. If any file can't be read, nothing is imported
  (before, the files ahead of it were). Warnings name the file they're
  about.
- **`vault env set` refuses a key a `.env` file can't hold.** A key must
  be letters, digits and `_`, not starting with a digit (`API_KEY`, not
  `api-key` or `a.b`); the command exits 1 and changes nothing, before
  asking for a value. Such keys couldn't be exported to `.env`, imported,
  or edited in the desktop app. `vault env rm` still removes one an older
  vault holds, and so does the desktop app.
- **`vault env import` keeps the flags of the keys it replaces.** A key
  still in the file stays public or required as it was; before, every
  import made all keys secret and dropped `required`. New keys are secret,
  and a key the file leaves out takes its flags with it.
- **`vault env rename` no longer breaks what builds on the environment.**
  Environments that extend it now extend the new name (before, they were
  left pointing at a name that no longer existed), and `{{env:old/KEY}}`
  references in every environment are rewritten to the new name, each
  environment that had any getting a new version. The command says how many
  it updated. `--keep-references` leaves references as they are. The
  desktop app's rename does the same, and asks first.
- **An unlocked vault locks after 5 minutes without activity.** Keys,
  clicks, scrolling and touch in the app window count as activity; the app
  says why the vault locked. Change the time in Configuration (menu or
  Ctrl/Cmd+S), "Lock vaults after", from 1 minute to 4 hours. Sleep, screen
  lock and quit still lock the vault at once.
- **The desktop app runs once per user.** Launching it while it's already
  running brings up the open window instead of starting a second copy with
  its own unlocked vaults.
- **Concurrent writes are safe.** Every `vault env` command that changes a
  vault now takes `<vault>.lock` while it reads, changes and saves it, so two
  commands (or a command and the desktop app) no longer overwrite each
  other's changes; before, the last writer silently won. A command that finds
  the vault locked waits up to 3 seconds, then fails with "Vault is busy",
  naming the holder and the lock file. A lock left by a dead process is taken
  over automatically. `vault env doctor` now reports the lock (held, stale,
  leftover files) and runs with just `-v`/`--name`, without a `.vaultrc`.
  Older versions ignore the lock: upgrade every machine that writes a vault.
- **`vault env set` keeps a key's public flag.** Setting a new value without
  `--public` used to make a public key secret again; it now stays as it was
  until `--secret`. A new key is still secret by default.
- **`.env` files are read the way dotenv tools read them** (`import`, `init
--env`, `run --env-file`): values in quotes may span lines, spaces around
  `=` are allowed, an unquoted value ends at ` #` (an inline comment), and
  backtick quotes work. `vault env import` prints a warning with the line
  number for each line it skips. An unquoted value that contained ` #` now
  stops there: quote it to keep the rest.

### Fixed

- **Escape cancels editing a grid-card cell.** It did nothing before, and
  leaving the field saved whatever was typed.
- **A vault no longer disappears for a moment on every save.** Saves wrote a
  temp file, deleted the vault, then renamed the temp file into place. A
  command reading the vault in that moment (another `vault env` command,
  `vault env run`, the desktop app) failed with "vault not found", and a
  crash at that point left only the `.tmp` and `.bak` files. Saves now
  replace the file in one step. Env vaults and desktop vaults alike.

### Security

- **The desktop app refuses `--remote-debugging-port` and
  `--remote-debugging-pipe`.** Started with either, it quits before opening
  a window, so whoever launches it can't read or drive the page of an
  unlocked vault through Chromium's debugger.
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
