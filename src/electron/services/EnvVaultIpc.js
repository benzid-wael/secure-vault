import { EnvironmentVaultService } from './EnvironmentVaultService.js';

const invalid = (error) => ({ success: false, code: 'INVALID', error });

// Names a `{{env:NAME/KEY}}` reference can point at (EnvironmentResolver).
const ENV_NAME_PATTERN = /^[A-Za-z0-9._-]{1,64}$/;

/**
 * Rows of `env` for the renderer: own keys plus keys inherited through
 * `extends` (marked `inheritedFrom`). Values are included only when `reveal`
 * or for non-sensitive keys: a sensitive value never leaves main unasked.
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
 */
export function createEnvVaultHandlers({
  registry,
  session,
  service = EnvironmentVaultService,
  getWindow = () => null,
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
      const view = session.getView(id, viewId);
      if (!view) return invalid('Unknown view');
      const result = await read(id);
      if (!result.success) return result;
      // Reveal what the user is looking at, or nothing.
      if (result.revision !== view.revision) {
        return {
          success: false,
          code: 'STALE',
          error: 'The vault changed since it was shown',
        };
      }
      const row = describeEnv(result.vault, view.env).find(
        (r) => r.key === key
      );
      if (!row)
        return { success: false, code: 'NOT_FOUND', error: 'No such key' };
      return { success: true, value: row.value };
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
