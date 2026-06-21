import { describe, it, expect } from '@jest/globals';
import { escapeHtml, sanitizeEmailHeader } from '../../src/lib/headers.js';

describe('escapeHtml', () => {
  it('neutralises a script-injection payload', () => {
    const escaped = escapeHtml('"><script>alert(1)</script>');
    expect(escaped).not.toContain('<');
    expect(escaped).not.toContain('>');
    expect(escaped).toContain('&lt;script&gt;');
  });

  it('escapes all five HTML-significant characters', () => {
    expect(escapeHtml(`& < > " '`)).toBe('&amp; &lt; &gt; &quot; &#39;');
  });

  it('leaves safe text untouched', () => {
    expect(escapeHtml('Hello, world 123')).toBe('Hello, world 123');
  });
});

describe('sanitizeEmailHeader', () => {
  it('removes CR/LF to block header injection', () => {
    const result = sanitizeEmailHeader('Subject\r\nBcc: evil@example.com');
    expect(result).not.toMatch(/[\r\n]/);
    expect(result).toBe('Subject Bcc: evil@example.com');
  });

  it('strips other control characters (NUL, TAB, DEL)', () => {
    // Built via fromCharCode so the source carries no raw control bytes.
    const input =
      'a' +
      String.fromCharCode(0) +
      'b' +
      String.fromCharCode(9) +
      'c' +
      String.fromCharCode(127) +
      'd';
    expect(sanitizeEmailHeader(input)).toBe('abcd');
  });

  it('collapses whitespace introduced by newlines and trims', () => {
    expect(sanitizeEmailHeader('  hello\n\n\nworld  ')).toBe('hello world');
  });

  it('leaves a clean subject unchanged', () => {
    expect(sanitizeEmailHeader('New comment on your game')).toBe('New comment on your game');
  });
});
