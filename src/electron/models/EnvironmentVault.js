/**
 * Environment names that cannot be used because they collide with reserved
 * template-reference keywords. `{{env:self/KEY}}` always means "this
 * environment", so an environment literally named `self` would be
 * unreferenceable. Compared case-insensitively.
 */
const RESERVED_ENV_NAMES = new Set(['self']);

const MAX_ENVIRONMENTS = 100;
const MAX_VERSIONS = 1000;
const MAX_VARS = 500;
const MAX_KEY_LENGTH = 1024;
const MAX_VALUE_LENGTH = 65536;
const MAX_COMMENT_LENGTH = 1000;

/** A key that survives a dotenv export and re-import (see `parseEnvFile`). */
export const ENV_KEY_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;

/**
 * A version's comments, keeping only non-empty ones for keys in `vars`.
 * Returns undefined when none are left, so files without comments keep
 * their old shape.
 */
function commentsFor(vars, comments) {
  const kept = Object.entries(comments || {}).filter(
    ([key, text]) => key in vars && typeof text === 'string' && text !== ''
  );
  return kept.length ? Object.fromEntries(kept) : undefined;
}

function assertNameAllowed(name) {
  if (RESERVED_ENV_NAMES.has(String(name).toLowerCase())) {
    throw new Error(`Environment name '${name}' is reserved`);
  }
}

export class EnvironmentVault {
  constructor({
    vaultVersion = 1,
    created = new Date().toISOString(),
    updated = new Date().toISOString(),
    environments = {},
  } = {}) {
    this.vaultVersion = vaultVersion;
    this.created = created;
    this.updated = updated;
    this.environments = {};

    for (const [name, env] of Object.entries(environments)) {
      this.environments[name] = {
        description: env.description || '',
        versions: (env.versions || []).map((v) => ({ ...v })),
        activeVersion: env.activeVersion || 1,
        extends: env.extends || null,
      };
    }
  }

  toJSON() {
    return {
      vaultVersion: this.vaultVersion,
      created: this.created,
      updated: this.updated,
      environments: Object.fromEntries(
        Object.entries(this.environments).map(([name, env]) => [
          name,
          {
            description: env.description,
            versions: env.versions.map((v) => ({ ...v })),
            activeVersion: env.activeVersion,
            extends: env.extends,
          },
        ])
      ),
    };
  }

  static fromJSON(data) {
    return new EnvironmentVault(data);
  }

  listEnvironmentNames() {
    return Object.keys(this.environments).sort();
  }

  addEnvironment(name, { description = '' } = {}) {
    assertNameAllowed(name);
    if (this.environments[name]) {
      throw new Error(`Environment '${name}' already exists`);
    }
    if (Object.keys(this.environments).length >= MAX_ENVIRONMENTS) {
      throw new Error(
        `Cannot add environment: maximum of ${MAX_ENVIRONMENTS} environments reached`
      );
    }
    this.environments[name] = {
      description,
      versions: [],
      activeVersion: 0,
      extends: null,
    };
    this.updated = new Date().toISOString();
  }

  removeEnvironment(name) {
    if (!this.environments[name]) {
      throw new Error(`Environment '${name}' not found`);
    }
    delete this.environments[name];
    this.updated = new Date().toISOString();
  }

  renameEnvironment(oldName, newName) {
    if (!this.environments[oldName]) {
      throw new Error(`Environment '${oldName}' not found`);
    }
    assertNameAllowed(newName);
    if (this.environments[newName]) {
      throw new Error(`Environment '${newName}' already exists`);
    }
    if (oldName === newName) return;

    this.environments[newName] = this.environments[oldName];
    delete this.environments[oldName];
    this.updated = new Date().toISOString();
  }

  setExtends(name, parent) {
    const env = this.#getEnv(name);

    if (parent === null || parent === undefined) {
      env.extends = null;
      this.updated = new Date().toISOString();
      return;
    }

    if (parent === name) {
      throw new Error(`Environment '${name}' cannot extend itself`);
    }
    if (!this.environments[parent]) {
      throw new Error(`Environment '${parent}' not found`);
    }

    env.extends = parent;
    this.updated = new Date().toISOString();
  }

