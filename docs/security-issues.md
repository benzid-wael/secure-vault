# Security Issues

Audit performed 2026-06-15 covering the Electron desktop app (`src/`,
`public/`, `bin/`) and the CLI (`bin/`, `src/utils/`, `src/electron/`).

## Status

Re-checked 2026-10-14. A finding marked **Resolved** keeps its original write-up
below for context; everything else is still open.

| ID     | Status                                                                         |
| ------ | ------------------------------------------------------------------------------ |
| C1     | **Resolved** — vault-file log removed from `loadVault()`                       |
| C2     | **Resolved** — password held by a main-process session, see the note under C2  |
| C3     | **Resolved** — recovery-key log removed from `createDefaultVault()`            |
| C4     | **Partly resolved** — see the note under C4                                    |
| H1     | **Resolved** — `recover()` fixed end-to-end, see the note under H1             |
| H2, H3 | **Resolved** — dead, broken services deleted                                   |
| H4     | **Mitigated** — see the note under H4                                          |
| H5     | **Resolved** — dead code removed; vault names contained, see the note under H5 |
| M1     | **Resolved** — every vault write goes through temp + rename                    |
| M2     | Open — needs a vault-format change, see the note under M2                      |
| M3     | **Not an issue** — see the note under M3                                       |
| M4     | **Not an issue** — see the note under M4                                       |
| M5     | Open — accepted trade-off pending a decision, see the note under M5            |
| M6     | **Not an issue** — see the note under M6                                       |
| L1     | **Resolved** — one validator; the two had diverged                             |
| L2     | **Resolved** — dead `encryptVault` deleted                                     |
| L3     | **Not an issue** — see the note under L3                                       |
| L4     | **Resolved** — the loose check was in `PasswordRecoveryService`; fixed         |

---

## Critical

### C1 — Console leaks decrypted vault contents

> **Resolved (2026-10-14).** Both log lines are gone from `loadVault()`.

**File:** `src/electron/services/VaultService.js:139-141`

**Applies to:** Electron app only (CLI uses `EnvironmentVaultService` which
does not log the decrypted payload).

`loadVault()` does:

```js
console.log(
  '[VaultService] Vault file loaded:',
  JSON.stringify(vaultFile, null, 2)
);
```

This prints the **full decrypted vault** — every stored entry, password, site,
note, and recovery metadata — to stdout. Visible in:

- Electron DevTools console
- `console.log` output streams (CI logs, `electron-log`, systemd journal)
- Log aggregators that capture stdout

The same function also logs `[VaultService] Loading vault: ${vaultName}` —
less severe but still discloses which vaults a user accesses.

### C2 — Master password stored in React component state

> **Resolved (2026-10-14).** The renderer no longer keeps the password. It sends
> it once over IPC (`unlockVault`, `createVault`, or a recovery call) and the
> main process holds it in a `VaultSession` (`src/electron/services/VaultSession.js`);
> every later call (`loadVault`, `saveVault`, `exportVault`, settings, recovery
> key) names only the vault and is refused while locked. Recovery no longer
> returns the master password to the renderer. The session closes on manual lock,
> on system sleep and screen lock (`powerMonitor`), when the vault is deleted, and on
> quit. Changing the master password still re-checks the current one in the main
> process.
>
> Residual: the string still lives in main-process heap memory and can't be
> zeroed from JS (same limit as `AGENT-DESIGN.md` §8). A compromised renderer
> can still _use_ the open vault through the bridge while it is unlocked; that
> is H4.

**File:** `src/App.jsx:55`

```js
const [vaultPassword, setVaultPassword] = useState('');
```

The plaintext master password is kept in React state for the entire
authenticated session. It is passed via props to `PasswordManager`,
`ConfigurationDialog`, and the `useEntryManagement` hook. Attack surface:

- **React DevTools** — a browser extension can read component state at any time.
- **Memory dump** — the string is a JS heap allocation; core dumps and
  `--inspect` debugging expose it.
