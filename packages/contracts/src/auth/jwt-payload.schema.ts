/**
 * JWT Payload Schema
 * 
 * Defines the structure of JWT tokens used for authentication.
 * Includes both standard JWT claims (iss, aud, sub, iat, exp, jti) 
 * and custom claims (userId, tenantId, tenantSlug, roles) for EcoleDigitale.
 */

import { z } from 'zod';

/**
 * JWT Payload Schema
 * 
 * Standard Claims:
 * - iss: Issuer - always "ecoledigitale"
 * - aud: Audience - tenant slug (e.g., "imhotepacademy")
 * - sub: Subject - user ID (UUID)
 * - iat: Issued At - Unix timestamp
 * - exp: Expiration - Unix timestamp (iat + 24 hours)
 * - jti: JWT ID - Unique token identifier (UUID)
 * 
 * Custom Claims:
 * - userId: User ID (duplicates sub for clarity)
 * - tenantId: Tenant UUID
 * - tenantSlug: Tenant slug (duplicates aud for clarity)
 * - roles: Array of available user roles
 * - activeRole: Currently active role for strict permission enforcement
 */
export const JWTPayloadSchema = z.object({
  // Standard JWT claims
  iss: z.literal('ecoledigitale').describe('Issuer — always "ecoledigitale"'),
  aud: z.string().describe('Audience — tenant slug'),
  sub: z.string().uuid().describe('Subject — user ID'),
  iat: z.number().int().positive().describe('Issued At — Unix timestamp'),
  exp: z.number().int().positive().describe('Expiration — Unix timestamp'),
  jti: z
    .string()
    .uuid()
    .describe('JWT ID — unique token identifier for blacklist lookup'),

  // Custom claims (EcoleDigitale-specific)
  userId: z
    .string()
    .uuid()
    .describe('User ID — duplicates sub for application convenience'),
  scope: z.enum(['tenant_user']).default('tenant_user'),
  tenantId: z
    .string()
    .uuid()
    .describe('Tenant UUID — used for tenant isolation validation'),
  tenantSlug: z.string().describe('Tenant slug — duplicates aud for application convenience'),
  roles: z.array(z.string()).min(1, 'User must have at least one role'),
  activeRole: z.string().min(1).describe('Active role used to evaluate permissions'),
});

/**
 * TypeScript type for JWT Payload
 */
export type JWTPayload = z.infer<typeof JWTPayloadSchema>;

/**
 * Example JWT Payload:
 * {
 *   iss: "ecoledigitale",
 *   aud: "imhotepacademy",
 *   sub: "a82a680c-0888-4f0c-96cc-9531d0b95373",
 *   iat: 1697097600,
 *   exp: 1697184000,
 *   jti: "f7c3a8b2-4d1e-4f5a-9b2c-6e8d7f3a1c4b",
 *   userId: "a82a680c-0888-4f0c-96cc-9531d0b95373",
 *   tenantId: "6eb9c106-b650-4398-b6fa-091b6828c4ba",
 *   tenantSlug: "imhotepacademy",
 *   roles: ["student"]
 * }
 */












