// @vitest-environment node
import fs from 'fs-extra';
import os from 'os';
import path from 'path';

import { EnvironmentVaultService } from '../../../electron/services/EnvironmentVaultService.js';
import { EnvironmentVault } from '../../../electron/models/EnvironmentVault.js';

vi.mock('fs-extra');
vi.mock('os');

const fsMock = vi.mocked(fs);
const osMock = vi.mocked(os);

function createPopulatedVault(envName, vars, opts = {}) {
  const vault = new EnvironmentVault();
  if (vars) {
    vault.addEnvironment(envName);
    vault.addVersion(envName, vars, opts);
  }
  return vault;
}

function makeFreshVaultFile(vault) {
  return JSON.parse(JSON.stringify(vault.toJSON()));
}

describe('EnvironmentVaultService', () => {
  const testPassword = 'TestVault123!@#';
  const weakPassword = 'short';
  const testVaultPath = '/mock/envs/test.env.vault';
  const testEnvName = 'staging';

  beforeEach(() => {
    vi.clearAllMocks();
    osMock.homedir.mockReturnValue('/Users/testuser');

    fsMock.pathExists.mockResolvedValue(false);
    fsMock.readFile.mockReset();
    fsMock.readJSON.mockReset();
    fsMock.writeJSON.mockReset();
    fsMock.ensureDir.mockResolvedValue(undefined);
    fsMock.existsSync.mockReturnValue(false);
  });

  describe('getAppDataPath', () => {
    it('should return macOS path', () => {
      Object.defineProperty(process, 'platform', {
        value: 'darwin',
        configurable: true,
      });
      expect(EnvironmentVaultService.getAppDataPath()).toBe(
        '/Users/testuser/Library/Application Support/secure-password-manager'
      );
    });

    it('should return Windows path', () => {
      Object.defineProperty(process, 'platform', {
        value: 'win32',
        configurable: true,
      });
      process.env.APPDATA = 'C:\\Users\\testuser\\AppData\\Roaming';
      expect(EnvironmentVaultService.getAppDataPath()).toBe(
        'C:\\Users\\testuser\\AppData\\Roaming\\secure-password-manager'
      );
    });

    it('should return Linux path', () => {
      Object.defineProperty(process, 'platform', {
        value: 'linux',
        configurable: true,
      });
      expect(EnvironmentVaultService.getAppDataPath()).toBe(
        '/Users/testuser/.secure-password-manager'
      );
    });
  });

  describe('resolveVaultPath', () => {
    let cwdSpy;

    afterEach(() => {
      if (cwdSpy) {
        cwdSpy.mockRestore();
        cwdSpy = undefined;
      }
    });

    // Fixture paths are POSIX-style; resolved, they're absolute on Windows
    // too (with the current drive), as the code under test builds them.
    const P = (p) => path.resolve(p);

    // Drive fs.existsSync from a set of paths that "exist".
    function existsForPaths(...existing) {
      const set = new Set(existing.map(P));
      fsMock.existsSync.mockImplementation((p) => set.has(P(p)));
    }

    it('uses path.resolve when an explicit vault flag is given', () => {
      const result = EnvironmentVaultService.resolveVaultPath({
        vault: './custom/.env.vault',
      });
      expect(result).toBe(path.resolve('./custom/.env.vault'));
    });

    it('uses the app-data env path when a name is given', () => {
      const result = EnvironmentVaultService.resolveVaultPath({
        name: 'myproj',
      });
      expect(result).toContain('myproj.env.vault');
    });

    it('finds .env.vault in a parent directory up to the git root', () => {
      cwdSpy = vi
        .spyOn(process, 'cwd')
        .mockReturnValue(P('/repo/packages/api/src'));
      // .git lives at the repo root; the vault sits two levels up from cwd.
      existsForPaths('/repo/.git', '/repo/packages/.env.vault');

      const result = EnvironmentVaultService.resolveVaultPath({});
      expect(result).toBe(P('/repo/packages/.env.vault'));
    });

    it('finds .env.vault directly in cwd before walking up', () => {
      cwdSpy = vi.spyOn(process, 'cwd').mockReturnValue(P('/repo/app'));
      existsForPaths('/repo/.git', '/repo/app/.env.vault', '/repo/.env.vault');

      const result = EnvironmentVaultService.resolveVaultPath({});
      expect(result).toBe(P('/repo/app/.env.vault'));
    });

    it('finds .env.vault at the git root itself', () => {
      cwdSpy = vi.spyOn(process, 'cwd').mockReturnValue(P('/repo/app'));
      existsForPaths('/repo/.git', '/repo/.env.vault');

      const result = EnvironmentVaultService.resolveVaultPath({});
      expect(result).toBe(P('/repo/.env.vault'));
    });

    it('does NOT ascend above the git root', () => {
      cwdSpy = vi.spyOn(process, 'cwd').mockReturnValue(P('/repo/app'));
      // Vault exists ABOVE the git root and must be ignored.
      existsForPaths('/repo/.git', '/.env.vault');

      const result = EnvironmentVaultService.resolveVaultPath({});
      expect(result).toBeNull();
    });

    it('only checks cwd when no .git exists anywhere up the chain', () => {
      cwdSpy = vi.spyOn(process, 'cwd').mockReturnValue(P('/no-git/app'));
      // A vault exists in a parent, but with no git root we must not walk up.
      existsForPaths('/no-git/.env.vault');

      const result = EnvironmentVaultService.resolveVaultPath({});
      expect(result).toBeNull();
    });

    it('finds .env.vault in cwd when no .git exists', () => {
      cwdSpy = vi.spyOn(process, 'cwd').mockReturnValue(P('/no-git/app'));
      existsForPaths('/no-git/app/.env.vault');

      const result = EnvironmentVaultService.resolveVaultPath({});
      expect(result).toBe(P('/no-git/app/.env.vault'));
    });

    // New-22: the app resolves a folder the user picked, not its own cwd.
    it('resolves from a given folder instead of the process cwd', () => {
      cwdSpy = vi.spyOn(process, 'cwd').mockReturnValue(P('/elsewhere'));
      existsForPaths('/repo/.git', '/repo/.env.vault');
      expect(
        EnvironmentVaultService.resolveVaultPath({ cwd: P('/repo/svc/api') })
      ).toBe(P('/repo/.env.vault'));

      existsForPaths('/proj/config/.env.vault');
      expect(
        EnvironmentVaultService.resolveVaultPath({ cwd: P('/proj') })
      ).toBe('/proj/config/.env.vault');
      expect(
        EnvironmentVaultService.resolveVaultPath({
          vault: 'x/.env.vault',
          cwd: P('/proj'),
        })
      ).toBe(P('/proj/x/.env.vault'));
    });

    it('looks for the folder-named vault in a given envs dir', () => {
      existsForPaths('/data/envs/my_app.env.vault');
      expect(
        EnvironmentVaultService.resolveVaultPath({
          cwd: P('/work/My App'),
          envsDir: P('/data/envs'),
        })
      ).toBe(P('/data/envs/my_app.env.vault'));
      expect(
        EnvironmentVaultService.defaultVaultPath(
          P('/work/My App'),
          P('/data/envs')
        )
      ).toBe(P('/data/envs/my_app.env.vault'));
    });

    it('falls back to config/.env.vault when no walk-up match', () => {
      cwdSpy = vi.spyOn(process, 'cwd').mockReturnValue(P('/repo/app'));
      const configVault = path.resolve('config', '.env.vault');
      existsForPaths('/repo/.git', configVault);

      const result = EnvironmentVaultService.resolveVaultPath({});
      expect(result).toBe(configVault);
    });

    it('falls back to the app-data path when it exists', () => {
      cwdSpy = vi.spyOn(process, 'cwd').mockReturnValue(P('/repo/app'));
      const appDataVault = EnvironmentVaultService.getEnvVaultPath('app');
      existsForPaths('/repo/.git', appDataVault);

      const result = EnvironmentVaultService.resolveVaultPath({});
      expect(result).toBe(appDataVault);
    });

    it('returns null when nothing is found', () => {
      cwdSpy = vi.spyOn(process, 'cwd').mockReturnValue(P('/repo/app'));
      existsForPaths('/repo/.git');

      const result = EnvironmentVaultService.resolveVaultPath({});
      expect(result).toBeNull();
    });
  });

  describe('createVault', () => {
    it('should create a new vault successfully', async () => {
      const result = await EnvironmentVaultService.createVault(
        testVaultPath,
        testPassword
      );

      expect(result.success).toBe(true);
      expect(result.path).toBe(testVaultPath);
      expect(fsMock.ensureDir).toHaveBeenCalledWith(
        path.dirname(testVaultPath)
      );
      expect(fsMock.writeJSON).toHaveBeenCalledTimes(1);

      const writeArgs = fsMock.writeJSON.mock.calls[0];
      expect(writeArgs[0]).toBe(testVaultPath);
      expect(writeArgs[1].type).toBe('environment-vault');
      expect(writeArgs[1].version).toBe(1);
      expect(writeArgs[1].salt).toBeDefined();
      expect(writeArgs[1].iv).toBeDefined();
      expect(writeArgs[1].authTag).toBeDefined();
      expect(writeArgs[1].encrypted).toBeDefined();
    });

    it('should reject weak password', async () => {
      const result = await EnvironmentVaultService.createVault(
        testVaultPath,
        weakPassword
      );

      expect(result.success).toBe(false);
      expect(result.error).toBe('Password must be at least 8 characters long');
      expect(fsMock.writeJSON).not.toHaveBeenCalled();
    });

    it('should reject existing vault path', async () => {
      fsMock.pathExists.mockResolvedValue(true);

      const result = await EnvironmentVaultService.createVault(
        testVaultPath,
        testPassword
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain('already exists');
      expect(fsMock.writeJSON).not.toHaveBeenCalled();
    });

    it('should create vault with custom data', async () => {
      const vault = createPopulatedVault(testEnvName, {
        DB_HOST: 'localhost',
        DB_PORT: '5432',
      });
      const result = await EnvironmentVaultService.createVault(
        testVaultPath,
        testPassword,
        vault.toJSON()
      );

      expect(result.success).toBe(true);
    });

    it('should handle write errors', async () => {
      fsMock.writeJSON.mockRejectedValue(new Error('Disk full'));

      const result = await EnvironmentVaultService.createVault(
        testVaultPath,
        testPassword
      );

      expect(result.success).toBe(false);
      expect(result.error).toBe('Disk full');
    });
  });

  describe('loadVault', () => {
    async function createAndGetFile() {
      const vault = createPopulatedVault(testEnvName, { KEY: 'value' });
      await EnvironmentVaultService.createVault(
        testVaultPath,
        testPassword,
        vault.toJSON()
      );
      return fsMock.writeJSON.mock.calls[0][1];
    }

    it('should load and decrypt vault successfully', async () => {
      const writtenFile = await createAndGetFile();
      fsMock.pathExists.mockResolvedValue(true);
      fsMock.readJSON.mockResolvedValue(writtenFile);

      const result = await EnvironmentVaultService.loadVault(
        testVaultPath,
        testPassword
      );

      expect(result.success).toBe(true);
      expect(result.data).toBeInstanceOf(EnvironmentVault);
      expect(result.data.listEnvironmentNames()).toEqual([testEnvName]);
    });

    it('should return error for non-existent vault', async () => {
      fsMock.pathExists.mockResolvedValue(false);

      const result = await EnvironmentVaultService.loadVault(
        testVaultPath,
        testPassword
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain('not found');
    });

    it('should return error for wrong password', async () => {
      const writtenFile = await createAndGetFile();
      fsMock.pathExists.mockResolvedValue(true);
      fsMock.readJSON.mockResolvedValue(writtenFile);

      const result = await EnvironmentVaultService.loadVault(
        testVaultPath,
        'WrongPass123!@#'
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain('wrong password');
    });

    it('should reject invalid vault type', async () => {
      fsMock.pathExists.mockResolvedValue(true);
      fsMock.readJSON.mockResolvedValue({ type: 'not-environment-vault' });

      const result = await EnvironmentVaultService.loadVault(
        testVaultPath,
        testPassword
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain('Invalid environment vault');
    });
  });

  describe('reserved environment names', () => {
    it('rejects creating an environment named "self"', () => {
      const vault = new EnvironmentVault();
      expect(() => vault.addEnvironment('self')).toThrow(/reserved/i);
    });

    it('rejects "self" case-insensitively', () => {
      const vault = new EnvironmentVault();
      expect(() => vault.addEnvironment('SELF')).toThrow(/reserved/i);
    });

    it('rejects renaming an environment to "self"', () => {
      const vault = new EnvironmentVault();
      vault.addEnvironment('dev');
      vault.addVersion('dev', { A: '1' });
      expect(() => vault.renameEnvironment('dev', 'self')).toThrow(/reserved/i);
    });
  });

  describe('init', () => {
    it('should initialize empty vault when no environments provided', async () => {
      const result = await EnvironmentVaultService.init({
        name: 'test',
        password: testPassword,
      });

      expect(result.success).toBe(true);
      expect(result.path).toContain('test.env.vault');
    });

    it('should import environments from files', async () => {
      fsMock.readFile.mockResolvedValue('DB_HOST=localhost\nDB_PORT=5432');

      const result = await EnvironmentVaultService.init({
        name: 'test',
        password: testPassword,
        environments: { [testEnvName]: '/path/to/.env.staging' },
      });

      expect(result.success).toBe(true);
      expect(fsMock.readFile).toHaveBeenCalledWith(
        '/path/to/.env.staging',
        'utf-8'
      );
    });

    it('should require password', async () => {
      const result = await EnvironmentVaultService.init({ name: 'test' });

      expect(result.success).toBe(false);
      expect(result.error).toBe('Password is required');
    });

    it('should handle import errors', async () => {
      fsMock.readFile.mockRejectedValue(new Error('File not found'));

      const result = await EnvironmentVaultService.init({
        name: 'test',
        password: testPassword,
        environments: { [testEnvName]: '/nonexistent/.env.staging' },
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('Failed to import');
    });
  });

  describe('getEnv', () => {
    async function setup() {
      const vault = createPopulatedVault(testEnvName, { DB_HOST: 'localhost' });
      await EnvironmentVaultService.createVault(
        testVaultPath,
        testPassword,
        vault.toJSON()
      );
      const file = fsMock.writeJSON.mock.calls[0][1];
      fsMock.pathExists.mockResolvedValue(true);
      fsMock.readJSON.mockResolvedValue(file);
    }

    it('should get a specific key', async () => {
      await setup();

      const result = await EnvironmentVaultService.getEnv(
        testVaultPath,
        testPassword,
        testEnvName,
        'DB_HOST'
      );

      expect(result.success).toBe(true);
      expect(result.data).toEqual({ key: 'DB_HOST', value: 'localhost' });
    });

    it('should return error for missing key', async () => {
      await setup();

      const result = await EnvironmentVaultService.getEnv(
        testVaultPath,
        testPassword,
        testEnvName,
        'MISSING'
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain('not found');
    });
  });

  describe('showEnv', () => {
    it('should show environment details', async () => {
      const vault = createPopulatedVault(
        testEnvName,
        { DB_HOST: 'localhost', DB_PORT: '5432' },
        {
          nonSensitive: ['DB_PORT'],
        }
      );
      await EnvironmentVaultService.createVault(
        testVaultPath,
        testPassword,
        vault.toJSON()
      );

      const writtenFile = fsMock.writeJSON.mock.calls[0][1];
      fsMock.pathExists.mockResolvedValue(true);
      fsMock.readJSON.mockResolvedValue(writtenFile);

      const result = await EnvironmentVaultService.showEnv(
        testVaultPath,
        testPassword,
        testEnvName
      );

      expect(result.success).toBe(true);
      expect(result.data.name).toBe(testEnvName);
      expect(result.data.keyCount).toBe(2);
      expect(result.data.keys).toEqual(
        expect.arrayContaining([
          { key: 'DB_HOST', value: 'localhost', sensitive: true },
          { key: 'DB_PORT', value: '5432', sensitive: false },
        ])
      );
    });
  });

  describe('listEnvs', () => {
    it('should list all environments', async () => {
      const vault = new EnvironmentVault();
      vault.addEnvironment('staging');
      vault.addVersion('staging', { HOST: 'staging.example.com' });
      vault.addEnvironment('production');
      vault.addVersion('production', { HOST: 'prod.example.com' });
      await EnvironmentVaultService.createVault(
        testVaultPath,
        testPassword,
        vault.toJSON()
      );

      const writtenFile = fsMock.writeJSON.mock.calls[0][1];
      fsMock.pathExists.mockResolvedValue(true);
      fsMock.readJSON.mockResolvedValue(writtenFile);

      const result = await EnvironmentVaultService.listEnvs(
        testVaultPath,
        testPassword
      );

      expect(result.success).toBe(true);
      expect(result.data).toHaveLength(2);
      expect(result.data.map((e) => e.name).sort()).toEqual([
        'production',
        'staging',
      ]);
    });
  });

  describe('exportEnv', () => {
    async function setup() {
      const vault = createPopulatedVault(testEnvName, { A: '1', B: '2' });
      await EnvironmentVaultService.createVault(
        testVaultPath,
        testPassword,
        vault.toJSON()
      );
      const file = fsMock.writeJSON.mock.calls[0][1];
      fsMock.pathExists.mockResolvedValue(true);
      fsMock.readJSON.mockResolvedValue(file);
    }

    it('should export as dotenv format', async () => {
      await setup();

      const result = await EnvironmentVaultService.exportEnv(
        testVaultPath,
        testPassword,
        testEnvName
      );

      expect(result.success).toBe(true);
      expect(result.data).toBe('A=1\nB=2\n');
    });

    it('should export as JSON format', async () => {
      await setup();

      const result = await EnvironmentVaultService.exportEnv(
        testVaultPath,
        testPassword,
        testEnvName,
        'json'
      );

      expect(result.success).toBe(true);
      expect(result.data).toEqual({ A: '1', B: '2' });
    });

    it('should quote/escape special values in dotenv format', async () => {
      const vault = createPopulatedVault(testEnvName, {
        M: 'line1\nline2#x',
        P: ' pad ',
      });
      await EnvironmentVaultService.createVault(
        testVaultPath,
        testPassword,
        vault.toJSON()
      );
      const file = fsMock.writeJSON.mock.calls[0][1];
      fsMock.pathExists.mockResolvedValue(true);
      fsMock.readJSON.mockResolvedValue(file);

      const result = await EnvironmentVaultService.exportEnv(
        testVaultPath,
        testPassword,
        testEnvName
      );

      expect(result.success).toBe(true);
      expect(result.data).toBe('M="line1\\nline2#x"\nP=" pad "\n');
    });
  });

  describe('templateEnv', () => {
    it('should generate template with required markers', async () => {
      const vault = createPopulatedVault(
        testEnvName,
        { DB_HOST: 'localhost', DB_PASS: 'secret' },
        {
          required: ['DB_HOST'],
        }
      );
      await EnvironmentVaultService.createVault(
        testVaultPath,
        testPassword,
        vault.toJSON()
      );

      const writtenFile = fsMock.writeJSON.mock.calls[0][1];
      fsMock.pathExists.mockResolvedValue(true);
      fsMock.readJSON.mockResolvedValue(writtenFile);

      const result = await EnvironmentVaultService.templateEnv(
        testVaultPath,
        testPassword,
        testEnvName
      );

      expect(result.success).toBe(true);
      expect(result.data).toContain('DB_HOST=<required>');
      expect(result.data).toContain('DB_PASS=');
    });
  });

  describe('getHistory', () => {
    it('should return version history', async () => {
      const vault = new EnvironmentVault();
      vault.addEnvironment(testEnvName);
      vault.addVersion(testEnvName, { KEY: 'v1' }, { message: 'First' });
      vault.addVersion(testEnvName, { KEY: 'v2' }, { message: 'Second' });
      await EnvironmentVaultService.createVault(
        testVaultPath,
        testPassword,
        vault.toJSON()
      );

      const writtenFile = fsMock.writeJSON.mock.calls[0][1];
      fsMock.pathExists.mockResolvedValue(true);
      fsMock.readJSON.mockResolvedValue(writtenFile);

      const result = await EnvironmentVaultService.getHistory(
        testVaultPath,
        testPassword,
        testEnvName
      );

      expect(result.success).toBe(true);
      expect(result.data).toHaveLength(2);
    });
  });

  describe('diffEnvs', () => {
    it('should diff two environments', async () => {
      const vault = new EnvironmentVault();
      vault.addEnvironment('staging');
      vault.addVersion('staging', { A: '1', B: '2', C: '3' });
      vault.addEnvironment('prod');
      vault.addVersion('prod', { A: '1', B: '22', D: '4' });
      await EnvironmentVaultService.createVault(
        testVaultPath,
        testPassword,
        vault.toJSON()
      );

      const writtenFile = fsMock.writeJSON.mock.calls[0][1];
      fsMock.pathExists.mockResolvedValue(true);
      fsMock.readJSON.mockResolvedValue(writtenFile);

      const result = await EnvironmentVaultService.diffEnvs(
        testVaultPath,
        testPassword,
        'staging',
        'prod'
      );

      expect(result.success).toBe(true);
      expect(result.data.added).toEqual(['D']);
      expect(result.data.removed).toEqual(['C']);
      expect(result.data.changed).toEqual(['B']);
      expect(result.data.unchanged).toEqual(['A']);
    });
  });

  describe('validateEnv', () => {
    async function seed(vault) {
      await EnvironmentVaultService.createVault(
        testVaultPath,
        testPassword,
        vault.toJSON()
      );
      const written = fsMock.writeJSON.mock.calls[0][1];
      fsMock.pathExists.mockResolvedValue(true);
      fsMock.readJSON.mockResolvedValue(written);
    }

    it('passes when all required keys are present', async () => {
      await seed(
        createPopulatedVault(
          testEnvName,
          { API_URL: 'x', TOKEN: 'y' },
          { required: ['API_URL'] }
        )
      );

      const result = await EnvironmentVaultService.validateEnv(
        testVaultPath,
        testPassword,
        testEnvName
      );

      expect(result.success).toBe(true);
      expect(result.data.errors).toEqual([]);
      expect(result.data.requiredCount).toBe(1);
      expect(result.data.varCount).toBe(2);
    });

    it('reports an error for a missing required key', async () => {
      await seed(
        createPopulatedVault(
          testEnvName,
          { API_URL: 'x' },
          { required: ['API_URL', 'DB_URL'] }
        )
      );

      const result = await EnvironmentVaultService.validateEnv(
        testVaultPath,
        testPassword,
        testEnvName
      );

      expect(result.data.errors).toContain('Missing required key: DB_URL');
    });

    it('reports an error for an empty required key', async () => {
      await seed(
        createPopulatedVault(
          testEnvName,
          { API_URL: '' },
          { required: ['API_URL'] }
        )
      );

      const result = await EnvironmentVaultService.validateEnv(
        testVaultPath,
        testPassword,
        testEnvName
      );

      expect(result.data.errors).toContain('Required key is empty: API_URL');
    });

    it('warns on non-UPPER_CASE key names without erroring', async () => {
      await seed(createPopulatedVault(testEnvName, { 'my-key': 'v' }));

      const result = await EnvironmentVaultService.validateEnv(
        testVaultPath,
        testPassword,
        testEnvName
      );

      expect(result.data.errors).toEqual([]);
      expect(result.data.warnings.some((w) => w.includes('my-key'))).toBe(true);
    });

    it('fails for a non-existent environment', async () => {
      await seed(createPopulatedVault(testEnvName, { A: '1' }));

      const result = await EnvironmentVaultService.validateEnv(
        testVaultPath,
        testPassword,
        'nope'
      );

      expect(result.success).toBe(false);
    });

    it('aggregates required keys across the extends chain', async () => {
      const vault = new EnvironmentVault();
      vault.addEnvironment('base');
      vault.addVersion('base', { PORT: '3000' }, { required: ['PORT'] });
      vault.addEnvironment('dev');
      vault.addVersion('dev', { API_URL: 'x' }, { required: ['API_URL'] });
      vault.setExtends('dev', 'base');
      await seed(vault);

      const result = await EnvironmentVaultService.validateEnv(
        testVaultPath,
        testPassword,
        'dev'
      );

      expect(result.success).toBe(true);
      expect(result.data.requiredCount).toBe(2); // PORT (base) + API_URL (dev)
      expect(result.data.errors).toEqual([]); // both present after layering
    });

    it('errors when an inherited required key is missing', async () => {
      const vault = new EnvironmentVault();
      vault.addEnvironment('base');
      vault.addVersion('base', { LOG: 'info' }, { required: ['DB_URL'] });
      vault.addEnvironment('dev');
      vault.addVersion('dev', { API_URL: 'x' });
      vault.setExtends('dev', 'base');
      await seed(vault);

      const result = await EnvironmentVaultService.validateEnv(
        testVaultPath,
        testPassword,
        'dev'
      );

      expect(result.data.errors).toContain('Missing required key: DB_URL');
    });

    it('reports an unresolved template reference as an error', async () => {
      await seed(createPopulatedVault(testEnvName, { X: '{{env:ghost/Y}}' }));

      const result = await EnvironmentVaultService.validateEnv(
        testVaultPath,
        testPassword,
        testEnvName
      );

      expect(result.success).toBe(true);
      expect(result.data.errors.some((e) => /not found/i.test(e))).toBe(true);
    });

    it('warns on a secret-looking value in a non-required key', async () => {
      await seed(
        createPopulatedVault(testEnvName, {
          TOKEN: 'sk_live_abcdef0123456789',
        })
      );

      const result = await EnvironmentVaultService.validateEnv(
        testVaultPath,
        testPassword,
        testEnvName
      );

      expect(
        result.data.warnings.some((w) => /secret|private key|token/i.test(w))
      ).toBe(true);
    });
  });
});
