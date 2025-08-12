/**
 * Main entry point for the Electron application
 * Follows Dependency Injection and Inversion of Control principles
 * Orchestrates all services following SOLID principles
 */

import { app } from 'electron';

// Import services
import { EncryptionService } from './services/EncryptionService.js';
import { VaultStorageService } from './services/VaultStorageService.js';
import { RecoveryService } from './services/RecoveryService.js';
import { VaultManagerService } from './services/VaultManagerService.js';
import { IPCHandlerService } from './services/IPCHandlerService.js';
import { ApplicationService } from './services/ApplicationService.js';

/**
 * Main application class that orchestrates all services
 * Follows Single Responsibility Principle - only handles service coordination
 */
class SecurePasswordManagerApp {
  constructor() {
    this.services = {};
    this.isInitialized = false;
  }

  /**
   * Initialize the application and all services
   * @returns {Promise<void>}
   */
  async initialize() {
    try {
      console.log('Initializing Secure Password Manager...');

      // Initialize services in dependency order
      await this.initializeServices();

      // Register IPC handlers
      this.services.ipcHandler.registerHandlers();

      // Initialize application window and menu
      await this.services.application.initialize();

      this.isInitialized = true;
      console.log('Secure Password Manager initialized successfully');
    } catch (error) {
      console.error('Failed to initialize application:', error);
      this.cleanup();
      app.quit();
    }
  }

  /**
   * Initialize all services with proper dependency injection
   * @returns {Promise<void>}
   */
  async initializeServices() {
    // Core services (no dependencies)
    this.services.encryption = new EncryptionService();
    this.services.storage = new VaultStorageService();

    // Recovery service (depends on encryption)
    this.services.recovery = new RecoveryService(this.services.encryption);

    // Vault manager (depends on encryption, storage, and recovery)
    this.services.vaultManager = new VaultManagerService(
      this.services.encryption,
      this.services.storage,
      this.services.recovery
    );

    // IPC handler (depends on vault manager)
    this.services.ipcHandler = new IPCHandlerService(
      this.services.vaultManager
    );

    // Application service (no dependencies on other services)
    this.services.application = new ApplicationService();

    // Initialize services that need async initialization
    await this.services.storage.initialize();
    await this.services.vaultManager.initialize();

    console.log('All services initialized successfully');
  }

  /**
   * Cleanup all services
   */
  cleanup() {
    try {
      console.log('Cleaning up application...');

      // Unregister IPC handlers
      if (this.services.ipcHandler) {
        this.services.ipcHandler.unregisterHandlers();
      }

      // Cleanup application service
      if (this.services.application) {
        this.services.application.cleanup();
      }

      // Clear service references
      this.services = {};
      this.isInitialized = false;

      console.log('Application cleanup completed');
    } catch (error) {
      console.error('Error during cleanup:', error);
    }
  }

  /**
   * Get a service instance
   * @param {string} serviceName - Name of the service
   * @returns {Object|null} Service instance or null if not found
   */
  getService(serviceName) {
    return this.services[serviceName] || null;
  }

  /**
   * Check if application is initialized
   * @returns {boolean} True if initialized
   */
  isAppInitialized() {
    return this.isInitialized;
  }
}

// Create global app instance
const passwordManagerApp = new SecurePasswordManagerApp();

// App event handlers
app.whenReady().then(async () => {
  await passwordManagerApp.initialize();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    passwordManagerApp.cleanup();
    app.quit();
  }
});

app.on('activate', async () => {
  if (!passwordManagerApp.isAppInitialized()) {
    await passwordManagerApp.initialize();
  }
});

app.on('before-quit', () => {
  passwordManagerApp.cleanup();
});

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception:', error);
  passwordManagerApp.cleanup();
  app.quit();
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
  passwordManagerApp.cleanup();
  app.quit();
});

// Export for testing purposes
export { passwordManagerApp };
export default passwordManagerApp;
