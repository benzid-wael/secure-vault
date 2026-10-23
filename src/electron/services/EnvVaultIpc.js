import crypto from 'crypto';
import fs from 'fs-extra';
import path from 'path';
import { EnvironmentVaultService } from './EnvironmentVaultService.js';
import { EnvironmentResolver } from './EnvironmentResolver.js';
import { parseDotenv, quoteDotenvValue, toDotenv } from '../../utils/dotenv.js';

const invalid = (error) => ({ success: false, code: 'INVALID', error });

// Names a `{{env:NAME/KEY}}` reference can point at (EnvironmentResolver).
const ENV_NAME_PATTERN = /^[A-Za-z0-9._-]{1,64}$/;

const MANAGE_OPS = ['rename', 'duplicate', 'delete', 'extends', 'describe'];

/**
 * A hash per own key of `env` (value, flags, comment), so a later commit can
 * tell which keys changed since the page was shown without keeping any
 * plaintext in main (Task 10).
 *
 * @returns {Record<string, string>}
 */
function stampsOf(vault, env) {
  const version = vault.environments[env] && vault.getActiveVersion(env);
  if (!version) return {};
  return Object.fromEntries(
    Object.entries(version.vars).map(([key, value]) => [
      key,
      hash([
        value,
        version.nonSensitive.includes(key),
        version.required.includes(key),
        version.comments?.[key] ?? '',
      ]),
    ])
  );
}

/**
 * A hash per row the page shows for `env`, inherited ones included, so
 * reveal and copy can tell whether the key they act on changed since the
 * page was shown (New-31).
 *
 * @returns {Record<string, string>}
 */
function rowStampsOf(vault, env) {
  return Object.fromEntries(
    describeEnv(vault, env).map((row) => [row.key, hash(row)])
  );
}

const hash = (data) =>
  crypto.createHash('sha256').update(JSON.stringify(data)).digest('hex');

/** The keys among `keys` whose stamp differs between `before` and `now`. */
const changedKeys = (keys, before, now) =>
  [...new Set(keys)].filter((key) => now[key] !== before[key]);

/** The failure for an action on keys that changed elsewhere (New-31). */
const staleKeys = (changed) =>
  Object.assign(
    new Error(`Changed elsewhere meanwhile: ${changed.join(', ')}`),
    { code: 'STALE', changed }
  );

/** Whether following `extends` from `env` comes back to it. */
function extendsLoop(vault, env) {
  const seen = new Set();
  for (let name = vault.environments[env]?.extends; name != null; ) {
    if (name === env) return true;
    if (seen.has(name)) return false;
    seen.add(name);
    name = vault.environments[name]?.extends ?? null;
  }
  return false;
}

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