- **XSS / component compromise** — any injected script in the renderer reads
  `window.__REACT_DEVTOOLS_GLOBAL_HOOK__` or walks the React fiber tree.

On lock (`lockVault`, line 203–208) the password is set to `''`, but JS
strings are immutable. The previous value remains in heap memory until the
GC runs and the memory is reused. It is never zeroed.

### C3 — Recovery key printed to stdout on default vault creation

> **Resolved (2026-10-14).** `createDefaultVault()` no longer logs; callers
> still get the key in the returned result.

**File:** `src/electron/services/VaultService.js:344-347`

```js
if (result.success) {
  console.log('Default vault created with recovery key:', result.recoveryKey);
}
```

The recovery key can decrypt the master password (via
`KeyRecoveryService.recoverMasterPassword`). Logging it to stdout leaks it
to any process or log file that captures the output.

### C4 — `VAULT_ENV_PASSWORD` remains in `process.env` after read

> **Partly resolved (2026-10-14).** Deleting the key from `process.env` would
> **not** fix the exposure described below: `/proc/$PID/environ` and `ps eww`
> read the environment block the process was started with, which `unsetenv`
> does not touch. The variable is also already in the parent shell's
> environment. Nothing inside the process can undo that.
>
> What the vault _could_ control, and did get wrong, is passing the password on
> to children: `vault env run --merge`, `vault env shell --merge`,
> `vault env agent exec --merge` and the `$EDITOR` spawned by `vault env edit`
> all inherited `VAULT_ENV_PASSWORD`. `buildChildEnv` now drops it in every mode
> (even when it is allowlisted), and the editor gets the same filtered env.
>
> Remaining: document that `--password-file` / `--password-stdin` are the safe
> non-interactive sources, and that the env var is visible to same-UID
> processes for the lifetime of the shell that exported it.

**File:** `src/utils/password.js:115`

```js
if (process.env.VAULT_ENV_PASSWORD) return process.env.VAULT_ENV_PASSWORD;
```

The password is read from the environment but is **not deleted** from
`process.env`. On Linux, `/proc/$PID/environ` is readable by any process
running as the same user. On macOS, `ps eww $PID` shows all environment
variables. No warning is emitted to inform the user that their password is
visible in the process environment.

---

## High

### H1 — `VaultRecoveryService` uses undefined variable `finalName`

> **Resolved (2026-10-14).** Besides `finalName`, the same path had: the
> temp-vault error branch reading an undefined `is_valid`, an un-awaited
> `vaultExists()` (always truthy), and `console.log` calls dumping the vault file
> and recovery metadata. In `bin/cli.js`, `recover` was never awaited (so the
> CLI always reported success) and called the non-existent `spinner.failed`.
> All fixed; the command now exits non-zero on failure. Covered by
> `src/__tests__/electron/services/VaultRecoveryService.test.js`.

**File:** `src/electron/services/VaultRecoveryService.js:121,126`

```js
let fileName = `${vaultName}-recovered.vault`;
while (await fs.pathExists(path.join(this.vaultDir, finalName))) {
  //                                    ^^^^^^^^^ undefined
  idx++;
  fileName = `${vaultName}-recovered-${idx}.vault`;
}
await fs.move(tempPath, path.join(this.vaultDir, finalName), {
  overwrite: true,
});
//                                          ^^^^^^^^^ undefined
```

`finalName` is never declared. This will throw a `ReferenceError` at runtime
when the recovery method reaches this code path. The entire recovery flow
(the `recover()` method at the CLI or any caller) will fail with an
unhandled exception.

### H2 — `SecretQuestionRecoveryService` is non-functional

> **Resolved (2026-10-14).** Nothing imported it; deleted. Rebuild it from scratch
> if secret-question recovery is ever wanted.

**File:** `src/electron/services/recovery/SecretQuestionRecoveryService.js`

