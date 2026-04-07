import { tokenize } from '../src/tokenizer.js';
import type { Token } from '../src/types.js';

function kinds(tokens: Token[]): string[] {
  return tokens.map((t) => t.kind);
}

function values(tokens: Token[]): string[] {
  return tokens.map((t) => t.value);
}

describe('Tokenizer', () => {
  test('tokenizza "workflow foo" → [KEYWORD(workflow), IDENTIFIER(foo), EOF]', () => {
    const tokens = tokenize('workflow foo');
    expect(kinds(tokens)).toEqual(['KEYWORD', 'IDENTIFIER', 'EOF']);
    expect(values(tokens)).toEqual(['workflow', 'foo', '']);
  });

  test('tokenizza "mode: adversarial" → [KEYWORD(mode), COLON, IDENTIFIER(adversarial)]', () => {
    const tokens = tokenize('mode: adversarial');
    expect(kinds(tokens)).toEqual(['KEYWORD', 'COLON', 'IDENTIFIER', 'EOF']);
    expect(values(tokens)[0]).toBe('mode');
    expect(values(tokens)[2]).toBe('adversarial');
  });

  test('tokenizza ref con operatore → corretto', () => {
    const tokens = tokenize('review.verdict == "approved"');
    expect(kinds(tokens)).toEqual(['IDENTIFIER', 'DOT', 'IDENTIFIER', 'OPERATOR', 'STRING', 'EOF']);
    expect(values(tokens)[0]).toBe('review');
    expect(values(tokens)[2]).toBe('verdict');
    expect(values(tokens)[3]).toBe('==');
    expect(values(tokens)[4]).toBe('approved');
  });

  test('gestisce commenti // correttamente (ignorati)', () => {
    const tokens = tokenize('workflow foo // this is a comment');
    expect(kinds(tokens)).toEqual(['KEYWORD', 'IDENTIFIER', 'EOF']);
  });

  test('gestisce commenti su riga intera (ignorati)', () => {
    const tokens = tokenize('// full line comment\nworkflow foo');
    expect(kinds(tokens)).toEqual(['KEYWORD', 'IDENTIFIER', 'EOF']);
  });

  test('gestisce indentazione: +2 spazi → INDENT, -2 spazi → DEDENT', () => {
    const source = 'workflow foo\n  description: "test"\n  version: "1.0"\nphase bar';
    const tokens = tokenize(source);
    const kindList = kinds(tokens);
    // workflow foo → KEYWORD IDENTIFIER
    // (indent) description: "test" → INDENT KEYWORD COLON STRING
    // version: "1.0" → NEWLINE KEYWORD COLON STRING
    // (dedent) phase bar → DEDENT KEYWORD IDENTIFIER
    expect(kindList).toContain('INDENT');
    expect(kindList).toContain('DEDENT');
    expect(kindList.indexOf('INDENT')).toBeLessThan(kindList.indexOf('DEDENT'));
  });

  test('"done when:" → [KEYWORD(done), KEYWORD(when), COLON]', () => {
    const tokens = tokenize('done when:');
    expect(kinds(tokens)).toEqual(['KEYWORD', 'KEYWORD', 'COLON', 'EOF']);
    expect(values(tokens)[0]).toBe('done');
    expect(values(tokens)[1]).toBe('when');
  });

  test('"true" → BOOL, "false" → BOOL', () => {
    const tokens = tokenize('true false');
    expect(kinds(tokens)).toEqual(['BOOL', 'BOOL', 'EOF']);
    expect(values(tokens)[0]).toBe('true');
    expect(values(tokens)[1]).toBe('false');
  });

  test('"0.85" → NUMBER', () => {
    const tokens = tokenize('0.85');
    expect(kinds(tokens)).toEqual(['NUMBER', 'EOF']);
    expect(values(tokens)[0]).toBe('0.85');
  });

  test('tokenizza lista inline [a, b, c]', () => {
    const tokens = tokenize('[a, b, c]');
    expect(kinds(tokens)).toEqual([
      'LBRACKET',
      'IDENTIFIER',
      'COMMA',
      'IDENTIFIER',
      'COMMA',
      'IDENTIFIER',
      'RBRACKET',
      'EOF',
    ]);
  });

  test('multi-level dedent', () => {
    const source = 'a\n  b\n    c\nd';
    const tokens = tokenize(source);
    const kindList = kinds(tokens);
    // a → IDENTIFIER
    // (indent) b → INDENT IDENTIFIER
    // (indent) c → INDENT IDENTIFIER
    // (dedent x2) d → DEDENT DEDENT IDENTIFIER
    const dedentCount = kindList.filter((k) => k === 'DEDENT').length;
    expect(dedentCount).toBe(2);
  });

  test('gestisce operatori != >= <=', () => {
    const tokens = tokenize('a != b >= c <= d');
    const ops = tokens.filter((t) => t.kind === 'OPERATOR').map((t) => t.value);
    expect(ops).toEqual(['!=', '>=', '<=']);
  });

  test('gestisce and/or/not come token speciali', () => {
    const tokens = tokenize('a and b or not c');
    expect(kinds(tokens)).toEqual([
      'IDENTIFIER',
      'AND',
      'IDENTIFIER',
      'OR',
      'NOT',
      'IDENTIFIER',
      'EOF',
    ]);
  });

  test('gestisce dash per list items', () => {
    const tokens = tokenize('- item');
    expect(kinds(tokens)).toEqual(['DASH', 'IDENTIFIER', 'EOF']);
  });
});
