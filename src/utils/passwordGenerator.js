// Password generation utilities
export const generatePassword = (length = 16, options = {}) => {
  const {
    includeUppercase = true,
    includeLowercase = true,
    includeNumbers = true,
    includeSymbols = true,
    excludeSimilar = true,
  } = options;

  let charset = '';

  if (includeUppercase) charset += 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  if (includeLowercase) charset += 'abcdefghijklmnopqrstuvwxyz';
  if (includeNumbers) charset += '0123456789';
  if (includeSymbols) charset += '!@#$%^&*()_+-=[]{}|;:,.<>?';

  // Exclude similar looking characters if requested
  if (excludeSimilar) {
    charset = charset.replace(/[il1Lo0O]/g, '');
  }

  if (!charset) {
    throw new Error('At least one character type must be selected');
  }

  let password = '';
  for (let i = 0; i < length; i++) {
    password += charset.charAt(Math.floor(Math.random() * charset.length));
  }

  return password;
};

export const getPasswordGenerationOptions = () => ({
  length: 16,
  includeUppercase: true,
  includeLowercase: true,
  includeNumbers: true,
  includeSymbols: true,
  excludeSimilar: true,
});

export const validatePasswordOptions = (options) => {
  const { includeUppercase, includeLowercase, includeNumbers, includeSymbols } =
    options;

  if (
    !includeUppercase &&
    !includeLowercase &&
    !includeNumbers &&
    !includeSymbols
  ) {
    return {
      valid: false,
      error: 'At least one character type must be selected',
    };
  }

  if (options.length < 4 || options.length > 128) {
    return {
      valid: false,
      error: 'Password length must be between 4 and 128 characters',
    };
  }

  return { valid: true };
};
