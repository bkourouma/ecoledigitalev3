/**
 * Exécution d'un rafraîchissement : LIRE la source par son port (hors de toute transaction d'analytics), comparer
 * l'empreinte du contenu à la précédente, puis REMPLACER le périmètre dans UNE transaction (faits + état de fraîcheur +
 * événement `analytics.snapshot.refreshed` si le contenu a changé).
 *
 * - Idempotent : même source = même contenu ; une empreinte inchangée n'écrit aucune ligne de fait (sauf `force`, utilisé
 *   par la reconstruction) mais avance `last_success_at` (la donnée a été VÉRIFIÉE à cet instant : c'est son `asOf`).
 * - Échec fermé et honnête : un port non branché (ou un module qui répond `*.port_unavailable`) marque le périmètre
 *   `UNAVAILABLE` et conserve les faits précédents avec leur ancien `asOf` ; une erreur de lecture marque `FAILED`.
 * - Les ports reçoivent un contexte SYSTÈME : les read-models couvrent l'établissement entier ; le périmètre d'un
 *   utilisateur s'applique à la lecture.
 */
import { PgOutboxWriter } from "@ecoledigitale/database";
import { createDomainEvent, newId, type RequestContext } from "@ecoledigitale/kernel";
import { AnalyticsEvents, type SnapshotRefreshedPayload } from "../domain/events";
import { contentHash } from "../domain/metrics";
import { addDays, daysBetween, MAX_RANGE_DAYS, parseRange } from "../domain/refresh-plan";
import type { ClassroomFact, FinanceScopeFacts, PeriodFact, RefreshKind, ScopeKey, Uuid } from "../domain/types";
import { ALL_SCOPE } from "../domain/types";
import { selectYears } from "../infrastructure/dims-repository";
import * as facts from "../infrastructure/facts-repository";
import { getState, recordFailure, recordSuccess } from "../infrastructure/requests-repository";
import { selectScopes } from "../infrastructure/dims-repository";
import { inTx } from "./deps";
import type { AnalyticsDeps, AnalyticsSourcePorts, SourcePortName } from "./ports";

export interface RefreshOutcome {
  kind: RefreshKind;
  scopeKey: ScopeKey;
  status: "OK" | "UNAVAILABLE" | "FAILED";
  rows: number;
  changed: boolean;
  durationMs: number;
  error?: string;
}

export interface RefreshOptions {
  /** Réécrit les faits même si l'empreinte est inchangée (reconstruction). */
  force?: boolean | undefined;
}

/** Port requis par chaque genre (le genre REBUILD n'en requiert aucun : il orchestre les autres). */
export const REQUIRED_PORTS: Readonly<Record<RefreshKind, readonly SourcePortName[]>> = {
  REBUILD: [],
  CALENDAR: ["calendar"],
  ENROLLMENT: ["enrollments"],
  RESULTS: ["results"],
  ATTENDANCE: ["attendance"],
  STAFF_PRESENCE: ["staffPresence"],
  FINANCE: ["finance"],
  COLLECTIONS: ["finance"],
  CASH: ["finance"],
  PAYROLL: ["payroll"],
  TEACHING_LOAD: ["teachingLoad"],
};

export class PortUnavailable extends Error {
  constructor(public readonly port: string, message?: string) {
    super(message ?? `Source "${port}" non branchée.`);
    this.name = "PortUnavailable";
  }
}

const isPortUnavailable = (e: unknown): boolean => {
  if (e instanceof PortUnavailable) return true;
  const code = typeof e === "object" && e !== null ? (e as { code?: unknown }).code : undefined;
  return typeof code === "string" && /port_unavailable$/.test(code);
};

const messageOf = (e: unknown): string => (e instanceof Error ? e.message : String(e));

const todayOf = (deps: AnalyticsDeps): string => deps.clock.now().toISOString().slice(0, 10);

function need<K extends SourcePortName>(deps: AnalyticsDeps, name: K): AnalyticsSourcePorts[K] {
  const port = deps.sources()[name];
  if (!port) throw new PortUnavailable(name);
  return port as AnalyticsSourcePorts[K];
}

/** Borne un intervalle de dates demandé (au plus `MAX_RANGE_DAYS` jours, se terminant au plus tard à `today + 1`). */
export function clampRange(scopeKey: string, today: string): { from: string; to: string } | null {
  const r = parseRange(scopeKey);
  if (!r) return null;
  const to = r.to > addDays(today, 1) ? addDays(today, 1) : r.to;
  const from = daysBetween(r.from, to) >= MAX_RANGE_DAYS ? addDays(to, -(MAX_RANGE_DAYS - 1)) : r.from;
  return from <= to ? { from, to } : null;
}

