import { z } from "zod";
export declare const TenantSchema: z.ZodObject<{
    id: z.ZodString;
    slug: z.ZodString;
    name: z.ZodString;
    settingsJson: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
    createdAt: z.ZodString;
    updatedAt: z.ZodString;
}, "strip", z.ZodTypeAny, {
    id: string;
    name: string;
    slug: string;
    createdAt: string;
    updatedAt: string;
    settingsJson?: Record<string, unknown> | undefined;
}, {
    id: string;
    name: string;
    slug: string;
    createdAt: string;
    updatedAt: string;
    settingsJson?: Record<string, unknown> | undefined;
}>;
export declare const CreateTenantSchema: z.ZodObject<{
    slug: z.ZodString;
    name: z.ZodString;
    settingsJson: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
}, "strip", z.ZodTypeAny, {
    name: string;
    slug: string;
    settingsJson?: Record<string, unknown> | undefined;
}, {
    name: string;
    slug: string;
    settingsJson?: Record<string, unknown> | undefined;
}>;
export declare const UpdateTenantSchema: z.ZodObject<{
    name: z.ZodOptional<z.ZodString>;
    settingsJson: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
}, "strip", z.ZodTypeAny, {
    name?: string | undefined;
    settingsJson?: Record<string, unknown> | undefined;
}, {
    name?: string | undefined;
    settingsJson?: Record<string, unknown> | undefined;
}>;
export type Tenant = z.infer<typeof TenantSchema>;
export type CreateTenant = z.infer<typeof CreateTenantSchema>;
export type UpdateTenant = z.infer<typeof UpdateTenantSchema>;
//# sourceMappingURL=tenant.d.ts.map