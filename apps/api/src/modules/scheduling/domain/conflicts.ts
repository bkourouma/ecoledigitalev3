/**
 * Détection et explication des conflits (spec 017 US1). Domaine PUR.
 *
 * La base IMPOSE les conflits enseignant / classe (ou offre à la carte) / salle par la contrainte
 * d'exclusion de `resource_claims` ; l'équipement est un stock. Ce module :
 *   - classe les chevauchements trouvés en `BLOCKING` / `WARNING` selon la politique par ressource ;
 *   - EXPLIQUE (qui, quoi, quand) en français, avant l'écriture ;
 *   - produit les avertissements non bloquants (indisponibilité déclarée, salle trop petite,
 *     compétence manquante, intervenant non affecté…) — jamais un blocage (R6, R8, Q24) ;
 *   - détecte les conflits entre PATRONS d'un même emploi du temps (jour, plage, alternance A/B).
 *
 * Critère de chevauchement : plages semi-ouvertes `[début, fin)` ; bout à bout = pas de conflit.
 */
import type { ClaimResourceKind, ConflictPolicies, ResourceKind, TimetableEntry, Timetable } from "./types";
import { formatTimeOfDay, isoWeekday, localDateOf, localMinuteOf, maxDate, minDate, spansOverlap } from "./time";

export type ConflictSeverity = "BLOCKING" | "WARNING";

export type ConflictCode =
  | "STAFF_BUSY"
  | "CLASSROOM_BUSY"
  | "OFFERING_BUSY"
  | "ROOM_BUSY"
  | "EQUIPMENT_SHORTAGE"
  | "STAFF_UNAVAILABLE"
  | "STAFF_NOT_AVAILABLE_DECLARED"
  | "ROOM_TOO_SMALL"
  | "COMPETENCY_MISSING"
  | "STAFF_NOT_ASSIGNED"
  | "STAFF_INACTIVE"
  | "ROOM_UNAVAILABLE"
  | "CALENDAR_BLOCKED";

export interface ConflictView {
  readonly code: ConflictCode;
  readonly severity: ConflictSeverity;
  readonly resourceKind: ResourceKind;
  readonly resourceId: string | null;
  /** Explication en français (qui, quoi, quand). */
  readonly message: string;
  /** Séance en conflit (pour les conflits de réservation). */
  readonly with?: {
    readonly occurrenceId: string;
    readonly startsAt: string;
    readonly endsAt: string;
    readonly title: string | null;
    readonly classroomId: string | null;
  };
}

/** Noms lisibles des ressources (fournis par les ports ; à défaut, identifiant abrégé). */
export interface ConflictLabels {
  staff(id: string): string;
  classroom(id: string): string;
  offering(id: string): string;
  room(id: string): string;
  equipment(id: string): string;
}

const shortId = (id: string): string => id.slice(0, 8);
export const defaultLabels: ConflictLabels = {
  staff: (id) => `l'intervenant ${shortId(id)}`,
  classroom: (id) => `la classe ${shortId(id)}`,
  offering: (id) => `le cours à la carte ${shortId(id)}`,
  room: (id) => `la salle ${shortId(id)}`,
  equipment: (id) => `l'équipement ${shortId(id)}`,
};

/** Réservation existante qui chevauche (ligne de `scheduling.find_conflicts` + résumé de la séance). */
export interface ClaimHit {
  readonly resourceKind: ClaimResourceKind;
  readonly resourceId: string;
  readonly occurrenceId: string;
  readonly startsAt: Date;
  readonly endsAt: Date;
  readonly exclusive: boolean;
  readonly title: string | null;
  readonly classroomId: string | null;
}

const fmtDate = (d: string): string => `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}`;

/** « le 05/10/2026 de 08:00 à 10:00 » dans le fuseau de l'établissement. */
export function describeSpan(startsAt: Date, endsAt: Date, timeZone: string): string {
  const day = localDateOf(startsAt, timeZone);
  const s = formatTimeOfDay(localMinuteOf(startsAt, timeZone));
  const endDay = localDateOf(endsAt, timeZone);
  const e = formatTimeOfDay(localMinuteOf(endsAt, timeZone));
  return endDay === day ? `le ${fmtDate(day)} de ${s} à ${e}` : `du ${fmtDate(day)} ${s} au ${fmtDate(endDay)} ${e}`;
}

const withSuffix = (title: string | null): string => (title ? ` (« ${title} »)` : "");

export interface ClaimConflictInput {
  readonly hits: readonly ClaimHit[];
  readonly policies: ConflictPolicies;
  /** `true` si le demandeur dépasse les conflits (dérogation motivée) : les réservations deviennent non exclusives. */
  readonly override: boolean;
  /** L'identifiant « CLASSROOM » est-il une offre à la carte (sinon une classe) ? */
  readonly classroomIsOffering: boolean;
  readonly labels: ConflictLabels;
  readonly timeZone: string;
}

