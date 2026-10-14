// Shared password validation utilities for both Electron and React
// This module can be used by both the main process and renderer process

/**
 * Calculate password strength based on various criteria
 * @param {string} password - The password to evaluate
 * @returns {Object} - Object containing strength info (strength, color, width)
 */
export const getPasswordStrength = (password) => {
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
};

/**
 * Validate password strength and return array of error messages.
 *
 * This is the one policy for every vault: the desktop main process, the CLI
 * (`vault env`) and the renderer forms all import it, so the UI can't accept a
 * password the main process then rejects. `getPasswordStrength` above is only
 * the strength meter; it does not decide what is accepted.
 *
 * @param {string} password - The password to validate
 * @returns {Array} - Array of error messages (empty if valid)
 */
export const validatePasswordStrength = (password) => {
  const errors = [];

  if (!password) {
    errors.push('Password is required');
    return errors;
  }

  if (password.length < 8) {
    errors.push('Password must be at least 8 characters long');
  }

  if (password.length > 128) {
    errors.push('Password must be less than 128 characters long');
  }

  if (!/[A-Z]/.test(password)) {
    errors.push('Password must contain at least one uppercase letter');
  }

  if (!/[a-z]/.test(password)) {
    errors.push('Password must contain at least one lowercase letter');
  }

  if (!/[0-9]/.test(password)) {
    errors.push('Password must contain at least one number');
  }

  if (!/[^A-Za-z0-9]/.test(password)) {
    errors.push('Password must contain at least one special character');
  }

  return errors;
};

/**
 * Get password requirements for display to users
 * @returns {Array} - Array of requirement strings
 */
export const getPasswordRequirements = () => {
  return [
    'At least 8 characters long',
    'Mix of uppercase and lowercase letters',
    'At least one number',
    'At least one special character',
    'Avoid common passwords',
  ];
};