interface Replacement {
  /** Contenu lu (hashé) — doit être sérialisable. */
  content: unknown;
  rows: number;
  write: (tx: import("@ecoledigitale/database").Tx, now: Date) => Promise<number>;
}

/** Lit la source d'un (genre, périmètre) et prépare son remplacement. Lève `PortUnavailable` si la source manque. */
async function prepare(deps: AnalyticsDeps, ctx: RequestContext, kind: RefreshKind, scopeKey: ScopeKey): Promise<Replacement | null> {
  const tenantId = ctx.tenantId;
  const today = todayOf(deps);
  switch (kind) {
    case "CALENDAR": {
      const calendar = need(deps, "calendar");
      const years = await calendar.listYears(ctx);
      const periods: PeriodFact[] = [];
      const classrooms: ClassroomFact[] = [];
      for (const y of years) {
        periods.push(...(await calendar.listPeriods(ctx, y.id)));
        classrooms.push(...(await calendar.listClassrooms(ctx, y.id)));
      }
      // Les établissements et campus sont facultatifs : sans port `scopes`, la dimension reste telle quelle.
      const scopePort = deps.sources().scopes;
      const scopes = scopePort ? await scopePort.listScopes(ctx) : null;
      const content = { years, periods, classrooms, scopes };
      return {
        content,
        rows: years.length + periods.length + classrooms.length + (scopes?.length ?? 0),
        write: async (tx, now) => (scopes ? await facts.replaceScopes(tx, tenantId, scopes, now) : 0) + (await facts.replaceCalendar(tx, tenantId, { years, periods, classrooms }, now)),
      };
    }
    case "ENROLLMENT": {
      const yearId = scopeKey === ALL_SCOPE ? null : scopeKey;
      const list = await need(deps, "enrollments").listEnrollments(ctx, { yearId });
      return { content: list, rows: list.length, write: (tx, now) => facts.replaceEnrollments(tx, tenantId, yearId, list, now) };
    }
    case "RESULTS": {
      const [classroomId, periodId] = scopeKey.split("|");
      if (!classroomId || !periodId || classroomId === ALL_SCOPE) return null; // l'expansion « toutes les classes » est faite par l'appelant
      const data = await need(deps, "results").readClassPeriod(ctx, { classroomId, periodId });
      return { content: data, rows: data.results.length + data.lines.length, write: (tx, now) => facts.replaceClassPeriodResults(tx, tenantId, data, now) };
    }
    case "ATTENDANCE": {
      const range = clampRange(scopeKey, today);
      if (!range) return null;
      const list = await need(deps, "attendance").readDays(ctx, range);
      return { content: { range, list }, rows: list.length, write: (tx, now) => facts.replaceAttendanceRange(tx, tenantId, range, list, now) };
    }
    case "STAFF_PRESENCE": {
      const range = clampRange(scopeKey, today);
      if (!range) return null;
      const list = await need(deps, "staffPresence").readDays(ctx, range);
      return { content: { range, list }, rows: list.length, write: (tx, now) => facts.replaceStaffPresenceRange(tx, tenantId, range, list, now) };
    }
    case "FINANCE": {
      const finance = need(deps, "finance");
      const { years, campuses } = await inTx(deps, ctx, async (tx) => ({ years: await selectYears(tx), campuses: (await selectScopes(tx)).filter((s) => s.kind === "CAMPUS") }), { readOnly: true });
      const yearKeys: Array<string | null> = [null, ...new Set(years.map((y) => y.code))];
      const campusKeys: Array<string | null> = [null, ...campuses.map((c) => c.id)];
      const scopes: FinanceScopeFacts[] = [];
      // SÉQUENTIEL : les lectures d'un module partagent une connexion (voir platform-assembly §11).
      for (const yearCode of yearKeys) {
        for (const campusId of campusKeys) {
          const s = await finance.readScope(ctx, { yearCode, campusId, asOf: today });
          if (s) scopes.push({ ...s, yearKey: yearCode ?? "*", campusKey: campusId ?? "*" });
        }
      }
      return { content: scopes, rows: scopes.length, write: (tx, now) => facts.replaceFinance(tx, tenantId, scopes, now) };
    }
    case "COLLECTIONS": {
      const range = clampRange(scopeKey, today);
      if (!range) return null;
      const points = await need(deps, "finance").readCollections(ctx, range);
      return { content: { range, points }, rows: points.length, write: (tx, now) => facts.replaceCollectionsRange(tx, tenantId, range, points, now) };
    }
    case "CASH": {
      const sessions = await need(deps, "finance").listCashSessions(ctx);
      return { content: sessions, rows: sessions.length, write: (tx, now) => facts.replaceCashSessions(tx, tenantId, sessions, now) };
    }
    case "PAYROLL": {
      const mass = await need(deps, "payroll").readMass(ctx);
      return { content: mass, rows: mass.length, write: (tx, now) => facts.replacePayroll(tx, tenantId, mass, now) };
    }
    case "TEACHING_LOAD": {
      const port = need(deps, "teachingLoad");
      const years = await inTx(deps, ctx, async (tx) => (await selectYears(tx)).filter((y) => scopeKey === ALL_SCOPE || y.id === scopeKey), { readOnly: true });
      const perYear: Array<{ yearId: Uuid; loads: Awaited<ReturnType<typeof port.readLoads>> }> = [];
      for (const y of years) perYear.push({ yearId: y.id, loads: await port.readLoads(ctx, { yearId: y.id }) });
      return {
        content: perYear,
        rows: perYear.reduce((n, y) => n + y.loads.length, 0),
        write: async (tx, now) => {
          let n = 0;
          for (const y of perYear) n += await facts.replaceTeachingLoad(tx, tenantId, y.yearId, y.loads, now);
          return n;
        },
      };
    }
    case "REBUILD":
      return null;
  }
}

