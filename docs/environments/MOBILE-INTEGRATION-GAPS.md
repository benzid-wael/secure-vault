# Mobile IDE Integration — Gap Analysis

> **Scope**: What `secure-vault` needs to deliver secrets cleanly into **iOS
> (Xcode)** and **Android (Android Studio / Gradle)** builds, across both
> **CLI-driven** and **GUI-driven** workflows, and how that maps onto the **v1**
> (current, CLI-only) and **v2.0** (Agent & Mount) architectures.
>
> **Reference project**: `superchat-platform/services/Superxpense` — React
> Native 0.82 + Expo, native iOS (Xcode/CocoaPods) + Android (Gradle flavors),
> Fastlane releases. Secrets in `.env.vault` (`dev`, `prod`, `ci-dev`,
> `ci-prod`). CI orchestrated by a bespoke `scripts/ci/run-fastlane-with-vault.sh`.
>
> **Legend** — Platform: `[iOS]` `[Android]` `[Both]` · Context: `[CLI]` `[GUI]`
> `[Both]` · Fits: `[v1]` doable in current architecture · `[v2]` belongs with /
> depends on Agent & Mount · `[v2.5+]` later. Effort: `S`/`M`/`L`.

---

## 1. How mobile builds actually consume config

Understanding the consumption side is what makes the gaps concrete. `dotenv` is **not** universally sufficient.

| Consumer                              | Reads                                                                                          | Notes                                                                                                                                                                                      |
| ------------------------------------- | ---------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **react-native-config** (Superxpense) | `.env` (dotenv)                                                                                | Bridges dotenv → native constants (`BuildConfig` on Android, generated header/plist on iOS). Good enough for **app-level** JS/native constants.                                            |
| **iOS build system**                  | `.xcconfig`, `Info.plist` (`$(KEY)` substitution), entitlements                                | Values the _build_ needs before app code runs — bundle-id suffix, URL schemes, SDK keys read from `Info.plist` at launch (Google Maps, some Firebase), signing. dotenv cannot reach these. |
| **CocoaPods**                         | `ENVFILE` env var → a file path                                                                | Podfile reads a real file on disk; the file must exist.                                                                                                                                    |
| **Android/Gradle**                    | `gradle.properties`, `local.properties`, `buildConfigField`, `resValue`, manifest placeholders | Configure-time values (signing, applicationId suffix, resource strings) the build system reads directly.                                                                                   |
| **Firebase / Google**                 | `GoogleService-Info.plist` (iOS), `google-services.json` (Android)                             | **Real files** required even for local GUI dev builds, not just CI.                                                                                                                        |
| **Signing (CI + local release)**      | Apple `.p8`, `.mobileprovision`, Android keystore `.jks`, Play service-account `.json`         | **Binary/file secrets.** Today stored base64 in the vault and decoded by hand in `run-fastlane-with-vault.sh`.                                                                             |

Two structural truths fall out of this table:

1. **dotenv-only delivery covers the RN app layer but not the native build
   layer or file/binary secrets.** That is the single biggest source of gaps.
2. **A single environment must fan out to several artifacts** (a `.env`, a
   `GoogleService-Info.plist`, an `.xcconfig`, a keystore file…). Neither `run
--export <path>` (v1) nor `mount <env> --path <file>` (v2) models "one env →
   many typed artifacts."

---

## 2. Current-state matrix (what works today, v1)

| Axis                         | Works today                                                                                                                                                  | Friction                                                                          |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------- |
| `[CLI]` `[Both]`             | `vault env run <env> --export .env -- <build cmd>` wraps any spawned build (`yarn ios`, `gradlew`, `xcodebuild`, `fastlane`). File is `0600`, wiped on exit. | None for dotenv consumers. This is the sweet spot.                                |
| `[GUI]` `[Both]`             | Pre-export `vault env export dev > .env.development`, then ⌘R / Run.                                                                                         | **Plaintext lingers indefinitely**; no auto-cleanup; password prompt every time.  |
| `[iOS]` native settings      | —                                                                                                                                                            | No way to feed Xcode build settings or `Info.plist` (see §4.A templating).        |
| `[Android]` native settings  | —                                                                                                                                                            | No way to feed `gradle.properties`/`buildConfigField`/`resValue` (see §4.A).      |
| `[Both]` file/binary secrets | Manual: `echo "$VAR" \| base64 -d > file` in a script.                                                                                                       | No first-class "materialize var as decoded file." Every project re-implements it. |
| `[Both]` orchestration       | Hand-written shell (`run-fastlane-with-vault.sh`) maps env → many files.                                                                                     | No declarative manifest; not reusable across repos.                               |

---

## 3. Gap catalog

Each gap tagged by platform / context / version fit.

