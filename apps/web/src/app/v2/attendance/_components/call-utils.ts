/**
 * Utilitaires PURS de l'écran d'appel : composition des lignes (état serveur + saisies locales) et comptage pour
 * l'affichage. Aucune règle de présence ici : le statut par défaut, les statuts valides et la soumission sont
 * décidés par l'API ; ces fonctions ne font que présenter l'état.
 */
import type { AttendanceSessionDetailDto } from "@ecoledigitale/contracts/v2/attendance";
import type { CallTarget } from "@/platform/offline/attendance-outbox";

/** Statuts SYSTÈME des élèves (les établissements peuvent en ajouter : ils viennent alors des définitions). */
export const SYSTEM_STUDENT_STATUSES = ["PRESENT", "ABSENT", "LATE", "EXCUSED", "EARLY_LEAVE"] as const;
/** Statut affiché pour un élève non encore pointé (« tout présent par défaut » : le serveur applique le même à la soumission). */
export const DEFAULT_STATUS = "PRESENT";

export interface DraftMark {
  statusCode: string;
  minutesLate?: number;
}

export interface CallRow {
  studentId: string;
  enrollmentId: string;
  displayName: string | null;
  inRoster: boolean;
  /** Statut déjà connu du serveur (null = pas encore pointé). */
  serverStatus: string | null;
  serverExcused: boolean;
  serverMinutesLate: number | null;
  /** Saisie locale non encore confirmée par le serveur. */
  draft: DraftMark | null;
  /** Statut affiché : saisie locale, sinon serveur, sinon valeur par défaut. */
  shown: string;
  /** Vrai si le statut affiché est la valeur par défaut (aucun pointage nulle part). */
  isDefault: boolean;
  /** Une saisie locale est en attente d'envoi. */
  pending: boolean;
}

export function buildRows(detail: AttendanceSessionDetailDto, drafts: Readonly<Record<string, DraftMark>>): CallRow[] {
  return detail.students
    .filter((s) => s.inRoster || s.record !== null)
    .map((s) => {
      const draft = drafts[s.studentId] ?? null;
      const serverStatus = s.record?.statusCode ?? null;
      const shown = draft?.statusCode ?? serverStatus ?? DEFAULT_STATUS;
      return {
        studentId: s.studentId,
        enrollmentId: s.enrollmentId,
        displayName: s.displayName,
        inRoster: s.inRoster,
        serverStatus,
        serverExcused: s.record?.excused ?? false,
        serverMinutesLate: s.record?.minutesLate ?? null,
        draft,
        shown,
        isDefault: draft === null && serverStatus === null,
        pending: draft !== null && (draft.statusCode !== serverStatus || (draft.minutesLate ?? null) !== (s.record?.minutesLate ?? null)),
      };
    });
}

export function countByStatus(rows: ReadonlyArray<CallRow>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const r of rows) out[r.shown] = (out[r.shown] ?? 0) + 1;
  return out;
}

/** Saisies locales qui diffèrent de l'état serveur (ce qu'il faut réellement envoyer en mode classique). */
export function pendingEntries(rows: ReadonlyArray<CallRow>): Array<{ studentId: string; statusCode: string; minutesLate?: number }> {
  return rows
    .filter((r) => r.pending && r.draft)
    .map((r) => ({ studentId: r.studentId, statusCode: r.draft!.statusCode, ...(r.draft!.minutesLate ? { minutesLate: r.draft!.minutesLate } : {}) }));
}

export function targetOf(kind: "occurrence" | "daily", id: string, date: string): CallTarget {
  return kind === "occurrence" ? { kind: "occurrence", occurrenceId: id } : { kind: "daily", classroomId: id, date };
}

export function sessionOpenBody(target: CallTarget): { occurrenceId: string } | { scope: "DAILY"; classroomId: string; date: string } {
  return target.kind === "occurrence" ? { occurrenceId: target.occurrenceId } : { scope: "DAILY", classroomId: target.classroomId, date: target.date };
}

export function statusTone(code: string): "success" | "danger" | "warning" | "info" | "neutral" {
  switch (code) {
    case "PRESENT":
      return "success";
    case "ABSENT":
      return "danger";
    case "LATE":
    case "EARLY_LEAVE":
      return "warning";
    case "EXCUSED":
      return "info";
    default:
      return "neutral";
  }
}
