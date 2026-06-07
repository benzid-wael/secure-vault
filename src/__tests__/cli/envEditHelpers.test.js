// @vitest-environment node
import { describe, it, expect } from 'vitest';

import {
  resolveEditor,
  buildEditorTemplate,
  parseEditorContent,
} from '../../../bin/commands/envEditHelpers.js';

describe('resolveEditor', () => {
  it('prefers $VISUAL over $EDITOR', () => {
    const { cmd, args } = resolveEditor({ VISUAL: 'nano', EDITOR: 'vim' });
    expect(cmd).toBe('nano');
    expect(args).toEqual([]);
  });

  it('falls back to $EDITOR, then vi', () => {
    expect(resolveEditor({ EDITOR: 'vim' }).cmd).toBe('vim');
    expect(resolveEditor({}).cmd).toBe('vi');
  });

  it('splits editor values that include arguments', () => {
    const { cmd, args } = resolveEditor({ EDITOR: 'code --wait' });
    expect(cmd).toBe('code');
    expect(args).toEqual(['--wait']);
  });
});

describe('buildEditorTemplate', () => {
  it('shows the previous value as comments', () => {
    const template = buildEditorTemplate('KIBANA_USER', 'default', 'kibana');

    expect(template).toContain(
      '# Set value for KIBANA_USER (environment "default").'
    );
    expect(template).toContain('# Previous value:');
    expect(template).toContain('# kibana');
    // Ends with a blank line for the user to type the new value on.
    expect(template.endsWith('\n')).toBe(true);
  });

  it('comments every line of a multi-line previous value', () => {
    const template = buildEditorTemplate('CERT', 'prod', 'line1\nline2');
    expect(template).toContain('# line1');
    expect(template).toContain('# line2');
  });

  it('says so when there is no previous value', () => {
    const template = buildEditorTemplate('NEW_KEY', 'default', undefined);
    expect(template).toContain('# No previous value.');
    expect(template).not.toContain('# Previous value:');
  });

  it('round-trips: an unedited template parses to null (abort)', () => {
    const template = buildEditorTemplate('KIBANA_USER', 'default', 'old');
    expect(parseEditorContent(template)).toBeNull();
  });
});

describe('parseEditorContent', () => {
  it('drops comment lines and surrounding blank lines', () => {
    const value = parseEditorContent('# Previous value:\n# old\n\nnew-value\n');
    expect(value).toBe('new-value');
  });

  it('preserves interior newlines for multi-line values', () => {
    const value = parseEditorContent('# header\nline1\nline2\n\n');
    expect(value).toBe('line1\nline2');
  });

  it('handles CRLF line endings', () => {
    expect(parseEditorContent('# c\r\nvalue\r\n')).toBe('value');
  });

  it('returns null for empty or comment-only content', () => {
    expect(parseEditorContent('')).toBeNull();
    expect(parseEditorContent('# only comments\n#\n')).toBeNull();
    expect(parseEditorContent('\n  \n')).toBeNull();
  });
});
