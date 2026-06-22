# Secure Vault Environments — Full Specification

> Feature: Securely manage, version, and inject environment variables from an encrypted
> `.env.vault` file into development tools, build processes, and CI/CD pipelines.
>
> Status: **v1.5 delivered** · Revision 6

---

## Table of Contents

1. [Overview](#1-overview)
2. [Goals & Non-Goals](#2-goals--non-goals)
3. [Architecture](#3-architecture)
4. [Data Model](#4-data-model)
5. [File System Layout](#5-file-system-layout)
6. [CLI Reference](#6-cli-reference)
7. [Key Flows](#7-key-flows)
8. [Template Reference System](#8-template-reference-system)
9. [Environment Layering](#9-environment-layering)
10. [Validation Engine](#10-validation-engine)
11. [Injection Modes](#11-injection-modes)
12. [Security Model](#12-security-model)
13. [Milestones & Roadmap](#13-milestones--roadmap)
14. [North Star / Future Work](#14-north-star--future-work)
15. [Open Questions](#15-open-questions)
16. [Known Issues & Pending Reconciliations](#16-known-issues--pending-reconciliations)
17. [Appendix: Comparison to 1Password Environments](#17-appendix-comparison-to-1password-environments)

---

## 1. Overview

### 1.1 Problem

Developers need environment variables to configure their tools at build and run time.
These variables often contain secrets (API keys, database URLs, tokens) that must not
be stored in plain text on disk or committed to version control.

Current approaches each have drawbacks:

| Approach               | Problem                                                    |
| ---------------------- | ---------------------------------------------------------- |
| Plain `.env` files     | Secrets on disk in plain text; easy to accidentally commit |
| `.env` in `.gitignore` | No team sync; onboarding requires manual setup             |
| CI/CD secrets store    | Vendor lock-in; no local dev parity                        |
| 1Password Environments | Works well but is tied to 1Password; no CLI runner mode    |

### 1.2 Solution

An **Environment Vault** (`.env.vault`) — a standalone, AES-256-GCM encrypted file
that lives alongside a project. It stores named environments (e.g., `development`,
`staging`, `production`) with full version history. A CLI injects these variables
into child processes on demand, optionally via a temporary `.env` file for tools
that require one.

### 1.3 Key Design Decisions

| Decision                 | Choice                      | Rationale                                                     |
| ------------------------ | --------------------------- | ------------------------------------------------------------- |
| Storage model            | Separate `.env.vault` file  | Independent password; can be shared/committed encrypted       |
| Encryption               | Reuse `CryptographyService` | AES-256-GCM, PBKDF2 SHA-512, 100k iterations                  |
| Primary interface        | CLI (`vault env *`)         | Works everywhere; no UI dependency                            |
| Process injection        | `vault env run` wrapper     | Child process spawn; secrets never written to disk by default |
| Delivery for build tools | `--env-file` flag           | Temp `.env` file created for child lifetime, then wiped       |
| Daemon                   | CLI-only (v1)               | Agent/mount mode deferred to v2                               |

---

## 2. Goals & Non-Goals

### 2.1 Goals

- Store multiple named environments in a single encrypted file
- Version every change with the ability to rollback
- Inject env vars into child processes without writing to disk
- Support tools that require an on-disk `.env` file (react-native-config, Docker Compose)
- Template references between environments within the same vault
- Environment layering (e.g., `staging extends base`)
- Pre-flight validation of required variables
- Export to `.env` format and `.env.example` (keys only)
- CLI-only operation — no Electron UI dependency

### 2.2 Non-Goals (v1)

- Agent/daemon mode with persistent mounts
- FUSE virtual filesystem
- Cross-vault references (main vault → env vault)
- Team sync / remote push/pull
- VSCode extension
- CI/CD plugin
- Biometric unlock

---

## 3. Architecture

### 3.1 System Context

```
┌────────────────────────────────────────────────────────┐
│                   Developer Workstation                │
│                                                        │
│  ┌──────────────┐    ┌──────────────────────────────┐  │
│  │  Main Vault  │    │    Environment Vault         │  │
│  │  (passwords) │    │    (.env.vault)              │  │
│  └──────────────┘    │  ┌───────────────────────┐   │  │
│                      │  │  development          │   │  │
│                      │  │  staging              │   │  │
│                      │  │  production           │   │  │
│                      │  └───────────────────────┘   │  │
│                      └───────────┬──────────────────┘  │
│                                  │                     │
│                     ┌────────────▼─────────────┐       │
│                     │   vault env run          │       │
│                     │   vault env export       │       │
│                     │   vault env validate     │       │
│                     └────────────┬─────────────┘       │
│                                  │                     │
│                     ┌────────────▼─────────────┐       │
│                     │   Child Process          │       │
│                     │   (npm, npx, docker,     │       │
│                     │    react-native, etc.)   │       │
│                     └──────────────────────────┘       │
└────────────────────────────────────────────────────────┘
```

### 3.2 Module Architecture

```
bin/
├── cli.js                         Commander entry point
└── commands/
    └── env.js                     vault env * subcommand tree

src/electron/
├── models/
│   └── EnvironmentVault.js        Data model
├── services/
│   ├── EnvironmentVaultService.js  Encrypt/decrypt, CRUD, password mgmt
│   ├── EnvironmentResolver.js      Template refs, layering, validation
│   └── CryptographyService.js      Reused — AES-256-GCM + PBKDF2
└── utils/
    └── envFile.js                  Temp file creation, secure deletion
```

---

## 4. Data Model

### 4.1 On-Disk Format (Encrypted)

The `.env.vault` file is a JSON object, all fields except `type` and `version` are
outputs of `CryptographyService.encrypt()`:

```json
{
  "type": "environment-vault",
  "version": 1,
  "salt": "<64-char-hex>",
  "iv": "<32-char-hex>",
  "authTag": "<32-char-hex>",
  "encrypted": "<hex-string>"
}
```

| Field       | Type       | Description                                    |
| ----------- | ---------- | ---------------------------------------------- |
| `type`      | string     | Always `"environment-vault"`                   |
| `version`   | number     | Schema version (currently `1`)                 |
| `salt`      | hex string | 32-byte PBKDF2 salt, regenerated on each write |
| `iv`        | hex string | 16-byte AES-GCM initialization vector          |
| `authTag`   | hex string | 16-byte GCM authentication tag                 |
| `encrypted` | hex string | AES-256-GCM ciphertext of the payload          |

### 4.2 Decrypted Payload

```json
{
  "vaultVersion": 1,
  "created": "2026-05-30T12:00:00.000Z",
  "updated": "2026-05-30T14:30:00.000Z",
  "environments": {
    "development": {
      "description": "Local development overrides",
      "versions": [
        {
          "n": 1,
          "created": "2026-05-30T12:00:00.000Z",
          "message": "Initial setup",
          "vars": {
            "API_URL": "http://localhost:3000",
            "API_KEY": "dev-key-123",
            "DB_URL": "postgres://localhost/dev"
          },
          "nonSensitive": ["API_URL"],
          "required": ["API_URL", "API_KEY"]
        },
        {
          "n": 2,
          "created": "2026-05-30T14:30:00.000Z",
          "message": "Add staging URL",
          "vars": {
            "API_URL": "{{env:staging/API_URL}}",
            "API_KEY": "dev-key-456",
            "DB_URL": "postgres://localhost/dev"
          },
          "nonSensitive": ["API_URL"],
          "required": ["API_URL", "API_KEY"]
        }
      ],
      "activeVersion": 2,
      "extends": null
    },
    "staging": {
      "description": "Staging environment",
      "versions": [
        {
          "n": 1,
          "created": "2026-05-30T13:00:00.000Z",
          "message": null,
          "vars": {
            "API_URL": "https://staging.example.com",
            "API_KEY": "staging-key-789",
            "DB_URL": "postgres://staging/db"
          },
          "nonSensitive": ["API_URL"],
          "required": ["API_URL", "API_KEY", "DB_URL"]
        }
      ],
      "activeVersion": 1,
      "extends": null
    },
    "production": {
      "description": "Production environment",
      "versions": [
        {
          "n": 1,
          "created": "2026-05-30T13:30:00.000Z",
          "message": null,
          "vars": {
            "API_URL": "https://example.com",
            "API_KEY": "prod-key-999",
            "DB_URL": "{{env:staging/DB_URL}}"
          },
          "nonSensitive": ["API_URL"],
          "required": ["API_URL", "API_KEY", "DB_URL"]
        }
      ],
      "activeVersion": 1,
      "extends": "staging"
    }
  }
}
```

### 4.3 `EnvironmentVault` Class

```js
class EnvironmentVault {
  constructor({ vaultVersion, created, updated, environments })
  // Each environment entry is an Environment object (inner class)

  toJSON()
  static fromJSON(data)

  // Environment CRUD
  addEnvironment(name, { description })
  removeEnvironment(name)
  renameEnvironment(oldName, newName)

  // Version management
  getActiveVersion(name)
  setActiveVersion(name, versionN)
  addVersion(name, vars, { required, nonSensitive, message })
  getVersion(name, versionN)
  getHistory(name)
  rollback(name, versionN)
    // Creates a new version whose vars are a copy of versionN's vars
    // Does NOT delete subsequent versions
  squash(name, { keep = 1 })
    // Collapses older versions, keeping the last `keep` versions.
    // The squashed range becomes a single version (v1) with the
    // vars of its most recent version. All kept versions are
    // renumbered sequentially.

  // Import / export
  importFromEnvFile(name, filePath, { message })
    // Parses a .env file, creates a new version with all vars.
    // Marks no vars as non-sensitive (user must set --public post-import).

  // Read helpers
  getResolvedVars(name, resolver)
    // Returns merged + template-resolved vars for the active version
  isSensitive(name, key, versionN)
    // Returns true if key is not in the version's nonSensitive list
  listEnvironmentNames()
}
```

### 4.4 Sensitivity Model

Every var in a version has an implicit sensitivity:

- **Not listed** in `nonSensitive` → **sensitive** (default). Value is masked in `show`, always hidden in logs.
- **Listed** in `nonSensitive` → **non-sensitive** (a.k.a. public). Value is shown in full in `show`, included in `template` output.

By default, all vars are sensitive. Mark vars as `--public` during `set` only when
you are certain the value contains no secrets (e.g., `API_URL`, `PORT`, `NODE_ENV`).

Sensitivity is per-version. A var that was `--public` in v1 can become sensitive in
v2 (or vice versa).

### 4.5 Naming Constraints

- Environment names: `[a-z0-9][a-z0-9_-]*` (lowercase, no leading/trailing hyphens)
- Reserved environment names (case-insensitive): `self` — collides with the `{{env:self/KEY}}` self-reference keyword (§8.2)
- Key names: `[A-Z_][A-Z0-9_]*` (uppercase convention, enforced by validation)
- Max environments per vault: 100
- Max versions per environment: 1000 (squash to compress)
- Max vars per environment: 500
- Max key length: 1024 characters
- Max value length: 65536 characters

---

## 5. File System Layout

### 5.1 Vault Naming

Every environment vault has a logical name. The on-disk filename is always
`<name>.env.vault`. The name is set at creation time and used for discovery:

| Scenario               | Vault Name    | Resolved Path                         |
| ---------------------- | ------------- | ------------------------------------- |
| `--vault <path>` given | _(from path)_ | Exact `<path>`                        |
| `--name <name>` given  | `<name>`      | `<app-data>/envs/<name>.env.vault`    |
| Neither (creation)     | CWD dirname   | `<app-data>/envs/<dirname>.env.vault` |

### 5.2 Discovery Priority (Read / Run)

When locating an existing vault for read or run commands:

1. **`--vault <path>` flag** — exact path, used as-is (`path.resolve`d)
2. **`--name <name>` flag** — `<app-data>/envs/<name>.env.vault`
3. **No flag** — auto-detect, in this order:
   a. **Walk-up for `.env.vault`** — starting at the CWD, check each directory
   for `.env.vault`, moving toward ancestors. The walk is **bounded by the
   git root** (the nearest ancestor containing a `.git`), inclusive of that
   boundary directory. The first match wins. If the CWD is **not** inside a
   git repository, only the CWD itself is checked — the walk does not ascend.
   (This subsumes the old "`./.env.vault`" rule as its first iteration.)
   b. `./config/.env.vault` — checked **after** the walk-up, relative to the
   CWD only (not walked up).
   c. `<app-data>/envs/<dirname>.env.vault` — app data by CWD dirname, only if
   it already exists.
4. If no vault found → error with suggestion to use `--vault` or `--name`.

> **Walk-up rationale (§16.6).** Running a `vault env` command from a
> subdirectory of a monorepo finds the project-root vault without needing
> `--vault`. The git-root boundary keeps the search from escaping the project
> (it never walks above the repository), and the no-`.git` fallback keeps the
> behavior predictable outside a repo (CWD only).
>
> Note: discovery (steps 3a–3c above) is used by **read/run** commands. The
> **creation** default (`init` with no flag) is always
> `<app-data>/envs/<dirname>.env.vault` — it does not walk up. See §5.1.

The `<app-data>` path follows the same convention as the main vault:

| Platform | Path                                                          |
| -------- | ------------------------------------------------------------- |
| macOS    | `~/Library/Application Support/secure-password-manager/envs/` |
| Windows  | `%APPDATA%/secure-password-manager/envs/`                     |
| Linux    | `~/.secure-password-manager/envs/`                            |

The `<dirname>` is the basename of the current working directory, sanitized to
`[a-z0-9_-]`.

### 5.3 Example Resolutions

| CWD             | Flags / context                                                          | Resolved Path                             |
| --------------- | ------------------------------------------------------------------------ | ----------------------------------------- |
| `/app`          | `--name superxpnse-be`                                                   | `<app-data>/envs/superxpnse-be.env.vault` |
| `/app`          | `--vault ./project.env.vault`                                            | `/app/project.env.vault`                  |
| `/app`          | _(none, creates)_                                                        | `<app-data>/envs/app.env.vault`           |
| `/app`          | `--vault ~/team/shared.env.vault`                                        | `~/team/shared.env.vault`                 |
| `/repo/svc/api` | _(none; `/repo/.git` and `/repo/.env.vault` exist)_                      | `/repo/.env.vault` (found by walk-up)     |
| `/repo/svc/api` | _(none; `/repo/.git` exists, `/repo/svc/api/.env.vault` exists)_         | `/repo/svc/api/.env.vault` (nearest wins) |
| `/tmp/loose`    | _(none; no `.git` anywhere up the tree, no `./.env.vault`)_              | falls through to `./config` then app-data |
| `/repo/svc`     | _(none; `/repo/.git` exists, only `/repo/svc/config/.env.vault` exists)_ | `/repo/svc/config/.env.vault`             |

### 5.4 Backup Files

The service creates timestamped backups on destructive operations:

| Path                             | Purpose                                    |
| -------------------------------- | ------------------------------------------ |
| `.env.vault`                     | Active encrypted file                      |
| `.env.vault.bak`                 | Previous good state (before last mutation) |
| `.env.vault.deleted.<timestamp>` | Preserved copy on deletion                 |

---

## 6. CLI Reference

### 6.1 Commands

#### 6.1.1 Argument Convention

Commands fall into two families that take the target environment differently.
This split is intentional — see §6.1.3 for the rationale.

- **Var-level** commands operate on a single key inside an environment. They take
  the **key as the positional** and the environment as a `-e, --env <name>` flag
  (resolved as `-e` → `VAULT_ENV`, else error): `set`, `get`, `rm`, plus
  `rollback` (positional is the version number) and `squash` (no positional).
- **Env-level** commands operate on a whole environment. They take the
  **environment name as a positional**. Single-target read/inspect commands
  (`show`, `history`, `validate`, `export`, `template`) resolve the positional
  from `VAULT_ENV` when omitted, and error if neither is given; multi-target or
  destructive commands (`delete`, `rename`, `copy`, `diff`, `import`) require the
  positional. There is no implicit `"default"` environment.

#### 6.1.2 Command Tree

```
vault env
  ├── init [--name <name>]            Initialize a new environment vault
  │     [--env <name>:<file>]         (optionally import .env files)
  │
  │   ── var-level (key positional; -e <env> or VAULT_ENV; required) ──
  ├── set <key> <value> [-e <env>]    Set a key (creates new version)
  │     [--public] [--required]       (--public = non-sensitive; --required = checked by validate)
  │     [--message <text>]
  ├── get <key> [-e <env>]            Get a single value
  │     [--clip] [--pair]             (--clip copies value; --pair copies KEY=VALUE)
  ├── rm  <key> [-e <env>]            Remove a key (creates new version)
  ├── rollback <version> [-e <env>]   Rollback to a previous version
  ├── squash [-e <env>] [--keep <n>]  Squash version history
  │
  │   ── env-level ([env] = positional or VAULT_ENV; required — no implicit "default") ──
  ├── list                            List all environments
  ├── show     [env]                  Show env details (sensitive values masked)
  ├── history  [env]                  Show version history
  ├── validate [env] [--strict]       Validate environment
  ├── export   [env] [--format ...]   Export as .env / JSON to stdout
  ├── template [env]                  Export keys-only placeholder file
  │
  │   ── env-level (env positional REQUIRED) ──
  ├── delete <env>                    Delete an entire environment
  ├── rename <oldName> <newName>      Rename an environment
  ├── copy   <src> <dst>              Copy an environment to a new name
  ├── diff   <envA> <envB>            Show diff between two environments
  ├── import <env> <file...>          Import .env file(s) into an environment
  ├── run    [env] [--] <cmd>...      Run command with env injected
  ├── shell  [env]                    Open interactive shell with env loaded
  │
  └── change-password                 Re-encrypt the vault with a new password
```

#### 6.1.3 Rationale: var-level vs env-level (resolves §16.1–16.3)

The original draft of this spec showed every command as env-first
(`set <env> <key>=<value>`). The implementation instead splits commands by
the unit they act on, and this section codifies that as the canonical contract
(option (b) from §16.1):

- Var-level ops (`set`/`get`/`rm`) keep the key as the positional because it
  changes on every call, while the environment — which usually stays constant
  across a run of commands — is a flag. Set `VAULT_ENV` once and
  `vault env get API_URL` reads from it with no per-command ceremony.
- `rollback` and `squash` are version operations scoped to one env, so they
  follow the same `-e <env>` convention rather than taking the env positionally.
- Env-level ops take the env positionally because the environment _is_ the
  argument — there is no key to compete for the positional slot.

`KEY=VALUE` is **not** accepted by `set`; the key and value are two separate
positionals (`set <key> <value>`). Examples throughout this document and in
`README.cli.md` follow these shapes.

```

### 6.2 Global Flags

| Flag                    | Default         | Description                                                         |
| ----------------------- | --------------- | ------------------------------------------------------------------- |
| `--vault <path>`, `-v`  | _(auto-detect)_ | Path to `.env.vault` file                                           |
| `--name <name>`, `-n`   | _(dirname)_     | Logical vault name (resolves to `<app-data>/envs/<name>.env.vault`) |
| `--password <password>` | _(prompt)_      | Password string (non-interactive)                                   |
| `--password-file <path>`| _(prompt)_      | Read the password from a file (one trailing newline stripped)       |
| `--password-stdin`      | `false`         | Read the password from stdin (one trailing newline stripped)        |
| `--json`                | `false`         | Output as JSON instead of human-readable                            |
| `--quiet`               | `false`         | Suppress non-error output                                           |

#### 6.2.1 Password Resolution

The master password is resolved from the first available source, in this
precedence order:

| # | Source                  | Notes                                                          |
| - | ----------------------- | -------------------------------------------------------------- |
| 1 | `--password <password>` | Highest precedence. An empty string (`--password ""`) counts as provided. |
| 2 | `--password-file <path>`| File contents, with a single trailing `\n` or `\r\n` stripped. |
| 3 | `--password-stdin`      | Reads fd 0, with a single trailing newline stripped.           |
| 4 | `VAULT_ENV_PASSWORD`    | Environment variable. A fallback, **not** subject to the mutual-exclusion rule below. |
| 5 | Interactive prompt      | Masked, no echo (`@inquirer/password`). Used only when nothing above is set. |

**Mutual exclusion.** At most one of the three explicit flags (`--password`,
`--password-file`, `--password-stdin`) may be supplied. Passing two or more is a
usage error. `VAULT_ENV_PASSWORD` is exempt — it is only consulted when no
explicit flag is present, so combining it with a flag is allowed (the flag
wins).

**Failure modes and exit codes.** All password-resolution failures exit `1` and
print to stderr (see Appendix B for the codes):

| Condition                                              | Exit | stderr message                                                            |
| ------------------------------------------------------ | ---- | ------------------------------------------------------------------------- |
| Two or more explicit flags supplied                    | 1    | `Error: choose only one of --password, --password-file, --password-stdin` |
| `--password-file` points at a missing/unreadable file  | 1    | `Error: cannot read password file "<path>": <detail>`                     |
| `--password-stdin` with closed/errored stdin           | 1    | `Error: cannot read password from stdin: <detail>`                        |
| Password resolved but wrong for the vault              | 1    | `ENV_VAULT_DECRYPT_FAILED` (from vault load, not resolution)              |

> Note: all four currently use exit `1`. Distinct numeric exit codes per
> failure class are a possible CI-hardening follow-up (tracked in §16.5).

### 6.3 Command Details

#### `vault env init`

```

USAGE
vault env init [--name <name>] [--vault <path>]
[--env <env-name>:<file-path>]...
[--description <text>]

FLAGS
--name <name> Logical vault name. Creates <name>.env.vault in app data.
Defaults to CWD directory basename if omitted.
--vault <path> Exact file path (overrides app data default).
--env <name>:<file> Import a .env file as an environment. Repeatable.
Parses KEY=VALUE lines, creates version 1.
--description <text> Optional description for the vault.

DESCRIPTION
Creates a new encrypted .env.vault. Prompts for a new password and
confirmation. Password strength is validated (min 8 chars, mixed case + digits).

When `--env` is provided, each file is parsed and imported as a named
environment (version 1). Lines starting with `#` are treated as comments
and ignored. Empty lines are skipped. Both `KEY=value` and `export KEY=value`
formats are supported.

Without `--env`, the vault is created empty. Use `vault env set` to add
environments later.

EXAMPLES

# Empty vault, default name (CWD dirname), stored in app data

vault env init

# Named vault in app data

vault env init --name superxpnse-be

# Named vault with two environments imported from .env files

vault env init --name superxpnse-be \
 --env dev:.env.development \
 --env prod:.env.production

# Custom location

vault env init --vault ./config/project.env.vault

# Import and describe

vault env init --name myapp --env staging:.env.staging \
 --description "Team-shared env vault for MyApp"

```

#### `vault env set`

```

USAGE
vault env set <key> <value> [-e <env>] [--vault <path>]

FLAGS
-e, --env <name> Environment to write to (or VAULT_ENV; required)
--public Mark this var as non-sensitive (shown unmasked in `show`)
--required Mark this var as required (checked by `validate`)
--message <text> Optional version message

DESCRIPTION
Creates a new version of the target env with the key added or updated.
If the env doesn't exist, creates it as a new environment.
The <value> may contain a template reference.

By default, every var is **sensitive** — its value is masked in `show` output.
Use `--public` to mark a var as non-sensitive (e.g., API URLs, ports).
Non-sensitive vars are displayed in full in `show` and included in `template`.

EXAMPLES
vault env set API_URL https://staging.example.com -e staging --public
vault env set API_KEY sk-abc123 -e staging --message "Rotate API key"
vault env set DB_URL "{{env:base/DB_URL}}" -e staging # template ref
vault env set PORT 3000 -e dev # writes to the "dev" env

```

#### `vault env show`

```

USAGE
vault env show [env] [--vault <path>] [--json]

DESCRIPTION
Displays environment metadata and all keys.
**Sensitive** values are masked (show first/last 4 chars).
**Non-sensitive** values are shown in full (see `vault env set --public`).
Use --json for machine-readable output.

OUTPUT EXAMPLE
Environment: staging
Description: (none)
Active version: 3 of 5
Created: 2026-05-15
Updated: 2026-05-30
Extends: base

Keys:
API_URL ✓ https://staging.example.com ← non-sensitive, shown fully
API_KEY ▸ sk_a\***\*\*\*\*\***123
DB_URL ▸ postgres://s**\*\*\***/db

```

#### `vault env get`

```

USAGE
vault env get <key> [-e <env>] [--vault <path>] [--clip] [--pair]

FLAGS
-e, --env <name> Environment to read from (or VAULT_ENV; required)
--clip Copy the value to system clipboard instead of printing to stdout
--pair Copy the full KEY=VALUE string to system clipboard

DESCRIPTION
Prints the resolved value of a single key to stdout.
When `--clip` is used, the value is written to the system clipboard
(pbcopy on macOS, xclip/wl-copy on Linux, clip on Windows).
When `--pair` is used, copies KEY=VALUE instead of just the value.

Sensitive vs non-sensitive does not matter here — the value is revealed
either way (you already authenticated by unlocking the vault).

EXAMPLES
vault env get API_URL -e staging

# → https://staging.example.com

vault env get API_KEY -e staging --clip

# (copied to clipboard, no stdout output)

vault env get API_KEY -e staging --pair

# (copies "API_KEY=sk-abc123" to clipboard)

```

#### `vault env history`

```

USAGE
vault env history [env] [--vault <path>] [--json]

OUTPUT EXAMPLE
Version Created Message
1 2026-05-15 10:00 Initial setup
2 2026-05-20 14:30 Add DB_URL
3 2026-05-25 09:00 Rotate API key ← active
4 2026-05-30 11:00 Add staging URL ← rolled back
5 2026-05-30 14:00 (unlabeled)

```

#### `vault env rollback`

```

USAGE
vault env rollback <version> [-e <env>] [--vault <path>]

FLAGS
-e, --env <name> Environment to roll back (or VAULT_ENV; required)

DESCRIPTION
Rolls back to a previous version by creating a NEW version whose vars
match the target version. The rolled-back versions remain in history.

Example: env has versions [v1, v2, v3(active)]
`rollback 1 -e staging` → [v1, v2, v3, v4(active=v1 copy)]

Use `history` to see version numbers. Version `1` is always the oldest.
To undo a rollback, rollback again to the version before it.

```

#### `vault env run`

```

USAGE
vault env run [env] [--vault <path>]
[--inject clean|merge|file]
[--out-file <path>]
[--allowlist <comma-separated-vars>]
[--allowlist-file <path>]
[--dry-run]
[--] <command>...

FLAGS
--inject <mode>
clean (default) Only vault vars + allowlisted system vars (PATH, HOME, SHELL, USER, TMPDIR)
merge Vault vars merged into inherited process.env
file Write --out-file, spawn, then securely delete the file

--out-file <path>
Path to write a temporary .env file. Required when --inject=file.
The file is created 0600 before spawn and securely deleted after child exits.

--allowlist <vars>
Additional system vars to allow through in clean mode (comma-separated).

--allowlist-file <path>
File of vars to allow through in clean mode (one per line, # comments).
Defaults to .vault-allowlist in CWD if present; explicit path must exist.

--dry-run
Print the resolved environment without spawning the command.
Vault vars are marked with '+'; sensitive values are masked as \*\*\*\*.

ENV VARS
VAULT_ENV Default environment name (overridden by positional arg or .vaultrc)
VAULT_NAME Default vault name (overridden by --name or .vaultrc)
VAULT_INJECT Default inject mode (overridden by --inject or .vaultrc)

Precedence: CLI flag > .vaultrc > env var > built-in default.

PROJECT CONFIG (.vaultrc)
A .vaultrc JSON file at the project root (walks up to git root) sets defaults
for any of: inject, env, name, vault, allowlistFile.

DESCRIPTION
Decrypts the env vault, resolves templates, validates required vars,
and spawns the command with environment variables injected according to
the --inject mode. The child process inherits stdio.

On exit, all temp files are securely deleted and decrypted data is zeroed.

EXAMPLES

# Inject env vars into npm start (clean mode)

vault env run development -- npm start

# Merge mode for tools that need full parent env

vault env run development --inject merge -- npx react-native run-ios

# Temp .env file for react-native-config build

vault env run staging --inject file --out-file .env -- npx react-native run-ios

# Clean mode with additional system vars allowed

vault env run production --allowlist NODE_PATH,LANG -- npm run build

# Allow extra vars via file

vault env run production --allowlist-file .vault-allowlist -- npm run build

# Preview what would be injected

vault env run staging --dry-run

# Use VAULT_ENV (useful in CI)

VAULT_ENV=staging vault env run -- node server.js

```

#### `vault env shell`

```

USAGE
vault env shell [env] [--vault <path>]
[--inject clean|merge]
[--allowlist <comma-separated-vars>]
[--allowlist-file <path>]

FLAGS
--inject <mode>
clean (default) Only vault vars + allowlisted system vars
merge Vault vars merged into inherited process.env
(file mode is not supported for interactive shells)

--allowlist / --allowlist-file
Same semantics as vault env run.

ENV VARS / PROJECT CONFIG
Same resolution as vault env run (VAULT_ENV, VAULT_NAME, VAULT_INJECT, .vaultrc).

DESCRIPTION
Opens an interactive subshell ($SHELL) with the vault environment loaded.
Sets VAULT_SHELL=1 and VAULT_SHELL_ENV=<envName> so prompt integrations
(starship, oh-my-zsh, etc.) can indicate the active vault context.

Type 'exit' or Ctrl-D to return to the parent shell.

EXAMPLES

# Drop into a shell with the staging env loaded

vault env shell staging

# Use merge mode to keep your full dev environment

vault env shell dev --inject merge

```

#### `vault env export`

```

USAGE
vault env export [env] [--vault <path>] [--format dotenv|json]

DESCRIPTION
Decrypts, resolves templates, and outputs the environment in the
requested format to stdout. Suitable for piping or redirecting.

EXAMPLES

# Create a plain .env file (one-time, non-secure export)

vault env export staging > .env.staging

# Pipe into Docker Compose

vault env export production --format json | docker compose --env-file /dev/stdin up

# Feed into CI pipeline

vault env export production > .env # SECURITY: delete after use!

```

#### `vault env template`

```

USAGE
vault env template [env] [--vault <path>] [--clip]

DESCRIPTION
Outputs a .env.example-style file with keys only and placeholder values.
Ideal for documenting required variables without exposing secrets.

OUTPUT
API_URL=<required>
API_KEY=<required>
DB_URL=<required>

```

#### `vault env validate`

```

USAGE
vault env validate [env] [--vault <path>] [--strict]

FLAGS
--strict Fail on warnings, not just errors

DESCRIPTION
Validates the environment without executing anything. Checks:

- All required keys present after template resolution
- No unresolved template references
- No circular extends chains
- No circular template refs
- All values are strings (not objects/arrays)
- No keys that look suspicious (hex secrets, private keys in non-required)

EXIT CODES
0 Validation passed
1 Validation failed (errors)
2 Validation passed with warnings (requires --strict to fail)

OUTPUT EXAMPLE
✓ staging: 12 vars, 3 required
✓ extends chain: staging → base (2 levels)
✓ All template references resolve
! Non-standard key name: "my-api-key" (expected UPPER_CASE)

```

#### `vault env diff`

```

USAGE
vault env diff <env-a> <env-b> [--vault <path>]

DESCRIPTION
Compares the resolved active versions of two environments.
Shows added, removed, changed, and unchanged keys.

OUTPUT EXAMPLE
── staging → production ──

Added: + SENTRY_DSN

Removed: - DEBUG

Changed:
API_URL https://staging.example.com → https://example.com
API_KEY [masked] → [masked]

Unchanged (8)

```

#### `vault env import`

```

USAGE
vault env import <env> <file...> [--name <name>] [--vault <path>]

DESCRIPTION
Imports one or more .env files into an environment of an existing vault.
The environment name is the first positional; one or more file paths follow.
Parses KEY=VALUE lines (skips comments, blank lines, supports `export` prefix).
Creates a new version with all vars from the file(s).

If the environment doesn't exist yet, it is created.

(Note: the `<env>:<file>` prefix form is only used by `init --env`; the
standalone `import` command takes the env as a separate positional.)

EXAMPLES
vault env import staging .env.staging --name superxpnse-be
vault env import development .env.local --name myapp

# Import multiple files into one environment

vault env import prod .env.production .env.secrets --name superxpnse-be

```

#### `vault env squash`

```

USAGE
vault env squash [-e <env>] [--keep <n>] [--vault <path>]

FLAGS
-e, --env <name> Environment to squash (or VAULT_ENV; required)
--keep <n> Number of versions to keep after squashing (default: 1)

DESCRIPTION
Compresses the version history of an environment by merging older versions
into a single version. This is useful for cleaning up noisy history or
reducing file size after many iterative changes.

The squashed version preserves the **vars of the most recent version**
in the squashed range. All versions outside the kept window are collapsed
into version 1. Remaining versions are renumbered sequentially.

Example with --keep 2:
Before: [v1, v2, v3, v4, v5]
After: [v1(squashed=v3), v2(=v4), v3(=v5)]
Kept: v3, v4, v5 → renumbered as 1, 2, 3

Example with --keep 1 (default):
Before: [v1, v2, v3]
After: [v1(squashed=v3)]
All history collapsed to one version.

Squashing is irreversible — create a backup first if you might need the
full history later.

EXAMPLES

# Squash everything to a single version

vault env squash -e staging

# Keep the last 3 versions, squash everything older

vault env squash -e staging --keep 3

```

#### `vault env change-password`

```

USAGE
vault env change-password [--vault <path>]

DESCRIPTION
Re-encrypts the entire vault with a new password.
Prompts for current password, then new password + confirmation.

```

---

## 7. Key Flows

### 7.1 First-Time Setup

```

User CLI Filesystem
│ │ │
├─ vault env init ───→│ │
│ ├─ prompt password ──→ │
│←─ enter password ───┤ │
│ ├─ generate salt │
│ ├─ derive key │
│ ├─ create empty payload │
│ ├─ encrypt │
│ ├─ write .env.vault ───→ │
│←─ "Created" ────────┤ │
│ ├─ prompt environment? │
│←─ "No, later" ──────┤ │
│ │ │
├─ vault env set ────→│ │
│ KEY VAL -e staging ├─ prompt password ──→ │
│←─ enter password ───┤ │
│ ├─ decrypt .env.vault │
│ ├─ add environment │
│ │ & version │
│ ├─ re-encrypt │
│ ├─ write .env.vault ───→ │
│←─ "Set" ────────────┤ │

```

### 7.2 CLI Runner (clean mode)

```

User CLI Child Process
│ │ │
├─ vault env run ────→│ │
│ staging -- npm run │ │
│ build │ │
│ │ │
│←─ prompt password ──┤ │
├─ enter ────────────→│ │
│ ├─ decrypt .env.vault │
│ ├─ resolve templates │
│ ├─ validate required │
│ ├─ build env object │
│ │ { API_URL, API_KEY } │
│ │ + allowlist: PATH, │
│ │ HOME, USER, SHELL, │
│ │ TMPDIR │
│ │ │
│ ├─ spawn ──────────────→│ npm run build
│ │ (env: merged) │
│ │ │
│ │←─ exit code ───────────┤
│ ├─ zero memory │
│←─ exit code ────────┤ │

```

### 7.3 CLI Runner (file mode for build tools)

```

User CLI Filesystem Child Process
│ │ │ │
├─ vault env run ────→│ │ │
│ staging --env-file │ │ │
│ .env -- react- │ │ │
│ native run-ios │ │ │
│ ├─ decrypt vault │ │
│ ├─ resolve templates │ │
│ ├─ write .env ──────────→│ │
│ │ (chmod 600) │ │
│ │ │ │
│ ├─ set REACT*NATIVE* │ │
│ │ ENV_PATH=.env │ │
│ │ │ │
│ ├─ spawn ───────────────→│──── .env ─────────→│
│ │ │ │
│ │ │←──── exit ─────────┤
│ ├─ secure delete .env ──→│ │
│ │ (overwrite + unlink) │ │
│←─ exit code ────────┤ │ │

```

### 7.4 Rollback

```

vault env history staging

Version 1: API_URL=http://old.example.com
Version 2: API_URL=http://new.example.com ← active

vault env rollback 1 -e staging

── Creates Version 3, copying Version 1's vars ──

Version 1: API_URL=http://old.example.com
Version 2: API_URL=http://new.example.com
Version 3: API_URL=http://old.example.com ← now active (copy of v1)

vault env set API_URL http://fixed.example.com -e staging

Version 4: API_URL=http://fixed.example.com ← now active

```

Rollback never destroys history. It creates a new version whose vars match the
target version. This ensures all changes are auditable.

---

## 8. Template Reference System

### 8.1 Grammar

```

ref = '{{' source ':' path '}}'

source = 'env' ── references another env within the same vault
| 'vault' ── references an entry in the main vault (v2+)

path = segment ('/' segment)\*

segment = [a-zA-Z0-9._-]+

```

### 8.2 Reference Types

| Pattern                          | Resolution Target                         | Scope |
| -------------------------------- | ----------------------------------------- | ----- |
| `{{env:name/VAR_NAME}}`          | Another environment's resolved `VAR_NAME` | v1    |
| `{{env:self/VAR_NAME}}`          | Same environment's resolved `VAR_NAME`    | v1    |
| `{{vault:entries/<id>/<field>}}` | Main vault entry's field                  | v2+   |
| `{{vault:meta/username}}`        | Vault metadata                            | v2+   |

### 8.3 Resolution Rules

1. **Order**: Layering is resolved first, then template refs.
2. **Scope**: Template refs are resolved against the **layered** variables (after `extends` merge).
3. **Recursion**: Values are scanned for `{{...}}` patterns. If a resolved value itself contains a ref, resolve again (max depth = 5).
4. **Cycle detection**: A cycle (A → B → A) is detected and reported as an error.
5. **Forward refs**: Allowed. Environment B can reference environment A even if A is defined after B in the file.
6. **Self-refs**: `{{env:self/KEY}}` allows aliasing within the same env. Forms a trivial cycle if KEY references itself — this is detected and blocked. `self` is a reserved environment name (see §4.5) so it can never be shadowed by a real environment.
7. **Missing source**: If `{{env:MISSING/KEY}}` references a non-existent environment, fail with `"Environment 'MISSING' not found"`.
8. **Missing key**: If `{{env:staging/MISSING}}` references a key not in staging, fail with `"Key 'MISSING' not found in environment 'staging'"`.

### 8.4 Reference Resolution Algorithm

```

function resolve(input, environments, visited = new Set(), depth = 0):
if depth > 5: throw MaxDepthError
for each {{...}} match in input:
key = extract_ref(match) // e.g., "env:staging/API_URL"
if key in visited: throw CycleError
visited.add(key)
source = parse(key) // { type: "env", env: "staging", var: "API_URL" }
if type is "env":
target = environments[source.env]
value = target.getResolvedVar(source.var)
resolved = resolve(value, environments, visited, depth + 1)
input = input.replace(match, resolved)
if type is "vault":
// v2+: resolve from main vault
return input

```

---

## 9. Environment Layering

### 9.1 `extends` Field

Each environment can define `extends: "<env-name>"` or `extends: null`.

```

"staging": {
"extends": "base",
"versions": [...]
}

```

### 9.2 Merge Semantics

```

resolved(env) = merge( resolve(env.extends), env.activeVersion.vars )

````

- Variables in `env` override those in `env.extends`.
- Template refs are resolved **after** the merge.
- An environment cannot extend itself (detected, error).
- Chain length is limited to 5 environments.

### 9.3 Example

```json
{
  "base": {
    "vars": { "LOG_LEVEL": "info", "PORT": "3000", "NODE_ENV": "base" }
  },
  "staging": {
    "extends": "base",
    "vars": { "API_URL": "https://staging.example.com", "NODE_ENV": "staging" }
  },
  "production": {
    "extends": "base",
    "vars": { "API_URL": "https://example.com", "NODE_ENV": "production" }
  }
}

// Resolved staging:
//   LOG_LEVEL=info       (from base)
//   PORT=3000            (from base)
//   NODE_ENV=staging     (overridden by staging)
//   API_URL=https://staging.example.com  (from staging)

// Resolved production:
//   LOG_LEVEL=info       (from base)
//   PORT=3000            (from base)
//   NODE_ENV=production  (overridden)
//   API_URL=https://example.com  (from production)
````

### 9.4 Chained Extends

```
production extends staging extends base

// Resolved: merge(base, staging.vars, production.vars)
// Chain: production → staging → base (max 5)
```

### 9.5 `required` Aggregation

When extending, `required` keys from all ancestors are combined:

```
base:     required: ["LOG_LEVEL"]
staging:  required: ["API_URL"]   extends: base
// Effective required: ["LOG_LEVEL", "API_URL"]
```

---

## 10. Validation Engine

### 10.1 Checks

| Check                  | Error/Warn | Description                                                                                |
| ---------------------- | ---------- | ------------------------------------------------------------------------------------------ |
| Required keys present  | Error      | Every key in `required` exists after template resolution                                   |
| Template refs resolve  | Error      | All `{{...}}` refs point to existing sources                                               |
| Circular extends       | Error      | `A extends B extends A` (cycle detected)                                                   |
| Circular template refs | Error      | `A → B → A` (cycle detected)                                                               |
| Values are strings     | Error      | No nested objects or arrays                                                                |
| Key format             | Warning    | Non-uppercase keys flagged (`myKey` → `MY_KEY`)                                            |
| Suspicious values      | Warning    | Values matching private key patterns (`-----BEGIN`, `sk_live_`, etc.) in non-required vars |
| Max chain depth        | Error      | `extends` chain > 5                                                                        |

### 10.2 Exit Codes

| Code | Meaning                                                  |
| ---- | -------------------------------------------------------- |
| 0    | All checks pass                                          |
| 1    | Errors found                                             |
| 2    | No errors, but warnings found (only fails if `--strict`) |

### 10.3 Strict Mode

With `--strict`, warnings are promoted to errors and the command fails.

---

## 11. Injection Modes

### 11.1 Clean Mode (Default)

```
cleanEnv = {
  ...allowlist,       // PATH, HOME, SHELL, USER, TMPDIR + custom --allowlist
  ...vaultEnv         // resolved env vars from the vault
}
```

- System vars on the allowlist are inherited from the parent process.
- All other parent env vars are stripped.
- Vault vars override allowlist vars if there's a collision.

### 11.2 Merge Mode

```
mergedEnv = {
  ...process.env,     // all parent env vars
  ...vaultEnv         // vault vars override parent
}
```

- Full inheritance of parent environment.
- Vault vars take precedence.

### 11.3 File Mode

```
1. Resolve vault path
2. Decrypt vault, resolve env
3. Write .env file at --env-file path (chmod 600)
4. Build child env:
     cleanEnv (or mergedEnv if --inject merge)
     + ENV_FILE_PATH=<path>   // set so child tools can locate it
5. Spawn child
6. On child exit:
     a. Overwrite file with random data (3 passes)
     b. Unlink file
     c. Zero decrypted data in memory
```

The `ENV_FILE_PATH` env var allows tools that accept an env file path to find it.

---

## 12. Security Model

### 12.1 Encryption

- **Algorithm**: AES-256-GCM (authenticated encryption)
- **Key derivation**: PBKDF2 with SHA-512, 100,000 iterations, 32-byte key
- **Salt**: 32 random bytes, regenerated on every write
- **IV**: 16 random bytes per encryption
- **Authentication**: GCM authentication tag prevents tampering
- Reuses existing `CryptographyService` unchanged.

### 12.2 Memory Safety

- Decrypted payload is held in a plain JavaScript object.
- After use (child exit, command completion), variables holding sensitive data
  are set to `null` or re-assigned.
- For Node.js, `Buffer.fill(0)` is used where possible.
- Long-running operations (agent mode) run in a forked child process that can
  be killed to fully reclaim memory.

### 12.3 Temp File Cleanup

When `--inject file` or `--env-file` is used:

1. File is created with `fs.open(path, 'w', 0o600)` — owner read/write only.
2. On child exit (success or failure):
   a. Overwrite with random bytes (3 passes: 0xFF, 0x00, random).
   b. `fs.unlinkSync(path)`.
3. If the parent process is killed with SIGKILL, the OS will clean up temp files
   on reboot. A cleanup routine on next `vault env` command scans for orphaned
   temp files and removes them.

### 12.4 Logging

- Never log env var **values** (only keys are logged).
- Never print password input to stdout/stderr.
- Error messages for template resolution report the reference but not the
  resolved value (e.g., `"Reference {{env:staging/API_KEY}} could not be resolved"`).
- Debug mode (`--debug`) logs reference paths but not values.

### 12.5 Password Prompt

- Passwords are read via `@inquirer/password` (masked input, no echo).
- Non-interactive sources — `--password`, `--password-file`, `--password-stdin`,
  and the `VAULT_ENV_PASSWORD` env var — are resolved by precedence; see §6.2.1
  for the full order, mutual-exclusion rule, and exit codes.
- `VAULT_ENV_PASSWORD` and `--password` expose the secret to the process table /
  shell history; prefer `--password-file` (mode `600`) or `--password-stdin` in
  CI, and unset the env var immediately after use.
- Password is not logged, stored, or retained after the command completes.

### 12.6 Child Process Security

- `--inject clean` mode minimizes leakage: only allowlisted system vars + vault vars.
- The child process runs with the same UID/GID as the parent.
- No file descriptors other than stdio/stdin/stderr are passed to the child
  (spawn with `stdio: 'inherit'`).

---

## 13. Milestones & Roadmap

### 13.1 Milestone Overview

```
v0.5        v1.0          v1.5           v2.0            v2.5            v3.0
│           │             │              │               │               │
Foundation  Developer     Composition    Agent & Mount   Integration     North Star
            CLI
                     ▲               ▲                               ▲
                     │               │                               │
                     MVP            Power User                       Vision
```

> **Legend:** ✅ delivered · ◑ partial (see note) · ☐ not started. Status
> reflects the current implementation as of Revision 6.

### 13.2 v0.5 — Foundation

> **Goal**: Prove the encrypted env vault works. Basic CRUD, import from existing
> `.env` files, clipboard copy.

**Status:** ✅ Delivered.

| Deliverable                            | Description                                                             |
| -------------------------------------- | ----------------------------------------------------------------------- |
| `EnvironmentVault` model               | Data model with environments, versions, vars, `nonSensitive`            |
| `EnvironmentVaultService`              | Encrypt/decrypt wrapper, CRUD operations, password management           |
| `vault env init`                       | Create a new `.env.vault` with `--name` and `--env` flags               |
| `vault env import`                     | Import existing `.env` files into an environment                        |
| `vault env set` with `--public`        | Mark vars as non-sensitive                                              |
| `vault env get` with `--clip`/`--pair` | Copy values to system clipboard                                         |
| `vault env set`, `get`, `rm`, `show`   | Basic key manipulation                                                  |
| `vault env list`                       | List environment names                                                  |
| `vault env export`                     | Decrypt and print to stdout in `.env` format                            |
| `--name` / `--vault` resolution        | App-data-first storage, named vault files                               |
| Single environment                     | No versioning, no templates, no layering; just one active state per env |
| Integration test                       | Full round-trip: init → set → export → clipboard → verify               |

**Dependencies**: None (uses only `CryptographyService` which exists).

**Exit criteria**: `vault env init --name myproject --env staging:.env.staging` creates
the vault, and `vault env get staging API_URL --clip` copies the value to clipboard.

---

### 13.3 v1.0 — Developer CLI (MVP)

> **Goal**: The primary workflow — `vault env run` — works. Versioning is reliable.
> This is the first version suitable for daily use.

**Status:** ✅ Delivered.

| Deliverable                               | Description                                                                                                            |
| ----------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| ✅ `vault env run` (`clean\|merge\|file`) | Full CLI runner with all injection modes (`--env-file` exposed as `--out-file`)                                        |
| ✅ Environment versioning                 | Multiple versions per env; `history`, `rollback`                                                                       |
| ✅ `vault env squash`                     | Compress version history with `--keep`                                                                                 |
| ✅ `vault env template`                   | `.env.example` export                                                                                                  |
| ✅ `vault env validate`                   | Required keys check (expanded in v1.5)                                                                                 |
| ✅ `vault env diff`                       | Diff between two environments                                                                                          |
| ✅ `vault env change-password`            | Re-encrypt with new password                                                                                           |
| ✅ `vault env copy` / `rename`            | Duplicate / rename an environment                                                                                      |
| ✅ Temp file cleanup                      | 3-pass overwrite (0xFF, 0x00, random) with orphan temp dir scan on startup                                             |
| ✅ Discovery                              | App-data-first, walk-up, `--name` / `--vault` resolution                                                               |
| ✅ `--json` flag                          | Machine-readable output for `show`, `list`, `history`, `diff`                                                          |
| ✅ Error messages                         | Distinct exit codes (2–14) with symbolic emission (`[ENV_VAULT_NOT_FOUND]`, `[VALIDATION_ERROR]`, etc.) per Appendix B |

**Dependencies**: v0.5

**Exit criteria**: A React Native developer can run `vault env run staging --env-file .env -- npx react-native run-ios` with no plaintext `.env` on disk afterward. CI user can run `vault env validate prod --strict` in a pre-deploy hook.

---

### 13.4 v1.5 — Composition

> **Goal**: Power-user features for complex projects with multiple environments.

**Status:** ✅ Delivered (`EnvironmentResolver` + backup safety net).

| Deliverable                         | Description                                                                                                |
| ----------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| ✅ `extends` / environment layering | `staging extends base` merge; set via `vault env extends`, `--extends` on `set`/`init`. `self` is reserved |
| ✅ Template refs `{{env:name/KEY}}` | Cross-environment + `{{env:self/KEY}}` references, resolved on read by `run`/`export`/`get`/`diff`         |
| ✅ Full validation engine           | Template resolution, cycle detection (template + extends), depth cap, aggregated `required`, secret-scan   |
| ✅ `vault env validate --strict`    | Warnings promoted to errors (exit 0/1/2 per §10.2)                                                         |
| ✅ App-data fallback path           | Auto-discovery to `<app-data>/envs/<dirname>.env.vault`                                                    |
| ✅ Environment `description` field  | Human-readable labels                                                                                      |
| ✅ `--message` on `set`             | Version messages for history clarity                                                                       |

**Dependencies**: v1.0

**Also delivered here (beyond the original scope):** write-time `<vault>.bak` +
atomic rename so an interrupted save cannot corrupt the vault, a
`<vault>.deleted.<ts>` snapshot on environment deletion (§5.4), a fix for
`export --format json` emitting `util.inspect` output instead of valid JSON,
`--description` on `init`/`set`, `--quiet` global flag, spec-limit enforcement
(§4.5), `show` description/created/updated/extends display, `diff` old→new value
display, `history` table format with date column, 3-pass `secureDelete` + orphan
temp dir cleanup, and distinct error codes with symbolic emission (Appendix B).
Deferred: rotating "keep last 5" backups (§15 Q4) and a `vault env restore`
command (recovery is currently a manual `cp <vault>.bak <vault>`).

**Exit criteria**: A team can define `base → staging → production` with template refs and layering, validate all three, and run any of them. ✅ Verified end-to-end.

---

### 13.5 v2.0 — Agent & Mount

> **Goal**: Long-running dev server support with persistent file mounts.

**Status:** ☐ Not started.

| Deliverable                           | Description                                               |
| ------------------------------------- | --------------------------------------------------------- |
| `vault env agent start\|stop\|status` | Background daemon with session-based unlock               |
| Session auto-lock                     | Lock on inactivity timeout (configurable, default 30 min) |
| `vault env agent lock\|unlock`        | Manual session control                                    |
| `vault env mount <env> --path <file>` | Write + maintain a temp `.env` at the given path          |
| File watch                            | Re-create mounted file if deleted externally              |
| `vault env agent mounts`              | List active mounts                                        |
| Secure shutdown                       | All mounted files wiped on agent stop                     |
| macOS launchd integration             | Plist for auto-start on login                             |

**Dependencies**: v1.5

**Exit criteria**: A developer starts the agent once at the start of the day, mounts their env to `.env`, and the file stays live until they lock or the agent auto-locks.

---

### 13.6 v2.5 — Integration

> **Goal**: Connect the env vault to the main vault and to external systems.

**Status:** ☐ Not started.

| Deliverable                      | Description                                                              |
| -------------------------------- | ------------------------------------------------------------------------ |
| `{{vault:...}}` cross-vault refs | Reference entries in the main password vault                             |
| Multi-vault resolution           | `vault env run` resolves refs across both vaults                         |
| CI/CD export command             | `vault env export --format dotenv --ci` strips comments, outputs cleanly |
| `vault env pull\|push`           | Sync env vault with a remote (SCP, S3, or Git)                           |
| Encrypted `.env.vault` in Git    | Team can commit the encrypted file; password shared out-of-band          |
| Pre-commit hook                  | Warn if `.env` (plaintext) is being committed                            |

**Dependencies**: v2.0

**Exit criteria**: A CI pipeline pulls the env vault from S3, decrypts with `--password` flag, exports to `.env`, and feeds it into a Docker build.

---

### 13.7 v3.0 — North Star (Vision)

> **Goal**: Zero-overhead, zero-trust secrets management for the entire development lifecycle.

**Status:** ☐ Not started.

| Deliverable                    | Description                                                                 |
| ------------------------------ | --------------------------------------------------------------------------- |
| FUSE virtual filesystem        | Environments appear as real files without ever touching disk; no temp files |
| macOS `FileProvider` extension | Native file provider integration for Finder                                 |
| System keychain integration    | Store env vault password in macOS Keychain / Windows Credential Manager     |
| Biometric unlock               | Touch ID / Face ID / Windows Hello for `vault env run`                      |
| VSCode extension               | Inline env resolution, hover to reveal, diff in-editor                      |
| Git-aware auto-switching       | `vault env run` auto-selects env based on current Git branch                |
| Audit log                      | Every access, export, and injection logged to a secure audit trail          |
| Role-based env access          | Team members can unlock only their authorized environments                  |
| Rotating secrets               | Env vars with expiry dates; notification when rotation is due               |
| CI/CD plugins                  | Native GitHub Actions, GitLab CI, CircleCI orb integrations                 |

**Dependencies**: v2.5

**Exit criteria**: A developer opens VSCode, switches to `release-v2` branch, and the env vault auto-mounts the production .env file via FUSE with Touch ID. They never type a password, never see a plaintext secret, and never clean up a file.

---

## 14. North Star / Future Work

Items that didn't fit into the core roadmap but are valuable long-term directions:

### 14.1 FUSE Virtual Filesystem

Instead of writing temp files, create a virtual filesystem where `.env` files
appear as in-memory nodes. This eliminates the (small) window where a temp file
exists on disk.

- macOS: `macFUSE` (requires user to install `macfuse` via Homebrew)
- Linux: `libfuse3` (usually pre-installed)
- Windows: WinFsp or Dokan

Challenge: User must install a kernel extension. Not suitable for everyone.

### 14.2 IDE Integrations

- **VSCode extension**: Inline decoration of `{{env:...}}` refs with resolved values.
  Hover tooltip shows the resolved value. Commands for `vault env run` from the
  command palette.
- **JetBrains plugin**: Similar integration for IntelliJ IDEA, WebStorm, etc.

### 14.3 Git-Aware Environments

Automatically select an environment based on the current Git branch:

```
main        → production
release/*   → staging
feature/*   → development
```

Configured in a `.env-vaultrc` file or `package.json`:

```json
{
  "secureVault": {
    "gitAutoSwitch": {
      "main": "production",
      "release/*": "staging",
      "feature/*": "development"
    }
  }
}
```

### 14.4 Rotating / Expiring Secrets

Allow env vars to have an `expiresAt` timestamp. The validation engine warns
on expired vars. Could integrate with services like AWS Secrets Manager or
HashiCorp Vault for automatic rotation.

### 14.5 Team Sync Protocol

A protocol for syncing env vaults across a team:

```
vault env pull <name> s3://bucket/envs/project.env.vault
vault env push <name> s3://bucket/envs/project.env.vault
```

Encrypted at rest in S3. Team shares the vault password via a secure channel
(1Password shared vault, SOPS, etc.).

### 14.6 CI/CD Integrations

- **GitHub Action**: `vault-env-action` that decrypts and exports env vars for a job
- **GitLab CI template**: Include file that handles decrypt
- **CircleCI orb**: Reusable orb for env injection

### 14.7 Audit Trail

A secure, append-only log of all env accesses:

```json
{
  "timestamp": "2026-05-30T15:00:00Z",
  "action": "export",
  "environment": "production",
  "user": "wbenzid",
  "keys": ["API_URL", "API_KEY"],
  "pid": 12345
}
```

Stored encrypted, signed with a key derived from the vault password.

---

## 15. Open Questions

Questions that need resolution before implementation:

| #   | Question                                              | Options                                      | Recommended                    |
| --- | ----------------------------------------------------- | -------------------------------------------- | ------------------------------ |
| 1   | Should `vault env run` support multiple envs at once? | (a) Single env per run (b) `--env A --env B` | (b) — useful for layering      |
| 2   | Should `extends` cascade `required`?                  | (a) Yes, merge all (b) No, per-env only      | (a) — see §9.5                 |
| 3   | Max version history?                                  | Unlimited, 100, 1000                         | 1000 (with warning at 900)     |
| 4   | Backup strategy for `.env.vault`?                     | Timestamped backups on write, keep last N    | Keep last 5 backups            |
| 5   | Should `vault env export` include comments?           | (a) No (b) Yes, from description fields      | (b) — useful for documentation |
| 6   | Allowlist defaults: which system vars?                | `PATH`, `HOME`, `SHELL`, `USER`, `TMPDIR`    | As listed                      |

> **Resolved by implementation (Rev 6):** Q2 → (a) — `required` is aggregated
> across the extends chain (§9.5). Q4 → partial — writes keep a single
> previous-good `.bak` with atomic rename, plus a `.deleted.<ts>` snapshot on
> environment deletion; rotating "keep last N" is deferred. Q3/Q6 match the
> implemented limits/allowlist. **Still open:** Q1 (multi-env `run`) and Q5
> (`export` comments from `description`).

---

## 16. Known Issues & Pending Reconciliations

Items discovered during implementation or end-to-end validation that are not
yet resolved. Unlike §15 (open questions about design), each item here is a
concrete divergence between docs, code, or stated behavior — each needs to
be **fixed**, **explicitly accepted**, or **the docs need to be updated to
match the implementation**. Track resolution per release.

### 16.1 `env set` / `get` / `rm` arg shape diverges from spec

**Where seen:** §6.1 (command tree), §6.3 (`vault env set`), `README.cli.md`,
implementation in `bin/commands/env.js`.

**Spec says:**

```
vault env set <env> <key>=<value>
vault env get <env> <key>
vault env rm  <env> <key>
```

**Implementation does:**

```
vault env set <key> <value> [-e <env>]    # env from -e or VAULT_ENV (required)
vault env get <key>          [-e <env>]
vault env rm  <key>          [-e <env>]
```

**README.cli.md** disagrees with **both** (`vault env set API_KEY s3cr3t` — no
env, no `=`, two positionals).

**Impact:** Users following any of the three sources hit "missing required
argument" or silently write to the wrong environment. Surfaced during a clean
end-to-end smoke test where `vault env set dev MY_KEY=hello` interpreted
`dev` as the key and `MY_KEY=hello` as the value, writing to the default env.

**Resolution options:**

| Option                                            | Cost                                                   | Notes                                                                                    |
| ------------------------------------------------- | ------------------------------------------------------ | ---------------------------------------------------------------------------------------- |
| (a) Align implementation to spec                  | CLI rewrite for 5 commands + breaking change for users | Most consistent. Pairs env-first with `show`/`rollback`/`history` which already do this. |
| (b) Update spec + README to match implementation  | Docs-only change                                       | Defensible — var-level commands using `-e` makes `env get FOO` (default env) ergonomic.  |
| (c) Accept both forms during a deprecation window | Implementation change + ongoing maintenance            | Lowest friction for current users; higher long-term cost.                                |

**Recommended:** (b) — codify the split: env-level ops (`show`, `rename`,
`copy`, `delete`, `diff`, `validate`, `export`, `template`, `history`) take env
as positional; var-level ops (`set`, `get`, `rm`) plus the version ops
(`rollback`, `squash`) use `-e <env>` with default `"default"`. Document the
rationale.

**RESOLVED** (option b) — §6.1 now documents the var-level vs env-level split
with the rationale in §6.1.3, and every §6.3 detail block matches the registered
command shapes. No CLI behavior changed. Note: `rollback` is `-e`-based (a
version op), correcting this item's earlier draft which grouped it with the
env-positional commands. Covers §16.1, §16.2, and §16.3.

**SUPERSEDED** — the implicit `"default"` environment was later removed. Every
command now resolves the environment as explicit arg/`-e` → `VAULT_ENV` → error;
there is no `"default"` fallback (a forgotten env silently read or wrote the
wrong environment, and `set` would auto-create `"default"`). The argument-shape
split from option (b) still stands; only the `"default"` fallback is gone.

### 16.2 `env get <key>` rejects a second positional

**Where seen:** implementation in `bin/commands/env.js`.

`env get` declares exactly one positional (`<key>`). Invocations of the form
`vault env get dev MY_KEY` exit with:

```
error: too many arguments for 'get'. Expected 1 argument but got 2.
```

Same root cause as 16.1 — implementation expects `<key>` + `-e <env>`, not
`<env> <key>`. Resolution piggybacks on 16.1.

### 16.3 `env squash` missing env positional in implementation

**Where seen:** §6.1 (`vault env squash <env>`), §6.3 (`vault env squash` docs
example), implementation.

**Spec says:**

```
vault env squash <env> [--keep <n>]
```

**Implementation does:**

```
vault env squash [-e <env>] [--keep <n>]    # env from -e or VAULT_ENV (required)
```

Same family as 16.1. Spec and `--help` disagree. Same recommendation: codify
the var-level vs env-level split or update implementation.

### 16.4 README.cli.md examples don't match either spec or implementation

**Where seen:** `README.cli.md` lines 47–55.

Example shown: `vault env set API_KEY s3cr3t` — two positionals, no env
specified, doesn't follow the `KEY=VALUE` pattern from §6.1 either.

**Action:** once 16.1 is resolved, regenerate README examples from a single
source. Consider deriving them programmatically from the registered Commander
commands to prevent future drift.

### 16.5 Spec is silent on `--password-file` / `--password-stdin` exit codes

**Where seen:** §6.2 global flags (now lists the two new flags); §12.5
(Password Prompt) doesn't enumerate failure modes; Appendix B (Error Codes)
has no entry for "password source conflict" or "password file unreadable".

**Implementation behavior** (verified via smoke test):

| Condition                                                          | Exit | stderr message                                                            |
| ------------------------------------------------------------------ | ---- | ------------------------------------------------------------------------- |
| Conflict: `--password` + `--password-file` (or any 2+)             | 1    | `Error: choose only one of --password, --password-file, --password-stdin` |
| `--password-file` points at a missing/unreadable file              | 1    | `Error: cannot read password file "<path>": <ENOENT detail>`              |
| `--password-stdin` with closed/errored stdin                       | 1    | `Error: cannot read password from stdin: <detail>`                        |
| Correct password resolved but wrong for the vault (decrypt failed) | 1    | passed through from vault load (currently `ENV_VAULT_DECRYPT_FAILED`)     |

**Action:** add a new "Password Resolution" subsection under §6.2 or §12.5
listing precedence, mutual-exclusion rule, and exit codes. Add codes to
Appendix B (e.g. `PASSWORD_SOURCE_CONFLICT`, `PASSWORD_FILE_UNREADABLE`,
`PASSWORD_STDIN_FAILED`). All three currently use exit 1 — consider distinct
codes once a CI-hardening pass lands.

**RESOLVED (docs + implementation)** — §6.2 now lists all three flags; §6.2.1
documents the precedence order, the mutual-exclusion rule (and
`VAULT_ENV_PASSWORD`'s exemption from it), and the exit-code table; §12.5
cross-references it; and the `PASSWORD_*` plus all other codes are wired with
distinct numeric exit codes (2–14) and symbolic emission in Appendix B.

### 16.6 `.env.vault` auto-discovery: walk-up + git-root semantics not in spec

**Where seen:** §5.2 (Discovery Priority) lists `./.env.vault` and
`./config/.env.vault` as the only auto-detect paths.

**Implementation does** (per `EnvironmentVaultService.findVaultUpward`): walks
from cwd toward ancestors looking for `.env.vault`, bounded by the **git
root**. If no `.git` is found, only cwd is checked.

**Behavior is more useful than the spec describes** — devs running from a
subdirectory of a monorepo find the project-root vault without needing
`--vault` — but the spec doesn't document it.

**Action:** update §5.2 to describe walk-up + git-root boundary. Add an
example to §5.3. Document the fallback when there's no `.git` (cwd only, not
parents). Decide whether `./config/.env.vault` is still in the discovery
order (implementation still checks it AFTER the walk-up).

**RESOLVED** — §5.2 step 3 now documents the walk-up, the git-root boundary
(inclusive), and the no-`.git` fallback (CWD only). `./config/.env.vault` is
kept in the order, explicitly after the walk-up; §5.3 gains walk-up examples.
A note clarifies that discovery applies to read/run, while `init` always
creates under app-data (no walk-up). Walk-up + boundary verified empirically.

### 16.7 Test imports CLI internals from `bin/commands/env.js`

**Where seen:** `src/__tests__/cli/passwordResolution.test.js` imports
`stripTrailingNewline`, `readPasswordFile`, `readPasswordStdin`,
`hasNonInteractivePassword`, `resolvePassword` directly from
`../../../bin/commands/env.js`.

**Why it matters:** `bin/` is the CLI entry tree, normally not consumed as a
library. This works today but:

- It depends on `bin/commands/env.js` being a real ES module (it is).
- The published npm package shape needs to include `bin/commands/`
  importable, not stripped/minified.
- Future refactors might split commands into modules and break the import.

**Action:** either (a) extract the password-resolution helpers into
`src/utils/password.js` and re-export from `bin/commands/env.js`, then update
the test to import from `src/utils/password.js` — cleanest separation; or
(b) accept the current shape and add a comment in the test plus a regression
test in `package.json#files` to ensure `bin/commands/` is published.

**Recommended:** (a). Pure utility functions don't belong in the command
layer.

### 16.8 `readPasswordStdin` test mocks `fs-extra` but production uses `fs`

**Where seen:** `src/__tests__/cli/passwordResolution.test.js`
`describe('readPasswordStdin')` block.

The production code (`bin/commands/env.js:84`) calls `fs.readFileSync(0,
'utf8')`. The test mocks `fsExtra.readFileSync`. The mock "works" because
`fs-extra` re-exports `fs.readFileSync` unchanged, so spying on one observes
the other. This is an implementation coincidence, not a contract.

**Action:** switch the spy to `fs.readFileSync` directly, or add a comment
explaining the cross-module spy. Risk if left: a future fs-extra update that
wraps `readFileSync` (e.g., for promisification) silently breaks the test
or — worse — makes the test pass against fs-extra while production drifts.

---

## 17. Appendix: Comparison to 1Password Environments

| Feature               | 1Password Environments        | Secure Vault Envs                    |
| --------------------- | ----------------------------- | ------------------------------------ |
| Storage               | 1Password vault (proprietary) | `.env.vault` (AES-256-GCM)           |
| File binding          | Virtual mount via FUSE        | Temp file (v1), FUSE (v3 north star) |
| CLI runner            | No                            | Yes (`vault env run`)                |
| Versioning            | Live edit, no versions        | Full version history + rollback      |
| Template refs         | No                            | Yes (`{{env:name/KEY}}`)             |
| Environment layering  | No                            | Yes (`extends`)                      |
| Validation            | No                            | Yes (`vault env validate`)           |
| `.env.example` export | No                            | Yes (`vault env template`)           |
| Offline               | Requires desktop app          | Fully offline                        |
| Open source           | No                            | Yes                                  |
| Platform              | macOS, Windows, Linux         | macOS, Windows, Linux                |
| Password              | Single 1Password account      | Per-vault password (configurable)    |

---

## Appendix A: Glossary

| Term              | Definition                                                         |
| ----------------- | ------------------------------------------------------------------ |
| Environment       | A named collection of key-value pairs (e.g., `staging`)            |
| Environment Vault | The encrypted `.env.vault` file containing all environments        |
| Version           | A snapshot of an environment's vars at a point in time             |
| Layering          | Merging variables from a base environment into an override         |
| Template ref      | A `{{...}}` expression that resolves to another variable's value   |
| Injection mode    | How env vars are delivered to the child process (clean/merge/file) |
| Allowlist         | System environment variables permitted in clean mode               |

## Appendix B: Error Codes

| Exit | Code                       | Message Pattern                                                         |
| ---- | -------------------------- | ----------------------------------------------------------------------- |
| 2    | `PASSWORD_SOURCE_CONFLICT` | `choose only one of --password, --password-file, --password-stdin`      |
| 3    | `PASSWORD_FILE_UNREADABLE` | `cannot read password file "<path>": <detail>`                          |
| 4    | `PASSWORD_STDIN_FAILED`    | `cannot read password from stdin: <detail>`                             |
| 5    | `ENV_VAULT_NOT_FOUND`      | `Environment vault not found at <path>`                                 |
| 6    | `ENV_VAULT_DECRYPT_FAILED` | `Failed to decrypt environment vault: wrong password or corrupted file` |
| 7    | `ENV_NOT_FOUND`            | `Environment '<name>' not found`                                        |
| 8    | `ENV_ALREADY_EXISTS`       | `Environment '<name>' already exists`                                   |
| 9    | `KEY_NOT_FOUND`            | `Key '<key>' not found in environment '<env>'`                          |
| 10   | `REFERENCE_CYCLE`          | `Circular reference detected: <path>`                                   |
| 11   | `REFERENCE_NOT_FOUND`      | `Reference '{{<ref>}}' could not be resolved: <details>`                |
| 12   | `VALIDATION_ERROR`         | `Validation failed: <details>`                                          |
| 13   | `MAX_DEPTH_EXCEEDED`       | `Template reference resolution exceeded max depth of 5`                 |
| 14   | `INJECTION_FAILED`         | `Failed to spawn child process: <details>`                              |
| -    | `FILE_WRITE_FAILED`        | `Failed to write env file at <path>: <details>`                         |
| -    | `VAULT_LOCKED`             | `Environment vault is locked. Run 'vault env unlock' first.`            |

> **Status:** exit codes 2–14 are wired and emit the symbolic code on stderr
> (e.g. `[ENV_VAULT_NOT_FOUND] No vault found...`). `FILE_WRITE_FAILED` and
> `VAULT_LOCKED` are documented for future use (agent mode, v2.0+) but not yet
> wired.

---

## Appendix C: Changelog

| Date       | Revision | Author  | Changes                                                                                                                                                                                                                                                                                                                                       |
| ---------- | -------- | ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-05-30 | 1        | wbenzid | Initial draft                                                                                                                                                                                                                                                                                                                                 |
| 2026-05-26 | 2        | wbenzid | Add §16 Known Issues & Pending Reconciliations (8 items from v0.1.0-rc.5 e2e validation)                                                                                                                                                                                                                                                      |
| 2026-06-06 | 3        | wbenzid | Codify var-level vs env-level command split (§6.1, §6.1.1); align all §6.3 usage/examples and §7 flows to the implementation; mark §16.1–16.3 RESOLVED (option b)                                                                                                                                                                             |
| 2026-06-06 | 4        | wbenzid | Document password resolution (§6.2.1: precedence, mutual exclusion, exit codes); update §12.5; add `PASSWORD_*` codes to Appendix B; mark §16.5 RESOLVED (docs)                                                                                                                                                                               |
| 2026-06-06 | 5        | wbenzid | Document walk-up + git-root vault discovery (§5.2/§5.3); mark §16.6 RESOLVED. Fix duplicate §6.1 heading (now §6.1.1/6.1.2/6.1.3) and stale cross-refs                                                                                                                                                                                        |
| 2026-06-11 | 6        | wbenzid | Mark v1.5 Composition delivered (resolver: `extends` layering + `{{env:name/KEY}}`/`{{env:self/KEY}}` refs + full validation engine); add `.bak`/atomic-write + `.deleted.<ts>` (§5.4); reserve `self` env name (§4.5/§8); add milestone status legend + v0.5/v1.0/v2.x markers; note Q1/Q4 status in §15                                     |
| 2026-06-15 | 7        | wbenzid | Mark v1.0 hardening complete in §13.3 (3-pass temp cleanup, orphan scan, distinct error codes 2–14 with symbolic emission); add `show` fields, `diff` old→new, `history` date col, spec limit enforcement, `--description`, `--quiet` to §13.4 delivered; close §16.5 (error codes); add numeric exit code column + status note to Appendix B |
