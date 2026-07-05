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
vault env run dev --export .env -- npm start   # also write a temp .env (wiped on exit)
vault env run dev --dry-run      # preview what would be injected (no spawn)
vault env shell dev              # open an interactive shell with the env loaded
```

#### Running commands with secrets injected (`vault env run`)

`vault env run` decrypts the environment, injects it into a child process, and
cleans up afterwards — secrets never touch disk unless you ask. It has **two
independent controls**:

- **`--inject clean|merge`** — _how the child's process environment is built._
  `clean` (default) passes only your vault vars plus a small allowlist
  (`PATH`, `HOME`, `SHELL`, `USER`, `TMPDIR`); `merge` keeps your whole shell
  env and layers vault vars on top.
- **`--export <path>`** — _also write a temporary `.env` to disk_ for tools
  that insist on reading one. It composes with either inject mode, so you can
  have a clean process env **and** a file.

| I want to…                                                | Command                                                         |
| --------------------------------------------------------- | --------------------------------------------------------------- |
| Run with only my vault vars (+ PATH/HOME/…), nothing else | `vault env run dev -- npm start`                                |
| Keep my whole shell env and add vault vars on top         | `vault env run dev --inject merge -- npm start`                 |
| Give a build tool a real `.env` (auto-wiped after)        | `vault env run dev --export .env -- npx react-native run-ios`   |
| Add my own one-off variable                               | `vault env run dev --set FEATURE_FLAG=on -- npm test`           |
| Load extra vars from a file                               | `vault env run dev --env-file .env.local -- npm test`           |
| Let specific shell vars through in clean mode             | `vault env run dev --allowlist NODE_PATH,LANG -- npm run build` |
| Preview what would be injected (no spawn)                 | `vault env run dev --dry-run`                                   |
| Drop into an interactive shell with the env loaded        | `vault env shell dev`                                           |

**`--export` details.** The file is created `0600`, the child receives
`ENV_FILE_PATH=<path>` so tools can locate it, and it is securely deleted when
the command exits — on success **or** failure. To avoid destroying a file you
care about, `--export` refuses to overwrite an existing path unless you pass
`--force`.

**Your own variables vs. shell passthrough.** `--set KEY=VALUE` (repeatable)
and `--env-file <path>` add _explicit_ variables: they are injected **and**
written into the `--export` file, layered under your vault vars (the vault wins
on a conflict, and `--set` beats `--env-file`). By contrast, `--inject merge`
and `--allowlist` only let your _existing_ shell variables through to the
process — they never get written to the exported file. So the on-disk `.env`
always contains exactly "vault vars + your explicit additions".

> **Heads-up on disk wiping.** The 3-pass overwrite is best-effort: on SSDs and
> copy-on-write filesystems (APFS, btrfs) the original blocks may not be erased
> in place, and a hard kill (`kill -9`) or power loss before the command exits
> can leave the file behind. Treat `--export` as "auto-cleanup on normal exit",
> not a guarantee against forensic recovery.

> **Deprecation.** The older `--inject file --out-file <path>` is now an alias
> for `--export <path>` and prints a warning; it is removed in v2.0. Replace
> `--inject file --out-file X` with `--export X`.

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

#### Delivering secrets to files (`file`, templates, `apply`)

`run --export` covers tools that read a single `.env`. Native mobile builds
(iOS/Android, Firebase, signing) need **several typed files** instead — a
decoded `GoogleService-Info.plist`, an `.xcconfig`, a keystore. Three commands
cover that, and none of them require the vault to understand the target file
format.

**Store a file _into_ the vault** — `set --in` reads a file as the value, and
`--encode base64` handles binary blobs (keystores, Firebase plists) that don't
survive as text:

```bash
vault env set GOOGLE_PLIST --in GoogleService-Info.plist --encode base64 -e dev
vault env set NOTES --in release-notes.txt -e dev        # text file, stored as-is
```

**Materialize one variable back _out_ to a file** — `file` writes a single
value to disk (`0600` by default), optionally base64-decoding it:

```bash
vault env file GOOGLE_PLIST --out ios/GoogleService-Info.plist --decode base64 -e dev
vault env file API_URL --out .env.local --mode 0640 -e dev
```

**Render any config format with a template.** A `.vtpl` file is plain text in
_any_ format with `{{KEY}}` placeholders; vault substitutes resolved values and
writes the result (output path = the template path minus `.vtpl`). Vault never
parses the format, so the same mechanism produces `.xcconfig`, `Info.plist`,
`gradle.properties`, XML, JSON — anything.

```ini
# ios/Secrets.xcconfig.vtpl
API_URL = {{API_URL}}
SENTRY_DSN = {{SENTRY_DSN}}
```

- A **missing key is an error**, never a silent blank.
- The delimiter `{{ }}` deliberately avoids `$( )` / `${ }`, so a template can
  contain the build system's own tokens (`$(inherited)`, `${VAR}`) untouched.
- Substitution is **single-pass**: a value that itself contains `{{OTHER}}` is
  not re-expanded (so one secret cannot pull in another).
- For values with format-special characters, add a filter:
  `{{SECRET | json}}`, `{{SECRET | xml}}`, `{{CERT | base64}}`.

**Deliver everything at once with a manifest.** List all artifacts in `.vaultrc`
under `deliver`, then `vault env apply` writes them all and `vault env clean`
securely removes them. Each entry is exactly one of `format`, `from`, or
`template`:

```jsonc
{
  "env": "dev",
  "deliver": [
    // native serializer (dotenv|json); optional "keys" subset
    {
      "path": ".env.development",
      "format": "dotenv",
      "keys": ["API_URL", "SENTRY_DSN"],
    },
    // blob: one variable, written verbatim (optionally base64-decoded)
    {
      "path": "ios/GoogleService-Info.plist",
      "from": "GOOGLE_PLIST",
      "decode": "base64",
    },
    // template: renders the .vtpl to ios/Secrets.xcconfig
    { "template": "ios/Secrets.xcconfig.vtpl" },
  ],
}
```

```bash
vault env apply            # write every artifact (env from arg / .vaultrc "env" / VAULT_ENV)
vault env apply --dry-run  # resolve + validate, but write nothing
vault env clean            # securely remove exactly the declared artifacts
```

Artifact paths resolve relative to the `.vaultrc` location, so `apply`/`clean`
behave identically from the project root or any subdirectory. `clean` removes
only the declared outputs — a `.vtpl` template source is never deleted.

> **These files are real deliveries, not temp files.** Unlike `run --export`,
> `file` and `apply` leave the files in place for the build tool to read; use
> `clean` (or add them to `.gitignore`) when you're done. Add every delivered
> path to `.gitignore` so a decoded secret is never committed.

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
