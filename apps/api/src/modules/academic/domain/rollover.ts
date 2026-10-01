/**
 * Reconduction annuelle (US7) : planificateur PUR. Matrice issue × niveau suivant, dérivée des DONNÉES
 * (`enrollment_outcomes.kind`, `grade_levels.next_grade_level_id`) — academic ne calcule aucune issue (R24).
 *
 *   ADVANCE  -> niveau suivant (`next_grade_level_id`, ou la cible fournie par la décision) ;
 *   REPEAT   -> même niveau, `is_repeating = true` ;
 *   REDIRECT -> programme et niveau désignés par la décision ;
 *   EXIT     -> aucune inscription l'année suivante.
 */
import type { AcademicEnrollmentMode, AcademicEnrollmentStatus, AcademicOutcomeKind } from "@ecoledigitale/contracts/src/v2/academic";

export interface RolloverSource {
  enrollmentId: string;
  studentId: string;
  classroomId: string;
  programId: string;
  gradeLevelId: string;
  mode: AcademicEnrollmentMode;
  status: AcademicEnrollmentStatus;
  fundingType: string;
  funderLabel: string | null;
  outcome: { code: string; kind: AcademicOutcomeKind; targetProgramId: string | null; targetGradeLevelId: string | null } | null;
}

export interface RolloverGradeLevel {
  id: string;
  code: string;
  label: string;
  nextGradeLevelId: string | null;
  isFinal: boolean;
}

export interface RolloverProgram {
  id: string;
  code: string;
  label: string;
  gradeLevelIds: ReadonlySet<string>;
}

export interface RolloverTargetClassroom {
  id: string;
  programId: string;
  gradeLevelId: string;
  name: string;
  capacity: number | null;
  capacityIsHard: boolean;
  enrolledCount: number;
}

export interface RolloverContext {
  gradeLevels: ReadonlyMap<string, RolloverGradeLevel>;
  programs: ReadonlyMap<string, RolloverProgram>;
  /** Types de financement dont l'exigence de référence interdit le report automatique. */
  fundingRequiresReference: ReadonlyMap<string, boolean>;
  targetClassrooms: readonly RolloverTargetClassroom[];
  /** Programmes disposant d'un curriculum publié dans l'année cible. */
  programsWithPublishedCurriculum: ReadonlySet<string>;
  /** Inscriptions d'origine déjà reconduites (idempotence). */
  alreadyRolledOver: ReadonlySet<string>;
  createMissingClassrooms: boolean;
}

export type RolloverAnomalyCode =
  | "outcome_missing"
  | "next_level_missing"
  | "curriculum_missing"
  | "funding_to_reconfirm"
  | "redirect_target_missing"
  | "target_classroom_missing"
  | "target_classroom_full";

export interface RolloverAnomaly {
  code: RolloverAnomalyCode;
  enrollmentId: string | null;
  classroomId: string | null;
  message: string;
}

export interface PlannedClassroom {
  key: string;
  programId: string;
  gradeLevelId: string;
  name: string;
  code: string;
}

export interface PlannedEnrollment {
  previousEnrollmentId: string;
  studentId: string;
  outcomeKind: AcademicOutcomeKind;
  targetProgramId: string;
  targetGradeLevelId: string;
  isRepeating: boolean;
  fundingType: string;
  funderLabel: string | null;
  carriesFunding: boolean;
  /** Classe existante de l'année cible, sinon la clé d'une classe à créer. */
  targetClassroomId: string | null;
  plannedClassroomKey: string | null;
}

export interface RolloverPlan {
  classroomsToCreate: PlannedClassroom[];
  enrollments: PlannedEnrollment[];
  alreadyRolledOver: number;
  byOutcome: Record<string, number>;
  anomalies: RolloverAnomaly[];
}

const classroomKey = (programId: string, gradeLevelId: string): string => `${programId}|${gradeLevelId}`;

export function plannedClassroomCode(programCode: string, gradeCode: string): string {
  const raw = `${programCode}-${gradeCode}`.toUpperCase().replace(/[^A-Z0-9_.-]/g, "-").replace(/^[^A-Z0-9]+/, "");
  return (raw.length > 0 ? raw : "CLASSE").slice(0, 40);
}

