/**
 * Statistiques et pilote de charge (Node pur, aucune dépendance) : enregistre des latences, calcule p50/p95/p99, débit et erreurs.
 *
 * Classement d'une réponse : `ok` (2xx/3xx, ou un statut listé dans `expected`), `error` (5xx, réseau, ou 4xx inattendu).
 * Un 429 n'est JAMAIS compté comme erreur serveur quand le scénario l'attend (limiteur d'IP de IAM) : il est compté à part.
 */
import { performance } from "node:perf_hooks";

export interface ScenarioStats {
  name: string;
  /** Description courte (ce qui est mesuré). */
  what: string;
  concurrency: number;
  count: number;
  ok: number;
  /** Réponses 5xx, erreurs réseau, 4xx inattendus. */
  errors: number;
  /** Réponses attendues mais « refusées » (429 du limiteur) : comptées hors latence. */
  limited: number;
  errorRate: number;
  wallMs: number;
  rps: number;
  p50: number;
  p95: number;
  p99: number;
  max: number;
  mean: number;
  /** Exemples d'erreurs (au plus 3) pour le diagnostic. */
  samples: string[];
}

export function percentile(sortedAsc: number[], p: number): number {
  if (sortedAsc.length === 0) return 0;
  const rank = Math.ceil((p / 100) * sortedAsc.length) - 1;
  return sortedAsc[Math.min(sortedAsc.length - 1, Math.max(0, rank))] as number;
}

export interface OpResult {
  status: number;
  /** Détail utile si l'appel est en erreur. */
  note?: string;
}

export interface DriveOptions {
  name: string;
  what: string;
  concurrency: number;
  /** Nombre total d'opérations (boucle fermée). */
  total?: number;
  /** Ou durée en ms (boucle fermée) ; `total` prime s'il est donné. */
  durationMs?: number;
  /** Statuts non-2xx qui comptent comme un succès fonctionnel (ex. 409 d'un rejeu idempotent). */
  expected?: number[];
  /** Statuts qui comptent comme « limités » (429). */
  limitedStatuses?: number[];
  /** Arrêt demandé de l'extérieur (voisin bruyant). */
  stop?: () => boolean;
  /** Exécute l'opération `i` (0-based) par le worker `w`. */
  op(i: number, w: number): Promise<OpResult>;
}

const ms = (t0: number): number => performance.now() - t0;

/** Boucle fermée : `concurrency` workers enchaînent les opérations jusqu'à `total` (ou `durationMs`). */
export async function drive(opts: DriveOptions): Promise<ScenarioStats> {
  const lat: number[] = [];
  let ok = 0;
  let errors = 0;
  let limited = 0;
  const samples: string[] = [];
  const expected = new Set(opts.expected ?? []);
  const limitedSet = new Set(opts.limitedStatuses ?? []);
  let next = 0;
  const started = performance.now();
  const deadline = opts.total === undefined && opts.durationMs !== undefined ? started + opts.durationMs : Number.POSITIVE_INFINITY;

  const worker = async (w: number): Promise<void> => {
    for (;;) {
      const i = next;
      if (opts.stop?.()) return;
      if (opts.total !== undefined ? i >= opts.total : performance.now() >= deadline) return;
      next += 1;
      const t0 = performance.now();
      let r: OpResult;
      try {
        r = await opts.op(i, w);
      } catch (e) {
        r = { status: 0, note: e instanceof Error ? e.message : String(e) };
      }
      const d = ms(t0);
      if (limitedSet.has(r.status)) {
        limited += 1;
      } else if ((r.status >= 200 && r.status < 400) || expected.has(r.status)) {
        ok += 1;
        lat.push(d);
      } else {
        errors += 1;
        lat.push(d);
        if (samples.length < 3) samples.push(`${r.status} ${r.note ?? ""}`.slice(0, 240));
      }
    }
  };
  await Promise.all(Array.from({ length: opts.concurrency }, (_, w) => worker(w)));
  const wallMs = ms(started);
  lat.sort((a, b) => a - b);
  const count = ok + errors + limited;
  const round = (n: number): number => Math.round(n * 10) / 10;
  return {
    name: opts.name,
    what: opts.what,
    concurrency: opts.concurrency,
    count,
    ok,
    errors,
    limited,
    errorRate: count === 0 ? 0 : errors / count,
    wallMs: Math.round(wallMs),
    rps: round(count / (wallMs / 1000)),
    p50: round(percentile(lat, 50)),
    p95: round(percentile(lat, 95)),
    p99: round(percentile(lat, 99)),
    max: round(lat.length ? (lat[lat.length - 1] as number) : 0),
    mean: round(lat.length ? lat.reduce((a, b) => a + b, 0) / lat.length : 0),
    samples,
  };
}

/**
 * Enregistre les latences des ÉTAPES d'une opération composite (ex. appel : ouverture, pointage, soumission) pour publier des
 * percentiles par étape en plus de ceux de l'opération entière.
 */
export class StepRecorder {
  private readonly lat = new Map<string, number[]>();
  private readonly errs = new Map<string, number>();
  async step<T extends { status: number }>(name: string, fn: () => Promise<T>): Promise<T> {
    const t0 = performance.now();
    const r = await fn();
    const d = ms(t0);
    this.lat.set(name, [...(this.lat.get(name) ?? []), d]);
    if (r.status >= 400) this.errs.set(name, (this.errs.get(name) ?? 0) + 1);
    return r;
  }
  toStats(prefix: string, what: Record<string, string>, concurrency: number, wallMs: number): ScenarioStats[] {
    const round = (n: number): number => Math.round(n * 10) / 10;
    return [...this.lat.entries()].map(([name, l]) => {
      const s = [...l].sort((a, b) => a - b);
      const errors = this.errs.get(name) ?? 0;
      return {
        name: `${prefix}.${name}`,
        what: what[name] ?? name,
        concurrency,
        count: s.length,
        ok: s.length - errors,
        errors,
        limited: 0,
        errorRate: s.length ? errors / s.length : 0,
        wallMs: Math.round(wallMs),
        rps: round(s.length / (wallMs / 1000)),
        p50: round(percentile(s, 50)),
        p95: round(percentile(s, 95)),
        p99: round(percentile(s, 99)),
        max: round(s[s.length - 1] ?? 0),
        mean: round(s.reduce((a, b) => a + b, 0) / Math.max(1, s.length)),
        samples: [],
      };
    });
  }
}

/** Chronomètre une opération (ms). */
export async function timed<T>(fn: () => Promise<T>): Promise<{ value: T; ms: number }> {
  const t0 = performance.now();
  const value = await fn();
  return { value, ms: ms(t0) };
}

/** Table Markdown des scénarios. */
export function toMarkdown(rows: ScenarioStats[]): string {
  const head = "| Scénario | Conc. | Requêtes | Erreurs | p50 (ms) | p95 (ms) | p99 (ms) | max (ms) | Débit (req/s) |\n|---|---:|---:|---:|---:|---:|---:|---:|---:|";
  const body = rows.map((r) => `| ${r.name} | ${r.concurrency} | ${r.count}${r.limited ? ` (dont ${r.limited} limitées)` : ""} | ${r.errors} | ${r.p50} | ${r.p95} | ${r.p99} | ${r.max} | ${r.rps} |`);
  return [head, ...body].join("\n");
}