| ID                                                               | Gap                                                                                                                 | Platform | Context | Fits   | Effort    |
| ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- | -------- | ------- | ------ | --------- |
| **A. Output formats (templating — vault stays format-agnostic)** |
| G1                                                               | No templating engine (`file.<ext>.vtpl` → `{{KEY}}` substitution → `file.<ext>`; single-pass; no format knowledge)  | Both     | Both    | v1     | M         |
| G2                                                               | No opt-in escaping filters (`{{KEY \| json\|xml\|base64}}`) for values with format-special chars                    | Both     | Both    | v1     | S         |
| **B. File & binary secrets**                                     |
| G6                                                               | No "materialize var → decoded file" (`--decode base64`, mode `0600`)                                                | Both     | Both    | v1     | M         |
| G7                                                               | No first-class handling for `GoogleService-Info.plist` / `google-services.json` as managed files                    | Both     | Both    | v1     | S         |
| G8                                                               | No signing-asset delivery (Apple `.p8`/`.mobileprovision`, Android `.jks`, Play `.json`)                            | Both     | CLI     | v1     | M         |
| **C. Access & session (unlock)**                                 |
| G9                                                               | No non-interactive unlock — a GUI build / Run Script phase cannot prompt for a password                             | Both     | GUI     | **v2** | L         |
| G10                                                              | No biometric / keychain unlock for frictionless re-unlock after auto-lock                                           | Both     | GUI     | v2.5+  | L         |
| **D. Lifecycle & cleanup**                                       |
| G11                                                              | Plaintext from `export >` lingers forever in the GUI flow                                                           | Both     | GUI     | **v2** | — (mount) |
| G12                                                              | Auto-lock ↔ mounted-file contract undefined (does lock wipe live mounts?)                                          | Both     | GUI     | **v2** | S         |
| G13                                                              | Expo `prebuild` regenerates native projects and drops injected native values                                        | Both     | Both    | v2.5+  | M         |
| **E. IDE / build-system triggers**                               |
| G14                                                              | No Xcode Run Script build-phase helper / documented snippet                                                         | iOS      | GUI     | v1     | S         |
| G15                                                              | No Gradle plugin / `init.gradle` task to pull config at configure time                                              | Android  | Both    | v1     | M         |
| G16                                                              | No VSCode / JetBrains plugin (inline resolve, run from palette)                                                     | Both     | GUI     | v3     | L         |
| **F. Orchestration / manifest**                                  |
| G17                                                              | No declarative delivery manifest ("env → N typed artifacts") in `.vaultrc`                                          | Both     | Both    | v1     | M         |
| G18                                                              | `mount <env> --path` is single-file/dotenv only — cannot fan out formats                                            | Both     | GUI     | **v2** | M         |
| **G. Scaffolding & DX**                                          |
| G19                                                              | No `init --preset react-native` (scaffolds `.vaultrc`, `.gitignore`, xcconfig include, gradle snippet, build phase) | Both     | Both    | v1     | M         |
| G20                                                              | No `doctor` for mobile wiring (checks envfile presence, gitignore, mount status, manifest validity)                 | Both     | Both    | v1     | S         |
| **H. CI parity**                                                 |
| G21                                                              | No `--ci` clean export (strip comments/metadata)                                                                    | Both     | CLI     | v2.5   | S         |
| G22                                                              | No env-vault sync (`pull`/`push`, committed encrypted vault workflow)                                               | Both     | CLI     | v2.5   | M         |
| **I. Agent security / threat model**                             |
| G23                                                              | Agent must never expose a dump-all / enumeration API (a naive one lets any client drain the vault)                  | Both     | Both    | **v2** | S         |
| G24                                                              | IPC socket reachable by any same-UID process — socket perms don't stop same-UID malware                             | Both     | Both    | **v2** | M         |
| G25                                                              | Master key + decrypted envs resident in agent memory (ptrace / memory scrape → total loss)                          | Both     | Both    | **v2** | L         |
| G26                                                              | Mounted plaintext readable by any same-UID process — mount is the highest-risk mode                                 | Both     | GUI     | **v2** | M         |
| G27                                                              | No per-release approval or audit log for sensitive envs (prod/signing) — theft is silent + untraceable              | Both     | Both    | **v2** | M         |
| G28                                                              | Auto-lock defeatable via synthetic "activity" — malware keeps the session alive indefinitely                        | Both     | Both    | **v2** | S         |

---

## 4. What needs to be done — by group

### A. Config templating `[v1]` — **highest leverage, unblocks native iOS/Android**

**Design decision: vault does _not_ own third-party formats.** An earlier draft
proposed native emitters (`xcconfig`/`plist`/`properties`/`xml` serializers).
That was rejected: it would force vault to understand, escape, and track the
flavor drift of every build-config format forever — unbounded maintenance for a
secrets tool. Instead vault does **format-agnostic templating**: the developer
writes the format, vault only substitutes secrets into it.

`dotenv` remains the **one** native serializer vault owns (it is vault's own
format, not a third-party one — see `src/utils/dotenv.js`). Everything else is a
template.

- **G1 — templating engine.** `file.<ext>.vtpl` → substitute `{{KEY}}`
  placeholders from the resolved `{KEY: VALUE}` map → `file.<ext>` (output path =
  template path with `.vtpl` stripped, or an explicit `out`). Vault treats the
  template as opaque text; it never parses the target format. Works for
  `Secrets.xcconfig`, `Info.plist`, `gradle.properties`, `secrets.xml`, and any
  future text format with zero new code.
  - **Delimiter `{{KEY}}`** deliberately avoids `$( )` (xcconfig/plist) and
    `${ }` (gradle/shell) so a template can contain the target format's own
    interpolation tokens (`$(inherited)`, `$(SRCROOT)`, `${...}`) untouched.
  - **Single-pass substitution** — a substituted value is never re-scanned for
    placeholders, so one secret cannot inject a `{{OTHER_KEY}}` reference and
    exfiltrate another. Security-relevant invariant.
  - **Missing key** → hard error by default (no silent empty substitution).
- **G2 — opt-in escaping filters.** Default substitution is **raw** (covers the
  ~95% of secrets that are format-safe: API keys, URLs, DSNs). For values with
  format-special chars, `{{KEY | json}}` / `{{KEY | xml}}` / `{{KEY | base64}}`
  apply a small pure escaping function. These filters are the only place any
  format knowledge lives, and they are opt-in, not mandatory. Reuse the dotenv
  escaper's test pattern (`test(env): cover quoteDotenvValue edge cases`).

> **Note for Superxpense specifically**: because it is pure RN with
> react-native-config, dotenv already reaches the app layer. Templating matters
> for (a) values the build system needs at configure time and (b) any future
> non-RN native target. Add `.vtpl` files if/when build-time or SDK-at-launch
> keys appear; otherwise B (files) is more urgent.

### B. File & binary secrets `[v1]` — **most urgent for real mobile signing/Firebase**

