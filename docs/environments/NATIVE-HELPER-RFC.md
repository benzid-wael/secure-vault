# RFC: a native key helper for the agent (7b)

| Field     | Value                                                                                                    |
| --------- | -------------------------------------------------------------------------------------------------------- |
| Status    | **Draft**: open questions in §10 need decisions before Phase 1                                           |
| Date      | 2026-10-15                                                                                               |
| Closes    | G24 (peer-cred half), G25, G27 (approval + attribution halves), Task 12 (G10)                            |
| Builds on | [`AGENT-DESIGN.md`](AGENT-DESIGN.md) §7–8, [`MOBILE-INTEGRATION-GAPS.md`](MOBILE-INTEGRATION-GAPS.md) §5 |

## 1. Summary

The agent (`vault env agent`) is a developer preview: it works, but it holds
every decrypted environment in an unhardened Node process. `AGENT-DESIGN.md` §8
explains why the remaining protections (no core dumps, anti-debugging, locked
memory, a hardware-backed key, Touch ID, peer credentials) can't be reached from
JavaScript.

This RFC proposes **moving key custody out of Node into a small, signed native
helper process (`vault-keyd`)**. The helper holds the vault key and hands the
Node daemon **one environment at a time**. The daemon keeps everything it does
today (the protocol, the lock state machine, mounts, `exec`, audit) but never
holds the master key or the whole vault again.

It also proposes a **pure-JS Phase 0** that ships first and closes two smaller
gaps without any native code.

## 2. Where the agent stands today

Read from the code (`bin/commands/env.js` `agent run` / `agent unlock`,
`src/agent/*`), not just the design note:

