// Unit tests for password validation utilities
import {
  getPasswordStrength,
  validatePasswordStrength,
  getPasswordRequirements,
} from '../../utils/passwordValidation';

describe('passwordValidation', () => {
  describe('getPasswordStrength', () => {
    it('should return weak for empty password', () => {
      const result = getPasswordStrength('');
      expect(result).toEqual({
        strength: 'weak',
        color: '#f44336',
        width: '25%',
      });
    });

    it('should return weak for short password', () => {
      const result = getPasswordStrength('123');
      expect(result).toEqual({
        strength: 'weak',
        color: '#f44336',
        width: '25%',
      });
    });

    it('should return fair for password with basic requirements', () => {
      const result = getPasswordStrength('password123');
      expect(result).toEqual({
        strength: 'fair',
        color: '#ff9800',
        width: '50%',
      });
    });

    it('should return good for password with mixed case and numbers', () => {
      const result = getPasswordStrength('Password123');
      expect(result).toEqual({
        strength: 'good',
        color: '#2196f3',
        width: '75%',
      });
    });

    it('should return strong for complex password', () => {
      const result = getPasswordStrength('MySecure123!');
      expect(result).toEqual({
        strength: 'strong',
        color: '#4caf50',
        width: '100%',
      });
    });

    it('should handle long complex passwords', () => {
      const result = getPasswordStrength('MyVerySecurePassword123!@#');
      expect(result).toEqual({
        strength: 'strong',
        color: '#4caf50',
        width: '100%',
      });
    });
  });

  describe('validatePasswordStrength', () => {
    it('should return error for empty password', () => {
      const result = validatePasswordStrength('');
      expect(result).toEqual(['Password is required']);
    });

    it('should return error for null password', () => {
      const result = validatePasswordStrength(null);
      expect(result).toEqual(['Password is required']);
    });

    it('should return error for short password', () => {
      const result = validatePasswordStrength('VeRyS2c!');
      expect(result).toEqual([]); // 8 chars: the minimum
      expect(validatePasswordStrength('VeRy2c!')).toEqual([
        'Password must be at least 8 characters long',
      ]);
    });

    it('lists every missing character class for a weak password', () => {
      expect(validatePasswordStrength('password')).toEqual([
        'Password must contain at least one uppercase letter',
        'Password must contain at least one number',
        'Password must contain at least one special character',
      ]);
    });

    it('should return empty array for strong password', () => {
      const result = validatePasswordStrength('MySecure123!');
      expect(result).toEqual([]);
    });

    it('rejects a password with no special character (UI and main process agree)', () => {
      // The renderer used to accept this while the main process refused it.
      expect(validatePasswordStrength('Password123')).toEqual([
        'Password must contain at least one special character',
      ]);
    });

    it('counts any non-alphanumeric character as special', () => {
      expect(validatePasswordStrength('Password 123')).toEqual([]);
      expect(validatePasswordStrength('Password123€')).toEqual([]);
    });

    it('rejects passwords over 128 characters', () => {
      expect(validatePasswordStrength(`Aa1!${'x'.repeat(125)}`)).toEqual([
        'Password must be less than 128 characters long',
      ]);
    });
  });

  describe('getPasswordRequirements', () => {
    it('should return array of password requirements', () => {
      const result = getPasswordRequirements();
      expect(result).toEqual([
        'At least 8 characters long',
        'Mix of uppercase and lowercase letters',
        'At least one number',
        'At least one special character',
        'Avoid common passwords',
      ]);
    });

    it('should return consistent requirements', () => {
      const result1 = getPasswordRequirements();
      const result2 = getPasswordRequirements();
      expect(result1).toEqual(result2);
    });
  });
});
