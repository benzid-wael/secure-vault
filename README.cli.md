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
the environment as `-e <env>` (defaults to `"default"`). Environment-level
commands take the **environment name** as the argument.

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
```

Other commands: `rm`, `delete`, `rename`, `squash`, `change-password`. Run
`vault env <command> --help` for the full options of any command.

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
