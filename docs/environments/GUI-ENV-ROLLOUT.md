# Rollout plan: env vaults in the desktop app

Companion to [`GUI-ENV-BREAKDOWN.md`](GUI-ENV-BREAKDOWN.md). Each task that
changes runtime behavior, schema or configuration adds its entry here when it
finishes. Nothing here has shipped yet.

## How this project ships

From [`docs/RELEASING.md`](../RELEASING.md) and `.github/workflows/release.yml`:

- **One git tag ships everything.** A `v*` tag builds the desktop app per OS
  (unsigned), the standalone CLI binaries (Bun `--compile`) and the npm package,
  and publishes one GitHub Release. Tags containing a hyphen (`v0.3.0-rc.1`)
  are pre-releases and go to the npm `next` dist-tag. `latest` stays on the last
  stable version.
- **Merged is not released.** Code on `main` reaches nobody until a tag is cut.
  But **any** tag cut from `main` ships everything merged so far, which is why
  the env UI needs a gate (New-4).
- **Released is not adopted.** There is no auto-update in the desktop app; users
  download new builds by hand. npm users get a new CLI only when they upgrade,
  and `next` only if they ask for it. Binary users replace the file by hand.
  **A gate whose precondition is "the CLI locks" waits on the installed CLI
  base, not on the merge.**

## Environments

| Environment                      | Runtime                                                       | How it's deployed                                | Notes                                                        |
| -------------------------------- | ------------------------------------------------------------- | ------------------------------------------------ | ------------------------------------------------------------ |
| Local dev                        | Electron + Vite dev server                                    | `npm run dev:electron`                           | Inline scripts present (React Refresh); CSP differs (Task 2) |
| Desktop app, macOS/Windows/Linux | Electron `^42.3.3`, packaged                                  | GitHub Release asset, manual install, no updater | Unsigned; the CSP must be tested on this build, not in dev   |
| npm CLI                          | Node ≥ 20.10                                                  | `npm install -g @benzid.wael/secure-vault`       | Users upgrade on their own schedule                          |
| Standalone CLI binaries          | Bun-compiled                                                  | GitHub Release asset, manual install             | Different `node:crypto` implementation (New-5)               |
| CI                               | ubuntu-latest (unit tests also on Windows and macOS), Node 22 | `.github/workflows/ci.yml`                       | e2e job added (Task 30); waits on its first green run        |

There is no server, no database and no remote config. "Schema" here means the
vault file and the files next to it (`.bak`, `.lock`, `.deleted.<ts>`,
`.squashed.<ts>`) plus app files in appdata.

## Gates

| Gate                                     | Default | Controls                                                                        | Flip on (evidence, not a date)                                                                                                                                                                                                                                    | Defined by |
| ---------------------------------------- | ------- | ------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- |
| Environments UI: `SECURE_VAULT_ENV_UI=1` | off     | Every env IPC channel in main, and everything env-related in the renderer (19+) | M0 done in packaged builds (New-19); Tasks 6 + 8 released; `env-vault` e2e green in CI (Task 30); Copy (Task 12) in; the CLI release carrying Task 6 has been out as `latest`. Bulk edit (21) is **not** required since the MVP cut (proposed, author to confirm) | New-4      |

The CLI-side changes (Tasks 3–10) ship **ungated**: they change concurrency
behavior and add files, not features.

## Must not ship early

Known so far. Each entry says what breaks.

1. **No env UI (Task 19+) in a release before Task 6 is in the same or an
   earlier release.** Without locking, the GUI and CLI overwrite each other
   silently, which is the failure this whole RFC exists to prevent.
2. **No env UI before M0 (Tasks 1, 2).** Env plaintext would reach a renderer
   without the hardening the RFC made a precondition.
3. **Task 6 (CLI locking) ships in the same release as Task 8 (docs, `doctor`).**
   Otherwise users meet `BUSY` with no documentation and no way to diagnose a
   stale lock.
