// @vitest-environment node
import { describe, it, expect } from 'vitest';

import {
  renderTemplate,
  templateKeys,
  FILTERS,
} from '../../utils/templating.js';

describe('renderTemplate — substitution', () => {
  it('substitutes bare {{KEY}} placeholders', () => {
    expect(
      renderTemplate('API_URL = {{API_URL}}', { API_URL: 'https://x' })
    ).toBe('API_URL = https://x');
  });

  it('tolerates whitespace inside the delimiters', () => {
    expect(renderTemplate('{{  KEY  }}', { KEY: 'v' })).toBe('v');
  });

  it('substitutes multiple and repeated keys', () => {
    const out = renderTemplate('{{A}}-{{B}}-{{A}}', { A: '1', B: '2' });
    expect(out).toBe('1-2-1');
  });

  it('coerces non-string and null/undefined values', () => {
    expect(renderTemplate('{{N}}', { N: 42 })).toBe('42');
    expect(renderTemplate('{{Z}}', { Z: null })).toBe('');
    expect(renderTemplate('{{U}}', { U: undefined })).toBe('');
  });

  it('renders an empty-string value (present key) without error', () => {
    expect(renderTemplate('[{{K}}]', { K: '' })).toBe('[]');
  });
});

describe('renderTemplate — format-agnostic safety', () => {
  it("leaves the target format's own $() and ${} tokens untouched", () => {
    const tpl = 'FRAMEWORK_SEARCH_PATHS = $(inherited) {{DIR}} ${OTHER}';
    expect(renderTemplate(tpl, { DIR: '/libs' })).toBe(
      'FRAMEWORK_SEARCH_PATHS = $(inherited) /libs ${OTHER}'
    );
  });

  it('does not treat namespaced value-refs like {{env:self/X}} as placeholders', () => {
    const tpl = 'raw {{env:self/API_URL}} literal';
    expect(renderTemplate(tpl, { API_URL: 'x' })).toBe(tpl);
  });

  it('is single-pass: a substituted value containing a placeholder is not re-expanded', () => {
    const out = renderTemplate('{{A}}', { A: '{{B}}', B: 'secret' });
    expect(out).toBe('{{B}}');
  });
});

describe('renderTemplate — errors', () => {
  it('throws on an undefined variable (no silent empty substitution)', () => {
    expect(() => renderTemplate('{{MISSING}}', {})).toThrow(
      /undefined variable "MISSING"/
    );
  });

  it('throws on an unknown filter', () => {
    expect(() => renderTemplate('{{K | nope}}', { K: 'v' })).toThrow(
      /Unknown template filter "nope"/
    );
  });

  it('throws when template is not a string', () => {
    expect(() => renderTemplate(null, {})).toThrow(TypeError);
  });
});

describe('renderTemplate — filters', () => {
  it('json escapes for embedding inside a JSON string (no wrapping quotes)', () => {
    const out = renderTemplate('"k": "{{V | json}}"', { V: 'a"b\nc' });
    expect(out).toBe('"k": "a\\"b\\nc"');
    // the whole thing parses as JSON
    expect(JSON.parse(`{${out}}`)).toEqual({ k: 'a"b\nc' });
  });

  it('xml escapes the five predefined entities, & first', () => {
    expect(renderTemplate('{{V | xml}}', { V: `a&<>"'b` })).toBe(
      'a&amp;&lt;&gt;&quot;&apos;b'
    );
  });

  it('base64 encodes UTF-8 bytes', () => {
    const out = renderTemplate('{{V | base64}}', { V: 'hello' });
    expect(out).toBe('aGVsbG8=');
    expect(Buffer.from(out, 'base64').toString('utf-8')).toBe('hello');
  });

  it('honors a custom filter registry', () => {
    const out = renderTemplate(
      '{{V | shout}}',
      { V: 'hi' },
      { filters: { shout: (s) => s.toUpperCase() } }
    );
    expect(out).toBe('HI');
  });

  it('exposes the built-in filters', () => {
    expect(Object.keys(FILTERS).sort()).toEqual(['base64', 'json', 'xml']);
  });
});

describe('templateKeys', () => {
  it('returns distinct keys in first-seen order', () => {
    expect(templateKeys('{{B}} {{A}} {{B}} {{C | json}}')).toEqual([
      'B',
      'A',
      'C',
    ]);
  });

  it('ignores non-placeholder {{...}} tokens', () => {
    expect(templateKeys('{{env:self/X}} {{ VALID }}')).toEqual(['VALID']);
  });

  it('returns an empty array when there are no placeholders', () => {
    expect(templateKeys('no placeholders here')).toEqual([]);
  });
});