export function planRollover(sources: readonly RolloverSource[], ctx: RolloverContext): RolloverPlan {
  const plan: RolloverPlan = { classroomsToCreate: [], enrollments: [], alreadyRolledOver: 0, byOutcome: {}, anomalies: [] };
  const planned = new Map<string, PlannedClassroom>();
  const seats = new Map<string, number>(ctx.targetClassrooms.map((c) => [c.id, c.enrolledCount]));
  const anomaly = (code: RolloverAnomalyCode, s: RolloverSource, message: string): void => {
    plan.anomalies.push({ code, enrollmentId: s.enrollmentId, classroomId: s.classroomId, message });
  };
  const curriculumWarned = new Set<string>();

  for (const s of sources) {
    if (s.mode !== "CLASS" || (s.status !== "ACTIVE" && s.status !== "COMPLETED")) continue;
    if (ctx.alreadyRolledOver.has(s.enrollmentId)) {
      plan.alreadyRolledOver += 1;
      continue;
    }
    if (!s.outcome) {
      anomaly("outcome_missing", s, "Aucune issue de fin d'année enregistrée pour cette inscription.");
      continue;
    }
    plan.byOutcome[s.outcome.code] = (plan.byOutcome[s.outcome.code] ?? 0) + 1;
    if (s.outcome.kind === "EXIT") continue;

    let targetProgramId = s.programId;
    let targetGradeLevelId = s.gradeLevelId;
    let isRepeating = false;
    if (s.outcome.kind === "ADVANCE") {
      const next = s.outcome.targetGradeLevelId ?? ctx.gradeLevels.get(s.gradeLevelId)?.nextGradeLevelId ?? null;
      if (!next) {
        anomaly("next_level_missing", s, "Le niveau actuel n'a pas de niveau suivant défini.");
        continue;
      }
      targetGradeLevelId = next;
      if (s.outcome.targetProgramId) targetProgramId = s.outcome.targetProgramId;
    } else if (s.outcome.kind === "REPEAT") {
      isRepeating = true;
    } else {
      if (!s.outcome.targetProgramId || !s.outcome.targetGradeLevelId) {
        anomaly("redirect_target_missing", s, "L'orientation n'indique pas le programme et le niveau cibles.");
        continue;
      }
      targetProgramId = s.outcome.targetProgramId;
      targetGradeLevelId = s.outcome.targetGradeLevelId;
    }

    const program = ctx.programs.get(targetProgramId);
    if (!program || !program.gradeLevelIds.has(targetGradeLevelId)) {
      anomaly("next_level_missing", s, "Le programme cible ne couvre pas le niveau cible.");
      continue;
    }
    if (!ctx.programsWithPublishedCurriculum.has(targetProgramId) && !curriculumWarned.has(targetProgramId)) {
      curriculumWarned.add(targetProgramId);
      plan.anomalies.push({ code: "curriculum_missing", enrollmentId: null, classroomId: null, message: `Le programme « ${program.label} » n'a pas de curriculum publié pour l'année cible.` });
    }

    // Classe de destination : une classe existante avec de la place, sinon une classe à créer (si demandé).
    const key = classroomKey(targetProgramId, targetGradeLevelId);
    const candidates = ctx.targetClassrooms.filter((c) => c.programId === targetProgramId && c.gradeLevelId === targetGradeLevelId).sort((a, b) => a.name.localeCompare(b.name));
    let targetClassroomId: string | null = null;
    let plannedKey: string | null = null;
    const withRoom = candidates.find((c) => !(c.capacity !== null && c.capacityIsHard && (seats.get(c.id) ?? 0) >= c.capacity));
    if (withRoom) {
      targetClassroomId = withRoom.id;
      seats.set(withRoom.id, (seats.get(withRoom.id) ?? 0) + 1);
    } else if (candidates.length > 0) {
      anomaly("target_classroom_full", s, "Toutes les classes de destination sont complètes.");
      continue;
    } else if (ctx.createMissingClassrooms) {
      if (!planned.has(key)) {
        const grade = ctx.gradeLevels.get(targetGradeLevelId);
        planned.set(key, {
          key,
          programId: targetProgramId,
          gradeLevelId: targetGradeLevelId,
          name: `${grade?.label ?? targetGradeLevelId} — ${program.label}`.slice(0, 200),
          code: plannedClassroomCode(program.code, grade?.code ?? "X"),
        });
      }
      plannedKey = key;
    } else {
      anomaly("target_classroom_missing", s, "Aucune classe de destination dans l'année cible.");
      continue;
    }

    const requiresReference = ctx.fundingRequiresReference.get(s.fundingType) === true;
    if (requiresReference) {
      plan.anomalies.push({ code: "funding_to_reconfirm", enrollmentId: s.enrollmentId, classroomId: s.classroomId, message: `Le financement « ${s.fundingType} » exige une référence d'affectation : à re-confirmer.` });
    }
    plan.enrollments.push({
      previousEnrollmentId: s.enrollmentId,
      studentId: s.studentId,
      outcomeKind: s.outcome.kind,
      targetProgramId,
      targetGradeLevelId,
      isRepeating,
      fundingType: requiresReference ? "PRIVATE" : s.fundingType,
      funderLabel: requiresReference ? null : s.funderLabel,
      carriesFunding: !requiresReference,
      targetClassroomId,
      plannedClassroomKey: plannedKey,
    });
  }
  plan.classroomsToCreate = [...planned.values()];
  return plan;
}
