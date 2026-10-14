export class SecurityManager {
  constructor() {
    this.securityPolicies = new Map();
  }

  setupSecurityPolicies() {
    // Define security policies
    this.securityPolicies.set('windowCreation', 'deny');
    this.securityPolicies.set('externalNavigation', 'deny');
    this.securityPolicies.set('remoteContent', 'deny');
  }

  handleWebContentsCreated(contents) {
    // Prevent new window creation
    contents.on('new-window', (event, navigationUrl) => {
      event.preventDefault();
    });

    // Additional security measures can be added here
    contents.on('will-navigate', (event, navigationUrl) => {
      // This is handled by WindowManager, but we can add additional checks here
    });
  }

  validateInput(input, type) {
    switch (type) {
      case 'vaultName':
        return this.validateVaultName(input);
      case 'password':
        return this.validatePassword(input);
      case 'recoveryKey':
        return this.validateRecoveryKey(input);
      default:
        return { isValid: true };
    }
  }

  validateVaultName(vaultName) {
    if (!vaultName || typeof vaultName !== 'string') {
      return { isValid: false, error: 'Vault name must be a string' };
    }

    if (vaultName.length < 1 || vaultName.length > 50) {
      return {
        isValid: false,
        error: 'Vault name must be between 1 and 50 characters',
      };
    }

    // Check for invalid characters
    const invalidChars = /[<>:"/\\|?*]/;
    if (invalidChars.test(vaultName)) {
      return {
        isValid: false,
        error: 'Vault name contains invalid characters',
      };
    }

    return { isValid: true };
  }

  validatePassword(password) {
    if (!password || typeof password !== 'string') {
      return { isValid: false, error: 'Password must be a string' };
    }

    if (password.length < 8) {
      return {
        isValid: false,
        error: 'Password must be at least 8 characters long',
      };
    }

    return { isValid: true };
  }

  validateRecoveryKey(recoveryKey) {
    if (!recoveryKey || typeof recoveryKey !== 'string') {
      return { isValid: false, error: 'Recovery key must be a string' };
    }

    // Remove dashes and convert to uppercase
    const cleanKey = recoveryKey.replace(/-/g, '').toUpperCase();

    // Check if it matches expected format (base32, specific length)
    const base32Regex = /^[ABCDEFGHIJKLMNOPQRSTUVWXYZ234567]+$/;
    if (!base32Regex.test(cleanKey) || cleanKey.length < 50) {
      return { isValid: false, error: 'Invalid recovery key format' };
    }

    return { isValid: true };
  }

  /**
   * True only for IPC from `window`'s own top-level frame. Anything else (a
   * subframe, a destroyed or replaced window, another webContents) gets no
   * access to the vault API.
   */
  isTrustedSender(event, window) {
    if (!window || window.isDestroyed()) return false;
    const contents = window.webContents;
    return (
      event?.sender === contents &&
      !!event.senderFrame &&
      event.senderFrame === contents.mainFrame
    );
  }

  isSecureOrigin(url) {
    try {
      const parsedUrl = new URL(url);
      return (
        parsedUrl.protocol === 'file:' || parsedUrl.hostname === 'localhost'
      );
    } catch {
      return false;
    }
  }
}
