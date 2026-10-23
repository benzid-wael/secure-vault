# Breakdown: env vaults in the desktop app

The plan of record for [`GUI-ENV-RFC.md`](GUI-ENV-RFC.md) (approved 2026-10-21).
Rollout notes live in [`GUI-ENV-ROLLOUT.md`](GUI-ENV-ROLLOUT.md). This file is
updated as each task finishes, not in a batch at the end.

**Status key:** ✅ done · 🟡 partial · ⛔ blocked · ⬜ not started · 🔶 ready to run · ⏸ deferred · ❌ dropped
**Priority:** **P0** MVP path · **P1** production readiness, correctness, security, privacy · **P2** improvements

## Rollup

| #      | Task                                                               | RFC | Pri | Status | Depends on                             |
| ------ | ------------------------------------------------------------------ | --- | --- | ------ | -------------------------------------- |
| 0      | Write this breakdown and the rollout plan                          | —   | P0  | ✅     | —                                      |
| 1      | Make the renderer sandbox explicit and verified                    | M0  | P1  | ✅     | 0, New-1                               |
| 2      | Content-Security-Policy for the renderer                           | M0  | P1  | 🟡     | 1                                      |
| 3      | Async key derivation (`deriveKeyAsync`)                            | M1  | P0  | ✅     | 0, New-1                               |
| 4      | `VaultLock` module                                                 | M1  | P0  | ✅     | 3                                      |
| 5      | `read()` / `transact()` with revisions and `REKEYED`               | M1  | P0  | ✅     | 3, 4                                   |
| 6      | Port every env op onto `transact`; `saveVault` private             | M1  | P0  | ✅     | 5                                      |
| 7      | `squash` snapshot, re-keyed by change-password                     | M1  | P1  | ✅     | 6                                      |
| 8      | CLI docs, CHANGELOG, `doctor` reports stale locks                  | M1  | P1  | ✅     | 6                                      |
| 9      | `applyVarChanges` model method                                     | M2  | P0  | 🟡     | 6                                      |
| 10     | Changeset apply + rebase in the service                            | M2  | P0  | ✅     | 9                                      |
| 11     | Single-instance lock for the app                                   | M3  | P1  | ✅     | 0                                      |
| 12     | Main-process `ClipboardService` + IPC                              | M3  | P1  | 🟡     | 0, New-3                               |
| 13     | Idle lock for password vaults                                      | M3  | P1  | ✅     | New-2                                  |
| 14     | `EnvVaultRegistry` (ids, dialogs, recents)                         | M3  | P0  | 🟡     | 6, 11, New-2                           |
| 15     | `EnvVaultSession` (keys, commit/recover, idle)                     | M3  | P0  | 🟡     | 5, 14, New-2                           |
| 16     | `EnvVaultWatcher`                                                  | M3  | P1  | ✅     | 15                                     |
| 17     | IPC gate + core channels + preload                                 | M3  | P0  | 🟡     | 10, 12, 14, 15                         |
| 18     | IPC: structure, history, diff, import/export channels              | M3  | P2  | ✅     | 17                                     |
| 19     | Renderer: Environments switch, vault list, open/new/unlock         | M4  | P0  | ✅     | 2, 17, New-4                           |
| 20     | Renderer: env view (masked, reveal, copy, inline edit)             | M4  | P0  | 🟡     | 19                                     |
| 21     | Renderer: bulk edit (table + dotenv text), conflicts               | M4  | P0  | ✅     | 20                                     |
| 22     | Renderer: move secret copy to `ClipboardService`                   | M4  | P1  | ⬜     | 12, New-3                              |
| 23     | Renderer: Settings for idle timeout and recents                    | M4  | P1  | ✅     | 13, 14, New-2                          |
| 24     | Renderer: env structure ops                                        | M5  | P2  | ✅     | 18, 20                                 |
| 25     | Renderer: history, rollback, squash                                | M5  | P2  | ✅     | 7, 18, 20                              |
| 26     | Renderer: diff and validate                                        | M5  | P2  | ✅     | 18, 20                                 |
| 27     | Renderer: import, export, template                                 | M5  | P2  | ✅     | 18, 20                                 |
| 28     | Renderer: env vault change-password                                | M5  | P2  | ✅     | 7, 18, 19                              |
| 29     | e2e scenario `env-vault-concurrent`                                | M6  | P1  | 🟡     | 21                                     |
| 30     | CI e2e job (ubuntu + xvfb)                                         | M6  | P1  | 🟡     | 1, 29                                  |
| 31     | User guide `docs/guide/gui/env-vaults.md`                          | M6  | P2  | ⬜     | 21                                     |
| New-1  | Coverage can't see the code this plan changes                      | —   | P1  | ✅     | — (blocks 1, 3)                        |
| New-2  | App-wide settings store                                            | M3  | P1  | ✅     | 0                                      |
| New-3  | Decide which secrets go through `ClipboardService`                 | —   | P1  | ⬜     | —                                      |
| New-4  | Feature gate for the Environments UI                               | M4  | P0  | ✅     | 0                                      |
| New-5  | Verify async PBKDF2 in the Bun-compiled CLI binary                 | M1  | P1  | ✅     | 3                                      |
| New-6  | Decide whether project coverage should include `src/electron/**`   | —   | P2  | ⬜     | New-1                                  |
| New-7  | Commit a way to measure coverage of excluded files                 | —   | P1  | ⬜     | New-1                                  |
| New-8  | `npm run lint` fails locally on gitignored build output            | —   | P2  | ⬜     | —                                      |
| New-9  | Type-check gate: confirm "no new errors" as this plan's rule       | —   | P1  | ✅     | —                                      |
| New-10 | Lock: a container sharing the kernel can look like this machine    | —   | P1  | 🟡     | 4 (blocks the release of 6)            |
| New-11 | Bring RFC §6.5 in line with Corrections 6 and 7                    | —   | P2  | ⬜     | 4                                      |
| New-12 | Windows: retry the final rename on `EPERM`                         | M1  | P1  | ✅     | 5 (blocks the release of 6 on Windows) |
| New-13 | CI runs the unit tests on Windows and macOS too                    | —   | P1  | 🟡     | — (verifies 4, New-12)                 |
| New-14 | Remove the env `saveVault` and its mocked tests                    | —   | P2  | ⬜     | 6                                      |
| New-15 | Type `window.electronAPI` once for the type check                  | —   | P2  | ⬜     | —                                      |
| New-16 | ESLint flags MUI components used only in JSX as unused             | —   | P2  | ⬜     | —                                      |
| New-17 | Shared test mock lacks `removeAllListeners` / `onVaultLocked`      | —   | P2  | ⬜     | —                                      |
| New-18 | Dev-mode Content-Security-Policy                                   | M0  | P2  | ⬜     | 2                                      |
| New-19 | Verify the CSP and sandbox in packaged builds (asar)               | M0  | P1  | 🟡     | 2 (blocks the next tag)                |
| New-20 | Fix: reveal/edit fail with "Unknown view" in dev                   | M4  | P0  | ✅     | 15, 20                                 |
| New-21 | Move or duplicate keys between environments                        | M4  | P0  | ✅     | 9, 17, 20                              |
| New-22 | Open a folder and find the vault the CLI would use                 | M3  | P1  | ✅     | 14                                     |
| New-23 | Unlock error says which file, without "corrupted" first            | M4  | P2  | ✅     | 19                                     |
| New-24 | Unlock an env vault with the password a profile injects            | M4  | P2  | ✅     | 15                                     |
| New-25 | Optional comment per key (env vaults) and notes on entry cards     | M4  | P1  | ✅     | 9, 20                                  |
| New-26 | Export and import key comments as `#` lines in a .env              | M4  | P2  | ✅     | 27, New-25                             |
| New-27 | Fix: `env set` without `--public` makes a public key secret again  | M1  | P2  | ✅     | —                                      |
| New-28 | Search password entries by their notes                             | —   | P2  | ✅     | —                                      |
| New-29 | Recognise a newer vault format: warn, protect writes, show upgrade | M1  | P1  | ✅     | 8, New-25                              |
| New-30 | Rename an env: update `{{env:NAME/KEY}}` references to it          | M5  | P2  | ✅     | 24                                     |
| New-31 | Merge, not STALE, for reveal, copy, transfer and import            | M4  | P2  | ⬜     | 10                                     |
| New-32 | `env import` keeps the flags of the keys it replaces               | M1  | P2  | ⬜     | 9                                      |
| New-33 | Fix: a vault briefly vanished on every save                        | —   | P2  | ✅     | —                                      |
| New-34 | Drop a pending import as soon as the vault locks                   | M5  | P2  | ⬜     | 27                                     |
| New-35 | JSON export from the app                                           | M5  | P2  | ⬜     | 27                                     |
| New-36 | Prune saved passwords of gone vaults; "forget all"                 | M5  | P2  | ⬜     | New-24                                 |
| New-37 | Authenticate the envelope header (GCM additional data)             | M5  | P2  | ⬜     | New-29                                 |
| New-38 | Set Electron fuses in packaged builds                              | M0  | P1  | 🟡     | New-19                                 |
| New-39 | Fix: a failed page load loops instead of showing the error page    | —   | P2  | ✅     | —                                      |
| New-40 | Refuse `--remote-debugging-port` in packaged builds                | M0  | P2  | ⬜     | New-38                                 |
| New-41 | Find the unit test that failed once in ten full runs               | —   | P2  | ⬜     | —                                      |
| New-42 | Decide whether input in the window keeps env vaults unlocked       | —   | P2  | ✅     | 13                                     |
| New-43 | `npm run lint` lints the docs site's ignored build output          | —   | P3  | ⬜     | —                                      |
| New-44 | CLI `env rename` leaves `extends` and references on the old name   | —   | P1  | ✅     | New-30                                 |

**MVP path (P0):** 0 → 3 → 4 → 5 → 6 → 9 → 10 → 14 → 15 → 17 → New-4 → 19 → 20 → 21,
with M0 (1, 2) required before 19 ships to anyone.

## Baseline (2026-10-21, before any task)

- `npx vitest run --coverage`: **69 files, 847 tests, all pass.** Lines 77.98%,
  statements 77.21%, branches 72.74%, functions 71.19%. Gate in
  `vite.config.js`: 68 / 67 / 64 / 60. These numbers must not drop.
- The coverage gate excludes `src/electron/**`, `public/**` and `bin/**`:
  see New-1.
- Suite time (`/usr/bin/time -p npx vitest run`, two runs): 25.9 s and 27.4 s.
- Lint on tracked files
  (`git ls-files '*.js' '*.jsx' '*.mjs' '*.cjs' | xargs npx eslint`):
  **0 errors, 344 warnings.** Plain `npm run lint` also scans gitignored local
  build output and fails locally (New-8); CI doesn't see those files.
- Type check (`npx tsc --noEmit`): **345 errors**, report-only in CI
  (`continue-on-error`). The rule for this plan is no new errors (New-9).
- Branch: `feat/vault-env-gui`, not merged, not released. Commits: `dd4e2e1`
  (RFC + discovery), `92e9354` (Task 0), `3553e81` (Task 3), `2f01040`
  (Task 4), `ac641ad` (New-10), `c87c53f` (Task 5), `8b2a0f4`
  (New-12), `8c2a3c2` (Task 6), `618b51b` (the env vault MVP).

## Corrections to the plan

Numbered corrections to the RFC, recorded when executing proved it wrong.

1. **The renderer is probably already sandboxed.** RFC §2 says "no `sandbox`".
   `WindowManager.js` doesn't set it, but Electron (here `^42.3.3`) has defaulted
   to `sandbox: true` since v20 whenever `nodeIntegration` is off, which it is.
   So M0's sandbox half is likely "make explicit and prove", not "turn on". Not
   yet verified at runtime; Task 1 verifies it. _Found during Task 0._
2. **"≥70% coverage on touched files" isn't measurable with today's config.**
   The RFC's testing plan (§9) assumes coverage reports on the service and main
   process code. It doesn't (New-1). _Found during Task 0._
3. **D6 named "password entries", but the renderer copies three kinds of
   secret:** password fields (`PasswordManager.jsx:224`), TOTP codes
   (`Level3CardGrid.jsx:84,99`) and the recovery key
   (`RecoveryKeyDisplay.jsx:41`). The scope needs a decision (New-3). _Found
   during Task 0._
4. **D1 and D5 assume app-wide settings exist.** They don't: the only settings
   are per password vault, encrypted (`VaultSettingsService`). An idle timeout
   and a recents toggle need a store that's readable while every vault is
   locked (New-2). _Found during Task 0._
5. **New-1's chosen method didn't work as written.** `--coverage.include` on
   the command line is still filtered by the config's `exclude` list, so the
   excluded paths reported nothing. The working method is a separate Vitest
   config that reuses the project config with only the coverage scope changed
   (New-7). _Found during Task 3._
6. **The lock heartbeat can't rewrite the lock file.** RFC §6.5 has the
   holder rewrite a `refreshedAt` field. A rewrite that can't be seen half
   written is a temp file renamed over the lock, and that rename would
   **recreate** a lock someone else already took over. The heartbeat touches
   the file's mtime instead (`utimes`, which fails cleanly once the file is
   gone), and staleness for a lock from another machine reads that mtime. The
   lock file has no `refreshedAt` field. _Found during Task 4._
7. **"Rename, so only one taker wins" was not enough.** Two takers can both
   judge a dead lock stale. One renames it away and creates a fresh lock, and
   the other's rename then moves **that live lock** away. After renaming, the
   taker checks that it moved the lock it judged stale, and puts it back (a
   hard link) if not. _Found during Task 4._

## Decisions

Taken in the RFC (see its §12) and not to be relitigated without a new reason:

- **S2 chosen** (shared `transact` + thin IPC). Rejected: S1 thin adapter
  (silently loses updates), S3 decrypted model in main (holds every env, against
  G25), S4 GUI spawns the CLI (~550 ms per op, buys nothing).
- **Agent stays out**; G23 intact. Revisit after `NATIVE-HELPER-RFC.md`.
- **Destructive ops: plain confirm** (not C5 password re-entry). Accepted
  inconsistency with delete-vault.
- D1 5-min idle lock for env **and** password vaults · D2 squash snapshot (CLI
  too) · D3 e2e in CI on ubuntu + xvfb · D4 Passwords | Environments switch ·
  D5 recents on by default with a toggle · D6 one main-side clipboard service.
- **Tasks are split below milestone size** so each one is reviewable alone
  (decided 2026-10-21).
- **MVP first** (author, 2026-10-21, after New-12): follow the P0 path only.
  Discovered P1/P2 work is recorded as tasks and not done unless it blocks
  P0. Each task keeps its full Definition of Done.
