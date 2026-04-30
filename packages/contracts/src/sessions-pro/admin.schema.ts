import { z } from "zod";
import { SessionListQuerySchema, SessionProStatusSchema } from "./session.schema";

// ============================================================================
// ADMIN QUERY SCHEMAS
// ============================================================================

export const AdminSessionListQuerySchema = SessionListQuerySchema.extend({
  search: z.string().optional(), // Search by code_session or formation title
});

export const TrainerAvailabilityQuerySchema = z.object({
  date_debut: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), // YYYY-MM-DD, required
  date_fin: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), // YYYY-MM-DD, required
  formateur_ids: z
    .string()
    .transform((val) => (val ? val.split(",") : []))
    .optional(),
});

export const EnrollmentStatusSchema = z.enum(["confirmee", "en_attente", "annulee"]);
export const PaymentStatusSchema = z.enum(["valide", "en_attente", "echec"]);

export const EnrollmentListQuerySchema = z.object({
  statut: z
    .string()
    .transform((val) =>
      val ? (val.split(",") as Array<z.infer<typeof EnrollmentStatusSchema>>) : []
    )
    .optional(),
  paiement: z
    .string()
    .transform((val) =>
      val ? (val.split(",") as Array<z.infer<typeof PaymentStatusSchema>>) : []
    )
    .optional(),
  search: z.string().optional(),
});

// ============================================================================
// ADMIN REQUEST SCHEMAS
// ============================================================================

export const UpdateSessionStatusSchema = z.object({
  statut: SessionProStatusSchema,
});

export const DuplicateSessionSchema = z.object({
  date_debut: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), // YYYY-MM-DD
  date_fin: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), // YYYY-MM-DD
}).refine(
  (data) => {
    const startDate = new Date(data.date_debut);
    const endDate = new Date(data.date_fin);
    return endDate > startDate;
  },
  {
    message: "date_fin must be after date_debut",
    path: ["date_fin"],
  }
);

