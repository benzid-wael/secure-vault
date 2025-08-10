// Shared password validation utilities for both Electron and React
// This module can be used by both the main process and renderer process

/**
 * Calculate password strength based on various criteria
 * @param {string} password - The password to evaluate
 * @returns {Object} - Object containing strength info (strength, color, width)
 */
function getPasswordStrength(password) {
  let score = 0;
  if (password.length >= 8) score++;
  if (password.length >= 12) score++;
  if (/[a-z]/.test(password)) score++;
  if (/[A-Z]/.test(password)) score++;
  if (/[0-9]/.test(password)) score++;
  if (/[^A-Za-z0-9]/.test(password)) score++;
  
  if (score < 3) return { strength: 'weak', color: '#f44336', width: '25%' };
  if (score < 4) return { strength: 'fair', color: '#ff9800', width: '50%' };
  if (score < 5) return { strength: 'good', color: '#2196f3', width: '75%' };
  return { strength: 'strong', color: '#4caf50', width: '100%' };
}

/**
 * Validate password strength and return array of error messages
 * @param {string} password - The password to validate
 * @returns {Array} - Array of error messages (empty if valid)
 */
function validatePasswordStrength(password) {
  const errors = [];
  
  if (!password) {
    errors.push('Password is required');
    return errors;
  }
  
  if (password.length < 8) {
    errors.push('Password must be at least 8 characters long');
  }
  
  const strength = getPasswordStrength(password);
  if (strength.strength === 'weak') {
    errors.push('Password is too weak. Please include a mix of uppercase, lowercase, numbers, and special characters');
  }
  
  return errors;
}

/**
 * Get password requirements for display to users
 * @returns {Array} - Array of requirement strings
 */
function getPasswordRequirements() {
  return [
    'At least 8 characters long',
    'Mix of uppercase and lowercase letters',
    'At least one number',
    'At least one special character',
    'Avoid common passwords'
  ];
}

// Export for both CommonJS (Electron) and ES6 modules (React)
if (typeof module !== 'undefined' && module.exports) {
  // CommonJS export for Electron
  module.exports = {
    getPasswordStrength,
    validatePasswordStrength,
    getPasswordRequirements
  };
} else {
  // ES6 export for React (will be handled by bundler)
  if (typeof window !== 'undefined') {
    window.passwordValidation = {
      getPasswordStrength,
      validatePasswordStrength,
      getPasswordRequirements
    };
  }
}

// Also export as ES6 modules for modern bundlers
export {
  getPasswordStrength,
  validatePasswordStrength,
  getPasswordRequirements
};
