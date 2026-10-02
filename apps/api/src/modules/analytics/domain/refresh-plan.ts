/**
 * Plan de rafraîchissement : quel événement d'un autre module rend quel read-model PÉRIMÉ. Fonctions PURES.
 *
 * Un événement ne calcule jamais et n'écrit aucun chiffre : il DEMANDE un rafraîchissement (genre, périmètre) qui sera
 * exécuté, coalescé, par le job `analytics.process-refreshes` en relisant la source par ses ports. Cette indirection
 * rend les read-models indépendants de la forme exacte des payloads (un champ absent dégrade en périmètre plus large,
 * jamais en chiffre faux) et rend la reconstruction identique au flux courant (même chemin de lecture).
 */
import { CONSUMED_EVENTS } from "./events";
import { ALL_SCOPE, type RefreshKind, type ScopeKey } from "./types";

export interface RefreshRequestPlan {
  kind: RefreshKind;
  scopeKey: ScopeKey;
}

/** Temporisation (secondes) avant exécution : les rafales d'événements d'un même périmètre se coalescent. */
export const REFRESH_DELAY_SECONDS: Readonly<Record<RefreshKind, number>> = {
  REBUILD: 0,
  CALENDAR: 30,
  ENROLLMENT: 20,
  RESULTS: 10,
  ATTENDANCE: 30,
  STAFF_PRESENCE: 30,
  FINANCE: 20,
  COLLECTIONS: 20,
  CASH: 10,
  PAYROLL: 30,
  TEACHING_LOAD: 60,
  ADMISSIONS: 30,
  SCHOOLLIFE: 60,
};

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const RANGE_RE = /^(\d{4}-\d{2}-\d{2})\.\.(\d{4}-\d{2}-\d{2})$/;

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown): string | null => (typeof v === "string" && v.length > 0 ? v : null);
const day = (v: unknown): string | null => {
  const s = str(v);
  return s && DAY_RE.test(s.slice(0, 10)) ? s.slice(0, 10) : null;
};

/** Plus grand intervalle accepté pour un périmètre de dates (un congé d'un an ne génère pas une passe d'un an). */
export const MAX_RANGE_DAYS = 400;

export function dayRange(d: string): ScopeKey {
  return `${d}..${d}`;
}

export function rangeKey(from: string, to: string): ScopeKey {
  return `${from}..${to}`;
}

export function parseRange(key: string): { from: string; to: string } | null {
  const m = RANGE_RE.exec(key);
  if (!m) return null;
  const from = m[1] as string;
  const to = m[2] as string;
  return from <= to ? { from, to } : null;
}

/** Premier et dernier jour du mois de `isoDate` (UTC : les instants des paiements sont tronqués au jour de l'événement). */
export function monthRange(isoDate: string): ScopeKey {
  const y = Number(isoDate.slice(0, 4));
  const m = Number(isoDate.slice(5, 7));
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const mm = String(m).padStart(2, "0");
  return rangeKey(`${y}-${mm}-01`, `${y}-${mm}-${String(last).padStart(2, "0")}`);
}

export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