- **MVP scope cut** (author, 2026-10-22, after Task 6: "optimize for time,
  e2e working MVP in the next iteration"):
  - Out of the MVP: Task 10 (rebase) and Task 21 (bulk edit). An edit
    against a changed file gets `STALE`; the UI keeps the draft and asks
    for a reload. No update is lost; the user redoes nothing but a click.
  - Leaner versions, gaps recorded on each task: Task 9 (model method
    only), 14 (no persisted recents, so no Task 11 / New-2 yet), 15 (idle
    fixed at 5 min), 17 (no `copy`/`bulk-load`), 20 (no copy, no
    watcher-driven refresh).
  - The remaining P0 tasks were built in one iteration with one review,
    not one review per task.
- **Type-check rule for this plan** (New-9, 2026-10-21): `tsc --noEmit`
  errors stay ≤ the baseline (345), and none points at a line the task
  changed. Fixing the existing 345 is not part of this plan.
- **Coverage rule for this plan:** ≥70% **lines** on every file a task adds or
  changes, and project totals never below the baseline above (decided
  2026-10-21). How to measure it for excluded paths is New-1.

---

## Tasks

### Task 0: Write this breakdown and the rollout plan

- **Status:** ✅ done 2026-10-21: both files written; approved by the author
  ("next"). Committed as `92e9354`; not merged, not released.
- **Goal:** The approved RFC is decomposed into reviewable tasks with
  dependencies, priorities and validation, and a rollout plan exists to be
  extended by each task.
- **Constraints:** Documentation only; no code changes.
- **Dependencies:** RFC approved (done).
- **Implementation guidance:** Gaps found while writing it go into the `New-`
  series, not into prose.
- **Validation:** The author approves both files; every RFC milestone item maps
  to at least one task (M0 → 1–2, M1 → 3–8, M2 → 9–10, M3 → 11–18, M4 → 19–23,
  M5 → 24–28, M6 → 29–31).

### Task 1: Make the renderer sandbox explicit and verified

- **Status:** ✅ done 2026-10-22: its own validation is met. Uncommitted on `feat/vault-env-gui`; not merged, not released.
- **Built:** `sandbox: true` set explicitly in `WindowManager`.
- **Proof:** the e2e driver registers a test-only preload
  (`e2e/probe-preload.cjs`) in the same renderer; it reports
  `process.sandboxed === true`. Checked in `first-launch` and `env-vault`.
  `WindowManager.test.js` fails if `sandbox` is removed (it also covers
  loading and navigation; the file went from 49% to 88% lines).
- **Goal:** `webPreferences.sandbox: true` is set explicitly, and a test proves
  the preload runs sandboxed. Nobody can turn it off by accident.
- **Constraints:** No change to the preload API surface (`window.electronAPI`).
  The preload may only use what a sandboxed preload can (`contextBridge`,
  `ipcRenderer`).
- **Dependencies:** New-1 (to measure coverage of `WindowManager.js`).
- **Implementation guidance:** Correction 1: this is probably already the
  effective setting, so the value is in pinning and proving it. Check
  `process.sandboxed` from the preload in the e2e run, not only in a unit test
  with a mocked `BrowserWindow`. A unit test asserting the option is passed is
  cheap insurance, but it doesn't prove Electron honored it.
- **Validation:** `npm run test:e2e` passes, and a new assertion in the e2e
  driver reads `process.sandboxed === true` from the renderer side. A unit test
  fails if `sandbox` is removed from `webPreferences`.

### Task 2: Content-Security-Policy for the renderer

- **Status:** 🟡 partial 2026-10-22. Uncommitted on `feat/vault-env-gui`; not merged, not released. Built and verified on the built app
  (`file://`, as packaged), and in the packaged macOS app (New-19).
  Windows and Linux packaged builds wait on New-19's CI run.
- **Built:** a build-only Vite plugin (`renderer-csp` in `vite.config.js`)
  injects the RFC §6.10 policy as the first `<meta>` in `build/index.html`,
  plus `font-src 'self' data:` and `form-action 'none'`.
  `frame-ancestors` is left out: browsers ignore it in a `<meta>` policy.
- **Decision:** dev mode (`vite` on :3000) gets **no** CSP, because
  plugin-react's inline refresh preamble needs one with `'unsafe-inline'`
  scripts. A dev policy is New-18.
- **Proof (e2e `env-vault`):** an injected inline `<script>` doesn't run,
  and it's the only CSP violation in the whole scenario.
- **Goal:** The packaged app's renderer runs under the RFC §6.10 CSP, so an
  injected inline script cannot execute.
- **Constraints:** MUI/emotion needs `style-src 'unsafe-inline'`. Dev mode
  (`npm run dev:electron`) must keep working with Vite HMR.
- **Dependencies:** 1.
- **Implementation guidance:** Trap: `@vitejs/plugin-react` injects an
  **inline** React Refresh preamble script in dev, so a strict
  `script-src 'self'` meta tag in `index.html` breaks dev. Emit the strict policy
  only in the production build (e.g. a build-only HTML transform), or set it from
  main via response headers, with a separate dev policy. Production loads from
  `file://`, where `'self'` behaves differently from http. Test the **packaged**
  build, not just `vite preview`.
- **Validation:** e2e passes on the built app with zero CSP violations in the
  console. An e2e check that injects an inline `<script>` sees it blocked.

### Task 3: Async key derivation (`deriveKeyAsync`)

- **Status:** ✅ done 2026-10-21: its own validation is met. **Not released
  until New-5 passes** (see the rollout plan). Committed as `3553e81` on
  `feat/vault-env-gui`; not merged, not released. Approved by the author.
- **Built:**
  - `CryptographyService.deriveKeyAsync` (async `crypto.pbkdf2`) and
    `deriveKeyForAsync` (honors the record's `kdf`, legacy count when absent).
  - All five derivations in `EnvironmentVaultService` use them: `createVault`,
    `loadVault`, `saveVault`, and both in `#rekeySnapshots`. Each was already
    inside an `async` method and a `try`, so a rejection reaches the same
    `catch` the sync throw did.
  - Password-vault services are unchanged and keep the sync `deriveKey`.
- **Tests:** 6 new tests in `CryptographyService.test.js`: equal keys sync vs
  async, the legacy record, missing iterations, an unsupported `kdf`, and
  **the event loop staying free during derivation**. That test was checked
  against a blocking stand-in, which it fails. `KdfUpgrade.test.js:297` ("a
  mutation derives the key once") now spies on `deriveKeyAsync`, since the
  derivation it counts moved there; its assertion is unchanged.
- **Evidence:** 853/853 tests pass (847 + 6). Suite 25.2 s and 27.0 s vs
  baseline 25.9 s and 27.4 s. Touched-file lines (New-7 method):
  `CryptographyService.js` 100%, `EnvironmentVaultService.js` 91.41%. Project
  totals unchanged (the touched files are excluded from them). Lint on tracked
  files 0 errors / 344 warnings (= baseline); changed files have 0 problems.
  `tsc` 345 errors (= baseline), none in changed lines.
- **Goal:** `CryptographyService.deriveKeyAsync` exists (async
  `crypto.pbkdf2`), and the env vault load/save paths use it. Output is
  byte-identical to `deriveKey`.
- **Constraints:** No vault format or KDF parameter change. The sync
  `deriveKey` stays for callers not yet moved (password vaults are out of
  scope). `fastKdf` test patching must still apply.
- **Dependencies:** New-1.
- **Implementation guidance:** `fastKdf` patches the work factor via
  `CryptographyService`. Make sure the async path reads the same patched values,
  or the suite slows to ~250 ms per derivation. The Bun-compiled CLI binary is a
  separate runtime (New-5).
- **Validation:** A test asserts `deriveKeyAsync` and `deriveKey` produce equal
  keys for the same inputs. All existing env CLI integration tests pass
  unchanged. Suite time stays within 10% of baseline.

### Task 4: `VaultLock` module

- **Status:** ✅ done 2026-10-21: its own validation is met. Committed as
  `2f01040` on `feat/vault-env-gui`; not merged, not released. Approved by
  the author. Not wired to anything yet
  (Task 5 does that), so it changes no behavior.
- **Built:** `src/electron/services/VaultLock.js`: `acquire()` /
  `release()` / `refresh()` / `lost`, plus `isProcessAlive` and
  `machineBootTime`.
  - `<vault>.lock` is created with `wx` and mode `0600`, holding
    `{ v, pid, host, tool, nonce, boot, acquiredAt }`, with its mtime set to
    the creation time.
  - Backoff is 50 → 100 → 200 → 400 ms (capped) for up to `timeoutMs`
    (3 s), then `BUSY` naming the holder and the file.
  - Same machine (boot time within ±1 min): stale only when the pid is dead.
    Another machine, or an unreadable lock: stale when the mtime is older than
    30 s.
  - Takeover: rename aside, verify, restore if it was a live lock (Correction
    7), clean up.
  - A heartbeat touches the mtime every 5 s (Correction 6); the timer is
    `unref`'d, so it never keeps a CLI process alive.
  - A half-written lock is removed. Unexpected filesystem errors come back as
    `ERROR` results, never as rejections.
- **Known limits (accepted):**
  - With **three** writers racing on a dead lock in the same instant, the
    restore can fail because a third lock already exists, leaving two holders.
    This needs three contenders within microseconds of each other.
  - An unreadable lock can't be identity-checked after renaming it aside.
  - A container sharing this machine's kernel: fixed by New-10.
- **Tests:** `VaultLock.test.js`, 25 tests. They cover every rule in RFC
  §6.5 (with Corrections 6 and 7), and two takers racing in-process. **Real
  mutual exclusion:** 4 processes × 25 lock-protected increments of a shared
  counter end at 100. Three mutations were each caught by a test: no restore
  after a racing takeover; age-based staleness on the same machine (the H1
  bug); and a non-exclusive create (the counter ended at 21/100). The
  in-process "two takers" test did **not** catch the first mutation, because
  in one process the two acquisitions run in sequence; the injected-rename
  test covers that path.
- **Evidence:** 878/878 tests pass. Suite time, alternating with and without
  the change: 28.28 s vs 28.30 s, then 29.19 s vs 29.14 s (no change).
  `VaultLock.js` 96.22% lines (New-7 method). Project totals unchanged
  (the new file is excluded from them). Lint on tracked + new files: 0 errors,
  344 warnings (= baseline). `tsc` 345 (= baseline), none in the new files.
  A first pass had 9 new `tsc` errors, fixed with a JSDoc typedef.
- **Goal:** A standalone lock implementing RFC §6.5 (exclusive create,
  backoff, `boot` + pid same-machine staleness, `refreshedAt` heartbeat, rename
  takeover, nonce-checked release, `BUSY`). Not yet wired to anything.
- **Constraints:** File mode `0600`. No third-party lock library unless a
  decision says so. Must work on macOS, Linux and Windows.
- **Dependencies:** 3 (the heartbeat is only meaningful once derivation no
  longer blocks the event loop).
- **Implementation guidance:** The dangerous bug is taking over a **live**
  holder's lock. On the same machine, decide by pid liveness only, never by age.
  Inject the clock, pid probe and boot time so tests don't sleep. Release must
  run in `finally`, and the heartbeat timer must be cleared on every exit path,
  or the process won't exit.
- **Validation:** Unit tests cover every row of RFC §6.5's table, plus two
  concurrent takers where exactly one wins. ≥70% lines on the new file.

### Task 5: `read()` / `transact()` with revisions and `REKEYED`

- **Status:** ✅ done 2026-10-21: its own validation is met. Committed as
  `c87c53f` on `feat/vault-env-gui`; not merged, not released. Approved by
  the author. Nothing calls the new methods yet (Task 6 does).
- **Built:** in `EnvironmentVaultService`:
  - `revisionOf(bytes)` returns `sha256:<hex>`.
  - `read(path, auth)` reads the file once, then hashes and parses that same
    buffer. It never locks.
  - `transact(path, auth, mutate, { expectedRevision, create,
lockTimeoutMs, tool })` follows RFC §6.2: lock → read once → `STALE`
    check (before decrypting) → open → `mutate` → choose the key → abort if
    `lock.lost` → atomic write → revision of the written file → unlock in
    `finally`.
  - Failure codes: `NOT_FOUND`, `INVALID`, `AUTH`, `REKEYED`,
    `STALE`, `BUSY`, `ERROR`.
  - The write itself (encrypt, `.bak`, temp file + rename, `.bak` after a
    re-key) moved from `saveVault` into a private `#writeEncrypted` that
    both use. `saveVault` behaves exactly as before: same `fs` calls,
    same bytes.
- **Decisions taken here:**
  - `auth` may carry **both** `keyMaterial` and `password`. The cached key
    is used when the file's salt and KDF header still match; otherwise the
    password opens it, with no `REKEYED`. Key-only callers get `REKEYED`.
    This makes Task 15's `recover` a re-call with both, rather than a
    separate path.
  - A **key-only** writer on a legacy-KDF vault keeps the old key and work
    factor. Only a caller holding the password upgrades it. The RFC assumed
    the upgrade always happens, but without a password it can't.
  - The new revision is computed by **re-reading the written file while still
    holding the lock**, not from an in-memory buffer. Existing tests mock
    `fs.writeJSON`, and switching the write to `writeFile` broke 20+ of
    them, so the write path was kept identical.
  - `mutate` throwing returns `ERROR` with its message, and nothing is
    written. Mapping model errors to friendlier codes is up to each op
    (Task 6).
- **Bug found and fixed in this task:** a vault in a **missing directory**
  returned `ERROR` (the lock can't be created there) instead of
  `NOT_FOUND`. `transact` now checks the directory before locking when
  `create` is off.
- **Tests:** `EnvironmentVaultService.transact.test.js`, 18 tests:
  - `read`: success; key-only with no derivation; `NOT_FOUND`/`INVALID`/`AUTH`;
    `REKEYED` and recovery with the password.
  - `transact`: success with the result and revision; `.bak`; `STALE` leaving
    the file byte-identical; a matching revision; a throwing `mutate`; `BUSY`
    with the holder; two concurrent writers both kept; a lost lock;
    `NOT_FOUND` vs `create` (nested directories); `create` needing a
    password; key-only writes.
  - A legacy vault upgraded by a password write, where the returned key keeps
    working, the old key gets `REKEYED`, and `.bak` isn't left under the old
    key (H3); and a key-only write on a legacy vault.

  Mutations, each caught: dropping the `STALE` check; returning the
  pre-write key (H3); ignoring a lost lock.

- **Evidence:** 903 passed + 1 skipped. `EnvironmentVaultService.js` 92%
  lines (was 91.41%). Project totals unchanged. Lint: changed files clean;
  tracked files 0 errors / 344 warnings. `tsc` 345 (= baseline), 0 on changed
  lines. The first pass had 41 new `tsc` errors from union-typed JSDoc returns;
  flat `@typedef`s fixed them, the same fix as Task 4.
- **Goal:** `EnvironmentVaultService.read` and `transact` exist as RFC §6.2
  describes: revision = sha256 of file bytes, one read per transaction,
  `STALE`, `REKEYED`, returned (possibly re-salted) `keyMaterial`, `auth`
  union. Existing ops are untouched.
- **Constraints:** No format change. A string `auth` (today's password
  argument) must keep working. `mutate` throwing must write nothing.
- **Dependencies:** 3, 4.
- **Implementation guidance:** Hash and parse **the same buffer**: re-reading
  the file to decrypt reopens the race. Legacy-KDF vaults get re-salted by
  `saveVault`, so the returned `keyMaterial` must be the new one (RFC H3).
  From Task 4: `VaultLock` needs the vault's directory to exist, so a
  `create` transaction makes it **before** locking. Check `lock.lost` right
  before the final rename and abort if set: a lost lock means another writer
  may be inside. Map `acquire()`'s `BUSY`/`ERROR` results straight through.
- **Validation:** Tests for `STALE`, `REKEYED`, a KDF-upgrade write returning
  new `keyMaterial`, and a throwing `mutate` leaving the file byte-identical.
  ≥70% lines on changed files.

### Task 6: Port every env op onto `transact`; `saveVault` private

- **Status:** ✅ done 2026-10-21: its own validation is met (two processes ×
  50 writes keep all 100 keys; every existing CLI integration test passes
  unchanged). Uncommitted on `feat/vault-env-gui`; not merged, not released.
  **This is the task that changes CLI behavior**: see the rollout plan before
  any release.
- **Built:**
  - **Ported to `transact`** (11): `setEnv`, `removeKey`, `deleteEnv`,
    `setExtends`, `setEnvDescription`, `renameEnv`, `copyEnv`,
    `importEnvFile`, `squashEnv`, `rollbackEnv`, `changePassword`.
  - Each body became a `mutate` callback. Its early returns became `throw`s
    with the **same messages**, so a failed check writes nothing.
  - A private `#mutate` maps results to the CLI's `{ success, error }` shape,
    plus `code` (`holder` on `BUSY`) and `revision`.
  - `transact` gained `rekeyWith` (write under a fresh key from a new
    password) and `afterWrite` (runs after the write, under the lock).
    `changePassword` uses both, so its snapshot re-key can't race another
    writer.
  - `deleteEnv` takes its `.deleted.<ts>` snapshot inside the transaction.
  - `importEnvFile` reads the `.env` file **before** taking the lock.
- **Decisions taken here:**
  - **Read-only ops stay on `loadVault`** (`get`, `show`, `list`,
    `export`, `template`, `history`, `diff`, `validate`). Writes are atomic
    renames, so reads need no lock, and `transact` would write on every call.
  - **`createVault`/`init` stay off `transact`.** They refuse an existing
    file, so they can't clobber a vault. Their only race is two inits of the
    same new path within milliseconds, which is accepted. Leaving them keeps the
    read-only tests' mocked seeding working.
  - **`saveVault` stays public but has no callers.** A guard test fails if
    anything in `bin/`, `public/` or `src/` calls
    `EnvironmentVaultService.saveVault`, or if the service calls
    `this.saveVault`. Deleting it (and its mocked tests) is New-14. The
    breakdown said "private"; this gets the same protection for less churn.
- **Tests:**
  - **Replaced:** 22 mocked tests of the write ops (they asserted on
    `writeJSON`/`readJSON` mock calls, which `transact` no longer makes)
    became **32 real-filesystem tests** in `EnvironmentVaultService.ops.test.js`.
    Every original assertion is kept; new ones cover missing keys/envs writing
    nothing, the delete snapshot's contents, snapshot re-key under the lock,
    `BUSY`, `NOT_FOUND`/`AUTH` codes, and `setEnvDescription` (which had
    no test).
  - **Converted:** `EnvironmentVaultService.integration.test.js` (13 tests)
    from mocks to a real temp dir. Its assertions are unchanged except one
    mock-call check, whose effect the next assertion still proves. **Fixed a
    test bug the mocks hid:** its workflow `init`ed a vault by name, then
    edited a different path; it now inits the vault it edits.
  - **No lost updates (validation):**
    - 2 spawned processes × 50 `setEnv` calls through the shared service end
      with all 100 keys and 100 versions;
    - 4 concurrent `vault env set` CLI processes keep all 4 keys;
    - with locking disabled (mutation), both tests fail.
  - **Guard:** the two `saveVault` tests above. Making `renameEnv` bypass
    `transact` (mutation) fails them.
- **Evidence:**
  - 929 passed + 1 skipped; suite 24.4 s.
  - `EnvironmentVaultService.js` 95.2% lines (was 92.3%). Project totals
    unchanged.
  - Lint on tracked + new files: 0 errors, 343 warnings (one fewer). The one
    warning in changed files, the unused `makeFreshVaultFile` helper,
    predates this task.
  - `tsc` 324: **21 fewer** than the 345 baseline, all from the removed mocked
    tests. The service still has only its 2 old errors (`resolveVaultPath`).
- **Goal:** Every mutating `EnvironmentVaultService` op runs inside `transact`,
  with snapshots taken inside the lock. `saveVault` is no longer callable from
  outside the service. Two processes writing the same vault never lose an
  update.
- **Constraints:** No CLI command, flag or output change; the existing CLI
  integration tests are the contract. Results keep the `{ success, error }`
  shape, adding `code` and `revision`. **This is the task that changes CLI
  behavior** (concurrent writers wait, then `BUSY`).
- **Dependencies:** 5. Blocks 7, 8, 9.
- **Implementation guidance:** `changePassword` and `#rekeySnapshots` are the
  long transactions (two derivations per snapshot). They're the reason for the
  heartbeat; test them with many snapshots. Add a guard test so nothing in `bin/` or `public/` calls `saveVault`.
  From Task 5:
  - `transact` always writes, so read-only ops (`get`, `show`, `list`,
    `export`, `history`, `diff`, `validate`) must use `read()`, not
    `transact`, or every read changes the revision.
  - `createVault`/`init` must keep `validatePasswordStrength` and its
    "already exists" refusal **before** calling `transact` with
    `create: true`, which checks neither.
  - Keep the `{ success, error }` messages the CLI prints today; `code` is
    additive.
- **Validation:** New `envConcurrency.integration.test.js`: two spawned CLI
  processes × 50 `set`s of distinct keys → all 100 keys present. All existing
  tests pass unchanged.

### Task 7: `squash` snapshot, re-keyed by change-password

- **Status:** ✅ done 2026-10-22 (second testing round): its own validation is met. Uncommitted on `feat/vault-env-gui`; not merged, not released.
- **Built:** `EnvironmentVaultService.snapshot(vaultPath, kind)` copies the
  vault to `<vault>.<kind>.<ts>` inside the write's lock; `deleteEnv` and
  `squashEnv` (and the app's delete and squash) use it. `changePassword`
  re-keys `.deleted.*` and `.squashed.*` (`SNAPSHOT_KINDS`), still skipping
  `.tmp`. Squashing a missing env takes no snapshot.
- **Goal:** `squash` writes `<vault>.squashed.<ts>` before squashing (D2), and
  `change-password` re-keys `.squashed.*` along with `.deleted.*`.
- **Constraints:** A retired password must open no snapshot (the rule from
  commit `1417497`).
- **Dependencies:** 6.
- **Implementation guidance:** `#rekeySnapshots` matches on the `.deleted.`
  prefix today. Widen the match deliberately; don't catch `.bak` or `.tmp`.
- **Validation:** Test: squash → snapshot exists and decrypts to the pre-squash
  vault. Test: change-password → old password opens neither snapshot kind.

### Task 8: CLI docs, CHANGELOG, `doctor` reports stale locks

- **Status:** ✅ done 2026-10-22: its own validation is met. Uncommitted on
  `feat/vault-env-gui`; not merged, not released.
- **Built:**
  - `VaultLock#inspect()`: read-only; `none`, `held` or `stale` by the same
    rule `acquire` uses, plus the `<vault>.lock.stale.*` files.
  - `checkLock` in `envDoctor.js`: ok, info (held: holder, file, "If no
    vault command is running, remove <path>", the busy error's remedy) or
    warn (stale; each leftover file). Never an error, never deletes.
  - `vault env doctor` runs it when the vault exists, and now also runs
    with only `-v`/`--name` and no `.vaultrc` (lock check alone).
  - README.cli.md: a "Concurrent writes" section (the busy error, takeover,
    3 s wait, 30 s for another machine, upgrade every machine) and the lock
    in the `doctor` list. CHANGELOG: "Concurrent writes are safe" under
    Unreleased / Changed.
- **Validated:** `VaultLock` tests for none, a live holder, a dead holder
  (not taken over), another machine by mtime, leftover files; `checkLock`
  unit tests; CLI tests with a dead-pid lock and a live one, both left in
  place.
- **Goal:** Users learn about the concurrency change before they hit `BUSY`,
  and `vault env doctor` reports a stale or orphaned `.lock`, plus any
  `<vault>.lock.stale.*` file (left only if a process dies between a
  takeover's rename and its cleanup, Task 4).
- **Constraints:** `doctor` stays read-only: it reports, it doesn't delete.
- **Dependencies:** 6.
- **Implementation guidance:** The `BUSY` message, the docs and `doctor` must
  name the same file path and the same remedy.
- **Validation:** `envDoctor` tests cover a dead-pid lock and a live one. The
  CHANGELOG has a "Concurrent writes" entry under Unreleased.

### Task 9: `applyVarChanges` model method

- **Status:** 🟡 partial 2026-10-22. Uncommitted on `feat/vault-env-gui`; not merged, not released.
- **Built:** `EnvironmentVault.applyVarChanges(env, ops, { message, createEnv })`:
  `set`/`rm` ops as one version; `set` keeps a key's sensitivity unless
  the op sets it, new keys are secret; keys must match `ENV_KEY_PATTERN`
  (what survives a dotenv round trip); refuses a missing env without
  `createEnv`. The version cap now throws with `code: 'LIMIT'`, and
  `transact` passes `LIMIT` through. 13 model tests.
- **Not done (MVP cut):** `setEnv`, `removeKey` and `importEnvFile` are not
  re-implemented on it; `meta` ops (required) aren't supported.
- **Goal:** `EnvironmentVault.applyVarChanges(env, ops, { message, createEnv })`
  applies set/rm/meta ops as one version. `setEnv`, `removeKey` and
  `importEnvFile` are re-implemented on it.
- **Constraints:** The CLI's `set` and `import` keep auto-creating the env
  (`createEnv: true`). Changesets never do (RFC H2). `MAX_VERSIONS` →
  `code: 'LIMIT'`.
- **Dependencies:** 6.
- **Implementation guidance:** `setEnv` has subtle `--public` / `--required`
  semantics today (required is additive, public toggles). Preserve them exactly;
  the CLI integration tests are the spec.
- **Validation:** Model tests: one version per call, refusal without
  `createEnv`, `LIMIT` at the cap. All CLI `set`/`rm`/`import` integration tests
  pass unchanged.

### Task 10: Changeset apply + rebase in the service

- **Status:** ✅ done 2026-10-22 (second testing round): its own validation is met. Uncommitted on `feat/vault-env-gui`; not merged, not released.
- **Built (in `env:commit`, not the service):** a view keeps a hash per own
  key (value, flags, comment) of what the page was shown (`stamps`); no
  plaintext. When the file changed since, the commit still applies if none
  of the keys it touches changed (`rebased: true`); otherwise `CONFLICT` with
  `conflicts: [{key, kind}]` (`changed`, `removed`, `added`, `env-gone`),
  nothing written. `force: true` applies it anyway. No second rebase: the
  check and the write run under one lock.
- **Differs from the plan:** it lives in the IPC layer, where the view is;
  the service has no changeset API yet. Env renamed elsewhere shows as
  `env-gone`.
- **Goal:** The service applies an `EnvChangeset` against a base (revision,
  `envIdentity`, `keyStamps`), rebasing when touched keys are unchanged and
  returning `CONFLICT` (`changed` / `removed` / `added` / `env-gone`) otherwise.
- **Constraints:** Stamps cover the env's **own** vars only, hashing value +
  sensitive + required. Plaintext never goes into a base record, only hashes.
- **Dependencies:** 9.
- **Implementation guidance:** Put this in the service, not in main, so it's
  testable without Electron and reusable. Rebase at most once.
- **Validation:** The full rebase matrix from RFC §9 passes, including env
  deleted, env renamed, flag-only change and parent-env change.

### Task 11: Single-instance lock for the app

- **Status:** ✅ done 2026-10-22: its own validation is met. Uncommitted on
  `feat/vault-env-gui`; not merged, not released. Ungated: every user gets
  it (CHANGELOG "Changed").
- **Goal:** A second launch focuses the existing window instead of starting a
  second process.
- **Constraints:** e2e runs must still be able to launch the app per scenario.
  Each scenario has its own HOME, so check that the lock is per-user-data-dir.
- **Dependencies:** 0.
- **Implementation guidance:** It changes behavior for password-vault users
  too; mention it in the release notes.
- **Validation:** e2e: launching twice leaves one process and one window.
- **Built:**
  - `claimSingleInstance(app, showWindow)` (`src/electron/utils/singleInstance.js`):
    without the lock the process quits before building anything; with it,
    `second-instance` calls `ElectronApp.showWindow()`, which restores and
    focuses the window, or recreates it (macOS, window closed). `activate`
    uses the same method.
  - The e2e driver gives each scenario its own Electron `userData` (on
    macOS it ignored HOME), so the lock, the saved-password file and
    Chromium's profile are per scenario, and never the user's.
- **Validation done:** e2e `single-instance`: a second launch with the same
  user data exits 0, the running app gets `second-instance` and un-minimizes
  its window, one window remains. With the lock disabled, 3 of its 5 checks
  fail. Unit tests for both branches.

### Task 12: Main-process `ClipboardService` + IPC

- **Status:** 🟡 partial 2026-10-22, pulled into the MVP after testing. Uncommitted on `feat/vault-env-gui`; not merged, not released.
- **Built:** `ClipboardService` (main): writes the clipboard; a sensitive
  copy is cleared after 30 s unless the clipboard has changed since; a new
  copy replaces the pending clear. `env:copy` takes a view, a key and a
  format (`value`, `pair`, `key`) and returns no value. Key names and
  public values aren't cleared. The e2e driver saves and restores the
  real clipboard around each scenario.
- **Not done:** password-vault entries still copy from the renderer
  (Task 22, New-3).
- **Goal:** Main writes secrets to the clipboard and clears them after 30 s if
  the clipboard still holds the same value (D6). It's exposed as one IPC channel
  that takes a reference, never a value from an env vault.
- **Constraints:** It must never clear something the user copied afterwards.
  The value is not logged.
- **Dependencies:** New-3 (which secrets go through it).
- **Implementation guidance:** For password entries the renderer already holds
  the value, so the channel's shape differs from `env:copy`. Design both now so
  they don't diverge.
- **Validation:** Tests with a fake clipboard and clock: cleared after 30 s;
  not cleared if the content changed.

### Task 13: Idle lock for password vaults

- **Status:** ✅ done 2026-10-22: its own validation is met. Uncommitted on
  `feat/vault-env-gui`; not merged, not released. Not gated: every user
  gets it (CHANGELOG "Changed").
- **Decided (activity):** input in the window counts: keys, clicks,
  scrolling, touch. The page reports it on `vault-activity`, at most every
  15 s, and only while a vault is unlocked. Nothing else counts, including
  every call the page makes on its own (`load-vault`, `save-vault`, …).
  User-initiated IPC alone wouldn't work here: the page holds the open
  vault's entries, so searching, reading and copying make no call, and a
  user doing that would be locked out every 5 minutes. New-42 then gave env
  vaults the same rule, per vault.
- **Built:**
  - `VaultSession` takes `idleMs`, `onIdle` and injectable timers. `open`
    starts the timer; `touch()` restarts it; `close()` stops it;
    `setIdleMs` restarts it with the new time, counted from now. On expiry
    it closes itself (keys zeroed, as before), then calls
    `onIdle(vaultName, idleMs)`.
  - Main: `vault-locked` is sent with `{reason: 'idle', minutes}` after an
    idle lock (sleep and screen lock send no reason, as before). The
    `vault-activity` channel calls `session.touch()`.
  - The saved timeout applies to both sessions at startup and on each
    change (`applyAppSettings({vaultSession, envSession, registry})`).
  - The `app-settings:*` channels left the env UI gate. Configuration always
    shows App settings: "Lock vaults after"; "Remember environment vaults I
    open" only with the gate on.
  - The page shows "Vault locked after N minutes without activity." It
    stays until dismissed, because the user was away when it happened.
- **Validation done:**
  - `VaultSession.test.js` with a fake clock: locks at 5 min by default
    and calls `onIdle` once; `touch` restarts the time; `withPassword` calls
    don't; no timer after close or while locked; reopening or switching
    vault leaves one timer; `setIdleMs` applies from now; bad values are
    ignored; the real timers work.
  - `AppSession.test.jsx`: the idle message, which stays until dismissed;
    no message for other locks; keys, clicks, wheel and touch are reported
    at most once per 15 s, and only while unlocked.
  - `AppSettingsSection.test.jsx`: the idle time without the env gate, and
    no env setting there.
  - e2e `idle-lock` (env gate off; seeded 1-minute timeout): Configuration
    shows the setting without the env one; unlocked; still unlocked after
    30 s with a `loadVault` call in between; locked about a minute after
    unlock, with the message; main refuses `loadVault` afterwards. 8/8
    scenarios.
  - Coverage: `VaultSession.js` 84% lines (the rest is key derivation,
    covered in `KdfUpgrade.test.js`), `App.jsx` 93%,
    `AppSettingsSection.jsx` 97.5%, `ConfigurationDialog.jsx` 98%.
- **Goal:** An unlocked password vault locks after the configured idle time
  (default 5 min) without user activity (D1).
- **Constraints:** Existing locks on suspend, screen lock and quit are
  unchanged. Background IPC must not count as activity.
- **Dependencies:** New-2 (where the timeout is configured).
- **Implementation guidance:** It's a visible behavior change for every
  current user; release notes. Decide what counts as "activity": input events
  in the renderer, or user-initiated IPC. The RFC uses user-initiated IPC for env
  vaults; use the same rule for both.
- **Validation:** `VaultSession`/main tests with an injected clock: locks at
  the timeout, resets on user-initiated calls, emits `vault-locked`.

### Task 14: `EnvVaultRegistry`

- **Status:** 🟡 partial 2026-10-22. Uncommitted on `feat/vault-env-gui`; not merged, not released.
- **Built:** `EnvVaultRegistry` (`list`, `openFromDialog`,
  `createInAppData`, `resolve`). Ids are random 128-bit hex per run, one per
  path; a picked file must parse with `type: 'environment-vault'` before it
  gets an id. 100% lines.
- **Built 2026-10-22 (recents):**
  - `EnvVaultRecents`: `<appdata>/gui-env-recents.json`,
    `[{path, lastOpened}]`, newest first, at most 50, `0600`. Untrusted
    entries (relative paths, duplicates, bad types) are dropped on read.
  - The registry lists remembered vaults (most recently opened first; a
    missing file shows `exists: false`) and records each file or folder
    opened, unless `rememberRecents` is off. App-folder vaults aren't
    recorded (always listed). A recents read or write failure is logged and
    never stops an open.
  - `forget(id)`: off the list now and in later runs; the file stays.
    Channel `env-vaults:forget`, refused while the vault is unlocked. The
    list shows **Remove from list** on opened vaults that aren't unlocked.
  - `clearRecents()` deletes the kept list (for the toggle, Task 23);
    vaults opened this run stay listed until the app quits.
- **Not done:** `createFromDialog` (a new vault at a chosen path, e.g. a
  project's `.env.vault`); the toggle's UI (Task 23).
- **Validation done (recents):** `EnvVaultMain.test.js`: listed in a later
  run under a new id; newest first; missing file; remove now and later;
  only opened vaults can be removed; app-folder vault not recorded; toggle
  off writes nothing and lists no earlier vault; clear; a broken recents
  store doesn't stop an open; the IPC refuses removing an unlocked vault.
  `AppSettingsStore.test.js`: the recents file itself. UI: Remove from list.
  `EnvVaultRegistry.js` 100% lines.
- **Goal:** Main is the only place that maps opaque ids to vault paths, from
  the appdata scan, the native open/save dialogs and recents (RFC §6.6).
- **Constraints:** Ids are random, per app run. The recents file is `0600`,
  paths only, and isn't written when the toggle is off (D5).
- **Dependencies:** 6, 11, New-2.
- **Implementation guidance:** Write it as a module under `src/electron/services/`
  with dialogs injected, not inline in `public/main.js`, so it's testable
  (`public/**` is excluded from coverage). Validate the file type before minting
  an id.
- **Validation:** Tests: unknown and forged ids resolve to null; a missing
  recent shows `exists: false`; toggle off → nothing written.

### Task 15: `EnvVaultSession`

- **Status:** 🟡 partial 2026-10-22. Uncommitted on `feat/vault-env-gui`; not merged, not released.
- **Built:** `EnvVaultSession`: `unlock`, `run` (every op gets the key
  **and** the password, keeps the key the op returns, maps `AUTH` to
  `LOCKED`), `touch`, `lock`/`lockAll` (keys zeroed, views dropped,
  `env-vault-locked` sent), views scoped to their vault. Hooked into
  suspend, lock-screen and quit. 100% lines.
- **Decision:** `recover` isn't a separate step. Since Task 5 the service
  opens a re-keyed file with the password, so `REKEYED` can't happen while
  the session holds it.
- **Not done:** the idle timeout is a constant (5 min; configurable needs
  New-2); replacing the stored password after a GUI change-password (Task 28).
- **Goal:** Per-id key custody with `commit` / `recover` / user-only idle reset
  / `lockAll`, as RFC §6.6 describes.
- **Constraints:** Key buffers are zeroed on lock. `REKEYED` never reaches the
  renderer.
- **Dependencies:** 5, 14, New-2.
- **Implementation guidance:** Mirror `VaultSession`'s style and documented
  limits. The H3 trap: forgetting `commit` after a write locks the GUI out on
  legacy-KDF vaults. Since Task 5, passing `{ keyMaterial, password }` makes
  the service open a re-keyed file with the password, so `recover` is "call
  again with both, then `commit` the returned key". Only `AUTH` means the
  password changed, which locks the vault.
- **Validation:** The session tests from RFC §9 pass, including a legacy-KDF
  vault edited twice in a row without re-prompting.

### Task 16: `EnvVaultWatcher`

- **Status:** ✅ done 2026-10-22 (second testing round): its own validation is met. Uncommitted on `feat/vault-env-gui`; not merged, not released.
- **Built:** `EnvVaultWatcher` watches the vault's directory while it's
  unlocked (started on unlock, stopped on any lock), debounces 250 ms,
  hashes the file and reports only a revision the app didn't read or write
  itself (`note` on every read and write). A `null` filename is checked the
  same way; other files in the directory are skipped; a vanished file is
  reported as `missing`. Main sends `env-vault-changed`.
- **Page:** the env list reloads; the env on screen reloads with a notice,
  unless a dialog, a selection or an edit is open; then the "changed
  elsewhere" banner shows and the draft stays.
- **Goal:** Emits `env-vault-changed` when the file's revision changes for
  reasons other than our own commits.
- **Constraints:** Watches the directory, not the file. Runs only while
  unlocked. Debounced.
- **Dependencies:** 15.
- **Implementation guidance:** Reuse the lessons from `src/agent/mountWatch.js`.
  Treat a `null` filename as possibly ours.
- **Validation:** Tests: fires after an atomic rename; ignores own commits;
  handles a `null` filename.

### Task 17: IPC gate + core channels + preload

- **Status:** 🟡 partial 2026-10-22. Uncommitted on `feat/vault-env-gui`; not merged, not released.
- **Built:** `createEnvVaultHandlers` (`EnvVaultIpc.js`), registered by main
  through the trusted-sender `handle`, only when the New-4 gate is on:
  `env-vaults:list/open/create`, `env-vault:unlock/lock`, `env:list`,
  `env:view`, `env:refresh` (no idle reset), `env:reveal` (refused with
  `STALE` if the file moved since the view), `env:view-close`,
  `env:commit` (against the view's base revision), `env:create`. Preload:
  `window.electronAPI.envVaults` and `getFeatures`. 99% lines;
  contract tests drive the handlers on a real vault.
- **Added after testing (2026-10-22):** `env:copy`, `env:transfer`,
  `env:export` (preload: `copy`, `transfer`, `exportEnv`). `transact`
  now keeps `CONFLICT` from `mutate`, as it does `LIMIT`.
- **Not done:** `env:bulk-load` (Task 21),
  `env-vault-changed` (Task 16), and the M5 channels (Task 18).
  `env-vaults:create` supports `mode: 'appdata'` only.
- **Goal:** `handleEnvVault` and the M4 channels (`env-vaults:*`,
  `env-vault:unlock/lock`, `env:list/view/refresh/reveal/copy/bulk-load/view-close/commit`),
  plus their preload methods and events.
- **Constraints:** Sensitive values are absent from `view`/`refresh`. `copy`
  returns no value. `refresh` doesn't reset idle.
- **Dependencies:** 10, 12, 14, 15.
- **Implementation guidance:** Keep handlers thin; logic lives in the services.
  Contract tests drive the handler functions directly.
- **Validation:** IPC boundary tests from RFC §9: forged path or id →
  `INVALID`; untrusted sender refused; no sensitive value in view responses.

### Task 18: IPC: structure, history, diff, import/export channels

- **Status:** ✅ done 2026-10-22 (second testing round): its own validation is met. Uncommitted on `feat/vault-env-gui`; not merged, not released.
- **Built:** `env:manage` (rename, duplicate, delete, extends, describe;
  against the list's revision), `env:history`, `env:rollback`, `env:squash`,
  `env:diff`, `env:validate`, `env:import-pick` / `-apply` / `-cancel`,
  `env:template`, `env:edit-text`, `env-vault:change-password`. Export and
  template write through main's save dialog, `0600`.
- **Goal:** The remaining channels from RFC §6.7, each with an
  `expectedRevision` where the RFC requires one.
- **Constraints:** `export`/`template` write through a main-side save dialog;
  the content never crosses IPC.
- **Dependencies:** 17.
- **Validation:** A contract test per channel: success, `STALE` and `INVALID`.

### Task 19: Renderer: Environments switch, vault list, open/new/unlock

- **Status:** ✅ done 2026-10-22: its own validation is met. Uncommitted on `feat/vault-env-gui`; not merged, not released.
- **Built:** `App.jsx` asks main for features; with `envVaults` on, the
  selector shows a **Passwords | Environments** switch and Environments
  renders `EnvVaultsPanel` (list, Open…, New… in the app folder, unlock).
- **Tests:** `AppEnvGate.test.jsx` (gate off, missing, failing, on);
  `EnvVaultsPanel.test.jsx`; e2e `first-launch` checks nothing env-related
  shows with the gate off. Existing App and selector tests pass unchanged.
  `AppFlows.test.jsx` was added to lift `App.jsx` (61.7% before) to 91%.
- **Goal:** Behind the New-4 gate, the selector shows Passwords | Environments.
  Environments lists vaults and opens, creates (no presets) and unlocks them.
- **Constraints:** Nothing env-related is visible with the gate off. The
  password-vault flow is unchanged.
- **Dependencies:** 2 (M0 must be done before env plaintext reaches the
  renderer), 17, New-4.
- **Validation:** Component tests for both gate states. Existing App and
  selector tests pass unchanged.

### Task 20: Renderer: env view

- **Status:** 🟡 partial 2026-10-22. Uncommitted on `feat/vault-env-gui`; not merged, not released.
- **Built:** `EnvView`: masked table, Reveal/Hide per row, inherited keys
  dimmed with "from <parent>" (edit = override, no delete), Add / Edit /
  Delete as one-op changesets, a "changed elsewhere" banner on `STALE` that
  keeps the draft, Reload. Revealed values live only in component state,
  dropped on unmount and on lock. 96% lines.
- **Decision:** editing a masked value reveals it first, so saving an
  untouched field can't wipe the secret.
- **Added after testing (2026-10-22):** Copy (value, key name,
  `KEY=value`) through main; values over 80 characters or multi-line
  are shortened in the table, with a dialog showing the whole value and
  a Copy button; multi-select; Export .env (New-21 and Task 27 have the
  details).
- **Not done:** refresh on window focus or file change (Task 16).
- **Goal:** Masked table, per-row reveal, copy through main, inline edit as a
  one-op changeset, refresh banner, inherited keys marked.
- **Constraints:** Revealed values are cleared on view close and on
  `env-vault-locked`.
- **Dependencies:** 19.
- **Validation:** Component tests: values masked by default; state dropped on
  the lock event; `CONFLICT` keeps the edit.

### Task 21: Renderer: bulk edit (table + dotenv text), conflicts

- **Status:** ✅ done 2026-10-22 (second testing round): its own validation is met. Uncommitted on `feat/vault-env-gui`; not merged, not released.
- **Built:** "Edit as .env": the env's own keys as text (comments as `#`
  lines). Saving diffs the text against what was loaded (`dotenvChanges`)
  and sends one changeset: only changed or new keys, `rm` for removed ones,
  comment edits; reformatting alone sends nothing. Lines the parser would
  skip block the save and are listed by line. Conflicts are listed by key
  with Overwrite; `env-gone` keeps the draft to copy; `LIMIT` offers the
  history to squash.
- **Not done:** editing many rows in the table at once (the text mode and
  multi-select cover it).
- **Goal:** One changeset per save, computed against the view's base. Conflicts
  highlighted; `env-gone` lets the user copy the draft out; `LIMIT` offers
  squash.
- **Constraints:** Text mode must not emit ops for untouched keys.
- **Dependencies:** 20.
- **Validation:** Component tests for text→ops diffing and each conflict kind.

### Task 22: Renderer: move secret copy to `ClipboardService`

- **Status:** ⬜ not started.
- **Goal:** The renderer copy sites decided in New-3 use main's clipboard
  service, with the 30 s clear.
- **Constraints:** Same UX feedback (snackbar, "Copied!").
- **Dependencies:** 12, New-3.
- **Validation:** No `navigator.clipboard` call remains for secrets
  (grep-based test); component tests pass.

### Task 23: Renderer: Settings for idle timeout and recents

- **Status:** ✅ done 2026-10-22: its own validation is met. Uncommitted on
  `feat/vault-env-gui`; not merged, not released. Since Task 13 the idle
  timeout covers password vaults too, and the section is no longer gated
  (its env vault setting still is).
- **Goal:** Settings UI for D1 (timeout) and D5 (recents toggle, which clears
  the list when turned off).
- **Dependencies:** 13, 14, New-2.
- **Validation:** Component tests; the setting persists across an app restart
  (e2e).
- **Built:**
  - **App settings** at the top of the Configuration dialog (menu, or
    Ctrl/Cmd+S), so it works with every vault locked:
    - "Lock environment vaults after" 1–240 minutes without activity (a
      saved value outside the usual choices is listed too);
    - "Remember environment vaults I open"; turning it off deletes the kept
      list (vaults opened this run stay listed until quit).
      Each change saves at once and says what it did; a refused change keeps
      the old value and shows why; a damaged settings file shows its warning.
  - Channels `app-settings:get` / `app-settings:update`
    (`AppSettingsIpc.js`), behind the env UI gate while both settings
    concerned env vaults; they left the gate with Task 13. Preload
    `appSettings.get/update`.
  - `applyAppSettings`: `EnvVaultSession.setIdleMs` (restarts every unlocked
    vault's timer from now), and `registry.clearRecents()` when remembering
    goes from on to off. Main applies the saved settings at startup.
- **Validation done:**
  - `AppSettingsSection.test.jsx`: shows saved values; idle and remember
    changes saved and confirmed; an unusual saved value; the damaged-file
    warning; refused, unloadable and unsavable changes. The dialog shows
    the section only when asked, plus tests for what it showed before
    (storage folder, unlocked vault details, load errors, Close), which had
    none.
  - Unit: the channels apply only a saved change, with the before and after
    values; idle time in ms; the list is cleared only on on → off, not at
    startup; `setIdleMs` restarts open timers and ignores bad values.
  - e2e `app-settings`: a seeded earlier run (30-minute timeout, a
    remembered project vault): the vault is listed, the dialog shows 30
    minutes; turning remembering off deletes `gui-env-recents.json` and
    saves the change for the next run. 7/7 scenarios.
  - Coverage: `AppSettingsSection.jsx` 97.5% lines,
    `ConfigurationDialog.jsx` 98% (53% with only the new tests),
    `EnvVaultSession.js` 98.6%.
  - Found: one full unit run of ten failed one test, not identified
    (New-41).

### Task 24: Renderer: env structure ops

- **Status:** ✅ done 2026-10-22 (second testing round): its own validation is met. Uncommitted on `feat/vault-env-gui`; not merged, not released.
- **Built:** a ⋮ per env: Rename (envs that extend it follow), Duplicate
  (values, flags, comments, parent; fresh history), Description, Parent
  (refuses a loop), Delete (refused while another env extends it; keeps a
  `.deleted.` snapshot). The list shows the parent and description. The env
  on screen reloads after any of them.
- **Goal:** Create, rename, copy, delete env, extends and description, with a
  plain confirm on delete.
- **Dependencies:** 18, 20.
- **Validation:** Component tests; `STALE` triggers a reload message.

### Task 25: Renderer: history, rollback, squash

- **Status:** ✅ done 2026-10-22 (second testing round): its own validation is met. Uncommitted on `feat/vault-env-gui`; not merged, not released.
- **Built:** History (newest first; date, message, key count and +/− keys
  against the current version; no values), Roll back (as a new version) and
  Squash to N versions, each behind a confirm; the squash confirm names the
  `.squashed.` snapshot.
- **Goal:** A history list; rollback and squash with a plain confirm.
- **Dependencies:** 7, 18, 20.
- **Validation:** Component tests; the squash confirm says a snapshot is kept.

### Task 26: Renderer: diff and validate

- **Status:** ✅ done 2026-10-22 (second testing round): its own validation is met. Uncommitted on `feat/vault-env-gui`; not merged, not released.
- **Built:** Compare with… another env, as they resolve: keys only in one,
  and different values masked until "Show values" asks main again with
  `reveal: true`. Validate shows `vault env validate`'s errors and
  warnings.
- **Goal:** Diff is masked by default, with "Show values" re-requesting with
  `reveal: true`. Validate shows the issues.
- **Dependencies:** 18, 20.
- **Validation:** Component tests; no values in a masked diff response.

### Task 27: Renderer: import, export, template

- **Status:** ✅ done 2026-10-22 (second testing round): its own validation is met. Uncommitted on `feat/vault-env-gui`; not merged, not released.
- **Built:** Import .env…: main opens the file and parses it
  (`parseDotenv`), the page gets key names with new / changed / same, the
  file's comments, and skipped lines. The user picks keys, merge or replace
  (lists what it removes), and whether to use the comments; one version.
  Values stay in main under a one-time token, dropped on cancel, apply, or
  once the session's view is gone. Save template writes `.env.example`
  (required keys marked `<required>`, comments kept). Export as before.
- **Not done:** JSON export from the app (New-35).
- **Goal:** Import a `.env` through main's open dialog; export and template
  through main's save dialog.
- **Dependencies:** 18, 20.
- **Validation:** Component tests; the exported file mode is `0600` (main test).

### Task 28: Renderer: env vault change-password

- **Status:** ✅ done 2026-10-22 (second testing round): its own validation is met. Uncommitted on `feat/vault-env-gui`; not merged, not released.
- **Built:** Change password (current, new, confirm). Main checks the
  current one, re-keys the snapshots, and the session keeps working with
  the new password (`setPassword`); the env on screen reloads quietly.
  Snapshots that didn't open with the old password are reported.
- **Goal:** Change-password with current + new password; the session updates
  without re-prompting.
- **Dependencies:** 7, 18, 19.
- **Validation:** Component tests; after the change, the old password fails
  and the snapshots are re-keyed (service test from Task 7).

### Task 29: e2e scenario `env-vault-concurrent`

- **Status:** 🟡 partial 2026-10-22. Uncommitted on `feat/vault-env-gui`; not merged, not released. The `env-vault` e2e scenario covers
  seed → open → unlock → reveal → edit → another tool writes → `STALE`, nothing
  overwritten → reload → save keeps both. The rebase and conflict steps wait
  on Task 10.
- **Goal:** RFC goal 7 as an e2e scenario (seed → open → unlock → edit →
  CLI `set` → banner → disjoint commit rebased → overlapping commit conflicts).
- **Dependencies:** 21.
- **Implementation guidance:** The scenario has an isolated HOME; spawn the
  CLI with the same HOME so both resolve the same appdata.
- **Validation:** `node e2e/run.mjs env-vault-concurrent` passes.

### Task 30: CI e2e job (ubuntu + xvfb)

- **Status:** 🟡 built 2026-10-22; done when a push shows the `e2e` job
  green. Uncommitted on `feat/vault-env-gui`.
- **Goal:** Every PR runs all e2e scenarios (D3).
- **Constraints:** Must not make the existing CI job slower; run as a separate
  job.
- **Dependencies:** 1, 29.
- **Implementation guidance:** Electron on Linux CI needs a virtual display and
  usually `--no-sandbox`-related setup for the **Chrome** sandbox (the SUID
  helper), which is distinct from the renderer `sandbox` option in Task 1.
  Don't weaken Task 1 to make CI pass.
- **Validation:** A green e2e job on a PR; a deliberately broken scenario turns
  it red.
- **Built:** an `e2e` job in `ci.yml` on `ubuntu-latest`, in parallel with
  Verify: `npm ci`, then `xvfb-run -a npm run test:e2e`. The renderer
  sandbox (Task 1) is untouched; the job lifts Ubuntu 24.04's AppArmor
  restriction on unprivileged user namespaces so Chromium's own sandbox can
  start (the same step as the release workflow's packaged check, New-19).
- **Checked so far:**
  - Linux: all 5 scenarios pass ("the renderer is sandboxed" among their
    checks) in a Debian bookworm arm64 container with `xvfb-run`, run
    as a non-root user from a fresh `npm ci`. The container was privileged,
    which the GitHub runner (a VM) isn't; the sysctl step stands in for it.
  - A deliberately failing scenario makes `e2e/run.mjs` exit 1, which fails
    the job.
  - Still to see: the job green on a GitHub push.

### Task 31: User guide `docs/guide/gui/env-vaults.md`

- **Status:** ⬜ not started.
- **Goal:** Users can find and use env vaults in the app; the CLI guide links
  to it.
- **Dependencies:** 21.
- **Validation:** `npm run docs:build` succeeds; the page appears in the
  sidebar.

---

## Discovered work

### New-1: Coverage can't see the code this plan changes

- **Status:** ✅ decided 2026-10-21: option (a), approved with Task 0. Every
  task measures its touched files and records the numbers in its entry. No
  change to the project config. Option (b) moved to New-6. **The command
  originally written here (`--coverage.include` alone) doesn't work**
  (Correction 5). Until New-7 commits a tool, use a Vitest config that
  spreads `vite.config.js` and replaces only `test.coverage.include` (the
  touched files) and `exclude` (`node_modules`, `src/__tests__`), with
  thresholds off. Run it with `--config <that file> --root <repo> --coverage`.
- **Found:** Task 0, 2026-10-21.
- **Goal:** Every task's "≥70% lines on touched files" check is measured and
  recorded, including files under `src/electron/**`, `public/**` and `bin/**`.
- **Constraints:** Project totals must not drop below the baseline. Don't
  silently lower the existing thresholds.
- **Dependencies:** Blocks the Definition of Done for 1, 3 and most later
  tasks.
- **Implementation guidance:** Options: (a) measure per task with an explicit
  command, e.g. `npx vitest run --coverage --coverage.include='<files>'`, and
  record the numbers here, with no config change; (b) remove
  `src/electron/**` from the exclude list. That's the honest fix, but it will
  likely move the project totals, maybe below the gate, and the reason for the
  exclusion isn't recorded. **Recommendation: (a) now, and (b) as a separate
  decision.** `public/main.js` can't be meaningfully unit-tested in place,
  which is why Tasks 14–17 put logic in `src/electron/services/`.
- **Validation:** Each finished task in this file lists the command it ran
  and the per-file line coverage.
- **Cost of leaving it:** The DoD's coverage gate passes trivially for the
  riskiest code in the plan (locking, crypto, IPC).

### New-2: App-wide settings store

- **Status:** ✅ done 2026-10-22: its own validation is met. Uncommitted on
  `feat/vault-env-gui`; not merged, not released.
- **Found:** Task 0, 2026-10-21 (Correction 4).
- **Goal:** Main can read and write non-secret app settings (idle timeout,
  recents toggle) while every vault is locked.
- **Constraints:** Plain JSON in appdata, `0600`, written atomically, written
  only by main. No secrets in it.
- **Dependencies:** Blocks 13, 14, 15, 23.
- **Implementation guidance:** Don't put these in `VaultSettingsService`. It's
  per password vault and encrypted, so it's unreadable when locked, and env
  vaults aren't password vaults.
- **Validation:** Unit tests: defaults when the file is missing; survives a
  corrupt file (falls back to defaults and says so); the file mode is `0600`.
- **Built:**
  - `AppSettingsStore` (`src/electron/services/`):
    `<appdata>/app-settings.json`, `{format: 1, settings}`, with
    `idleMinutes` (default 5, whole minutes 1–240) and `rememberRecents`
    (default on). `get()`, `update(patch)`, `warning`.
    - A damaged file, another format, or no settings: defaults, and
      `warning` says so; one bad value falls back alone.
    - `update` refuses unknown keys and invalid values as a whole, writing
      nothing; if the write fails, the old value stays in effect.
  - `writePrivateJson` / `readJsonFile` (`src/electron/utils/privateJsonFile.js`):
    temp file `0600` and `moveWithRetry` over the target. The keychain file
    (New-24) now uses it too.
  - Main creates the store and gives the env registry `rememberRecents`.
    No IPC yet: the Settings screen is Task 23.
- **Validation done:** `AppSettingsStore.test.js`: the cases above, plus
  overlapping updates keep both changes (a first version lost one; the test
  caught it) and a failed write keeps the old value. 100% lines.
- **Cost of leaving it:** D1 and D5 can't be configured, and the idle timeout
  would be hard-coded.

### New-3: Decide which secrets go through `ClipboardService`

- **Status:** ⬜ not started (decision needed from the author).
- **Found:** Task 0, 2026-10-21 (Correction 3).
- **Goal:** A recorded decision on which renderer copy sites move to main:
  password fields, TOTP codes, the recovery key.
- **Constraints:** None until decided.
- **Dependencies:** Blocks 12, 22.
- **Implementation guidance:** Recommendation: all three. A recovery key on the
  clipboard is the most dangerous of them, and a TOTP code expires in 30 s
  anyway, so its clear is harmless.
- **Validation:** The decision is recorded under Decisions with its date.
- **Cost of leaving it:** Task 22's scope is undefined, and the D6 promise
  ("clipboard is cleared") would be true for some secrets and not others.

### New-4: Feature gate for the Environments UI

- **Status:** ✅ done 2026-10-22: its own validation is met. Uncommitted on `feat/vault-env-gui`; not merged, not released.
- **Built:** `readFeatures()` (`src/electron/utils/features.js`): the
  Environments UI is on in dev runs (`ELECTRON_IS_DEV=1` or
  `NODE_ENV=development`) and off in production and packaged builds;
  `SECURE_VAULT_ENV_UI=1`/`0` forces it on/off (changed 2026-10-22 so
  `npm run dev:electron` shows it without setup). With it off, main registers **none** of the env channels, and
  the renderer shows nothing env-related (it asks main via `get-features`).
- **Flip criterion:** see the rollout plan's Gates table.
- **Found:** Task 0, 2026-10-21.
- **Goal:** The env UI can be merged task by task without a tagged release
  exposing a half-built feature.
- **Constraints:** Off by default. No remote config; there's no backend.
- **Dependencies:** Blocks 19.
- **Implementation guidance:** Releases are cut from any tag on `main`, so
  without a gate, the first tag after Task 19 ships a partial UI. Options: a
  build-time flag, or an app setting (New-2) that's hidden until flipped.
  Decide the flip criterion here (proposed: Tasks 19–21 and 29 done, M0 done).
- **Validation:** A component test shows nothing env-related with the gate
  off. The rollout plan names the gate, its default and its flip criterion.
- **Cost of leaving it:** Either work piles up unmerged on a long branch, or a
  partial UI ships in the next tag.

### New-5: Verify async PBKDF2 in the Bun-compiled CLI binary

- **Status:** ✅ done 2026-10-22: its own validation is met. Uncommitted
  on `feat/vault-env-gui`; not merged, not released.
- **Found:** Task 0, 2026-10-21.
- **Goal:** The standalone `vault` binaries (`scripts/build-cli.js`, Bun
  `--compile`) derive keys with the async path and produce the same keys as
  Node.
- **Constraints:** Must check a real compiled binary, not `bun run`.
- **Dependencies:** 3. Blocks the release that carries Task 3.
- **Implementation guidance:** The npm CLI runs on Node; the binaries run on
  Bun's `node:crypto`. A compatibility gap would show up only in the binary.
- **Validation:** `npm run package:cli`, then the compiled binary opens a vault
  created by the Node CLI, and the reverse.
- **Cost of leaving it:** Binary users could fail to unlock vaults after the
  release, and no test would catch it.
- **Built:**
  - `scripts/verify-cli-binary.mjs <binary>` runs the Node CLI and a compiled
    binary against the same vaults:
    - each creates a vault the other reads, and each writes to a vault the
      other then reads back;
    - a vault re-keyed at the legacy count with no `kdf` header is read and
      written by the binary;
    - a wrong password fails in the binary.
  - `release.yml` runs it on the `vault-linux-x64` binary right after
    `npm run package:cli`; a mismatch stops the release.
- **Validation:** 6/6 with `vault-macos-arm64` compiled by Bun 1.4.4
  (`npx bun@1 build bin/cli.js --compile --target=bun-darwin-arm64`).
  `vault-linux-x64` is checked on every release run. `vault-macos-x64`,
  `vault-linux-arm64` and `vault-windows-x64.exe` aren't run anywhere; they
  share Bun's crypto code with the two that are.

### New-6: Decide whether project coverage should include `src/electron/**`

- **Status:** ⬜ not started (decision needed from the author; not blocking).
- **Found:** Task 0, 2026-10-21 (split from New-1 option (b)).
- **Goal:** A recorded decision on whether `src/electron/**` comes out of the
  coverage `exclude` list in `vite.config.js`, and the thresholds that follow.
- **Constraints:** Must not lower the existing thresholds to make the gate pass.
- **Dependencies:** New-1 (decided). Independent of every numbered task.
- **Implementation guidance:** First measure what the totals would be with the
  exclusion removed; nobody recorded why it was added. A drop below the gate
  means either tests for unrelated code or a new threshold, and both need a
  decision, not a quiet edit.
- **Validation:** The decision and the measured totals are recorded here.
- **Cost of leaving it:** The per-task measurement (New-1) covers new work, but
  existing services stay unmeasured, and a regression in them doesn't move the
  project number.

### New-7: Commit a way to measure coverage of excluded files

- **Status:** ⬜ not started.
- **Found:** Task 3, 2026-10-21 (Correction 5).
- **Goal:** Anyone can measure line coverage for a chosen set of files,
  including excluded paths, with one committed command, e.g.
  `npm run coverage:files -- <file> [<file>…]`.
- **Constraints:** Must not change what `npm run test:coverage` measures or its
  thresholds (that's New-6). No new dependencies.
- **Dependencies:** New-1 (decided). Every later task's DoD uses it.
- **Implementation guidance:** The CLI flag doesn't work because the config's
  `exclude` still applies. The working shape is a small config that imports
  `vite.config.js`, spreads it, and overrides only the coverage scope; Task 3
  used exactly that from a scratch directory. Put it under `scripts/` and point
  `reportsDirectory` somewhere other than `./coverage`, so it doesn't overwrite
  the real report.
- **Note from New-12:** the `text` reporter hides fully covered files (a 100%
  file printed no row). Use the `json-summary` reporter and read
  `coverage-summary.json` for exact per-file numbers.
- **Validation:** Running it on `src/electron/services/CryptographyService.js` prints that file's row (100% lines at Task 3), and `npm run test:coverage`
  output is unchanged.
- **Cost of leaving it:** Each task re-creates the config by hand from this
  note. It lives outside the repo, so a reviewer can't re-run the measurement
  the task recorded.

### New-8: `npm run lint` fails locally on gitignored build output

- **Status:** ⬜ not started.
- **Found:** Task 3, 2026-10-21.
- **Goal:** `npm run lint` on a developer machine reports the same as CI.
- **Constraints:** Don't disable rules or lower severities; only stop scanning
  generated files.
- **Dependencies:** None.
- **Implementation guidance:** The 782 local problems come from
  `docs/.vitepress/cache` and `docs/.vitepress/dist`, which `.gitignore`
  excludes but `eslint.config.js` doesn't. CI never builds the docs before
  linting, so it stays green. Add them to the ESLint ignores.
- **Validation:** After `npm run docs:build`, `npm run lint` exits 0 with the
  same warning count as on tracked files (344 at Task 3).
- **Cost of leaving it:** Local lint is always red, so nobody trusts it, and a
  real new error goes unnoticed until CI.

### New-9: Type-check gate: confirm "no new errors" as this plan's rule

- **Status:** ✅ decided 2026-10-21, approved with Task 3 ("next"): the
  proposed rule below is this plan's type-check gate (see Decisions).
- **Found:** Task 3, 2026-10-21.
- **Goal:** A recorded rule for the DoD's "type check passes", given 345
  pre-existing `tsc` errors and CI running it report-only.
- **Constraints:** Must not hide new errors in touched code.
- **Dependencies:** None; every task's DoD reads it.
- **Implementation guidance:** Proposed rule: the total stays ≤ the baseline
  (345), and no error points at a line the task changed. Task 3 was checked
  that way. Fixing the 345 is out of scope; if wanted, it's a separate task.
- **Validation:** The rule is recorded under Decisions with its date.
- **Cost of leaving it:** "Type check passes" stays impossible to meet
  literally, so each task interprets it on its own.

### New-10: Lock: a container sharing the kernel can look like this machine

- **Status:** 🟡 partial 2026-10-21: built and unit-tested; committed as
  `ac641ad`, approved by the author; not merged, not released. **Waiting on:** the first CI run on Ubuntu
  (`ci.yml`, after the branch is pushed). That's the only place the real
  `/proc/self/ns/pid` read runs; this machine is macOS, where the test is
  skipped.
- **Built:**
  - `currentPidNamespace()` reads `/proc/self/ns/pid` on Linux and returns
    undefined elsewhere or when `/proc` is unreadable.
  - The lock records it as `pidns`. The field is omitted when undefined, so
    on macOS and Windows both sides compare equal and nothing changes there.
  - "Same machine" now needs the same boot time **and** the same `pidns`.
    Anything else falls back to the mtime rule, the safe direction. That
    includes a lock where only one side knows its namespace.
- **Tests:** 8 new tests (33 total, 1 Linux-only):
  - a container lock with a "dead" pid and a fresh mtime is **not** taken
    over; one with a stale mtime is;
  - one-sided namespace knowledge: no pid probe;
  - no `pidns` field off Linux;
  - `currentPidNamespace` on Linux, with an unreadable `/proc`, and off
    Linux;
  - a real-namespace check that runs only on Linux.

  Existing tests now pin the namespace, so "same machine" means the same
  thing on macOS and Linux CI. Mutation: dropping the namespace condition
  fails 3 tests.

- **Evidence:** 885 passed + 1 skipped. `VaultLock.js` 96.39% lines.
  Project totals unchanged. Lint on tracked files 0 errors / 344 warnings.
  `tsc` 345 (= baseline), none in the lock files.
- **Found:** Task 4, 2026-10-21.
- **Goal:** A lock held by a process in another pid namespace is never judged
  stale by a pid probe from this one.
- **Constraints:** Keep the boot-time rule (it's what survives macOS hostname
  changes, RFC review finding L1). No new dependencies.
- **Dependencies:** 4. **Blocks the release of Task 6** on Linux.
- **Implementation guidance:** On Linux, a Docker container shares the host
  kernel, so it reports the **same boot time**. Its pids live in a different
  namespace, though. A `vault` CLI in a devcontainer locking a bind-mounted
  `.env.vault` writes, say, pid 42. The host probes its own pid 42, finds it
  dead (or someone else), and takes over a **live** lock, which is exactly the
  lost update this plan prevents. Fix: record the pid-namespace id (inode of
  `/proc/self/ns/pid`, Linux only) in the lock and require it to match before
  trusting a pid probe. Otherwise fall back to the mtime rule. macOS and
  Windows have no shared-kernel containers (Docker Desktop runs a VM with its
  own boot time), so they're unaffected.
- **Validation:** A unit test with an injected namespace id: a same-boot lock
  with a different namespace and a "dead" pid is **not** taken over while its
  mtime is fresh. Existing VaultLock tests stay green.
- **Cost of leaving it:** On Linux with containers, a GUI or host CLI can
  silently overwrite a write made from inside a container.

### New-11: Bring RFC §6.5 in line with Corrections 6 and 7

- **Status:** ⬜ not started.
- **Found:** Task 4, 2026-10-21.
- **Goal:** The approved RFC describes the lock that was actually built.
- **Constraints:** Documentation only. Mark it as a revision with a date; don't
  rewrite history.
- **Dependencies:** 4 (and New-10 if it changes the lock's fields).
- **Implementation guidance:** Remove `refreshedAt` from the lock schema, add
  `pidns` and the boot + namespace "same machine" rule (New-10), describe the
  mtime heartbeat, and replace "atomic, so only one taker wins"
  with verify-and-restore. Do it after New-10, so the schema changes once.
- **Validation:** RFC §6.5's table matches `VaultLock.js`, and its header
  notes the revision.
- **Cost of leaving it:** Anyone reading the approved design (a reviewer, or
  whoever implements Task 8's `doctor`) builds against a field that doesn't
  exist.

### New-12: Windows: retry the final rename on `EPERM`

- **Status:** ✅ done 2026-10-21: its own validation is met. Committed as
  `8b2a0f4`, approved by the author; not merged, not released. **Simulated,
  not run on Windows:** no machine or CI job here runs the tests on Windows (New-13).
- **Built:**
  - `src/electron/utils/moveWithRetry.js`: `fs.move(…, { overwrite: true })`,
    retried up to 3 tries, 50 ms apart, **only on `win32`** and only for
    `EPERM`/`EBUSY`/`EACCES`. Other errors, and the same codes on other
    platforms (where they're real permission problems), fail at once.
    Platform, move and sleep are injectable.
  - `#writeEncrypted` (shared by `saveVault` and `transact`) uses it.
    When the rename finally fails, it removes the `.tmp` and rethrows; the
    vault is untouched.
  - That cleanup applies on **every platform**, not just Windows. A failed
    rename used to leave `<vault>.tmp` behind everywhere. Removing it is
    harmless (it was never the vault) and the validation required it.
- **Tests:**
  - 9 unit tests: the retry per code, giving up after 3 tries, no retry on a
    non-transient code, no retry on darwin/linux, a real move.
  - 2 filesystem tests through `transact` with `process.platform` set to
    `win32`: saves after 2 blocked renames; after 3, `ERROR` with the vault
    byte-identical, no `.tmp` and no lock left.

  Mutations, each caught: never retry; retry on every platform; skip the
  `.tmp` cleanup.

- **Evidence:** 914 passed + 1 skipped. `moveWithRetry.js` 100% lines,
  `EnvironmentVaultService.js` 92.3%. Project totals unchanged. Lint clean.
  `tsc` 345 (= baseline), 0 on changed lines. A first pass had 6 new errors
  in the test (options typed from their defaults), fixed with JSDoc.
- **Found:** Task 5, 2026-10-21. RFC §11 lists it as a mitigation ("bounded
  retry, 3× / 50 ms"), but no task owned it.
- **Goal:** On Windows, a vault write doesn't fail because another process
  (an antivirus scanner, the GUI watcher hashing the file, a reader) has the
  target open at the moment of the rename.
- **Constraints:** Bounded (3 tries, 50 ms apart), Windows-only behavior, and
  still under the vault lock. Retry only `EPERM`/`EBUSY`/`EACCES` on the
  rename; never swallow other errors.
- **Dependencies:** 5 (`#writeEncrypted` is the one place to change). Blocks
  the release of Task 6 to Windows users, and matters more once the GUI
  watcher (Task 16) reads the file.
- **Implementation guidance:** `fs.move(tmp, vault, { overwrite: true })` is
  the rename. Wrap it, not the whole write. Test with an injected rename that
  fails twice with `EPERM` and then succeeds. If it fails all three times,
  the temp file must still be cleaned up and the vault left intact.
- **Validation:** Unit tests: success after two `EPERM`s; after 3 failures,
  `ERROR` with the vault byte-identical and no `.tmp` left.
- **Cost of leaving it:** Windows users get sporadic "failed to save" errors,
  most likely while the GUI is open. Nothing is lost (the old file stays), but
  the CLI looks unreliable there.

### New-13: CI runs the unit tests on Windows and macOS too

- **Status:** 🟡 built 2026-10-22; waits on its first CI run. Done when a
  push shows both new jobs green.
- **Found:** New-12, 2026-10-21.
- **Goal:** Every PR runs `npm run test:coverage` (or at least
  `npx vitest run`) on `windows-latest` and `macos-latest` as well as
  Ubuntu.
- **Constraints:** Don't slow the existing Ubuntu gate. Run the extra
  platforms as parallel matrix jobs. Coverage thresholds stay enforced on one
  platform only, so platform-specific branches don't make the gate flaky.
- **Dependencies:** None. It verifies Task 4 and New-10 (Linux already runs),
  and New-12, Task 6 and Task 16 on Windows.
- **Implementation guidance:** `release.yml` already builds on Windows and
  macOS, so the runners work. Tests that touch POSIX-only behavior (file modes
  like `0600`, `process.kill` semantics, `/proc`) are already guarded or
  injected, but expect a first run to surface a few path-separator and
  file-locking assumptions in older tests. Those are findings, not reasons to
  skip the job.
- **Validation:** A PR shows green Windows and macOS test jobs. Then a
  Windows-only assertion (for example in `moveWithRetry.test.js`, which runs
  the real move) runs there instead of being simulated.
- **Cost of leaving it:** Windows behavior in the lock (pid probes, `utimes`,
  rename-aside takeover) and in the write path (New-12) stays simulated.
  Windows users would be the first to run it for real.
- **Built:**
  - `ci.yml` has a second job, "Unit tests", on `windows-latest` and
    `macos-latest` (`fail-fast: false`), in parallel with Verify. It runs
    `npx vitest run` without coverage, so thresholds stay on Ubuntu. It
    checks out with `core.autocrlf false`, so files keep the line endings
    they were committed with.
  - `moveWithRetry.test.js` gains two Windows-only tests on a real file: a
    PowerShell process holds the target open without delete sharing; a
    rename with no retries fails with `EPERM`/`EBUSY`/`EACCES`, and with
    retries it lands once the holder closes. They skip elsewhere.
- **Validation:** macOS: the full suite passes locally (1222, the two
  Windows tests skipped). Windows: not run yet; the first run may surface
  path-separator or file-locking assumptions in older tests, to fix rather
  than skip.

### New-14: Remove the env `saveVault` and its mocked tests

- **Status:** ⬜ not started.
- **Found:** Task 6, 2026-10-21.
- **Goal:** `EnvironmentVaultService.saveVault` is gone; the only write path
  is `transact`.
- **Constraints:** Keep the behaviors its tests prove (`.bak` kept,
  temp + rename, `.bak` replaced after a re-key) covered, through `transact`.
  `KdfUpgrade.test.js` is the main other user.
- **Dependencies:** 6.
- **Implementation guidance:** Since Task 6 nothing calls it; a guard test
  keeps it that way. Its mocked tests in `EnvironmentVaultService.test.js`
  ("saveVault", "saveVault backup + atomic write") test `#writeEncrypted`
  through it. Move those checks to real-fs `transact` tests first, then
  delete.
- **Validation:** `grep -n "saveVault" src/electron/services/EnvironmentVaultService.js`
  finds nothing; the suite is green.
- **Cost of leaving it:** A dead public method that looks like a valid way to
  write a vault. The guard test catches new callers, but a reader may still
  copy the pattern.

### New-15: Type `window.electronAPI` once for the type check

- **Status:** ⬜ not started.
- **Found:** Task 19, 2026-10-22.
- **Goal:** `tsc` knows `window.electronAPI`, so renderer files stop
  reporting it as missing.
- **Constraints:** `tsconfig.json` only includes `*.js`/`*.jsx`; a `.d.ts`
  needs an include change.
- **Dependencies:** none.
- **Implementation guidance:** New code avoids the error with a typed
  accessor (`src/components/env/envApi.js`) or a `/** @type {any} */` cast
  in tests. A `Window` declaration would remove dozens of existing errors
  in `App.jsx` and the component tests at once.
- **Validation:** no `Property 'electronAPI' does not exist` errors remain.
- **Cost of leaving it:** noise that hides real type errors in renderer code.

### New-16: ESLint flags MUI components used only in JSX as unused

- **Status:** ⬜ not started.
- **Found:** Tasks 19–20, 2026-10-22.
- **Goal:** `no-unused-vars` stops reporting imports used only in JSX.
- **Constraints:** no new errors; warnings only go down.
- **Dependencies:** none.
- **Implementation guidance:** enable `react/jsx-uses-vars` (and
  `jsx-uses-react`) from `eslint-plugin-react` in `eslint.config.js`.
  This iteration added 49 such warnings (343 → 392), all false positives.
- **Validation:** the warning count drops by at least those 49; 0 errors.
- **Cost of leaving it:** real unused imports are lost among false ones.

### New-17: Shared test mock lacks `removeAllListeners` / `onVaultLocked`

- **Status:** ⬜ not started.
- **Found:** Task 19 tests, 2026-10-22.
- **Goal:** unmounting `App` under `src/setupTests.js`'s mock doesn't throw.
- **Constraints:** existing tests keep passing.
- **Dependencies:** none.
- **Implementation guidance:** add the two methods (and `getFeatures`) to
  the shared mock; `AppEnvGate.test.jsx` adds them locally today.
- **Validation:** an App test can unmount without local patches.
- **Cost of leaving it:** each new App test re-patches the mock.

### New-18: Dev-mode Content-Security-Policy

- **Status:** ⬜ not started.
- **Found:** Task 2, 2026-10-22.
- **Goal:** `npm run dev:electron` runs under a CSP close to production's.
- **Constraints:** Vite HMR needs `ws://localhost:3000`; plugin-react's
  refresh preamble is an inline script.
- **Dependencies:** 2.
- **Implementation guidance:** a `serve`-only plugin with a nonce or hash
  for the preamble, or set the header from main for the dev URL.
- **Validation:** dev mode loads with HMR and no CSP violations.
- **Cost of leaving it:** a CSP regression (e.g. a new inline script) only
  shows up in the built app.

### New-19: Verify the CSP and sandbox in packaged builds (asar)

- **Status:** 🟡 partial 2026-10-22: passed on macOS (arm64, unsigned
  `electron-builder --mac --dir`). Windows and Linux run in the release
  workflow's new smoke step; run it with "Run workflow" on the Release
  workflow (no tag needed) and the item is done when both are green.
  Uncommitted on `feat/vault-env-gui`.
- **Found:** Task 2, 2026-10-22.
- **Goal:** the packaged app on macOS, Windows and Linux starts, renders, and
  logs no CSP violation.
- **Constraints:** Task 2's guidance: test the packaged build, not just the
  built one.
- **Dependencies:** 2. **Blocks the next tag**, because the CSP and the
  sandbox ship ungated and affect password vaults too.
- **Built:**
  - `e2e/packaged.mjs` (`npm run test:packaged`) runs the unpacked app
    electron-builder leaves in `dist/` (or a path given), with an empty home
    and its own Chromium profile, and drives it over the DevTools protocol.
    It checks:
    - the page loads from inside `app.asar`;
    - the page carries the CSP and has no Node.js;
    - the renderer runs sandboxed, read from the real process's flags
      (`--enable-sandbox`, never `--no-sandbox`);
    - a vault is created, listed and unlocked through the UI;
    - no CSP violation, from page events, the console or the app's log.
  - The page helpers move from `e2e/driver.cjs` to `e2e/pageHelpers.cjs`,
    shared by both runners.
  - `release.yml` runs the check after packaging on each OS (Linux under
    `xvfb-run`, with Ubuntu 24.04's user-namespace restriction lifted so
    Chromium's sandbox can start). A failure stops the release.
- **Validation:**
  - macOS: 10/10, with and without a global `WebSocket` (Node 20 uses the
    `ws` fallback).
  - The check can fail: a copy that makes the page run an inline script
    reports the violation in the page and in the log (8/10). A plain
    Electron window with `sandbox: false` gets `--no-sandbox`, with
    `sandbox: true` `--enable-sandbox`.
  - Still to do: Windows and Linux green in the release workflow.
- **Found while doing it:**
  - New-38: the packaged app keeps Electron's default fuses.
  - New-39: a page load aborted at startup loops on `ERR_FAILED` (fixed).
  - Chromium keeps its profile in the real `~/Library/Application Support`
    on macOS even with `HOME` changed; the check passes `--user-data-dir`.
    Whether `npm run test:e2e` writes there too is not checked.
- **Cost of leaving it:** a blank window for every user if `file://` inside
  asar treats `'self'` differently.

### New-20: Fix: reveal/edit fail with "Unknown view" in dev

- **Status:** ✅ done 2026-10-22: its own validation is met. Uncommitted on `feat/vault-env-gui`; not merged, not released.
- **Found:** author testing `npm run dev:electron` on a real 194 KB vault:
  Reveal and Edit failed with "Unknown view" in some environments.
- **Cause:** React StrictMode mounts `EnvView` twice in dev, so two
  `env:view` calls run at once. `openView` dropped any older view of the same
  env; when the abandoned call finished last, it dropped the view the page
  showed. The e2e didn't see it: it runs the production build.
- **Fix:**
  - Main no longer drops other views of an env. At most 32 views per vault,
    oldest evicted first.
  - The page closes a view that comes back to an unmounted component.
- **Validation:** `EnvVaultsReal.test.jsx` renders the panel in StrictMode
  on the real handlers, with the first `env:view` slowed. It failed (3/3)
  before the fix. A session test pins the cap; it caught an off-by-sign bug
  in the first version (a negative `slice` end dropped 9 of 20 views).

### New-21: Move or duplicate keys between environments

- **Status:** ✅ done 2026-10-22: its own validation is met. Uncommitted on `feat/vault-env-gui`; not merged, not released.
- **Found:** author testing, 2026-10-22.
- **Built:**
  - `env:transfer`: `{ viewId, keys, target, mode: 'copy'|'move', overwrite }`
    in one transaction against the revision on screen. Values and
    sensitivity carry over, including keys inherited from a parent, which
    can be copied but not moved.
  - Keys the target already has → `CONFLICT` naming them; the dialog offers
    Overwrite.
  - A move writes one version in each env.
  - UI: a row's ⋮ menu, and multi-select with Copy to… / Move to….
- **Validation:** contract tests (copy, move, conflict and overwrite,
  inherited, unknown target, `STALE`, nothing written on refusal), UI tests
  on the real handlers, and e2e (move `FROM_CLI` to `base`).

### New-22: Open a folder and find the vault the CLI would use

- **Status:** ✅ done 2026-10-22: its own validation is met. Uncommitted on
  `feat/vault-env-gui`; not merged, not released. Behind the env UI gate.
- **Found:** author testing, 2026-10-22: the app list showed an older
  `Superxpense.env.vault` in the app folder, while `pvault` used the
  project's hidden `.env.vault`.
- **Goal:** Open… accepts a folder and resolves it the way the CLI does
  (`resolveVaultPath`: upward to the git root, `config/.env.vault`, the app
  folder).
- **Constraints:** Same validation as a picked file; the resolved path is
  shown before unlocking.
- **Dependencies:** 14. Remembering opened vaults across restarts is the rest
  of Task 14.
- **Built:**
  - `EnvironmentVaultService.resolveVaultPath` takes `cwd` (default
    `process.cwd()`) and `envsDir`; `defaultVaultPath(cwd, envsDir)` names
    the app-folder vault. The CLI passes neither, so its behavior is
    unchanged; one function decides for both.
  - `EnvVaultRegistry.openFolderFromDialog`: a folder dialog, then
    `resolveVaultPath({cwd: folder, envsDir})`, then the same check as a
    picked file (a JSON file of type `environment-vault`). No vault: a
    `NOT_FOUND` error that names the folder and every place searched.
  - Channel `env-vaults:open-folder`, preload `envVaults.openFolder()`.
  - The vault list has **Open folder…** next to Open… (a separate button:
    Windows and Linux dialogs can't pick a file and a folder at once).
  - The unlock dialog shows the vault's full path above the password, for
    every vault.
- **Validation:**
  - `EnvVaultMain.test.js` (real files): the project's `.env.vault` wins
    over an app-folder vault of the same name (the Superxpense case);
    a subfolder walks up to the git root; `config/.env.vault`; the
    app-folder vault named after the folder ("Billing App" →
    `billing_app.env.vault`); the not-found message, with and without a git
    root; a `.env.vault` that isn't an env vault is refused; a canceled
    dialog; the channel opens a folder dialog on the main window.
  - `EnvironmentVaultService.test.js`: resolving from a given folder ignores
    the process cwd; a relative `vault` resolves against it; `envsDir` is
    used for the fallback.
  - `EnvVaultsReal.test.jsx`: Open folder… on a project shows its
    `.env.vault` path in the unlock dialog and unlocks; a folder without a
    vault shows where it looked.
  - Coverage: `EnvVaultsPanel.jsx` 93% lines; `EnvVaultIpc.js` 98%; the
    three main-process files together 97%. Type check 291 (two fewer: the
    resolver's options are now typed). e2e 5/5.
- **Cost of leaving it:** users have to find a hidden file, and can unlock a
  different vault from the one their CLI uses without noticing.

### New-23: Unlock error says which file, without "corrupted" first

- **Status:** ✅ done 2026-10-22 (second testing round): its own validation is met. Uncommitted on `feat/vault-env-gui`; not merged, not released.
- **Built:** a wrong password reads "Wrong password for <file>. If you're
  sure it's right, the file may be damaged." The CLI message is unchanged.
- **Found:** author testing, 2026-10-22.
- **Goal:** a failed unlock reads "Wrong password for <path>" and mentions
  damage only as the rarer case.
- **Constraints:** the CLI's message is unchanged (scripts may match it).
- **Dependencies:** 19.
- **Validation:** a component test on the unlock dialog.
- **Cost of leaving it:** a wrong password looks like a bug (it did here).

### New-24: Unlock an env vault with the password a profile injects

- **Status:** ✅ done 2026-10-22 with option B (the author's "go" on the
  recommendation): its own validation is met. Uncommitted on
  `feat/vault-env-gui`; not merged, not released. Option A (the launch
  password) is not built.
- **Found:** author testing, 2026-10-22: `pvault` gets the password from
  `VAULT_ENV_PASSWORD`, set by a profile wrapper, so it's never typed.
- **Design note (kept):**
  - The app can't read another process's environment, and asking the
    wrapper for the password would hand it to anything that can run it.
  - A: start the app through the wrapper; main reads `VAULT_ENV_PASSWORD`
    once. Only works when launched that way.
  - B: keep the password in the OS keychain after one typed unlock, opt-in
    per vault. Works however the app starts. Chosen.
- **Built:**
  - `EnvVaultKeychain` (main): `safeStorage`-encrypted passwords in
    `<userData>/env-vault-passwords.json` (0600, atomic writes), keyed by
    the vault's absolute path. Linux's `basic_text` fallback is refused.
  - On macOS and Windows, listing vaults never calls `safeStorage`:
    `isEncryptionAvailable` reads the app's keychain item, which blocks
    main and can prompt. Found by the e2e run, which hung on the list.
    The keychain is asked only on "Remember" or on a saved unlock.
  - A saved unlock asks Touch ID first where the Mac has it
    (`systemPreferences.promptTouchID`); declined does nothing.
  - Channels: `env-vault:unlock` takes `{remember}` (true keeps, false
    forgets, absent leaves it); `env-vault:unlock-saved`;
    `env-vault:forget-password`; `env-vaults:list` reports `keychain` and
    each vault's `remembered`. No channel returns a password.
  - A saved password the CLI made stale is forgotten on its first failure,
    with a message to type the new one. A password change in the app
    updates the kept one.
  - UI: "Remember on this computer" in the unlock dialog (ticked when one
    is kept; unticking forgets); clicking a vault with a kept password
    unlocks directly; "Use saved password" after a declined Touch ID;
    "Password saved" chip; "Forget saved password" on the vault screen; a
    notice when the keychain refuses to store it.
- **Validation:** the password never reaches the page (IPC test checks the
  `unlock-saved` result); stored only via `safeStorage` (unit test: the file
  never holds the plaintext); nothing is stored unless asked (IPC and UI
  tests). Unit, IPC, UI and e2e green.
- **Not covered:** the real macOS Keychain and Touch ID prompts are not
  automated (e2e never opts in); author testing covers them. An unsigned
  dev build shows the macOS "wants to use your confidential information"
  prompt on the first Remember.

### New-25: Optional comment per key (env vaults) and notes on entry cards

- **Status:** ✅ done 2026-10-22: its own validation is met. Uncommitted on
  `feat/vault-env-gui`; not merged, not released.
- **Found:** author request, 2026-10-22: "add comment for each key
  (optional), for both kinds of vaults".
- **Built:**
  - Env vaults: a version may hold `comments: { KEY: text }` (at most 1000
    characters each). It is written only when one exists, so files without
    comments keep their old shape.
    - `addVersion` without `comments` carries the active version's comments
      over for the keys still present, so every older write path (CLI
      `set`, `rm`, import, the GUI) keeps them without knowing about them.
    - `rollback`, `squash` and `copyEnv` keep them.
    - `applyVarChanges`: `set` takes `comment` (left out keeps it, `''`
      removes it); `rm` drops it.
  - CLI: `env set --comment <text>` (`""` removes it); `env show` prints a
    comment as `# …` lines under its key and includes it in `--json`.
  - GUI: rows carry `comment` (never masked: it describes the key, it isn't
    a value). It appears under the key; the edit dialog has
    "Comment (optional)", with a note not to put secrets there. Copy and move
    take the comment with them.
  - Password vaults: every entry type already had an optional **Notes**
    field in its form; the entry card now shows it (3 lines at most).
- **Validation:** model tests (set, keep, clear, `rm`, carry-over, rollback,
  squash, JSON round trip, limits); service test (`setEnv`, `showEnv`,
  `copyEnv`, `removeKey`); a CLI integration test (`--comment`, `show`,
  clearing); IPC contract tests (rows, `env:commit`, `env:transfer`); a UI
  test on the real handlers; an `EntryList` test. e2e 5/5.
- **Known limit:** an older CLI or app writing to the vault drops the
  comments in the version it writes; earlier versions keep them. New-29
  makes later tools detect this; New-25 doesn't ship without it.

### New-26: Export and import key comments as `#` lines in a .env

- **Status:** ✅ done 2026-10-22 (second testing round): its own validation is met. Uncommitted on `feat/vault-env-gui`; not merged, not released.
- **Built:** `toDotenv(vars, { comments })`; `parseDotenv` keeps the `#`
  lines directly above a key (and an inline one) as its comment. CLI:
  `export --comments`, `import --comments` (both opt-in). The app's Export
  .env always writes them; its import offers a checkbox.
- **Found:** while building New-25: Export .env and `vault env export` leave
  comments out.
- **Goal:** export writes a key's comment as `#` lines above it; import reads
  them back.
- **Constraints:** `vault env export` output feeds scripts and `eval`; a
  comment line must never change how a value parses. Opt-in for the CLI.
- **Dependencies:** 27, New-25.
- **Validation:** an export → import round trip keeps the comments.
- **Cost of leaving it:** comments stay inside the vault.

### New-27: Fix: `env set` without `--public` makes a public key secret again

- **Status:** ✅ done 2026-10-22 (second testing round): its own validation is met. Uncommitted on `feat/vault-env-gui`; not merged, not released.
- **Built:** `setEnv`'s `isPublic` is now three-way; the CLI passes `true`
  for `--public`, `false` for the new `--secret`, nothing otherwise (keeps
  the flag). Both flags together are refused. CHANGELOG entry.
- **Found:** smoke testing New-25: `set API_URL x --public`, then
  `set API_URL y` shows `http****://y`.
- **Goal:** `set` without `--public` keeps the key's current flag, as the
  GUI already does (`applyVarChanges`); a `--secret` flag makes it secret.
- **Constraints:** a CLI behaviour change: CHANGELOG entry.
- **Dependencies:** none (simplest on top of Task 9).
- **Validation:** a CLI test of the sequence above.
- **Cost of leaving it:** a public value is masked after any update.

### New-28: Search password entries by their notes

- **Status:** ✅ done 2026-10-22 (second testing round): its own validation is met. Uncommitted on `feat/vault-env-gui`; not merged, not released.
- **Built:** every entry type's search fields include `notes`.
- **Found:** while building New-25: each entry type's `searchFields` leaves
  `notes` out, so a note is shown on the card but search can't find it.
- **Goal:** search matches notes for every entry type.
- **Dependencies:** none.
- **Validation:** a `SearchAndFilter` test that finds an entry by a word in
  its notes.
- **Cost of leaving it:** notes can't be searched.

### New-29: Recognise a newer vault format: warn, protect writes, show upgrade

- **Status:** ✅ done 2026-10-22: its own validation is met. Uncommitted on
  `feat/vault-env-gui`; not merged, not released. Must still ship in the
  release that brings New-25, or an earlier one.
- **Decided (author, 2026-10-22, all as recommended):**
  - Marker: a `features` list in the plaintext envelope, so a tool names
    what it doesn't know and `doctor` needs no password; the existing
    `version` stays for a change that breaks reading.
  - Written only when used: `["comments"]` while any version has a comment.
  - Released tools are not made to fail: release notes instead. Their loss
    is limited (comments on keys they change; all of them on a squash).
  - No override flag.
- **Built:**
  - `src/electron/utils/vaultFormat.js`: `VAULT_FORMATS` (env: comments;
    password: none yet), `checkVaultFormat`, `envVaultFeatures`,
    `UPGRADE_HINT` (npm command and the releases page).
  - Env vaults: the service writes `features`; `read`/`loadVault` return
    `format`; a newer `version` is `NEWER_FORMAT`; `transact` refuses
    every write to a vault with unknown features, file untouched.
  - Password vaults: `VaultFileService` refuses to overwrite a vault with
    unknown features (every write goes through it); `verifyPassword` and
    `loadVault` refuse a newer version and report `readOnly`;
    `saveVault`, `changePassword`, `generateRecoveryKey` pass the code on.
  - CLI: the `env` preAction hook reads the envelope (no password): unknown
    features stop write commands with exit 15 and warn on reads (stderr,
    not with `--quiet`); a newer version stops every command. `doctor`
    reports the format (error when unreadable, warning when read-only).
  - App: `env:list` returns `readOnly` and the message; the vault screen
    shows a banner and hides every write control (add, edit, delete, bulk
    edit, import, copy/move, env management, rollback, squash, change
    password). Password vaults show the banner; a refused save says why.
- **Validated:** unit tests for the check; service tests for both kinds
  (marker written and removed, reads, refused writes leave the file
  byte-identical, newer version); CLI tests (exit 15, warning, `--quiet`,
  doctor); IPC and UI tests (banner, no write controls, refused commit,
  no unlock of a newer version); e2e green.
- **Found:** author review of New-25, 2026-10-22: a tool that predates a
  feature loses that feature's data when it writes, without a word. No tool
  reads the format version today: env vaults carry `vaultVersion: 1` and
  password vaults `version: '1.0'`, but nothing checks either.
- **Goal:** any CLI or app opening a vault (either kind) that uses a format
  or feature it doesn't know:
  - says so, naming what it doesn't support and the risk ("saving here would
    drop key comments");
  - doesn't write it silently: writes are refused, or need an explicit
    override;
  - shows the upgrade path: the CLI's install command, the app's download or
    update.
  - Reading stays allowed where it is safe. `doctor` reports the format
    version and anything the tool doesn't support.
- **Constraints:**
  - Tools already released can't learn this. The check protects only from
    the first release that has it, so it must ship in that release or
    earlier, never after the format change.
  - The format marker changes only when older tools would lose data. A
    vault without comments stays readable and writable by every tool.
  - The same check in the CLI and the app (shared in the service layer).
  - CLI: a clear message on stderr and a distinct exit code. App: a banner
    and read-only screens, with no data loss.
- **Decide in the task (last responsible moment):**
  - The marker: a format number, a list of features used, or a "minimum
    tool version" in the file.
  - Whether to write the marker only when a newer feature is present (for
    example `vaultVersion: 2` when a version has `comments`) or always.
  - Whether to make files with new features fail loudly in tools that are
    already released (for example a header change). That trades their
    silent data loss for losing read access; weigh it against the release
    notes alone.
  - Whether an override flag is worth having.
- **Dependencies:** 8 (`doctor`, CLI docs), New-25 (the first feature to
  mark).
- **Validation:**
  - A vault marked newer than the tool: the CLI refuses `set` with the
    message and exit code; `show` still works and warns.
  - The app opens it read-only, with the banner and the upgrade path.
  - A vault without new features is unchanged and writable everywhere.
  - Tests for both vault kinds.
- **Cost of leaving it:** every format change silently loses data written
  by a newer tool, on any machine left behind.

### New-30: Rename an env: update `{{env:NAME/KEY}}` references to it

- **Status:** ✅ done 2026-10-22: its own validation is met. Uncommitted on
  `feat/vault-env-gui`; not merged, not released. Behind the env UI gate.
- **Built:**
  - Model: `referencesTo(env)` counts `{{env:env/KEY}}` per env in active
    versions; `renameReferences(old, new)` rewrites them, one new version
    per env that had any, flags and comments kept. Spaces inside the braces
    are kept; `self/` and names that merely start the same aren't touched;
    older versions keep what they said.
  - IPC: `env:references(id, env)` returns names and counts, no values.
    `env:manage` rename takes `updateReferences` (only `true` counts) and
    rewrites in the same write as the rename, returning `updated`.
  - Rename dialog: once the references are checked (Save waits for it), it
    offers "Update N references to X in A, B", on by default. Turning it off
    warns that they'll point to an environment that no longer exists. If the
    check fails, it says the references won't be updated. The notice adds
    "Updated N references in A, B."
- **Validation done:**
  - Model: after rename plus `renameReferences`, every env resolves to the
    values it had before; without it, resolving fails. Counts, flags,
    comments, history, prefix names and spaces covered.
  - IPC: counts; NOT_FOUND, INVALID, LOCKED; rename with references in one
    write (resolves, one new version); `undefined`, `false`, `'yes'` leave
    them alone.
  - UI on the real handlers: rename with the offer updates the file;
    declining warns and leaves it; a rename with no references offers
    nothing. Dialog: Save waits; counts across envs; the check failing.
  - Coverage: `EnvManageDialog.jsx` 92% lines, `EnvironmentVault.js` 97%,
    `EnvVaultIpc.js` 98%, `EnvVaultsPanel.jsx` 93%. e2e 8/8.
- **Found:** the CLI's `vault env rename` updates neither `extends` nor
  references (New-44).
- **Found:** building Task 24, 2026-10-22. Rename moves `extends` but not
  template references, which then fail to resolve (the dialog says so).
- **Goal:** rename offers to rewrite references in every env, in the same
  write.
- **Dependencies:** 24.
- **Validation:** a model test: after rename, every reference resolves.
- **Cost of leaving it:** a rename can break exports and `run` until the
  references are fixed by hand.

### New-31: Merge, not STALE, for reveal, copy, transfer and import

- **Status:** ⬜ not started.
- **Found:** building Task 10, 2026-10-22. Only `env:commit` merges; reveal,
  copy, transfer and import still refuse a changed file with `STALE`. The
  watcher (Task 16) makes this rare: the page reloads first.
- **Goal:** the same per-key check as `env:commit`.
- **Dependencies:** 10.
- **Validation:** contract tests: an unrelated change elsewhere doesn't
  block them; a change to the same key does.
- **Cost of leaving it:** a "changed elsewhere, reload" message when the
  watcher is slower than the click.

### New-32: `env import` keeps the flags of the keys it replaces

- **Status:** ✅ done 2026-10-23. Uncommitted on `feat/vault-env-gui`; not
  merged, not released. CLI behavior change: CHANGELOG "Changed".
- **Built:** `EnvironmentVault.importFromEnvFile` carries `nonSensitive` and
  `required` over for the keys still in the file. New keys are secret; a
  key the file leaves out loses its flags with it. Kept in the model rather
  than re-implemented on `applyVarChanges` (the dependency below): the
  result is the same and every caller (`import`, `init --env`) gets it. The
  app doesn't use this path (its import merges through `applyVarChanges`).
  SPEC §`vault env import` says so.
- **Validation done:** CLI integration test (`envImport.integration`): a
  public key stays public and a required one required after `import`; a
  new key is secret; a key left out and imported again comes back secret.
  Both tests fail on the previous code. Model test for the same rule.
  Coverage of `bin/commands/env.js` isn't measured (child process).
- **Found:** building New-26, 2026-10-22: `importFromEnvFile` writes a
  version without `nonSensitive` or `required`, so every imported key turns
  secret and loses `required`. The app's import (merge) keeps them.
- **Goal:** the CLI import keeps each surviving key's flags.
- **Constraints:** a CLI behaviour change: CHANGELOG entry.
- **Dependencies:** 9 (re-implement import on `applyVarChanges`).
- **Validation:** a CLI test: a public key stays public after `import`.
- **Cost of leaving it:** public values get masked after an import.

### New-33: Fix: a vault briefly vanished on every save

- **Status:** ✅ done 2026-10-22: its own validation is met. Uncommitted on
  `feat/vault-env-gui`; not merged, not released.
- **Found:** "concurrent `vault env set` CLI processes keep every key"
  failed twice in four full runs, and 3 times in 25 runs on its own: one
  process exited 5 (vault not found).
- **Cause:** `moveWithRetry` used fs-extra's `move(…, { overwrite: true })`,
  which deletes the target and then renames the temp file over it. Between
  the two, the vault doesn't exist: a concurrent reader (another CLI, `run`,
  the app's watcher) gets "not found", and a crash there leaves no vault
  file, only `.tmp` and `.bak`. Measured: 745 "missing" sightings over 200
  saves. Password vaults (`VaultFileService`) did the same.
- **Fix:** `moveWithRetry` renames (`fs.rename`, an atomic replace on POSIX
  and on Windows); env vaults, their snapshots and password vaults all save
  through it.
- **Validation:** a test that watches the target through 200 replacements
  sees it missing 0 times; the concurrent CLI test passed 30 runs in a row.
- **Not covered:** a Windows run (New-13).

### New-34: Drop a pending import as soon as the vault locks

- **Status:** ⬜ not started.
- **Found:** building Task 27, 2026-10-22. The parsed values of a previewed
  import stay in main until cancel, apply, the next import call, or a lock
  through the app; after an idle or sleep lock they're dropped at the next
  import call, not at the lock.
- **Goal:** clear them in the lock path itself (a hook from the session).
- **Validation:** a test: idle lock → the pending map is empty.
- **Cost of leaving it:** a file's values can sit in main's memory after
  the lock, until the next import.

### New-35: JSON export from the app

- **Status:** ⬜ not started.
- **Found:** Task 27's goal mentions it; not built.
- **Goal:** Export offers dotenv or JSON, like `vault env export -f json`.
- **Dependencies:** 27.
- **Validation:** a contract test of the JSON file.
- **Cost of leaving it:** JSON users export from the CLI.

### New-36: Prune saved passwords of gone vaults; "forget all"

- **Status:** ⬜ found 2026-10-22 while building New-24.
- **Goal:** a kept password whose vault file was deleted or moved doesn't
  linger in `env-vault-passwords.json`, and one action forgets every kept
  password.
- **Constraints:** never touch the keychain to prune (listing must not
  prompt); a vault on an unmounted drive isn't "gone".
- **Dependencies:** New-24.
- **Validation:** a kept password of a deleted app-folder vault is dropped
  at the next list; "Forget all saved passwords" empties the file.
- **Cost of leaving it:** ciphertexts of old vault passwords stay on disk,
  readable only through the OS keychain.

### New-37: Authenticate the envelope header (GCM additional data)

- **Status:** ⬜ found 2026-10-22 while building New-29.
- **Goal:** a change to a vault's plaintext header (`type`, `version`,
  `features`, `kdf`) is detected on decrypt, not just trusted.
- **Constraints:** files written before it must still open (a header flag
  says the header is bound); older tools ignore the flag, so this is a
  format change New-29 must mark.
- **Dependencies:** New-29.
- **Validation:** editing `features` or `version` of a bound vault makes it
  fail to open with a clear "header was changed" message.
- **Cost of leaving it:** anyone able to edit the file can mark it newer and
  make tools refuse writes; they could equally corrupt it, so the exposure
  is no worse than today.

### New-38: Set Electron fuses in packaged builds

- **Status:** 🟡 built 2026-10-22; passed on macOS. Windows and Linux are
  checked by the release workflow's smoke step (New-19); done when that run
  is green. Uncommitted on `feat/vault-env-gui`.
- **Goal:** the packaged app can't be turned into a debuggable or plain
  Node.js process by whoever launches it.
- **Found:** `npx @electron/fuses read` on the packaged macOS app: every
  fuse was at Electron's default, so `RunAsNode`,
  `EnableNodeOptionsEnvironmentVariable` and `EnableNodeCliInspectArguments`
  were on and `OnlyLoadAppFromAsar` and asar integrity were off. A process
  running as the user could start the app with `--inspect` and get a
  debugger in main, which holds unlocked vaults and, since New-24, the
  app's keychain access.
- **Decision (author, 2026-10-22):** set the fuses now; refusing
  `--remote-debugging-port` is its own item (New-40), because New-19's
  check drives the shipped build through it.
- **Built:**
  - `package.json` `build.electronFuses`:
    - off: `runAsNode`, `enableNodeOptionsEnvironmentVariable`,
      `enableNodeCliInspectArguments`;
    - on: `onlyLoadAppFromAsar`, `enableEmbeddedAsarIntegrityValidation`
      (macOS and Windows; Electron has none on Linux);
    - kept on: `grantFileProtocolExtraPrivileges`, needed while the renderer
      loads from `file://`;
    - kept off: `enableCookieEncryption` (the app stores no cookies, and on
      macOS it would read the keychain at every start, which New-24 avoids)
      and `loadBrowserProcessSpecificV8Snapshot`.
  - Nothing in main uses `process.fork` or `ELECTRON_RUN_AS_NODE`, so
    `runAsNode` off breaks nothing.
  - `e2e/packaged.mjs` checks the fuses read from the binary, and that
    `ELECTRON_RUN_AS_NODE=1` doesn't run a script and `--inspect` opens no
    debugger. `NODE_OPTIONS` has no behavioral check: Electron already
    ignores most of it in a packaged main process ("Most NODE_OPTIONs are
    not supported in packaged apps"), fuse or not.
- **Validation:**
  - macOS: `@electron/fuses read` shows the settings above;
    `npm run test:packaged` 13/13.
  - The checks can fail: on the build without fuses, the fuse, run-as-node
    and `--inspect` checks all fail (10/13).
  - Asar integrity holds: a copy whose `app.asar` was repacked with one
    changed file stops at start with "Integrity check failed for asar
    archive entry '<header>'".
  - Still to do: Windows and Linux in the release workflow.
- **Cost of leaving it:** a same-user process could read unlocked vaults and
  saved env vault passwords through the app.

### New-39: Fix: a failed page load loops instead of showing the error page

- **Status:** ✅ done 2026-10-22: its own validation is met. Uncommitted on
  `feat/vault-env-gui`; not merged, not released.
- **Found:** while doing New-19: reloading the page while the packaged
  app's first load was still running aborted it (`ERR_ABORTED`); the app
  then logged "Failed to load URL … ERR_FAILED" without end and never
  showed a page.
- **Cause:** two bugs in `WindowManager.loadApp`.
  - Any `did-fail-load` showed the error page, including a load a newer
    navigation had aborted (`-3`) and a failed subframe. So a reload during
    startup ended on the error page even though the reload succeeded
    (reproduced under the dev Electron every time).
  - The aborted `loadURL` also rejected into the `catch`, which showed the
    error page a second time. In the packaged app, logging added to a copy
    showed the error page's own `data:` load failing with `ERR_FAILED`
    (`-2`) about 200 times in 3 s, and each failure showed the error page
    again. Most likely the two error-page loads kept aborting each other;
    not traced further, since the fix removes both triggers.
- **Fix:**
  - `isLoadFailure(errorCode, url, isMainFrame)`, exported from
    `WindowManager.js`: only a main-frame failure that wasn't aborted and
    isn't the error page itself counts. `loadApp`'s handler and `main.js`'s
    error dialog both use it. The log now names the URL that failed.
  - The `catch` leaves navigation errors (they carry an `errno`) to
    `did-fail-load`; it still shows the error page for other startup
    errors, such as a missing build.
- **Validation:**
  - `WindowManager.test.js`: an aborted load, a failed subframe, the error
    page failing, and a rejected startup load don't show (or re-show) the
    error page; a missing build still does. The first four fail on the old
    code.
  - Dev Electron, reload right after the first navigation commits: the old
    code ended on the error page; now the app loads.
  - Packaged macOS app, reload at startup over the DevTools protocol: 6
    runs, no failure logged, each ends on `app.asar/build/index.html`.
    Before, about half the runs looped (the reload has to land mid-startup).
  - `npm run test:packaged` 10/10, e2e 5/5. `WindowManager.js` 88% lines.
- **Cost of leaving it:** rare (a reload during startup, or a damaged
  install), but then the app spins on an empty window.

### New-40: Refuse `--remote-debugging-port` in packaged builds

- **Status:** ⬜ found 2026-10-22 with New-38 (author: later).
- **Goal:** a packaged build started with `--remote-debugging-port` (or
  `--remote-debugging-pipe`) quits instead of exposing its pages.
- **Why it's separate:** it's a Chromium switch no fuse controls. Through
  it, a process running as the user can read and drive the page of an
  unlocked vault, including calling its IPC API.
- **Constraints:** New-19's `npm run test:packaged` drives the shipped build
  through that port. Refusing it needs another way to run that check
  against the same artifact; a separate test build would no longer test
  what users install.
- **Dependencies:** New-38.
- **Validation:** the packaged app started with the switch exits at once;
  New-19's check still runs against the shipped build.
- **Cost of leaving it:** same-user access to unlocked vault pages. A
  same-user attacker has other ways in (reading memory, keystrokes), so
  this narrows the attack surface rather than closing a boundary.

### New-41: Find the unit test that failed once in ten full runs

- **Status:** ⬜ found 2026-10-22 during Task 23.
- **Found:** `npx vitest run` reported "1 failed | 1287 passed" once; a
  re-run to see which test printed no failure, and the next nine full runs
  were green. Which test, and why, is unknown.
- **Goal:** the test is identified and made deterministic.
- **Implementation guidance:** run the suite in a loop with
  `--reporter=json --outputFile` per run, so a failure keeps its name.
  Likely suspects: tests with real timers or real file watching (the env
  vault watcher, lock heartbeats, the settle delays in
  `EnvVaultsReal.test.jsx`).
- **Validation:** fifty full runs in a row green, or the failing test named
  and fixed.
- **Cost of leaving it:** CI goes red now and then for no change, and people
  learn to re-run instead of read.

### New-42: Decide whether input in the window keeps env vaults unlocked

- **Status:** ✅ done 2026-10-22. Uncommitted on `feat/vault-env-gui`; not
  merged, not released. Behind the env UI gate.
- **Found:** the password vault stays unlocked while there is input in the
  window (Task 13). Env vaults counted only their own calls (RFC §6.6), so
  reading an env's keys or editing a value without saving for 5 minutes
  locked the vault. And `env:list`, which the page also runs on its own when
  the CLI changes the file, restarted the timer: a vault something kept
  writing to never locked.
- **Decided (user, 2026-10-22):** input on a vault's own screen keeps that
  vault unlocked; other unlocked env vaults idle out on their own. RFC §6.6
  revised.
- **Built:**
  - `useInputActivity(report)` (`src/hooks/`): keys, clicks, scrolling and
    touch in the window, reported at most every 15 s; nothing while `report`
    is null. Used by `App` (password vault, Task 13) and `EnvVaultScreen`,
    which reports its vault's id, dialogs on that screen included.
  - Channel `env-vaults:activity(id)` calls `session.touch(id)`; preload
    `envVaults.activity`.
  - No env channel calls `touch` any more (19 removed): every call a user
    makes starts with input, and calls the page makes on its own can't keep
    a vault open. Unlock still starts the timer.
  - Settings says what counts: "Typing, clicking and scrolling in the app
    count as activity", plus, with env vaults on, "An environment vault stays
    unlocked only while you work on its own screen."
- **Validation done:**
  - `EnvVaultMain.test.js`: `env:view`, `env:list`, `env:refresh` and
    `env:reveal` don't touch; `env-vaults:activity` does, once, for that id;
    an unknown id is harmless.
  - `EnvVaultsPanel.test.jsx`: no report from the vault list; input on the
    vault screen reports its id; nothing after the vault locks.
  - `AppSettingsSection.test.jsx`: the help text with and without env
    vaults. `AppSession.test.jsx` (unchanged) covers the hook's throttle.
  - e2e 8/8 scenarios.
  - Coverage: `useInputActivity.js` fully covered, `EnvVaultIpc.js` 98%
    lines, `EnvVaultsPanel.jsx` 93%, `AppSettingsSection.jsx` 97.5%.

### New-43: `npm run lint` lints the docs site's ignored build output

- **Status:** ⬜ found 2026-10-22 during Task 13.
- **Found:** after a local docs build, `npm run lint` reports 460 errors,
  all in `docs/.vitepress/cache` and `docs/.vitepress/dist`. Git ignores
  both; the ESLint config doesn't. A clean checkout and CI are unaffected.
- **Goal:** `npm run lint` checks only source.
- **Validation:** with the docs built, `npm run lint` reports 0 errors.

### New-44: CLI `env rename` leaves `extends` and references on the old name

- **Status:** ✅ done 2026-10-22. Uncommitted on `feat/vault-env-gui`; not
  merged, not released. CLI behavior change: CHANGELOG "Changed".
- **Decided:** references are updated by default, as in the app;
  `--keep-references` opts out. `extends` always follows: a parent that no
  longer exists is never wanted.
- **Built:**
  - `EnvironmentVault.renameEnvironment` moves `extends` itself, so every
    caller gets it; the app's own loop for it is gone.
  - `EnvironmentVaultService.renameEnv(…, {updateReferences = true,
message})` renames and rewrites references in one write and returns
    `updated` (envs and counts).
  - `vault env rename` prints "Updated N references in A, B." when it did;
    `--keep-references`. README.cli.md and SPEC §5 say what follows.
- **Validation done:** CLI integration test (`envRename.integration`):
  after a rename, a referencing env resolves as before, an env extending it
  still layers its values, the old name is gone; with `--keep-references`
  the reference fails and `extends` still follows. Both tests fail on the
  previous code. Model: children follow, others don't. Service: references
  rewritten with the message, or kept; a failed rename has no `updated`.
  The validation asked for `doctor` to be clean; `doctor` needs a
  `.vaultrc`, so the test resolves every affected env with `get` instead.
  Coverage of `bin/commands/env.js` isn't measured (the CLI runs in a child
  process); `EnvironmentVault.js` 97% lines.
- **Found:** `EnvironmentVaultService.renameEnv` only called
  `renameEnvironment`. Envs that extended the renamed one kept `extends`
  pointing at a name that no longer exists, and `{{env:OLD/KEY}}`
  references stop resolving. The app does both (Task 24, New-30).
- **Goal:** `vault env rename` gives the same result as the app: children
  follow, and references are updated (by default, with a flag to skip, or
  the reverse; to decide).
- **Implementation guidance:** move the app's rename body (children,
  `renameReferences`) into the service so the CLI and the app share it.
  It changes what the CLI writes: CHANGELOG entry.
- **Validation:** a CLI test: after `rename`, every env resolves and
  `doctor` is clean.
- **Cost of leaving it:** a rename from the CLI, the primary tool, can
  break `run` and exports for every env that built on the renamed one.

### New-45: `env import` of several files keeps only the last one

- **Status:** ✅ done 2026-10-23. Uncommitted on `feat/vault-env-gui`; not
  merged, not released. CLI behavior change: CHANGELOG "Changed".
- **Built:** `EnvironmentVault.importFromEnvFile` takes one content or an
  array and writes one version; a later file wins on a repeated key, with
  its comment (or none). `EnvironmentVaultService.importEnvFile` takes one
  path or several, reads them all before taking the lock (nothing is
  written if one is missing; before, the files ahead of it were imported),
  and tags each warning with its `file`. The version message lists the
  files. `vault env import` makes one call. SPEC says so.
- **Validation done:** CLI integration: `import dev a.env b.env` leaves the
  keys of both, `b`'s value on a shared key, in one new version, and the
  warning names `b.env` and its line; a missing second file writes nothing.
  Both fail on the previous code. Service test (one version, message,
  warnings with `file`) and model test (merge, comments of the winning
  file). Coverage of `bin/commands/env.js` isn't measured (child process).
- **Found:** `vault env import prod a.env b.env` writes one version per
  file, each replacing the env's variables, so only `b.env`'s keys remain
  (v1 "Imported from a.env", v2 "Imported from b.env"). SPEC §`vault env
import` says it "creates a new version with all vars from the file(s)"
  and shows this exact use ("Import multiple files into one environment").
- **Goal:** importing several files gives one version with the keys of all
  of them, later files winning on a repeated key, as SPEC says.
- **Constraints:** a CLI behavior change: CHANGELOG entry. Warnings keep
  naming the file and line.
- **Validation:** a CLI test: `import prod a.env b.env` leaves `A` and `B`,
  in one new version.
- **Cost of leaving it:** the documented multi-file import silently drops
  every file but the last.
