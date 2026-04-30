import { z } from "zod";
export declare const ApiErrorSchema: z.ZodObject<{
    error: z.ZodString;
    message: z.ZodString;
    details: z.ZodOptional<z.ZodUnknown>;
}, "strip", z.ZodTypeAny, {
    error: string;
    message: string;
    details?: unknown;
}, {
    error: string;
    message: string;
    details?: unknown;
}>;
export declare const PaginationSchema: z.ZodObject<{
    page: z.ZodDefault<z.ZodNumber>;
    limit: z.ZodDefault<z.ZodNumber>;
    total: z.ZodNumber;
    totalPages: z.ZodNumber;
}, "strip", z.ZodTypeAny, {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
}, {
    total: number;
    totalPages: number;
    page?: number | undefined;
    limit?: number | undefined;
}>;
export declare const HealthResponseSchema: z.ZodObject<{
    ok: z.ZodBoolean;
    timestamp: z.ZodString;
    uptime: z.ZodNumber;
    environment: z.ZodString;
    version: z.ZodString;
}, "strip", z.ZodTypeAny, {
    version: string;
    ok: boolean;
    timestamp: string;
    uptime: number;
    environment: string;
}, {
    version: string;
    ok: boolean;
    timestamp: string;
    uptime: number;
    environment: string;
}>;
export type ApiError = z.infer<typeof ApiErrorSchema>;
export type Pagination = z.infer<typeof PaginationSchema>;
export type HealthResponse = z.infer<typeof HealthResponseSchema>;
//# sourceMappingURL=common.d.ts.map