4. **Task 3 (async PBKDF2) not in a tag before New-5 passes.** Binary users
   could be unable to unlock vaults. _Status:_ New-5 passed on macOS arm64 (2026-10-22);
   the release workflow now checks the Linux x64 binary before publishing.
5. **Task 13 (password-vault idle lock) only with a release-note entry.** It
   changes behavior for every existing user, including people who never touch
   env vaults.
6. **The GUI release with the env UI must state the minimum CLI version.** An
   older CLI takes no lock, so it can still overwrite GUI writes (RFC §8). The
   app can't detect which CLI is installed.
7. **Task 6 (CLI locking) not to Linux users before New-10.** A CLI in a
   container sharing the host kernel has the same boot time but its own pid
   namespace, so the host can take over its live lock and overwrite its write. macOS and Windows are unaffected. _Status:_ New-10 is built; it clears this
   item once its Linux-only test has passed in CI.
8. **Task 6 (CLI locking) not to Windows users before New-12.** Every write
   then takes the lock and renames under it; without the rename retry, a scanner or reader holding the file makes the
   write fail. _Status:_ New-12 is built and tested by simulation; real
   Windows coverage waits on New-13, whose CI job is built and runs on the
   next push.

## Rollback

Known hazards so far, to be completed per task:

- **CLI locking (Task 6) rolls back by installing the previous version.** An
  older CLI ignores `.lock` files, so a leftover lock is harmless to it, and a
  newer CLI takes it over once the pid is dead.
- **Squash snapshots (Task 7) do not roll back cleanly.** After downgrading to a
  CLI without Task 7, `change-password` re-keys only `.deleted.*` snapshots. Any
  `.squashed.<ts>` files stay under the **old** password, which is the exact
  problem commit `1417497` fixed for `.bak`. Rolling back past Task 7 needs a
  documented step: delete or re-key `.squashed.*` files first.

## Per-task entries

### Task 0: breakdown and rollout plan

- **Runtime, schema or config change:** none (documentation only).
- **Ships with:** nothing; not in any release.

### Task 3: async key derivation

- **Runtime change:** env vault key derivation (create, load, save, snapshot
  re-key) runs on libuv's thread pool instead of blocking the event loop. Same
  keys, same KDF parameters. Password vaults are unchanged.
- **Schema or config change:** none. Vault files are byte-compatible in both
  directions.
- **Before it ships:** New-5 must pass. The compiled CLI binaries run Bun's
  `node:crypto`, and nothing in the test suite exercises them.
- **Gated by:** nothing; no user-visible behavior changes.
- **Must not ship early:** in no tag before New-5 passes (already listed as
  "must not ship early" item 4).
- **Per environment:**
  - npm CLI (Node ≥ 20.10): covered by the suite.
  - Standalone binaries (Bun): New-5.
  - Desktop app: no effect yet; it doesn't touch env vaults until Task 17.
- **Verify after release:** `vault env show <env>` on an existing vault, with
  both the npm CLI and the binary, opens it with the same password.
  `vault env set` then `vault env get` round-trips.
- **Rollback:** fully available. Revert or downgrade; no data was changed and
  keys are identical, so vaults written by either version open in the other.

### Task 4: `VaultLock` module

- **Runtime change:** none yet. The module exists, but nothing calls it until
  Task 5/6.
- **Schema:** defines a new on-disk file, `<vault>.lock` (v1:
  `{ v, pid, host, tool, nonce, boot, pidns?, acquiredAt }`, mode `0600`, mtime =
  heartbeat). Takeovers briefly create `<vault>.lock.stale.<hex>`, removed
  right after. Nothing writes either file until Task 6 ships.
- **Before it ships:** nothing; it's inert on its own.
- **Gated by:** nothing.
- **Must not ship early:** the lock becomes live with Task 6. New-10 must land
  before that release reaches Linux users ("must not ship early" item 7).