export function addDays(d: string, n: number): string {
  return new Date(Date.parse(`${d}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
}

/**
 * Événements -> demandes. Un type inconnu ne produit rien. `occurredAt` (ISO) sert de repli quand le payload ne
 * porte aucune date. Les doublons de la liste renvoyée sont éliminés.
 */
export function planRefreshes(eventType: string, payload: unknown, occurredAt: string): RefreshRequestPlan[] {
  const p = isRecord(payload) ? payload : {};
  const out: RefreshRequestPlan[] = [];
  const add = (kind: RefreshKind, scopeKey: ScopeKey = ALL_SCOPE): void => {
    if (!out.some((o) => o.kind === kind && o.scopeKey === scopeKey)) out.push({ kind, scopeKey });
  };
  const eventDay = day(occurredAt) ?? "1970-01-01";

  if (/^academic\.(year|period|classroom|classroom_period)\./.test(eventType)) {
    add("CALENDAR");
    if (eventType.startsWith("academic.year.")) add("TEACHING_LOAD");
    return out;
  }
  if (/^academic\.enrollment\./.test(eventType)) {
    add("ENROLLMENT", str(p.academicYearId) ?? ALL_SCOPE);
    return out;
  }
  if (eventType === "people.student.status_changed" || eventType === "people.student.anonymized") {
    add("ENROLLMENT");
    return out;
  }
  if (eventType === "people.student.updated") {
    const fields = Array.isArray(p.fields) ? p.fields : [];
    if (fields.includes("sex")) add("ENROLLMENT");
    return out;
  }
  if (/^people\.teaching_assignment\./.test(eventType)) {
    add("TEACHING_LOAD");
    return out;
  }
  if (eventType === "results.period.closed" || eventType === "results.period.reopened") {
    const classroom = str(p.classroomId);
    const period = str(p.academicPeriodId);
    if (period) add("RESULTS", `${classroom ?? ALL_SCOPE}|${period}`);
    return out;
  }
  if (eventType === "results.decision.confirmed") {
    // L'événement nomme la période mais pas la classe : toutes les classes de la période.
    const period = str(p.academicPeriodId);
    if (period) add("RESULTS", `${ALL_SCOPE}|${period}`);
    return out;
  }
  if (/^attendance\.(session\.(submitted|validated|reopened|cancelled)|absence\.recorded|late\.recorded)$/.test(eventType)) {
    add("ATTENDANCE", dayRange(day(p.date) ?? eventDay));
    return out;
  }
  if (eventType === "attendance.staff_absence.recorded") {
    add("STAFF_PRESENCE", dayRange(day(p.workDate) ?? eventDay));
    return out;
  }
  if (/^attendance\.staff_leave\.(approved|cancelled)$/.test(eventType)) {
    const from = day(p.startsOn);
    const to = day(p.endsOn);
    if (from && to && from <= to && daysBetween(from, to) < MAX_RANGE_DAYS) add("STAFF_PRESENCE", rangeKey(from, to));
    else add("STAFF_PRESENCE", dayRange(eventDay));
    return out;
  }
  if (/^finance\.(invoice\.(issued|paid|overdue|cancelled)|credit_note\.issued|payment\.(completed|allocated)|refund\.completed)$/.test(eventType)) {
    add("FINANCE");
    if (/^finance\.(payment\.completed|refund\.completed)$/.test(eventType)) add("COLLECTIONS", monthRange(day(p.confirmedAt) ?? eventDay));
    return out;
  }
  if (/^finance\.cash_session\.(opened|closed)$/.test(eventType)) {
    add("CASH");
    return out;
  }
  if (/^payroll\.(period\.(created|closed|archived)|run\.completed|payslip\.(calculated|approved|paid|disputed|cancelled|adjusted))$/.test(eventType)) {
    add("PAYROLL");
    return out;
  }
  if (/^admissions.(application.(submitted|status_changed|enrolled|anonymized)|decision.recorded|offer.(accepted|declined|expired|withdrawn)|waitlist.promoted|prospect.converted)$/.test(eventType)) {
    add("ADMISSIONS");
    return out;
  }
  if (/^schoollife.(incident.(declared|status_changed)|measure.(proposed|validated|notified|executed|revoked|rejected|cancelled)|appeal.decided|convocation.(sent|held|missed|cancelled))$/.test(eventType)) {
    add("SCHOOLLIFE");
    return out;
  }
  return out;
}

/** Familles d'abonnement du worker (un abonné par source) : motifs EXACTS tirés de `CONSUMED_EVENTS` (aucun événement non déclaré). */
const escapeRe = (e: string): string => e.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const SOURCES: ReadonlyArray<readonly [string, string]> = [
  ["analytics.refresh-on-academic", "academic"],
  ["analytics.refresh-on-people", "people"],
  ["analytics.refresh-on-results", "results"],
  ["analytics.refresh-on-attendance", "attendance"],
  ["analytics.refresh-on-finance", "finance"],
  ["analytics.refresh-on-payroll", "payroll"],
  ["analytics.refresh-on-admissions", "admissions"],
  ["analytics.refresh-on-schoollife", "schoollife"],
];
export const SUBSCRIPTION_GROUPS: ReadonlyArray<{ name: string; pattern: RegExp }> = SOURCES.map(([name, source]) => ({
  name,
  pattern: new RegExp(`^(${CONSUMED_EVENTS.filter((e) => e.startsWith(`${source}.`)).map(escapeRe).join("|")})$`),
}));