/**
 * Classe les chevauchements de réservation. Une réservation candidate est EXCLUSIVE si la politique de
 * sa ressource est `BLOCK` et qu'aucune dérogation n'est demandée ; elle ne bloque que contre une
 * réservation existante elle aussi exclusive (c'est exactement la contrainte d'exclusion de la base).
 */
export function classifyClaimHits(input: ClaimConflictInput): ConflictView[] {
  const out: ConflictView[] = [];
  for (const hit of input.hits) {
    const candidateExclusive = input.policies[hit.resourceKind] === "BLOCK" && !input.override;
    const blocking = candidateExclusive && hit.exclusive;
    const when = describeSpan(hit.startsAt, hit.endsAt, input.timeZone);
    let code: ConflictCode;
    let subject: string;
    switch (hit.resourceKind) {
      case "STAFF":
        code = "STAFF_BUSY";
        subject = `${capitalize(input.labels.staff(hit.resourceId))} est déjà occupé(e)`;
        break;
      case "ROOM":
        code = "ROOM_BUSY";
        subject = `${capitalize(input.labels.room(hit.resourceId))} est déjà réservée`;
        break;
      default:
        code = input.classroomIsOffering ? "OFFERING_BUSY" : "CLASSROOM_BUSY";
        subject = input.classroomIsOffering
          ? `${capitalize(input.labels.offering(hit.resourceId))} a déjà une séance`
          : `${capitalize(input.labels.classroom(hit.resourceId))} a déjà une séance`;
    }
    const tail = blocking ? "" : hit.exclusive ? " (avertissement : politique ou dérogation)" : " (réservation non exclusive)";
    out.push({
      code,
      severity: blocking ? "BLOCKING" : "WARNING",
      resourceKind: hit.resourceKind,
      resourceId: hit.resourceId,
      message: `${subject} ${when}${withSuffix(hit.title)}${tail}.`,
      with: {
        occurrenceId: hit.occurrenceId,
        startsAt: hit.startsAt.toISOString(),
        endsAt: hit.endsAt.toISOString(),
        title: hit.title,
        classroomId: hit.classroomId,
      },
    });
  }
  return out.sort(compareViews);
}

export function equipmentShortage(opts: {
  equipmentId: string;
  total: number;
  inUse: number;
  requested: number;
  mode: "BLOCK" | "WARN";
  override: boolean;
  labels: ConflictLabels;
}): ConflictView | null {
  if (opts.inUse + opts.requested <= opts.total) return null;
  const blocking = opts.mode === "BLOCK" && !opts.override;
  return {
    code: "EQUIPMENT_SHORTAGE",
    severity: blocking ? "BLOCKING" : "WARNING",
    resourceKind: "EQUIPMENT",
    resourceId: opts.equipmentId,
    message: `Stock insuffisant pour ${opts.labels.equipment(opts.equipmentId)} : ${opts.inUse} déjà réservé(s) sur ${opts.total}, ${opts.requested} demandé(s).`,
  };
}

const capitalize = (s: string): string => (s.length === 0 ? s : s.charAt(0).toUpperCase() + s.slice(1));

const SEVERITY_ORDER: Record<ConflictSeverity, number> = { BLOCKING: 0, WARNING: 1 };
export function compareViews(a: ConflictView, b: ConflictView): number {
  return (
    SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] ||
    a.code.localeCompare(b.code) ||
    (a.resourceId ?? "").localeCompare(b.resourceId ?? "") ||
    (a.with?.startsAt ?? "").localeCompare(b.with?.startsAt ?? "")
  );
}

export const hasBlocking = (views: readonly ConflictView[]): boolean => views.some((v) => v.severity === "BLOCKING");

// ---------------------------------------------------------------------------
// Avertissements non bloquants (R6, R8, Q24)
// ---------------------------------------------------------------------------

export interface AvailabilityRule {
  /** Jour ISO 1..7, ou null si la règle vise une date précise. */
  readonly weekday: number | null;
  readonly date: string | null;
  readonly startMinute: number;
  readonly endMinute: number;
  readonly kind: "AVAILABLE" | "UNAVAILABLE";
}

export type AvailabilityStatus = "DECLARED_AVAILABLE" | "DECLARED_UNAVAILABLE" | "UNDECLARED_AVAILABLE" | "UNDECLARED_UNAVAILABLE";

const ruleApplies = (rule: AvailabilityRule, date: string): boolean =>
  rule.date !== null ? rule.date === date : rule.weekday === isoWeekday(date);

/**
 * Disponibilité d'un intervenant sur `[startMinute, endMinute)` d'un jour. `UNAVAILABLE` l'emporte (R6) ;
 * à défaut de déclaration, le mode de l'établissement tranche (`OPEN` : disponible, `CLOSED` : non).
 */
