import { z } from "zod";
import { DeliveryModeSchema } from "./session.schema";

// ============================================================================
// CALENDAR EVENT SCHEMAS
// ============================================================================

export const CalendarEventSchema = z.object({
  id: z.string().uuid(),
  title: z.string(),
  start: z.string(), // ISO datetime
  end: z.string(), // ISO datetime
  backgroundColor: z.string(),
  borderColor: z.string(),
  extendedProps: z.object({
    code_session: z.string(),
    mode: DeliveryModeSchema,
    lieu: z.string().nullable().optional(),
    formateurs: z.string(), // Comma-separated names
    places_disponibles: z.number().int(),
    statut: z.string(),
  }),
});

export const CalendarResponseSchema = z.object({
  success: z.literal(true),
  data: z.object({
    events: z.array(CalendarEventSchema),
  }),
});

