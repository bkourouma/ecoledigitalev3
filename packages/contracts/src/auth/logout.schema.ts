/**
 * Logout Request/Response Schemas
 * 
 * Defines the contract for the POST /api/v1/auth/logout endpoint
 * which invalidates JWT tokens by adding them to the blacklist.
 */

import { z } from 'zod';

/**
 * Logout Request Schema
 * 
 * Note: The token is extracted from the Authorization header,
 * not from the request body. The request body is empty.
 */
export const LogoutRequestSchema = z.object({}).optional();

export type LogoutRequest = z.infer<typeof LogoutRequestSchema>;

/**
 * Logout Response Schema
 * 
 * Returned when logout is successful (token added to blacklist)
 */
export const LogoutResponseSchema = z.object({
  message: z.string().describe('Confirmation message'),
});

export type LogoutResponse = z.infer<typeof LogoutResponseSchema>;

/**
 * Logout Error Schema
 * 
 * Returned when logout fails (invalid token, already logged out)
 */
export const LogoutErrorSchema = z.object({
  error: z.string(),
  message: z.string(),
  code: z.string().optional().describe('Error code for programmatic handling'),
});

export type LogoutError = z.infer<typeof LogoutErrorSchema>;

/**
 * Example logout request:
 * POST /api/v1/auth/logout
 * Headers:
 *   Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
 *   X-Tenant: imhotepacademy
 * Body: {} (empty)
 * 
 * Example logout response (success):
 * {
 *   message: "Logged out successfully"
 * }
 * 
 * Example logout response (error - invalid token):
 * {
 *   error: "Internal Error",
 *   message: "Logout failed",
 *   code: "INTERNAL_ERROR"
 * }
 * 
 * Usage notes:
 * - After successful logout, the JWT token is added to the blacklist
 * - Frontend should remove token from localStorage
 * - Subsequent requests with the blacklisted token will return 401 "Token revoked"
 * - Logout is idempotent - calling multiple times is safe
 */













