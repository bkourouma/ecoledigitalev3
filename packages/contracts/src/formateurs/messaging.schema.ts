/**
 * Messaging Schemas
 * 
 * Zod schemas for trainer group messaging
 */

import { z } from "zod";

export const GroupMessageSchema = z.object({
  sujet: z.string().min(1).max(200),
  message: z.string().min(1).max(2000),
  type: z.enum(["email", "sms", "both"]),
  destinataires: z.enum(["tous", "presents", "absents"]).default("tous"),
});

export const GroupMessageResponseSchema = z.object({
  success: z.literal(true),
  data: z.object({
    nb_destinataires: z.number().int().min(0),
    email_envoyes: z.number().int().min(0).optional(),
    sms_envoyes: z.number().int().min(0).optional(),
  }),
});

