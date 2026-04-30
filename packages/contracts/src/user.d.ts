import { z } from "zod";
export declare const UserSchema: z.ZodObject<{
    id: z.ZodString;
    tenantId: z.ZodString;
    email: z.ZodString;
    firstName: z.ZodString;
    lastName: z.ZodString;
    createdAt: z.ZodString;
    updatedAt: z.ZodString;
}, "strip", z.ZodTypeAny, {
    email: string;
    id: string;
    firstName: string;
    lastName: string;
    tenantId: string;
    createdAt: string;
    updatedAt: string;
}, {
    email: string;
    id: string;
    firstName: string;
    lastName: string;
    tenantId: string;
    createdAt: string;
    updatedAt: string;
}>;
export declare const CreateUserSchema: z.ZodObject<{
    email: z.ZodString;
    firstName: z.ZodString;
    lastName: z.ZodString;
    password: z.ZodString;
    roles: z.ZodArray<z.ZodString, "many">;
}, "strip", z.ZodTypeAny, {
    email: string;
    password: string;
    firstName: string;
    lastName: string;
    roles: string[];
}, {
    email: string;
    password: string;
    firstName: string;
    lastName: string;
    roles: string[];
}>;
export declare const UpdateUserSchema: z.ZodObject<{
    firstName: z.ZodOptional<z.ZodString>;
    lastName: z.ZodOptional<z.ZodString>;
    password: z.ZodOptional<z.ZodString>;
    roles: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
}, "strip", z.ZodTypeAny, {
    password?: string | undefined;
    firstName?: string | undefined;
    lastName?: string | undefined;
    roles?: string[] | undefined;
}, {
    password?: string | undefined;
    firstName?: string | undefined;
    lastName?: string | undefined;
    roles?: string[] | undefined;
}>;
export declare const RoleSchema: z.ZodObject<{
    id: z.ZodString;
    tenantId: z.ZodString;
    key: z.ZodString;
    name: z.ZodString;
    createdAt: z.ZodString;
    updatedAt: z.ZodString;
}, "strip", z.ZodTypeAny, {
    id: string;
    tenantId: string;
    name: string;
    createdAt: string;
    updatedAt: string;
    key: string;
}, {
    id: string;
    tenantId: string;
    name: string;
    createdAt: string;
    updatedAt: string;
    key: string;
}>;
export declare const CreateRoleSchema: z.ZodObject<{
    key: z.ZodString;
    name: z.ZodString;
}, "strip", z.ZodTypeAny, {
    name: string;
    key: string;
}, {
    name: string;
    key: string;
}>;
export type User = z.infer<typeof UserSchema>;
export type CreateUser = z.infer<typeof CreateUserSchema>;
export type UpdateUser = z.infer<typeof UpdateUserSchema>;
export type Role = z.infer<typeof RoleSchema>;
export type CreateRole = z.infer<typeof CreateRoleSchema>;
//# sourceMappingURL=user.d.ts.map