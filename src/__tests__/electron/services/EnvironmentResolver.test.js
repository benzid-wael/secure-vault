// @vitest-environment node
import { EnvironmentResolver } from '../../../electron/services/EnvironmentResolver.js';
import { EnvironmentVault } from '../../../electron/models/EnvironmentVault.js';

/** Build a vault from a setup callback that receives the model instance. */
function buildVault(setup) {
  const vault = new EnvironmentVault();
  setup(vault);
  return vault;
}

/** base → staging → dev layering chain used by several tests. */
function layeredVault() {
  return buildVault((v) => {
    v.addEnvironment('base');
    v.addVersion(
      'base',
      { LOG_LEVEL: 'info', PORT: '3000' },
      { required: ['PORT'] }
    );

    v.addEnvironment('staging');
    v.addVersion(
      'staging',
      { API_URL: 'https://staging.example.com', NODE_ENV: 'staging' },
      { required: ['API_URL'] }
    );
    v.setExtends('staging', 'base');

    v.addEnvironment('dev');
    v.addVersion('dev', { API_URL: 'http://localhost:3000' });
    v.setExtends('dev', 'staging');
  });
}

describe('EnvironmentResolver', () => {
  describe('resolveEnvironment — layering', () => {
    it('returns own vars for an environment with no extends', () => {
      const vault = buildVault((v) => {
        v.addEnvironment('base');
        v.addVersion('base', { LOG_LEVEL: 'info', PORT: '3000' });
      });
      const resolver = new EnvironmentResolver(vault);
      expect(resolver.resolveEnvironment('base')).toEqual({
        LOG_LEVEL: 'info',
        PORT: '3000',
      });
    });

    it('merges the extends chain with the child overriding ancestors', () => {
      const resolver = new EnvironmentResolver(layeredVault());
      const dev = resolver.resolveEnvironment('dev');
      expect(dev.LOG_LEVEL).toBe('info'); // from base
      expect(dev.PORT).toBe('3000'); // from base
      expect(dev.NODE_ENV).toBe('staging'); // from staging
      expect(dev.API_URL).toBe('http://localhost:3000'); // dev overrides staging
    });
  });

  describe('resolveEnvironment — template references', () => {
    it('resolves a cross-environment {{env:name/KEY}} ref', () => {
      const vault = layeredVault();
      vault.addVersion('dev', {
        API_URL: 'http://localhost:3000',
        DB_URL: '{{env:staging/API_URL}}',
      });
      const resolver = new EnvironmentResolver(vault);
      expect(resolver.resolveEnvironment('dev').DB_URL).toBe(
        'https://staging.example.com'
      );
    });

    it('resolves a {{env:_self/KEY}} ref against the layered map', () => {
      const vault = buildVault((v) => {
        v.addEnvironment('dev');
        v.addVersion('dev', {
          API_URL: 'http://localhost',
          ALIAS: '{{env:_self/API_URL}}',
        });
      });
      const resolver = new EnvironmentResolver(vault);
      expect(resolver.resolveEnvironment('dev').ALIAS).toBe('http://localhost');
    });

    it('resolves a ref that points at an inherited key', () => {
      const vault = layeredVault();
      // dev references PORT, which it inherits from base via staging.
      vault.addVersion('dev', { ECHO: '{{env:_self/PORT}}' });
      const resolver = new EnvironmentResolver(vault);
      expect(resolver.resolveEnvironment('dev').ECHO).toBe('3000');
    });

    it('throws on a reference to a missing environment', () => {
      const vault = buildVault((v) => {
        v.addEnvironment('dev');
        v.addVersion('dev', { X: '{{env:ghost/Y}}' });
      });
      const resolver = new EnvironmentResolver(vault);
      expect(() => resolver.resolveEnvironment('dev')).toThrow(/not found/i);
    });

    it('throws on a reference to a missing key', () => {
      const vault = buildVault((v) => {
        v.addEnvironment('a');
        v.addVersion('a', { K: 'v' });
        v.addEnvironment('dev');
        v.addVersion('dev', { X: '{{env:a/MISSING}}' });
      });
      const resolver = new EnvironmentResolver(vault);
      expect(() => resolver.resolveEnvironment('dev')).toThrow(/not found/i);
    });

    it('detects a template reference cycle', () => {
      const vault = buildVault((v) => {
        v.addEnvironment('a');
        v.addVersion('a', { X: '{{env:b/X}}' });
        v.addEnvironment('b');
        v.addVersion('b', { X: '{{env:a/X}}' });
      });
      const resolver = new EnvironmentResolver(vault);
      expect(() => resolver.resolveEnvironment('a')).toThrow(/circular/i);
    });

    it('detects a trivial self-reference cycle', () => {
      const vault = buildVault((v) => {
        v.addEnvironment('a');
        v.addVersion('a', { X: '{{env:_self/X}}' });
      });
      const resolver = new EnvironmentResolver(vault);
      expect(() => resolver.resolveEnvironment('a')).toThrow(/circular/i);
    });
  });

  describe('resolveEnvironment — extends chain integrity', () => {
    it('detects a circular extends chain', () => {
      const vault = buildVault((v) => {
        v.addEnvironment('a');
        v.addVersion('a', { X: '1' });
        v.addEnvironment('b');
        v.addVersion('b', { Y: '2' });
        v.setExtends('a', 'b');
        v.setExtends('b', 'a');
      });
      const resolver = new EnvironmentResolver(vault);
      expect(() => resolver.resolveEnvironment('a')).toThrow(
        /circular extends/i
      );
    });

    it('rejects an extends chain deeper than the max', () => {
      const vault = buildVault((v) => {
        for (let i = 0; i <= 6; i++) v.addEnvironment(`e${i}`);
        for (let i = 0; i < 6; i++) v.setExtends(`e${i}`, `e${i + 1}`);
      });
      const resolver = new EnvironmentResolver(vault);
      expect(() => resolver.resolveEnvironment('e0')).toThrow(/max depth/i);
    });
  });

  describe('aggregateRequired', () => {
    it('unions required keys across the extends chain, deduped', () => {
      const vault = buildVault((v) => {
        v.addEnvironment('base');
        v.addVersion('base', { PORT: '3000' }, { required: ['PORT'] });
        v.addEnvironment('staging');
        v.addVersion(
          'staging',
          { API_URL: 'x', PORT: '8080' },
          { required: ['API_URL', 'PORT'] }
        );
        v.setExtends('staging', 'base');
      });
      const resolver = new EnvironmentResolver(vault);
      expect(resolver.aggregateRequired('staging').sort()).toEqual([
        'API_URL',
        'PORT',
      ]);
    });
  });

  describe('resolveValue', () => {
    it('resolves a single inherited and templated key', () => {
      const vault = layeredVault();
      vault.addVersion('dev', { DB_URL: '{{env:staging/API_URL}}' });
      const resolver = new EnvironmentResolver(vault);
      expect(resolver.resolveValue('dev', 'DB_URL')).toBe(
        'https://staging.example.com'
      );
      expect(resolver.resolveValue('dev', 'PORT')).toBe('3000'); // inherited
    });

    it('throws when the key is absent after inheritance', () => {
      const resolver = new EnvironmentResolver(layeredVault());
      expect(() => resolver.resolveValue('dev', 'NOPE')).toThrow(/not found/i);
    });
  });
});
