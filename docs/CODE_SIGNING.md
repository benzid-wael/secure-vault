# Code Signing

The release ships **SHA-256 checksums for every artifact by default** and, when
a GPG key is configured, a **GPG signature** over those checksums — both free.
The macOS GUI/installers and Windows installers still ship **unsigned** in the
OS-trust sense (see the bypass steps in the README); this guide explains how to
add the paid signing/notarization that removes the "unidentified developer" /
SmartScreen warnings.

> **There is no free way to remove the macOS Gatekeeper or Windows SmartScreen
> warning.** Those warnings come from OS trust chains rooted in paid CAs (Apple
> Developer Program; Windows OV/EV CAs). Free options — checksums, GPG, ad-hoc
> codesign, self-signed certs — provide **integrity / authenticity** (proof the
> file was not tampered with), never **trust** (the OS still warns). Anyone
> claiming otherwise is wrong, and a self-signed Windows cert is _worse_ than
> none — it reads as malware. Treat the warning as the cost of free
> distribution, and give users checksums to verify integrity regardless.

Paid signing is **optional**. The release workflow works without any of it — it
only signs when the relevant secrets are present. Set up one platform at a time;
they are independent.

> The project uses `electron-builder` 24.13. All signing is driven by
> environment variables / secrets — no plaintext credentials live in the repo.

---

## Overview

| Platform | Free (default)                      | OS warning removed? | Paid upgrade                                                    | Cost (approx.)   |
| -------- | ----------------------------------- | ------------------- | --------------------------------------------------------------- | ---------------- |
| Linux    | checksums + GPG (default)           | n/a (no Gatekeeper) | —                                                               | free             |
| macOS    | checksums; optional ad-hoc codesign | ❌ no               | Apple Developer Program + Developer ID + notarization           | $99 / year       |
| Windows  | checksums                           | ❌ no               | OV or EV code-signing cert (HSM/token) or Azure Trusted Signing | ~$120–600 / year |

Two distinct things get signed: the **GUI** (Electron, via electron-builder)
and the **standalone CLI binaries** (Bun-compiled, signed manually). The CLI
section is at the end.

---

## macOS

Signing a Mac app for distribution outside the App Store needs a **Developer ID
Application** certificate plus **notarization** (Apple scans the app and staples
a ticket). electron-builder does both automatically when configured.

> **Free ad-hoc alternative (does _not_ remove the warning).** `codesign -s -`
> applies an ad-hoc signature with no identity. It gives the binary a stable
> code signature — useful on Apple Silicon, where unsigned/modified binaries can
> be killed as "damaged" — but Gatekeeper still shows "unidentified developer",
> so users bypass it the same way. It is a robustness nicety, not a trust
> solution. The genuine fix is the paid Developer ID path below.

### 1. Get the certificate

