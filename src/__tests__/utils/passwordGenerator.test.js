// Unit tests for password generator utilities
import {
  generatePassword,
  getPasswordGenerationOptions,
  validatePasswordOptions
} from '../../utils/passwordGenerator';

describe('passwordGenerator', () => {
  describe('generatePassword', () => {
    it('should generate password with default length', () => {
      const password = generatePassword();
      expect(password).toHaveLength(16);
      expect(typeof password).toBe('string');
    });

    it('should generate password with custom length', () => {
      const password = generatePassword(12);
      expect(password).toHaveLength(12);
    });

    it('should generate password with only uppercase letters', () => {
      const password = generatePassword(10, {
        includeUppercase: true,
        includeLowercase: false,
        includeNumbers: false,
        includeSymbols: false
      });
      expect(password).toHaveLength(10);
      expect(password).toMatch(/^[A-Z]+$/);
    });

    it('should generate password with only lowercase letters', () => {
      const password = generatePassword(10, {
        includeUppercase: false,
        includeLowercase: true,
        includeNumbers: false,
        includeSymbols: false
      });
      expect(password).toHaveLength(10);
      expect(password).toMatch(/^[a-z]+$/);
    });

    it('should generate password with only numbers', () => {
      const password = generatePassword(10, {
        includeUppercase: false,
        includeLowercase: false,
        includeNumbers: true,
        includeSymbols: false
      });
      expect(password).toHaveLength(10);
      expect(password).toMatch(/^[0-9]+$/);
    });

    it('should generate password with mixed character types', () => {
      const password = generatePassword(20, {
        includeUppercase: true,
        includeLowercase: true,
        includeNumbers: true,
        includeSymbols: true
      });
      expect(password).toHaveLength(20);
      // Should contain at least one character from each type (statistically very likely)
      expect(password).toMatch(/[A-Z]/);
      expect(password).toMatch(/[a-z]/);
      expect(password).toMatch(/[0-9]/);
      expect(password).toMatch(/[!@#$%^&*()_+\-=\[\]{}|;:,.<>?]/);
    });

    it('should exclude similar characters when requested', () => {
      const password = generatePassword(100, {
        includeUppercase: true,
        includeLowercase: true,
        includeNumbers: true,
        includeSymbols: false,
        excludeSimilar: true
      });
      // Should not contain similar looking characters
      expect(password).not.toMatch(/[il1Lo0O]/);
    });

    it('should throw error when no character types selected', () => {
      expect(() => {
        generatePassword(10, {
          includeUppercase: false,
          includeLowercase: false,
          includeNumbers: false,
          includeSymbols: false
        });
      }).toThrow('At least one character type must be selected');
    });

    it('should generate different passwords on multiple calls', () => {
      const password1 = generatePassword(16);
      const password2 = generatePassword(16);
      expect(password1).not.toBe(password2);
    });
  });

  describe('getPasswordGenerationOptions', () => {
    it('should return default options', () => {
      const options = getPasswordGenerationOptions();
      expect(options).toEqual({
        length: 16,
        includeUppercase: true,
        includeLowercase: true,
        includeNumbers: true,
        includeSymbols: true,
        excludeSimilar: true
      });
    });

    it('should return consistent options', () => {
      const options1 = getPasswordGenerationOptions();
      const options2 = getPasswordGenerationOptions();
      expect(options1).toEqual(options2);
    });
  });

  describe('validatePasswordOptions', () => {
    it('should validate valid options', () => {
      const result = validatePasswordOptions({
        length: 16,
        includeUppercase: true,
        includeLowercase: true,
        includeNumbers: true,
        includeSymbols: true
      });
      expect(result).toEqual({ valid: true });
    });

    it('should reject when no character types selected', () => {
      const result = validatePasswordOptions({
        length: 16,
        includeUppercase: false,
        includeLowercase: false,
        includeNumbers: false,
        includeSymbols: false
      });
      expect(result).toEqual({
        valid: false,
        error: 'At least one character type must be selected'
      });
    });

    it('should reject password length too short', () => {
      const result = validatePasswordOptions({
        length: 3,
        includeUppercase: true,
        includeLowercase: true,
        includeNumbers: true,
        includeSymbols: true
      });
      expect(result).toEqual({
        valid: false,
        error: 'Password length must be between 4 and 128 characters'
      });
    });

    it('should reject password length too long', () => {
      const result = validatePasswordOptions({
        length: 200,
        includeUppercase: true,
        includeLowercase: true,
        includeNumbers: true,
        includeSymbols: true
      });
      expect(result).toEqual({
        valid: false,
        error: 'Password length must be between 4 and 128 characters'
      });
    });

    it('should accept minimum valid length', () => {
      const result = validatePasswordOptions({
        length: 4,
        includeUppercase: true,
        includeLowercase: false,
        includeNumbers: false,
        includeSymbols: false
      });
      expect(result).toEqual({ valid: true });
    });

    it('should accept maximum valid length', () => {
      const result = validatePasswordOptions({
        length: 128,
        includeUppercase: true,
        includeLowercase: false,
        includeNumbers: false,
        includeSymbols: false
      });
      expect(result).toEqual({ valid: true });
    });
  });
});