| Aspect                   | Today                                                                                                    | Consequence                                                                                       |
| ------------------------ | -------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| What's in memory         | `unlock` decrypts the **whole** env vault into an `EnvironmentResolver` on the V8 heap                   | A memory scrape gets every environment, not just the one in use (G25)                             |
| How the password arrives | `vault env agent unlock` sends it to the daemon **in the socket request** (`{verb: 'unlock', password}`) | Anything that can read that socket traffic or the daemon's memory gets the master password itself |
| Process launch           | `agent start` spawns `process.execPath` (the user's own `node`, or the Bun binary) detached              | Not launchd (as `AGENT-DESIGN.md` §1 says); core dumps follow the user's shell limits             |
| Process identity         | Whatever `node` the user installed                                                                       | **We can't sign it**, so no hardened runtime and no Keychain ACL bound to our code                |
| Socket                   | `0700` dir, `0600` socket, request-scoped protocol, no peer check                                        | Any same-UID process can connect (G24); the audit log can't say _who_ asked (G27)                 |
| Vault format             | One AES-256-GCM blob per vault (all environments together)                                               | True per-env decryption needs a format change (§6.4)                                              |

None of this is a bug in the preview: it's documented, and `agent start` prints
the warning. It's the gap this RFC closes.

## 3. Goals and non-goals

**Goals**

1. The master key and the full decrypted vault never live in the Node process.
2. The process that does hold them is hardened: no core dumps, no debugger
   attach, key pages locked out of swap, hardened runtime.
3. Re-unlock after auto-lock can be **Touch ID**, using a key that never leaves
   the Secure Enclave (Task 12, storage option 4 in GAPS §5.5).
4. Sensitive environments (prod / signing) can require a **Touch ID approval
   per release** (G27).
5. The daemon can tell **which process** is asking (UID always; on macOS the
   client's code signature), and the audit log records it (G24, G27).
6. Without the helper, everything keeps working exactly as today, and says so.

**Non-goals** (unchanged from GAPS §5.8, and the docs must keep saying it)

- Defeating same-UID malware. The helper **raises the cost**; it doesn't make
  the dev laptop a security boundary. Isolation (GAPS §5.7) remains the real
  answer for untrusted builds.
- Protecting a run's own secrets from that run (I1).
- Windows. Linux is a later phase (§7).

## 4. The constraint that decides the design

Most of the protections hang off **the identity of the process holding the
key**: hardened runtime and `get-task-allow` are code-signature flags, a
Keychain ACL names a signed binary, and Secure Enclave keys need a signed app
with a keychain access group.

The agent runs under three different binaries:

| Channel              | Process holding the key | Can we sign it?                                                                                                                    |
| -------------------- | ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| npm (`npm i -g …`)   | the user's `node`       | **No**                                                                                                                             |
| Standalone CLI (Bun) | `vault-macos-*` (ours)  | Yes, but a JS runtime with a JIT needs `allow-jit`, which weakens the hardened runtime, and the key would still sit on the JS heap |
| Desktop app (future) | Electron (ours)         | Yes, same JIT/heap caveat                                                                                                          |

So the key can't live in any of them and get the protections. It has to live in
a **small binary we build, sign and control**, which is the helper.

## 5. Options considered

| Option                           | What it is                                                                            | Verdict                                                                                                                                                                                                                                                                                                                        |
| -------------------------------- | ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **A. N-API addon** in the daemon | C/Rust module loaded into Node; calls `mlock`, `ptrace`, `setrlimit`, `getsockopt`    | **Rejected as the main design.** Runs under the user's unsigned `node`, so no hardened runtime, no Keychain ACL, no Secure Enclave key. Decrypted envs would still be V8 strings. Needs prebuilds per Node ABI; support inside a Bun-compiled binary is unverified. Still a candidate for one narrow job (peer creds, §10 Q4). |
| **B. Launch wrapper only**       | Start the daemon via `sh -c 'ulimit -c 0; exec …'` or a launchd plist                 | **Adopt as Phase 0.** Cheap and real, but only covers core dumps.                                                                                                                                                                                                                                                              |
| **C. Companion helper binary**   | A separate signed process that owns the key; the daemon asks it for one env at a time | **Recommended.** The only option that gets signing-based protections on the npm channel.                                                                                                                                                                                                                                       |
| **D. Shell out to `security`**   | Use the macOS `security` CLI for the Keychain                                         | **Rejected.** No Secure Enclave, no Touch ID, the secret transits `security`'s argv/stdout, and trust shifts to that tool.                                                                                                                                                                                                     |

## 6. Proposed design

### 6.1 Process topology

```
  vault env agent unlock ──(password, once)──▶ vault-keyd  (signed, hardened)
                                                 │  holds: vault key (mlock'd)
                                                 │         SE-wrapped key (Keychain)
                                                 │
  build / IDE ──▶ agent socket ──▶ Node daemon ──┤ decrypt(env) ──▶ one env's vars
                  (request-scoped)  (lock state,  │ approve(env)  ──▶ Touch ID prompt
                                     mounts, exec,│ lock          ──▶ zeroize
                                     audit)       │
```

- The **helper** is launched by the daemon as a child over an inherited
  socketpair (no listening endpoint of its own in Phases 1–2). It exits when its
  parent does.
- The **CLI client** gives the password to the helper, not to the daemon: the
  daemon proxies the bytes without parsing them, or (simpler, see §10 Q3) the
  CLI talks to the helper through the daemon-provided fd.
- The **daemon** keeps its job and its tests: the request-scoped protocol, the
  two-tier lock, mounts, `exec`, the hash-chained audit log. Its
  `resolveEnv(name)` closure becomes "ask the helper for `name`", the seam the
  code already has (`unlockVault` returns `resolveEnv`).

### 6.2 Helper protocol

Length-prefixed messages over the socketpair, deliberately tiny:

| Request                       | Effect                                                                                                                                   |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `unlock(vaultPath, password)` | Derive the vault key (PBKDF2, same parameters as today), verify it opens the vault, keep the key in `mlock`ed memory, zero the password. |
| `unlock_biometric(vaultPath)` | Touch ID → Secure Enclave unwraps the stored vault key (Phase 2).                                                                        |
| `decrypt(env, keys?)`         | Decrypt the vault, resolve `env` (layering + templates), return only that env (or its key subset), zero everything else.                 |
| `approve(env, reason)`        | Touch ID prompt "Release _prod_ to _xcodebuild_?" → yes/no (Phase 2).                                                                    |
| `lock`                        | Zero the key; drop any cached state.                                                                                                     |
| `status`                      | Metadata only: locked/unlocked, hardening flags actually in effect.                                                                      |

There is no `list`, no `dump`, no "give me the key". This is the same G23 rule
the daemon follows, one level down.

Resolving layering and `{{env:…}}` templates inside the helper means porting
`EnvironmentResolver` (≈130 lines). The alternative, returning the raw
decrypted vault to Node and resolving there, would put the whole vault back on
the V8 heap, which defeats the purpose.

### 6.3 Hardening in the helper

| Protection         | macOS                                                                    | Linux (Phase 4)                                                             |
| ------------------ | ------------------------------------------------------------------------ | --------------------------------------------------------------------------- |
| No core dumps      | `setrlimit(RLIMIT_CORE, 0)` at start                                     | same + `prctl(PR_SET_DUMPABLE, 0)`                                          |
| No debugger attach | hardened runtime without `get-task-allow`, plus `ptrace(PT_DENY_ATTACH)` | `PR_SET_DUMPABLE 0` blocks same-UID `ptrace` (with Yama `ptrace_scope ≥ 1`) |
| Key not swapped    | `mlock` the key buffer; `zeroize` on drop                                | same                                                                        |
| Plaintext lifetime | decrypted vault zeroed right after `decrypt` returns                     | same                                                                        |
| Signed identity    | Developer ID + hardened runtime + notarization                           | n/a (GPG-signed release artifacts)                                          |

The daemon reports what is **actually** in effect (`agent status` →
`hardening: helper (signed, hardened, mlock) | none (preview)`), never what was
merely requested.

### 6.4 Key hierarchy and Touch ID (Phase 2)

- On first `unlock`, the helper creates a **Secure Enclave P-256 key** with an
  access-control policy (`.biometryCurrentSet` or `.userPresence`, §10 Q5).
- It wraps the vault key to that SE key (ECIES, `SecKeyCreateEncryptedData`) and
  stores the **wrapped** blob as a Keychain item in our access group.
- Re-unlock after auto-lock: Touch ID → SE unwraps → vault key back in `mlock`ed
  memory. The password isn't needed until the user changes it or enrols a new
  finger (`biometryCurrentSet` invalidates the item, by design).
- `change-password` re-wraps; `agent forget` deletes the SE key and the item.

**Decrypt-on-demand, honestly:** with today's one-blob format, `decrypt(env)`
decrypts the whole vault inside the helper for a moment, then keeps only the
requested env. That already gets the main G25 win: **Node only ever holds the
env in use**. Per-env encryption (a per-env data key wrapped by the vault key)
would also shrink what the _helper_ touches per request, but it's a vault-format
v3 change with CLI/desktop compatibility cost. Defer it until the helper exists
and the benefit can be measured.

### 6.5 Peer credentials and client attribution (Phase 3)

Node can't read peer credentials, but the helper can. Phase 3 moves the
**listening socket into the helper**:

- The helper accepts client connections, reads `LOCAL_PEERCRED` (UID) and, on
  macOS, `LOCAL_PEERTOKEN` (audit token) to look up the client's PID and **code
  signature** (`SecCodeCopyGuestWithAttributes`).
- It forwards the request to the Node daemon over the private socketpair,
  tagged with `{uid, pid, signingId}`; the daemon's policy and audit log use it.
- Policy is opt-in per env in `.vaultrc` (e.g. `prod: allow only
com.apple.dt.xcodebuild, fastlane`); the default stays "same UID", because
  per GAPS §3 peer creds are a speed bump, not a boundary.

### 6.6 Language and packaging

- **Language: Rust** (recommended): one codebase for macOS now and Linux later;
  memory-safe; `zeroize`, `nix` (`mlock`, `prctl`, `setrlimit`, `getsockopt`),
  `security-framework` (Keychain, `SecKey`), `objc2-local-authentication`
  (Touch ID). Swift is the alternative if macOS-only is acceptable for good:
  first-class Security/LocalAuthentication APIs, but a second toolchain if Linux
  ever happens.
- **Packaging:**
  - npm: per-platform `optionalDependencies` (`@benzid.wael/secure-vault-keyd-darwin-arm64`, `…-darwin-x64`), the common pattern for native CLIs;
  - standalone CLI: the helper ships next to `vault-macos-*`;
  - desktop app: in `Contents/MacOS`.
- **Lookup:** the daemon finds the helper by a fixed path relative to its own
  package. It **verifies the helper's code signature (Team ID) before
  trusting it**, so a swapped binary is refused.
- **Fallback:** helper missing, unsigned or on an unsupported OS → today's
  in-process preview, with the warning and `hardening: none`.

## 7. Rollout

| Phase                                | Scope                                                                                                                                                                                        | Needs                                               | Size |
| ------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------- | ---- |
| **0. Pure-JS hardening**             | Launch the daemon via `sh -c 'ulimit -c 0; exec …'` (no core dumps on macOS/Linux); `agent status` reports hardening; correct `AGENT-DESIGN.md` §1 (detached spawn, not launchd)             | nothing                                             | S    |
| **1. Helper: custody + hardening**   | `vault-keyd` with `unlock` / `decrypt` / `lock` / `status`; `EnvironmentResolver` port; hardening table (§6.3); daemon uses it when present; signature check; CI builds for darwin-arm64/x64 | Developer ID signing (§8)                           | L    |
| **2. Secure Enclave + Touch ID**     | SE-wrapped key, biometric re-unlock (Task 12 / G10), `approve` for sensitive envs (G27)                                                                                                      | Phase 1; keychain access-group entitlement (§10 Q1) | M    |
| **3. Helper fronts the socket**      | Peer UID + macOS code-signature attribution, per-env client policy, attribution in the audit log (G24, G27)                                                                                  | Phase 1                                             | M    |
| **4. Linux**                         | Same helper on Linux: `prctl`, `mlock`, `SO_PEERCRED`; no SE (kernel keyring / TPM out of scope at first)                                                                                    | Phase 1                                             | M    |
| **5. Per-env encryption (optional)** | Vault format v3 with per-env data keys                                                                                                                                                       | measured need                                       | M    |

Each phase is shippable alone, and `agent start` stops printing "preview" only
once Phase 1 is in place **and** signed.

## 8. Prerequisites and costs

- **Apple Developer Program ($99/yr) + Developer ID** for signing and
  notarization; already the open item in [`CODE_SIGNING.md`](../CODE_SIGNING.md).
  Without it, hardened runtime can't be enforced in a meaningful way, Keychain
  ACLs break on every update (ad-hoc signatures change), and SE keys aren't
  available (§10 Q1).
- **A macOS signing leg in CI.** The CLI is cross-compiled on Ubuntu today; the
  helper must be built and signed on a macOS runner.
- **A second toolchain** (Rust) in the repo, with its own lint/test/format gates
  added to the definition of done.

## 9. Testing

- **Helper unit tests** (`cargo test`): protocol, zeroization, refusal of
  unknown verbs, resolver parity with `EnvironmentResolver` (shared fixtures).
- **Daemon tests stay pure JS**: the helper is injected behind the existing
  `unlockVault` → `resolveEnv` seam, with a fake in Vitest.
- **Hardening checks on a real Mac** (scripted, run before each release; GitHub
  macOS runners are VMs with no Secure Enclave):
  - `lldb -p <pid>` fails;
  - `codesign -d --entitlements :- vault-keyd` shows no `get-task-allow`;
  - `ulimit -c` is 0 inside the helper;
  - `vmmap` shows the key region wired;
  - Touch ID unlock/approve works, and is refused after enrolment changes.
- **E2E**: a `test:e2e`-style scenario for `agent start → unlock → exec → lock`
  with the helper present and absent.

## 10. Open questions (decisions needed)

1. **Secure Enclave without a provisioning profile?** SE keys and the data
   protection keychain need a keychain access group entitlement. For a Developer
   ID (non-App-Store) binary that likely needs a provisioning profile. _To
   verify in a spike before committing to Phase 2._
2. **Rust or Swift?** Rust if Linux is on the roadmap at all; Swift if
   macOS-only is acceptable for good. Recommendation: Rust.
3. **Password path.** Should the CLI hand the password straight to the helper
   (cleanest; needs the daemon to pass a helper fd to the CLI client) or through
   the daemon as opaque bytes (simpler; the bytes still cross the daemon's
   memory briefly)? Recommendation: straight to the helper.
4. **Peer creds sooner?** A tiny N-API addon for `getsockopt` only could give
   UID checks in Phase 0/1, before Phase 3. Worth it, or wait for the helper to
   own the socket? Recommendation: wait; UID-only checks add little over the
   `0700` dir.
5. **Touch ID policy:** `.biometryCurrentSet` (invalidated when fingers change,
   stronger) or `.userPresence` (allows the login password as fallback,
   friendlier)? Recommendation: `biometryCurrentSet` for sensitive envs,
   `userPresence` for plain re-unlock.
6. **Is the desktop app in scope?** The desktop app holds its master password in
   the main process (C2). It could use the same helper later, but this RFC
   targets the agent only.

## 11. Decision

_Pending._ Once §10 is settled: accept, open Phase 0 as a normal PR, and start
Phase 1 with a one-week spike that answers Q1 and Q3 on real hardware.