Multiple defects make this class unusable:

1. **Missing import** — `KeyRecoveryService` is referenced (lines 69, 86,
   101, 211, 221, 256, 262) but never imported. Uses `KeyRecoveryService`
   static methods that do not exist at runtime.
2. **Global variable** — `encryptedQuestions = []` (line 84) is not declared
   with `const`/`let`/`var`, creating an implicit global.
3. **Inverted recovery logic** — `recoverMasterPassword` (line 209) does:
   ```js
   if (questionHash !== storedQuestion.questionHash) {
     // attempt to decrypt and return — skips the matching question
   }
   ```
   This continues iterating when the hash does **not** match, and attempts
   decryption when the hash matches — exactly inverted.
4. **Wrong argument count** — `CryptographyService.encrypt()` is called with
   3–4 arguments (lines 101–106); the method accepts exactly 2
   (data, key).
5. **Missing `crypto` import** — `#generateRecoveryKey()` (line 244) calls
   `crypto.randomBytes(32)` but `crypto` is not imported.

### H3 — `UsbRecoveryService` is a copy-paste of `KeyRecoveryService`

> **Resolved (2026-10-14).** Nothing imported it; deleted.

**File:** `src/electron/services/recovery/UsbRecoveryService.js`

The entire file is a verbatim duplicate of `KeyRecoveryService` with the
method ID changed from `recoveryKey` to `usbDrive`. It does not interact
with USB drives in any way. Same missing `KeyRecoveryService` import bug
as H2 (lines 61, 121, 219, 225, 240, 242).

### H4 — Preload exposes full vault API to the renderer

> **Mitigated (2026-10-14).** The page still needs most of these calls, so the
> surface can't shrink to nothing; what changed is what a compromised renderer
> can do with it:
>
> - **Sender check.** Every IPC handler goes through one guard that accepts
>   calls only from the main window's top-level frame
>   (`SecurityManager.isTrustedSender`).
> - **No password to steal** (C2): calls act on the unlocked vault only; while
>   locked they are refused.
> - **No renderer-chosen paths.** `exportVault` used to write to any path the
>   page supplied, overwriting whatever was there. The main process now picks
>   the destination in a native save dialog. `importVault` reads only the file
>   picked in the native open dialog.
> - **Rollback needs the vault unlocked.** `restoreVaultBackup` overwrote a
>   vault with its backup without authentication.
> - **Vault names validated** at the IPC boundary (see H5).
>
> Remaining: while a vault is unlocked, injected script can still read its
> entries through `loadVault` and save changes. Only preventing script injection
> (CSP, no `dangerouslySetInnerHTML` on vault data) closes that.

**File:** `public/preload.js`

Every IPC handler is exposed via `contextBridge.exposeInMainWorld`:

- `createVault`, `loadVault`, `saveVault`, `deleteVault`
- `changeMasterPassword`, `exportVault`, `importVault`
- `generateRecoveryKey`, `loadVaultWithRecoveryKey`
- `recoverVaultWithOldPassword`

Mitigations in place (`contextIsolation: true`, `nodeIntegration: false`,
`webSecurity: true`) prevent direct Node access, but the API surface is
broad. A renderer XSS or prototype-pollution attack can call any of these
IPC handlers to exfiltrate or destroy vault data.

### H5 — Path traversal sanitisation trivially bypassable

> **Resolved (2026-10-14).** `sanitizePath` was never called, so the bypass
> wasn't reachable. It's deleted. The real gap was elsewhere: vault names from
> the renderer were joined into file paths unchecked (`../../x` →
> `<vaultDir>/../../x.vault`), and the existing `validateVaultName` was never
> called. Now IPC handlers validate every vault name, and `VaultFileService`
> refuses any name that resolves outside the vault directory. That second check
> covers the CLI too.

**File:** `src/electron/services/SecurityManager.js:94-97`

