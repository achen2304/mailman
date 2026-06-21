import { z } from 'zod';

/**
 * The `/v1/send` request schema — the single source of truth for the caller-facing
 * contract. TS types are inferred from it (`SendRequest`), and the JSON Schema in
 * `contracts/send.schema.json` is generated from it, so callers (the comments
 * feature, the contact form) have one authoritative shape to code against.
 */

/** Templates the service can render. Extend here as new ones are added. */
export const TEMPLATES = ['comment-notification', 'contact'] as const;
export type TemplateName = (typeof TEMPLATES)[number];

/**
 * Recipient: exactly one of `email` or `userId`. Modelled as a union of two
 * strict objects, so supplying both (or neither) fails validation — this is how
 * the "email XOR userId" rule is enforced structurally. `userId` only resolves to
 * an address when a RecipientResolver adapter is configured (else the route 400s).
 */
const recipientByEmail = z.strictObject({ email: z.email() });
const recipientByUserId = z.strictObject({ userId: z.uuid() });

export const sendRequestSchema = z.strictObject({
  template: z.enum(TEMPLATES),
  to: z.union([recipientByEmail, recipientByUserId]),
  // Template-specific fields. The shape per template is validated at render time
  // (see templates/*); here we only require a non-empty object. Oversized bodies
  // are bounded by the API Gateway/body-size limit, not by zod.
  data: z
    .record(z.string(), z.unknown())
    .refine((value) => Object.keys(value).length > 0, { error: 'data must not be empty' }),
  unsubscribeGroup: z.string().min(1).optional(),
});

export type SendRequest = z.infer<typeof sendRequestSchema>;

/**
 * JSON Schema representation of the request, generated from the zod schema via
 * zod 4's native `toJSONSchema`. Written to `contracts/send.schema.json` by
 * `npm run contract:generate` and drift-checked in tests.
 */
export function buildSendRequestJsonSchema(): Record<string, unknown> {
  return z.toJSONSchema(sendRequestSchema) as Record<string, unknown>;
}
