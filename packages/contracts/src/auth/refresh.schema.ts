/**
 * Token Refresh Request/Response Schemas
 * 
 * Defines the contract for the POST /api/v1/auth/refresh endpoint
 * which issues new JWT tokens with extended expiration for active users.
 */

import { z } from 'zod';

/**
 * Token Refresh Request Schema
 * 
 * Note: The actual token is extracted from the Authorization header,
 * not from the request body. This schema exists for completeness
 * but the request body is typically empty.
 */
export const TokenRefreshRequestSchema = z.object({}).optional();

export type TokenRefreshRequest = z.infer<typeof TokenRefreshRequestSchema>;

/**
 * Token Refresh Response Schema
 * 
 * Returned when token is successfully refreshed with new expiration
 */
export const TokenRefreshResponseSchema = z.object({
  token: z.string().describe('New JWT token with extended expiration (24 hours from refresh)'),

  expiresAt: z
    .string()
    .datetime()
    .describe('ISO 8601 timestamp when new token expires'),
});

export type TokenRefreshResponse = z.infer<typeof TokenRefreshResponseSchema>;

/**
 * Token Refresh Error Schema
 * 
 * Returned when refresh fails (token invalid, expired, or blacklisted)
 */
export const TokenRefreshErrorSchema = z.object({
  error: z.string(),
  message: z.string(),
  code: z.string().optional().describe('Error code: TOKEN_EXPIRED, TOKEN_INVALID, TOKEN_REVOKED'),
});

export type TokenRefreshError = z.infer<typeof TokenRefreshErrorSchema>;

/**
 * Example refresh request:
 * POST /api/v1/auth/refresh
 * Headers:
 *   Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
 *   X-Tenant: imhotepacademy
 * Body: {} (empty)
 * 
 * Example refresh response (success):
 * {
 *   token: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.NEW_TOKEN...",
 *   expiresAt: "2025-10-14T12:00:00.000Z"
 * }
 * 
 * Example refresh response (error - token expired):
 * {
 *   error: "Token Expired",
 *   message: "Token expired",
 *   code: "TOKEN_EXPIRED"
 * }
 * 
 * Example refresh response (error - token revoked):
 * {
 *   error: "Token Revoked",
 *   message: "Token has been revoked",
 *   code: "TOKEN_REVOKED"
 * }
 */













