---
layout: home

hero:
  name: SecureVault
  text: Your secrets, on your machine.
  tagline: A secure, offline password & environment-variable manager. One encrypted vault, two ways to use it — a polished desktop app and a scriptable CLI.
  actions:
    - theme: brand
      text: Get started
      link: /guide/getting-started
    - theme: alt
      text: Desktop app (GUI)
      link: /guide/gui/
    - theme: alt
      text: Command line (CLI)
      link: /guide/cli/
    - theme: alt
      text: Download
      link: https://github.com/benzid-wael/secure-vault/releases/latest

features:
  - icon: 🔐
    title: Strong, authenticated encryption
    details: AES-256-GCM with PBKDF2 (100,000 iterations) and a random per-vault salt. Tamper-evident by design.
  - icon: 🕵️
    title: Zero-knowledge & offline
    details: Your master password is never stored and nothing ever leaves your machine. No account, no cloud, no telemetry.
  - icon: 🖥️
    title: GUI and CLI, one vault
    details: The desktop app and the vault command share the exact same encrypted files on disk. Manage in one, read in the other.
  - icon: 🧩
    title: Environment vaults for developers
    details: Manage per-project .env secrets as encrypted, versioned vaults. Inject them into any command, or deliver typed files for native mobile builds.
---

## Two ways in, one vault

SecureVault stores everything in local, encrypted vaults. Pick the interface that fits the moment — they read and write the **same files**.

| You want to…                                          | Use the…                        | Start here                                            |
| ----------------------------------------------------- | ------------------------------- | ----------------------------------------------------- |
| Store and look up logins with a friendly window       | **Desktop app (GUI)**           | [GUI guide →](/guide/gui/)                            |
| Script secrets, inject `.env` into builds, wire up CI | **Command line (`vault`)**      | [CLI guide →](/guide/cli/)                            |
| Ship secrets into Xcode / Android Studio builds       | **CLI — delivering secrets**    | [Delivering secrets →](/guide/cli/delivering-secrets) |
| Keep a vault unlocked for an all-day dev session      | **CLI — the agent** _(preview)_ | [Agent →](/guide/cli/agent)                           |

::: tip New here?
Read the [Getting started overview](/guide/getting-started) — it installs both the app and the CLI and explains how they share vaults.
:::

## What it is (and isn't)

SecureVault is a **local-first** secret manager: a desktop password manager for everyday logins, and a developer-focused CLI for managing `.env` secrets as encrypted, versioned vaults you can inject into any command. There is no server, no sync, and no account — you own the files, and you own the master password.
