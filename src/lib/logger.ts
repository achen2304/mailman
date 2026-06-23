/**
 * Minimal structured logger + PII masking.
 *
 * Lambda routes stdout/stderr to CloudWatch, so this just emits one JSON line per
 * event (centralised so there are no stray `console.log`s scattered in logic).
 * Never log secrets, tokens, or full email addresses — use {@link maskEmail}.
 */

type LogMeta = Record<string, unknown>;

function emit(level: 'info' | 'warn' | 'error', message: string, meta?: LogMeta): void {
  const line = JSON.stringify({ level, message, ...(meta ?? {}) });
  if (level === 'error') {
    console.error(line);
  } else {
    console.log(line);
  }
}

export const logger = {
  info: (message: string, meta?: LogMeta): void => emit('info', message, meta),
  warn: (message: string, meta?: LogMeta): void => emit('warn', message, meta),
  error: (message: string, meta?: LogMeta): void => emit('error', message, meta),
};

/**
 * Masks an email for logging: keeps the first local char and the domain, e.g.
 * `user@example.com` -> `u***@example.com`. Returns `***` if there's no usable
 * local part.
 */
export function maskEmail(email: string): string {
  const at = email.indexOf('@');
  if (at <= 0) {
    return '***';
  }
  return `${email[0]}***${email.slice(at)}`;
}
