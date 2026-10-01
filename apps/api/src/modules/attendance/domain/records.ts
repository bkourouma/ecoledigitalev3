/**
 * Préparation d'un pointage : validation par rapport à la définition du statut, calcul des minutes comptées (R7) et
 * application d'une excuse déjà couverte par un justificatif accepté (AC3.5).
 *
 * Minutes comptées (`counted_minutes`, base des « heures d'absence ») :
 *  - statut d'ABSENCE   : durée de la séance (ou `daily_minutes` pour l'appel journalier) ; `null` si inconnue ;
 *  - statut de RETARD   : minutes de retard ;
 *  - DÉPART ANTICIPÉ    : minutes manquées (saisies, ou déduites de l'heure de départ et de la fin de séance) ;
 *  - sinon              : `null`.
 * Aucune équivalence « N retards = 1 absence » ici : c'est un RuleSet des modules consommateurs.
 */
import { err, ok, type AppError, type Result } from "@ecoledigitale/kernel";
import { AttendanceCode, validation } from "./errors";
import { isExcusable } from "./status";
import { StatusCode, type SessionScope, type StatusDefinition, type StatusIndex, type Uuid } from "./types";

export interface MarkEntryInput {
  readonly studentId: Uuid;
  readonly statusCode: string;
  readonly minutesLate?: number | undefined;
  readonly minutesMissed?: number | undefined;
  readonly arrivedAt?: Date | null | undefined;
  readonly leftAt?: Date | null | undefined;
  readonly note?: string | null | undefined;
}

export interface MarkContext {
  readonly scope: SessionScope;
  readonly durationMinutes: number | null;
  readonly endsAt: Date | null;
  readonly dailyMinutes: number | null;
  readonly lateRequiresMinutes: boolean;
}

export interface PreparedMark {
  readonly studentId: Uuid;
  readonly statusCode: string;
  readonly minutesLate: number | null;
  readonly countedMinutes: number | null;
  readonly arrivedAt: Date | null;
  readonly leftAt: Date | null;
  readonly note: string | null;
}

/** Pointage prêt à être écrit : excuse éventuelle comprise. */
export interface FinalMark extends PreparedMark {
  readonly originalStatusCode: string | null;
  readonly excused: boolean;
  readonly justificationId: Uuid | null;
}

const fail = (code: Parameters<typeof validation>[0], message: string, studentId: Uuid, path = "entries"): Result<never, AppError> =>
  err(validation(code, message, path, { studentId }));

export function prepareMark(entry: MarkEntryInput, defs: StatusIndex, ctx: MarkContext): Result<PreparedMark, AppError> {
  const def = defs.get(entry.statusCode);
  if (!def) return fail(AttendanceCode.STATUS_UNKNOWN, `Statut de présence inconnu : ${entry.statusCode}.`, entry.studentId);
  if (!def.active) return fail(AttendanceCode.STATUS_INACTIVE, `Le statut ${entry.statusCode} est désactivé.`, entry.studentId);
  if (def.isJustified) {
    return fail(
      AttendanceCode.EXCUSED_REQUIRES_JUSTIFICATION,
      "Une absence justifiée résulte d'un justificatif accepté : déposez et acceptez un justificatif.",
      entry.studentId,
    );
  }

  const isEarlyLeave = def.code === StatusCode.EARLY_LEAVE;
  if (entry.minutesLate !== undefined && !def.countsAsLate) {
    return fail(AttendanceCode.MINUTES_INVALID, "Les minutes de retard ne s'appliquent qu'à un statut de retard.", entry.studentId);
  }
  if (entry.minutesMissed !== undefined && !isEarlyLeave) {
    return fail(AttendanceCode.MINUTES_INVALID, "Les minutes manquées ne s'appliquent qu'à un départ anticipé.", entry.studentId);
  }
  if (entry.arrivedAt && entry.leftAt && entry.leftAt < entry.arrivedAt) {
    return fail(AttendanceCode.MINUTES_INVALID, "L'heure de départ précède l'heure d'arrivée.", entry.studentId);
  }

  let minutesLate: number | null = null;
  if (def.countsAsLate) {
    if (entry.minutesLate === undefined) {
      if (ctx.lateRequiresMinutes) return fail(AttendanceCode.MINUTES_LATE_REQUIRED, "Les minutes de retard sont obligatoires.", entry.studentId);
    } else {
      if (!Number.isInteger(entry.minutesLate) || entry.minutesLate < 1) {
        return fail(AttendanceCode.MINUTES_INVALID, "Les minutes de retard sont un entier positif.", entry.studentId);
      }
      if (ctx.durationMinutes !== null && entry.minutesLate > ctx.durationMinutes) {
        return fail(AttendanceCode.MINUTES_INVALID, "Le retard dépasse la durée de la séance.", entry.studentId);
      }
      minutesLate = entry.minutesLate;
    }
  }

  let counted: number | null = null;
  if (def.countsAsAbsence) {
    counted = ctx.durationMinutes ?? (ctx.scope === "DAILY" ? ctx.dailyMinutes : null);
  } else if (def.countsAsLate) {
    counted = minutesLate;
  } else if (isEarlyLeave) {
    let missed: number | null = entry.minutesMissed ?? null;
    if (missed === null && entry.leftAt && ctx.endsAt && ctx.endsAt > entry.leftAt) {
      missed = Math.ceil((ctx.endsAt.getTime() - entry.leftAt.getTime()) / 60_000);
    }
    if (missed !== null) {
      if (!Number.isInteger(missed) || missed < 1) return fail(AttendanceCode.MINUTES_INVALID, "Les minutes manquées sont un entier positif.", entry.studentId);
      if (ctx.durationMinutes !== null && missed > ctx.durationMinutes) {
        return fail(AttendanceCode.MINUTES_INVALID, "Les minutes manquées dépassent la durée de la séance.", entry.studentId);
      }
    }
    counted = missed;
  }

  const note = entry.note?.trim();
  return ok({
    studentId: entry.studentId,
    statusCode: def.code,
    minutesLate,
    countedMinutes: counted,
    arrivedAt: entry.arrivedAt ?? null,
    leftAt: entry.leftAt ?? null,
    note: note ? note : null,
  });
}

