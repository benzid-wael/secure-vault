# Security & best practices

SecureVault is designed to keep your secrets on your machine and unreadable
without your master password.

## How your data is protected

| Aspect             | Detail                                                                                   |
| ------------------ | ---------------------------------------------------------------------------------------- |
| **Encryption**     | AES-256-GCM (Galois/Counter Mode) — authenticated, tamper-evident                        |
| **Key derivation** | PBKDF2 with SHA-512, 600,000 iterations (older vaults are upgraded when you unlock them) |
| **Salt**           | A 32-byte random salt per vault                                                          |
| **Authentication** | Built-in GCM authentication tag detects any tampering                                    |
| **Storage**        | Each vault is a separate encrypted JSON file; nothing in plaintext                       |

### Zero-knowledge architecture

Your master password is **never written to disk** unless you tick **Remember on
this computer**: then it's kept encrypted by the system keychain (the macOS
Keychain, DPAPI on Windows, the Secret Service on Linux), for your account on
this computer only, and Touch ID is asked before it's used where the Mac has it.
While a vault is unlocked the password is held in memory by the app's main
process only; the window you interact with never keeps it, and a saved one
never reaches it. Locking the vault (manually, or automatically on sleep / screen
lock) ends the session. This means:

- Nobody — including the developers — can recover your data without the master password.
- If you forget it, the vault is unrecoverable. This is the intended trade-off.

### Application hardening

- The Electron **main process** handles all file operations; the renderer has no
  direct filesystem access.
- **Context isolation** prevents code injection between the page and Node.
- A **Content Security Policy (CSP)** mitigates XSS.
- The master password never stays in the renderer: it is sent once to unlock,
  and every later request names only the vault. Malicious code in the page can't
  read the password back.
- Memory can't be wiped reliably from JavaScript, so the password lingers in
  the main process's memory until it's reused, even after locking. Native
  memory locking is on the roadmap.

## Best practices

1. **Use a strong master password** — long, unique, and memorable.
2. **Keep the software updated** — always run the latest release.
3. **Secure your device** — enable device encryption and a lock screen; a vault is
   only as safe as the machine it sits on.
4. **Don't share master passwords** — each person should have their own vault.
5. **Back up your vault files** — copy the encrypted files from the storage
   location somewhere safe. They're useless without your master password.

::: warning Local responsibility
SecureVault stores your passwords locally. The encryption is strong, but you are
responsible for keeping your master password secret and backing up your vault
files. Lost passwords or lost files cannot be recovered.
:::

## Going deeper

For the full threat model and cryptographic design, see the
[**Reference / deep dives**](/reference/).
