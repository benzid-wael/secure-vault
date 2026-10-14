// @vitest-environment node
import { describe, it, expect } from 'vitest';

import { PasswordRecoveryService } from '../../../../electron/services/recovery/PasswordRecoveryService.js';

describe('PasswordRecoveryService.isValid', () => {
  const svc = new PasswordRecoveryService();

  it('accepts metadata with both fields', () => {
    expect(
      svc.isValid('main', { salt: 'aa', encryptedMasterPassword: { x: 1 } })
    ).toBe(true);
  });

  it.each([
    [{}],
    [{ salt: 'aa' }],
    [{ encryptedMasterPassword: { x: 1 } }],
    [null],
    [undefined],
  ])('rejects %j', (metadata) => {
    expect(svc.isValid('main', metadata)).toBe(false);
  });
});
