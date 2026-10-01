/**
 * Projection des inscriptions (`student_enrollment_summaries`) alimentée par les événements `academic.enrollment.*`
 * (fonctions PURES). Le module `people` ne lit JAMAIS le schéma `academic` : il ne connaît que ce que l'événement porte.
 *
 * Payload toléré (`{ v: 1, … }`, tous les champs sauf `enrollmentId` et `studentId` facultatifs) :
 *   enrollmentId, studentId, academicYearId, institutionId, classroomId, classroomName?, programId?, programLabel?,
 *   gradeLevelId?, gradeLevelLabel?, mode?, status?, fundingType?, registrationNumber?, enrolledOn?
 * Quand `status` manque, il se déduit du type d'événement.
 */

export const ENROLLMENT_EVENT_PREFIX = "academic.enrollment.";

/** Statuts d'inscription qui laissent un enseignant / un parent voir l'élève dans sa classe. */
export const LIVE_ENROLLMENT_STATUSES: readonly string[] = ["PENDING", "ACTIVE", "SUSPENDED", "COMPLETED"];
/** Statuts « courants » pour afficher la classe actuelle d'un élève. */
export const CURRENT_ENROLLMENT_STATUSES: readonly string[] = ["ACTIVE", "PENDING", "SUSPENDED"];

const STATUS_BY_EVENT: Readonly<Record<string, string | null>> = {
  created: "PENDING",
  confirmed: "ACTIVE",
  suspended: "SUSPENDED",
  resumed: "ACTIVE",
  withdrawn: "WITHDRAWN",
  cancelled: "CANCELLED",
  completed: "COMPLETED",
  reopened: "ACTIVE",
  transferred: null, // le statut ne change pas (changement de classe)
  funding_changed: null,
  outcome_recorded: null,
};

export interface EnrollmentFacts {
  enrollmentId: string;
  studentId: string;
  academicYearId?: string;
  institutionId?: string;
  classroomId?: string;
  classroomName?: string | null;
  programId?: string | null;
  programLabel?: string | null;
  gradeLevelId?: string | null;
  gradeLevelLabel?: string | null;
  mode?: string;
  status?: string;
  fundingType?: string;
  registrationNumber?: string | null;
  enrolledOn?: string;
}

/** `true` pour un type `academic.enrollment.<verbe>` que la projection sait interpréter. */
export function isEnrollmentEvent(type: string): boolean {
  return type.startsWith(ENROLLMENT_EVENT_PREFIX) && type.slice(ENROLLMENT_EVENT_PREFIX.length) in STATUS_BY_EVENT;
}

/** Statut projeté : celui du payload, sinon celui que le verbe de l'événement impose, sinon `null` (inchangé). */
export function statusForEvent(type: string, payloadStatus: unknown): string | null {
  if (typeof payloadStatus === "string" && payloadStatus.length > 0) return payloadStatus;
  return STATUS_BY_EVENT[type.slice(ENROLLMENT_EVENT_PREFIX.length)] ?? null;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const str = (v: unknown): string | undefined => (typeof v === "string" && v.length > 0 ? v : undefined);
const uuid = (v: unknown): string | undefined => (typeof v === "string" && UUID_RE.test(v) ? v : undefined);

/** Extrait les faits d'un payload ; `null` si l'événement est inexploitable (identifiants manquants). */
export function parseEnrollmentPayload(payload: unknown): EnrollmentFacts | null {
  if (typeof payload !== "object" || payload === null) return null;
  const p = payload as Record<string, unknown>;
  const enrollmentId = uuid(p.enrollmentId);
  const studentId = uuid(p.studentId);
  if (!enrollmentId || !studentId) return null;
  const facts: EnrollmentFacts = { enrollmentId, studentId };
  const set = <K extends keyof EnrollmentFacts>(key: K, value: EnrollmentFacts[K] | undefined): void => {
    if (value !== undefined) facts[key] = value;
  };
  set("academicYearId", uuid(p.academicYearId));
  set("institutionId", uuid(p.institutionId));
  set("classroomId", uuid(p.classroomId));
  set("classroomName", str(p.classroomName));
  set("programId", uuid(p.programId));
  set("programLabel", str(p.programLabel));
  set("gradeLevelId", uuid(p.gradeLevelId));
  set("gradeLevelLabel", str(p.gradeLevelLabel));
  set("mode", str(p.mode));
  set("status", str(p.status));
  // `academic.enrollment.funding_changed` porte le NOUVEAU financement dans `to.fundingType` (et non `fundingType`).
  const to = typeof p.to === "object" && p.to !== null ? (p.to as Record<string, unknown>) : undefined;
  set("fundingType", str(p.fundingType) ?? str(to?.fundingType));
  set("registrationNumber", str(p.registrationNumber));
  const enrolledOn = str(p.enrolledOn);
  set("enrolledOn", enrolledOn && /^\d{4}-\d{2}-\d{2}/.test(enrolledOn) ? enrolledOn.slice(0, 10) : undefined);
  return facts;
}
