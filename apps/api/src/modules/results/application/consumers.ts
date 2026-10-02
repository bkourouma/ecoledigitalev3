/**
 * Lecteurs purs des charges d'événements consommés par `results` (appelés par `subscribers.ts`). Les noms de champs
 * sont ceux des PRODUCTEURS (`assessEventPayloadSchemas`, `academicEventPayloadSchemas` de `packages/contracts/src/v2`) ;
 * le test de contrat `apps/api/test/events-contracts/results.test.ts` le vérifie.
 */
import { isUuid } from "@ecoledigitale/kernel";

function uuidField(payload: unknown, key: string): string | undefined {
  if (!payload || typeof payload !== "object") return undefined;
  const v = (payload as Record<string, unknown>)[key];
  return typeof v === "string" && isUuid(v) ? v : undefined;
}

export interface GradeEventRef {
  classroomId: string;
  academicPeriodId: string;
  /** Inscriptions touchées (absent = toute la classe × période). */
  enrollmentIds: string[] | undefined;
}

/**
 * `assess.grade.published|revised`, `assess.assessment.cancelled` : classe et période de l'évaluation.
 * `listsEnrollments` : `published` et `cancelled` portent `enrollmentIds[]`, `revised` porte `enrollmentId`.
 */
export function readGradeEvent(payload: unknown, listsEnrollments: boolean): GradeEventRef | null {
  const classroomId = uuidField(payload, "classroomId");
  const academicPeriodId = uuidField(payload, "academicPeriodId");
  if (!classroomId || !academicPeriodId) return null;
  const list = (payload as { enrollmentIds?: unknown }).enrollmentIds;
  const ids = listsEnrollments && Array.isArray(list) ? list.filter((x): x is string => typeof x === "string" && isUuid(x)) : undefined;
  const enrollmentId = uuidField(payload, "enrollmentId");
  return { classroomId, academicPeriodId, enrollmentIds: ids ?? (enrollmentId ? [enrollmentId] : undefined) };
}

export interface EnrollmentEventRef {
  /** Classes à recalculer : la classe de l'inscription et, pour un transfert, la classe d'origine. */
  classroomIds: string[];
  enrollmentId: string | undefined;
}

/** `academic.enrollment.created|transferred|withdrawn` : classes touchées par le changement d'inscription. */
export function readEnrollmentEvent(payload: unknown): EnrollmentEventRef | null {
  const classroomId = uuidField(payload, "classroomId");
  if (!classroomId) return null;
  const from = uuidField(payload, "fromClassroomId");
  return { classroomIds: [...new Set([classroomId, ...(from ? [from] : [])])], enrollmentId: uuidField(payload, "enrollmentId") };
}
