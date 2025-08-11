// Unit tests for entry types utilities
import { vi } from 'vitest';

// Mock Material-UI icons
vi.mock('@mui/icons-material', () => ({
  Lock: () => 'PasswordIcon',
  Wifi: () => 'WifiIcon',
  Security: () => 'OTPIcon',
  VpnKey: () => 'SSHIcon',
  Key: () => 'GPGIcon',
  Note: () => 'NoteIcon',
  AccountBalance: () => 'BankIcon',
  CreditCard: () => 'CreditCardIcon',
  Grid3x3: () => 'Level3CardIcon',
}));

import {
  ENTRY_TYPES,
  ENTRY_TYPE_DEFINITIONS,
  FIELD_TYPES,
  getEntryTypeDefinition,
  getEntryTypeIcon,
  getEntryTypeColor,
  getEntryTypeName,
  getEntryTypeSchema,
  getDisplayFields,
  getCopyableFields,
  getSearchFields,
  validateEntryByType,
  createEmptyEntry,
  generateGridPosition,
  parseGridPosition,
  getCodeAtPosition,
  getOrderedFields,
} from '../../utils/entryTypes';

describe('Entry Types', () => {
  describe('Constants', () => {
    it('should have all required entry types', () => {
      expect(ENTRY_TYPES.PASSWORD).toBe('password');
      expect(ENTRY_TYPES.WIFI).toBe('wifi');
      expect(ENTRY_TYPES.OTP).toBe('otp');
      expect(ENTRY_TYPES.SSH_KEY).toBe('ssh_key');
      expect(ENTRY_TYPES.GPG_KEY).toBe('gpg_key');
      expect(ENTRY_TYPES.SECURE_NOTE).toBe('secure_note');
      expect(ENTRY_TYPES.BANK_ACCOUNT).toBe('bank_account');
      expect(ENTRY_TYPES.CREDIT_CARD).toBe('credit_card');
      expect(ENTRY_TYPES.LEVEL3_CARD).toBe('level3_card');
    });

    it('should have all field types', () => {
      expect(FIELD_TYPES.TEXT).toBe('text');
      expect(FIELD_TYPES.PASSWORD).toBe('password');
      expect(FIELD_TYPES.EMAIL).toBe('email');
      expect(FIELD_TYPES.URL).toBe('url');
      expect(FIELD_TYPES.TEXTAREA).toBe('textarea');
      expect(FIELD_TYPES.SELECT).toBe('select');
      expect(FIELD_TYPES.NUMBER).toBe('number');
      expect(FIELD_TYPES.DATE).toBe('date');
      expect(FIELD_TYPES.GRID).toBe('grid');
      expect(FIELD_TYPES.MULTILINE).toBe('multiline');
    });
  });

  describe('Entry Type Definitions', () => {
    it('should have definitions for all entry types', () => {
      Object.values(ENTRY_TYPES).forEach((entryType) => {
        expect(ENTRY_TYPE_DEFINITIONS[entryType]).toBeDefined();
        expect(ENTRY_TYPE_DEFINITIONS[entryType].name).toBeDefined();
        expect(ENTRY_TYPE_DEFINITIONS[entryType].icon).toBeDefined();
        expect(ENTRY_TYPE_DEFINITIONS[entryType].color).toBeDefined();
        expect(ENTRY_TYPE_DEFINITIONS[entryType].schema).toBeDefined();
      });
    });

    it('should have consistent schema structure', () => {
      Object.values(ENTRY_TYPE_DEFINITIONS).forEach((definition) => {
        expect(definition.schema.title).toBeDefined();
        expect(definition.schema.category).toBeDefined();
        expect(definition.schema.notes).toBeDefined();
        expect(definition.schema.entryType).toBeDefined();
      });
    });
  });

  describe('Utility Functions', () => {
    describe('getEntryTypeDefinition', () => {
      it('should return correct definition for valid entry type', () => {
        const def = getEntryTypeDefinition(ENTRY_TYPES.WIFI);
        expect(def.name).toBe('WiFi Password');
        expect(def.color).toBe('#4caf50');
      });

      it('should return password definition for invalid entry type', () => {
        const def = getEntryTypeDefinition('invalid');
        expect(def.name).toBe('Password');
      });
    });

    describe('getEntryTypeName', () => {
      it('should return correct name', () => {
        expect(getEntryTypeName(ENTRY_TYPES.OTP)).toBe('OTP/2FA');
        expect(getEntryTypeName(ENTRY_TYPES.SSH_KEY)).toBe('SSH Key');
      });
    });

    describe('getDisplayFields', () => {
      it('should return correct display fields for password entry', () => {
        const fields = getDisplayFields(ENTRY_TYPES.PASSWORD);
        expect(fields).toEqual(['username', 'url']);
      });

      it('should return correct display fields for wifi entry', () => {
        const fields = getDisplayFields(ENTRY_TYPES.WIFI);
        expect(fields).toEqual(['ssid', 'security']);
      });
    });

    describe('getCopyableFields', () => {
      it('should return correct copyable fields for credit card', () => {
        const fields = getCopyableFields(ENTRY_TYPES.CREDIT_CARD);
        expect(fields).toEqual(['cardNumber', 'cvv', 'pin']);
      });
    });

    describe('getSearchFields', () => {
      it('should return correct search fields for bank account', () => {
        const fields = getSearchFields(ENTRY_TYPES.BANK_ACCOUNT);
        expect(fields).toEqual(['title', 'bankName', 'accountHolder']);
      });
    });
  });

  describe('Validation', () => {
    describe('validateEntryByType', () => {
      it('should validate password entry correctly', () => {
        const validEntry = {
          title: 'Test',
          username: 'user',
          password: 'pass',
          category: 'general',
        };
        const errors = validateEntryByType(validEntry, ENTRY_TYPES.PASSWORD);
        expect(Object.keys(errors)).toHaveLength(0);
      });

      it('should return errors for missing required fields', () => {
        const invalidEntry = {
          title: '',
          username: '',
          password: '',
        };
        const errors = validateEntryByType(invalidEntry, ENTRY_TYPES.PASSWORD);
        expect(errors.title).toBeDefined();
        expect(errors.username).toBeDefined();
        expect(errors.password).toBeDefined();
      });

      it('should validate wifi entry correctly', () => {
        const validWifiEntry = {
          title: 'Home WiFi',
          ssid: 'MyNetwork',
          password: 'wifipass',
          security: 'WPA2',
          category: 'network',
        };
        const errors = validateEntryByType(validWifiEntry, ENTRY_TYPES.WIFI);
        expect(Object.keys(errors)).toHaveLength(0);
      });
    });
  });

  describe('Entry Creation', () => {
    describe('createEmptyEntry', () => {
      it('should create empty password entry with correct structure', () => {
        const entry = createEmptyEntry(ENTRY_TYPES.PASSWORD);
        expect(entry.entryType).toBe(ENTRY_TYPES.PASSWORD);
        expect(entry.title).toBe('');
        expect(entry.username).toBe('');
        expect(entry.password).toBe('');
        expect(entry.category).toBe('');
      });

      it('should create empty level3 card with grid data', () => {
        const entry = createEmptyEntry(ENTRY_TYPES.LEVEL3_CARD);
        expect(entry.entryType).toBe(ENTRY_TYPES.LEVEL3_CARD);
        expect(entry.gridData).toEqual({});
        expect(entry.rows).toBe(10);
        expect(entry.columns).toBe(10);
      });
    });
  });

  describe('Level 3 Card Utilities', () => {
    describe('generateGridPosition', () => {
      it('should generate correct position strings', () => {
        expect(generateGridPosition(0, 0)).toBe('A1');
        expect(generateGridPosition(1, 4)).toBe('B5');
        expect(generateGridPosition(25, 9)).toBe('Z10');
      });
    });

    describe('parseGridPosition', () => {
      it('should parse valid positions correctly', () => {
        expect(parseGridPosition('A1')).toEqual({ row: 0, col: 0 });
        expect(parseGridPosition('B5')).toEqual({ row: 1, col: 4 });
        expect(parseGridPosition('Z10')).toEqual({ row: 25, col: 9 });
      });

      it('should handle invalid positions', () => {
        expect(parseGridPosition('')).toBeNull();
        expect(parseGridPosition('1A')).toBeNull();
        expect(parseGridPosition('AA')).toBeNull();
        expect(parseGridPosition('A0')).toBeNull();
      });

      it('should be case insensitive', () => {
        expect(parseGridPosition('a1')).toEqual({ row: 0, col: 0 });
        expect(parseGridPosition('b5')).toEqual({ row: 1, col: 4 });
      });
    });

    describe('getCodeAtPosition', () => {
      const gridData = {
        A1: 'ABC123',
        B5: 'XYZ789',
        C3: 'DEF456',
      };

      it('should return correct code for valid position', () => {
        expect(getCodeAtPosition(gridData, 'A1')).toBe('ABC123');
        expect(getCodeAtPosition(gridData, 'B5')).toBe('XYZ789');
        expect(getCodeAtPosition(gridData, 'C3')).toBe('DEF456');
      });

      it('should return null for invalid position', () => {
        expect(getCodeAtPosition(gridData, 'D1')).toBeNull();
        expect(getCodeAtPosition(gridData, 'invalid')).toBeNull();
      });

      it('should handle empty grid data', () => {
        expect(getCodeAtPosition({}, 'A1')).toBeNull();
        expect(getCodeAtPosition(null, 'A1')).toBeNull();
      });
    });
  });

  describe('Field Ordering', () => {
    describe('getOrderedFields', () => {
      it('should return fields in correct order for password entry', () => {
        const fields = getOrderedFields(ENTRY_TYPES.PASSWORD);
        const fieldNames = fields.map((f) => f.fieldName);

        expect(fieldNames[0]).toBe('title');
        expect(fieldNames[fieldNames.length - 2]).toBe('category');
        expect(fieldNames[fieldNames.length - 1]).toBe('notes');
      });

      it('should exclude generated fields', () => {
        const fields = getOrderedFields(ENTRY_TYPES.PASSWORD);
        const fieldNames = fields.map((f) => f.fieldName);

        expect(fieldNames).not.toContain('id');
        expect(fieldNames).not.toContain('createdAt');
        expect(fieldNames).not.toContain('updatedAt');
        expect(fieldNames).not.toContain('entryType');
      });

      it('should include field configurations', () => {
        const fields = getOrderedFields(ENTRY_TYPES.PASSWORD);

        fields.forEach((field) => {
          expect(field).toHaveProperty('fieldName');
          expect(field).toHaveProperty('fieldConfig');
          expect(field.fieldConfig).toHaveProperty('type');
          expect(field.fieldConfig).toHaveProperty('label');
        });
      });

      it('should handle different entry types', () => {
        const wifiFields = getOrderedFields(ENTRY_TYPES.WIFI);
        const otpFields = getOrderedFields(ENTRY_TYPES.OTP);

        expect(wifiFields.some((f) => f.fieldName === 'ssid')).toBe(true);
        expect(otpFields.some((f) => f.fieldName === 'service')).toBe(true);
      });
    });
  });
});
