import { z } from "zod";

export const TenantSchema = z.object({
  id: z.string(),
  slug: z.string(),
  name: z.string(),
  settingsJson: z.record(z.unknown()).optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const CreateTenantSchema = z.object({
  slug: z.string().min(1).max(50).regex(/^[a-z0-9-]+$/),
  name: z.string().min(1).max(255),
  settingsJson: z.record(z.unknown()).optional(),
});

export const UpdateTenantSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  settingsJson: z.record(z.unknown()).optional(),
});

export type Tenant = z.infer<typeof TenantSchema>;
export type CreateTenant = z.infer<typeof CreateTenantSchema>;
export type UpdateTenant = z.infer<typeof UpdateTenantSchema>;











