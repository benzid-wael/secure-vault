# Releasing

Releases are fully automated by `.github/workflows/release.yml`. Pushing a
version tag builds every artifact and publishes a single GitHub Release.

## Cut a release

**The git tag is the single source of truth for the version.** You do not edit
`package.json` — every job derives the version from the tag (`v0.1.0` →
`0.1.0`) via `npm version`, so all artifacts and the npm package stay in sync.

```bash
git tag v0.1.0
git push origin v0.1.0
```

The tag triggers the workflow, which:

| Job           | Runner(s)                       | Produces                                                      |
| ------------- | ------------------------------- | ------------------------------------------------------------- |
| `build-gui`   | macOS, Ubuntu, Windows (native) | `.dmg` / `.zip`, `.AppImage` / `.deb`, NSIS / portable `.exe` |
| `build-cli`   | Ubuntu + Bun (cross-compile)    | `vault-{linux,macos}-{x64,arm64}`, `vault-windows-x64.exe`    |
| `release`     | Ubuntu                          | One GitHub Release with all of the above attached             |
| `publish-npm` | Ubuntu                          | `npm publish` via trusted publishing (no npm token)           |

> **Each tag must be a new version.** npm refuses to republish an existing
> version, so re-running a failed release needs a fresh tag (e.g. `v0.1.0-rc.2`),
> not the same one.
>
> Pre-release tags (containing a hyphen, e.g. `v0.1.0-rc.1`) are marked as
> GitHub "pre-release" **and** published to npm under the `next` dist-tag, so
> `npm install @benzid.wael/secure-vault` still resolves to the latest stable
> release. The `version` in `package.json` (`0.0.1`) is just an unreleased
> placeholder and is ignored at release time.

## Secrets and npm access

- `GITHUB_TOKEN` — provided automatically by GitHub Actions; used to create the
  Release. You do not create or configure this.
- **No npm token.** The `publish-npm` job uses npm
  [trusted publishing](https://docs.npmjs.com/trusted-publishers): npm trusts
  `release.yml` in this repo and accepts GitHub's short-lived OIDC token
  instead, so there is nothing to store, rotate or expire, and no 2FA prompt.
  Provenance is attached automatically.

### Trusted publisher setup (once per package)

On [npmjs.com](https://www.npmjs.com), open the package → **Settings → Trusted
Publisher** → **GitHub Actions**, and enter:

| Field                | Value          |
| -------------------- | -------------- |
| Organization or user | `benzid-wael`  |
| Repository           | `secure-vault` |
| Workflow filename    | `release.yml`  |
| Environment name     | _(empty)_      |

The job needs `id-token: write` and npm **11.5.1+** (it installs the latest npm
on Node 22), and `repository.url` in `package.json` must point at this repo.
Renaming `release.yml` breaks publishing until the trusted publisher is updated.

Once a trusted publish has succeeded, set the package's **Settings → Publishing
access** to _"Require two-factor authentication and disallow tokens"_, and
revoke any old npm automation tokens.

> The published package name is the `name` field in `package.json`,
> `@benzid.wael/secure-vault` — a scoped name under the maintainer's npm
> account, so publishing requires `--access public` (already set in the
> workflow). The data directory is independent of `name`, so this name can be
> changed safely (see below). The CLI command is always `vault` regardless of
> the package name (set by the `bin` field).

## Code signing (not configured)

The GUI and CLI ship **unsigned**, so macOS Gatekeeper and Windows SmartScreen
warn users; the README documents the one-time bypass. The workflow only signs
when the relevant secrets are present, so this is safe to leave off.

To enable signing and notarization, follow the dedicated guide:
[`docs/CODE_SIGNING.md`](CODE_SIGNING.md).

## Local builds

```bash
npm run package:mac     # or :win / :linux — GUI installer for the current OS
npm run package:cli     # standalone CLI binaries (requires Bun)
```

electron-builder cannot reliably cross-compile, so per-OS GUI installers should
be produced by the CI matrix, not locally.

## Data directory note

The desktop app and the CLI share one on-disk location, defined once by
`APP_DATA_DIR_NAME` in `src/electron/utils/appPaths.js`. It is intentionally
**not** derived from the package `name` or Electron's packaged productName, so
renaming either is safe. Changing `APP_DATA_DIR_NAME` itself, however, orphans
every existing vault — leave it stable.