> **Boundary vs §A templating.** Use **blob delivery** (this group) when the
> file is _entirely_ secret and vault stores it whole — Firebase plists/JSON,
> `.jks`, `.p8`, `.mobileprovision`. Use a **`.vtpl` template** (§A/G1) when the
> file is mostly static structure with a few secret fields, so only the secrets
> live in the vault and the skeleton stays diffable in git. Binary/large files
> are always blobs, never templates.

- **G6** — `vault env file <KEY> --out <path> [--decode base64] [--mode 0600]`:
  write a single var's value to a file, optionally base64-decoded, with secure
  cleanup semantics matching `run --export`. Replaces the hand-rolled
  `base64 -d` in `run-fastlane-with-vault.sh`.
- **G7** — recognize known file secrets (`GoogleService-Info.plist`,
  `google-services.json`) in the manifest (§F) so a single command drops them
  where Xcode/Gradle expect them for **local GUI dev**, not just CI.
- **G8** — extend G6 to the signing set (`.p8`, `.mobileprovision`, `.jks`, Play
  `.json`); document the fastlane wiring. (Provisioning/cert _management_ à la
  `match` stays out of scope — vault only stores & materializes.)

### C. Access & session `[v2]` — **the GUI linchpin; already the v2.0 goal**

- **G9** — `vault env agent start` + session-based unlock + `agent lock|unlock`
  - launchd. Once the daemon holds the key, GUI builds never prompt. This is
    exactly SPEC §13.5 and needs no change beyond building it.
- **G10** — biometric/keychain unlock (SPEC §13.7) makes re-unlock after
  auto-lock painless; pull earlier if G12 forces frequent re-unlocks.

### D. Lifecycle & cleanup

- **G11 `[v2]`** — `mount <env> --path` + file-watch + secure-shutdown wipe
  replaces `export >`. Closed by v2.0 as specified.
- **G12 `[v2]` — RESOLVED (decision of record, see SPEC §13.5):** a **two-tier
  lock**. _Soft lock_ (idle timeout) drops the key and refuses **new** requests
  but **leaves live mounts in place** — the file is already on disk (I1), so
  wiping mid-build breaks the all-day session for no gain, while refusing new
  requests preserves containment (I2). _Hard lock_ (sleep, screen-lock, max
  session lifetime, explicit `agent lock`) **securely wipes** mounts and drops
  the key. The idle timer resets on **user-authenticated actions only** — never
  raw IPC or file reads (that closes the G28 synthetic-activity attack) — and a
  **hard max session lifetime** caps exposure. This satisfies the §13.5 "stays
  live all day" criterion _and_ the conservative-lock rule (§4-I/G28). Persistent
  mount stays opt-in + warned; default GUI is run-scoped (mode B, §5.4).
- **G13 `[v2.5+]`** — Expo config plugin / prebuild hook so injected native
  values survive `expo prebuild`.

### E. IDE / build-system triggers

- **G14 `[v1]` `[iOS]`** — ship a documented Xcode **Run Script build phase**
  that calls `vault env apply` (or `file`, against the agent session once G9
  lands, or a pre-mounted file) to render a `.vtpl` `.xcconfig`/plist into
  `DERIVED_FILE_DIR`. With a persistent mount (v2) this becomes optional — the
  file is just present.
- **G15 `[v1]` `[Android]`** — a Gradle task / `init.gradle` snippet that shells
  to `vault env apply` at configure time to render a `gradle.properties.vtpl`.
- **G16 `[v3]`** — VSCode / JetBrains plugin (SPEC §14.2).

### F. Orchestration / manifest `[v1]` — **the piece that replaces bespoke shell**

- **G17** — extend `.vaultrc` with a declarative **delivery manifest**:

  ```jsonc
  {
    "env": "dev",
    "deliver": [
      // native dotenv serializer (the one format vault owns)
      { "path": ".env.development", "format": "dotenv" },
      // blob: whole file stored as one var, written verbatim (§B)
      {
        "path": "ios/GoogleService-Info.plist",
        "from": "GOOGLE_PLIST",
        "decode": "base64",
      },
      {
        "path": "android/app/google-services.json",
        "from": "GOOGLE_JSON",
        "decode": "base64",
      },
      // template: skeleton in repo, {{KEY}} substituted (§A); out = strip .vtpl
      { "template": "ios/Config/Secrets.xcconfig.vtpl" },
    ],
  }
  ```

  Three delivery kinds, distinguished by which field is present: `format`
  (native dotenv), `from` (+ optional `decode` — blob), or `template`
  (`.vtpl` → substitute). Vault understands the target format in **none** of
  them except dotenv.

  Add `vault env apply [env]` (v1: write all artifacts, wipe on a companion
  `vault env clean`) — and have **v2 `agent mount` consume the same manifest**
  so one `mount` fans out every artifact and watches them all. This unifies G6,
  G7, G18 and retires `run-fastlane-with-vault.sh`.

- **G18 `[v2]`** — `mount` reads the manifest (not a single `--path`).

### G. Scaffolding & DX `[v1]`

- **G19** — `vault env init --preset react-native`: scaffold `.vaultrc` (with a
  starter manifest), `.gitignore` entries, an Xcode build-phase snippet, and a
  Gradle snippet.
- **G20** — `vault env doctor`: verify envfile presence, gitignore coverage,
  manifest validity, agent/mount status; actionable fixes.

### H. CI parity `[v2.5]`

- **G21** — `export --format <fmt> --ci` (strip comments/metadata). SPEC §13.6.
- **G22** — `pull`/`push` + committed-encrypted-vault workflow. SPEC §13.6.
  (Superxpense already commits `.env.vault` and shares the password out-of-band,
  so this is largely a formalization.)

### I. Agent security / threat model `[v2]` — **design constraints, not optional features**