  #getEnv(name) {
    const env = this.environments[name];
    if (!env) {
      throw new Error(`Environment '${name}' not found`);
    }
    return env;
  }

  #getVersion(env, versionN) {
    const version = env.versions.find((v) => v.n === versionN);
    if (!version) {
      throw new Error(`Version ${versionN} not found in environment`);
    }
    return version;
  }

  /**
   * @param {string} name
   * @param {Object} vars
   * @param {Object} [options]
   * @param {string[]} [options.required]
   * @param {string[]} [options.nonSensitive]
   * @param {string|null} [options.message]
   * @param {Record<string, string>} [options.comments] Optional note per key.
   *   Left out, the active version's comments carry over for the keys still
   *   in `vars`, so a write that knows nothing of comments keeps them.
   */
  addVersion(
    name,
    vars,
    { required = [], nonSensitive = [], message = null, comments } = {}
  ) {
    const env = this.#getEnv(name);

    if (env.versions.length >= MAX_VERSIONS) {
      throw Object.assign(
        new Error(
          `Cannot add version: maximum of ${MAX_VERSIONS} versions per environment reached`
        ),
        { code: 'LIMIT' }
      );
    }

    const varEntries = Object.entries(vars);
    if (varEntries.length > MAX_VARS) {
      throw new Error(
        `Cannot add version: maximum of ${MAX_VARS} variables per environment exceeded (${varEntries.length})`
      );
    }
    for (const [key, value] of varEntries) {
      if (key.length > MAX_KEY_LENGTH) {
        throw new Error(
          `Key '${key.slice(0, 20)}...' exceeds maximum length of ${MAX_KEY_LENGTH} characters`
        );
      }
      if (typeof value === 'string' && value.length > MAX_VALUE_LENGTH) {
        throw new Error(
          `Value for '${key}' exceeds maximum length of ${MAX_VALUE_LENGTH} characters`
        );
      }
    }

    const kept = commentsFor(
      vars,
      comments ?? this.getActiveVersion(name)?.comments
    );
    for (const [key, text] of Object.entries(kept || {})) {
      if (text.length > MAX_COMMENT_LENGTH) {
        throw new Error(
          `Comment for '${key}' exceeds maximum length of ${MAX_COMMENT_LENGTH} characters`
        );
      }
    }

    const nextN =
      env.versions.length > 0 ? env.versions[env.versions.length - 1].n + 1 : 1;

    const version = {
      n: nextN,
      created: new Date().toISOString(),
      message: message,
      vars: { ...vars },
      required: [...required],
      nonSensitive: [...nonSensitive],
      ...(kept && { comments: kept }),
    };

    env.versions.push(version);
    env.activeVersion = nextN;
    this.updated = new Date().toISOString();
    return version;
  }

  /**
   * Apply a changeset to `name` as one new version (GUI-ENV-RFC §6.4).
   *
   * @param {string} name
   * @param {Array<{op: string, key: string, value?: string,
   *   sensitive?: boolean, comment?: string}>} ops
   *   `{op: 'set', key, value, sensitive?, comment?}` or `{op: 'rm', key}`.
   *   `set` without `sensitive` keeps the key's current flag; a new key is
   *   sensitive. `set` without `comment` keeps the key's comment; `''`
   *   removes it. `rm` of a key that isn't there throws.
   * @param {Object} [options]
   * @param {string|null} [options.message]
   * @param {boolean} [options.createEnv] Create a missing env instead of
   *   throwing. Changesets from the GUI never do (RFC H2).
   */
  applyVarChanges(name, ops, { message = null, createEnv = false } = {}) {
    if (!Array.isArray(ops) || ops.length === 0) {
      throw new Error('No changes to apply');
    }
    if (!this.environments[name]) {
      if (!createEnv) throw new Error(`Environment '${name}' not found`);
      this.addEnvironment(name);
    }

    const active = this.getActiveVersion(name);
    const vars = active ? { ...active.vars } : {};
    const nonSensitive = new Set(active ? active.nonSensitive : []);
    const required = new Set(active ? active.required : []);
    /** @type {Record<string, string>} */
    const comments = { ...(active?.comments || {}) };

    for (const change of ops) {
      const { op, key } = change ?? {};
      if (typeof key !== 'string' || !ENV_KEY_PATTERN.test(key)) {
        throw new Error(`Invalid key '${key}'`);
      }
      if (op === 'set') {
        if (typeof change.value !== 'string') {
          throw new Error(`The value for '${key}' must be a string`);
        }
        vars[key] = change.value;
        if (change.sensitive === false) nonSensitive.add(key);
        if (change.sensitive === true) nonSensitive.delete(key);
        if (change.comment !== undefined) {
          if (typeof change.comment !== 'string') {
            throw new Error(`The comment for '${key}' must be a string`);
          }
          comments[key] = change.comment.trim();
        }
      } else if (op === 'rm') {
        if (!(key in vars)) {
          throw new Error(`Key '${key}' not found in environment '${name}'`);
        }
        delete vars[key];
        nonSensitive.delete(key);
        required.delete(key);
        delete comments[key];
      } else {
        throw new Error(`Unknown change '${op}'`);
      }
    }

    return this.addVersion(name, vars, {
      nonSensitive: [...nonSensitive],
      required: [...required],
      comments,
      message,
    });
  }

  getActiveVersion(name) {
    const env = this.#getEnv(name);
    if (env.activeVersion === 0 || env.versions.length === 0) {
      return null;
    }
    return this.#getVersion(env, env.activeVersion);
  }

  setActiveVersion(name, versionN) {
    const env = this.#getEnv(name);
    this.#getVersion(env, versionN);
    env.activeVersion = versionN;
    this.updated = new Date().toISOString();
  }

  getVersion(name, versionN) {
    const env = this.#getEnv(name);
    return JSON.parse(JSON.stringify(this.#getVersion(env, versionN)));
  }

  getHistory(name) {
    const env = this.#getEnv(name);
    return env.versions.map((v) => ({
      n: v.n,
      created: v.created,
      message: v.message,
      keyCount: Object.keys(v.vars).length,
      isActive: v.n === env.activeVersion,
    }));
  }

  rollback(name, versionN) {
    const env = this.#getEnv(name);
    const source = this.#getVersion(env, versionN);

    return this.addVersion(
      name,
      { ...source.vars },
      {
        required: [...source.required],
        nonSensitive: [...source.nonSensitive],
        comments: { ...(source.comments || {}) },
        message: `Rollback to version ${versionN}`,
      }
    );
  }

  squash(name, { keep = 1 } = {}) {
    const env = this.#getEnv(name);
    const keepN = Math.max(1, keep);
    if (env.versions.length <= keepN) return;

    const keepFromEnd = keepN - 1;
    const versionsToKeep =
      keepFromEnd > 0 ? env.versions.slice(-keepFromEnd) : [];
    const versionsToSquash =
      keepFromEnd > 0 ? env.versions.slice(0, -keepFromEnd) : [...env.versions];

    const lastSquashed = versionsToSquash[versionsToSquash.length - 1];
    const squashedVars = { ...lastSquashed.vars };
    const squashedRequired = [...lastSquashed.required];
    const squashedNonSensitive = [...lastSquashed.nonSensitive];

    const wasActiveSquashed = env.activeVersion <= lastSquashed.n;

    env.versions = [
      {
        n: 1,
        created: versionsToSquash[0].created,
        message: `Squashed ${versionsToSquash.length} versions (v${versionsToSquash[0].n}–v${lastSquashed.n})`,
        vars: squashedVars,
        required: squashedRequired,
        nonSensitive: squashedNonSensitive,
        ...(lastSquashed.comments && {
          comments: { ...lastSquashed.comments },
        }),
      },
      ...versionsToKeep.map((v, i) => ({
        ...v,
        n: i + 2,
      })),
    ];

    env.activeVersion = wasActiveSquashed ? 1 : env.versions.length;
    this.updated = new Date().toISOString();
  }

  isSensitive(name, key) {
    const version = this.getActiveVersion(name);
    if (!version) return true;
    return !version.nonSensitive.includes(key);
  }

  static parseEnvFile(content) {
    const vars = {};
    const lines = content.split('\n');

    for (const rawLine of lines) {
      const line = rawLine.trim();

      if (!line || line.startsWith('#')) continue;

      const match = line.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
      if (!match) continue;

      const key = match[1];
      let value = match[2];

      const isDoubleQuoted =
        value.length >= 2 && value.startsWith('"') && value.endsWith('"');
      const isSingleQuoted =
        value.length >= 2 && value.startsWith("'") && value.endsWith("'");

      if (isDoubleQuoted) {
        // Decode the escapes written by toDotenv()/quoteDotenvValue():
        // \n \r \t -> control chars; \" \\ -> the literal char.
        value = value.slice(1, -1).replace(/\\([\\nrt"])/g, (_, c) => {
          if (c === 'n') return '\n';
          if (c === 'r') return '\r';
          if (c === 't') return '\t';
          return c; // \" -> "  and  \\ -> \
        });
      } else if (isSingleQuoted) {
        // Single quotes are literal (no escape processing).
        value = value.slice(1, -1);
      }

      vars[key] = value;
    }

    return vars;
  }

  importFromEnvFile(name, content, { message = null } = {}) {
    const vars = EnvironmentVault.parseEnvFile(content);

    if (!this.environments[name]) {
      this.addEnvironment(name);
    }

    return this.addVersion(name, vars, { message });
  }
}
