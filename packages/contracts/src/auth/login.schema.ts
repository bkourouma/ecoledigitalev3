/**
 * Login Request/Response Schemas
 * 
 * Defines the contract for the POST /api/v1/auth/login endpoint
 * which authenticates users and issues JWT tokens.
 */

import { z } from 'zod';

/**
 * Login Request Schema
 * 
 * Validates user credentials for authentication
 */
export const LoginRequestSchema = z.object({
  email: z.string().email({
    message: 'Invalid email format'
  }).describe('User email address'),
  
  password: z.string().min(8, {
    message: 'Password must be at least 8 characters'
  }).describe('User password')
});

export type LoginRequest = z.infer<typeof LoginRequestSchema>;

/**
 * User object returned in login response
 */
export const LoginUserSchema = z.object({
  id: z.string().uuid(),
  email: z.string().email(),
  tenantId: z.string().uuid(),
  tenantSlug: z.string(),
  activeRole: z.string().min(1),
  roles: z.array(z.string()).min(1),
  availableRoles: z.array(z.string()).min(1),
  requiresRoleSelection: z.boolean().default(false),
});

export type LoginUser = z.infer<typeof LoginUserSchema>;

/**
 * Login Response Schema
 * 
 * Returned on successful authentication with JWT token
 */
export const LoginResponseSchema = z.object({
  user: LoginUserSchema.describe('Authenticated user information'),

  token: z.string().describe('JWT token (valid for 24 hours)'),

  expiresAt: z.string().datetime().describe('ISO 8601 timestamp when token expires'),
});

export type LoginResponse = z.infer<typeof LoginResponseSchema>;

/**
 * Login Error Response Schema
 * 
 * Returned on authentication failure
 */
export const LoginErrorSchema = z.object({
  error: z.string(),
  message: z.string(),
  code: z.string().optional().describe('Error code for programmatic handling'),
});

export type LoginError = z.infer<typeof LoginErrorSchema>;

/**
 * Example login request:
 * {
 *   email: "student@imhotepacademy.fr",
 *   password: "SecurePassword123!"
 * }
 * 
 * Example login response (success):
 * {
 *   user: {
 *     id: "a82a680c-0888-4f0c-96cc-9531d0b95373",
 *     email: "student@imhotepacademy.fr",
 *     tenantId: "6eb9c106-b650-4398-b6fa-091b6828c4ba",
 *     tenantSlug: "imhotepacademy",
 *     roles: ["student"]
 *   },
 *   token: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
 *   expiresAt: "2025-10-13T12:00:00.000Z"
 * }
 * 
 * Example login response (error):
 * {
 *   error: "Invalid Credentials",
 *   message: "Invalid email or password",
 *   code: "INVALID_CREDENTIALS"
 * }
 */