These are not "features to add later" — they are invariants the v2.0 agent must
satisfy from day one, or it becomes a _worse_ security posture than v1. Full
analysis in §5.

- **G23** — the agent protocol must be **request-scoped**: a client asks for one
  environment (ideally a key subset); there is **no** `list-envs` and **no**
  `dump-all` verb. `agent status` returns metadata only, never values.
- **G24** — do not rely on a listening socket that any same-UID process can dial.
  Prefer **spawn-based delivery** (agent → its own forked child over an inherited
  fd). Where a socket is unavoidable, add `SO_PEERCRED`/`LOCAL_PEERCRED` peer
  checks — but treat them as a speed bump, not a boundary (see §5.1).
- **G25** — hold a **hardware-backed KEK** (Secure Enclave / Keychain / TPM),
  **decrypt one env on demand**, never keep all environments decrypted in memory;
  harden the process (`RLIMIT_CORE=0`, `PT_DENY_ATTACH`/`ptrace_scope`, `mlock`,
  hardened runtime, no `get-task-allow`).
- **G26** — treat `mount` as the **highest-risk mode**: opt-in, scoped to the
  minimal keys, `0600` in a `0700` dir, wiped on lock. Default the GUI story to
  run-scoped delivery; require an explicit flag + warning for a persistent mount.
- **G27** — **per-release approval** (biometric) for sensitive envs
  (prod/signing) + an **append-only audit log** (env, PID, binary, timestamp) so
  theft is neither silent nor untraceable.
- **G28** — **conservative auto-lock**: base "activity" on user-authenticated
  actions (not raw requests), add a hard max session lifetime, and lock on
  sleep / screen-lock. This is also the fix wired into **G12**.

---

## 5. Threat model — Agent & Mount

The v2.0 agent keeps the vault unlocked for convenience. An unlocked, long-lived
process holding keys is exactly what an attacker wants, so the agent's security
must be designed, not assumed. This section defines the attacker, the surfaces,
and the trade-offs behind the §4-I invariants.

### 5.1 Attacker model & the unavoidable invariants

**Attacker**: a **contaminated build process** — a malicious npm `postinstall`, a
trojaned CocoaPod, a compromised Gradle plugin — running **as the developer's own
UID** on the dev machine, trying to steal env vars, read sensitive files, and
drain the vault.

**The hard truth**: same-UID code is **inside your trust boundary**. It can
`ptrace` the agent, read `/proc/<pid>/environ` of sibling processes, and read any
`0600` file you own. **No userspace agent can fully defeat same-UID malware.**
Any design that claims otherwise is wrong. What a good design _can_ do is contain
the blast radius, raise the cost, and make theft noisy and auditable.

Three invariants follow:

- **I1 — Delivered secrets are forfeit.** Once a secret reaches a process, a
  contaminated process has it. The goal is **not** to protect the secrets of the
  current run (impossible) — it is to protect everything else.
- **I2 — Containment.** A contaminated run must obtain **only** the secrets of
  the environment it was authorized for. It must never enumerate environments,
  reach other environments, or persist access beyond the run.
- **I3 — No regression below v1.** v1 has _no ambient authority_ — a process only
  gets what a `run`/`export` explicitly handed it. A naive agent (listening
  socket + dump-all API + persistent mount) is **strictly worse** than v1 and is
  unacceptable.

### 5.2 Threat surfaces

Ranked by real-world exposure to same-UID malware.

| Surface               | Attack                                              | Same-UID feasibility | Mitigation                                                            | Residual risk                                      |
| --------------------- | --------------------------------------------------- | -------------------- | --------------------------------------------------------------------- | -------------------------------------------------- |
| **Mounted plaintext** | `cat .env`                                          | Trivial              | Opt-in only; minimal keys; `0600`/`0700`; wipe on lock (G26)          | File is readable for its whole lifetime            |
| **Env-var injection** | read `/proc/pid/environ`; inherited by all children | Trivial              | `clean` inject; file delivery over env; inject into direct child only | Inherited by legitimate children; crash dumps      |
| **Agent IPC socket**  | connect + request secrets                           | Trivial              | Spawn-based delivery; no dump-all; peer creds (G23, G24)              | Same-UID client can still request its own env      |
| **Agent memory**      | `ptrace` / read process memory → KEK + all envs     | High                 | HW-backed KEK; decrypt-on-demand; anti-ptrace; `mlock` (G25)          | **Cannot be fully closed in userspace**            |
| **Session longevity** | synthetic "activity" to defeat auto-lock            | Moderate             | User-activity-based lock; hard max lifetime; lock on sleep (G28)      | Attacker active during a legitimately-open session |

### 5.3 "Can a process scan all secrets?" — answer by design

| Design                                                                                             | Can an arbitrary same-UID process drain the vault?                                                                 |
| -------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| **v1 (no daemon)**                                                                                 | **No** — no ambient authority; it gets only what was handed to it.                                                 |
| **Naive v2** (listening socket, `dump-all`, persistent mount)                                      | **Yes** — connect and ask, or read the mount, or scrape memory. Regression.                                        |
| **Hardened v2** (spawn delivery, request-scoped, no enumeration, HW-KEK, decrypt-on-demand, audit) | **Only its own authorized env** — cannot enumerate or drain. Residual: memory scrape + its own run's secrets (I1). |

### 5.4 Trade-off analysis — delivery mode

How the secret reaches the build. Higher rows = safer/less convenient.

| Mode                                 | Convenience | Plaintext-at-rest window | Blast radius if consumer is malware     | Best for                                  |
| ------------------------------------ | ----------- | ------------------------ | --------------------------------------- | ----------------------------------------- |
| **A. `run` scoped inject (`clean`)** | Medium      | None (memory only)       | This run's env only; not on disk        | CLI builds, CI (**v1 default**)           |
| **B. `run --export` file, wiped**    | Medium      | Only during the child    | This run's env; on disk briefly         | CLI + wrapping a GUI (`open -W`) (**v1**) |
| **C. Persistent `mount`**            | High        | Whole session            | This env, readable by any same-UID proc | All-day GUI dev — **opt-in, warned (v2)** |
| **D. FUSE virtual FS**               | High        | None (never on disk)     | This env, via FS access controls        | v3 north star; needs kernel ext           |

