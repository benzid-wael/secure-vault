// Entry type definitions and schemas
import {
  Lock as PasswordIcon,
  Wifi as WifiIcon,
  Security as OTPIcon,
  VpnKey as SSHIcon,
  Key as GPGIcon,
  Note as NoteIcon,
  AccountBalance as BankIcon,
  CreditCard as CreditCardIcon,
  Grid3x3 as Level3CardIcon,
} from '@mui/icons-material';

// Entry type constants
export const ENTRY_TYPES = {
  PASSWORD: 'password',
  WIFI: 'wifi',
  OTP: 'otp',
  SSH_KEY: 'ssh_key',
  GPG_KEY: 'gpg_key',
  SECURE_NOTE: 'secure_note',
  BANK_ACCOUNT: 'bank_account',
  CREDIT_CARD: 'credit_card',
  LEVEL3_CARD: 'level3_card',
};

// Field types for dynamic form generation
export const FIELD_TYPES = {
  TEXT: 'text',
  PASSWORD: 'password',
  EMAIL: 'email',
  URL: 'url',
  TEXTAREA: 'textarea',
  SELECT: 'select',
  NUMBER: 'number',
  DATE: 'date',
  GRID: 'grid', // For level 3 card grid
  MULTILINE: 'multiline', // For SSH/GPG keys
};

// Base entry schema
const baseEntrySchema = {
  id: { type: FIELD_TYPES.TEXT, required: false, generated: true },
  title: { type: FIELD_TYPES.TEXT, required: true, label: 'Title', order: 1 },
  category: {
    type: FIELD_TYPES.SELECT,
    required: true,
    label: 'Category',
    order: 900,
  },
  notes: {
    type: FIELD_TYPES.TEXTAREA,
    required: false,
    label: 'Notes',
    order: 1000,
  },
  createdAt: { type: FIELD_TYPES.TEXT, required: false, generated: true },
  updatedAt: { type: FIELD_TYPES.TEXT, required: false, generated: true },
  entryType: { type: FIELD_TYPES.TEXT, required: true, generated: true },
};

