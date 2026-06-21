import { z } from 'zod';
import { escapeHtml, sanitizeEmailHeader } from '../../lib/headers.js';
import type { RenderContext, RenderedEmail } from '../index.js';

/** Contact-form submission payload. */
export const contactDataSchema = z.strictObject({
  email: z.email(),
  subject: z.string().min(1),
  message: z.string().min(1),
});

export type ContactData = z.infer<typeof contactDataSchema>;

/**
 * Renders the contact-form email. All user fields are HTML-escaped in the body
 * and the subject is header-sanitised.
 */
export function renderContact(input: unknown, _ctx: RenderContext): RenderedEmail {
  const data = contactDataSchema.parse(input);

  const subject = sanitizeEmailHeader(`New contact form: ${data.subject}`);

  const html = [
    '<h2>New contact form submission</h2>',
    `<p><strong>From:</strong> ${escapeHtml(data.email)}</p>`,
    `<p><strong>Subject:</strong> ${escapeHtml(data.subject)}</p>`,
    '<p><strong>Message:</strong></p>',
    `<p style="white-space: pre-wrap;">${escapeHtml(data.message)}</p>`,
  ].join('\n');

  const text = [
    'New contact form submission',
    `From: ${data.email}`,
    `Subject: ${data.subject}`,
    '',
    data.message,
  ].join('\n');

  return { subject, html, text };
}
