import path from 'path';
import fs from 'fs-extra';

/**
 * Project scaffolding for `vault env init --preset <name>`.
 *
 * A preset is a pure description of the files a project needs to wire up
 * secure-vault delivery — a `.vaultrc` manifest, starter `.vtpl` templates,
 * `.gitignore` entries, and copy-paste build-phase snippets. Writing is
 * non-destructive: existing files are left untouched, and `.gitignore` only
 * gains the lines it is missing.
 */

const RN_VAULTRC = `${JSON.stringify(
  {
    env: 'dev',
    deliver: [
      // App-layer vars as a dotenv file (react-native-config reads this).
      // List the keys you want exposed; drop "keys" to export the whole env.
      { path: '.env', format: 'dotenv', keys: ['API_URL', 'SENTRY_DSN'] },
      // Firebase config files, stored base64 in the vault and decoded on apply.
      {
        path: 'ios/GoogleService-Info.plist',
        from: 'GOOGLE_SERVICE_INFO_PLIST',
        decode: 'base64',
      },
      {
        path: 'android/app/google-services.json',
        from: 'GOOGLE_SERVICES_JSON',
        decode: 'base64',
      },
      // Build-time iOS settings rendered from a committed template.
      { template: 'ios/Config/Secrets.xcconfig.vtpl' },
    ],
  },
  null,
  2
)}\n`;

const RN_XCCONFIG_TEMPLATE = `// Rendered by secure-vault from Secrets.xcconfig.vtpl — do not edit the output.
// Reference these in Info.plist as $(API_URL) etc., or #include this file.
API_URL = {{API_URL}}
SENTRY_DSN = {{SENTRY_DSN}}
`;

const RN_SETUP_NOTES = `# secure-vault — React Native setup

This project was scaffolded with \`vault env init --preset react-native\`.

## 1. Store your secrets

App vars:

    vault env set API_URL https://api.example.com -e dev
    vault env set SENTRY_DSN https://... -e dev

File secrets (binary → base64 blob in the vault):

    vault env set GOOGLE_SERVICE_INFO_PLIST --in GoogleService-Info.plist --encode base64 -e dev
    vault env set GOOGLE_SERVICES_JSON --in google-services.json --encode base64 -e dev

## 2. Deliver them

    vault env apply            # writes every artifact in .vaultrc "deliver"
    vault env apply --dry-run  # preview + validate without writing
    vault env clean            # securely remove the delivered files

Delivered files (\`.env\`, the Firebase files, \`ios/Config/Secrets.xcconfig\`)
are git-ignored. The \`.vtpl\` templates and the encrypted \`.env.vault\` are
safe to commit.

## 3. Xcode — auto-render on build (optional)

Add a **Run Script** build phase, BEFORE "Compile Sources", with:

    if command -v vault >/dev/null 2>&1; then vault env apply; fi

(Requires an unlocked session; until the v2 agent lands, run \`vault env apply\`
manually or wrap the build with \`vault env run\`.)

## 4. Android / Gradle — render at configure time (optional)

In \`android/app/build.gradle\`:

    exec { commandLine 'sh', '-c', 'command -v vault >/dev/null 2>&1 && vault env apply || true' }

## 5. iOS build settings

\`#include\` \`Secrets.xcconfig\` from your build configuration, or reference the
generated \`$(API_URL)\`-style values in \`Info.plist\`.
`;

/**
 * Build the react-native preset description. Files carry project-relative paths
 * and their intended content; gitignore holds the lines to ensure are present.
 */
function buildReactNativePreset() {
  return {
    files: [
      { path: '.vaultrc', content: RN_VAULTRC },
      {
        path: 'ios/Config/Secrets.xcconfig.vtpl',
        content: RN_XCCONFIG_TEMPLATE,
      },
      { path: 'SECURE_VAULT_SETUP.md', content: RN_SETUP_NOTES },
    ],
    // Delivered plaintext artifacts must never be committed. The .vtpl sources
    // and the encrypted .env.vault are intentionally NOT ignored.
    gitignore: [
      '.env',
      'ios/GoogleService-Info.plist',
      'android/app/google-services.json',
      'ios/Config/Secrets.xcconfig',
    ],
  };
}

/** Registry of available presets. */
export const PRESETS = {
  'react-native': buildReactNativePreset(),
};

/** Resolve a preset by name, or throw listing the available ones. */
export function getPreset(name) {
  const preset = PRESETS[name];
  if (!preset) {
    throw new Error(
      `Unknown preset "${name}" (available: ${Object.keys(PRESETS).join(', ')})`
    );
  }
  return preset;
}

const GITIGNORE_HEADER = '# secure-vault delivered secrets (do not commit)';

/**
 * Ensure `.gitignore` contains every line in `lines`, appending a labeled block
 * with only the missing ones. Idempotent: re-running adds nothing. Returns the
 * lines that were actually added.
 */
export async function ensureGitignore(cwd, lines) {
  const file = path.join(cwd, '.gitignore');
  let existing = '';
  if (await fs.pathExists(file)) {
    existing = await fs.readFile(file, 'utf-8');
  }
  const present = new Set(
    existing
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean)
  );
  const missing = lines.filter((l) => !present.has(l));
  if (missing.length === 0) return [];

  const prefix = existing && !existing.endsWith('\n') ? '\n' : '';
  const block = `${prefix}${existing ? '\n' : ''}${GITIGNORE_HEADER}\n${missing.join('\n')}\n`;
  await fs.appendFile(file, block);
  return missing;
}

/**
 * Write a preset's files under `cwd` without clobbering anything, and reconcile
 * `.gitignore`. Returns a report of what changed so the caller can print it.
 *
 * @returns {Promise<{written: string[], skipped: string[], gitignoreAdded: string[]}>}
 */
export async function scaffoldPreset(preset, { cwd = process.cwd() } = {}) {
  const written = [];
  const skipped = [];

  for (const file of preset.files) {
    const dest = path.join(cwd, file.path);
    if (await fs.pathExists(dest)) {
      skipped.push(file.path);
      continue;
    }
    await fs.ensureDir(path.dirname(dest));
    await fs.writeFile(dest, file.content);
    written.push(file.path);
  }

  const gitignoreAdded = await ensureGitignore(cwd, preset.gitignore);
  return { written, skipped, gitignoreAdded };
}
