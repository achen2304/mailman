/**
 * HTML-escaping and email-header sanitisation.
 *
 * Written fresh for mailman (the legacy `send-email` route had neither and
 * interpolated user input straight into HTML). All user-supplied text must pass
 * through `escapeHtml` before landing in an HTML body, and any value placed in a
 * header (subject, names) through `sanitizeEmailHeader` to block header injection.
 */

const HTML_ENTITIES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

/**
 * Escapes the five HTML-significant characters so user input rendered in an email
 * body cannot inject markup or script.
 *
 * @param input untrusted text
 * @returns text safe to embed in HTML
 */
export function escapeHtml(input: string): string {
  // The character class only matches keys present in HTML_ENTITIES, so the
  // lookup is always defined — the assertion documents that invariant.
  return input.replace(/[&<>"']/g, (char) => HTML_ENTITIES[char]!);
}

const CR = 13;
const LF = 10;
const DEL = 127;
const FIRST_PRINTABLE = 32; // space

/**
 * Strips CR/LF and other control characters from a value destined for an email
 * header, preventing header/SMTP injection (e.g. a smuggled `\r\nBcc:` line).
 * CR/LF become a single space to preserve word boundaries; remaining C0/DEL
 * control characters are removed; runs of spaces are collapsed and trimmed.
 *
 * Implemented with a code-point scan rather than a control-char regex literal,
 * which keeps the source free of raw control bytes.
 *
 * @param input untrusted header value (e.g. a subject)
 * @returns a single-line value with no CR/LF or control characters
 */
export function sanitizeEmailHeader(input: string): string {
  let out = '';
  for (const char of input) {
    // `for…of` over a string yields non-empty single code points, so this is defined.
    const code = char.codePointAt(0)!;
    if (code === CR || code === LF) {
      out += ' ';
    } else if (code < FIRST_PRINTABLE || code === DEL) {
      continue;
    } else {
      out += char;
    }
  }
  return out.replace(/ +/g, ' ').trim();
}
