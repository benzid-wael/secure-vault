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
