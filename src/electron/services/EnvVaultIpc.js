import fs from 'fs-extra';
import { EnvironmentVaultService } from './EnvironmentVaultService.js';
import { EnvironmentResolver } from './EnvironmentResolver.js';
import { quoteDotenvValue, toDotenv } from '../../utils/dotenv.js';

const invalid = (error) => ({ success: false, code: 'INVALID', error });

// Names a `{{env:NAME/KEY}}` reference can point at (EnvironmentResolver).
const ENV_NAME_PATTERN = /^[A-Za-z0-9._-]{1,64}$/;

/**
 * Rows of `env` for the renderer: own keys plus keys inherited through
 * `extends` (marked `inheritedFrom`). Values are included only when `reveal`
 * or for non-sensitive keys: a sensitive value never leaves main unasked.
 * A key's comment is always shown: it is a note about the key, not a value.
 */
function describeEnv(vault, env) {
  const chain = [];
  for (let name = env; name != null && !chain.includes(name); ) {
    if (!vault.environments[name]) break;
    chain.push(name);
    name = vault.environments[name].extends;
  }
  const rows = new Map();
  // Parent first, so the child's own keys override inherited ones.
  for (let i = chain.length - 1; i >= 0; i--) {
    const version = vault.getActiveVersion(chain[i]);
    if (!version) continue;
    for (const [key, value] of Object.entries(version.vars)) {
      rows.set(key, {
        key,
        value,
        sensitive: !version.nonSensitive.includes(key),
        required: version.required.includes(key),
        comment: version.comments?.[key] ?? '',
        inheritedFrom: i === 0 ? null : chain[i],
      });
    }
  }
  return [...rows.values()].sort((a, b) => a.key.localeCompare(b.key));
}

const masked = (rows) =>
  rows.map(({ value, ...row }) => (row.sensitive ? row : { ...row, value }));

/**
 * The env vault IPC channels (GUI-ENV-RFC §6.7), as plain functions of
 * `(event, ...args)` so contract tests can drive them without Electron.
 * Main registers each through its trusted-sender `handle`.
 *
 * Channels taking a vault id resolve it through the registry first: an
 * unknown or forged id gets `INVALID` before any service runs.
 *
 * MVP scope: one-key edits through `env:commit` against the view's base
 * revision; a changed file gives `STALE` (no rebase yet, Task 10).
 *
 * @param {Object} deps
 * @param {import('./EnvVaultRegistry.js').EnvVaultRegistry} deps.registry
 * @param {import('./EnvVaultSession.js').EnvVaultSession} deps.session
 * @param {typeof EnvironmentVaultService} [deps.service]
 * @param {() => any} [deps.getWindow] Parent for native dialogs.
 * @param {{showSaveDialog: Function}} [deps.dialog] Electron's `dialog`.
 * @param {import('./ClipboardService.js').ClipboardService} [deps.clipboard]
 */
