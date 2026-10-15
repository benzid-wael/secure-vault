// Test-only: lower the PBKDF2 work factor so the suite isn't dominated by
// key derivation (~250 ms per derivation at the production 600k).
//
// Loaded two ways, both test-only:
//   - as a vitest setup file, for code running in the test process;
//   - via NODE_OPTIONS=--import (vite.config.js `test.env`), for the CLI
//     processes the integration tests spawn, which inherit process.env.
// Production code has no setting for this: a normal `vault` run never
// imports this file.
//
// Both counts move together and keep their order (legacy < current), so the
// legacy -> current upgrade path is still exercised. The production values
// are kept in PRODUCTION_KDF and asserted by a test.
import { CryptographyService } from '../../electron/services/CryptographyService.js';

const KEY = Symbol.for('secure-vault.test.productionKdf');

// Captured once, before patching, even if this module is evaluated again.
if (!globalThis[KEY]) {
  globalThis[KEY] = Object.freeze({
    ITERATIONS: CryptographyService.ITERATIONS,
    LEGACY_ITERATIONS: CryptographyService.LEGACY_ITERATIONS,
  });
}

/** The work factors production code ships with. */
export const PRODUCTION_KDF = globalThis[KEY];

CryptographyService.LEGACY_ITERATIONS = 1000;
CryptographyService.ITERATIONS = 2000;
