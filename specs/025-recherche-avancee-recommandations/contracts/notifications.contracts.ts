/**
 * Notifications API Contracts
 * Phase 5 - Recherche Avancée et Gestion des Recommandations
 */

import { z } from 'zod';

// ============================================================================
// Notification Schemas
// ============================================================================

export const NotificationTypeSchema = z.enum([
  'recommandation_nouvelle',
  'recommandation_echeance',
  'recommandation_retard',
  'activite_nouvelle',
  'activite_modifiee',
  'commentaire',
  'validation',
  'autre',
]);

export const NotificationPrioritySchema = z.enum(['basse', 'normale', 'haute', 'urgente']);

export const NotificationSchema = z.object({
  id: z.number().int().positive(),
  user_id: z.number().int().positive(),
  type: NotificationTypeSchema,
  titre: z.string().min(1).max(255),
  message: z.string().min(1),
  entite_type: z.string().max(50).nullable(),
  entite_id: z.number().int().positive().nullable(),
  url: z.string().url().max(500).nullable(),
  lue: z.boolean(),
  lue_le: z.string().datetime().nullable(),
  priorite: NotificationPrioritySchema,
  created_at: z.string().datetime(),
  expire_le: z.string().datetime().nullable(),
});

export const CreateNotificationSchema = z.object({
  user_id: z.number().int().positive(),
  type: NotificationTypeSchema,
  titre: z.string().min(1).max(255),
  message: z.string().min(1),
  entite_type: z.string().max(50).nullable().optional(),
  entite_id: z.number().int().positive().nullable().optional(),
  url: z.string().url().max(500).nullable().optional(),
  priorite: NotificationPrioritySchema.default('normale'),
});

export const NotificationListSchema = z.object({
  notifications: z.array(NotificationSchema),
  total: z.number().int().nonnegative(),
  unread_count: z.number().int().nonnegative(),
});

export const MarkNotificationReadSchema = z.object({
  notification_id: z.number().int().positive(),
});

export type Notification = z.infer<typeof NotificationSchema>;
export type CreateNotification = z.infer<typeof CreateNotificationSchema>;
export type NotificationList = z.infer<typeof NotificationListSchema>;
export type MarkNotificationRead = z.infer<typeof MarkNotificationReadSchema>;