**Recommendation**: default GUI to **B** (wrap the IDE process; file dies when
the IDE quits); offer **C** only behind an explicit flag with a warning; treat
**A** as the CLI/CI default it already is. The convenience jump from B→C is real
but it converts a child-lifetime window into a whole-session plaintext file — the
single biggest posture downgrade in the whole feature.

### 5.5 Trade-off analysis — unlock / key storage

Where the unlock key lives determines resistance to memory scrape and at-rest
theft, traded against re-unlock friction.

| Storage                                 | Re-unlock friction | Resists memory scrape       | Resists at-rest theft | Notes                                               |
| --------------------------------------- | ------------------ | --------------------------- | --------------------- | --------------------------------------------------- |
| **1. Prompt every time (v1)**           | High (types pw)    | N/A (no daemon)             | Strong                | Safe but the exact friction v2 exists to remove     |
| **2. Session key in agent memory**      | None               | **Weak** (ptrace)           | Weak                  | Naive agent default — avoid as the whole story      |
| **3. OS keychain, ACL-bound to binary** | Low (per-policy)   | Medium                      | Strong                | Only the signed vault binary retrieves; good base   |
| **4. Secure Enclave / TPM + biometric** | Low (Touch ID)     | **Strong** (non-exportable) | Strong                | KEK never leaves hardware; per-access re-auth (G10) |

**Recommendation**: **3 as the floor, 4 for sensitive envs.** Combine with
decrypt-on-demand (G25) so even a scraped agent yields at most the currently-open
env, not the whole vault. Option 4 also makes the G12/G28 conservative auto-lock
painless — re-unlock is a fingerprint, not a password.

### 5.6 Recommended posture by context

| Context                          | Default posture                                                                                   |
| -------------------------------- | ------------------------------------------------------------------------------------------------- |
| **CLI / CI build**               | `run` scoped `clean` inject or `--export` wiped file. No daemon needed. (v1 today.)               |
| **Local GUI dev**                | `run --export` wrapping the IDE (mode B); HW-backed re-unlock; persistent mount opt-in + warned   |
| **Sensitive env (prod/signing)** | Per-release biometric approval + append-only audit log (G27); decrypt-on-demand (G25)             |
| **Untrusted / prod-grade build** | **Isolation** — run in container / VM / sandbox / ephemeral CI; agent injects across the boundary |

### 5.7 The real answer to "the process is contaminated": isolation

Every mitigation in §5.2–5.6 _reduces blast radius_ but cannot beat same-UID
code (I1, memory scrape). The only design that _eliminates_ the escalation path
is to stop running the build in the same trust domain as the agent:

- Run the build in a **container / VM / sandbox** (macOS App Sandbox/seatbelt,
  Linux namespaces + seccomp) or an **ephemeral CI runner**, and inject only the
  scoped secrets **across the boundary**.
- Then even total compromise of the build yields **only that build's secrets** and
  **cannot** reach the agent, the KEK, or other environments — different
  UID/namespace means `ptrace`, `/proc`, and the socket are all out of reach.

This is the difference between _reducing_ blast radius (agent hardening, the
pragmatic dev-laptop answer) and _eliminating_ the escalation path (isolation,
the honest prod-grade answer). The docs must say this plainly so nobody
over-trusts the agent.

### 5.8 Explicit non-goals

The agent does **not** protect against, and must not claim to:

- Same-UID memory scraping of the agent (mitigated, not eliminated — §5.2).
- Theft of the **current run's own** secrets by that run (I1).
- A developer exfiltrating secrets they are themselves authorized to unlock.
- Kernel-level or root compromise of the host.

---

## 6. Recommended sequencing

The gaps split cleanly by dependency. **B + F + A are all v1 work and independent
of the v2 agent** — they deliver value now and don't wait on the daemon.

| Track                                  | Gaps                           | Version   | Rationale                                                                                                                                                                                                              |
| -------------------------------------- | ------------------------------ | --------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **1. File secrets + manifest**         | G6, G7, G17, (G18-ready)       | v1.8      | Unblocks real local GUI dev (Firebase files) and retires the bespoke CI shell. Highest practical value for Superxpense today.                                                                                          |
| **2. Config templating**               | G1, G2                         | v1.8      | Format-agnostic `.vtpl` engine; unblocks native build-time config for any text format without vault owning format flavors.                                                                                             |
| **3. Scaffolding**                     | G19, G20                       | v1.9      | Makes tracks 1–2 adoptable across repos.                                                                                                                                                                               |
| **4. Agent & Mount**                   | G9, G11, G12, G18, **G23–G28** | v2.0      | The GUI lifecycle win. **The §4-I / §5 security invariants (G23–G28) are non-negotiable — a naive agent regresses below v1 (I3).** Resolve G12 (lock↔mount) before implementing. Mount consumes the track-1 manifest. |
| **5. Signing + Gradle/Xcode triggers** | G8, G14, G15                   | v2.0      | Depends on session unlock (G9) for non-interactive build phases.                                                                                                                                                       |
| **6. Frictionless + IDE + CI**         | G10, G13, G16, G21, G22        | v2.5 / v3 | Polish and reach.                                                                                                                                                                                                      |

