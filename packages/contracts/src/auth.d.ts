import { z } from "zod";
export declare const LoginRequestSchema: z.ZodObject<{
    email: z.ZodString;
    password: z.ZodString;
}, "strip", z.ZodTypeAny, {
    email: string;
    password: string;
}, {
    email: string;
    password: string;
}>;
export declare const LoginResponseSchema: z.ZodObject<{
    id: z.ZodString;
    email: z.ZodString;
    name: z.ZodString;
    tenantId: z.ZodString;
    tenantSlug: z.ZodString;
    roles: z.ZodArray<z.ZodString, "many">;
}, "strip", z.ZodTypeAny, {
    email: string;
    id: string;
    tenantId: string;
    tenantSlug: string;
    roles: string[];
    name: string;
}, {
    email: string;
    id: string;
    tenantId: string;
    tenantSlug: string;
    roles: string[];
    name: string;
}>;
export declare const SessionSchema: z.ZodObject<{
    user: z.ZodObject<{
        id: z.ZodString;
        email: z.ZodString;
        name: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        email: string;
        id: string;
        name: string;
    }, {
        email: string;
        id: string;
        name: string;
    }>;
    tenantId: z.ZodString;
    tenantSlug: z.ZodString;
    roles: z.ZodArray<z.ZodString, "many">;
    expires: z.ZodString;
}, "strip", z.ZodTypeAny, {
    expires: string;
    tenantId: string;
    tenantSlug: string;
    roles: string[];
    user: {
        email: string;
        id: string;
        name: string;
    };
}, {
    expires: string;
    tenantId: string;
    tenantSlug: string;
    roles: string[];
    user: {
        email: string;
        id: string;
        name: string;
    };
}>;
export type LoginRequest = z.infer<typeof LoginRequestSchema>;
export type LoginResponse = z.infer<typeof LoginResponseSchema>;
export type Session = z.infer<typeof SessionSchema>;
//# sourceMappingURL=auth.d.ts.map