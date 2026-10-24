# Spike: a hardware security key as a password vault factor (New-56)

- **Question** (PASSWORD-VAULT-2FA-RFC.md step 7): can the desktop app get a
  stable secret from a FIDO2 security key (CTAP2 `hmac-secret`, which
  WebAuthn calls PRF) on macOS, Windows and Linux, to use where the key file
  goes today?
- **Date:** 2026-10-24. Desk research plus a read of this repo and of the
  installed Electron (42.11) typings. **Not prototyped:** that needs a
  physical key and a native module; see "If we go ahead".

## Answer

Yes on all three, but **not through Electron's built-in WebAuthn**. Each OS
needs its own native route from the main process, and the CLI would need
the same. It's a sizeable piece of work for a threat the key file already
covers. **Recommendation: don't build it now**; revisit if users ask for a
hardware key specifically.

## Why not Electron's WebAuthn

- The packaged app loads its page from `file://`
  (`src/electron/services/WindowManager.js`). Chromium only runs WebAuthn
  for origins with a domain relying party ID (https, or localhost in a
  browser): a `file://` or custom-scheme page is refused ([Chromium: origins
  that support WebAuthn][origins]; [Clerk's Electron passkeys notes][clerk]).
  Serving the app over https or a local server to get an origin would undo
  the hardening this app relies on.
- Electron 42's `app.configureWebAuthn` only adds the macOS Touch ID
  platform authenticator (installed `electron.d.ts`); nothing there for
  security keys or PRF.

## Per OS, from the main process

| OS      | Route                                                                                    | Catch                                                                                                                                               |
| ------- | ---------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| macOS   | libfido2 (Yubico's C library) over USB HID, which needs no privilege                     | A native module to build, sign and notarize per arch. Apple's AuthenticationServices gives PRF to platform passkeys only ([electron-webauthn][ewa]) |
| Windows | `webauthn.dll`, which takes `hmac-secret` salts ([`WEBAUTHN_HMAC_SECRET_SALT`][winsalt]) | Since Windows 10 1903, raw FIDO HID needs elevation ([go-mswin/webauthn][gomswin]), so libfido2 is out: a second native integration                 |
| Linux   | libfido2 over `hidraw`                                                                   | Needs udev rules giving the user the device (most distros ship them with libfido2 or systemd); no OS dialog, the app draws its own                  |

Security keys: YubiKey 5 / Security Key with firmware 5.2 or later, and
most current FIDO2 keys, support `hmac-secret` ([Yubico PRF guide][yubico]).

## How it would fit the format

Format 2 was built for it. The key's `hmac-secret` output for a stored salt
is 32 bytes, like a key file's key, so it goes where `keyFileKey` goes in
`mainKekOf` (HKDF of the password key and that secret). The vault would
store the credential ID and salt instead of `keyFile.id`. A second key (a
backup) would be a second `main`-style slot: each slot's tag covers only its
own settings, so adding one doesn't touch the others. The recovery slot
and recovery flow stay as they are.

## Costs

- Two native integrations (libfido2; `webauthn.dll`), built for macOS
  x64/arm64, Windows x64/arm64 and Linux x64/arm64, signed and notarized.
- A UI for "touch your key" and PIN entry (keys with a PIN require it for
  `hmac-secret`), since only Windows shows an OS dialog.
- The CLI ships as a standalone binary: it would need the same modules, or
  it couldn't open such vaults except with the recovery key.
- Testing needs physical keys on each OS; CI can't do it, so every release
  needs a hand check.

## If we go ahead

1. A one-day prototype on macOS with libfido2's command line tools
   (`fido2-cred` to make a credential with `hmac-secret`, `fido2-assert` to
   get the secret), to confirm the secret is stable and fits `mainKekOf`.
2. Then the Windows route through `webauthn.dll`, the riskiest part.
3. Then a design note (format: credential ID, salt, several keys) before
   any code, as for the key file.

[origins]: https://chromium.googlesource.com/chromium/src/+/main/content/browser/webauth/origins.md
[clerk]: https://clerk.com/docs/reference/electron/passkeys
[ewa]: https://github.com/iamEvanYT/electron-webauthn/
[winsalt]: https://learn.microsoft.com/en-us/windows/win32/api/webauthn/ns-webauthn-webauthn_hmac_secret_salt
[gomswin]: https://github.com/go-mswin/webauthn
[yubico]: https://developers.yubico.com/WebAuthn/Concepts/PRF_Extension/Developers_Guide_to_PRF.html
