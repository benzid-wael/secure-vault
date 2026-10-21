# Breakdown: env vaults in the desktop app

The plan of record for [`GUI-ENV-RFC.md`](GUI-ENV-RFC.md) (approved 2026-10-21).
Rollout notes live in [`GUI-ENV-ROLLOUT.md`](GUI-ENV-ROLLOUT.md). This file is
updated as each task finishes, not in a batch at the end.

**Status key:** ✅ done · 🟡 partial · ⛔ blocked · ⬜ not started · 🔶 ready to run · ⏸ deferred · ❌ dropped
**Priority:** **P0** MVP path · **P1** production readiness, correctness, security, privacy · **P2** improvements

## Rollup

| #      | Task                                                             | RFC | Pri | Status | Depends on                             |
| ------ | ---------------------------------------------------------------- | --- | --- | ------ | -------------------------------------- |
| 0      | Write this breakdown and the rollout plan                        | —   | P0  | ✅     | —                                      |
| 1      | Make the renderer sandbox explicit and verified                  | M0  | P1  | ⬜     | 0, New-1                               |
| 2      | Content-Security-Policy for the renderer                         | M0  | P1  | ⬜     | 1                                      |
| 3      | Async key derivation (`deriveKeyAsync`)                          | M1  | P0  | ✅     | 0, New-1                               |
| 4      | `VaultLock` module                                               | M1  | P0  | ✅     | 3                                      |
| 5      | `read()` / `transact()` with revisions and `REKEYED`             | M1  | P0  | ✅     | 3, 4                                   |
| 6      | Port every env op onto `transact`; `saveVault` private           | M1  | P0  | ⬜     | 5                                      |
| 7      | `squash` snapshot, re-keyed by change-password                   | M1  | P1  | ⬜     | 6                                      |
| 8      | CLI docs, CHANGELOG, `doctor` reports stale locks                | M1  | P1  | ⬜     | 6                                      |
| 9      | `applyVarChanges` model method                                   | M2  | P0  | ⬜     | 6                                      |
| 10     | Changeset apply + rebase in the service                          | M2  | P0  | ⬜     | 9                                      |
| 11     | Single-instance lock for the app                                 | M3  | P1  | ⬜     | 0                                      |
| 12     | Main-process `ClipboardService` + IPC                            | M3  | P1  | ⬜     | 0, New-3                               |
| 13     | Idle lock for password vaults                                    | M3  | P1  | ⬜     | New-2                                  |
| 14     | `EnvVaultRegistry` (ids, dialogs, recents)                       | M3  | P0  | ⬜     | 6, 11, New-2                           |
| 15     | `EnvVaultSession` (keys, commit/recover, idle)                   | M3  | P0  | ⬜     | 5, 14, New-2                           |
| 16     | `EnvVaultWatcher`                                                | M3  | P1  | ⬜     | 15                                     |
| 17     | IPC gate + core channels + preload                               | M3  | P0  | ⬜     | 10, 12, 14, 15                         |
| 18     | IPC: structure, history, diff, import/export channels            | M3  | P2  | ⬜     | 17                                     |
| 19     | Renderer: Environments switch, vault list, open/new/unlock       | M4  | P0  | ⬜     | 2, 17, New-4                           |
| 20     | Renderer: env view (masked, reveal, copy, inline edit)           | M4  | P0  | ⬜     | 19                                     |
| 21     | Renderer: bulk edit (table + dotenv text), conflicts             | M4  | P0  | ⬜     | 20                                     |
| 22     | Renderer: move secret copy to `ClipboardService`                 | M4  | P1  | ⬜     | 12, New-3                              |
| 23     | Renderer: Settings for idle timeout and recents                  | M4  | P1  | ⬜     | 13, 14, New-2                          |
| 24     | Renderer: env structure ops                                      | M5  | P2  | ⬜     | 18, 20                                 |
| 25     | Renderer: history, rollback, squash                              | M5  | P2  | ⬜     | 7, 18, 20                              |
| 26     | Renderer: diff and validate                                      | M5  | P2  | ⬜     | 18, 20                                 |
| 27     | Renderer: import, export, template                               | M5  | P2  | ⬜     | 18, 20                                 |
| 28     | Renderer: env vault change-password                              | M5  | P2  | ⬜     | 7, 18, 19                              |
| 29     | e2e scenario `env-vault-concurrent`                              | M6  | P1  | ⬜     | 21                                     |
| 30     | CI e2e job (ubuntu + xvfb)                                       | M6  | P1  | ⬜     | 1, 29                                  |
| 31     | User guide `docs/guide/gui/env-vaults.md`                        | M6  | P2  | ⬜     | 21                                     |
| New-1  | Coverage can't see the code this plan changes                    | —   | P1  | ✅     | — (blocks 1, 3)                        |
| New-2  | App-wide settings store                                          | M3  | P1  | ⬜     | 0                                      |
| New-3  | Decide which secrets go through `ClipboardService`               | —   | P1  | ⬜     | —                                      |
| New-4  | Feature gate for the Environments UI                             | M4  | P0  | ⬜     | 0                                      |
| New-5  | Verify async PBKDF2 in the Bun-compiled CLI binary               | M1  | P1  | 🔶     | 3                                      |
| New-6  | Decide whether project coverage should include `src/electron/**` | —   | P2  | ⬜     | New-1                                  |
| New-7  | Commit a way to measure coverage of excluded files               | —   | P1  | ⬜     | New-1                                  |
| New-8  | `npm run lint` fails locally on gitignored build output          | —   | P2  | ⬜     | —                                      |
| New-9  | Type-check gate: confirm "no new errors" as this plan's rule     | —   | P1  | ✅     | —                                      |
| New-10 | Lock: a container sharing the kernel can look like this machine  | —   | P1  | 🟡     | 4 (blocks the release of 6)            |
| New-11 | Bring RFC §6.5 in line with Corrections 6 and 7                  | —   | P2  | ⬜     | 4                                      |
| New-12 | Windows: retry the final rename on `EPERM`                       | M1  | P1  | ⬜     | 5 (blocks the release of 6 on Windows) |

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
  (Task 4), `ac641ad` (New-10).

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

