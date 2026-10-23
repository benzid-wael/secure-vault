# RFC: a second factor for password vaults (key file)

| Field   | Value                                                                                                                          |
| ------- | ------------------------------------------------------------------------------------------------------------------------------ |
| Status  | **Approved** (rev. 2, 2026-10-23): Q1 and Q2 as proposed; §5's tag scope refined in step 1                                     |
| Tracked | GUI-ENV-BREAKDOWN New-54                                                                                                       |
| Touches | Password vault file format (version 2), `VaultService` and its siblings, `VaultSession`, unlock and recovery UI, CLI `recover` |

## 1. Summary

A password vault can require a **key file** as well as its master password:
a small random file the user keeps apart from the vault (a USB stick, another
drive). Both go into the key that decrypts the vault, so a copy of the vault
file plus its password, stolen, synced or found in a backup, opens nothing
without the key file. It's opt-in per vault, in the desktop app. Hardware
keys (YubiKey, FIDO2) are a later step, after a spike (§10).

## 2. Decisions (author, 2026-10-23)

| #   | Question                    | Decision                                                                                  |
| --- | --------------------------- | ----------------------------------------------------------------------------------------- |
| D1  | Which factor first          | **Key file.** Hardware keys after a spike shows Electron support on macOS, Windows, Linux |
| D2  | Recovery key with 2FA on    | **Opens the vault alone.** Losing the key file isn't losing the vault                     |
| D3  | "Remember on this computer" | **Keeps the password only.** The key file is still needed at every unlock                 |
| D4  | Which vaults                | **Password vaults only.** Env vaults stay as they are (CLI, CI and agent unlock them)     |

## 3. What it protects, and what it doesn't

| Threat                                                                                                          | Protected?                            |
| --------------------------------------------------------------------------------------------------------------- | ------------------------------------- |
| Vault file copied (stolen laptop backup, synced folder, shared drive) and password leaked, guessed or keylogged | **Yes**, without the key file         |
| Vault file copied, password brute-forced offline                                                                | **Yes**: the key adds 256 random bits |
| Key file kept next to the vault, or in the same synced folder                                                   | No: the app warns, can't prevent it   |
| Someone with the recovery key (D2)                                                                              | No, by design: keep it offline        |
| Malware on the computer while the vault is unlocked                                                             | No (true of every vault)              |
| Someone using your account with the key file plugged in                                                         | No, beyond the password               |

Why not codes from an authenticator app (TOTP): there's no server to check
them. The app would keep the code secret beside the vault, and anyone with
the file and the password could decrypt it without the app. It would lock
the screen, not the data.

## 4. Key file

```json
{
  "type": "secure-vault-key-file",
  "version": 1,
  "key": "<32 random bytes, base64>"
}
```

- Created by the app ("Create key file…", a save dialog), mode 0600. The
  app warns when it's saved in the vault's folder, and says to keep a copy
  somewhere safe; the recovery key is the fallback (D2).
- Only this format is accepted, not "any file": a photo or document used as
  a key file changes when it's edited or re-saved, and the vault is gone.
- One key file can serve several vaults; each vault records its `id`
  (the first 8 bytes of SHA-256 of the key, hex), so the app can say "wrong
  key file" rather than "wrong password". It reveals nothing useful: the key
  is 256 random bits.

## 5. Format 2

Today (format 1) the payload is encrypted under `PBKDF2(password, salt)`,
and the recovery key works by encrypting a copy of the master password.
Neither survives a second factor: the password alone no longer derives the
key, and recovering the password isn't enough to open the vault (D2 needs
the recovery key to open it alone).

Format 2 encrypts the payload under a random **data key** (DEK) and keeps
the DEK twice, wrapped in two slots:

```json
{
  "version": 2,
  "features": ["keyfile"],
  "salt": "…", "kdf": { "name": "pbkdf2-sha512", "iterations": 600000 },
  "keyFile": { "id": "9f2c41a0b7d3e815" },
  "slots": {
    "main":     { "iv": "…", "authTag": "…", "wrapped": "…" },
    "recovery": { "salt": "…", "kdf": { … }, "iv": "…", "authTag": "…", "wrapped": "…" }
  },
  "iv": "…", "authTag": "…", "encrypted": "…"
}
```

