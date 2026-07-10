# Delivering secrets to files

[`vault env run --export`](/guide/cli/env-vaults#running-commands-with-secrets)
covers tools that read a single `.env`. Native mobile builds (iOS/Android,
Firebase, signing) need **several typed files** instead — a decoded
`GoogleService-Info.plist`, an `.xcconfig`, a keystore. Three mechanisms cover
that, and **none require vault to understand the target file format.**

::: warning These are real deliveries, not temp files
Unlike `run --export`, `file` and `apply` leave files in place for the build tool
to read. Add every delivered path to `.gitignore` so a decoded secret is never
committed, and run `clean` when you're done.
:::

## Store a file _into_ the vault

`set --in` reads a file as the value; `--encode base64` handles binary blobs
(keystores, Firebase plists) that don't survive as text:

```bash
vault env set GOOGLE_PLIST --in GoogleService-Info.plist --encode base64 -e dev
vault env set NOTES --in release-notes.txt -e dev        # text file, stored as-is
```

## Materialize one variable _out_ to a file

`file` writes a single value to disk (`0600` by default), optionally
base64-decoding it:

```bash
vault env file GOOGLE_PLIST --out ios/GoogleService-Info.plist --decode base64 -e dev
vault env file API_URL --out .env.local --mode 0640 -e dev
```

## Render any config format with a template

A `.vtpl` file is plain text in _any_ format with `{{KEY}}` placeholders. Vault
substitutes resolved values and writes the result (output path = the template path
minus `.vtpl`). Because vault never parses the format, the **same** mechanism
produces `.xcconfig`, `Info.plist`, `gradle.properties`, XML, JSON — anything.

```ini
# ios/Secrets.xcconfig.vtpl
API_URL = {{API_URL}}
SENTRY_DSN = {{SENTRY_DSN}}
```

- A **missing key is an error**, never a silent blank.
- The delimiter `{{ }}` deliberately avoids `$( )` / `${ }`, so a template can
  contain the build system's own tokens (`$(inherited)`, `${VAR}`) untouched.
- Substitution is **single-pass**: a value that itself contains `{{OTHER}}` is not
  re-expanded (so one secret cannot pull in another).
- For values with format-special characters, add a filter:
  `{{SECRET | json}}`, `{{SECRET | xml}}`, `{{CERT | base64}}`.

::: tip Blob vs. template — which one?
Use a **blob** (`from`, or `file`) when the whole file is secret and stored
verbatim (Firebase plists, `.jks`, `.p8`). Use a **template** (`.vtpl`) when the
file is mostly static structure with a few secret fields — so only the secrets live
in the vault and the skeleton stays diffable in git. Binary/large files are always
blobs.
:::

## Deliver everything at once with a manifest

List all artifacts in `.vaultrc` under `deliver`, then `vault env apply` writes them
all and `vault env clean` securely removes them. Each entry is exactly one of
`format`, `from`, or `template`:

```jsonc
{
  "env": "dev",
  "deliver": [
    // native serializer (dotenv|json); optional "keys" subset
    {
      "path": ".env.development",
      "format": "dotenv",
      "keys": ["API_URL", "SENTRY_DSN"],
    },
    // blob: one variable, written verbatim (optionally base64-decoded)
    {
      "path": "ios/GoogleService-Info.plist",
      "from": "GOOGLE_PLIST",
      "decode": "base64",
    },
    // template: renders the .vtpl to ios/Secrets.xcconfig
    { "template": "ios/Secrets.xcconfig.vtpl" },
  ],
}
```

```bash
vault env apply            # write every artifact (env from arg / .vaultrc "env" / VAULT_ENV)
vault env apply --dry-run  # resolve + validate, but write nothing
vault env clean            # securely remove exactly the declared artifacts
```

Artifact paths resolve relative to the `.vaultrc` location, so `apply`/`clean`
behave identically from the project root or any subdirectory. `clean` removes only
the declared outputs — a `.vtpl` template source is never deleted.

## Scaffold a project & check the wiring

Wire up a project in one step with a preset — it creates the vault **and** the
supporting files:

```bash
vault env init --preset react-native
```

This writes a starter `.vaultrc` manifest, an `ios/Config/Secrets.xcconfig.vtpl`
template, a `SECURE_VAULT_SETUP.md` with next steps (including **Xcode Run Script**
and **Gradle** snippets), and `.gitignore` entries for every delivered artifact. It
never overwrites existing files (they're reported as skipped) and only adds the
missing `.gitignore` lines.

Check that the wiring is sound at any time with `doctor` — read-only, never touches
your secrets:

```bash
vault env doctor            # structural checks, no password needed
vault env doctor -e dev     # + verify every manifest variable resolves (needs a password)
```

`doctor` reports:

- **manifest validity** — the `deliver` array parses and every entry is well-formed;
- **templates present** — each `.vtpl` referenced by the manifest exists;
- **.gitignore coverage** — every delivered artifact is ignored (a warning if not);
- **vault present** — an environment vault is discoverable;
- **variable resolution** — when a password is available
  (`--password-stdin` / `--password-file` / `VAULT_ENV_PASSWORD`), every referenced
  variable actually exists.

Only real breakage (invalid manifest, missing template, unresolved variables) makes
`doctor` exit non-zero; coverage nits are warnings.

## Mobile IDE integration status

For where this stands with **Xcode** and **Android Studio / Gradle** specifically —
what works today and what's still in progress — see the
[**Mobile integration gaps**](https://github.com/benzid-wael/secure-vault/blob/main/docs/environments/MOBILE-INTEGRATION-GAPS.md)
deep dive.