// Entry type definitions
export const ENTRY_TYPE_DEFINITIONS = {
  [ENTRY_TYPES.PASSWORD]: {
    name: 'Password',
    icon: PasswordIcon,
    color: '#2196f3',
    description: 'Store login credentials',
    schema: {
      ...baseEntrySchema,
      username: {
        type: FIELD_TYPES.TEXT,
        required: true,
        label: 'Username/Email',
        order: 100,
      },
      password: {
        type: FIELD_TYPES.PASSWORD,
        required: true,
        label: 'Password',
        canGenerate: true,
        order: 200,
      },
      url: {
        type: FIELD_TYPES.URL,
        required: false,
        label: 'Website URL',
        order: 300,
      },
    },
    displayFields: ['username', 'url'],
    copyableFields: ['username', 'password', 'url'],
    searchFields: ['title', 'username', 'url'],
  },

  [ENTRY_TYPES.WIFI]: {
    name: 'WiFi Password',
    icon: WifiIcon,
    color: '#4caf50',
    description: 'Store WiFi network credentials',
    schema: {
      ...baseEntrySchema,
      ssid: {
        type: FIELD_TYPES.TEXT,
        required: true,
        label: 'Network Name (SSID)',
        order: 100,
      },
      password: {
        type: FIELD_TYPES.PASSWORD,
        required: true,
        label: 'WiFi Password',
        canGenerate: true,
        order: 200,
      },
      security: {
        type: FIELD_TYPES.SELECT,
        required: true,
        label: 'Security Type',
        order: 300,
        options: [
          { value: 'WPA2', label: 'WPA2' },
          { value: 'WPA3', label: 'WPA3' },
          { value: 'WEP', label: 'WEP' },
          { value: 'Open', label: 'Open' },
        ],
      },
      frequency: {
        type: FIELD_TYPES.SELECT,
        required: false,
        label: 'Frequency',
        order: 400,
        options: [
          { value: '2.4GHz', label: '2.4 GHz' },
          { value: '5GHz', label: '5 GHz' },
          { value: '6GHz', label: '6 GHz' },
        ],
      },
    },
    displayFields: ['ssid', 'security'],
    copyableFields: ['ssid', 'password'],
    searchFields: ['title', 'ssid'],
  },

  [ENTRY_TYPES.OTP]: {
    name: 'OTP/2FA',
    icon: OTPIcon,
    color: '#ff9800',
    description: 'Store two-factor authentication codes',
    schema: {
      ...baseEntrySchema,
      service: {
        type: FIELD_TYPES.TEXT,
        required: true,
        label: 'Service/Account',
        order: 100,
      },
      secret: {
        type: FIELD_TYPES.PASSWORD,
        required: true,
        label: 'Secret Key',
        order: 200,
      },
      issuer: {
        type: FIELD_TYPES.TEXT,
        required: false,
        label: 'Issuer',
        order: 300,
      },
      algorithm: {
        type: FIELD_TYPES.SELECT,
        required: false,
        label: 'Algorithm',
        order: 400,
        options: [
          { value: 'SHA1', label: 'SHA1' },
          { value: 'SHA256', label: 'SHA256' },
          { value: 'SHA512', label: 'SHA512' },
        ],
      },
      digits: {
        type: FIELD_TYPES.SELECT,
        required: false,
        label: 'Digits',
        order: 500,
        options: [
          { value: '6', label: '6' },
          { value: '8', label: '8' },
        ],
      },
      period: {
        type: FIELD_TYPES.NUMBER,
        required: false,
        label: 'Period (seconds)',
        defaultValue: 30,
        order: 600,
      },
    },
    displayFields: ['service', 'issuer'],
    copyableFields: ['secret'],
    searchFields: ['title', 'service', 'issuer'],
  },

  [ENTRY_TYPES.SSH_KEY]: {
    name: 'SSH Key',
    icon: SSHIcon,
    color: '#9c27b0',
    description: 'Store SSH private keys and connection details',
    schema: {
      ...baseEntrySchema,
      hostname: {
        type: FIELD_TYPES.TEXT,
        required: true,
        label: 'Hostname/IP',
        order: 100,
      },
      username: {
        type: FIELD_TYPES.TEXT,
        required: true,
        label: 'Username',
        order: 200,
      },
      port: {
        type: FIELD_TYPES.NUMBER,
        required: false,
        label: 'Port',
        defaultValue: 22,
        order: 300,
      },
      privateKey: {
        type: FIELD_TYPES.MULTILINE,
        required: true,
        label: 'Private Key',
        order: 400,
      },
      publicKey: {
        type: FIELD_TYPES.MULTILINE,
        required: false,
        label: 'Public Key',
        order: 500,
      },
      passphrase: {
        type: FIELD_TYPES.PASSWORD,
        required: false,
        label: 'Passphrase',
        order: 600,
      },
      keyType: {
        type: FIELD_TYPES.SELECT,
        required: false,
        label: 'Key Type',
        options: [
          { value: 'rsa', label: 'RSA' },
          { value: 'ed25519', label: 'Ed25519' },
          { value: 'ecdsa', label: 'ECDSA' },
          { value: 'dsa', label: 'DSA' },
        ],
      },
    },
    displayFields: ['username', 'hostname', 'port'],
    copyableFields: ['hostname', 'username', 'privateKey', 'publicKey'],
    searchFields: ['title', 'hostname', 'username'],
  },

  [ENTRY_TYPES.GPG_KEY]: {
    name: 'GPG Key',
    icon: GPGIcon,
    color: '#795548',
    description: 'Store GPG keys and related information',
    schema: {
      ...baseEntrySchema,
      keyId: {
        type: FIELD_TYPES.TEXT,
        required: true,
        label: 'Key ID',
        order: 100,
      },
      fingerprint: {
        type: FIELD_TYPES.TEXT,
        required: false,
        label: 'Fingerprint',
        order: 200,
      },
      email: {
        type: FIELD_TYPES.EMAIL,
        required: true,
        label: 'Email',
        order: 300,
      },
      name: {
        type: FIELD_TYPES.TEXT,
        required: true,
        label: 'Name',
        order: 400,
      },
      privateKey: {
        type: FIELD_TYPES.MULTILINE,
        required: true,
        label: 'Private Key',
        order: 500,
      },
      publicKey: {
        type: FIELD_TYPES.MULTILINE,
        required: false,
        label: 'Public Key',
        order: 600,
      },
      passphrase: {
        type: FIELD_TYPES.PASSWORD,
        required: false,
        label: 'Passphrase',
        order: 700,
      },
      expiryDate: {
        type: FIELD_TYPES.DATE,
        required: false,
        label: 'Expiry Date',
        order: 800,
      },
    },
    displayFields: ['email', 'keyId', 'expiryDate'],
    copyableFields: [
      'keyId',
      'fingerprint',
      'email',
      'privateKey',
      'publicKey',
    ],
    searchFields: ['title', 'email', 'name', 'keyId'],
  },

  [ENTRY_TYPES.SECURE_NOTE]: {
    name: 'Secure Note',
    icon: NoteIcon,
    color: '#607d8b',
    description: 'Store encrypted notes and sensitive information',
    schema: {
      ...baseEntrySchema,
      content: {
        type: FIELD_TYPES.MULTILINE,
        required: true,
        label: 'Note Content',
        order: 100,
      },
      tags: {
        type: FIELD_TYPES.TEXT,
        required: false,
        label: 'Tags (comma-separated)',
        order: 200,
      },
    },
    displayFields: ['tags'],
    copyableFields: ['content'],
    searchFields: ['title', 'content', 'tags'],
  },

  [ENTRY_TYPES.BANK_ACCOUNT]: {
    name: 'Bank Account',
    icon: BankIcon,
    color: '#e91e63',
    description: 'Store bank account information',
    schema: {
      ...baseEntrySchema,
      bankName: {
        type: FIELD_TYPES.TEXT,
        required: true,
        label: 'Bank Name',
        order: 100,
      },
      accountNumber: {
        type: FIELD_TYPES.PASSWORD,
        required: true,
        label: 'Account Number',
        order: 200,
      },
      routingNumber: {
        type: FIELD_TYPES.TEXT,
        required: false,
        label: 'Routing Number',
        order: 300,
      },
      accountType: {
        type: FIELD_TYPES.SELECT,
        required: true,
        label: 'Account Type',
        order: 400,
        options: [
          { value: 'checking', label: 'Checking' },
          { value: 'savings', label: 'Savings' },
          { value: 'business', label: 'Business' },
          { value: 'investment', label: 'Investment' },
        ],
      },
      accountHolder: {
        type: FIELD_TYPES.TEXT,
        required: true,
        label: 'Account Holder',
        order: 500,
      },
      iban: {
        type: FIELD_TYPES.TEXT,
        required: false,
        label: 'IBAN',
        order: 600,
      },
      swift: {
        type: FIELD_TYPES.TEXT,
        required: false,
        label: 'SWIFT/BIC',
        order: 700,
      },
      onlineBankingUrl: {
        type: FIELD_TYPES.URL,
        required: false,
        label: 'Online Banking URL',
        order: 800,
      },
      onlineBankingUsername: {
        type: FIELD_TYPES.TEXT,
        required: false,
        label: 'Online Banking Username',
        order: 810,
      },
      onlineBankingPassword: {
        type: FIELD_TYPES.PASSWORD,
        required: false,
        label: 'Online Banking Password',
        order: 820,
      },
    },
    displayFields: ['bankName', 'accountType', 'accountHolder'],
    copyableFields: [
      'accountNumber',
      'routingNumber',
      'iban',
      'swift',
      'onlineBankingUsername',
      'onlineBankingPassword',
    ],
    searchFields: ['title', 'bankName', 'accountHolder'],
  },

  [ENTRY_TYPES.CREDIT_CARD]: {
    name: 'Credit/Debit Card',
    icon: CreditCardIcon,
    color: '#f44336',
    description: 'Store credit and debit card information',
    schema: {
      ...baseEntrySchema,
      cardholderName: {
        type: FIELD_TYPES.TEXT,
        required: true,
        label: 'Cardholder Name',
        order: 100,
      },
      cardNumber: {
        type: FIELD_TYPES.PASSWORD,
        required: true,
        label: 'Card Number',
        order: 200,
      },
      expiryDate: {
        type: FIELD_TYPES.TEXT,
        required: true,
        label: 'Expiry Date (MM/YY)',
        order: 300,
      },
      cvv: {
        type: FIELD_TYPES.PASSWORD,
        required: true,
        label: 'CVV/CVC',
        order: 400,
      },
      cardType: {
        type: FIELD_TYPES.SELECT,
        required: true,
        label: 'Card Type',
        order: 500,
        options: [
          { value: 'visa', label: 'Visa' },
          { value: 'mastercard', label: 'Mastercard' },
          { value: 'amex', label: 'American Express' },
          { value: 'discover', label: 'Discover' },
          { value: 'debit', label: 'Debit Card' },
        ],
      },
      pin: {
        type: FIELD_TYPES.PASSWORD,
        required: false,
        label: 'PIN',
        order: 600,
      },
      bankName: {
        type: FIELD_TYPES.TEXT,
        required: false,
        label: 'Issuing Bank',
        order: 700,
      },
      creditLimit: {
        type: FIELD_TYPES.NUMBER,
        required: false,
        label: 'Credit Limit',
        order: 800,
      },
      billingAddress: {
        type: FIELD_TYPES.TEXTAREA,
        required: false,
        label: 'Billing Address',
        order: 810,
      },
    },
    displayFields: ['cardholderName', 'cardType', 'expiryDate'],
    copyableFields: ['cardNumber', 'cvv', 'pin'],
    searchFields: ['title', 'cardholderName', 'bankName'],
  },

  [ENTRY_TYPES.LEVEL3_CARD]: {
    name: 'Level 3 Card',
    icon: Level3CardIcon,
    color: '#00bcd4',
    description: 'Store level 3 authentication card with grid codes',
    schema: {
      ...baseEntrySchema,
      cardName: {
        type: FIELD_TYPES.TEXT,
        required: true,
        label: 'Card Name',
        order: 100,
      },
      issuer: {
        type: FIELD_TYPES.TEXT,
        required: false,
        label: 'Issuer',
        order: 200,
      },
      rows: {
        type: FIELD_TYPES.NUMBER,
        required: false,
        label: 'Number of Rows',
        defaultValue: 10,
        order: 300,
      },
      columns: {
        type: FIELD_TYPES.NUMBER,
        required: false,
        label: 'Number of Columns',
        defaultValue: 10,
        order: 400,
      },
      gridData: {
        type: FIELD_TYPES.GRID,
        required: true,
        label: 'Grid Codes',
        order: 500,
      },
    },
    displayFields: ['cardName', 'issuer'],
    copyableFields: [],
    searchFields: ['title', 'cardName', 'issuer'],
    specialActions: ['lookupCode'],
  },
};

