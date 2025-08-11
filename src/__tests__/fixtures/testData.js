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
    createdAt: '2024-01-04T14:00:00.000Z',
    updatedAt: '2024-01-04T14:00:00.000Z',
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