export function createEnvVaultHandlers({
  registry,
  session,
  service = EnvironmentVaultService,
  getWindow = () => null,
  dialog = null,
  clipboard = null,
}) {
  const withVault =
    (fn) =>
    (event, id, ...args) => {
      const vaultPath = registry.resolve(id);
      if (!vaultPath) return invalid('Unknown vault');
      return fn({ id, vaultPath }, ...args);
    };

  /** Read on the unlocked vault (no idle reset: callers decide). */
  const read = (id) =>
    session.run(id, (vaultPath, auth) => service.read(vaultPath, auth));

  const write = (id, mutate, expectedRevision) =>
    session.run(id, (vaultPath, auth) =>
      service.transact(vaultPath, auth, mutate, {
        expectedRevision,
        tool: 'gui',
      })
    );

  /**
   * The rows of a view, read fresh, or a failure: `INVALID` for an unknown
   * view, `STALE` if the file moved since it was shown (act on what the user
   * is looking at, or on nothing).
   */
  const rowsOfView = async (id, viewId) => {
    const view = session.getView(id, viewId);
    if (!view) return invalid('Unknown view');
    const result = await read(id);
    if (!result.success) return result;
    if (result.revision !== view.revision) {
      return {
        success: false,
        code: 'STALE',
        error: 'The vault changed since it was shown',
      };
    }
    return {
      success: true,
      view,
      vault: result.vault,
      rows: describeEnv(result.vault, view.env),
    };
  };
  const notFound = () => ({
    success: false,
    code: 'NOT_FOUND',
    error: 'No such key',
  });

  /** `env:view` and `env:refresh`: a fresh masked snapshot of one env. */
  const snapshot = async (id, env, viewId = null) => {
    const result = await read(id);
    if (!result.success) return result;
    if (!result.vault.environments[env]) {
      return {
        success: false,
        code: 'NOT_FOUND',
        error: `Environment '${env}' not found`,
      };
    }
    const vars = masked(describeEnv(result.vault, env));
    const view = viewId && session.getView(id, viewId);
    if (view) view.revision = result.revision;
    return {
      success: true,
      viewId: view ? viewId : session.openView(id, env, result.revision),
      revision: result.revision,
      vars,
    };
  };

  return {
    'env-vaults:list': async () => {
      const entries = await registry.list();
      return {
        success: true,
        vaults: entries.map((e) => ({
          ...e,
          unlocked: session.isUnlocked(e.id),
        })),
      };
    },

    'env-vaults:open': () => registry.openFromDialog(getWindow()),

    'env-vaults:create': async (event, options, password) => {
      if (options?.mode !== 'appdata') {
        return invalid('Only new vaults in the app folder are supported');
      }
      const reserved = await registry.createInAppData(options.name);
      if (!reserved.success) return reserved;
      const created = await service.createVault(reserved.path, password);
      if (!created.success) return { ...created, code: 'INVALID' };
      const unlocked = await session.unlock(
        reserved.id,
        reserved.path,
        password
      );
      return unlocked.success ? { success: true, id: reserved.id } : unlocked;
    },

    'env-vault:unlock': withVault(({ id, vaultPath }, password) =>
      session.unlock(id, vaultPath, password)
    ),

    'env-vault:lock': withVault(({ id }) => {
      session.lock(id);
      return { success: true };
    }),

    'env:list': withVault(async ({ id }) => {
      session.touch(id);
      const result = await read(id);
      if (!result.success) return result;
      const { vault } = result;
      return {
        success: true,
        revision: result.revision,
        envs: vault.listEnvironmentNames().map((name) => {
          const env = vault.environments[name];
          const active = vault.getActiveVersion(name);
          return {
            name,
            description: env.description,
            extends: env.extends,
            varCount: active ? Object.keys(active.vars).length : 0,
            activeVersion: active ? active.n : null,
            versionCount: env.versions.length,
          };
        }),
      };
    }),

    'env:view': withVault(({ id }, env) => {
      session.touch(id);
      return snapshot(id, env);
    }),

    // Refetches the renderer makes on its own (focus, a change event) don't
    // count as activity: a vault the CLI keeps writing still idles out.
    'env:refresh': withVault(({ id }, viewId) => {
      const view = session.getView(id, viewId);
      if (!view) return invalid('Unknown view');
      return snapshot(id, view.env, viewId);
    }),

    'env:reveal': withVault(async ({ id }, viewId, key) => {
      session.touch(id);
      const found = await rowsOfView(id, viewId);
      if (!found.success) return found;
      const row = found.rows.find((r) => r.key === key);
      return row ? { success: true, value: row.value } : notFound();
    }),

    // Main writes the clipboard: the value never crosses IPC. A secret is
    // cleared after 30 s unless the user copied something else since.
    'env:copy': withVault(async ({ id }, viewId, key, format = 'value') => {
      session.touch(id);
      if (!['value', 'pair', 'key'].includes(format)) {
        return invalid('Unknown copy format');
      }
      const found = await rowsOfView(id, viewId);
      if (!found.success) return found;
      const row = found.rows.find((r) => r.key === key);
      if (!row) return notFound();
      const text =
        format === 'key'
          ? row.key
          : format === 'pair'
            ? `${row.key}=${quoteDotenvValue(row.value)}`
            : row.value;
      const { clearsInMs } = clipboard.copy(text, {
        sensitive: format !== 'key' && row.sensitive,
      });
      return { success: true, clearsInMs };
    }),

    // Copy or move keys of the view's env to another env, as one transaction
    // against the revision on screen. Keys the target already has are
    // refused with CONFLICT unless `overwrite`.
    'env:transfer': withVault(async ({ id }, request) => {
      session.touch(id);
      const {
        viewId,
        keys,
        target,
        mode = 'copy',
        overwrite = false,
      } = request ?? {};
      const view = session.getView(id, viewId);
      if (!view) return invalid('Unknown view');
      if (!['copy', 'move'].includes(mode)) return invalid('Unknown mode');
      if (!Array.isArray(keys) || keys.length === 0) {
        return invalid('Choose at least one key');
      }
      if (target === view.env) return invalid('Choose another environment');
      const result = await write(
        id,
        (vault) => {
          if (!vault.environments[target]) {
            throw new Error(`Environment '${target}' not found`);
          }
          const rows = describeEnv(vault, view.env);
          const picked = keys.map((key) => {
            const row = rows.find((r) => r.key === key);
            if (!row) throw new Error(`Key '${key}' not found`);
            if (mode === 'move' && row.inheritedFrom) {
              throw new Error(
                `'${key}' is inherited from ${row.inheritedFrom}; copy it instead`
              );
            }
            return row;
          });
          const existing = Object.keys(
            vault.getActiveVersion(target)?.vars ?? {}
          ).filter((key) => keys.includes(key));
          if (existing.length > 0 && !overwrite) {
            throw Object.assign(
              new Error(`${target} already has ${existing.join(', ')}`),
              { code: 'CONFLICT' }
            );
          }
          const verb = mode === 'move' ? 'Moved' : 'Copied';
          vault.applyVarChanges(
            target,
            picked.map((r) => ({
              op: 'set',
              key: r.key,
              value: r.value,
              sensitive: r.sensitive,
              comment: r.comment,
            })),
            { message: `${verb} from ${view.env} in the desktop app` }
          );
          if (mode === 'move') {
            vault.applyVarChanges(
              view.env,
              picked.map((r) => ({ op: 'rm', key: r.key })),
              { message: `Moved to ${target} in the desktop app` }
            );
          }
        },
        view.revision
      );
      if (!result.success) return result;
      view.revision = result.revision;
      return { success: true, revision: result.revision };
    }),

    // Main picks the file in a native dialog and writes it 0600; the values
    // never cross IPC. Resolved like `vault env export` (extends, templates).
    'env:export': withVault(async ({ id }, env) => {
      session.touch(id);
      const result = await read(id);
      if (!result.success) return result;
      if (!result.vault.environments[env]) {
        return {
          success: false,
          code: 'NOT_FOUND',
          error: `Environment '${env}' not found`,
        };
      }
      let content;
      try {
        content = toDotenv(
          new EnvironmentResolver(result.vault).resolveEnvironment(env)
        );
      } catch (error) {
        return { success: false, code: 'ERROR', error: error.message };
      }
      const picked = await dialog.showSaveDialog(getWindow(), {
        title: `Export ${env}`,
        defaultPath: `${env}.env`,
        showsTagField: false,
      });
      if (picked.canceled || !picked.filePath) {
        return { success: false, canceled: true };
      }
      try {
        await fs.writeFile(picked.filePath, content, { mode: 0o600 });
        await fs.chmod(picked.filePath, 0o600); // an existing file kept its mode
      } catch (error) {
        return { success: false, code: 'ERROR', error: error.message };
      }
      return { success: true, path: picked.filePath };
    }),

    'env:view-close': withVault(({ id }, viewId) => {
      session.closeView(id, viewId);
      return { success: true };
    }),

    'env:commit': withVault(async ({ id }, changeset) => {
      session.touch(id);
      const view = session.getView(id, changeset?.viewId);
      if (!view) return invalid('Unknown view');
      const result = await write(
        id,
        (vault) =>
          vault.applyVarChanges(view.env, changeset.ops, {
            message: 'Edited in the desktop app',
          }),
        view.revision
      );
      if (!result.success) return result;
      view.revision = result.revision;
      return { success: true, revision: result.revision, rebased: false };
    }),

    'env:create': withVault(async ({ id }, name, expectedRevision) => {
      session.touch(id);
      if (typeof name !== 'string' || !ENV_NAME_PATTERN.test(name)) {
        return invalid('Use 1–64 letters, digits, ".", "-" or "_"');
      }
      const result = await write(
        id,
        (vault) => vault.addEnvironment(name),
        expectedRevision ?? null
      );
      return result.success
        ? { success: true, revision: result.revision }
        : result;
    }),
  };
}