- **Per environment:** works on macOS, Linux and Windows (`process.kill(pid, 0)`
  and `utimes` exist on all three). Shared-kernel containers on Linux: New-10.
  Network and synced folders: the mtime rule applies; documented as
  unsupported for concurrent multi-machine use (RFC §11).
- **Verify after release:** n/a until Task 6. Then: while
  `vault env set … --value-stdin` waits for input, `ls <vault>.lock` shows
  nothing (no lock across user think time). During a long change-password,
  the lock's mtime advances every 5 s.
- **Rollback:** nothing to roll back on its own. Once Task 6 ships, older
  versions ignore `.lock` files (see the Rollback section).

### New-10: pid namespace in the lock

- **Runtime change:** none yet (the lock isn't wired until Task 5/6). Once it
  is, on Linux a lock from another pid namespace (a container on the same
  kernel) is judged by mtime, not by a pid probe.
- **Schema:** the lock gains an optional `pidns` field (Linux only). Nothing
  has written a lock yet, so there is no old format to stay compatible with.
- **Before it ships:** its Linux-only test must pass on CI's Ubuntu runner.
- **Gated by:** nothing.
- **Must not ship early:** n/a. It's the fix that clears "must not ship early"
  item 7.
- **Per environment:** Linux reads `/proc/self/ns/pid`. If `/proc` is
  unreadable (hardened kernels, some sandboxes), it falls back to the mtime
  rule, which is safe but means a dead holder blocks writers for up to 30 s.
  macOS and Windows: no field, no change.
- **Verify after release:** on Linux, a lock written from inside a container
  carries a different `pidns` from one written on the host
  (`cat <vault>.lock`).
- **Rollback:** reverting restores the boot-time-only rule and re-opens
  "must not ship early" item 7.

### Task 5: `read()` / `transact()`

- **Runtime change:** none for users. The new methods exist but nothing calls
  them until Task 6. `saveVault` now delegates its write to a shared private
  helper; the `fs` calls and bytes written are unchanged, and the existing
  suite (every CLI integration test included) passes unmodified.
- **Schema or config change:** none.
- **Before it ships:** nothing of its own. It rides with Task 6.
- **Gated by:** nothing.
- **Must not ship early:** n/a on its own. With Task 6 it inherits items 3, 7
  and 8 (docs, New-10, New-12).
- **Per environment:** same on every platform. The atomic rename it relies on
  is New-12's concern on Windows.
- **Verify after release:** n/a until Task 6.
- **Rollback:** fully available; no data or format change.

### New-12: Windows rename retry

- **Runtime change:** every env vault write (`saveVault` and `transact`, so
  every CLI env command that writes) now:
  - on Windows, retries the final rename up to 3 times, 50 ms apart, when it
    fails with `EPERM`/`EBUSY`/`EACCES`;
  - on every platform, removes `<vault>.tmp` when the rename finally fails,
    where it used to leave it behind.
- **Schema or config change:** none.
- **Before it ships:** nothing required; New-13 would show it working on real
  Windows.
- **Gated by:** nothing.
- **Must not ship early:** n/a. It's what clears "must not ship early" item 8.
- **Per environment:** Windows retries. macOS and Linux behave as before,
  apart from the `.tmp` cleanup. A save that still fails after 3 tries shows
  the same error as today; nothing is lost.
- **Verify after release:** on Windows, with the vault open in an editor or
  scanned by antivirus, `vault env set` succeeds. No `<vault>.tmp` is left
  next to any vault after a failed write.
- **Rollback:** fully available. Reverting restores leaving `.tmp` behind on
  failure.

### Task 6: every env write goes through `transact` (CLI behavior change)

- **Runtime change (CLI, today's commands):** `set`, `rm`, `delete`,
  `extends`, `describe`, `rename`, `copy`, `import`, `squash`,
  `rollback` and `change-password` now each take `<vault>.lock`, read
  once, write atomically and release. When another writer holds the lock, a
  command **waits up to 3 s, then fails** with "Vault is busy (held by … pid …).
  Try again, or remove <path>.lock …". Before, the last writer silently won.
  `init` and read-only commands don't lock.
- **Error text:** unchanged for every existing failure, with one exception:
  a vault with unsupported KDF parameters now says "Unsupported key
  derivation parameters" instead of "wrong password or corrupted file", for
  writes only.
- **Schema:** writes now create and remove `<vault>.lock` (Task 4's format).
  Vault files are unchanged and stay readable by older versions.
- **Before it ships (in order):**
  1. Task 8: docs, CHANGELOG and `doctor` in the **same** release ("must not
     ship early" item 3).
  2. New-10's Linux CI run is green (item 7).
  3. New-12 shipped with it (it is), and ideally New-13 has run Windows tests
     (item 8).
  4. New-5 passed, because Task 3 rides in the same release.
- **Gated by:** nothing. It's a correctness change to existing commands;
  there's no flag.
- **Must not ship early:** see above. With the MVP-first rule, Task 6 can be
  **merged** before Task 8 but must not be **released** (tagged) before it.
- **Per environment:**
  - npm CLI and binaries: the change applies.
  - Desktop app: no env UI yet, so no change.
  - Mixed versions: an older CLI ignores the lock and can still overwrite
    (RFC §8). Release notes should tell users to upgrade every machine.
- **Verify after release:**
  1. Run two `vault env set` commands with different keys at the same time
     on one vault; `vault env show <env>` lists both.
  2. While one is running, `ls <vault>.lock` shows the lock, and it's gone
     afterwards.
  3. `kill -9` a writer mid-command; the next command takes over the stale
     lock without waiting.
- **Rollback:** reinstall the previous version. Older versions ignore
  `.lock` files; a leftover one is harmless to them and taken over by newer
  ones once its pid is dead. No vault data changes. The `.deleted.<ts>`
  snapshots are unchanged in format.

### Tasks 1, 2, 9, 14, 15, 17, 19, 20, New-4: the env vault MVP

- **Runtime change, ungated (every user, password vaults too):**
  - The renderer is explicitly sandboxed (it already was by default).
  - The built renderer has a Content-Security-Policy `<meta>`: no inline
    scripts, no remote content. Dev mode has none (New-18).
- **Runtime change, gated (off in production and packaged builds, on in
  dev runs):** with the gate on (`SECURE_VAULT_ENV_UI=1` forces it),
  main registers the env vault channels and the selector shows Passwords |
  Environments. With it unset, the app behaves as before; the only new
  channel is `get-features`.
- **Schema or config change:** none. Env vault files are written through
  Task 6's `transact` with `tool: 'gui'` in the lock.
- **Before it ships:**
  1. New-19: the packaged app on each OS starts with the CSP (blocks the
     next tag, gated or not). _Status:_ passed on macOS; the release
     workflow now runs `npm run test:packaged` after packaging on each OS
     and stops the release if it fails. Run the workflow by hand once to
     see Windows and Linux green before tagging.
  2. "Must not ship early" 1–3 and 6 still hold for flipping the gate.
  3. New-38, Electron fuses, before the gate flips (built; Windows and
     Linux wait on the release workflow's smoke step).
- **Gated by:** the Environments UI gate (table above). How to try it:
  `npm run dev:electron`, or `SECURE_VAULT_ENV_UI=1 npm run start:prod`
  after `npm run build:all`.
- **Must not ship early:** the gate stays off in any tag until its flip
  criterion is met.
- **Per environment:** desktop app only. The CLI is unchanged by this
  iteration, apart from `LIMIT` replacing `ERROR` as the code when an env
  hits 1000 versions (message unchanged).
- **Verify after release:** with the gate off, the selector looks as before
  and `window.electronAPI.envVaults.list()` rejects (no handler). With it
  on, the `env-vault` e2e scenario's steps work by hand.
- **Rollback:** reinstall the previous app. Nothing on disk changes format;
  env vaults written by the GUI are ordinary vault files.

### After first testing: copy, export, move, long values, "Unknown view" fix

- **Runtime change (gated, desktop only):**
  - Copy writes the **system clipboard** from main; a copied secret is
    cleared after 30 s unless the clipboard changed since.
  - Export writes a dotenv file (resolved values, `0600`) where the user
    chooses in the save dialog.
  - Move and duplicate write new versions in both environments.
- **Schema or config change:** none.
- **Before it ships:** as for the MVP entry. Release notes should say an
  export holds plaintext secrets and is the user's to protect.
- **Gated by:** the Environments UI gate.
- **Per environment:** desktop only. Clipboard clearing relies on the app
  running: if it quits within 30 s of a copy, the value stays on the
  clipboard (accepted; the same as the CLI piping to `pbcopy`).
- **Verify after release:** copy a secret, wait 30 s, paste: empty. Copy,
  then copy something else, wait: the other text is still there.
- **Rollback:** reinstall the previous app. Exported files remain where the
  user saved them.

### Key comments (New-25)

- **Runtime change:** the CLI and the app can store an optional comment per
  env key (`env set --comment`, the GUI edit dialog); `env show` prints it.
  Password entry cards now show the entry's existing Notes.
- **Schema or config change:** a version may gain an optional `comments`
  object. Additive: written only when a comment exists, so vaults without
  comments are unchanged. Readers that don't know about it ignore it.
- **Before it ships:** New-29 in the same release or an earlier one; it
  must never come after. CHANGELOG (CLI `--comment`). Release notes: an
  older CLI or app writing to a vault drops comments in the version it
  writes. Tools from this release on warn about it and show how to upgrade;
  tools released earlier don't, so upgrade every machine that writes the
  vault.
- **Gated by:** the CLI flag isn't gated; the GUI part is behind the
  Environments UI gate. The entry-card notes aren't gated.
- **Per environment:** CLI and desktop.
- **Verify after release:** `env set K v --comment note`, then `env set K w`:
  `env show` still prints `# note`.
- **Rollback:** reinstall the previous version. Comments stay in the file;
  the previous version ignores them, and drops them from versions it writes.

### Vault format check (New-29)

- **Runtime change:** the CLI and the app read a vault's format marker.
  A feature the tool doesn't know: reads work with a warning, writes are
  refused (CLI exit 15 `ENV_VAULT_NEWER_FORMAT`; app read-only with a
  banner), with the upgrade command. A newer format `version`: nothing
  opens it. `doctor` reports the format.
- **Schema or config change:** `features: ["comments"]` in the env vault's
  plaintext envelope, written only while some version has a comment. No
  password-vault feature exists yet; the check is in place for the first.
- **Before it ships:** done: CHANGELOG, README.cli.md ("Vaults written by a
  newer version"), SPEC Appendix B (code 15). Ships in the release that
  brings New-25, or an earlier one. Release notes: released versions don't
  check, so upgrade every machine before using comments.
- **Gated by:** not gated. A safety check has to reach everyone.
- **Per environment:** CLI and desktop.
- **Verify after release:** add `"features": ["future"]` to a test vault's
  header, then run `env set`: exit 15, with the upgrade command; `env show`
  works with a warning. Open it in the app: read-only, with a banner. Set
  `"version": 2`: neither opens it.
- **Rollback:** reinstall the previous version. The marker stays in files
  that have it; previous tools ignore it, which is the same exposure as
  before.

### Second testing round: env management, merge, import, CLI flags

- **Runtime change (desktop, gated):** live reload on outside changes (a
  file watch while unlocked); merge-or-conflict saves; bulk edit as .env;
  env rename, duplicate, delete, parent, description; history, rollback,
  squash; compare, validate; import with preview; template; change password.
- **Runtime change (CLI, not gated):**
  - `set` keeps a key's public flag (`--secret` to undo).
  - `.env` parsing follows dotenv tools; `import` warns per skipped line.
  - `export --comments` and `import --comments` (opt-in).
  - `squash` keeps a `.squashed.<ts>` snapshot, re-keyed by
    `change-password`.
- **Schema or config change:** none beyond New-25's comments. New files:
  `<vault>.squashed.<ts>` next to the vault.
- **Before it ships:** the CHANGELOG entries (added). Release notes: the
  parser change (an unquoted ` #` now starts a comment); squash snapshots
  hold the old history and are the user's to delete. New-29 still gates
  comments.
- **Gated by:** the desktop features by the Environments UI gate; the CLI
  changes are not gated.
- **Per environment:** CLI and desktop. The watcher uses `fs.watch` on the
  vault's directory: on network or synced folders events can be late or
  missing; the app then falls back to "changed elsewhere" on the next action.
- **Verify after release:** `vault env set K v --public`, then
  `vault env set K w`: `show` prints `w` unmasked. In the app, edit a key
  while the CLI sets another one: the save says "merged".
- **Rollback:** reinstall the previous version. Squash snapshots stay on
  disk; the previous version neither creates nor re-keys them, so a later
  password change there leaves them on the old password.

### Saved password per vault (New-24)

- **Runtime change (desktop, gated):** an opt-in "Remember on this computer"
  when unlocking an env vault. A kept password unlocks the vault from the
  list after Touch ID where available.
- **Schema or config change:** a new file,
  `<userData>/env-vault-passwords.json` (0600): `safeStorage` ciphertexts by
  vault path. Vault files are unchanged.
- **Before it ships:** release notes say that anyone signed in as the user
  can open a remembered vault in the app (after Touch ID where the Mac has
  it), and how to forget it. Code signing matters: an unsigned build's
  keychain item is tied to that build, so after an update a kept password
  may not decrypt. It is then forgotten and the user types it once.
- **Gated by:** the Environments UI gate.
- **Per environment:** macOS Keychain, Windows DPAPI, Linux Secret Service.
  Linux without a keyring never offers the option.
- **Verify after release:** remember a vault, quit, relaunch, click it: it
  opens after Touch ID. Change its password with the CLI, click it: the
  app says the saved password no longer works and asks for it.
- **Rollback:** reinstall the previous version. It ignores the passwords
  file; delete it to remove the kept passwords.

### Task 8: concurrent-writes docs, CHANGELOG, `doctor` lock check

- **Runtime change (CLI, not gated):** `vault env doctor` reports the
  vault's write lock (held, stale, leftover `.lock.stale.*` files) as info or
  warnings, never as an error, so its exit code is unchanged for existing
  projects. It now also runs with `-v`/`--name` alone, without a `.vaultrc`;
  before, it printed "No .vaultrc found" and stopped.
- **Schema or config change:** none.
- **Before it ships:** this closes Task 6's step 1: Task 6 and Task 8 go out
  in the same release. Release notes repeat the CHANGELOG's upgrade advice.
- **Gated by:** nothing.
- **Verify after release:** `kill -9` a `vault env set` mid-write (or write
  a lock with a dead pid); `vault env doctor -v <vault>` warns "Stale write
  lock" with the path; the next `set` succeeds and the lock is gone.
- **Rollback:** reinstall the previous version; `doctor` loses the lock
  check. Nothing on disk changes.

### New-39: a failed page load no longer loops

- **Runtime change (desktop app, every user, not gated):** a page load that
  a newer navigation aborted, or a failed subframe, no longer shows the
  error page or the "Load Failed" dialog. A real failure shows the error
  page once; if the error page itself fails, the app doesn't retry it.
- **Schema or config change:** none.
- **Before it ships:** nothing.
- **Gated by:** nothing.
- **Verify after release:** `NODE_ENV=development npx electron .` with no
  dev server running shows the "dev server isn't running" error page once
  and stays there; the log has one "Failed to load URL" line.
- **Rollback:** reinstall the previous app. Nothing on disk changes.

### New-38: Electron fuses in packaged builds

- **Runtime change (desktop app, every user, not gated):** the installed app
  ignores `ELECTRON_RUN_AS_NODE`, `NODE_OPTIONS` and `--inspect`, loads code
  only from its `app.asar`, and on macOS and Windows refuses to start if
  `app.asar` was changed after packaging.
- **Schema or config change:** `build.electronFuses` in `package.json`.
  Nothing on disk changes for users.
- **Before it ships:** the release workflow's smoke step green on all three
  OSes (it checks the fuses and starts the app). A packaging problem shows
  up there as an app that doesn't start.
- **Gated by:** nothing.
- **Per environment:** desktop app only. Linux has no asar integrity check
  in Electron; the other fuses apply. The npm CLI and binaries are
  unaffected.
- **Verify after release:** `npx @electron/fuses read --app <installed app>`
  shows RunAsNode, NodeOptions and NodeCliInspect disabled;
  `<app> --inspect` starts with no "Debugger listening" line.
- **Rollback:** reinstall the previous app. Nothing on disk changes.

### New-22: open a project folder

- **Runtime change (gated by the Environments UI gate):** the env vault list
  has Open folder…, which opens the vault the CLI would use in that folder.
  The unlock dialog shows the vault's path.
- **CLI:** `resolveVaultPath` now takes the folder as a parameter instead of
  reading the process's; called without it, it resolves exactly as before.
- **Schema or config change:** none.
- **Before it ships:** nothing beyond the gate's own criteria.
- **Gated by:** the Environments UI gate.
- **Verify after release:** in a project where `vault env show` works with
  no `-v`, Open folder… on the project (or a subfolder) shows that
  project's `.env.vault` path (the nearest one up to the git root) in the
  unlock dialog, and unlocking shows the same envs as `vault env list`.
- **Rollback:** reinstall the previous app. Nothing on disk changes.

### Task 11, New-2, Task 14 (recents): one instance, settings, remembered vaults

- **Runtime change (desktop app, every user, not gated):** a second launch
  brings up the running app's window and quits (Task 11). The app reads
  `<appdata>/app-settings.json` if present; nothing writes it yet.
- **Runtime change (gated by the Environments UI gate):** env vaults opened
  from a file or folder are listed again after a restart, newest first; a
  gone file shows as Missing; Remove from list takes one off.
- **Schema or config change:** two new files in the app data folder, both
  `0600`, plain JSON, paths and settings only: `app-settings.json` (written
  once the Settings screen exists, Task 23) and `gui-env-recents.json`
  (written when an env vault is opened from a file or folder).
- **Before it ships:** release notes for Task 11 (CHANGELOG has it).
- **Gated by:** recents by the Environments UI gate; Task 11 by nothing.
- **Per environment:** desktop app only. Electron keys the instance lock on
  its user data folder: dev runs use the package name
  (`@benzid.wael/secure-vault`), the packaged app its product name, so a
  dev run and an installed app don't block each other.
- **Verify after release:** with the app open, launch it again: no second
  window or Dock icon, and the first window comes forward. Open a project
  folder's vault, quit, relaunch: it's listed.
- **Rollback:** reinstall the previous app. It ignores both new files.

### Task 23: app settings in the Configuration dialog

- **Runtime change (gated by the Environments UI gate):** Configuration
  (menu or Ctrl/Cmd+S) starts with App settings: the env vault idle timeout
  and the "remember vaults" toggle. Changes take effect at once.
- **Schema or config change:** `app-settings.json` is written on the first
  change (format in New-2).
- **Before it ships:** nothing beyond the gate's own criteria.
- **Gated by:** the Environments UI gate, channels included, until Task 13
  took the section and its channels out of it.
- **Verify after release:** set the timeout to 1 minute, unlock an env vault
  and leave it: it locks after a minute. Turn remembering off: vaults opened
  from files or folders are gone from the list after a restart.
- **Rollback:** reinstall the previous app. It ignores `app-settings.json`,
  so env vaults lock after the default 5 minutes again.

### Task 13: idle lock for password vaults

- **Runtime change (every user, not gated):** an unlocked password vault
  locks after 5 minutes without input in the window (keys, clicks,
  scrolling, touch), and the app says so. Configuration shows "Lock vaults
  after" to everyone; the env vault toggle stays gated.
- **Schema or config change:** none; the same `idleMinutes` in
  `app-settings.json` (Task 23) now applies to password vaults too.
- **Before it ships:** the CHANGELOG "Changed" entry (written). Users who
  leave a vault open all day will see it lock; the entry says where to
  change the time.
- **Gated by:** nothing. It's a security default, not a feature to try.
- **Verify after release:** set "Lock vaults after" to 1 minute, unlock a
  password vault and leave it: it locks after a minute and says so. Unlock
  again and keep scrolling or typing for two minutes: it stays unlocked.
- **Rollback:** reinstall the previous app. It ignores the setting for
  password vaults, which then lock only on sleep, screen lock and quit.

### New-42: input on an env vault's screen keeps it unlocked

- **Runtime change (gated by the Environments UI gate):** an unlocked env
  vault stays unlocked while there is input on its own screen, and locks
  after the idle time otherwise. Calls no longer count, so opening, revealing
  or saving without further input doesn't extend the time, and a vault the
  CLI keeps writing to still locks.
- **Schema or config change:** none.
- **Before it ships:** nothing beyond the gate's own criteria.
- **Gated by:** the Environments UI gate.
- **Verify after release:** set "Lock vaults after" to 1 minute and unlock
  two env vaults. Work on the second one's screen for two minutes: it stays
  unlocked and the first one locks.
- **Rollback:** reinstall the previous app. Env vaults then stay open on
  their own calls, as before.

### New-30: rename updates references to the env

- **Runtime change (gated by the Environments UI gate):** renaming an env
  offers to update `{{env:OLD/KEY}}` references in every env, on by
  default, in the same write as the rename.
- **Schema or config change:** none. Each env with a rewritten reference
  gets a new version ("References to OLD renamed to NEW in the desktop
  app").
- **Before it ships:** nothing beyond the gate's own criteria.
- **Gated by:** the Environments UI gate.
- **Verify after release:** in a vault where `shop` uses
  `{{env:base/HOST}}`, rename `base` to `core` with the offer on; `vault
env show shop` resolves as before.
- **Rollback:** reinstall the previous app. Vaults it wrote stay valid; the
  rewritten references are ordinary values.

### New-44: CLI `env rename` carries extends and references

- **Runtime change (every CLI user, not gated):** `vault env rename` moves
  `extends` of child envs to the new name and rewrites `{{env:old/KEY}}`
  references; `--keep-references` skips the second.
- **Schema or config change:** none. Envs with rewritten references get a
  new version ("References to OLD renamed to NEW").
- **Before it ships:** the CHANGELOG "Changed" entry (written). Scripts that
  renamed and then fixed references by hand keep working: the references are
  already fixed, and their own rewrite finds nothing.
- **Gated by:** nothing; it fixes a rename that left vaults broken.
- **Verify after release:** `vault env rename base core` in a vault where
  `shop` uses `{{env:base/HOST}}` and `child` extends `base`: `vault env get
HOST -e child` and the `shop` value resolve as before.
- **Rollback:** reinstall the previous CLI. Vaults written by this one stay
  valid.

### New-32: CLI `env import` keeps key flags

- **Runtime change (every CLI user, not gated):** `vault env import` and
  `init --env` keep the public and required flags of keys still in the
  file; before, every key came out secret and not required.
- **Schema or config change:** none.
- **Before it ships:** the CHANGELOG "Changed" entry (written). A script
  that re-ran `env set --public` after each import keeps working; it now
  changes nothing.
- **Gated by:** nothing; it fixes an import that changed flags silently.
- **Verify after release:** mark a key `--public`, import a file that has
  it: `vault env show <env>` still prints its value.
- **Rollback:** reinstall the previous CLI. Vaults written by this one stay
  valid.