- `main` KEK = `HKDF-SHA256(ikm = PBKDF2(password, salt) ‖ keyFileKey,
salt = salt, info = "secure-vault password-vault v2 main")`.
- `recovery` KEK = `PBKDF2(recoveryKey, slots.recovery.salt)`.
- Every AES-256-GCM operation takes plaintext header fields as additional
  data, as env format 2 does (New-37), so an edited header refuses to
  open. **Rev. 2:** each slot's tag covers the format (`version`,
  `features`) and its own settings only (`main`: `salt`, `kdf`,
  `keyFile.id`; `recovery`: its `salt`, `kdf`), so re-wrapping one slot
  never needs the other slot's key; a session holding only the DEK can
  still make a new recovery key. The payload's tag covers all of them and
  is re-sealed whenever the header changes.
- Each slot keeps a `check` (128 bits of HMAC of its key, like env format
  2's `keyCheck`), so a wrong password or recovery key is told from a
  changed file.
- `recoveryMetadata` (format 1's copy of the master password under the
  recovery key) isn't written in format 2.

What each operation costs:

| Operation                    | Touches                       | PBKDF2 |
| ---------------------------- | ----------------------------- | ------ |
| Save                         | payload, under the DEK        | none   |
| Change password or key file  | `main` slot only              | one    |
| New recovery key             | `recovery` slot only          | one    |
| Unlock (password + key file) | `main` slot, then payload     | one    |
| Recover                      | `recovery` slot, then payload | one    |

## 6. The app

- **Session custody.** A format-2 vault's session holds the **DEK**
  (zeroed on lock), not the password. `withPassword(name, fn)` callers get
  `withKey`; `VaultService` load/save take `{password}` (format 1) or
  `{dek}` (format 2). The page never sees either, as today.
- **Turn on** (Settings → Security → "Require a key file"): re-enter the
  password; create a key file or pick an existing one; the app checks a
  recovery key exists, or makes one and shows it first (without it, a lost
  key file is a lost vault). The vault is rewritten as format 2.
- **Unlock:** the password field plus "Key file…". The app may remember
  the key file's **location**, never its content (open question Q1). A
  saved password (D3) fills the password; the key file is still read.
- **Recover** with the recovery key alone (D2): the session opens, and the
  app asks for a new password and offers a new key file before going on.
- **Turn off:** re-enter the password and key file; the vault is rewritten
  as format 1, which older versions open again, with a new recovery key
  (format 1's recovery needs the password copy that format 2 doesn't keep).
- **Change key file** (lost or compromised): re-wraps `main` only.
- **Export / import:** an export of a format-2 vault carries its file;
  importing it asks for the password and the key file, or the recovery key.

## 7. Other tools

- **CLI `recover`** opens a format-2 vault with the recovery key (D2); it
  has no other password vault commands to change.
- **Older app or CLI:** format 2 is newer than they read, so they refuse it
  with the existing "upgrade" message (New-29), and never overwrite it.

## 8. Rollout

Opt-in per vault, and the user chooses the moment, so this release both
reads and writes format 2 (unlike env format 2, New-50, where every write
would change formats silently). The "Turn on" dialog says older versions
and other computers need this version to open the vault. CHANGELOG "Added".
Rollback: an older app can't open a format-2 vault; turning 2FA off first
makes it format 1 again.

## 9. Risks

| Risk                                | Mitigation                                                                                              |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------- |
| Key file and recovery key both lost | Turning on requires a recovery key; the dialog says what's at stake                                     |
| Key file saved next to the vault    | Warned when created or picked; the guide says why                                                       |
| A bug in the format-2 writer        | Test vectors for every derivation; write to temp and re-open before replacing, as today; `.backup` kept |
| DEK lingering in memory             | Buffer zeroed on lock, as `EnvVaultSession` does                                                        |
| Users expect TOTP                   | The guide says why a local file can't use it                                                            |

## 10. Plan

1. Format 2 crypto as pure functions (`passwordVaultEnvelope.js`): seal,
   open, wrap/unwrap slots, key file parse and id; test vectors.
2. `VaultService` (and settings, import/export) read and write format 2;
   `VaultSession` holds the DEK.
3. Turn on / off / change key file, in main and in Settings.
4. Unlock with a key file; the saved-password path (D3).
5. Recovery with the recovery key, app and CLI.
6. Guide, CHANGELOG, e2e scenario.
7. Later: a spike on FIDO2 `hmac-secret`/PRF in Electron on the three OSes;
   a hardware key would be another `main`-style slot.

## 11. Questions answered (author, 2026-10-23)

- **Q1.** The app remembers the key file's **location** per vault, never its
  content, with "Choose another key file…" on the unlock screen.
- **Q2.** Turning 2FA off writes format 1 again, with a new recovery key.