/**
 * Rafraîchit UN (genre, périmètre) FEUILLE. `REBUILD` et `RESULTS` « toutes les classes » sont développés par
 * `refreshKind` (rebuild.ts). Ne lève pas : l'issue est dans le résultat et dans `refresh_state`.
 */
export async function refreshLeaf(deps: AnalyticsDeps, ctx: RequestContext, input: { kind: RefreshKind; scopeKey: ScopeKey }, options: RefreshOptions = {}): Promise<RefreshOutcome> {
  const started = deps.clock.now();
  const base = { kind: input.kind, scopeKey: input.scopeKey };
  const fail = async (status: "FAILED" | "UNAVAILABLE", error: string): Promise<RefreshOutcome> => {
    try {
      await inTx(deps, ctx, (tx) => recordFailure(tx, { tenantId: ctx.tenantId, ...base, now: deps.clock.now(), status, error }));
    } catch (e) {
      deps.logger.error({ err: messageOf(e), ...base }, "analytics : état d'échec non consigné");
    }
    return { ...base, status, rows: 0, changed: false, durationMs: deps.clock.now().getTime() - started.getTime(), error };
  };

  let prepared: Replacement | null;
  try {
    prepared = await prepare(deps, ctx, input.kind, input.scopeKey);
  } catch (e) {
    return await fail(isPortUnavailable(e) ? "UNAVAILABLE" : "FAILED", messageOf(e));
  }
  if (!prepared) return { ...base, status: "OK", rows: 0, changed: false, durationMs: 0 };

  const hash = contentHash(prepared.content);
  const p = prepared;
  try {
    return await inTx(deps, ctx, async (tx) => {
      const previous = await getState(tx, input.kind, input.scopeKey);
      const changed = previous?.contentHash !== hash;
      const now = deps.clock.now();
      let rows = p.rows;
      if (changed || options.force) rows = await p.write(tx, now);
      else rows = previous?.rowsWritten ?? p.rows;
      const durationMs = Math.max(0, now.getTime() - started.getTime());
      await recordSuccess(tx, { tenantId: ctx.tenantId, ...base, now, rows, durationMs, contentHash: hash });
      if (changed) {
        const payload: SnapshotRefreshedPayload = { v: 1, kind: input.kind, scopeKey: input.scopeKey, asOf: now.toISOString(), rows, changed };
        await new PgOutboxWriter(tx).append([createDomainEvent({ type: AnalyticsEvents.SNAPSHOT_REFRESHED, ctx, clock: deps.clock, aggregateType: "analytics.snapshot", aggregateId: newId(), payload })]);
      }
      return { ...base, status: "OK" as const, rows, changed, durationMs };
    });
  } catch (e) {
    return await fail("FAILED", messageOf(e));
  }
}
