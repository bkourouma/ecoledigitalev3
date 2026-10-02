/**
 * Lecteurs purs des charges consommées par les abonnés de `people` (`subscribers.ts`). Les noms de champs sont ceux des
 * PRODUCTEURS (`academicEventPayloadSchemas`, `iamEventPayloadSchemas`) ; le test de contrat
 * `apps/api/test/events-contracts/people.test.ts` le vérifie. Les projections d'inscriptions et d'accès ont leurs propres
 * lecteurs (`parseEnrollmentPayload`, `readMembershipEvent`).
 */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const uuidField = (payload: unknown, key: string): string | undefined => {
  const v = payload && typeof payload === "object" ? (payload as Record<string, unknown>)[key] : undefined;
  return typeof v === "string" && UUID_RE.test(v) ? v : undefined;
};

/** `academic.classroom.cancelled|completed` : la classe dont les affectations d'enseignement prennent fin. */
export const readClosedClassroomId = (payload: unknown): string | undefined => uuidField(payload, "classroomId");

/** `academic.year.closed` : l'année dont les affectations d'enseignement prennent fin (`academicYearId`, égal à `yearId`). */
export const readClosedYearId = (payload: unknown): string | undefined => uuidField(payload, "academicYearId");
