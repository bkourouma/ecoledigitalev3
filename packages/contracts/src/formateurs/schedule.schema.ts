/**
 * Schedule Schemas
 * 
 * Zod schemas for trainer schedule and unavailability management
 */

import { z } from "zod";

export const PlanningQuerySchema = z.object({
  annee: z.coerce.number().int().min(2000).max(2100),
  mois: z.coerce.number().int().min(1).max(12).optional(),
  vue: z.enum(["mois", "semaine", "liste"]).optional().default("mois"),
});

export const IndisponibiliteItemSchema = z.object({
  id: z.string().uuid(),
  date_debut: z.string().date(),
  date_fin: z.string().date(),
  raison: z.string().optional(),
  created_at: z.string().datetime(),
});

export const CalendarSessionEventSchema = z.object({
  id: z.string().uuid(),
  title: z.string(),
  start: z.string().datetime(),
  end: z.string().datetime(),
  backgroundColor: z.string(),
  extendedProps: z.object({
    type: z.literal("session"),
    code_session: z.string(),
    formation_titre: z.string(),
    mode_formation: z.string(),
    nb_inscrits: z.number().int().min(0),
    statut: z.string(),
  }),
});

export const PlanningResponseSchema = z.object({
  success: z.literal(true),
  data: z.object({
    sessions: z.array(CalendarSessionEventSchema),
    indisponibilites: z.array(IndisponibiliteItemSchema),
  }),
});

export const CreateIndisponibiliteSchema = z.object({
  date_debut: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  date_fin: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  raison: z.string().min(1).max(500).optional(),
}).refine(
  (data) => {
    const debut = new Date(data.date_debut);
    const fin = new Date(data.date_fin);
    return fin >= debut;
  },
  {
    message: "date_fin must be >= date_debut",
    path: ["date_fin"],
  }
);

// Type exports
export type IndisponibiliteItem = z.infer<typeof IndisponibiliteItemSchema>;
export type CalendarSessionEvent = z.infer<typeof CalendarSessionEventSchema>;

