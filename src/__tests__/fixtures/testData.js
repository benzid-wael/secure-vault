// Test fixtures and mock data for unit tests
export const mockVaultEntries = [
  {
    id: '1',
    title: 'Gmail Account',
    username: 'user@gmail.com',
    password: 'SecurePass123!',
    url: 'https://gmail.com',
    notes: 'Personal email account',
    category: 'email',
    entryType: 'password',
    createdAt: '2024-01-01T10:00:00.000Z',
    updatedAt: '2024-01-01T10:00:00.000Z',
  },
  {
    id: '2',
    title: 'Facebook',
    username: 'john.doe',
    password: 'MyFacebookPass456@',
    url: 'https://facebook.com',
    notes: 'Social media account',
    category: 'website',
    entryType: 'password',
    createdAt: '2024-01-02T11:00:00.000Z',
    updatedAt: '2024-01-02T11:00:00.000Z',
  },
  {
    id: '3',
    title: 'Work Database',
    username: 'admin',
    password: 'WorkDB789#',
    url: 'https://company-db.com',
    notes: 'Database access for work',
    category: 'work',
    entryType: 'password',
    createdAt: '2024-01-03T09:00:00.000Z',
    updatedAt: '2024-01-03T09:00:00.000Z',
  },
  {
    id: '4',
    title: 'Banking App',
    username: 'customer123',
    password: 'BankSecure999$',
    url: 'https://mybank.com',
    notes: 'Online banking access',
    category: 'finance',
    entryType: 'password',
    createdAt: '2024-01-04T14:00:00.000Z',
    updatedAt: '2024-01-04T14:00:00.000Z',
  },
  {
    id: '5',
    title: 'Home WiFi',
    ssid: 'MyHomeNetwork',
    password: 'WiFiPass123!',
    security: 'WPA2',
    frequency: '5GHz',
    category: 'network',
    entryType: 'wifi',
    createdAt: '2024-01-05T10:00:00.000Z',
    updatedAt: '2024-01-05T10:00:00.000Z',
  },
  {
    id: '6',
    title: 'Google 2FA',
    service: 'Google Account',
    secret: 'JBSWY3DPEHPK3PXP',
    issuer: 'Google',
    algorithm: 'SHA1',
    digits: '6',
    period: 30,
    category: 'security',
    entryType: 'otp',
    createdAt: '2024-01-06T11:00:00.000Z',
    updatedAt: '2024-01-06T11:00:00.000Z',
  },
  {
    id: '7',
    title: 'Production Server',
    hostname: 'prod.example.com',
    username: 'deploy',
    port: 22,
    privateKey:
      '-----BEGIN OPENSSH PRIVATE KEY-----\ntest-key-content\n-----END OPENSSH PRIVATE KEY-----',
    keyType: 'ed25519',
    category: 'work',
    entryType: 'ssh_key',
    createdAt: '2024-01-07T12:00:00.000Z',
    updatedAt: '2024-01-07T12:00:00.000Z',
  },
  {
    id: '8',
    title: 'Personal Notes',
    content: 'Important personal information and reminders.',
    tags: 'personal, important, private',
    category: 'notes',
    entryType: 'secure_note',
    createdAt: '2024-01-08T13:00:00.000Z',
    updatedAt: '2024-01-08T13:00:00.000Z',
  },
  {
    id: '9',
    title: 'Main Credit Card',
    cardholderName: 'John Doe',
    cardNumber: '4111111111111111',
    expiryDate: '12/25',
    cvv: '123',
    cardType: 'visa',
    pin: '1234',
    bankName: 'Example Bank',
    category: 'finance',
    entryType: 'credit_card',
    createdAt: '2024-01-09T14:00:00.000Z',
    updatedAt: '2024-01-09T14:00:00.000Z',
  },
  {
    id: '10',
    title: 'Bank Authentication Card',
    cardName: 'Security Card #1',
    issuer: 'Example Bank',
    gridData: {
      A1: 'ABC123',
      A2: 'DEF456',
      B1: 'GHI789',
      B2: 'JKL012',
    },
    rows: 10,
    columns: 10,
    category: 'banking',
    entryType: 'level3_card',
    createdAt: '2024-01-10T15:00:00.000Z',
    updatedAt: '2024-01-10T15:00:00.000Z',
  },
];