export function availabilityStatus(
  rules: readonly AvailabilityRule[],
  mode: "OPEN" | "CLOSED",
  date: string,
  startMinute: number,
  endMinute: number,
): AvailabilityStatus {
  const todays = rules.filter((r) => ruleApplies(r, date));
  if (todays.some((r) => r.kind === "UNAVAILABLE" && r.startMinute < endMinute && startMinute < r.endMinute)) return "DECLARED_UNAVAILABLE";
  const avail = todays.filter((r) => r.kind === "AVAILABLE").sort((a, b) => a.startMinute - b.startMinute);
  // Couverture complète de [startMinute, endMinute) par l'union des plages déclarées disponibles.
  let cursor = startMinute;
  for (const r of avail) {
    if (r.startMinute > cursor) break;
    cursor = Math.max(cursor, r.endMinute);
    if (cursor >= endMinute) return "DECLARED_AVAILABLE";
  }
  return mode === "OPEN" ? "UNDECLARED_AVAILABLE" : "UNDECLARED_UNAVAILABLE";
}

export function staffAvailabilityWarning(opts: {
  staffId: string;
  rules: readonly AvailabilityRule[];
  mode: "OPEN" | "CLOSED";
  date: string;
  startMinute: number;
  endMinute: number;
  labels: ConflictLabels;
}): ConflictView | null {
  const status = availabilityStatus(opts.rules, opts.mode, opts.date, opts.startMinute, opts.endMinute);
  const who = capitalize(opts.labels.staff(opts.staffId));
  if (status === "DECLARED_UNAVAILABLE") {
    return {
      code: "STAFF_UNAVAILABLE",
      severity: "WARNING",
      resourceKind: "STAFF",
      resourceId: opts.staffId,
      message: `${who} a déclaré une indisponibilité le ${fmtDate(opts.date)} sur ce créneau (${formatTimeOfDay(opts.startMinute)}–${formatTimeOfDay(opts.endMinute)}).`,
    };
  }
  if (status === "UNDECLARED_UNAVAILABLE") {
    return {
      code: "STAFF_NOT_AVAILABLE_DECLARED",
      severity: "WARNING",
      resourceKind: "STAFF",
      resourceId: opts.staffId,
      message: `${who} n'a déclaré aucune disponibilité le ${fmtDate(opts.date)} sur ce créneau (${formatTimeOfDay(opts.startMinute)}–${formatTimeOfDay(opts.endMinute)}).`,
    };
  }
  return null;
}

export function roomCapacityWarning(opts: { roomId: string; capacity: number | null; headcount: number | null; labels: ConflictLabels }): ConflictView | null {
  if (opts.capacity === null || opts.headcount === null || opts.headcount <= opts.capacity) return null;
  return {
    code: "ROOM_TOO_SMALL",
    severity: "WARNING",
    resourceKind: "ROOM",
    resourceId: opts.roomId,
    message: `${capitalize(opts.labels.room(opts.roomId))} compte ${opts.capacity} place(s) pour ${opts.headcount} apprenant(s).`,
  };
}

export function staffWarning(
  code: "COMPETENCY_MISSING" | "STAFF_NOT_ASSIGNED" | "STAFF_INACTIVE",
  staffId: string,
  labels: ConflictLabels,
  detail?: string,
): ConflictView {
  const who = capitalize(labels.staff(staffId));
  const message =
    code === "COMPETENCY_MISSING"
      ? `${who} n'a pas déclaré de compétence pour cette matière.`
      : code === "STAFF_NOT_ASSIGNED"
        ? `${who} n'a pas d'affectation d'enseignement active pour cette classe.`
        : `${who} n'est plus en activité${detail ? ` (${detail})` : ""}.`;
  return { code, severity: "WARNING", resourceKind: "STAFF", resourceId: staffId, message };
}

// ---------------------------------------------------------------------------
// Carnet de réservations en mémoire (génération en lot)
// ---------------------------------------------------------------------------

export interface BookedSpan {
  readonly start: number;
  readonly end: number;
  readonly ref: string;
}

/**
 * Carnet de plages exclusives par ressource, pour vérifier un lot de candidats sans une requête par
 * candidat. Reproduit la sémantique de la contrainte d'exclusion (`[)`, par ressource).
 */
export class ResourceBook {
  private readonly spans = new Map<string, BookedSpan[]>();

  static key(kind: ClaimResourceKind, id: string): string {
    return `${kind}:${id}`;
  }

  add(key: string, span: BookedSpan): void {
    const list = this.spans.get(key);
    if (list) list.push(span);
    else this.spans.set(key, [span]);
  }

  firstOverlap(key: string, span: { start: number; end: number }): BookedSpan | null {
    const list = this.spans.get(key);
    if (!list) return null;
    for (const s of list) if (spansOverlap(s, span)) return s;
    return null;
  }
}

