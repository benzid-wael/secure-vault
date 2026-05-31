# Releasing

Releases are fully automated by `.github/workflows/release.yml`. Pushing a
version tag builds every artifact and publishes a single GitHub Release.

## Cut a release

1. Bump the version in `package.json` (e.g. `0.1.0`).
2. Commit it: `git commit -am "chore(release): v0.1.0"`.
3. Tag and push:

   ```bash
   git tag v0.1.0
   git push origin main --tags
   ```

The tag triggers the workflow, which:

| Job           | Runner(s)                       | Produces                                                      |
| ------------- | ------------------------------- | ------------------------------------------------------------- |
| `build-gui`   | macOS, Ubuntu, Windows (native) | `.dmg` / `.zip`, `.AppImage` / `.deb`, NSIS / portable `.exe` |
| `build-cli`   | Ubuntu + Bun (cross-compile)    | `vault-{linux,macos}-{x64,arm64}`, `vault-windows-x64.exe`    |
| `release`     | Ubuntu                          | One GitHub Release with all of the above attached             |
| `publish-npm` | Ubuntu                          | `npm publish` (only if `NPM_TOKEN` secret is set)             |

> Pre-release tags (containing a hyphen, e.g. `v0.1.0-rc.1`) are marked as
> "pre-release" automatically.

## Required / optional secrets

- `GITHUB_TOKEN` — provided automatically by GitHub Actions; used to create the
  Release. You do not create or configure this.
- `NPM_TOKEN` — **optional**. An npm token enabling `npm publish`. Without it the
  `publish-npm` job skips gracefully (GitHub Releases still publish).

### Creating `NPM_TOKEN`

The token is generated on npm and then stored as a GitHub secret.

1. On [npmjs.com](https://www.npmjs.com): create/verify an account, then
   **avatar → Access Tokens → Generate New Token**.
2. Choose **Granular Access Token** (or classic **Automation** — automation
   tokens bypass 2FA, which CI requires). Give it **Read and write** package
   permission and an expiry.
3. Copy the `npm_…` value (shown only once).
4. In the GitHub repo: **Settings → Secrets and variables → Actions → New
   repository secret**. Name it `NPM_TOKEN`, paste the value, and save.

> The published package name is the `name` field in `package.json`
> (`secure-password-manager`). Confirm it is available on npm, or switch to a
> scoped name (e.g. `@benzid-wael/secure-vault`) before the first publish — the
> data directory is independent of `name`, so renaming is safe (see below).

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
