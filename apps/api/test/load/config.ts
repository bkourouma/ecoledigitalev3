/**
 * Paramètres et SEUILS du test de charge. Le plan de mise en oeuvre ne fixe aucun objectif chiffré de performance : les seuils viennent,
 * dans l'ordre, (1) des objectifs des specs de module (`specs/v2/*`), (2) des SLO du runbook d'exploitation (§4), (3) à défaut de
 * valeurs PROPOSÉES (étiquetées ainsi dans `docs/architecture/perf-report.md`). Ils ne font échouer le test que si `ED_LOAD_ENFORCE=1`
 * (job CI planifié non bloquant) ; sinon un dépassement est signalé (`[BREACH]`) sans faire échouer l'exécution.
 * Seules les propriétés de CORRECTION (aucune fuite RLS, aucune erreur 5xx) font toujours échouer.
 */

import { appendFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/** Échelle : 1 = 60 élèves par tenant (CI), 33 ≈ 2 000 élèves par tenant. */
export const SCALE = Math.max(0.5, Number(process.env.ED_LOAD_SCALE ?? 1));
export const TENANTS = Math.max(2, Math.floor(Number(process.env.ED_LOAD_TENANTS ?? 3)));
export const STUDENTS_PER_TENANT = Math.max(20, Math.round(60 * SCALE));
export const CLASS_SIZE = Math.min(50, Math.max(10, Math.round(STUDENTS_PER_TENANT / 3)));
/** Nombre de requêtes par scénario de lecture (multiplié par l'échelle, plafonné). */
export const READS = Math.min(4000, Math.round(300 * Math.max(1, SCALE)));
export const CONCURRENCY = Math.max(1, Number(process.env.ED_LOAD_CONCURRENCY ?? 8));
export const ENFORCE = process.env.ED_LOAD_ENFORCE === "1";
/** Multiplicateur des seuils (machine lente, CI partagée). */
export const THRESHOLD_FACTOR = Math.max(0.1, Number(process.env.ED_LOAD_THRESHOLD_FACTOR ?? 1));
/** Rendu PDF réel (Chrome) au lieu du moteur déterministe. */
export const REAL_PDF = process.env.ED_LOAD_REAL_PDF === "1";
/** Coût scrypt : 16 = valeur de PRODUCTION (défaut IAM) ; 10 accélère un poste lent. */
export const SCRYPT_LOG_N = process.env.ED_LOAD_SCRYPT_LOG_N ?? "16";

export interface Threshold {
  /** p95 maximal (ms) à l'échelle de référence (CONCURRENCY = 8). */
  p95: number;
  p99?: number;
}

/** Seuils PROPOSÉS par scénario (clé = nom du scénario). */
export const THRESHOLDS: Record<string, Threshold> = {
  // Lectures : SLO du runbook d'exploitation (§4) « latence API (lectures) p95 < 500 ms, p99 < 2 s ».
  "people.students.list": { p95: 500, p99: 2000 },
  "people.students.list.deep": { p95: 500, p99: 2000 },
  "people.students.search": { p95: 200, p99: 2000 }, // specs/v2/008 AC4.1 : recherche p95 < 200 ms
  "finance.invoices.list": { p95: 500, p99: 2000 },
  "finance.invoice.detail": { p95: 500, p99: 2000 },
  "finance.statement": { p95: 500, p99: 2000 },
  "finance.reports.summary": { p95: 1000, p99: 3000 },
  "portal.parent.mix": { p95: 500, p99: 2000 },
  "isolation.mixed": { p95: 500, p99: 2000 },
  // Écritures et traitements : PROPOSÉS (le plan et le runbook ne fixent aucun objectif chiffré pour eux).
  "iam.login": { p95: 1500 },
  "iam.refresh": { p95: 300 },
  // Objectifs des specs de module (à concurrence 1 sur 60 lignes ; mesurés ici à concurrence 8) :
  "assess.grades.batch": { p95: 300 }, // specs/v2/011 AC1.4 : grille de 60 élèves enregistrée en <= 300 ms p95
  "assess.grades.rewrite": { p95: 300 },
  "attendance.mark": { p95: 300 }, // specs/v2/010 AC1.5 : marquage de 60 élèves p95 < 300 ms
  "attendance.open": { p95: 500 },
  "attendance.submit": { p95: 500 },
  "finance.payment.online": { p95: 1000 },
  "finance.webhook": { p95: 1000 },
  "finance.payment.manual": { p95: 1500 },
  "results.close": { p95: 6000 },
  // Bulletins : specs/v2/013 AC1.5 « 100 bulletins en <= 120 s sur 2 vCPU », proratisé à la taille de la classe (rendu déterministe).
  "reportcards.batch.e2e": { p95: 1200 * CLASS_SIZE },
};

/** Voisin bruyant : p95 du tenant calme avec un voisin saturant / p95 seul, au plus. */
export const NOISY_NEIGHBOUR_MAX_RATIO = 3;

/** Journal : console ET `results/progress.log` (vitest ne diffuse pas la console avant la fin du fichier de test). */
export const log = (...a: unknown[]): void => {
  const line = `[load] ${a.map((x) => (typeof x === "string" ? x : JSON.stringify(x))).join(" ")}`;
  console.log(line);
  try {
    const dir = join(dirname(fileURLToPath(import.meta.url)), "results");
    mkdirSync(dir, { recursive: true });
    appendFileSync(join(dir, "progress.log"), `${new Date().toISOString().slice(11, 19)} ${line}\n`);
  } catch {
    /* journal facultatif */
  }
};
