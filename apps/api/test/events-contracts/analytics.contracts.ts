/**
 * Contrats des événements consommés par `analytics` (abonnés : `modules/analytics/subscribers.ts`).
 *
 * Un événement ne porte aucun chiffre pour analytics : il désigne un périmètre à relire. Le lecteur est donc `planRefreshes`
 * (`domain/refresh-plan.ts`) : il doit produire AU MOINS une demande pour l'échantillon du producteur (variantes complète et
 * minimale). Les champs lus servent à restreindre le périmètre ; leur absence dégrade vers un périmètre plus large, jamais en
 * erreur (`required: false`).
 */
import { CONSUMED_EVENTS } from "../../src/modules/analytics/domain/events";
import { planRefreshes } from "../../src/modules/analytics/domain/refresh-plan";
import { producerSchemas, type EventContract, type FieldRead } from "./support";

const NOW = "2026-03-20T10:00:00.000Z";

const contract = (event: string, reads: FieldRead[] = []): EventContract => ({
  consumer: "analytics",
  event,
  reads,
  reader: (payload) => planRefreshes(event, payload, NOW),
  // Un événement qui ne désigne pas de périmètre exploitable (charge sans champ lu) ne produit aucune demande : la reconstruction
  // nocturne rattrape ; tout autre échantillon doit produire au moins une demande.
  readerOk: (result) => Array.isArray(result) && (result.length > 0 || event === "people.student.updated" || event === "results.decision.confirmed"),
});

const optional = (field: string, kind: FieldRead["kind"]): FieldRead => ({ field, kind, required: false, absentOk: true });

/** Champs facultatifs lus (restriction du périmètre) selon l'événement. */
const READS: Record<string, FieldRead[]> = {
  "people.student.updated": [optional("fields", "array")],
  "results.period.closed": [{ field: "classroomId", kind: "uuid" }, { field: "academicPeriodId", kind: "uuid" }],
  "results.period.reopened": [{ field: "classroomId", kind: "uuid" }, { field: "academicPeriodId", kind: "uuid" }],
  "results.decision.confirmed": [{ field: "academicPeriodId", kind: "uuid", nullable: true }],
  "attendance.session.submitted": [optional("date", "string")],
  "attendance.session.validated": [optional("date", "string")],
  "attendance.session.reopened": [optional("date", "string")],
  "attendance.session.cancelled": [optional("date", "string")],
  "attendance.absence.recorded": [optional("date", "string")],
  "attendance.late.recorded": [optional("date", "string")],
  "attendance.staff_absence.recorded": [optional("workDate", "string")],
  "attendance.staff_leave.approved": [optional("startsOn", "string"), optional("endsOn", "string")],
  "attendance.staff_leave.cancelled": [optional("startsOn", "string"), optional("endsOn", "string")],
  "finance.payment.completed": [optional("confirmedAt", "string")],
  "finance.refund.completed": [optional("confirmedAt", "string")],
};
for (const e of CONSUMED_EVENTS.filter((x) => /^academic\.enrollment\./.test(x))) READS[e] = [optional("academicYearId", "uuid")];

const published = producerSchemas();

/** Producteurs qui n'ont pas encore de schéma de charge dans packages/contracts/src/v2 : le contrat de forme ne peut pas être vérifié. */
export const contracts: EventContract[] = CONSUMED_EVENTS.filter((e) => published.has(e)).map((event) => contract(event, READS[event] ?? []));

export const exemptions: Array<{ event: string; reason: string }> = CONSUMED_EVENTS.filter((e) => !published.has(e)).map((event) => ({
  event,
  reason: "le producteur (finance, payroll) type ses charges en interfaces TypeScript sans schéma Zod publié ; analytics ne lit que le type (périmètre `*`), le lecteur est couvert par les tests unitaires de planRefreshes",
}));
