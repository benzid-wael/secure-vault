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

| Environment                      | Runtime                      | How it's deployed                                | Notes                                                        |
| -------------------------------- | ---------------------------- | ------------------------------------------------ | ------------------------------------------------------------ |
| Local dev                        | Electron + Vite dev server   | `npm run dev:electron`                           | Inline scripts present (React Refresh); CSP differs (Task 2) |
| Desktop app, macOS/Windows/Linux | Electron `^42.3.3`, packaged | GitHub Release asset, manual install, no updater | Unsigned; the CSP must be tested on this build, not in dev   |
| npm CLI                          | Node ≥ 20.10                 | `npm install -g @benzid.wael/secure-vault`       | Users upgrade on their own schedule                          |
| Standalone CLI binaries          | Bun-compiled                 | GitHub Release asset, manual install             | Different `node:crypto` implementation (New-5)               |
| CI                               | ubuntu-latest, Node 20       | `.github/workflows/ci.yml`                       | e2e not run in CI yet (Task 30)                              |

There is no server, no database and no remote config. "Schema" here means the
vault file and the files next to it (`.bak`, `.lock`, `.deleted.<ts>`,
`.squashed.<ts>`) plus app files in appdata.

## Gates

| Gate                       | Default | Controls                                     | Flip on (evidence, not a date)                                                                                                                                     | Defined by |
| -------------------------- | ------- | -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------- |
| Environments UI (name TBD) | off     | Everything env-related in the renderer (19+) | Tasks 1, 2 (M0), 6 (locking), 19–21 and 29 done; `env-vault-concurrent` green in CI (Task 30); the CLI release carrying Task 6 has been out as `latest` (proposed) | New-4      |

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
   could be unable to unlock vaults.
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
   Windows coverage waits on New-13.

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
