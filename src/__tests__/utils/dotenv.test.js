import { describe, it, expect } from 'vitest';
import { dotenvChanges, parseDotenv, toDotenv } from '../../utils/dotenv.js';

describe('parseDotenv', () => {
  it('reads the common forms: export, spaces around =, CRLF, inline comments', () => {
    const { vars, warnings } = parseDotenv(
      'export A=1\r\nB = two words  # note\r\nC=a#b\r\nD=\r\nE= " padded "\r\n'
    );
    expect(vars).toEqual({
      A: '1',
      B: 'two words',
      C: 'a#b',
      D: '',
      E: ' padded ',
    });
    expect(warnings).toEqual([]);
  });

  it('decodes double quotes, keeps single and backtick quotes literal', () => {
    const { vars } = parseDotenv(
      'D="a\\nb \\"q\\" \\\\ \\x"\nS=\'a\\nb\'\nT=`it\'s "x"`'
    );
    expect(vars).toEqual({ D: 'a\nb "q" \\ \\x', S: 'a\\nb', T: 'it\'s "x"' });
  });

  it('reads quoted values that span lines', () => {
    const { vars } = parseDotenv(
      'KEY="-----BEGIN-----\nMIIB\n-----END-----"\nNEXT=1\nS=\'x\ny\''
    );
    expect(vars).toEqual({
      KEY: '-----BEGIN-----\nMIIB\n-----END-----',
      NEXT: '1',
      S: 'x\ny',
    });
  });

  it('keeps the # lines directly above a key, and an inline one, as its comment', () => {
    const { comments } = parseDotenv(
      '# Section header\n\n# Line one\n# Line two\nA=1 # inline\nB=2\n#\nC="x" # after quote\n'
    );
    expect(comments).toEqual({
      A: 'Line one\nLine two\ninline',
      C: 'after quote',
    });
  });

  it('warns, with line numbers and no values, for every skipped line', () => {
    const { vars, warnings } = parseDotenv(
      'GOOD=1\nnot an assignment\n1BAD=secret-1\nDOT.KEY=x\nOPEN="never closed\nGOOD=2\nTAIL="x" junk\n'
    );
    expect(vars).toEqual({ GOOD: '2' });
    expect(warnings.map((w) => w.line)).toEqual([2, 3, 4, 5, 6, 7]);
    expect(warnings[4].message).toBe(
      'GOOD is also on line 1; this later one wins'
    );
    expect(JSON.stringify(warnings)).not.toMatch(/secret-1|never closed|junk/);
  });

  it('round-trips toDotenv, comments included', () => {
    const vars = {
      PLAIN: 'v',
      HASH: 'a # b',
      MULTI: 'l1\nl2',
      QUOTES: `it's "q"`,
      PAD: ' p ',
      EMPTY: '',
    };
    const comments = { PLAIN: 'first\nsecond', MULTI: 'pem' };
    const parsed = parseDotenv(toDotenv(vars, { comments }));
    expect(parsed.vars).toEqual(vars);
    expect(parsed.comments).toEqual(comments);
    expect(parsed.warnings).toEqual([]);
  });

  it('writes no comment lines unless asked', () => {
    expect(toDotenv({ A: '1' })).toBe('A=1\n');
    expect(toDotenv({ A: '1' }, { comments: { A: 'x\n\ny' } })).toBe(
      '# x\n#\n# y\nA=1\n'
    );
  });
});

describe('dotenvChanges (bulk edit)', () => {
  const before = '# Primary\nDB=postgres://a\nTOKEN=t\nKEEP=same\n';

  it('emits nothing for untouched text, even reformatted', () => {
    expect(dotenvChanges(before, before).ops).toEqual([]);
    expect(
      dotenvChanges(
        before,
        '# Primary\nDB = "postgres://a"\n\nTOKEN=t\nKEEP=same'
      ).ops
    ).toEqual([]);
  });

  it('sets changed and new keys, removes dropped ones, carries comment edits', () => {
    const after =
      '# Replica now\nDB=postgres://b\nKEEP=same\n# brand new\nNEW=1\n';
    expect(dotenvChanges(before, after).ops).toEqual([
      { op: 'set', key: 'DB', value: 'postgres://b', comment: 'Replica now' },
      { op: 'set', key: 'NEW', value: '1', comment: 'brand new' },
      { op: 'rm', key: 'TOKEN' },
    ]);
  });

  it('sends a comment-only change with the unchanged value; clearing it sends ""', () => {
    expect(
      dotenvChanges(before, 'DB=postgres://a\nTOKEN=t\nKEEP=same').ops
    ).toEqual([{ op: 'set', key: 'DB', value: 'postgres://a', comment: '' }]);
  });

  it('returns the warnings of the edited text', () => {
    expect(dotenvChanges(before, before + 'oops\n').warnings).toEqual([
      { line: 5, message: 'Not KEY=value; skipped' },
    ]);
  });
});
