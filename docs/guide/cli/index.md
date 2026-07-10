# Command line — install & basics

`vault` is a secure, offline password & environment-variable manager for your
terminal. It stores secrets in local, encrypted vaults using **AES-256-GCM** with
**PBKDF2** key derivation — nothing leaves your machine. It's especially handy for
managing per-project `.env` files as encrypted, versioned vaults.

## Install

**Via npm** (requires Node.js 20.10+):

```bash
npm install -g @benzid.wael/secure-vault
vault info
```

**Standalone binary** (no Node required) — download the build for your OS from the
[releases page](https://github.com/benzid-wael/secure-vault/releases/latest):

```bash
# macOS / Linux
chmod +x vault-macos-arm64        # or vault-linux-x64, etc.
sudo mv vault-macos-arm64 /usr/local/bin/vault
vault info
```

On Windows, rename `vault-windows-x64.exe` to `vault.exe` and add its folder to
`PATH`. On macOS, if the unsigned binary is blocked, run
`xattr -d com.apple.quarantine vault` once.

## Basics

```bash
vault info                       # show version and vault location
vault recover --name <vault>     # recover a vault with your master password
```

Every command has `--help`:

```bash
vault env run --help
```

## What can it do?

The CLI has two sides that share the same encrypted storage:

| Area                      | What it's for                                            | Guide                                                 |
| ------------------------- | -------------------------------------------------------- | ----------------------------------------------------- |
| **Password vaults**       | Logins, shared with the desktop app                      | [Password vaults →](/guide/cli/passwords)             |
| **Environment vaults**    | Per-project `.env` secrets, versioned & injectable       | [Environment vaults →](/guide/cli/env-vaults)         |
| **Delivering secrets**    | Write typed files for native mobile builds (iOS/Android) | [Delivering secrets →](/guide/cli/delivering-secrets) |
| **The agent** _(preview)_ | Keep a vault unlocked for an all-day dev session         | [The agent →](/guide/cli/agent)                       |

## Where data is stored

Vaults live in a single location shared with the desktop app:

| OS      | Path                                                     |
| ------- | -------------------------------------------------------- |
| macOS   | `~/Library/Application Support/secure-password-manager/` |
| Linux   | `~/.secure-password-manager/`                            |
| Windows | `%APPDATA%\secure-password-manager\`                     |

## Security at a glance

- **Zero-knowledge** — your master password is never stored.
- **AES-256-GCM** authenticated encryption (tamper-evident).
- **PBKDF2** key derivation (100,000 iterations).
- Secrets are never written to disk in plaintext (unless you explicitly deliver a file).
