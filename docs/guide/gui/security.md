# Security & best practices

SecureVault is designed to keep your secrets on your machine and unreadable
without your master password.

## How your data is protected

| Aspect             | Detail                                                             |
| ------------------ | ------------------------------------------------------------------ |
| **Encryption**     | AES-256-GCM (Galois/Counter Mode) — authenticated, tamper-evident  |
| **Key derivation** | PBKDF2 with SHA-512, 100,000 iterations                            |
| **Salt**           | A 32-byte random salt per vault                                    |
| **Authentication** | Built-in GCM authentication tag detects any tampering              |
| **Storage**        | Each vault is a separate encrypted JSON file; nothing in plaintext |

### Zero-knowledge architecture

Your master password is **never stored**. It is used to derive the encryption key
at unlock time and then discarded. This means:

- Nobody — including the developers — can recover your data without the master password.
- If you forget it, the vault is unrecoverable. This is the intended trade-off.

### Application hardening

- The Electron **main process** handles all file operations; the renderer has no
  direct filesystem access.
- **Context isolation** prevents code injection between the page and Node.
- A **Content Security Policy (CSP)** mitigates XSS.
- Sensitive data is cleared from memory where possible.

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
