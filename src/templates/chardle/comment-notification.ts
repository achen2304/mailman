import { z } from 'zod';
import { escapeHtml, sanitizeEmailHeader } from '../../lib/headers.js';
import type { RenderContext, RenderedEmail } from '../index.js';

/** "Someone commented on your game" notification payload. */
export const commentNotificationDataSchema = z.strictObject({
  commenter: z.string().min(1),
  game: z.string().min(1),
  /** Path on the consumer app the deep link points to, e.g. "/play/my-show". */
  gamePath: z.string().startsWith('/'),
  comment: z.string().min(1),
});

export type CommentNotificationData = z.infer<typeof commentNotificationDataSchema>;

/**
 * Renders the comment-notification email. The "view" deep link is built from the
 * render context's app base URL plus the supplied game path; all user-supplied
 * text (commenter, game, comment) is HTML-escaped and the subject sanitised.
 */
export function renderCommentNotification(input: unknown, ctx: RenderContext): RenderedEmail {
  const data = commentNotificationDataSchema.parse(input);

  const subject = sanitizeEmailHeader(`New comment on ${data.game}`);
  const link = `${ctx.appBaseUrl}${data.gamePath}`;

  const html = [
    `<h2>New comment on ${escapeHtml(data.game)}</h2>`,
    `<p><strong>${escapeHtml(data.commenter)}</strong> commented:</p>`,
    `<blockquote style="white-space: pre-wrap;">${escapeHtml(data.comment)}</blockquote>`,
    `<p><a href="${escapeHtml(link)}">View on ${escapeHtml(data.game)}</a></p>`,
  ].join('\n');

  const text = [
    `New comment on ${data.game}`,
    '',
    `${data.commenter} commented:`,
    data.comment,
    '',
    `View: ${link}`,
  ].join('\n');

  return { subject, html, text };
}