// Utility functions
export const getEntryTypeDefinition = (entryType) => {
  return (
    ENTRY_TYPE_DEFINITIONS[entryType] ||
    ENTRY_TYPE_DEFINITIONS[ENTRY_TYPES.PASSWORD]
  );
};

export const getEntryTypeIcon = (entryType) => {
  const definition = getEntryTypeDefinition(entryType);
  return definition.icon;
};

export const getEntryTypeColor = (entryType) => {
  const definition = getEntryTypeDefinition(entryType);
  return definition.color;
};

export const getEntryTypeName = (entryType) => {
  const definition = getEntryTypeDefinition(entryType);
  return definition.name;
};

export const getEntryTypeSchema = (entryType) => {
  const definition = getEntryTypeDefinition(entryType);
  return definition.schema;
};

export const getDisplayFields = (entryType) => {
  const definition = getEntryTypeDefinition(entryType);
  return definition.displayFields || [];
};

export const getCopyableFields = (entryType) => {
  const definition = getEntryTypeDefinition(entryType);
  return definition.copyableFields || [];
};

export const getSearchFields = (entryType) => {
  const definition = getEntryTypeDefinition(entryType);
  // Default search fields that work for most entry types
  const defaultSearchFields = [
    'title',
    'username',
    'url',
    'name',
    'email',
    'notes',
  ];

  // If the entry type has specific search fields defined, use those
  if (definition && definition.searchFields) {
    return definition.searchFields;
  }

  // Otherwise, return a combination of default fields and any fields from the schema
  const schemaFields =
    definition && definition.schema
      ? Object.keys(definition.schema).filter(
          (key) => typeof definition.schema[key] !== 'function'
        )
      : [];

  // Combine and deduplicate fields
  return [...new Set([...defaultSearchFields, ...schemaFields])];
};