/** A failed typed unlock: AUTH is almost always a typo, so say so (New-23). */
function wrongPassword(result, vaultPath) {
  if (result.code !== 'AUTH') return result;
  return {
    ...result,
    error:
      `Wrong password for ${path.basename(vaultPath)}. ` +
      "If you're sure it's right, the file may be damaged.",
  };
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
 * A file changed elsewhere since a view was shown doesn't block an action
 * on that view unless a key it acts on changed: `env:commit` answers
 * `CONFLICT`, the others `STALE` with the `changed` keys (Task 10, New-31).
 *
 * @param {Object} deps
 * @param {import('./EnvVaultRegistry.js').EnvVaultRegistry} deps.registry
 * @param {import('./EnvVaultSession.js').EnvVaultSession} deps.session
 * @param {typeof EnvironmentVaultService} [deps.service]
 * @param {() => any} [deps.getWindow] Parent for native dialogs.
 * @param {{showSaveDialog: Function, showOpenDialog?: Function}} [deps.dialog]
 *   Electron's `dialog`.
 * @param {import('./ClipboardService.js').ClipboardService} [deps.clipboard]
 * @param {import('./EnvVaultWatcher.js').EnvVaultWatcher} [deps.watcher]
 *   Told when a vault is unlocked and of every revision the app reads or
 *   writes, so it reports only changes made elsewhere.
 * @param {import('./EnvVaultKeychain.js').EnvVaultKeychain} [deps.keychain]
 *   Passwords the user chose to keep on this computer (New-24).
 */
export function createEnvVaultHandlers({
  registry,
  session,
  service = EnvironmentVaultService,
  getWindow = () => null,
  dialog = null,
  clipboard = null,
  watcher = null,
  keychain = null,
}) {
  const withVault =
    (fn) =>
    (event, id, ...args) => {
      const vaultPath = registry.resolve(id);
      if (!vaultPath) return invalid('Unknown vault');
      return fn({ id, vaultPath }, ...args);
    };

  /**
   * Parsed .env files waiting for the user to confirm an import (Task 27),
   * by one-time token. Values stay in main; the page sees key names only.
   * `revision` and `stamps` are those of the env the preview compared with.
   * @type {Map<string, {id: string, viewId: string, fileName: string,
   *   vars: Record<string, string>, comments: Record<string, string>,
   *   revision: string, stamps: Record<string, string>}>}
   */
  const pendingImports = new Map();
  const MAX_PENDING_IMPORTS = 4;
  /** Drop pending imports of `id`, and any whose session has ended. */
  const dropImports = (id = null) => {
    for (const [token, pending] of pendingImports) {
      // A lock drops every view, so a pending import whose view is gone
      // outlived its session.
      if (pending.id === id || !session.getView(pending.id, pending.viewId)) {
        pendingImports.delete(token);
      }
    }
  };

  /** Ask for a file to write `content` to, and write it `0600`. */
  const saveFile = async (title, defaultPath, content) => {
    const picked = await dialog.showSaveDialog(getWindow(), {
      title,
      defaultPath,
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
  };

  /** Tell the watcher about a revision the app itself saw. */
  const noted = (id, result) => {
    if (result.success) watcher?.note(id, result.revision);
    return result;
  };

  /** Read on the unlocked vault (no idle reset: callers decide). */
  const read = async (id) =>
    noted(
      id,
      await session.run(id, (vaultPath, auth) => service.read(vaultPath, auth))
    );

  /** A write on the unlocked vault; a `STALE` refusal keeps its `changed`. */
  const write = async (id, mutate, expectedRevision) => {
    let changed = null;
    const result = noted(
      id,
      await session.run(id, (vaultPath, auth) =>
        service.transact(
          vaultPath,
          auth,
          async (vault, info) => {
            try {
              return await mutate(vault, info);
            } catch (error) {
              changed = error.changed ?? null;
              throw error;
            }
          },
          { expectedRevision, tool: 'gui' }
        )
      )
    );
    return changed && result.code === 'STALE' ? { ...result, changed } : result;
  };

  /** Record that `view` now shows `vault` at `revision`. */
  const showing = (view, vault, revision) => {
    view.revision = revision;
    view.stamps = stampsOf(vault, view.env);
    view.rows = rowStampsOf(vault, view.env);
  };

  /**
   * The rows of a view, read fresh, or a failure: `INVALID` for an unknown
   * view, `STALE` if one of `keys` (all rows when null) changed since the
   * page was shown (act on what the user is looking at, or on nothing). A
   * change to other keys or other envs doesn't block it (New-31).
   *
   * @param {string[] | null} [keys]
   */
  const rowsOfView = async (id, viewId, keys = null) => {
    const view = session.getView(id, viewId);
    if (!view) return invalid('Unknown view');
    const result = await read(id);
    if (!result.success) return result;
    if (result.revision !== view.revision) {
      const before = view.rows ?? {};
      const now = result.vault.environments[view.env]
        ? rowStampsOf(result.vault, view.env)
        : null;
      const changed = now
        ? changedKeys(
            keys ?? [...Object.keys(before), ...Object.keys(now)],
            before,
            now
          )
        : (keys ?? Object.keys(before));
      if (!now || changed.length > 0) {
        return {
          success: false,
          code: 'STALE',
          changed,
          error: 'The vault changed since it was shown',
        };
      }
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
    const shownId =
      viewId && session.getView(id, viewId)
        ? viewId
        : session.openView(id, env, result.revision);
    showing(session.getView(id, shownId), result.vault, result.revision);
    return {
      success: true,
      viewId: shownId,
      revision: result.revision,
      vars,
    };
  };

  return {
    'env-vaults:list': async () => {
      const entries = await registry.list();
      // Passwords of vault files deleted or moved don't linger (New-36).
      await keychain?.prune();
      return {
        success: true,
        // Whether "Remember on this computer" can be offered at all.
        keychain: keychain?.available() ?? false,
        savedPasswords: keychain ? await keychain.count() : 0,
        vaults: await Promise.all(
          entries.map(async (e) => ({
            ...e,
            unlocked: session.isUnlocked(e.id),
            remembered: keychain
              ? await keychain.has(registry.resolve(e.id))
              : false,
          }))
        ),
      };
    },

    'env-vaults:open': () => registry.openFromDialog(getWindow()),
    'env-vaults:open-folder': () => registry.openFolderFromDialog(getWindow()),
    // Off the list, now and in later runs (Task 14); the file is untouched.
    // Its saved password goes too (New-36): nothing would offer it again.
    'env-vaults:forget': async (event, id) => {
      if (session.isUnlocked(id)) {
        return {
          success: false,
          code: 'INVALID',
          error: 'Lock the vault before removing it from the list',
        };
      }
      const vaultPath = registry.resolve(id);
      const result = await registry.forget(id);
      if (result.success && vaultPath) await keychain?.forget(vaultPath);
      return result;
    },
    // "Forget all saved passwords" in Settings (New-36).
    'env-vaults:forget-passwords': async () => ({
      success: true,
      count: keychain ? await keychain.forgetAll() : 0,
    }),
    // Input on the vault's own screen (New-42): the only thing that keeps an
    // env vault unlocked. Calls, the page's own or the user's, never do.
    'env-vaults:activity': (event, id) => {
      session.touch(id);
      return { success: true };
    },

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
      if (!unlocked.success) return unlocked;
      watcher?.start(reserved.id, reserved.path, unlocked.revision);
      return { success: true, id: reserved.id };
    },

    /**
     * Unlock with a typed password. `options.remember` true keeps it on this
     * computer (New-24), false forgets a kept one, absent leaves it as is.
     */
    'env-vault:unlock': withVault(
      async ({ id, vaultPath }, password, options = {}) => {
        const result = await session.unlock(id, vaultPath, password);
        if (!result.success) return wrongPassword(result, vaultPath);
        watcher?.start(id, vaultPath, result.revision);
        if (keychain && options?.remember === true) {
          return {
            ...result,
            remembered: await keychain.remember(vaultPath, password),
          };
        }
        if (keychain && options?.remember === false) {
          await keychain.forget(vaultPath);
        }
        return result;
      }
    ),

    /**
     * Unlock with the password kept on this computer (New-24), after the
     * presence check. One that no longer opens the vault (changed by the CLI)
     * is forgotten, so the next attempt asks for it.
     */
    'env-vault:unlock-saved': withVault(async ({ id, vaultPath }) => {
      if (!keychain) return invalid('No saved password');
      const name = path.basename(vaultPath);
      const saved = await keychain.get(vaultPath, `unlock ${name}`);
      if (!saved.success) {
        return {
          success: false,
          code: saved.code,
          error: {
            NONE: `No saved password for ${name}. Type it instead.`,
            UNAVAILABLE: `This computer can't read the saved password for ${name} right now. Type it instead.`,
            CANCELED: 'Unlock canceled.',
          }[saved.code],
        };
      }
      const result = await session.unlock(id, vaultPath, saved.password);
      if (result.success) {
        watcher?.start(id, vaultPath, result.revision);
        return result;
      }
      if (result.code !== 'AUTH') return result;
      await keychain.forget(vaultPath);
      return {
        ...result,
        remembered: false,
        error: `The saved password no longer opens ${name}; it was changed elsewhere. Type the new one.`,
      };
    }),

    'env-vault:forget-password': withVault(async ({ vaultPath }) => {
      await keychain?.forget(vaultPath);
      return { success: true };
    }),
    'env-vault:lock': withVault(({ id }) => {
      session.lock(id);
      dropImports(id);
      return { success: true };
    }),

    'env:list': withVault(async ({ id }) => {
      const result = await read(id);
      if (!result.success) return result;
      const { vault } = result;
      // A vault from a newer SecureVault (New-29): writes are refused in
      // the service; the page shows why and offers none.
      const format = result.format;
      return {
        success: true,
        revision: result.revision,
        ...(format && !format.writable
          ? { readOnly: true, formatMessage: format.message }
          : {}),
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
      return snapshot(id, env);
    }),

    // Refetches the renderer makes on its own (focus, a change event).
    'env:refresh': withVault(({ id }, viewId) => {
      const view = session.getView(id, viewId);
      if (!view) return invalid('Unknown view');
      return snapshot(id, view.env, viewId);
    }),

    /**
     * The view env's own variables as .env text, comments included, for bulk
     * edit (Task 21). Values cross to the page: the user asked to edit them
     * all. Inherited keys stay out; they belong to the parent.
     */
    'env:edit-text': withVault(async ({ id }, viewId) => {
      const found = await rowsOfView(id, viewId);
      if (!found.success) return found;
      const own = found.rows.filter((r) => !r.inheritedFrom);
      return {
        success: true,
        text: own.length
          ? toDotenv(Object.fromEntries(own.map((r) => [r.key, r.value])), {
              comments: Object.fromEntries(own.map((r) => [r.key, r.comment])),
            })
          : '',
      };
    }),

    'env:reveal': withVault(async ({ id }, viewId, key) => {
      const found = await rowsOfView(id, viewId, [key]);
      if (!found.success) return found;
      const row = found.rows.find((r) => r.key === key);
      return row ? { success: true, value: row.value } : notFound();
    }),

    // Main writes the clipboard: the value never crosses IPC. A secret is
    // cleared after 30 s unless the user copied something else since.
    'env:copy': withVault(async ({ id }, viewId, key, format = 'value') => {
      if (!['value', 'pair', 'key'].includes(format)) {
        return invalid('Unknown copy format');
      }
      const found = await rowsOfView(id, viewId, [key]);
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

    // Copy or move keys of the view's env to another env, as one transaction.
    // A file changed elsewhere meanwhile blocks it only when one of `keys`
    // changed (STALE, New-31). Keys the target already has are refused with
    // CONFLICT unless `overwrite`.
    'env:transfer': withVault(async ({ id }, request) => {
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
      let after = null;
      const result = await write(
        id,
        (vault, { revision }) => {
          if (!vault.environments[target]) {
            throw new Error(`Environment '${target}' not found`);
          }
          if (revision !== view.revision) {
            if (!vault.environments[view.env]) throw staleKeys(keys);
            const changed = changedKeys(
              keys,
              view.rows ?? {},
              rowStampsOf(vault, view.env)
            );
            if (changed.length > 0) throw staleKeys(changed);
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
          after = vault;
        },
        null
      );
      if (!result.success) return result;
      showing(view, after, result.revision);
      return { success: true, revision: result.revision };
    }),

    // Main picks the file in a native dialog and writes it 0600; the values
    // never cross IPC. Resolved like `vault env export` (extends, templates).
    // `format` 'json' writes what `vault env export -f json` prints (New-35):
    // resolved values only; comments don't fit in JSON.
    'env:export': withVault(async ({ id }, env, format = 'dotenv') => {
      if (!['dotenv', 'json'].includes(format)) {
        return invalid('Unknown export format');
      }
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
        const vars = new EnvironmentResolver(result.vault).resolveEnvironment(
          env
        );
        content =
          format === 'json'
            ? `${JSON.stringify(vars, null, 2)}\n`
            : toDotenv(vars, { comments: result.vault.commentsOf(env) });
      } catch (error) {
        return { success: false, code: 'ERROR', error: error.message };
      }
      return format === 'json'
        ? saveFile(`Export ${env} as JSON`, `${env}.json`, content)
        : saveFile(`Export ${env}`, `${env}.env`, content);
    }),

    /**
     * A `.env.example` for `env`: every key it shows, values left out,
     * required keys marked (`vault env template`). Through a save dialog.
     */
    'env:template': withVault(async ({ id }, env) => {
      const result = await read(id);
      if (!result.success) return result;
      if (!result.vault.environments[env]) {
        return {
          success: false,
          code: 'NOT_FOUND',
          error: `Environment '${env}' not found`,
        };
      }
      const rows = describeEnv(result.vault, env);
      const content = rows.length
        ? rows
            .map((r) => {
              const note = r.comment
                ? r.comment
                    .split('\n')
                    .map((l) => `# ${l}\n`)
                    .join('')
                : '';
              return `${note}${r.key}=${r.required ? '<required>' : ''}`;
            })
            .join('\n') + '\n'
        : '';
      return saveFile(`Template of ${env}`, '.env.example', content);
    }),

    /**
     * Compare two envs as they resolve (Task 26). Values come only with
     * `reveal: true`; otherwise just which keys differ.
     */
    'env:diff': withVault(async ({ id }, envA, envB, options = {}) => {
      const result = await read(id);
      if (!result.success) return result;
      const diff = service.diffVaultEnvs(result.vault, envA, envB);
      if (!diff.success) return { ...diff, code: diff.code ?? 'ERROR' };
      const { added, removed, unchanged, changedDetails } = diff.data;
      const reveal = options?.reveal === true;
      return {
        success: true,
        added: added.sort(),
        removed: removed.sort(),
        unchanged: unchanged.length,
        changed: changedDetails
          .map((d) =>
            reveal
              ? { key: d.key, valueA: d.valueA, valueB: d.valueB }
              : { key: d.key }
          )
          .sort((a, b) => a.key.localeCompare(b.key)),
      };
    }),

    /** `vault env validate` for one env (Task 26). */
    'env:validate': withVault(async ({ id }, env) => {
      const result = await read(id);
      if (!result.success) return result;
      const checked = service.validateVaultEnv(result.vault, env);
      if (!checked.success) return { ...checked, code: 'ERROR' };
      const { errors, warnings, varCount, requiredCount } = checked.data;
      return { success: true, errors, warnings, varCount, requiredCount };
    }),

    /**
     * Pick a .env file and preview importing it into the view's env
     * (Task 27): which keys are new, changed or the same, plus the parser's
     * warnings. Values stay in main until `env:import-apply`.
     */
    'env:import-pick': withVault(async ({ id }, viewId) => {
      const view = session.getView(id, viewId);
      if (!view) return invalid('Unknown view');
      const current = await read(id);
      if (!current.success) return current;
      if (!current.vault.environments[view.env]) {
        return { success: false, code: 'NOT_FOUND', error: 'Environment gone' };
      }
      const picked = await dialog.showOpenDialog(getWindow(), {
        title: `Import into ${view.env}`,
        properties: ['openFile', 'showHiddenFiles'],
      });
      if (picked.canceled || picked.filePaths.length === 0) {
        return { success: false, canceled: true };
      }
      const filePath = picked.filePaths[0];
      let content;
      try {
        const stat = await fs.stat(filePath);
        if (stat.size > 5 * 1024 * 1024) {
          return invalid('That file is over 5 MB; it is not a .env file');
        }
        content = await fs.readFile(filePath, 'utf8');
      } catch (error) {
        return { success: false, code: 'ERROR', error: error.message };
      }
      const parsed = parseDotenv(content);
      dropImports();
      // The preview compares with the file now, whatever the page shows;
      // apply checks the keys it touches against this (New-31).
      const own = new Map(
        describeEnv(current.vault, view.env)
          .filter((r) => !r.inheritedFrom)
          .map((r) => [r.key, r])
      );
      const keys = Object.keys(parsed.vars)
        .sort()
        .map((key) => ({
          key,
          status: !own.has(key)
            ? 'new'
            : own.get(key).value === parsed.vars[key]
              ? 'same'
              : 'changed',
          comment: parsed.comments[key] ?? '',
        }));
      const absent = [...own.keys()].filter((k) => !(k in parsed.vars)).sort();
      while (pendingImports.size >= MAX_PENDING_IMPORTS) {
        pendingImports.delete(pendingImports.keys().next().value);
      }
      const token = crypto.randomBytes(16).toString('hex');
      pendingImports.set(token, {
        id,
        viewId,
        fileName: path.basename(filePath),
        vars: parsed.vars,
        comments: parsed.comments,
        revision: current.revision,
        stamps: stampsOf(current.vault, view.env),
      });
      return {
        success: true,
        token,
        fileName: path.basename(filePath),
        keys,
        absent,
        warnings: parsed.warnings,
      };
    }),

    /**
     * Apply a previewed import as one version against the view: `merge`
     * sets the file's keys (all, or `keys`), `replace` also removes the env's
     * own keys the file doesn't have. `comments` takes the file's comments.
     */
    'env:import-apply': withVault(async ({ id }, token, options = {}) => {
      dropImports();
      const pending = pendingImports.get(token);
      if (!pending || pending.id !== id) return invalid('Import expired');
      pendingImports.delete(token);
      const view = session.getView(id, pending.viewId);
      if (!view) return invalid('Unknown view');
      const { mode = 'merge', comments = false, keys = null } = options ?? {};
      if (!['merge', 'replace'].includes(mode)) return invalid('Unknown mode');
      const picked = Object.keys(pending.vars).filter(
        (key) => !Array.isArray(keys) || keys.includes(key)
      );
      let after = null;
      const result = await write(
        id,
        (vault, { revision }) => {
          if (revision !== pending.revision) {
            // The keys it sets, and for `replace` every own key: one added
            // elsewhere meanwhile would be removed unseen.
            if (!vault.environments[view.env]) throw staleKeys(picked);
            const now = stampsOf(vault, view.env);
            const changed = changedKeys(
              mode === 'replace'
                ? [
                    ...picked,
                    ...Object.keys(pending.stamps),
                    ...Object.keys(now),
                  ]
                : picked,
              pending.stamps,
              now
            );
            if (changed.length > 0) throw staleKeys(changed);
          }
          const own = Object.keys(vault.getActiveVersion(view.env)?.vars ?? {});
          /** @type {Array<any>} */
          const ops = picked.map((key) => ({
            op: 'set',
            key,
            value: pending.vars[key],
            ...(comments && { comment: pending.comments[key] ?? '' }),
          }));
          if (mode === 'replace') {
            for (const key of own) {
              if (!(key in pending.vars)) ops.push({ op: 'rm', key });
            }
          }
          if (ops.length === 0) throw new Error('Nothing to import');
          vault.applyVarChanges(view.env, ops, {
            message: `Imported from ${pending.fileName} in the desktop app`,
          });
          after = vault;
        },
        null
      );
      if (!result.success) return result;
      showing(view, after, result.revision);
      return { success: true, revision: result.revision, count: picked.length };
    }),

    'env:import-cancel': withVault(({ id }, token) => {
      if (pendingImports.get(token)?.id === id) pendingImports.delete(token);
      return { success: true };
    }),

    /**
     * Change the vault's password (Task 28). The snapshots are re-keyed with
     * it; the session keeps working with the new password.
     */
    'env-vault:change-password': withVault(
      async ({ id, vaultPath }, current, next) => {
        if (!session.isUnlocked(id)) {
          return { success: false, code: 'LOCKED', error: 'Vault is locked' };
        }
        if (typeof current !== 'string' || typeof next !== 'string') {
          return invalid('Enter both passwords');
        }
        if (current === next) {
          return invalid('The new password is the same as the current one');
        }
        const result = await service.changePassword(vaultPath, current, next);
        if (!result.success) {
          return result.code === 'AUTH'
            ? { ...result, error: 'The current password is wrong' }
            : { ...result, code: result.code ?? 'INVALID' };
        }
        session.setPassword(id, next);
        watcher?.note(id, result.revision);
        // A kept password follows the change, or it would stop working.
        if (keychain && (await keychain.has(vaultPath))) {
          await keychain.remember(vaultPath, next);
        }
        return {
          success: true,
          revision: result.revision,
          rekeyedSnapshots: result.rekeyedSnapshots ?? [],
          skippedSnapshots: result.skippedSnapshots ?? [],
        };
      }
    ),

    'env:view-close': withVault(({ id }, viewId) => {
      session.closeView(id, viewId);
      return { success: true };
    }),

    /**
     * Apply a changeset to the view's env (Task 10). If the file changed
     * since the page was shown, the changeset still applies when none of the
     * keys it touches changed meanwhile (`rebased: true`); otherwise
     * `CONFLICT` lists them (`changed`, `removed`, `added`, or `env-gone`).
     * `force` applies it over the current file regardless.
     */
    'env:commit': withVault(async ({ id }, changeset) => {
      const view = session.getView(id, changeset?.viewId);
      if (!view) return invalid('Unknown view');
      const ops = Array.isArray(changeset.ops) ? changeset.ops : [];
      let conflicts = [];
      let rebased = false;
      let after = null;
      const result = await write(
        id,
        (vault, { revision }) => {
          if (revision !== view.revision && !changeset.force) {
            if (!vault.environments[view.env]) {
              conflicts = [{ key: null, kind: 'env-gone' }];
            } else {
              const before = view.stamps ?? {};
              const now = stampsOf(vault, view.env);
              conflicts = [...new Set(ops.map((op) => op?.key))]
                .filter((key) => now[key] !== before[key])
                .map((key) => ({
                  key,
                  kind: !(key in before)
                    ? 'added'
                    : !(key in now)
                      ? 'removed'
                      : 'changed',
                }));
            }
            if (conflicts.length > 0) {
              throw Object.assign(
                new Error(
                  conflicts[0].kind === 'env-gone'
                    ? `${view.env} was deleted elsewhere`
                    : `Changed elsewhere meanwhile: ${conflicts.map((c) => c.key).join(', ')}`
                ),
                { code: 'CONFLICT' }
              );
            }
            rebased = true;
          }
          vault.applyVarChanges(view.env, ops, {
            message: 'Edited in the desktop app',
          });
          after = vault;
        },
        null
      );
      if (!result.success) {
        return result.code === 'CONFLICT' ? { ...result, conflicts } : result;
      }
      showing(view, after, result.revision);
      return { success: true, revision: result.revision, rebased };
    }),

    /**
     * Change an env itself (Task 24): `rename`, `duplicate`, `delete`,
     * `extends` or `describe`, against the env list's revision.
     */
    'env:manage': withVault(async ({ id, vaultPath }, request) => {
      const {
        op,
        env,
        name,
        parent = null,
        description = '',
        expectedRevision = null,
        updateReferences = false,
      } = request ?? {};
      if (!MANAGE_OPS.includes(op)) return invalid('Unknown change');
      if (typeof env !== 'string') return invalid('Choose an environment');
      if (
        (op === 'rename' || op === 'duplicate') &&
        (typeof name !== 'string' || !ENV_NAME_PATTERN.test(name))
      ) {
        return invalid('Use 1–64 letters, digits, ".", "-" or "_"');
      }
      if (op === 'describe' && String(description).length > 500) {
        return invalid('Keep the description under 500 characters');
      }
      let updated = [];
      const result = await write(
        id,
        async (vault) => {
          if (!vault.environments[env]) {
            throw Object.assign(new Error(`Environment '${env}' not found`), {
              code: 'NOT_FOUND',
            });
          }
          const children = vault
            .listEnvironmentNames()
            .filter((other) => vault.environments[other].extends === env);
          if (op === 'rename') {
            vault.renameEnvironment(env, name); // children follow
            // In the same write, so no reader sees one without the other.
            if (updateReferences === true) {
              updated = vault.renameReferences(env, name, {
                message: `References to ${env} renamed to ${name} in the desktop app`,
              });
            }
          } else if (op === 'duplicate') {
            const active = vault.getActiveVersion(env);
            vault.addEnvironment(name, {
              description: vault.environments[env].description,
            });
            vault.environments[name].extends = vault.environments[env].extends;
            if (active) {
              vault.addVersion(name, active.vars, {
                required: active.required,
                nonSensitive: active.nonSensitive,
                comments: active.comments ?? {},
                message: `Copied from ${env} in the desktop app`,
              });
            }
          } else if (op === 'delete') {
            if (children.length > 0) {
              throw new Error(
                `${children.join(', ')} ${children.length === 1 ? 'extends' : 'extend'} ${env}; change that first`
              );
            }
            vault.removeEnvironment(env);
            await service.snapshot(vaultPath, 'deleted');
          } else if (op === 'extends') {
            vault.setExtends(env, parent || null);
            if (parent && extendsLoop(vault, env)) {
              throw new Error(`${parent} already extends ${env}`);
            }
          } else {
            vault.environments[env].description = String(description).trim();
          }
        },
        expectedRevision
      );
      if (!result.success) return result;
      return op === 'rename'
        ? { success: true, revision: result.revision, updated }
        : { success: true, revision: result.revision };
    }),

    /**
     * Which envs refer to `env` with `{{env:env/KEY}}`, and how often
     * (New-30): names and counts only, no values. For the rename dialog.
     */
    'env:references': withVault(async ({ id }, env) => {
      if (typeof env !== 'string') return invalid('Choose an environment');
      const result = await read(id);
      if (!result.success) return result;
      if (!result.vault.environments[env]) {
        return { success: false, code: 'NOT_FOUND', error: 'Environment gone' };
      }
      return { success: true, references: result.vault.referencesTo(env) };
    }),

    /** An env's versions, newest first, without values (Task 25). */
    'env:history': withVault(async ({ id }, viewId) => {
      const view = session.getView(id, viewId);
      if (!view) return invalid('Unknown view');
      const result = await read(id);
      if (!result.success) return result;
      if (!result.vault.environments[view.env]) {
        return { success: false, code: 'NOT_FOUND', error: 'Environment gone' };
      }
      const versions = result.vault.getHistory(view.env).map((v) => {
        const vars = result.vault.getVersion(view.env, v.n).vars;
        return { ...v, keys: Object.keys(vars).sort() };
      });
      return {
        success: true,
        revision: result.revision,
        versions: versions.reverse(),
      };
    }),

    /** Make an old version active again, as a new version (Task 25). */
    'env:rollback': withVault(async ({ id }, viewId, n) => {
      const view = session.getView(id, viewId);
      if (!view) return invalid('Unknown view');
      if (!Number.isInteger(n)) return invalid('Choose a version');
      let after = null;
      const result = await write(
        id,
        (vault) => {
          vault.rollback(view.env, n);
          after = vault;
        },
        view.revision
      );
      if (!result.success) return result;
      showing(view, after, result.revision);
      return { success: true, revision: result.revision };
    }),

    /**
     * Squash the history to its last `keep` versions (Task 25). The vault
     * is copied to `<vault>.squashed.<ts>` first (Task 7).
     */
    'env:squash': withVault(async ({ id, vaultPath }, viewId, keep = 1) => {
      const view = session.getView(id, viewId);
      if (!view) return invalid('Unknown view');
      if (!Number.isInteger(keep) || keep < 1) {
        return invalid('Keep at least one version');
      }
      let snapshotPath = null;
      let after = null;
      const result = await write(
        id,
        async (vault) => {
          vault.getHistory(view.env); // a missing env throws before the copy
          snapshotPath = await service.snapshot(vaultPath, 'squashed');
          vault.squash(view.env, { keep });
          after = vault;
        },
        view.revision
      );
      if (!result.success) return result;
      showing(view, after, result.revision);
      return {
        success: true,
        revision: result.revision,
        snapshot: path.basename(snapshotPath),
      };
    }),

    'env:create': withVault(async ({ id }, name, expectedRevision) => {
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
