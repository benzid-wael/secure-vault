# Agent & Mount — design note (v2.0)

> Companion to SPEC §13.5 and MOBILE-INTEGRATION-GAPS.md §4-I / §5. This is the
> architecture the v2.0 agent is built against. The G23–G28 invariants are
> preconditions, not features — a naive agent is _strictly worse than v1_ (I3).

## 1. Process model

- `vault env agent start|stop|status` manages a single long-running daemon per
  user, launched by **launchd** (macOS) with a `KeepAlive`/`RunAtLoad` plist.
- The daemon owns the decrypted session key and the set of live mounts. It never
  writes the key to disk.
- `status` returns **metadata only** — running/locked/uptime, mount count — and
  **never** values or env names beyond what the caller already authorized (G23).

## 2. Key custody

- **Slice 1 (this milestone, first cut):** the master key lives in memory only,
  entered once at `agent unlock`. Process is hardened: `RLIMIT_CORE=0`,
  `PT_DENY_ATTACH` (macOS) / `ptrace_scope` (Linux), `mlock` the key pages,
  hardened runtime / no `get-task-allow`. Residual risk: same-UID memory scrape
  — documented, not eliminated (§5.8).
- **Slice 2 (fast-follow):** wrap the key with a **hardware-backed KEK** (Secure
  Enclave / Keychain, ACL-bound to the signed vault binary), **decrypt one env
  on demand**, never hold all envs decrypted (G25). Biometric per-access for
  sensitive envs (G10/G27).

## 3. IPC & delivery

Ranked by the §5.2 threat table, the delivery channel is the highest-leverage
decision:

- **Preferred: spawn-based delivery (G24).** For `vault env run`-style use, the
  agent **forks the child itself** and hands secrets over an inherited fd / the
  child's environment. No listening endpoint for arbitrary processes to dial.
- **Where a socket is unavoidable** (e.g. `mount`, IDE integration): a Unix
  domain socket in a `0700` dir, with `SO_PEERCRED`/`LOCAL_PEERCRED` peer checks
  — treated as a **speed bump, not a boundary** (same-UID still passes).
- **Protocol is request-scoped (G23):** a client asks for exactly one env (ideally
  a key subset). There is **no `list-envs`, no `dump-all`**. Unknown/greedy verbs
  are rejected. This is enforced at the protocol layer and covered by tests.

## 4. Lock lifecycle (the Task 6 / G12 contract, in code)

Two-tier lock, implemented as a pure state machine (`src/agent/lockState.js`) so
the security-critical transitions are unit-tested with zero platform coupling:

| Event                              | Transition                             | Mounts    | Key     |
| ---------------------------------- | -------------------------------------- | --------- | ------- |
| `unlock`                           | → **unlocked**                         | —         | held    |
| user-authenticated action          | resets idle timer (only when unlocked) | —         | —       |
| idle timeout reached               | → **soft-locked**                      | **kept**  | dropped |
| max session lifetime reached       | → **locked**                           | **wiped** | dropped |
| sleep / screen-lock / `agent lock` | → **locked**                           | **wiped** | dropped |
| new request while not unlocked     | **rejected**                           | —         | —       |

- The idle timer resets **only** on user-authenticated actions — never on raw IPC
  requests or mounted-file reads. This closes the G28 synthetic-activity attack.
- Soft lock preserves the all-day GUI session (file already on disk, I1) while
  refusing new envs (containment, I2). The hard-lock triggers are the
  "walked away / session too old" moments.

## 5. Mount posture (G26)

- Persistent `mount` is **opt-in + warned**; the default GUI path is run-scoped
  delivery (mode B — wrap the IDE, file dies on quit).
- Mounts are minimal-key, `0600` files in a `0700` dir, driven by the v1.8
  delivery manifest (`mount` consumes the same `deliver[]` as `apply`), wiped on
  hard lock and on `agent stop`.

## 6. Audit & approval (G27)

- Append-only audit log (env, PID, **requesting binary**, timestamp) for every
  sensitive-env access. Per-release biometric approval for prod/signing envs.

## 7. Slicing plan

| Slice  | Scope                                                                                                                                            | Gaps              |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------- |
| **7a** | Lock state machine (pure) + `agent start/stop/status/lock/unlock`, in-memory key, spawn-based delivery, request-scoped protocol, hardening flags | G9, G23, G24, G28 |
| **7b** | HW-backed KEK + decrypt-on-demand; audit log + sensitive-env approval                                                                            | G25, G27          |
| **8**  | `mount <env>` consuming the manifest; file-watch; wipe-on-lock                                                                                   | G11, G18, G26     |

Slice 7a lands the **contract and the protocol invariants** (the parts that must
be right from day one); 7b hardens key custody; 8 adds mount. Non-goals per §5.8
stand: same-UID memory scrape and current-run secret theft are mitigated, not
eliminated — only isolation (§5.7) removes the escalation path.