```js
sanitizePath(filePath) {
  return filePath.replace(/\.\./g, '').replace(/\/\//g, '/');
}
```

- Input `....` → output `..` (double-dot after removing the inner pair)
- Input `.../.../etc` → output `../etc`
- No check that the resolved path stays within an expected base directory

---

## Medium

### M1 — `writeVaultFile` is not atomic

> **Resolved (2026-10-14).** `writeVaultFile` now delegates to
> `atomicWriteVaultFile` (temp file, read-back, rename), so saves, creates,
> imports, settings updates and recovery-key generation are all crash-safe.

**File:** `src/electron/services/VaultFileService.js:52-54`

```js
async writeVaultFile(vaultName, data) {
  const vaultPath = this.getVaultPath(vaultName);
  return fs.writeJSON(vaultPath, data, { spaces: 2 });
}
```

Writes directly to the vault file. A crash mid-write produces a truncated or
corrupt file. Contrast with `atomicWriteVaultFile` (line 57) which uses a
temp + rename pattern but is only called by `changePassword`.

`writeVaultFile` is called by:

- `VaultService.createVault()` (default vault, any new vault)
- `VaultService.saveVault()` (regular saves in the Electron app)
- `VaultService.generateRecoveryKey()`

The CLI (`EnvironmentVaultService.saveVault`) uses the correct atomic pattern.
This is an inconsistency between the app and CLI implementations.

### M2 — PBKDF2 iteration count below current recommendation

> **Open (2026-10-14).** Vault files don't record their iteration count, so
> raising it means a format change and migrating existing vaults. Also, the
> desktop app currently derives the key on _every_ load/save; at 600k
> iterations each save would take noticeably longer unless the session caches
> the derived key instead of the password. Desktop vaults and CLI env vaults
> share `CryptographyService`, so both are affected.

**File:** `src/electron/services/CryptographyService.js:4`

```js
static ITERATIONS = 100000;
```

OWASP 2024 recommends 600 000+ iterations for PBKDF2-HMAC-SHA-512.
While 100 000 provides reasonable protection, a dedicated attacker with
GPU rigs can attempt ~100 000 guesses/second against a stolen vault file.

### M3 — Password comparison is timing-addressable

> **Not an issue (2026-10-14).** Unlocking never compares password strings:
> the password is checked by trying to decrypt the vault. The `!==` calls left
> compare a new password with its confirmation, both typed by the same user in
> the same process, so there is no secret on the other side to leak. The one
> renderer-side comparison against the stored password was removed with C2.

JavaScript's `!==` operator short-circuits on the first differing character.
In the Electron app (login screen) and CLI (`init` confirmation), the
comparison takes measurably longer when more prefix characters match. A
local attacker with precise timing measurements could recover password
length and prefix.

### M4 — `TMPDIR` in clean-mode allowlist

> **Not an issue (2026-10-14).** An attacker who controls the parent process's
> environment already controls `PATH`, `HOME` and the command being run, so
> `TMPDIR` adds no capability. Dropping it would break tools that need a temp
> directory under `clean`.

**File:** `bin/commands/envRunHelpers.js:46`

`TMPDIR` is in the hardcoded allowlist for `--inject clean`. If an attacker
can control the parent process's `TMPDIR`, they can redirect temp-file writes
to an arbitrary path, enabling symlink attacks or env-file exfiltration.

### M5 — Editor temp file exposes previous value as comments

> **Open (2026-10-14).** Real but minor. Even without the comments, the _new_
> value sits in the same `0600` temp file while the editor is open, so a SIGKILL
> exposes it too. Dropping the previous-value comments narrows the exposure but
> removes useful context when editing. Needs a product decision.

**File:** `bin/commands/envEditHelpers.js:30-31`

When `vault env set <env> <key> --edit` is used, the previous value is
written as `#` comments in the temp file. While the file is created with
`0o600` and securely deleted on exit, a SIGKILL (or editor crash) leaves
the value on disk.