**Bottom line:** v2.0 Agent & Mount closes the **access & lifecycle** half
(G9, G11 — the hard part) and, for a dotenv/RN project like Superxpense, is
_nearly_ sufficient on its own. It does **not** close the **format &
file-secret** half (A, B) or the **orchestration** half (F) — and those are the
gaps that make `secure-vault` first-class for _native_ iOS/Android and for the
Firebase/signing files every mobile app needs. Those three tracks are v1 work
and shouldn't wait on the daemon. Fix the G12 lock↔mount contract before
building §13.5.

**Security caveat:** the agent's convenience comes from keeping the vault
unlocked, which is precisely what malware wants. Per §5, a naive agent is a
_regression_ below v1 (I3). Build it only with the §4-I invariants in place —
request-scoped delivery, no enumeration, HW-backed decrypt-on-demand, audited
approval, conservative lock — and be explicit that against a same-UID
contaminated build the agent _reduces_ blast radius but only **isolation**
(container/VM/sandbox/CI) _eliminates_ the escalation path (§5.7).

---

## 7. Task breakdown

Agile decomposition of the §6 tracks. Each task is a deployable unit; gap IDs in
parentheses map back to §3/§4. Versions follow the §6 sequencing
(v1.8/v1.9/v2.0/v2.5+).

### Milestone v1.8 — Native config & file secrets (no daemon)

- [ ] **Task 1: Templating engine + opt-in escaping filters** (G1, G2)
  - **Goal**: Render `file.<ext>.vtpl` → `file.<ext>` by substituting `{{KEY}}`
    placeholders from the resolved env map, keeping vault fully format-agnostic.
  - **Constraints**: `{{KEY}}` delimiter only (leave target-format `$()`/`${}`
    tokens untouched); single-pass substitution (never re-scan a substituted
    value → no cross-secret injection); missing key = hard error; raw
    substitution by default with opt-in `{{KEY | json|xml|base64}}` filters.
    dotenv stays a separate native serializer (`src/utils/dotenv.js`), untouched.
  - **Dependencies**: None.
  - **Implementation Guidance**: The filter functions are the _only_ place any
    format knowledge lives — keep them opt-in, never auto-detect format from
    extension. Reuse the `quoteDotenvValue` edge-case test pattern per filter.
    Anti-pattern to reject: per-format serializers (the discarded emitter design).
  - **Validation**: A `.vtpl` with `$(inherited)` and `${...}` renders those
    tokens intact; a value containing `{{X}}` is not recursively expanded;
    `| json` on a value with `"`/newline yields valid JSON; unknown key fails
    loudly (non-zero exit).

- [ ] **Task 2: Materialize variable → decoded file (blob delivery)** (G6, G7)
  - **Goal**: `vault env file <KEY> --out <path> [--decode base64] [--mode 0600]`
    writes a single var's value to disk verbatim (optionally base64-decoded) with
    `run --export` secure-cleanup semantics.
  - **Constraints**: Default mode `0600`; reuse the existing export temp-file/wipe
    path. Recognize known file secrets (`GoogleService-Info.plist`,
    `google-services.json`) so they land where Xcode/Gradle expect for local GUI
    dev, not only CI. Never write plaintext world-readable before `chmod`.
  - **Dependencies**: None (parallel to Task 1).
  - **Implementation Guidance**: Replaces the hand-rolled `base64 -d` in
    `run-fastlane-with-vault.sh`. Share the `--export` lifecycle from
    `bin/commands/envRunHelpers.js`. Blob delivery = whole file is one var; use
    for entirely-secret/binary/large files (templates handle mostly-static files).
  - **Validation**: A base64 var decodes to a byte-identical binary at `0600`;
    cleanup fires on the same trigger as `run --export`; a materialized Firebase
    plist is accepted by a sample build.

