import { z } from "zod";

export const LoginRequestSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export const LoginResponseSchema = z.object({
  user: z.object({
    id: z.string(),
    email: z.string().email(),
    tenantId: z.string(),
    tenantSlug: z.string(),
    activeRole: z.string(),
    roles: z.array(z.string()),
    availableRoles: z.array(z.string()),
    requiresRoleSelection: z.boolean().default(false),
  }),
  token: z.string(),
  expiresAt: z.string(),
});

export const LogoutResponseSchema = z.object({
  message: z.string(),
});

export const SessionSchema = z.object({
  user: z.object({
    id: z.string(),
    email: z.string(),
    name: z.string(),
  }),
  tenantId: z.string(),
  tenantSlug: z.string(),
  activeRole: z.string(),
  roles: z.array(z.string()),
  availableRoles: z.array(z.string()),
  expires: z.string(),
});

export type LoginRequest = z.infer<typeof LoginRequestSchema>;
export type LoginResponse = z.infer<typeof LoginResponseSchema>;
export type LogoutResponse = z.infer<typeof LogoutResponseSchema>;
export type Session = z.infer<typeof SessionSchema>;

export * from "./auth/jwt-payload.schema";








