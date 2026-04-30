/**
 * Notifications Schemas
 * 
 * Zod schemas for trainer notifications
 */

import { z } from "zod";

export const NotificationItemSchema = z.object({
  id: z.string().uuid(),
  type: z.string(),
  titre: z.string(),
  message: z.string(),
  metadata: z.record(z.any()).optional(),
  lue: z.boolean(),
  lue_at: z.string().datetime().optional(),
  created_at: z.string().datetime(),
});

export const NotificationsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20).optional(),
  non_lues: z.coerce.boolean().optional(),
});

export const NotificationsResponseSchema = z.object({
  success: z.literal(true),
  data: z.object({
    notifications: z.array(NotificationItemSchema),
    nb_non_lues: z.number().int().min(0),
    pagination: z.object({
      page: z.number().int().min(1),
      limit: z.number().int().min(1),
      total: z.number().int().min(0),
      totalPages: z.number().int().min(0),
    }),
  }),
});

export const MarkNotificationReadResponseSchema = z.object({
  success: z.literal(true),
  data: z.object({
    id: z.string().uuid(),
    lue: z.literal(true),
    lue_at: z.string().datetime(),
  }),
});

// Type exports
export type NotificationItem = z.infer<typeof NotificationItemSchema>;
export type NotificationsQuery = z.infer<typeof NotificationsQuerySchema>;

