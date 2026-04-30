/**
 * Token Blacklist Entity Schema
 * 
 * Defines the structure for revoked JWT tokens stored in the token_blacklist table.
 * Tokens in this blacklist remain cryptographically valid but are explicitly rejected
 * by the authentication middleware.
 * 
 * Use cases:
 * - Role change enforcement (immediate token invalidation)
 * - Account deletion (prevent deleted user access)
 * - Forced logout (admin revocation)
 * - Manual token revocation
 */

import { z } from 'zod';

/**
 * Reasons for token revocation
 */
export const TokenRevocationReasonSchema = z.enum([
  'role_change',      // User roles were modified by admin
  'account_deleted',  // User account was deleted
  'forced_logout',    // Admin forced user logout
  'admin_revoked'     // Manual revocation by administrator
]);

export type TokenRevocationReason = z.infer<typeof TokenRevocationReasonSchema>;

/**
 * Token Blacklist Entry Schema (full entity)
 * 
 * Matches the token_blacklist database table structure
 */
export const TokenBlacklistEntrySchema = z.object({
  id: z.string().uuid().describe('Primary key — auto-generated UUID'),
  tenantId: z.string().uuid().describe('Tenant ID for multi-tenant isolation'),
  tokenJti: z
    .string()
    .max(64, { message: 'Token JTI must be 64 characters or less' })
    .describe('JWT ID claim from token payload'),
  userId: z.string().uuid().describe('User who owned the revoked token'),
  revokedAt: z.date().describe('Timestamp when token was added to blacklist'),
  expiresAt: z
    .date()
    .describe('Token expiration time (copied from JWT exp claim for cleanup)'),
  reason: TokenRevocationReasonSchema.optional().describe('Why token was revoked'),
  revokedBy: z.string().uuid().optional().describe('Admin user who revoked (if applicable)'),
});

export type TokenBlacklistEntry = z.infer<typeof TokenBlacklistEntrySchema>;

/**
 * Schema for creating a new blacklist entry
 * Excludes auto-generated fields (id, revokedAt)
 */
export const CreateTokenBlacklistEntrySchema = TokenBlacklistEntrySchema.omit({
  id: true,
  revokedAt: true
});

export type CreateTokenBlacklistEntry = z.infer<typeof CreateTokenBlacklistEntrySchema>;

/**
 * Schema for querying blacklist (minimal fields)
 */
export const TokenBlacklistQuerySchema = z.object({
  tenantId: z.string().uuid(),
  tokenJti: z.string().max(64)
});

export type TokenBlacklistQuery = z.infer<typeof TokenBlacklistQuerySchema>;

/**
 * Example blacklist entry:
 * {
 *   id: "c4e1f8a2-3d5b-4e6f-7a8b-9c0d1e2f3a4b",
 *   tenantId: "6eb9c106-b650-4398-b6fa-091b6828c4ba",
 *   tokenJti: "f7c3a8b2-4d1e-4f5a-9b2c-6e8d7f3a1c4b",
 *   userId: "a82a680c-0888-4f0c-96cc-9531d0b95373",
 *   revokedAt: new Date("2025-10-12T14:30:00Z"),
 *   expiresAt: new Date("2025-10-13T14:00:00Z"),
 *   reason: "role_change",
 *   revokedBy: "admin-user-uuid"
 * }
 */













