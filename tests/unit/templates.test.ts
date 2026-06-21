import { describe, it, expect } from '@jest/globals';
import { render, type RenderContext } from '../../src/templates/index.js';

const ctx: RenderContext = { appBaseUrl: 'https://app.example.test' };

const validData = {
  contact: { email: 'sender@example.com', subject: 'Hello', message: 'A message' },
  'comment-notification': {
    commenter: 'Ada',
    game: 'My Show',
    gamePath: '/play/my-show',
    comment: 'Nice game!',
  },
} as const;

describe('template rendering', () => {
  it.each(['contact', 'comment-notification'] as const)(
    '%s renders non-empty subject/html/text with a CR/LF-free subject',
    (name) => {
      const out = render(name, validData[name], ctx);
      expect(out.subject.length).toBeGreaterThan(0);
      expect(out.html.length).toBeGreaterThan(0);
      expect(out.text.length).toBeGreaterThan(0);
      expect(out.subject).not.toMatch(/[\r\n]/);
    }
  );

  it('HTML-escapes user data (XSS payload stays inert)', () => {
    const out = render(
      'comment-notification',
      { ...validData['comment-notification'], comment: '"><script>alert(1)</script>' },
      ctx
    );
    expect(out.html).not.toContain('<script>');
    expect(out.html).toContain('&lt;script&gt;');
  });

  it('keeps the subject CR/LF-free even when data tries to inject a header', () => {
    const out = render(
      'contact',
      { ...validData.contact, subject: 'X\r\nBcc: evil@example.com' },
      ctx
    );
    expect(out.subject).not.toMatch(/[\r\n]/);
  });

  it('builds a well-formed deep link from appBaseUrl + gamePath', () => {
    const out = render('comment-notification', validData['comment-notification'], ctx);
    expect(out.html).toContain('https://app.example.test/play/my-show');
    expect(out.text).toContain('https://app.example.test/play/my-show');
  });

  it('throws on data that does not match the template schema', () => {
    expect(() => render('contact', {}, ctx)).toThrow();
    expect(() => render('comment-notification', { commenter: 'x' }, ctx)).toThrow();
  });

  it('rejects a gamePath that is not an absolute path', () => {
    expect(() =>
      render(
        'comment-notification',
        { ...validData['comment-notification'], gamePath: 'play/my-show' },
        ctx
      )
    ).toThrow();
  });
});
