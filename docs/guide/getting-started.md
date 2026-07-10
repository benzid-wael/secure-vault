# Getting started

SecureVault comes in two forms that share the **same encrypted vaults** on disk:

- a **desktop app (GUI)** — a window for creating vaults and managing logins;
- a **command-line tool (`vault`)** — for scripting, `.env` management, and CI.

You can install either or both. Anything you save in one shows up in the other.

## Install the desktop app

Grab the latest build for your platform from the
[**Releases page**](https://github.com/benzid-wael/secure-vault/releases/latest) —
no need to clone the repo or install Node.

| OS          | Download                                         |
| ----------- | ------------------------------------------------ |
| **macOS**   | `.dmg` (installer) or `.zip` (portable)          |
| **Windows** | `*-Setup.exe` (installer) or portable `.exe`     |
| **Linux**   | `.AppImage` (portable) or `.deb` (Debian/Ubuntu) |

::: warning Unsigned builds
The app is not yet code-signed, so your OS will warn that the developer is unidentified. This is expected:

- **macOS** — right-click the app → **Open** → **Open** (first time only). Or run
  `xattr -dr com.apple.quarantine "/Applications/Secure Password Manager.app"`.
- **Windows** — on the SmartScreen prompt click **More info** → **Run anyway**.
- **Linux (AppImage)** — `chmod +x Secure*.AppImage`, then run it.
  :::

👉 Continue to the [**Desktop app guide**](/guide/gui/).

## Install the CLI

**Option A — standalone binary** (no Node required). Download the file for your
platform from the Releases page, then:

```bash
# macOS / Linux
chmod +x vault-macos-arm64        # or vault-linux-x64, etc.
sudo mv vault-macos-arm64 /usr/local/bin/vault
vault info
```

```powershell
# Windows: rename vault-windows-x64.exe to vault.exe and add its folder to PATH
vault info
```

On macOS the binary is also unsigned — if it's blocked, run
`xattr -d com.apple.quarantine vault` once.

**Option B — via npm** (requires Node.js 20.10+):

```bash
npm install -g @benzid.wael/secure-vault
vault info
```

👉 Continue to the [**CLI guide**](/guide/cli/).

## How the GUI and CLI share vaults

Both interfaces read and write the same encrypted files in a single per-user
location:

| OS      | Path                                                     |
| ------- | -------------------------------------------------------- |
| macOS   | `~/Library/Application Support/secure-password-manager/` |
| Linux   | `~/.secure-password-manager/`                            |
| Windows | `%APPDATA%\secure-password-manager\`                     |

Each vault is a separate encrypted JSON file. Create a vault in the app and you
can open it from the CLI (and vice-versa) using the same master password.

## Next steps

- New to the concepts? Read [**Concepts & terms**](/guide/concepts).
- Want the visual app? [**Desktop app guide**](/guide/gui/).
- Living in the terminal? [**CLI guide**](/guide/cli/).
