# Concepts & terms

A quick glossary so the rest of the guides read clearly.

## Vault

An encrypted file that holds your secrets. There are two flavours:

- a **password vault** — logins (title, username, password, URL, notes), managed
  mostly through the [desktop app](/guide/gui/) or `vault` password commands;
- an **environment vault** — per-project `.env`-style variables, managed through
  `vault env` (see [Environment vaults](/guide/cli/env-vaults)).

Every vault is encrypted with **AES-256-GCM** and unlocked by a **master
password** that is never stored anywhere.

## Master password

The single password that decrypts a vault. SecureVault is **zero-knowledge**: the
master password is used to derive the encryption key (via PBKDF2, 100,000
iterations) and is never written to disk. Lose it and the data is unrecoverable —
that is the point.

## Environment

Inside an environment vault, an **environment** is a named set of variables —
typically `dev`, `staging`, `prod`, `ci`. There is **no implicit default**: every
`vault env` command must be told which environment to act on, via a positional
argument, `-e <env>`, or the `VAULT_ENV` variable.

Environments can **extend** a parent to share common variables, and values can
**reference** other variables with `{{env:<name>/<KEY>}}`. See
[Environment vaults → Layering](/guide/cli/env-vaults#layering-template-references).

## Injection vs. delivery

Two different ways the CLI gets secrets to your tools:

- **Injection** — `vault env run` decrypts an environment and passes it to a child
  process as environment variables. Secrets live in memory only; nothing touches
  disk unless you ask. This is the safe default. See
  [Environment vaults → run](/guide/cli/env-vaults#running-commands-with-secrets).
- **Delivery** — `vault env file` / `apply` write secrets to **real files**
  (a decoded `GoogleService-Info.plist`, an `.xcconfig`, a `.env`) that a build
  tool reads. These files stay on disk until you `clean` them. Needed for native
  mobile builds. See [Delivering secrets to files](/guide/cli/delivering-secrets).

## The agent (v2.0 preview)

A background daemon that keeps a vault unlocked for a whole session so GUI-driven
builds don't re-prompt for the master password. It is a **developer preview** and
not yet hardened for sensitive/production secrets — see [The agent](/guide/cli/agent).

## Where things are stored

| OS      | Path                                                     |
| ------- | -------------------------------------------------------- |
| macOS   | `~/Library/Application Support/secure-password-manager/` |
| Linux   | `~/.secure-password-manager/`                            |
| Windows | `%APPDATA%\secure-password-manager\`                     |

The desktop app and the CLI both use this location, which is why they share
vaults transparently.
