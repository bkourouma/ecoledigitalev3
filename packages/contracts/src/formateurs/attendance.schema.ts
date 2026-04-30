/**
 * Attendance Schemas
 * 
 * Zod schemas for learner attendance tracking
 */

import { z } from "zod";

export const MarkPresenceSchema = z.object({
  present: z.boolean(),
});

export const AttendanceResponseSchema = z.object({
  success: z.literal(true),
  data: z.object({
    inscription_id: z.string().uuid(),
    present: z.boolean(),
    marked_at: z.string().datetime(),
  }),
});

