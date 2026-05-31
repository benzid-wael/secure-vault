# Code Signing

Releases currently ship **unsigned** (see the bypass steps in the README). This
guide explains how to sign and notarize the builds so users no longer see
"unidentified developer" / SmartScreen warnings.

Signing is **optional** and requires paid certificates. The release workflow
works without any of this — it only signs when the relevant secrets are
present. Set up one platform at a time; they are independent.

> The project uses `electron-builder` 24.13. All signing is driven by
> environment variables / secrets — no plaintext credentials live in the repo.

---

## Overview

| Platform | What you need                                    | Cost (approx.)  |
| -------- | ------------------------------------------------ | --------------- |
| macOS    | Apple Developer Program + Developer ID cert      | $99 / year      |
| Windows  | OV or EV code-signing cert (on HSM/token)        | $200–600 / year |
| Linux    | Nothing required; optionally GPG-sign / checksum | free            |

Two distinct things get signed: the **GUI** (Electron, via electron-builder)
and the **standalone CLI binaries** (Bun-compiled, signed manually). The CLI
section is at the end.

---

## macOS

Signing a Mac app for distribution outside the App Store needs a **Developer ID
Application** certificate plus **notarization** (Apple scans the app and staples
a ticket). electron-builder does both automatically when configured.

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

## Linux

`.AppImage` and `.deb` are not code-signed in the macOS/Windows sense. Common
practice is to publish **SHA-256 checksums** alongside the artifacts and,
optionally, **GPG-sign** them so users can verify integrity. To add checksums to
the release, generate them in the `release` job before attaching files:

```yaml
- run: |
    cd release
    sha256sum * > SHA256SUMS
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

- [ ] macOS: Developer ID cert exported, notarization creds, secrets set, `build.mac` updated, entitlements file added, workflow env wired, `CSC_IDENTITY_AUTO_DISCOVERY` removed.
- [ ] Windows: signing method chosen (Trusted Signing / HSM / legacy pfx), secrets set, workflow wired.
- [ ] Linux: checksums (and optional GPG signature) published.
- [ ] CLI binaries: signed/notarized, or bypass documented (current state).
