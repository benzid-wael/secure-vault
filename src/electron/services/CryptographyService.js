import crypto from 'crypto';

export class CryptographyService {
  // PBKDF2-HMAC-SHA512 work factor for every key derived from now on (OWASP
  // 2023+: >= 210k for SHA-512; 600k leaves headroom). Each encrypted record
  // stores the count it was written with in `kdf`, so the default can rise
  // again without breaking existing files.
  static KDF_NAME = 'pbkdf2-sha512';
  static ITERATIONS = 600000;
  // Records written before `kdf` existed used this count.
  static LEGACY_ITERATIONS = 100000;
  // A tampered file must not be able to stall the app with a huge count.
  static MAX_ITERATIONS = 10000000;
  static KEY_LENGTH = 32;
  static IV_LENGTH = 16;
  static ALGORITHM = 'aes-256-gcm';
  static HASH_ALGORITHM = 'sha512';

  static generateSalt(length = 32) {
    return crypto.randomBytes(length);
  }

  /** The `kdf` header to store next to a salt for a key derived now. */
  static kdfHeader() {
    return { name: this.KDF_NAME, iterations: this.ITERATIONS };
  }

  /**
   * The iteration count a record (vault file or recovery metadata) was
   * written with: its `kdf.iterations`, or the legacy count when absent.
   */
  static iterationsOf(record) {
    const kdf = record?.kdf;
    if (kdf === undefined || kdf === null) return this.LEGACY_ITERATIONS;
    const n = kdf.iterations;
    if (
      kdf.name !== this.KDF_NAME ||
      !Number.isInteger(n) ||
      n < this.LEGACY_ITERATIONS ||
      n > this.MAX_ITERATIONS
    ) {
      throw new Error('Unsupported key derivation parameters');
    }
    return n;
  }

  /** True when `record` was keyed with fewer iterations than the default. */
  static needsKdfUpgrade(record) {
    return this.iterationsOf(record) < this.ITERATIONS;
  }

  /**
   * The key-derivation fields to carry over when re-encrypting with an
   * existing salt: the salt and, when present, its `kdf` header.
   */
  static keyHeaderOf(record) {
    return record.kdf
      ? { salt: record.salt, kdf: record.kdf }
      : { salt: record.salt };
  }

  /** Derive the key for an existing record, honouring its stored `kdf`. */
  static deriveKeyFor(password, record) {
    return this.deriveKey(
      password,
      Buffer.from(record.salt, 'hex'),
      this.iterationsOf(record)
    );
  }

  /**
   * `iterations` is required: defaulting it would silently read a legacy
   * record with the new count (or the reverse) and fail to decrypt.
   */
  static deriveKey(password, salt, iterations) {
    if (!Number.isInteger(iterations)) {
      throw new Error('deriveKey: iterations is required');
    }
    return crypto.pbkdf2Sync(
      password,
      salt,
      iterations,
      this.KEY_LENGTH,
      this.HASH_ALGORITHM
    );
  }

  /**
   * `deriveKey`, but PBKDF2 runs on libuv's thread pool instead of blocking
   * the event loop: the Electron main process stays responsive and timers
   * (a lock heartbeat) keep firing. Same inputs give the same key.
   */
  static deriveKeyAsync(password, salt, iterations) {
    if (!Number.isInteger(iterations)) {
      return Promise.reject(
        new Error('deriveKeyAsync: iterations is required')
      );
    }
    return new Promise((resolve, reject) => {
      crypto.pbkdf2(
        password,
        salt,
        iterations,
        this.KEY_LENGTH,
        this.HASH_ALGORITHM,
        (error, key) => (error ? reject(error) : resolve(key))
      );
    });
  }

  /** `deriveKeyFor`, asynchronously (see `deriveKeyAsync`). */
  static async deriveKeyForAsync(password, record) {
    return this.deriveKeyAsync(
      password,
      Buffer.from(record.salt, 'hex'),
      this.iterationsOf(record)
    );
  }

  static encrypt(data, key) {
    const iv = crypto.randomBytes(this.IV_LENGTH);
    const cipher = crypto.createCipheriv(this.ALGORITHM, key, iv);

    let encrypted = cipher.update(JSON.stringify(data), 'utf8', 'hex');
    encrypted += cipher.final('hex');

    const authTag = cipher.getAuthTag();

    return {
      encrypted,
      authTag: authTag.toString('hex'),
      iv: iv.toString('hex'),
    };
  }

  static decrypt(encryptedData, key) {
    const iv = Buffer.from(encryptedData.iv, 'hex');
    const decipher = crypto.createDecipheriv(this.ALGORITHM, key, iv);
    decipher.setAuthTag(Buffer.from(encryptedData.authTag, 'hex'));

    let decrypted = decipher.update(encryptedData.encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');

    return JSON.parse(decrypted);
  }

  static hashPassword(password) {
    return crypto.createHash('sha256').update(password).digest('hex');
  }
}
