// Simple test to verify testing setup works
describe('Simple Test Suite', () => {
  it('should pass basic test', () => {
    expect(1 + 1).toBe(2);
  });

  it('should test password validation utility', () => {
    // Import the utility directly
    const { getPasswordStrength } = require('../utils/passwordValidation');
    
    const result = getPasswordStrength('MySecure123!');
    expect(result.strength).toBe('strong');
    expect(result.color).toBe('#4caf50');
  });

  it('should test password generator utility', () => {
    const { generatePassword } = require('../utils/passwordGenerator');
    
    const password = generatePassword(12);
    expect(password).toHaveLength(12);
    expect(typeof password).toBe('string');
  });
});