### M6 — Error messages reveal vault paths

> **Not an issue (2026-10-14).** The path in this message is the one the user
> passed to `--password-file`, printed back in their own terminal. Hiding it
> would make the error harder to act on and protects nothing.

**File:** `src/utils/password.js:91`

Error messages include the full resolved file path:

```
cannot read password file "/Users/foo/Library/Application Support/secure-vault/envs/project.env.vault": ENOENT
```

This leaks the vault directory layout, vault naming scheme, and which vaults
exist. Visible in CI logs, terminal scrollback, and error-reporting tools.

---

## Low

### L1 — Duplicate password validation implementations

> **Resolved (2026-10-14).** Worse than reported: the two had already diverged.
> The renderer used a strength score and accepted e.g. `Password123`, which the
> main process then rejected for lacking a special character. There is now one
> `validatePasswordStrength` in `src/utils/passwordValidation.js` with the main
> process's rules, used by the desktop main process, the CLI and the renderer.
> "Special character" now means any non-alphanumeric character.

| File                                       | Used by                                              |
| ------------------------------------------ | ---------------------------------------------------- |
| `src/electron/utils/passwordValidation.js` | Electron app (VaultService, EnvironmentVaultService) |
| `src/utils/passwordValidation.js`          | CLI (renderer bundle, published npm package)         |

Both implement the same rules (8+ chars, upper+lower+digit+special) but
diverge over time. No single source of truth.

### L2 — Dead code: `encryptVault` uses undefined references

> **Resolved (2026-10-14).** Deleted.

**File:** `src/electron/services/VaultService.js:45-74`

The `encryptVault()` method references `RecoveryKeyService` (no such import)
and `vault.toJSON()` where `vault` is undefined. This method is not called
anywhere in the codebase. Likely a leftover from an earlier refactor.

### L3 — No integrity binding beyond authenticated encryption

> **Not an issue (2026-10-14).** The key is derived from the salt, so a swapped
> salt (or any edited header field that feeds the key) just makes GCM
> authentication fail. Nothing is gained by binding it again.

Vault files use AES-256-GCM which authenticates the ciphertext. However,
there is no HMAC or signature binding the salt, version metadata, and
encrypted payload together. A motivated attacker with write access to the
vault file could swap salts between vault files (though decryption would
still fail without the correct password).

### L4 — `isValid` methods use loose negations

> **Resolved (2026-10-14).** The cited `KeyRecoveryService.isValid` was
> correct, just hard to read; it's rewritten. The loose check the finding
> describes was really in `PasswordRecoveryService.isValid`, which accepted
> metadata missing one of its two required fields. Fixed.

**File:** `src/electron/services/recovery/KeyRecoveryService.js:32`

```js
if (
  !!!metadata ||
  !metadata?.salt ||
  !metadata?.encryptedMasterPassword ||
  !metadata?.encryptedRecoveryKey
) {
  return false;
}
```

The triple negation `!!!metadata` is a readability issue. When `metadata` is
`null`, `!metadata?.salt` evaluates to `true` (metadata is null, optional
chaining returns `undefined`, negated to `true`), so the method correctly
returns `false`. But the logic is fragile: a metadata object with only two
of the three required fields would silently pass validation instead of
returning `false`.

---

## Appendix: Severity Definitions

| Level        | Meaning                                                                                                                 |
| ------------ | ----------------------------------------------------------------------------------------------------------------------- |
| **Critical** | Direct secret exposure — plaintext password, vault contents, or recovery key visible to unauthorised observers.         |
| **High**     | Exploitable vulnerability — broken recovery service (hides data permanently), overly broad API surface, path traversal. |
| **Medium**   | Defence-in-depth gap — race condition, weak params, info leakage, timing side-channel.                                  |
| **Low**      | Code-quality concern — dead code, duplication, readability issues with minor security implications.                     |
