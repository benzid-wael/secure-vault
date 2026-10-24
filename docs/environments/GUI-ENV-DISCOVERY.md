# Env vaults in the desktop app — discovery

> Status: brainstorming output, not a spec. Feeds a plan/RFC next.
> Companion to SPEC.md, AGENT-DESIGN.md and NATIVE-HELPER-RFC.md.

## Context

The CLI (`vault env …`) is, and stays, the primary way to manage environment
vaults. The desktop app currently only manages password vaults. The goal is to
let the same user also manage env vaults from the GUI, **in addition to** the
CLI, never replacing it.

Primary user: the CLI user themself, reaching for the GUI when browsing,
comparing or bulk-editing many variables is easier to do visually than in a
terminal. It is not aimed at non-technical teammates.

## Problem statement

Give the desktop app a full management surface over env vaults, everything the
CLI does except process injection, without:

- forking the vault format or business logic away from the CLI,
- losing CLI writes that happen while the GUI has a vault open,
- weakening the security posture of either the app or the agent.

## What already exists

- **Shared engine.** `src/electron/services/EnvironmentVaultService.js`
  already implements every operation the GUI needs (set/get/show/list,
  rm, delete, rename, copy, extends, description, import, export, template,
  history, rollback, squash, diff, validate, change-password). Today only
  `bin/commands/env.js` calls it. The GUI work is mostly IPC + UI over this
  service, not new vault logic.
- **Main-process session pattern.** `VaultSession` keeps the password and
  derived keys in the main process; the renderer hands the password over once.
  `saveVault(…, keyMaterial)` already supports reusing the derived key.
- **IPC hardening.** `public/main.js` routes every channel through `handle`
  (trusted-sender check) and validates vault names before they become paths
  (`handleVault`). Auto-lock on suspend / screen lock.
- **Path resolution is cwd-based.** `resolveVaultPath()` walks up from `cwd`
  to the git root for `.env.vault`, then `config/.env.vault`, then
  `<appdata>/envs/<cwdname>.env.vault`. The GUI has no meaningful cwd.

## Decisions so far

| Topic       | Decision                                                                                                                                                                                                            |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Scope (v1)  | **Full parity minus run/shell**: everything except `run`, `shell`, `agent *`, `mount`, `exec` (process injection stays CLI-only)                                                                                    |
| Discovery   | **Scan `<appdata>/envs/*.env.vault` + "Open file…" picker + remembered recents**                                                                                                                                    |
| Agent       | **Independent of the agent for now**; G23 (no list/dump verbs) stays intact. Revisit an agent-backed mode after the native helper RFC lands                                                                         |
| Exposure    | **Depends on the view**: masked by default, plaintext of a value crosses IPC only on reveal/copy/edit; diff and bulk-edit views explicitly load plaintext for the env(s) involved, and drop it when the view closes |
| Concurrency | **Live-reload**: watch the open vault file and refresh on change, plus a stale-write check on save                                                                                                                  |

## Constraints

- **Vaults live in all four CLI locations**: `<appdata>/envs` (`--name`),
  repo-root `.env.vault`, `config/.env.vault`, and arbitrary `--vault` paths.
  Discovery must reach all of them (here: the picker + recents).
- **No lost updates.** `saveVault` is atomic (temp + rename, `.bak`) but is
  load→modify→save with no version check. A long-lived GUI session plus a CLI
  write in between would silently drop the CLI change. Live-reload alone is not
  enough (a race between watch event and save remains), so saves need an
  optimistic check (e.g. compare on-disk mtime/hash or a vault revision counter
  against what was loaded; refuse + reload on mismatch).
- **Arbitrary paths over IPC.** Env vaults are files, not names, so
  `validateVaultName` doesn't apply. The renderer must not be able to point the
  main process at any path it likes: paths should come only from the main
  process (appdata scan, native file dialog, recents it wrote itself), and the
  renderer refers to them by an opaque id.
- **Separate passwords.** Each env vault has its own password, distinct from
  password vaults. Session/auto-lock rules must cover env vaults too
  (suspend, screen lock, idle timeout, quit).
- **All exposure risks are in play**: plaintext lingering in the renderer/DOM,
  and a second unlock path to keep in sync. The "independent + view-scoped
  plaintext" decisions above are the mitigation; JS-heap residue in main is the
  same documented limit as `VaultSession` (AGENT-DESIGN.md §8).
- **CLI remains authoritative.** No format changes the CLI can't read; any new
  metadata (e.g. a revision counter) must be added in the shared service, so
  both front-ends get it.

## Approaches to consider

1. **Thin IPC over `EnvironmentVaultService`, stateless per op.** Each GUI
   action is one service call (load → apply → save), like a CLI command. The
   main process keeps only password/key material; the renderer re-fetches after
   each write. Simplest; concurrency risk shrinks to the op window. Live-reload
   is a file watcher that triggers a re-fetch.
2. **Main-process `EnvVaultSession` holding the decrypted vault model.** Mirrors
   `VaultSession`; faster for diff/bulk views, but the long-held model makes
   the stale-write check essential and widens the in-memory exposure window.
3. **Hybrid.** Stateless writes (approach 1) with a short-lived, view-scoped
   decrypted cache for diff/bulk-edit (approach 2 only where the view needs it).
   Matches the "depends on the view" exposure decision.

## Open questions

- **Stale-write detection mechanism**: mtime/size, content hash, or an explicit
  revision counter in the vault payload (CLI would bump it too)?
- **One unlocked env vault at a time, or several?** Diff across vaults vs. diff
  across envs in one vault (CLI `diff` is within a vault).
- **Idle timeout** for env vaults: same as the password-vault session, or
  separate/shorter?
- **Parity edge cases**: do `file`, `apply`, `clean`, `doctor`, `template`
  belong in the GUI, or are they CLI/workflow-only? (`doctor` probably
  inspects the cwd/project and may not translate.)
- **Navigation**: how env vaults sit next to password vaults in the app (a
  separate section/mode in the vault selector vs. a mixed list).
- **Recents storage**: where the recents list lives (settings file), and how a
  moved/deleted vault is shown.
- **Bulk edit UX**: a table editor vs. "edit as dotenv" text mode (CLI's
  `$EDITOR` flow) — both, or one?
- **Agent-backed mode later**: what G23-compatible shape it would take once the
  native helper exists (e.g. GUI as a privileged, separately-authenticated
  client), or whether it's never needed.

## Next step

Turn this into an RFC/plan (`docs/environments/`), starting with the risky
parts first: stale-write detection in the shared service, and the path-id IPC
boundary. The UI comes after those.
