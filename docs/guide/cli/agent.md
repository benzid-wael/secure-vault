# The agent (v2.0 preview)

The **agent** is a background session daemon that keeps a vault unlocked for a
whole session, so GUI-driven and repeated builds don't re-prompt for the master
password every time.

::: danger Developer preview — not yet hardened
The agent is a **developer preview**. The key is held in memory and the process is
**not yet hardened** (no `mlock` / anti-ptrace / hardware-backed key, no peer-cred
checks on the socket). Those land in a later slice and are **required before
production use**. Don't rely on it for sensitive/production secrets yet — for those,
prefer [`vault env run`](/guide/cli/env-vaults#running-commands-with-secrets), which
holds nothing resident. See
[Agent design](https://github.com/benzid-wael/secure-vault/blob/main/docs/environments/AGENT-DESIGN.md)
for the full threat model.
:::

## Why it exists

Injection with `vault env run` is safe and stateless, but it re-prompts (or needs a
piped password) every time. For an all-day GUI dev session — Xcode/Android Studio
open, builds triggered from the IDE — that friction adds up. The agent keeps one
session unlocked and serves scoped requests, then locks itself back down when you
walk away.

## Session lifecycle

```bash
vault env agent start            # start the background session daemon
vault env agent status           # metadata only — never returns values
vault env agent unlock           # unlock the session (prompts / accepts a password)
vault env agent lock             # explicit hard lock — wipes mounts, drops the key
vault env agent stop             # stop the daemon
```

The daemon speaks a **request-scoped** protocol over a Unix socket in a `0700`
directory: a client asks for one named environment (or a subset of keys) — there is
**no enumerate/list-envs and no dump-all** verb, and `status` returns metadata only,
never values. `VAULT_AGENT_DIR` overrides the runtime location.

### Two-tier auto-lock

- **Soft lock** (idle timeout) — drops the key and refuses **new** requests, but
  leaves already-live mounts in place (the files are already on disk; wiping them
  mid-build would break the session for no gain).
- **Hard lock** (sleep, screen-lock, max session lifetime, or explicit
  `agent lock`) — **securely wipes** mounts and drops the key.

The idle timer resets only on **user-authenticated actions**, never on raw socket
traffic or file reads — so malware can't keep the session alive with synthetic
activity.

## Spawn-based delivery — `agent exec`

The safest delivery mode. The daemon runs your command as its **own child** with the
scoped environment injected, so the secret **never crosses the socket and never
touches disk** — it lives only in the child's memory for that run.

```bash
vault env agent exec dev -- npm run build          # clean env (allowlist only)
vault env agent exec dev --merge -- fastlane ios   # layer vault vars over the full env
```

The child's stdout/stderr are relayed back, the exit code propagates, and Ctrl-C
tears the child down. Refused while the session is locked.

## Live mounts — `mount` / `mounts` / `unmount`

`mount` materializes your [`.vaultrc` delivery manifest](/guide/cli/delivering-secrets#deliver-everything-at-once-with-a-manifest)
as plaintext files for the whole session — for tools that must read real files and
can't be wrapped in `exec`.

```bash
vault env agent mount dev --force    # materialize the manifest for the session
vault env agent mounts               # list live mounts
vault env agent unmount              # securely wipe all mounts (or one with --path)
```

::: warning Highest-risk mode — opt-in behind `--force`
A mount leaves plaintext on disk for the whole session, readable by any process
running as you. It is **opt-in behind `--force`** and prints a warning; without the
flag the CLI refuses and points you to [`vault env run`](/guide/cli/env-vaults#running-commands-with-secrets)
(the default, safer path).
:::

- Mounts pull vars through the request-scoped session, so a mount is **refused while
  locked**.
- Every mount is tracked, so a **hard lock or `stop` wipes the whole set** as a group.
- Mounts are **watched**: a file a build deletes out from under it is re-materialized
  (the watch stops before any secure delete, so an `unmount`/wipe is never re-created).

## Audit log — `agent audit`

The agent keeps an **append-only, hash-chained** audit log. Every unlock (including
rejected ones), env access (with its source — mount / exec / raw), explicit lock, and
auto-lock is recorded with **metadata only — never values**.

```bash
vault env agent audit             # print the audit log
vault env agent audit --verify    # walk the hash chain, fail on the first break
```

Each entry hashes the previous one, so editing or deleting any earlier entry is
detectable, and the chain resumes across daemon restarts.

::: info Still to come in a later slice
Per-release biometric approval for sensitive envs (needs Secure Enclave / Touch ID)
and client PID/binary attribution (needs peer-cred on the socket) are not in the
preview. The log records what is knowable server-side without guessing at client
identity.
:::

## Recommended posture

| Context                        | Use                                                                                       |
| ------------------------------ | ----------------------------------------------------------------------------------------- |
| CLI / CI build                 | [`vault env run`](/guide/cli/env-vaults#running-commands-with-secrets) — no daemon needed |
| All-day local GUI dev          | `agent exec` where possible; `mount` only behind `--force`, with the warning              |
| Sensitive env (prod / signing) | Not the preview agent yet — wait for hardening, or isolate the build                      |