1. Enrol in the [Apple Developer Program](https://developer.apple.com/programs/)
   ($99/yr).
2. In Xcode (**Settings → Accounts → Manage Certificates → +**) or the
   [Developer portal](https://developer.apple.com/account/resources/certificates),
   create a **Developer ID Application** certificate.
3. Export it from **Keychain Access** as a `.p12` (right-click the cert → Export),
   choosing a strong password. Export the cert **with its private key**.

### 2. Create credentials for notarization

Use an **App Store Connect API key** (recommended — no password rotation) or an
Apple ID app-specific password.

- **API key**: App Store Connect → **Users and Access → Integrations → App Store
  Connect API → +**. Download the `.p8` (once only). Note the **Key ID** and
  **Issuer ID**.
- **App-specific password** (simpler): [appleid.apple.com](https://appleid.apple.com)
  → Sign-In and Security → App-Specific Passwords. Also note your **Team ID**
  (Developer portal → Membership).

### 3. Encode the certificate for CI

```bash
base64 -i DeveloperID.p12 | pbcopy   # macOS: copies to clipboard
```

Store the base64 string as the `CSC_LINK` secret (below).

### 4. Configure electron-builder

Add hardened runtime, entitlements, and notarization to the `build.mac` block in
`package.json`:

```jsonc
"mac": {
  "category": "public.app-category.utilities",
  "target": ["dmg", "zip"],
  "hardenedRuntime": true,
  "gatekeeperAssess": false,
  "entitlements": "build/entitlements.mac.plist",
  "entitlementsInherit": "build/entitlements.mac.plist",
  "notarize": { "teamId": "YOUR_TEAM_ID" }
}
```

Create `build/entitlements.mac.plist` (Electron needs these for the hardened
runtime + JIT):

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
  <dict>
    <key>com.apple.security.cs.allow-jit</key>
    <true/>
    <key>com.apple.security.cs.allow-unsigned-executable-memory</key>
    <true/>
    <key>com.apple.security.cs.disable-library-validation</key>
    <true/>
  </dict>
</plist>
```

### 5. Add GitHub secrets

| Secret                        | Value                                        |
| ----------------------------- | -------------------------------------------- |
| `CSC_LINK`                    | base64 of the `.p12`                         |
| `CSC_KEY_PASSWORD`            | the `.p12` export password                   |
| `APPLE_TEAM_ID`               | your 10-char Team ID                         |
| `APPLE_API_KEY`               | base64 of the `.p8` _(API-key route)_        |
| `APPLE_API_KEY_ID`            | Key ID _(API-key route)_                     |
| `APPLE_API_ISSUER`            | Issuer ID _(API-key route)_                  |
| `APPLE_ID`                    | Apple ID email _(app-password route)_        |
| `APPLE_APP_SPECIFIC_PASSWORD` | app-specific password _(app-password route)_ |

Provide **either** the API-key trio **or** the Apple-ID pair, not both.

### 6. Wire it into the workflow

In `.github/workflows/release.yml`, on the **macOS** matrix leg, expose the
secrets as env on the `electron-builder` step and **remove**
`CSC_IDENTITY_AUTO_DISCOVERY: 'false'` (that flag exists only to disable signing):

```yaml
- name: Package
  if: runner.os == 'macOS'
  run: npx electron-builder --publish never
  env:
    CSC_LINK: ${{ secrets.CSC_LINK }}
    CSC_KEY_PASSWORD: ${{ secrets.CSC_KEY_PASSWORD }}
    APPLE_TEAM_ID: ${{ secrets.APPLE_TEAM_ID }}
    APPLE_API_KEY: ${{ secrets.APPLE_API_KEY }}
    APPLE_API_KEY_ID: ${{ secrets.APPLE_API_KEY_ID }}
    APPLE_API_ISSUER: ${{ secrets.APPLE_API_ISSUER }}
```

> Notarization adds a few minutes to the macOS build while Apple processes the
> upload. Verify locally with `spctl -a -vvv "/Applications/Secure Password Manager.app"`.

---

## Windows

Since June 2023, public CAs must issue code-signing private keys on a **FIPS
140-2 hardware token or cloud HSM** — you can no longer export a plain
`.pfx`/`.p12` for new certificates. Pick one of:

### Option A — Azure Trusted Signing (recommended, cloud, low cost)

A managed signing service (~$10/month) that needs no hardware token and works
in CI. electron-builder supports it via a custom sign step or the
`@electron/windows-sign` tooling.

1. Create an **Azure Trusted Signing** account + certificate profile (requires
   identity validation; individuals supported).
2. Create a service principal and store its credentials as secrets
   (`AZURE_TENANT_ID`, `AZURE_CLIENT_ID`, `AZURE_CLIENT_SECRET`).
3. Sign via the Azure `Invoke-TrustedSigning` task or a custom electron-builder
   `sign` hook pointing at `signtool` + the Trusted Signing dlib.

EV-level reputation is immediate, so SmartScreen does not warn.

### Option B — Cloud HSM via a signing provider

Services like **SSL.com eSigner**, **DigiCert KeyLocker**, or **SignPath**
expose `signtool`-compatible signing in CI without a physical token. Follow the
provider's CI guide; most provide a `signtool` wrapper you call from an
electron-builder `sign` hook.

### Option C — Legacy `.pfx` (only if you already hold an exportable cert)

If you have a pre-2023 OV cert as a `.pfx`, the classic path still works:

| Secret             | Value                |
| ------------------ | -------------------- |
| `CSC_LINK`         | base64 of the `.pfx` |
| `CSC_KEY_PASSWORD` | the `.pfx` password  |

On the Windows matrix leg, expose those two as env (same shape as the macOS
step). No `package.json` change is needed — electron-builder signs NSIS and
portable targets automatically when `CSC_LINK` is present.

> **OV vs EV reputation:** OV-signed installers still trigger SmartScreen until
> they build download reputation. EV / Azure Trusted Signing avoid the warning
> from day one.

---

## Linux (default — checksums + GPG)

Linux has no Gatekeeper/SmartScreen equivalent, so there is nothing to "sign
away". The free, standard practice — and the project's **default** — is to ship
a **SHA-256 checksum manifest** for every artifact and, when a key is available,
a **detached GPG signature** over that manifest so users can verify both
integrity and authenticity.

Both are produced by the `release` job in
[`.github/workflows/release.yml`](../.github/workflows/release.yml):

- **`SHA256SUMS`** — always generated, covers every artifact (Linux, macOS, and
  Windows alike).
- **`SHA256SUMS.asc`** — a detached, armored GPG signature of `SHA256SUMS`.
  Generated only when the signing secrets are present; the step skips cleanly
  otherwise so the release never fails on a missing key.

### Enable GPG signing

1. Generate a signing key locally (skip if you already have one):

   ```bash
   gpg --batch --gen-key <<EOF
   Key-Type: eddsa
   Key-Curve: ed25519
   Name-Real: Secure Vault Releases
   Name-Email: releases@example.com
   Expire-Date: 0
   %no-protection
   EOF
   ```

2. Export the **private** key, **base64-encode it**, and add the result as the
   `GPG_PRIVATE_KEY` secret:

   ```bash
   # macOS
   gpg --armor --export-secret-keys releases@example.com | base64 | pbcopy
   # Linux
   gpg --armor --export-secret-keys releases@example.com | base64 -w0 | xclip -selection clipboard
   ```

   Base64 is used so the multi-line armored key survives being pasted into a
   GitHub secret. Storing the raw armored block directly tends to collapse its
   newlines, which makes `gpg --import` fail with `no valid OpenPGP data found`.
   The workflow base64-decodes the secret before importing.

3. If the key has a passphrase, also set `GPG_PASSPHRASE`. (The example above
   uses `%no-protection`, so no passphrase is needed.)

4. Publish the **public** key (export with `gpg --armor --export`) somewhere
   users can fetch it — the repo README, a keyserver, or the release notes — so
   they can verify.

| Secret            | Value                                                                    |
| ----------------- | ------------------------------------------------------------------------ |
| `GPG_PRIVATE_KEY` | **base64** of the armored private key (`--export-secret-keys \| base64`) |
| `GPG_PASSPHRASE`  | key passphrase _(only if the key has one)_                               |

### How users verify

```bash
# integrity (always available)
sha256sum -c SHA256SUMS

# authenticity (when SHA256SUMS.asc is present)
gpg --import release-pubkey.asc          # one-time, from a trusted source
gpg --verify SHA256SUMS.asc SHA256SUMS
```

---

## Standalone CLI binaries

The Bun-compiled `vault-*` binaries are **separate** from the Electron app and
are not signed by electron-builder. Until they are signed, users bypass
Gatekeeper once (`xattr -d com.apple.quarantine vault`), as documented in the
README.

To sign them, add steps to the `build-cli` job after compilation:

- **macOS** binaries: `codesign --sign "Developer ID Application: …" --options runtime vault-macos-arm64`, then notarize with `xcrun notarytool submit`. (Note: cross-compiled macOS binaries can only be signed/notarized on a macOS runner, so this requires splitting the CLI build per-OS or adding a macOS signing leg.)
- **Windows** `.exe`: sign with the same `signtool` / Azure Trusted Signing setup as the GUI.

This is lower priority than the GUI — most CLI users run from a terminal where
the warnings are easy to bypass.

---

## Checklist

- [x] Linux (default): `SHA256SUMS` always published; `SHA256SUMS.asc` published when `GPG_PRIVATE_KEY` is set.
- [ ] GPG signing: key generated, `GPG_PRIVATE_KEY` (+ `GPG_PASSPHRASE` if any) secrets set, public key published for users.
- [ ] macOS (paid): Developer ID cert exported, notarization creds, secrets set, `build.mac` updated, entitlements file added, workflow env wired, `CSC_IDENTITY_AUTO_DISCOVERY` removed.
- [ ] Windows (paid): signing method chosen (Trusted Signing / HSM / legacy pfx), secrets set, workflow wired.
- [ ] CLI binaries: signed/notarized, or bypass documented (current state).
