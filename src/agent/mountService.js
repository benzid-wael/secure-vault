import path from 'path';

/**
 * Mount service — the agent verbs that fan the delivery manifest out to live
 * files (SPEC §13.5, G11/G18/G26). It composes the v1.8 manifest/render logic
 * (injected as `ops`, so `src/agent` never imports from `bin/`) with the session
 * and the MountRegistry.
 *
 * `mount` pulls the env's vars through `session.handle('get-env')`, so it is
 * automatically refused when the session is locked (I2) and never bypasses the
 * request-scoped protocol. Each artifact's rebuild closure re-fetches vars, so
 * the file-watch path (daemon) re-materializes with current values and respects
 * the lock.
 */
export function createMountService({ session, registry, cwd, ops }) {
  const {
    findProjectConfig,
    normalizeManifest,
    renderDeliverEntry,
    writeArtifact,
    readFile,
  } = ops;

  const resolveIn = (base, p) => (path.isAbsolute(p) ? p : path.join(base, p));

  async function mount(req) {
    const env = req && req.env;
    if (!env || typeof env !== 'string') {
      return { ok: false, error: 'mount requires an "env" name' };
    }

    const { config, dir } = findProjectConfig(cwd);
    const manifest = normalizeManifest(config);
    if (manifest.entries.length === 0) {
      return { ok: false, error: 'no delivery manifest (.vaultrc "deliver")' };
    }
    const baseDir = dir || cwd;
    const readTemplate = (p) => readFile(resolveIn(baseDir, p));

    // Render pulls vars through the session each time, so a locked session
    // refuses the mount and a watch-triggered rebuild uses current values.
    const renderEntry = (entry) => {
      const got = session.handle({ verb: 'get-env', env });
      if (!got.ok) throw new Error(got.error);
      return renderDeliverEntry(entry, got.data, readTemplate);
    };

    try {
      const mounted = [];
      for (const entry of manifest.entries) {
        const absPath = resolveIn(baseDir, entry.path);
        const rebuild = async () => {
          await writeArtifact(absPath, renderEntry(entry), {
            mode: entry.mode,
          });
        };
        await rebuild();
        registry.add(absPath, rebuild);
        mounted.push(entry.path);
      }
      return { ok: true, data: { mounted } };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  }

  function list() {
    return { ok: true, data: { mounts: registry.list() } };
  }

  function unmount(req) {
    const target = req && req.path;
    if (target) {
      registry.remove(path.resolve(target));
    } else {
      registry.wipeAll();
    }
    return { ok: true, data: { mounts: registry.list() } };
  }

  return { mount, list, unmount };
}