/** Prépare un lot : un élève n'apparaît qu'une fois ; la première erreur annule tout le lot. */
export function prepareMarks(entries: readonly MarkEntryInput[], defs: StatusIndex, ctx: MarkContext): Result<PreparedMark[], AppError> {
  const seen = new Set<Uuid>();
  const out: PreparedMark[] = [];
  for (const entry of entries) {
    if (seen.has(entry.studentId)) {
      return fail(AttendanceCode.DUPLICATE_ENTRY, "Un élève ne peut apparaître qu'une fois par lot.", entry.studentId);
    }
    seen.add(entry.studentId);
    const prepared = prepareMark(entry, defs, ctx);
    if (!prepared.ok) return prepared;
    out.push(prepared.value);
  }
  return ok(out);
}

/**
 * Applique l'excuse d'un justificatif ACCEPTÉ qui couvre la date (AC3.5) : `ABSENT` devient `EXCUSED` (statut d'origine
 * conservé) ; un retard, un départ anticipé ou un statut d'absence personnalisé GARDE son statut avec `excused = true`.
 */
export function withCoverage(mark: PreparedMark, def: StatusDefinition | undefined, justificationId: Uuid | null): FinalMark {
  if (justificationId === null || !isExcusable(def)) {
    return { ...mark, originalStatusCode: null, excused: false, justificationId: null };
  }
  if (mark.statusCode === StatusCode.ABSENT) {
    return { ...mark, statusCode: StatusCode.EXCUSED, originalStatusCode: StatusCode.ABSENT, excused: true, justificationId };
  }
  return { ...mark, originalStatusCode: null, excused: true, justificationId };
}

/** Statut « saisi » d'un pointage existant (avant excuse) : sert à comparer avec une nouvelle saisie. */
export function enteredStatusOf(record: { statusCode: string; originalStatusCode: string | null }): string {
  return record.originalStatusCode ?? record.statusCode;
}

export interface ComparableMark {
  readonly statusCode: string;
  readonly originalStatusCode: string | null;
  readonly minutesLate: number | null;
  readonly countedMinutes: number | null;
  readonly arrivedAt: Date | null;
  readonly leftAt: Date | null;
  readonly note: string | null;
}

const sameInstant = (a: Date | null, b: Date | null): boolean => (a === null || b === null ? a === b : a.getTime() === b.getTime());

/** Le contenu saisi est-il identique à ce qui est déjà en base (rejeu, double envoi) ? */
export function sameMarkContent(existing: ComparableMark, incoming: PreparedMark): boolean {
  return (
    enteredStatusOf(existing) === incoming.statusCode &&
    existing.minutesLate === incoming.minutesLate &&
    existing.countedMinutes === incoming.countedMinutes &&
    sameInstant(existing.arrivedAt, incoming.arrivedAt) &&
    sameInstant(existing.leftAt, incoming.leftAt) &&
    (existing.note ?? null) === (incoming.note ?? null)
  );
}