- [ ] **Task 3: Delivery manifest + `apply`/`clean`** (G17, G18-ready)
  - **Goal**: Extend `.vaultrc` with a `deliver` manifest ("one env → N
    artifacts"); add `vault env apply [env]` (write all) and `vault env clean`
    (wipe all).
  - **Constraints**: Three entry kinds by field present — `format` (native
    dotenv), `from` (+optional `decode`, blob), `template` (`.vtpl`; `out`
    defaults to path minus `.vtpl`). Validate the manifest, fail clearly on
    unknown format/key. `apply` idempotent; `clean` wipes exactly what `apply`
    wrote. Manifest schema/validator is a standalone module so v2 `mount` reuses
    it verbatim.
  - **Dependencies**: Tasks 1, 2.
  - **Implementation Guidance**: The piece that retires
    `run-fastlane-with-vault.sh`. Do not couple `apply` to any daemon.
  - **Validation**: One sample manifest produces a `.env`, a decoded Firebase
    plist, and a rendered `xcconfig` in a single command; `clean` removes exactly
    those; an invalid manifest is rejected with an actionable message.

### Milestone v1.9 — Adoptability

- [ ] **Task 4: `init --preset react-native` scaffolder** (G19)
  - **Goal**: Scaffold a starter `.vaultrc` manifest, `.gitignore` entries,
    `.vtpl` starter templates, and Xcode/Gradle build-phase snippets.
  - **Constraints**: Never overwrite existing files without confirmation;
    generated `.gitignore` covers every artifact the starter manifest emits.
  - **Dependencies**: Task 3.
  - **Implementation Guidance**: Reference the Superxpense layout (RN 0.82 + Expo,
    iOS CocoaPods, Android Gradle flavors) for defaults. Snippets reference the
    same commands `doctor` checks for.
  - **Validation**: Running the preset in a clean RN repo yields a manifest
    `apply` accepts and a gap-free `.gitignore`; re-running is non-destructive.

- [ ] **Task 5: `doctor` for mobile wiring** (G20)
  - **Goal**: Verify envfile presence, `.gitignore` coverage, manifest validity
    (and later agent/mount status), emitting actionable fixes.
  - **Constraints**: Diagnostic-only — never mutates the vault or secrets; every
    failed check prints a concrete remediation; non-zero exit on any failure.
  - **Dependencies**: Task 3.
  - **Implementation Guidance**: Build a check registry so v2 agent/mount checks
    slot in later. Reuse Task 3's manifest validator rather than re-parsing.
  - **Validation**: Detects a manifest artifact missing from `.gitignore`; detects
    an invalid manifest; exits non-zero on any failure, zero when clean.

### Milestone v2.0 — Agent & Mount (security-gated)

- [x] **Task 6: Define the auto-lock ↔ live-mount contract (design gate)** (G12) — **DONE**
  - **Goal**: Decide, in writing, what auto-lock does to live mounts — resolving
    §5.4/§5.5 before any daemon code exists.
  - **Decision (of record, SPEC §13.5):** a **two-tier lock**. _Soft lock_ (idle
    timeout) drops the key and refuses new requests but leaves live mounts in
    place (I1: file already on disk; I2: no new envs). _Hard lock_ (sleep,
    screen-lock, max session lifetime, explicit `agent lock`) securely wipes
    mounts + drops the key. Idle timer resets on user-authenticated actions only
    (never raw IPC/file reads → closes G28); hard max session lifetime caps
    exposure. Persistent mount opt-in + warned; default GUI is run-scoped (mode
    B). Re-unlock via password, or Touch ID once G10 lands.
  - **Dependencies**: None — unblocks Tasks 7 & 8.
  - **Validation**: ✅ SPEC §13.5 records the contract; it preserves both
    "all-day GUI session survives" (soft lock) and "walking away locks" (hard
    lock), and the activity definition defeats synthetic keep-alive (G28).

- [~] **Task 7: Agent daemon + session unlock (invariants baked in)** (G9, G23–G25, G28) — **PARTIAL (7a preview)**
  - **7a done:** two-tier lock (`src/agent/lockState.js`), request-scoped protocol - lock enforcement (`src/agent/sessionManager.js` — G23, I2, G28), daemon over
    a 0700 Unix socket (`src/agent/daemon.js`), and `vault env agent
start/stop/status/lock/unlock`. Design in `AGENT-DESIGN.md`.
  - **7b in progress:** spawn-based delivery **done** — `vault env agent exec
<env> -- <cmd>` (`src/agent/spawnService.js`) runs the build as the daemon's
    own child with the scoped env injected, so the secret never crosses the socket
    and never touches disk (§5.4 mode A); refused while locked (I2). Closes the
    delivery-mechanism half of G24.
  - **7b remaining (required before production, per I3):** process hardening
    (`RLIMIT_CORE=0`, `PT_DENY_ATTACH`/`ptrace_scope`, `mlock`, hardened runtime),
    peer-cred (the socket-hardening half of G24), HW-backed KEK + decrypt-on-demand
    (G25), audit log + sensitive-env approval (G27). Node can't do the hardening
    or peer-cred natively — needs a small addon or a launchd/entitlements wrapper.
  - **Goal**: `vault env agent start` + session-based unlock + `agent lock|unlock`
    (launchd) so GUI builds never prompt, satisfying the §4-I invariants from
    day one.
  - **Constraints** (non-negotiable): request-scoped protocol only — no
    `list-envs`, no `dump-all`, `agent status` returns metadata never values
    (G23); prefer spawn-based delivery over a listening socket,
    `SO_PEERCRED`/`LOCAL_PEERCRED` a speed bump only (G24); HW-backed KEK,
    decrypt one env on demand, never all resident (G25); conservative auto-lock
    on authenticated activity + hard max lifetime + lock on sleep/screen-lock
    (G28). Must not regress below v1's zero-ambient-authority (I3).
  - **Dependencies**: Task 6.
  - **Implementation Guidance**: SPEC §13.5. Harden the process: `RLIMIT_CORE=0`,
    `PT_DENY_ATTACH`/`ptrace_scope`, `mlock`, hardened runtime, no
    `get-task-allow`. Document non-goals (§5.8). Reject in review any verb
    returning more than the one authorized env.
  - **Validation**: An arbitrary same-UID process cannot enumerate or drain other
    envs via the protocol; `agent status` exposes no values; core dumps disabled
    and ptrace denied on-platform; idle/sleep triggers lock per Task 6.

- [x] **Task 8: `mount` consumes the delivery manifest** (G11, G18, G26) — **DONE**
  - **Goal**: Replace `export >` with `mount <env>` that reads the Task-3
    manifest, fans out every artifact, watches them, and wipes on secure
    shutdown/lock.
  - **Constraints**: Highest-risk mode — opt-in behind an explicit flag +
    warning; minimal keys; `0600` in a `0700` dir; wiped on lock per Task 6
    (G26). Default GUI story stays run-scoped delivery (mode B); persistent mount
    (mode C) is not the default. Reuse the Task-3 manifest schema, not a separate
    `--path` model.
  - **Dependencies**: Tasks 3, 6, 7.
  - **Implementation Guidance**: Unifies with `apply` so one manifest drives both
    v1.8 file delivery and v2 mount. The warning copy must state the B→C posture
    downgrade explicitly.
  - **Done**: `vault env agent mount|mounts|unmount` (`bin/commands/env.js`) over
    `src/agent/mountService.js` (fans the Task-3 manifest out through the
    request-scoped session — refused while locked, I2), `src/agent/mountRegistry.js`
    (tracks the mount set, wiped as a group on hard lock/stop per Task 6), and
    `src/agent/mountWatch.js` (re-materializes a mount a build deletes; stopped
    before any secure delete so an unmount/wipe is never re-created). `mount`
    requires `--force`; without it the CLI refuses and points to `vault env run`
    (mode B). Reuses `normalizeManifest`/`renderDeliverEntry`/`writeArtifact`,
    not a separate `--path` model.
  - **Validation**: ✅ One `mount` produces every manifest artifact; hard lock
    wipes all live mounts (integration test); a mount deleted out from under a
    build is re-materialized (integration + `mountWatch` unit tests); mount is
    refused without `--force` and before unlock; the template _source_ survives a
    wipe.

- [ ] **Task 9: Audit log + per-release approval for sensitive envs** (G27)
  - **Goal**: Append-only audit log (env, PID, requesting binary, timestamp) and
    per-release biometric approval for prod/signing envs.
  - **Constraints**: Log append-only / tamper-evident; approval gate for
    sensitive envs only; combine with decrypt-on-demand (G25); approval prompt
    not spoofable by synthetic activity. Record the requesting _binary_, not just
    PID (PIDs recycle).
  - **Dependencies**: Task 7.
  - **Implementation Guidance**: Ties into the biometric path (Task 12) but the
    log itself is independent and ships with the agent.
  - **Validation**: Every sensitive-env access appends an entry; a prod/signing
    unlock requires explicit approval; a same-UID process cannot silently rewrite
    the log in place (or tampering is detectable).

- [ ] **Task 10: Signing-asset delivery** (G8)
  - **Goal**: Extend blob materialization (Task 2) to the signing set — Apple
    `.p8`/`.mobileprovision`, Android `.jks`, Play `.json` — with documented
    Fastlane wiring.
  - **Constraints**: Non-interactive build phases use the agent session (Task 7).
    Provisioning/cert _management_ (à la `match`) stays out of scope — vault only
    stores & materializes.
  - **Dependencies**: Tasks 2, 7.
  - **Implementation Guidance**: Removes the base64-by-hand steps from
    `run-fastlane-with-vault.sh`; document the exact env wiring (`ENVFILE`,
    keystore paths).
  - **Validation**: A Fastlane release consumes vault-materialized signing assets
    end-to-end with no manual base64; assets are `0600` and wiped after the run.

- [ ] **Task 11: Xcode & Gradle build-phase triggers** (G14, G15)
  - **Goal**: A documented Xcode Run Script phase and a Gradle task / `init.gradle`
    snippet that call `vault env apply` to render `.vtpl` artifacts at
    build/configure time.
  - **Constraints**: Both run non-interactively via the agent session (Task 7);
    with a persistent mount the file is already present, making the phase
    optional. Xcode phase survives the sandboxed build-phase environment; Gradle
    runs at configure time.
  - **Dependencies**: Tasks 1, 3, 7.
  - **Implementation Guidance**: Distribute snippets via the Task-4 preset. A full
    Gradle plugin is out of scope — a task/snippet suffices.
  - **Validation**: A sample Xcode build renders its `.vtpl` `xcconfig`/plist into
    `DERIVED_FILE_DIR` with no prompt; a sample Gradle configure phase renders
    `gradle.properties` from the vault non-interactively.

### Milestone v2.5 / v3 — Frictionless, IDE, CI parity

- [ ] **Task 12: Biometric / keychain unlock** (G10)
  - **Goal**: Secure Enclave/Keychain biometric unlock so re-unlock after
    auto-lock is a fingerprint, not a password.
  - **Constraints**: KEK non-exportable / hardware-backed (storage option 4,
    §5.5) with keychain-ACL-bound-to-binary as the floor (option 3); combine with
    decrypt-on-demand so a scraped agent yields at most the currently-open env.
  - **Dependencies**: Task 7.
  - **Implementation Guidance**: SPEC §13.7. Pull earlier if Task 6's contract
    forces frequent re-unlocks; makes conservative auto-lock painless.
  - **Validation**: Re-unlock after auto-lock completes via Touch ID with no typed
    password; the KEK is confirmed non-exportable on-platform.

- [ ] **Task 13: CI parity — clean export + vault sync** (G21, G22)
  - **Goal**: `export --ci` (strip comments/metadata) and `pull`/`push` for a
    committed-encrypted-vault workflow.
  - **Constraints**: `--ci` output free of comment/metadata lines that break
    strict parsers; `pull`/`push` formalizes the existing "commit `.env.vault`,
    share password out-of-band" pattern without weakening encryption.
  - **Dependencies**: None (export) / Task 3 helpful.
  - **Implementation Guidance**: SPEC §13.6. Superxpense already commits
    `.env.vault`, so `pull`/`push` is largely formalization — match that
    convention.
  - **Validation**: `--ci` output has no comment/metadata lines and parses in a
    strict CI consumer; `pull` then `push` round-trips an encrypted vault with no
    plaintext leak.

- [ ] **Task 14: Expo prebuild survival** (G13)
  - **Goal**: Ensure injected native values survive `expo prebuild`, which
    regenerates native projects and drops them.
  - **Constraints**: Re-apply the manifest's native artifacts after prebuild
    regenerates iOS/Android.
  - **Dependencies**: Tasks 1, 3.
  - **Implementation Guidance**: An Expo config plugin or prebuild post-hook that
    re-runs `apply`; test against RN 0.82 + Expo.
  - **Validation**: `expo prebuild` followed by a build retains all
    vault-injected native values.

- [ ] **Task 15: VSCode / JetBrains plugin** (G16)
  - **Goal**: IDE plugin for inline resolve and run-from-palette.
  - **Constraints**: Goes through the agent session (no plaintext in the plugin);
    respects request-scoped delivery.
  - **Dependencies**: Task 7.
  - **Implementation Guidance**: SPEC §14.2. Lowest priority; scope tightly to
    resolve + run.
  - **Validation**: The plugin resolves an env and launches a run through the
    agent without exposing values in editor state or logs.

### Critical path

Task 6 (lock↔mount contract) hard-gates Tasks 7–8. Tasks 1–5 (v1.8/v1.9) are
fully daemon-independent and carry the most immediate value for Superxpense. The
invariants in Task 7 (G23–G28) are part of its definition-of-done, not a
follow-up — a naive agent regresses below v1.
