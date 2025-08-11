// Working unit tests for Vitest setup
import { describe, it, expect, vi, beforeEach } from 'vitest';

describe('Basic Vitest Setup', () => {
  it('should pass basic math test', () => {
    expect(1 + 1).toBe(2);
  });

  it('should work with vi mocking', () => {
    const mockFn = vi.fn();
    mockFn('test');
    expect(mockFn).toHaveBeenCalledWith('test');
  });
});

describe('Password Validation Logic', () => {
  const getPasswordStrength = (password) => {
    if (!password || password.length < 8) {
      return { strength: 'weak', color: '#f44336', width: '25%' };
    }
    
    let score = 0;
    if (password.length >= 8) score++;
    if (/[A-Z]/.test(password)) score++;
    if (/[a-z]/.test(password)) score++;
    if (/[0-9]/.test(password)) score++;
    if (/[^A-Za-z0-9]/.test(password)) score++;
    
    if (score >= 4) {
      return { strength: 'strong', color: '#4caf50', width: '100%' };
    } else if (score >= 3) {
      return { strength: 'good', color: '#2196f3', width: '75%' };
    } else if (score >= 2) {
      return { strength: 'fair', color: '#ff9800', width: '50%' };
    } else {
      return { strength: 'weak', color: '#f44336', width: '25%' };
    }
  };

  it('should return weak for empty password', () => {
    const result = getPasswordStrength('');
    expect(result.strength).toBe('weak');
    expect(result.color).toBe('#f44336');
  });

  it('should return strong for complex password', () => {
    const result = getPasswordStrength('MySecure123!');
    expect(result.strength).toBe('strong');
    expect(result.color).toBe('#4caf50');
  });

  it('should return good for basic password', () => {
    const result = getPasswordStrength('password123');
    expect(result.strength).toBe('good');
  });
});

describe('Category Management Logic', () => {
  const categories = [
    { id: 'general', name: 'General', color: '#757575' },
    { id: 'email', name: 'Email', color: '#f44336' },
    { id: 'work', name: 'Work', color: '#9c27b0' }
  ];

  const getCategoryById = (id) => {
    return categories.find(cat => cat.id === id) || categories[0];
  };

  it('should return correct category by ID', () => {
    const emailCategory = getCategoryById('email');
    expect(emailCategory.name).toBe('Email');
    expect(emailCategory.color).toBe('#f44336');
  });

  it('should return default category for invalid ID', () => {
    const defaultCategory = getCategoryById('nonexistent');
    expect(defaultCategory.id).toBe('general');
  });
});

describe('Password Generator Logic', () => {
  const generateSimplePassword = (length = 12) => {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*';
    let result = '';
    for (let i = 0; i < length; i++) {
      result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
  };

  it('should generate password of correct length', () => {
    const password = generateSimplePassword(12);
    expect(password).toHaveLength(12);
    expect(typeof password).toBe('string');
  });

  it('should generate different passwords', () => {
    const password1 = generateSimplePassword(16);
    const password2 = generateSimplePassword(16);
    expect(password1).not.toBe(password2);
  });
});

describe('Search and Filter Logic', () => {
  const testEntries = [
    { id: '1', title: 'Gmail Account', username: 'user@gmail.com', category: 'email' },
    { id: '2', title: 'Facebook', username: 'john.doe', category: 'website' },
    { id: '3', title: 'Work Database', username: 'admin', category: 'work' }
  ];

  const filterEntries = (entries, searchTerm, category) => {
    return entries.filter(entry => {
      const matchesSearch = !searchTerm || 
        entry.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
        entry.username.toLowerCase().includes(searchTerm.toLowerCase());
      
      const matchesCategory = !category || entry.category === category;
      
      return matchesSearch && matchesCategory;
    });
  };

  it('should filter entries by search term', () => {
    const filtered = filterEntries(testEntries, 'gmail', '');
    expect(filtered).toHaveLength(1);
    expect(filtered[0].title).toBe('Gmail Account');
  });

  it('should filter entries by category', () => {
    const filtered = filterEntries(testEntries, '', 'work');
    expect(filtered).toHaveLength(1);
    expect(filtered[0].title).toBe('Work Database');
  });

  it('should return all entries when no filters applied', () => {
    const filtered = filterEntries(testEntries, '', '');
    expect(filtered).toHaveLength(3);
  });
});
