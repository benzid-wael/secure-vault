/**
 * Read-time resolution of environment values: `extends` layering (SPEC §9)
 * followed by `{{env:name/KEY}}` template references (SPEC §8).
 *
 * Pure logic — no I/O, no crypto. Operates on an in-memory `EnvironmentVault`
 * instance and throws on any unresolvable input (missing env/key, cycles, depth
 * overflow). Service callers convert these throws into `{ success, error }`.
 *
 * Stored values keep their `{{...}}` tokens verbatim; resolution happens only
 * when a value is consumed (`run`, `export`, `get`, `diff`, `validate`).
 */

/** `{{env:SRC/KEY}}` where SRC is an env name or `_self`. Segments per §8.1. */
const REF_RE = /\{\{\s*env:([A-Za-z0-9._-]+)\/([A-Za-z0-9._-]+)\s*\}\}/g;

/** Max `extends` chain length (§9.2) and max template recursion depth (§8.3). */
const MAX_DEPTH = 5;

export class EnvironmentResolver {
  constructor(vault) {
    this.vault = vault;
  }

  /**
   * The `extends` chain for an environment, child-first:
   * `[name, parent, grandparent, ...]`. Throws on a missing link, a cycle, or
   * a chain longer than MAX_DEPTH.
   */
  #extendsChain(name) {
    const chain = [];
    const seen = new Set();
    let current = name;

    while (current != null) {
      if (!this.vault.environments[current]) {
        throw new Error(`Environment '${current}' not found`);
      }
      if (seen.has(current)) {
        throw new Error(
          `Circular extends chain detected at environment '${current}'`
        );
      }
      seen.add(current);
      chain.push(current);
      if (chain.length > MAX_DEPTH) {
        throw new Error(
          `Extends chain for '${name}' exceeded max depth of ${MAX_DEPTH}`
        );
      }
      current = this.vault.environments[current].extends || null;
    }

    return chain;
  }

  /** Layered vars (extends merge, child overrides), WITHOUT template resolution. */
  #layeredVars(name) {
    const chain = this.#extendsChain(name);
    const merged = {};
    // Apply ancestor-first so the child wins on key collisions.
    for (let i = chain.length - 1; i >= 0; i--) {
      const active = this.vault.getActiveVersion(chain[i]);
      if (active) Object.assign(merged, active.vars);
    }
    return merged;
  }

  /**
   * Resolve every `{{env:.../...}}` in a single value string. `selfEnv` is the
   * environment the value belongs to (the target of `_self`). `visited` holds
   * the ref keys currently on the resolution stack for cycle detection.
   */
  #resolveString(value, selfEnv, visited, depth) {
    if (typeof value !== 'string') return value;
    if (depth > MAX_DEPTH) {
      throw new Error(
        `Template reference resolution exceeded max depth of ${MAX_DEPTH}`
      );
    }

    return value.replace(REF_RE, (_match, src, key) => {
      const targetEnv = src === '_self' ? selfEnv : src;
      const refKey = `env:${targetEnv}/${key}`;

      if (visited.has(refKey)) {
        throw new Error(`Circular reference detected: {{${refKey}}}`);
      }

      const layered = this.#layeredVars(targetEnv); // throws if env missing
      if (!(key in layered)) {
        throw new Error(`Key '${key}' not found in environment '${targetEnv}'`);
      }

      const nextVisited = new Set(visited).add(refKey);
      return this.#resolveString(
        layered[key],
        targetEnv,
        nextVisited,
        depth + 1
      );
    });
  }

  /** Fully resolved vars for an environment: layering then template refs. */
  resolveEnvironment(name) {
    const layered = this.#layeredVars(name);
    const resolved = {};
    for (const key of Object.keys(layered)) {
      resolved[key] = this.#resolveString(layered[key], name, new Set(), 0);
    }
    return resolved;
  }

  /** Resolve a single key within an environment (used by `get`). */
  resolveValue(name, key) {
    const layered = this.#layeredVars(name);
    if (!(key in layered)) {
      throw new Error(`Key '${key}' not found in environment '${name}'`);
    }
    return this.#resolveString(layered[key], name, new Set(), 0);
  }

  /** Union of `required` keys across the whole extends chain (§9.5), deduped. */
  aggregateRequired(name) {
    const chain = this.#extendsChain(name);
    const required = new Set();
    for (const envName of chain) {
      const active = this.vault.getActiveVersion(envName);
      if (active) for (const k of active.required) required.add(k);
    }
    return [...required];
  }
}
