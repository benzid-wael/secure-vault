# Secure Password Manager

A modern, secure password management application built with Electron and React, featuring strong encryption and a beautiful user interface.

## Features

- **🔐 Strong Encryption**: All vaults are encrypted using AES-256-GCM with PBKDF2 key derivation
- **🏠 Multiple Vaults**: Create and manage multiple password vaults
- **🎨 Modern UI**: Beautiful dark theme with Material-UI components
- **🔒 Secure Storage**: Passwords are never stored in plain text
- **📱 Cross-Platform**: Works on Windows, macOS, and Linux
- **🔑 Password Generation**: Built-in secure password generator
- **📋 Copy to Clipboard**: Easy copying of usernames, passwords, and URLs
- **🔍 Search**: Quick search through your password entries

## Security Features

- **Zero-Knowledge Architecture**: Your master password is never stored
- **Strong Key Derivation**: PBKDF2 with 100,000 iterations
- **Authenticated Encryption**: AES-256-GCM prevents tampering
- **Secure Context**: Runs in isolated Electron context with CSP
- **Memory Protection**: Sensitive data cleared from memory when possible

## Download & Install

Grab the latest build for your platform from the
[**Releases page**](https://github.com/benzid-wael/secure-vault/releases/latest).
No need to clone the repo or install Node.

### Desktop app (GUI)

| OS          | Download                                  |
| ----------- | ----------------------------------------- |
| **macOS**   | `.dmg` (installer) or `.zip` (portable)   |
| **Windows** | `*-Setup.exe` (installer) or portable `.exe` |
| **Linux**   | `.AppImage` (portable) or `.deb` (Debian/Ubuntu) |

> **Unsigned builds.** The app is not yet code-signed, so your OS will warn that
> the developer is unidentified. This is expected:
>
> - **macOS**: right-click the app → **Open** → **Open** (only needed the first
>   time). Or run `xattr -dr com.apple.quarantine "/Applications/Secure Password Manager.app"`.
> - **Windows**: on the SmartScreen prompt click **More info** → **Run anyway**.
> - **Linux (AppImage)**: `chmod +x Secure*.AppImage` then run it.

### Command-line tool (`vault`)

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
npm install -g secure-password-manager
vault info
```

The CLI and the desktop app share the same encrypted vaults on disk.

## Building from source

### Prerequisites

- Node.js 20.10.0 or higher
- npm 9.0.0 or higher
- Git

### Setup

1. Clone the repository:
   ```bash
   git clone https://github.com/benzid-wael/secure-vault.git
   cd secure-vault
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

See [`docs/RELEASING.md`](docs/RELEASING.md) for how releases are built and published.

## Development

### Start Development Server

To run the application in development mode with hot-reload:

```bash
# Start both renderer and main processes in development mode
npm run dev:electron

# Or start them separately in different terminals
# Terminal 1 - Start React development server
npm run dev:renderer

# Terminal 2 - Start Electron main process
npm run dev:main
```

## Building

### Development Build

Create an unoptimized development build:

```bash
npm run build:all
```

### Production Build

Create an optimized production build:

```bash
# Build both renderer and main processes
npm run build:all

# Verify the build
npm run verify-build
```

## Packaging

Package the application for distribution:

```bash
# Package for current platform
npm run package

# Package for specific platforms
npm run package:mac    # macOS
npm run package:win    # Windows
npm run package:linux  # Linux
```

## Running Production Build

To run the production build:

```bash
# Build the application first
npm run build:all

# Then run the production build
npm run start:prod
```

## Usage

### First Time Setup

1. Launch the application
2. You'll see the vault selector with a default vault
3. The default vault password is `changeme123` (change this immediately for security)
4. Or create a new vault with a strong master password

### Creating a New Vault

1. Click "Create New Vault" from the main screen
2. Enter a unique vault name
3. Create a strong master password (the app will show password strength)
4. Confirm your password
5. Click "Create Vault"

### Adding Passwords

1. Unlock your vault
2. Click the "+" floating action button
3. Fill in the password details:
   - Title (required)
   - Username/Email (required)
   - Password (required) - use the generate button for strong passwords
   - URL (optional)
   - Notes (optional)
4. Click "Add"

### Managing Passwords

- **Search**: Use the search bar to quickly find passwords
- **Copy**: Click the copy icon next to any field to copy it to clipboard
- **View**: Click the eye icon to show/hide passwords
- **Edit**: Click the menu (⋮) and select "Edit"
- **Delete**: Click the menu (⋮) and select "Delete"

## Security Best Practices

1. **Use a Strong Master Password**: Your master password should be long, unique, and memorable
2. **Regular Backups**: Export your vault data regularly (feature coming soon)
3. **Keep Software Updated**: Always use the latest version
4. **Secure Your Device**: Use device encryption and lock screens
5. **Don't Share Master Passwords**: Each user should have their own vault

## File Structure

```
secure-password-manager/
├── public/
│   ├── electron.js          # Electron main process
│   ├── preload.js          # Secure IPC bridge
│   └── index.html          # HTML template
├── src/
│   ├── components/         # React components
│   │   ├── VaultSelector.js
│   │   ├── VaultLogin.js
│   │   ├── CreateVault.js
│   │   └── PasswordManager.js
│   ├── App.js             # Main React app
│   └── index.js           # React entry point
└── package.json           # Dependencies and scripts
```

## Technical Details

### Encryption

- **Algorithm**: AES-256-GCM (Galois/Counter Mode)
- **Key Derivation**: PBKDF2 with SHA-512, 100,000 iterations
- **Salt**: 32-byte random salt per vault
- **Authentication**: Built-in authentication tag prevents tampering

### Storage

- Vaults are stored in the user's application data directory
- Each vault is a separate encrypted JSON file
- No sensitive data is stored in plain text

### Security Architecture

- Electron main process handles all file operations
- Renderer process has no direct file system access
- Context isolation prevents code injection
- Content Security Policy (CSP) prevents XSS attacks

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests if applicable
5. Submit a pull request

## License

This project is licensed under the MIT License - see the LICENSE file for details.

## Support

If you encounter any issues or have questions, please open an issue on the GitHub repository.

---

**⚠️ Important Security Note**: This application stores your passwords locally on your device. While we use strong encryption, you are responsible for keeping your master password secure and backing up your vault files. The developers are not responsible for lost passwords or data.
