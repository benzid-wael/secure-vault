import { EnvironmentVault } from '../../../electron/models/EnvironmentVault.js';

function createSampleVault() {
  const vault = new EnvironmentVault();
  vault.addEnvironment('staging', { description: 'Staging env' });
  vault.addVersion(
    'staging',
    { API_URL: 'https://staging.example.com', API_KEY: 'sk-test' },
    { required: ['API_URL'], nonSensitive: ['API_URL'] }
  );
  vault.addVersion(
    'staging',
    { API_URL: 'https://staging.example.com/v2', API_KEY: 'sk-test-2' },
    { message: 'Update URL' }
  );
  vault.addEnvironment('production');
  vault.addVersion('production', {
    API_URL: 'https://example.com',
    DB_URL: 'postgres://prod/db',
  });
  return vault;
}

describe('EnvironmentVault', () => {
  describe('constructor', () => {
    it('should create an empty vault with defaults', () => {
      const vault = new EnvironmentVault();
      expect(vault.vaultVersion).toBe(1);
      expect(vault.created).toBeDefined();
      expect(vault.updated).toBeDefined();
      expect(vault.listEnvironmentNames()).toEqual([]);
    });

    it('should load from existing data', () => {
      const data = {
        vaultVersion: 1,
        created: '2026-01-01T00:00:00.000Z',
        updated: '2026-01-02T00:00:00.000Z',
        environments: {
          dev: {
            description: 'Dev',
            versions: [
              {
                n: 1,
                created: '2026-01-01T00:00:00.000Z',
                message: null,
                vars: { KEY: 'val' },
                required: [],
                nonSensitive: [],
              },
            ],
            activeVersion: 1,
            extends: null,
          },
        },
      };
      const vault = new EnvironmentVault(data);
      expect(vault.listEnvironmentNames()).toEqual(['dev']);
      expect(vault.getActiveVersion('dev').vars.KEY).toBe('val');
    });
  });

  describe('toJSON / fromJSON', () => {
    it('should round-trip correctly', () => {
      const vault = createSampleVault();
      const json = vault.toJSON();
      const restored = EnvironmentVault.fromJSON(json);
      expect(restored.listEnvironmentNames()).toEqual([
        'production',
        'staging',
      ]);
      expect(restored.getActiveVersion('staging').vars.API_URL).toBe(
        'https://staging.example.com/v2'
      );
    });
  });

  describe('addEnvironment', () => {
    it('should add a new environment', () => {
      const vault = new EnvironmentVault();
      vault.addEnvironment('dev', { description: 'Development' });
      expect(vault.listEnvironmentNames()).toEqual(['dev']);
    });

    it('should throw if environment already exists', () => {
      const vault = new EnvironmentVault();
      vault.addEnvironment('dev');
      expect(() => vault.addEnvironment('dev')).toThrow(
        "Environment 'dev' already exists"
      );
    });
  });

  describe('removeEnvironment', () => {
    it('should remove an environment', () => {
      const vault = createSampleVault();
      vault.removeEnvironment('production');
      expect(vault.listEnvironmentNames()).toEqual(['staging']);
    });

    it('should throw if not found', () => {
      const vault = new EnvironmentVault();
      expect(() => vault.removeEnvironment('missing')).toThrow(
        "Environment 'missing' not found"
      );
    });
  });

  describe('renameEnvironment', () => {
    it('should rename an environment', () => {
      const vault = createSampleVault();
      vault.renameEnvironment('staging', 'staging-v2');
      expect(vault.listEnvironmentNames()).toEqual([
        'production',
        'staging-v2',
      ]);
    });

    it('should throw if new name already exists', () => {
      const vault = createSampleVault();
      expect(() => vault.renameEnvironment('staging', 'production')).toThrow(
        "Environment 'production' already exists"
      );
    });

    it('should throw if old name not found', () => {
      const vault = new EnvironmentVault();
      expect(() => vault.renameEnvironment('missing', 'new')).toThrow(
        "Environment 'missing' not found"
      );
    });
  });

  describe('addVersion', () => {
    it('should add versions with auto-incrementing n', () => {
      const vault = new EnvironmentVault();
      vault.addEnvironment('dev');
      const v1 = vault.addVersion('dev', { KEY: 'a' });
      expect(v1.n).toBe(1);
      const v2 = vault.addVersion('dev', { KEY: 'b' });
      expect(v2.n).toBe(2);
    });

    it('should mark as active version', () => {
      const vault = new EnvironmentVault();
      vault.addEnvironment('dev');
      vault.addVersion('dev', { KEY: 'a' });
      vault.addVersion('dev', { KEY: 'b' });
      const active = vault.getActiveVersion('dev');
      expect(active.n).toBe(2);
      expect(active.vars.KEY).toBe('b');
    });

    it('should store required and nonSensitive', () => {
      const vault = new EnvironmentVault();
      vault.addEnvironment('dev');
      vault.addVersion(
        'dev',
        { KEY: 'val', SECRET: 'sensitive' },
        { required: ['KEY'], nonSensitive: ['KEY'] }
      );
      const v = vault.getActiveVersion('dev');
      expect(v.required).toEqual(['KEY']);
      expect(v.nonSensitive).toEqual(['KEY']);
    });

    it('should throw if environment does not exist', () => {
      const vault = new EnvironmentVault();
      expect(() => vault.addVersion('missing', { KEY: 'val' })).toThrow(
        "Environment 'missing' not found"
      );
    });
  });

  describe('getVersion / getActiveVersion / setActiveVersion', () => {
    it('should get a specific version', () => {
      const vault = createSampleVault();
      const v = vault.getVersion('staging', 1);
      expect(v.n).toBe(1);
      expect(v.vars.API_KEY).toBe('sk-test');
    });

    it('should return null for getActiveVersion when no versions exist', () => {
      const vault = new EnvironmentVault();
      vault.addEnvironment('empty');
      expect(vault.getActiveVersion('empty')).toBeNull();
    });

    it('should set active version', () => {
      const vault = createSampleVault();
      vault.setActiveVersion('staging', 1);
      expect(vault.getActiveVersion('staging').n).toBe(1);
    });

    it('should throw for non-existent version', () => {
      const vault = createSampleVault();
      expect(() => vault.setActiveVersion('staging', 99)).toThrow(
        'Version 99 not found'
      );
    });

    it('should return a copy of the version', () => {
      const vault = createSampleVault();
      const v = vault.getVersion('staging', 1);
      v.vars.API_KEY = 'hacked';
      const v2 = vault.getVersion('staging', 1);
      expect(v2.vars.API_KEY).toBe('sk-test');
    });
  });

  describe('getHistory', () => {
    it('should return metadata for all versions', () => {
      const vault = createSampleVault();
      const history = vault.getHistory('staging');
      expect(history).toHaveLength(2);
      expect(history[0]).toEqual({
        n: 1,
        created: expect.any(String),
        message: null,
        keyCount: 2,
        isActive: false,
      });
      expect(history[1].isActive).toBe(true);
    });
  });

  describe('rollback', () => {
    it('should create a new version with the target version vars', () => {
      const vault = createSampleVault();
      const rolled = vault.rollback('staging', 1);
      expect(rolled.n).toBe(3);
      expect(rolled.vars.API_URL).toBe('https://staging.example.com');
      expect(rolled.vars.API_KEY).toBe('sk-test');
      expect(rolled.message).toBe('Rollback to version 1');
    });

    it('should preserve required and nonSensitive from target', () => {
      const vault = createSampleVault();
      const rolled = vault.rollback('staging', 1);
      expect(rolled.required).toEqual(['API_URL']);
      expect(rolled.nonSensitive).toEqual(['API_URL']);
    });
  });

  describe('squash', () => {
    it('should squash all versions into one with keep=1 (default)', () => {
      const vault = createSampleVault();
      expect(vault.getHistory('staging')).toHaveLength(2);
      vault.squash('staging');
      const history = vault.getHistory('staging');
      expect(history).toHaveLength(1);
      expect(history[0].n).toBe(1);
      expect(history[0].isActive).toBe(true);
      expect(vault.getActiveVersion('staging').vars.API_URL).toBe(
        'https://staging.example.com/v2'
      );
    });

    it('should keep last N versions with keep=N', () => {
      const vault = createSampleVault();
      vault.addVersion('staging', { KEY: 'c' });
      vault.addVersion('staging', { KEY: 'd' });
      vault.addVersion('staging', { KEY: 'e' });
      expect(vault.getHistory('staging')).toHaveLength(5);
      vault.squash('staging', { keep: 2 });
      const history = vault.getHistory('staging');
      expect(history).toHaveLength(2);
      expect(history[0].n).toBe(1);
      expect(history[0].keyCount).toBe(1);
      expect(history[1].n).toBe(2);
      expect(history[1].keyCount).toBe(1);
    });

    it('should do nothing when already within keep limit', () => {
      const vault = createSampleVault();
      vault.squash('staging', { keep: 5 });
      expect(vault.getHistory('staging')).toHaveLength(2);
    });

    it('should rename squashed versions sequentially', () => {
      const vault = createSampleVault();
      vault.squash('staging', { keep: 1 });
      const v = vault.getActiveVersion('staging');
      expect(v.n).toBe(1);
    });
  });

  describe('isSensitive', () => {
    it('should return false for nonSensitive keys', () => {
      const vault = createSampleVault();
      vault.setActiveVersion('staging', 1);
      expect(vault.isSensitive('staging', 'API_URL')).toBe(false);
    });

    it('should return true for sensitive keys', () => {
      const vault = createSampleVault();
      vault.setActiveVersion('staging', 1);
      expect(vault.isSensitive('staging', 'API_KEY')).toBe(true);
    });

    it('should return true when no active version exists', () => {
      const vault = new EnvironmentVault();
      vault.addEnvironment('empty');
      expect(vault.isSensitive('empty', 'ANY')).toBe(true);
    });
  });

  describe('parseEnvFile', () => {
    it('should parse simple KEY=value pairs', () => {
      const result = EnvironmentVault.parseEnvFile(
        'API_URL=https://example.com\nAPI_KEY=sk-123'
      );
      expect(result).toEqual({
        API_URL: 'https://example.com',
        API_KEY: 'sk-123',
      });
    });

    it('should skip comments and blank lines', () => {
      const result = EnvironmentVault.parseEnvFile(
        '# This is a comment\n\nAPI_URL=https://example.com\n'
      );
      expect(result).toEqual({ API_URL: 'https://example.com' });
    });

    it('should handle export prefix', () => {
      const result = EnvironmentVault.parseEnvFile(
        'export API_URL=https://example.com'
      );
      expect(result).toEqual({ API_URL: 'https://example.com' });
    });

    it('should strip quotes from values', () => {
      const result = EnvironmentVault.parseEnvFile(
        'KEY="quoted value"\nKEY2=\'single quoted\''
      );
      expect(result).toEqual({
        KEY: 'quoted value',
        KEY2: 'single quoted',
      });
    });

    it('should handle values with equals signs', () => {
      const result = EnvironmentVault.parseEnvFile(
        'DB_URL=postgres://user:pass@host:5432/db?ssl=true'
      );
      expect(result).toEqual({
        DB_URL: 'postgres://user:pass@host:5432/db?ssl=true',
      });
    });

    it('should skip lines without = sign', () => {
      const result = EnvironmentVault.parseEnvFile('JUST_A_COMMENT\nKEY=val');
      expect(result).toEqual({ KEY: 'val' });
    });

    it('decodes escapes inside double-quoted values', () => {
      const result = EnvironmentVault.parseEnvFile(
        'K="line1\\nline2#x"\nQ="has \\"quote\\""'
      );
      expect(result).toEqual({
        K: 'line1\nline2#x',
        Q: 'has "quote"',
      });
    });

    it('preserves edge whitespace in double-quoted values', () => {
      const result = EnvironmentVault.parseEnvFile('K=" padded "');
      expect(result).toEqual({ K: ' padded ' });
    });

    it('treats single-quoted values as literal (no escape decoding)', () => {
      const result = EnvironmentVault.parseEnvFile("K='a\\nb'");
      expect(result).toEqual({ K: 'a\\nb' });
    });
  });

  describe('importFromEnvFile', () => {
    it('should create environment and add version from .env content', () => {
      const vault = new EnvironmentVault();
      const version = vault.importFromEnvFile(
        'dev',
        'API_URL=http://localhost\nPORT=3000'
      );
      expect(version.n).toBe(1);
      expect(vault.listEnvironmentNames()).toEqual(['dev']);
      expect(vault.getActiveVersion('dev').vars).toEqual({
        API_URL: 'http://localhost',
        PORT: '3000',
      });
    });

    it('should add version to existing environment', () => {
      const vault = createSampleVault();
      vault.importFromEnvFile('staging', 'NEW_KEY=new_val');
      expect(vault.getHistory('staging')).toHaveLength(3);
      expect(vault.getActiveVersion('staging').vars.NEW_KEY).toBe('new_val');
    });
  });
});