export const mockVaultInfo = {
  version: '1.0',
  created: '2024-01-01T00:00:00.000Z',
  lastPasswordChange: '2024-01-01T00:00:00.000Z',
  entries: mockVaultEntries,
  passwordHistory: [
    {
      changedAt: '2023-12-01T00:00:00.000Z',
      passwordHash: 'hash123',
    },
  ],
  settings: {
    enforcePasswordChange: false,
    passwordChangeWarningDays: 90,
    preventPasswordReuse: true,
    maxPasswordHistory: 3,
  },
};

export const mockElectronAPI = {
  loadVault: vi.fn(),
  addEntry: vi.fn(),
  updateEntry: vi.fn(),
  deleteEntry: vi.fn(),
  changeMasterPassword: vi.fn(),
  updateVaultSettings: vi.fn(),
  restoreVaultBackup: vi.fn(),
  hasVaultBackup: vi.fn(),
};

export const createMockEntry = (overrides = {}) => ({
  id: Date.now().toString(),
  title: 'Test Entry',
  username: 'testuser',
  password: 'TestPass123!',
  url: 'https://example.com',
  notes: 'Test notes',
  category: 'general',
  entryType: 'password',
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  ...overrides,
});

// Helper functions to create specific entry types
export const createMockWifiEntry = (overrides = {}) => ({
  id: Date.now().toString(),
  title: 'Test WiFi',
  ssid: 'TestNetwork',
  password: 'WiFiPass123!',
  security: 'WPA2',
  frequency: '5GHz',
  category: 'network',
  entryType: 'wifi',
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  ...overrides,
});

export const createMockOTPEntry = (overrides = {}) => ({
  id: Date.now().toString(),
  title: 'Test OTP',
  service: 'Test Service',
  secret: 'JBSWY3DPEHPK3PXP',
  issuer: 'Test Issuer',
  algorithm: 'SHA1',
  digits: '6',
  period: 30,
  category: 'security',
  entryType: 'otp',
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  ...overrides,
});

export const createMockLevel3CardEntry = (overrides = {}) => ({
  id: Date.now().toString(),
  title: 'Test Level 3 Card',
  cardName: 'Test Card',
  issuer: 'Test Bank',
  gridData: {
    A1: 'ABC123',
    B2: 'DEF456',
  },
  rows: 10,
  columns: 10,
  category: 'banking',
  entryType: 'level3_card',
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  ...overrides,
});

export const createMockVaultResult = (
  success = true,
  data = mockVaultInfo,
  error = null
) => ({
  success,
  data: success ? data : null,
  error: success ? null : error,
});

// Mock password generation options
export const mockPasswordOptions = {
  length: 16,
  includeUppercase: true,
  includeLowercase: true,
  includeNumbers: true,
  includeSymbols: true,
  excludeSimilar: true,
};

// Mock validation errors
export const mockValidationErrors = {
  title: 'Title is required',
  username: 'Username/Email is required',
  password: 'Password is required',
};

// Helper function to create a clean test environment
export const createTestEnvironment = () => {
  // Mock window.electronAPI
  Object.defineProperty(window, 'electronAPI', {
    value: mockElectronAPI,
    writable: true,
  });

  // Mock navigator.clipboard
  Object.defineProperty(navigator, 'clipboard', {
    value: {
      writeText: vi.fn().mockResolvedValue(),
    },
    writable: true,
  });

  // Reset all mocks
  Object.values(mockElectronAPI).forEach((mock) => {
    if (typeof mock?.mockReset === 'function') {
      mock.mockReset();
    }
  });

  return {
    electronAPI: mockElectronAPI,
    clipboard: navigator.clipboard,
  };
};