// ---------------------------------------------------------------------------
// Conflits entre patrons d'un même emploi du temps (brouillon)
// ---------------------------------------------------------------------------

export interface EntryConflict {
  readonly entryA: string;
  readonly entryB: string;
  readonly resourceKind: ClaimResourceKind;
  readonly resourceId: string;
  readonly weekday: number;
  readonly startMinute: number;
  readonly endMinute: number;
}

const patternsCompatible = (a: TimetableEntry["weekPattern"], b: TimetableEntry["weekPattern"]): boolean =>
  a === "EVERY" || b === "EVERY" || a === b;

/** Ressources exclusives qu'un patron réserve (même règle que `sync_occurrence_claims`). */
export function entryResources(e: TimetableEntry): Array<{ kind: ClaimResourceKind; id: string }> {
  const out: Array<{ kind: ClaimResourceKind; id: string }> = [];
  if (e.kind === "LESSON" || e.kind === "EXAM") {
    if (e.claimsClassroom && e.classroomId) out.push({ kind: "CLASSROOM", id: e.classroomId });
    else if (!e.claimsClassroom && e.offeringId) out.push({ kind: "CLASSROOM", id: e.offeringId });
  }
  if (e.roomId) out.push({ kind: "ROOM", id: e.roomId });
  for (const s of e.staff) out.push({ kind: "STAFF", id: s.staffId });
  return out;
}

/**
 * Chevauchements entre patrons d'un même emploi du temps : même jour ISO, plages `[)` qui se
 * recouvrent, validités qui se croisent, alternances compatibles (deux patrons WEEK_A / WEEK_B ne
 * sont jamais en conflit), et une ressource commune (enseignant, classe/offre, salle).
 */
export function detectEntryConflicts(entries: readonly TimetableEntry[], timetable: Pick<Timetable, "validFrom" | "validTo">): EntryConflict[] {
  const active = entries.filter((e) => e.endedAt === null);
  const byDay = new Map<number, TimetableEntry[]>();
  for (const e of active) {
    const list = byDay.get(e.weekday);
    if (list) list.push(e);
    else byDay.set(e.weekday, [e]);
  }
  const out: EntryConflict[] = [];
  for (const [weekday, list] of byDay) {
    const sorted = [...list].sort((a, b) => a.startMinute - b.startMinute || a.id.localeCompare(b.id));
    for (let i = 0; i < sorted.length; i += 1) {
      const a = sorted[i] as TimetableEntry;
      const resA = entryResources(a);
      for (let j = i + 1; j < sorted.length; j += 1) {
        const b = sorted[j] as TimetableEntry;
        if (b.startMinute >= a.endMinute) break; // triés par début : plus aucun recouvrement possible
        if (!patternsCompatible(a.weekPattern, b.weekPattern)) continue;
        const fromA = a.validFrom ?? timetable.validFrom;
        const toA = a.validTo ?? timetable.validTo;
        const fromB = b.validFrom ?? timetable.validFrom;
        const toB = b.validTo ?? timetable.validTo;
        if (maxDate(fromA, fromB) > minDate(toA, toB)) continue;
        for (const rb of entryResources(b)) {
          if (resA.some((ra) => ra.kind === rb.kind && ra.id === rb.id)) {
            out.push({
              entryA: a.id,
              entryB: b.id,
              resourceKind: rb.kind,
              resourceId: rb.id,
              weekday,
              startMinute: Math.max(a.startMinute, b.startMinute),
              endMinute: Math.min(a.endMinute, b.endMinute),
            });
          }
        }
      }
    }
  }
  return out.sort((x, y) => x.weekday - y.weekday || x.startMinute - y.startMinute || x.entryA.localeCompare(y.entryA) || x.entryB.localeCompare(y.entryB));
}

export function describeEntryConflict(c: EntryConflict, labels: ConflictLabels, policies: ConflictPolicies): ConflictView {
  const day = ["", "lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi", "dimanche"][c.weekday] ?? String(c.weekday);
  const who =
    c.resourceKind === "STAFF" ? labels.staff(c.resourceId) : c.resourceKind === "ROOM" ? labels.room(c.resourceId) : labels.classroom(c.resourceId);
  return {
    code: c.resourceKind === "STAFF" ? "STAFF_BUSY" : c.resourceKind === "ROOM" ? "ROOM_BUSY" : "CLASSROOM_BUSY",
    severity: policies[c.resourceKind] === "BLOCK" ? "BLOCKING" : "WARNING",
    resourceKind: c.resourceKind,
    resourceId: c.resourceId,
    message: `${capitalize(who)} est placé(e) sur deux créneaux qui se chevauchent le ${day} de ${formatTimeOfDay(c.startMinute)} à ${formatTimeOfDay(c.endMinute)}.`,
  };
}
