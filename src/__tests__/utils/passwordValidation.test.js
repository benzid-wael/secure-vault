// Unit tests for password validation utilities
import {
  getPasswordStrength,
  validatePasswordStrength,
  getPasswordRequirements
} from '../../utils/passwordValidation';

describe('passwordValidation', () => {
  describe('getPasswordStrength', () => {
    it('should return weak for empty password', () => {
      const result = getPasswordStrength('');
      expect(result).toEqual({
        strength: 'weak',
        color: '#f44336',
        width: '25%'
      });
    });

    it('should return weak for short password', () => {
      const result = getPasswordStrength('123');
      expect(result).toEqual({
        strength: 'weak',
        color: '#f44336',
        width: '25%'
      });
    });

    it('should return fair for password with basic requirements', () => {
      const result = getPasswordStrength('password123');
      expect(result).toEqual({
        strength: 'fair',
        color: '#ff9800',
        width: '50%'
      });
    });

    it('should return good for password with mixed case and numbers', () => {
      const result = getPasswordStrength('Password123');
      expect(result).toEqual({
        strength: 'good',
        color: '#2196f3',
        width: '75%'
      });
    });

    it('should return strong for complex password', () => {
      const result = getPasswordStrength('MySecure123!');
      expect(result).toEqual({
        strength: 'strong',
        color: '#4caf50',
        width: '100%'
      });
    });

    it('should handle long complex passwords', () => {
      const result = getPasswordStrength('MyVerySecurePassword123!@#');
      expect(result).toEqual({
        strength: 'strong',
        color: '#4caf50',
        width: '100%'
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
      const result = validatePasswordStrength('VeRyS2c');
      expect(result).toEqual(['Password must be at least 8 characters long']);
    });

    it('should return error for weak password', () => {
      const result = validatePasswordStrength('password');
      expect(result).toEqual([
        'Password is too weak. Please include a mix of uppercase, lowercase, numbers, and special characters'
      ]);
    });

    it('should return empty array for strong password', () => {
      const result = validatePasswordStrength('MySecure123!');
      expect(result).toEqual([]);
    });

    it('should return empty array for minimum acceptable password', () => {
      const result = validatePasswordStrength('Password123');
      expect(result).toEqual([]);
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
        'Avoid common passwords'
      ]);
    });

    it('should return consistent requirements', () => {
      const result1 = getPasswordRequirements();
      const result2 = getPasswordRequirements();
      expect(result1).toEqual(result2);
    });
  });
});
