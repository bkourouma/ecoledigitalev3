/** Définition des contrats d'événements consommés par `examinations` (abonnés : `modules/examinations/subscribers.ts`). */
import { examinationsConsumedEnrollmentWithdrawnSchema } from "@ecoledigitale/contracts/v2";
import type { EventContract } from "./support";

export const contracts: EventContract[] = [
  {
    consumer: "examinations",
    event: "academic.enrollment.withdrawn",
    // L'abonné retire le candidat de l'inscription retirée : seul l'identifiant de l'inscription est lu.
    reads: [{ field: "enrollmentId", kind: "uuid" }],
    reader: (p) => examinationsConsumedEnrollmentWithdrawnSchema.safeParse(p).success,
  },
];
