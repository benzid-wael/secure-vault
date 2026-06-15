# Security Issues

Audit performed 2026-06-15 covering the Electron desktop app (`src/`,
`public/`, `bin/`) and the CLI (`bin/`, `src/utils/`, `src/electron/`).

---

## Critical

### C1 — Console leaks decrypted vault contents

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

**File:** `src/electron/services/recovery/UsbRecoveryService.js`

The entire file is a verbatim duplicate of `KeyRecoveryService` with the
method ID changed from `recoveryKey` to `usbDrive`. It does not interact
with USB drives in any way. Same missing `KeyRecoveryService` import bug
as H2 (lines 61, 121, 219, 225, 240, 242).

### H4 — Preload exposes full vault API to the renderer

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

**File:** `src/electron/services/CryptographyService.js:4`

```js
static ITERATIONS = 100000;
```

OWASP 2024 recommends 600 000+ iterations for PBKDF2-HMAC-SHA-512.
While 100 000 provides reasonable protection, a dedicated attacker with
GPU rigs can attempt ~100 000 guesses/second against a stolen vault file.

### M3 — Password comparison is timing-addressable

JavaScript's `!==` operator short-circuits on the first differing character.
In the Electron app (login screen) and CLI (`init` confirmation), the
comparison takes measurably longer when more prefix characters match. A
local attacker with precise timing measurements could recover password
length and prefix.

### M4 — `TMPDIR` in clean-mode allowlist

**File:** `bin/commands/envRunHelpers.js:46`

`TMPDIR` is in the hardcoded allowlist for `--inject clean`. If an attacker
can control the parent process's `TMPDIR`, they can redirect temp-file writes
to an arbitrary path, enabling symlink attacks or env-file exfiltration.

### M5 — Editor temp file exposes previous value as comments

**File:** `bin/commands/envEditHelpers.js:30-31`

When `vault env set <env> <key> --edit` is used, the previous value is
written as `#` comments in the temp file. While the file is created with
`0o600` and securely deleted on exit, a SIGKILL (or editor crash) leaves
the value on disk.

### M6 — Error messages reveal vault paths

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

| File                                       | Used by                                              |
| ------------------------------------------ | ---------------------------------------------------- |
| `src/electron/utils/passwordValidation.js` | Electron app (VaultService, EnvironmentVaultService) |
| `src/utils/passwordValidation.js`          | CLI (renderer bundle, published npm package)         |

Both implement the same rules (8+ chars, upper+lower+digit+special) but
diverge over time. No single source of truth.

### L2 — Dead code: `encryptVault` uses undefined references

**File:** `src/electron/services/VaultService.js:45-74`

The `encryptVault()` method references `RecoveryKeyService` (no such import)
and `vault.toJSON()` where `vault` is undefined. This method is not called
anywhere in the codebase. Likely a leftover from an earlier refactor.

### L3 — No integrity binding beyond authenticated encryption

Vault files use AES-256-GCM which authenticates the ciphertext. However,
there is no HMAC or signature binding the salt, version metadata, and
encrypted payload together. A motivated attacker with write access to the
vault file could swap salts between vault files (though decryption would
still fail without the correct password).

### L4 — `isValid` methods use loose negations

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