- **Status:** ⬜ not started.
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

- **Status:** ⬜ not started.
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

- **Status:** ✅ done 2026-10-21: its own validation is met. Uncommitted on
  `feat/vault-env-gui`; not merged, not released. Nothing calls the new
  methods yet (Task 6 does).
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

- **Status:** ⬜ not started.
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

- **Status:** ⬜ not started.
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

- **Status:** ⬜ not started.
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

- **Status:** ⬜ not started.
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

- **Status:** ⬜ not started.
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

- **Status:** ⬜ not started.
- **Goal:** A second launch focuses the existing window instead of starting a
  second process.
- **Constraints:** e2e runs must still be able to launch the app per scenario.
  Each scenario has its own HOME, so check that the lock is per-user-data-dir.
- **Dependencies:** 0.
- **Implementation guidance:** It changes behavior for password-vault users
  too; mention it in the release notes.
- **Validation:** e2e: launching twice leaves one process and one window.

### Task 12: Main-process `ClipboardService` + IPC

- **Status:** ⬜ not started.
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

- **Status:** ⬜ not started.
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

- **Status:** ⬜ not started.
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

- **Status:** ⬜ not started.
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

- **Status:** ⬜ not started.
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

- **Status:** ⬜ not started.
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

- **Status:** ⬜ not started.
- **Goal:** The remaining channels from RFC §6.7, each with an
  `expectedRevision` where the RFC requires one.
- **Constraints:** `export`/`template` write through a main-side save dialog;
  the content never crosses IPC.
- **Dependencies:** 17.
- **Validation:** A contract test per channel: success, `STALE` and `INVALID`.

### Task 19: Renderer: Environments switch, vault list, open/new/unlock