export const validateEntryByType = (entry, entryType) => {
  const schema = getEntryTypeSchema(entryType);
  const errors = {};

  Object.entries(schema).forEach(([fieldName, fieldConfig]) => {
    if (fieldConfig.required && fieldConfig.generated !== true) {
      const value = entry[fieldName];
      if (!value || (typeof value === 'string' && !value.trim())) {
        errors[fieldName] = `${fieldConfig.label} is required`;
      }
    }
  });

  return errors;
};

export const createEmptyEntry = (entryType) => {
  const schema = getEntryTypeSchema(entryType);
  const entry = { entryType };

  Object.entries(schema).forEach(([fieldName, fieldConfig]) => {
    if (fieldConfig.generated && fieldName === 'entryType') {
      entry[fieldName] = entryType;
    } else if (fieldConfig.defaultValue !== undefined) {
      entry[fieldName] = fieldConfig.defaultValue;
    } else if (fieldConfig.type === FIELD_TYPES.GRID) {
      // Initialize empty grid for level 3 cards
      entry[fieldName] = {};
    } else if (!fieldConfig.generated) {
      entry[fieldName] = '';
    }
  });

  return entry;
};

// Level 3 card specific utilities
export const generateGridPosition = (row, col) => {
  const rowLetter = String.fromCharCode(65 + row); // A, B, C, etc.
  return `${rowLetter}${col + 1}`;
};

export const parseGridPosition = (position) => {
  if (!position || position.length < 2) return null;

  const rowLetter = position.charAt(0).toUpperCase();
  const colNumber = parseInt(position.slice(1));

  if (rowLetter < 'A' || rowLetter > 'Z' || isNaN(colNumber) || colNumber < 1) {
    return null;
  }

  return {
    row: rowLetter.charCodeAt(0) - 65,
    col: colNumber - 1,
  };
};

export const getCodeAtPosition = (gridData, position) => {
  const parsed = parseGridPosition(position);
  if (!parsed || !gridData) return null;

  const key = generateGridPosition(parsed.row, parsed.col);
  return gridData[key] || null;
};

// Get fields in proper order for display
export const getOrderedFields = (entryType) => {
  const schema = getEntryTypeSchema(entryType);
  return Object.entries(schema)
    .filter(([fieldName, fieldConfig]) => !fieldConfig.generated)
    .sort(([, a], [, b]) => (a.order || 999) - (b.order || 999))
    .map(([fieldName, fieldConfig]) => ({ fieldName, fieldConfig }));
};
