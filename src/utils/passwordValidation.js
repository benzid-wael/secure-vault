// Password validation utilities for consistent validation across the app

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

export const validatePasswordStrength = (password) => {
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
};

export const getPasswordRequirements = () => {
  return [
    'At least 8 characters long',
    'Mix of uppercase and lowercase letters',
    'At least one number',
    'At least one special character',
    'Avoid common passwords'
  ];
};
