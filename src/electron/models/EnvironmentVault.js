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
    if (this.environments[name]) {
      throw new Error(`Environment '${name}' already exists`);
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
    if (this.environments[newName]) {
      throw new Error(`Environment '${newName}' already exists`);
    }
    if (oldName === newName) return;

    this.environments[newName] = this.environments[oldName];
    delete this.environments[oldName];
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

  addVersion(
    name,
    vars,
    { required = [], nonSensitive = [], message = null } = {}
  ) {
    const env = this.#getEnv(name);
    const nextN =
      env.versions.length > 0 ? env.versions[env.versions.length - 1].n + 1 : 1;

    const version = {
      n: nextN,
      created: new Date().toISOString(),
      message: message,
      vars: { ...vars },
      required: [...required],
      nonSensitive: [...nonSensitive],
    };

    env.versions.push(version);
    env.activeVersion = nextN;
    this.updated = new Date().toISOString();
    return version;
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

      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
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
