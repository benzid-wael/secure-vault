// Unit tests for category manager utilities
import { vi } from 'vitest';

// Mock Material-UI icons
vi.mock('@mui/icons-material', () => ({
  Lock: () => 'GeneralIcon',
  Language: () => 'WebsiteIcon',
  Email: () => 'EmailIcon',
  Business: () => 'BusinessIcon',
  Work: () => 'WorkIcon',
  School: () => 'SchoolIcon',
  CreditCard: () => 'FinanceIcon',
  Games: () => 'GamingIcon',
  Cloud: () => 'CloudIcon',
  Smartphone: () => 'MobileIcon',
  Wifi: () => 'WifiIcon',
  Security: () => 'SecurityIcon',
  VpnKey: () => 'KeyIcon',
  Note: () => 'NoteIcon',
  AccountBalance: () => 'BankIcon',
  Grid3x3: () => 'GridIcon',
}));

import {
  CATEGORIES,
  getCategoryById,
  getCategoryIcon,
  getCategoryColor,
  getCategoryName,
  getDefaultCategory,
} from '../../utils/categoryManager';

describe('categoryManager', () => {
  describe('CATEGORIES constant', () => {
    it('should contain all expected categories', () => {
      expect(CATEGORIES).toHaveLength(16);

      const categoryIds = CATEGORIES.map((cat) => cat.id);
      expect(categoryIds).toEqual([
        'general',
        'website',
        'email',
        'business',
        'work',
        'school',
        'finance',
        'gaming',
        'cloud',
        'mobile',
        'network',
        'security',
        'keys',
        'notes',
        'banking',
        'cards',
      ]);
    });

    it('should have consistent structure for all categories', () => {
      CATEGORIES.forEach((category) => {
        expect(category).toHaveProperty('id');
        expect(category).toHaveProperty('name');
        expect(category).toHaveProperty('icon');
        expect(category).toHaveProperty('color');
        expect(typeof category.id).toBe('string');
        expect(typeof category.name).toBe('string');
        expect(typeof category.icon).toBe('function');
        expect(typeof category.color).toBe('string');
        expect(category.color).toMatch(/^#[0-9a-f]{6}$/i);
      });
    });

    it('should have unique category IDs', () => {
      const ids = CATEGORIES.map((cat) => cat.id);
      const uniqueIds = [...new Set(ids)];
      expect(ids).toHaveLength(uniqueIds.length);
    });
  });

  describe('getCategoryById', () => {
    it('should return correct category for valid ID', () => {
      const category = getCategoryById('email');
      expect(category).toEqual({
        id: 'email',
        name: 'Email',
        icon: expect.any(Function),
        color: '#f44336',
      });
    });

    it('should return general category for invalid ID', () => {
      const category = getCategoryById('nonexistent');
      expect(category).toEqual({
        id: 'general',
        name: 'General',
        icon: expect.any(Function),
        color: '#757575',
      });
    });

    it('should return general category for null ID', () => {
      const category = getCategoryById(null);
      expect(category.id).toBe('general');
    });

    it('should return general category for undefined ID', () => {
      const category = getCategoryById(undefined);
      expect(category.id).toBe('general');
    });

    it('should return all different categories correctly', () => {
      const expectedCategories = [
        { id: 'general', name: 'General', color: '#757575' },
        { id: 'website', name: 'Website', color: '#2196f3' },
        { id: 'email', name: 'Email', color: '#f44336' },
        { id: 'business', name: 'Business', color: '#ff9800' },
        { id: 'work', name: 'Work', color: '#9c27b0' },
        { id: 'school', name: 'School', color: '#4caf50' },
        { id: 'finance', name: 'Finance', color: '#795548' },
        { id: 'gaming', name: 'Gaming', color: '#e91e63' },
        { id: 'cloud', name: 'Cloud Service', color: '#00bcd4' },
        { id: 'mobile', name: 'Mobile App', color: '#607d8b' },
      ];

      expectedCategories.forEach((expected) => {
        const category = getCategoryById(expected.id);
        expect(category.id).toBe(expected.id);
        expect(category.name).toBe(expected.name);
        expect(category.color).toBe(expected.color);
      });
    });
  });

  describe('getCategoryIcon', () => {
    it('should return icon function for valid category', () => {
      const icon = getCategoryIcon('email');
      expect(typeof icon).toBe('function');
    });

    it('should return general icon for invalid category', () => {
      const icon = getCategoryIcon('nonexistent');
      const generalIcon = getCategoryIcon('general');
      expect(icon).toBe(generalIcon);
    });
  });

  describe('getCategoryColor', () => {
    it('should return correct color for valid category', () => {
      expect(getCategoryColor('email')).toBe('#f44336');
      expect(getCategoryColor('website')).toBe('#2196f3');
      expect(getCategoryColor('work')).toBe('#9c27b0');
    });

    it('should return general color for invalid category', () => {
      expect(getCategoryColor('nonexistent')).toBe('#757575');
    });

    it('should return valid hex color format', () => {
      CATEGORIES.forEach((category) => {
        const color = getCategoryColor(category.id);
        expect(color).toMatch(/^#[0-9a-f]{6}$/i);
      });
    });
  });

  describe('getCategoryName', () => {
    it('should return correct name for valid category', () => {
      expect(getCategoryName('email')).toBe('Email');
      expect(getCategoryName('website')).toBe('Website');
      expect(getCategoryName('cloud')).toBe('Cloud Service');
      expect(getCategoryName('mobile')).toBe('Mobile App');
    });

    it('should return general name for invalid category', () => {
      expect(getCategoryName('nonexistent')).toBe('General');
    });

    it('should return string for all categories', () => {
      CATEGORIES.forEach((category) => {
        const name = getCategoryName(category.id);
        expect(typeof name).toBe('string');
        expect(name.length).toBeGreaterThan(0);
      });
    });
  });

  describe('getDefaultCategory', () => {
    it('should return general category', () => {
      const defaultCategory = getDefaultCategory();
      expect(defaultCategory).toEqual({
        id: 'general',
        name: 'General',
        icon: expect.any(Function),
        color: '#757575',
      });
    });

    it('should return same category on multiple calls', () => {
      const category1 = getDefaultCategory();
      const category2 = getDefaultCategory();
      expect(category1).toEqual(category2);
    });

    it('should return first category from CATEGORIES array', () => {
      const defaultCategory = getDefaultCategory();
      const firstCategory = CATEGORIES[0];
      expect(defaultCategory).toEqual(firstCategory);
    });
  });
});
