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

- Nobody — including the developers — can recover your data without the
  master password or the vault's recovery key.
- If you lose both, the vault is unrecoverable. This is the intended trade-off.

### A key file as a second factor

In a vault's **Settings → Key file**, **Require a Key File…** adds a second
factor: a small `.svkey` file the app creates (or one you already have) that's
needed together with the master password. Both go into the key that decrypts
the vault, so a copy of the vault file and its password, leaked or guessed,
open nothing without the key file.

- Keep the key file away from the vault: on a USB stick or another drive, not
  in the vault's folder or the same synced folder. Anyone who copies that
  folder, or the sync service holding it, would get both, and the key file
  would add nothing; the app warns when you save or pick one there. Keep a
  copy somewhere safe.
- Unlocking asks for the password, then the key file. After that the app
  remembers where the key file was (the location, never its content) and
  reads it from there, so unlocking is one step while the USB stick is in;
  **Choose another key file…** on the unlock screen picks a different one.
- A saved password (**Remember on this computer**) fills in the password
  only: the key file is still read each time.
- The vault's recovery key still opens it if the key file or the password
  is lost: **Forgot your password? Use recovery options** asks for the
  recovery key, then a new password and a new key file (or one you have,
  or none). The old password and key file stop working; the same recovery
  key keeps working, unless you choose no key file, which makes a new
  one. A vault with a key file can't be recovered with a previous
  password.
- **Change Key File…** replaces it; **Stop Requiring a Key File…** goes back
  to the password alone and makes a new recovery key.
- Older versions of SecureVault can't open a vault while it requires a key
  file: turn it off before going back to one. An export of such a vault
  can't be imported yet; turn the key file off before exporting a vault you
  want to move.
- What it doesn't stop: someone who holds the recovery key (keep it offline),
  or malware on your computer while the vault is unlocked.

Why not codes from an authenticator app? There's no server to check them: the
app would have to keep the code's secret next to the vault, and anyone with the
file and the password could decrypt it without the app.

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
   location somewhere safe. They're useless without your master password (and
   key file, if the vault requires one).
6. **Keep the recovery key and any key file apart** — away from the vault and
   from each other: the recovery key opens the vault on its own, and a key file
   needs only the password.

::: warning Local responsibility
SecureVault stores your passwords locally. The encryption is strong, but you are
responsible for keeping your master password secret and backing up your vault
files. Lost passwords or lost files cannot be recovered.
:::

## Going deeper

For the full threat model and cryptographic design, see the
[**Reference / deep dives**](/reference/).
