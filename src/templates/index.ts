import type { TemplateName } from '../routes/send.schema.js';
import { renderContact } from './chardle/contact.js';
import { renderCommentNotification } from './chardle/comment-notification.js';

/**
 * Template registry: `render(name, data, ctx) -> {subject, html, text}`.
 *
 * Each template owns a zod schema for its `data` and validates it at render time
 * (throwing a ZodError the route maps to 400). Templates are pure — they take
 * data + a render context and return strings; no AWS, config, or framework imports.
 */

/** Ambient values a template may need that aren't part of the request `data`. */
export interface RenderContext {
  /** Consumer origin used to build deep links (from config `app-base-url`). */
  appBaseUrl: string;
}

/** The rendered email parts. Headers (List-Unsubscribe etc.) are added downstream. */
export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
}

export type TemplateRenderer = (data: unknown, ctx: RenderContext) => RenderedEmail;

// Keyed by TemplateName, so adding a value to the TEMPLATES enum without a
// renderer here is a compile error — the registry can never drift from the schema.
const REGISTRY: Record<TemplateName, TemplateRenderer> = {
  contact: renderContact,
  'comment-notification': renderCommentNotification,
};

/**
 * Renders a template by name. Throws if `data` does not match the template's schema.
 *
 * @param name a valid template name (already validated by the request schema)
 * @param data the template-specific payload (validated here)
 * @param ctx ambient render context (e.g. app base URL)
 */
export function render(name: TemplateName, data: unknown, ctx: RenderContext): RenderedEmail {
  return REGISTRY[name](data, ctx);
}
