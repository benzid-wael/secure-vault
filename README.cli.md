# SecureVault CLI

> `vault` — a secure, offline password & environment-variable manager for your terminal.

SecureVault stores secrets in local, encrypted vaults using **AES-256-GCM** with
**PBKDF2** key derivation. Nothing leaves your machine. The CLI is especially
handy for managing per-project `.env` files as encrypted, versioned vaults.

## Install

**Via npm** (requires Node.js 20.10+):

```bash
npm install -g @benzid.wael/secure-vault
vault info
```

**Standalone binary** (no Node required) — download the build for your OS from
the [releases page](https://github.com/benzid-wael/secure-vault/releases/latest):

```bash
# macOS / Linux
chmod +x vault-macos-arm64        # or vault-linux-x64, etc.
sudo mv vault-macos-arm64 /usr/local/bin/vault
vault info
```

On Windows, rename `vault-windows-x64.exe` to `vault.exe` and add its folder to
`PATH`. On macOS, if the unsigned binary is blocked, run
`xattr -d com.apple.quarantine vault` once.

## Usage

```bash
vault info                       # show version and vault location
vault recover --name <vault>     # recover a vault with your master password
```

### Environment vaults

Manage `.env` secrets as encrypted, versioned vaults:

Variable-level commands (`set`, `get`, `rm`) take the **key** as the argument and
the environment as `-e <env>`. Environment-level commands take the **environment
name** as the argument.

There is **no implicit "default" environment** — every command must be told which
environment to act on. The environment is resolved as: explicit argument / `-e`
→ `VAULT_ENV` → error. (Structural commands like `delete`/`rename`/`copy` require
the name as a positional argument.)

```bash
vault env init                   # create an environment vault for this project
vault env import dev .env        # import a .env file into the "dev" environment
vault env set API_KEY s3cr3t -e dev   # set a variable in "dev"
vault env set API_KEY -e dev          # no value: edit in $EDITOR (previous value shown commented)
vault env get API_KEY -e dev          # read it back
vault env show dev               # show all variables in an environment
vault env list                   # list environments in the vault
vault env export dev             # print as dotenv (or JSON)
vault env template dev           # generate a .env.template (keys only)
vault env diff dev prod          # compare two environments
vault env history dev            # view version history
vault env rollback 3 -e dev      # restore a previous version of "dev"
vault env run dev -- npm start   # run a command with the env injected
vault env run dev --dry-run      # preview what would be injected (no spawn)
vault env shell dev              # open an interactive shell with the env loaded
```

#### Zero-friction project setup

Drop a `.vaultrc` at your project root to avoid repeating flags on every invocation:

```json
{
  "inject": "merge",
  "name": "my-project",
  "allowlistFile": ".vault-allowlist"
}
```

Set `VAULT_ENV`, `VAULT_NAME`, or `VAULT_INJECT` for CI pipelines — they fill
in the same defaults, and `.vaultrc` overrides them, and CLI flags override
everything:

```bash
export VAULT_ENV=staging
vault env run -- node server.js          # env name from VAULT_ENV
VAULT_INJECT=merge vault env run -- ...  # inject mode from env var
```

Pass a per-project allowlist file to let extra system vars through in `clean`
mode (one var per line, `#` comments supported):

```bash
# .vault-allowlist
NODE_PATH
LANG   # locale settings
TERM   # terminal type
```

The file `.vault-allowlist` is loaded automatically if present; override with
`--allowlist-file <path>`.

#### Layering & template references

Environments can **extend** a parent so shared variables live in one place, and
values can **reference** another variable with `{{env:<name>/<KEY>}}` (use
`self` for the same environment). Both are resolved on read — by `export`,
`run`, `get`, `diff`, and `validate` — so the stored value keeps its reference
and re-resolves whenever the source changes.

```bash
# Shared defaults in a "base" environment
vault env set LOG_LEVEL info -e base --public
vault env set PORT 3000 -e base --public --required

# "staging" inherits base, then overrides. Any `set` creates the environment;
# `extends` wires the parent (which must already exist; --none clears it).
vault env set API_URL https://staging.example.com -e staging --public
vault env extends staging base
vault env set PORT 8080 -e staging --public           # override an inherited value

# Reference another environment, or your own keys with self.
# --extends sets the parent in the same step as the write.
vault env set --extends base DB_URL '{{env:staging/API_URL}}' -e dev
vault env set ENDPOINT 'localhost:{{env:self/PORT}}' -e dev   # PORT inherited from base

vault env export staging --format json   # base keys merged in (PORT shows 8080)
vault env validate dev                   # required keys aggregated across the chain; all refs must resolve
```

Layering and references support chains up to 5 deep; circular `extends`,
circular references, and missing keys are reported as validation errors.

Wire layering up front at import time (import every environment in the chain):

```bash
vault env init --env base:.env.base --env staging:.env.staging --extends staging:base
```

Other commands: `rm`, `delete`, `rename`, `copy`, `squash`, `extends`,
`change-password`. Run `vault env <command> --help` for the full options of any
command.

> **Safety:** every write keeps a `<vault>.bak` of the previous good state and
> writes atomically, so an interrupted save can never corrupt the vault.
> Deleting an environment also leaves a timestamped `<vault>.deleted.<ts>` copy.

## Where data is stored

Vaults live in a single location shared with the desktop app:

| OS      | Path                                                     |
| ------- | -------------------------------------------------------- |
| macOS   | `~/Library/Application Support/secure-password-manager/` |
| Linux   | `~/.secure-password-manager/`                            |
| Windows | `%APPDATA%\secure-password-manager\`                     |

## Security

- **Zero-knowledge**: your master password is never stored.
- **AES-256-GCM** authenticated encryption (tamper-evident).
- **PBKDF2** key derivation (100,000 iterations).
- Secrets are never written to disk in plaintext.

---

## Prefer a graphical app?

SecureVault also ships as a cross-platform **desktop app** (macOS, Windows,
Linux) with the same encrypted vaults — so anything you manage in the CLI shows
up in the GUI and vice-versa.

<p align="center">
  <img src="https://raw.githubusercontent.com/benzid-wael/secure-vault/main/docs/screenshots/vault-overview.png" alt="SecureVault desktop — vault overview" width="48%" />
  <img src="https://raw.githubusercontent.com/benzid-wael/secure-vault/main/docs/screenshots/entry-detail.png" alt="SecureVault desktop — entry detail" width="48%" />
</p>

👉 **[Download the desktop app](https://github.com/benzid-wael/secure-vault/releases/latest)**
(`.dmg`, `.exe`, `.AppImage`, `.deb`).

## License

[MIT](https://github.com/benzid-wael/secure-vault/blob/main/LICENSE)