- **Status:** ⬜ not started.
- **Goal:** Behind the New-4 gate, the selector shows Passwords | Environments.
  Environments lists vaults and opens, creates (no presets) and unlocks them.
- **Constraints:** Nothing env-related is visible with the gate off. The
  password-vault flow is unchanged.
- **Dependencies:** 2 (M0 must be done before env plaintext reaches the
  renderer), 17, New-4.
- **Validation:** Component tests for both gate states. Existing App and
  selector tests pass unchanged.

### Task 20: Renderer: env view

- **Status:** ⬜ not started.
- **Goal:** Masked table, per-row reveal, copy through main, inline edit as a
  one-op changeset, refresh banner, inherited keys marked.
- **Constraints:** Revealed values are cleared on view close and on
  `env-vault-locked`.
- **Dependencies:** 19.
- **Validation:** Component tests: values masked by default; state dropped on
  the lock event; `CONFLICT` keeps the edit.

### Task 21: Renderer: bulk edit (table + dotenv text), conflicts

- **Status:** ⬜ not started.
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

- **Status:** ⬜ not started.
- **Goal:** Settings UI for D1 (timeout) and D5 (recents toggle, which clears
  the list when turned off).
- **Dependencies:** 13, 14, New-2.
- **Validation:** Component tests; the setting persists across an app restart
  (e2e).

### Task 24: Renderer: env structure ops

- **Status:** ⬜ not started.
- **Goal:** Create, rename, copy, delete env, extends and description, with a
  plain confirm on delete.
- **Dependencies:** 18, 20.
- **Validation:** Component tests; `STALE` triggers a reload message.

### Task 25: Renderer: history, rollback, squash

- **Status:** ⬜ not started.
- **Goal:** A history list; rollback and squash with a plain confirm.
- **Dependencies:** 7, 18, 20.
- **Validation:** Component tests; the squash confirm says a snapshot is kept.

### Task 26: Renderer: diff and validate

- **Status:** ⬜ not started.
- **Goal:** Diff is masked by default, with "Show values" re-requesting with
  `reveal: true`. Validate shows the issues.
- **Dependencies:** 18, 20.
- **Validation:** Component tests; no values in a masked diff response.

### Task 27: Renderer: import, export, template

- **Status:** ⬜ not started.
- **Goal:** Import a `.env` through main's open dialog; export and template
  through main's save dialog.
- **Dependencies:** 18, 20.
- **Validation:** Component tests; the exported file mode is `0600` (main test).

### Task 28: Renderer: env vault change-password

- **Status:** ⬜ not started.
- **Goal:** Change-password with current + new password; the session updates
  without re-prompting.
- **Dependencies:** 7, 18, 19.
- **Validation:** Component tests; after the change, the old password fails
  and the snapshots are re-keyed (service test from Task 7).

### Task 29: e2e scenario `env-vault-concurrent`

- **Status:** ⬜ not started.
- **Goal:** RFC goal 7 as an e2e scenario (seed → open → unlock → edit →
  CLI `set` → banner → disjoint commit rebased → overlapping commit conflicts).
- **Dependencies:** 21.
- **Implementation guidance:** The scenario has an isolated HOME; spawn the
  CLI with the same HOME so both resolve the same appdata.
- **Validation:** `node e2e/run.mjs env-vault-concurrent` passes.

### Task 30: CI e2e job (ubuntu + xvfb)

- **Status:** ⬜ not started.
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

- **Status:** ⬜ not started.
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

- **Status:** ⬜ not started.
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

- **Status:** 🔶 ready to run since Task 3 (2026-10-21). Needs Bun installed
  locally, or a CI run of `npm run package:cli`. Blocks the release that
  carries Task 3.
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
- **Validation:** Running it on `src/electron/services/CryptographyService.js`
  prints that file's row (100% lines at Task 3), and `npm run test:coverage`
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

- **Status:** ⬜ not started.
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
