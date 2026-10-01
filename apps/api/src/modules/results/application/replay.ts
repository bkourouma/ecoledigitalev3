/**
 * Sources de données de `results` pour le module `rules` : REJEU de reproductibilité (AC4.3) et CAS DE SIMULATION (AC4.4).
 *
 * Prérequis : à la clôture, la trace de chaque ligne FINAL conserve le contexte exact de chaque appel de règle (`variables`, sauf `rang`).
 *  - rejeu : un échantillon de résultats FINAL est ramené à des enregistrements « règle × contexte × empreintes » que `rules` rejoue
 *    sous la version et le hash de définition ÉPINGLÉS sur le résultat ; toute dérive (moteur, règle altérée hors application)
 *    émet `rules.replay.mismatch` ;
 *  - simulation : les mêmes contextes, regroupés par règle, servent à évaluer une NOUVELLE version de règle sur les données RÉELLES du
 *    tenant avant de la publier (aucune identité d'élève : seulement une référence opaque).
 * Limite : seuls les résultats FINAL (périodes clôturées) portent ce contexte ; les brouillons ne sont pas échantillonnés.
 */
import type { RequestContext } from "@ecoledigitale/kernel";
import type { Tx } from "@ecoledigitale/database";
import { registerReplaySource, registerSimulationCaseSource, type ReplayRecord, type ReplaySource, type SimulationCaseGroup, type SimulationCaseInput, type SimulationCaseSource } from "../../rules";
import { SUPPORTED_CONTRACTS, type TraceRecord } from "../domain/types";
import type { LineRecord, ResultHeader } from "../domain/records";
import { HEADER_COLUMNS, toHeader } from "../infrastructure/rows";
import { listLinesOfHeaders } from "../infrastructure/results-repository";
import type { ResultsDeps } from "./deps";

/** Nombre maximal de résultats FINAL rejoués par exécution et par contrat (borne de coût). */
export const REPLAY_MAX_RESULTS = 2000;
/** Taille par défaut et maximale d'un jeu de simulation (résultats FINAL échantillonnés). */
export const SIMULATION_DEFAULT_SAMPLE = 200;
export const SIMULATION_MAX_SAMPLE = 1000;

interface Evaluation {
  readonly header: ResultHeader;
  readonly line: LineRecord;
  readonly index: number;
  readonly trace: TraceRecord & { variables: Readonly<Record<string, unknown>> };
}

/** Évaluations rejouables d'un lot de résultats FINAL : une par entrée de trace portant son contexte, hors étapes surchargées. */
async function evaluationsOf(tx: Tx, headers: readonly ResultHeader[]): Promise<Evaluation[]> {
  const lines = await listLinesOfHeaders(tx, headers.map((h) => h.id));
  const headerOf = new Map(headers.map((h) => [h.id, h]));
  const out: Evaluation[] = [];
  for (const line of lines) {
    const header = headerOf.get(line.periodResultId);
    const trace = Array.isArray(line.trace) ? (line.trace as TraceRecord[]) : [];
    if (!header) continue;
    trace.forEach((t, index) => {
      // une étape surchargée n'a pas d'évaluation à rejouer (valeur imposée, tracée ailleurs)
      if (t.variables && !t.overridden) out.push({ header, line, index, trace: t as Evaluation["trace"] });
    });
  }
  return out;
}

const refOf = (e: Evaluation): string => `${e.header.id}:${e.line.id}:${e.index}`;

export function createResultsReplaySource(depsOf: () => ResultsDeps | null, contractId: string): ReplaySource {
  return {
    async sample({ ctx, percent }: { ctx: RequestContext; percent: number }): Promise<readonly ReplayRecord[]> {
      const deps = depsOf();
      if (!deps || !(percent > 0)) return [];
      const seed = Math.floor(deps.clock.now().getTime() / 86_400_000); // l'échantillon change chaque jour, déterministe dans la journée
      return deps.db.run(
        ctx,
        async (tx) => {
          const headers = (
            await tx.many(
              `SELECT ${HEADER_COLUMNS} FROM results.period_results r
                WHERE r.status = 'FINAL' AND r.scope = 'PERIOD' AND r.contract_id = $1
                  AND (abs(hashtextextended(r.id::text, $2::bigint)) % 10000) < $3::int
                ORDER BY r.id LIMIT ${REPLAY_MAX_RESULTS}`,
              [contractId, seed, Math.min(10000, Math.round(percent * 100))],
            )
          ).map(toHeader);
          return (await evaluationsOf(tx, headers)).map(
            (e): ReplayRecord => ({
              resultId: refOf(e),
              ruleVersionId: e.header.ruleVersionId,
              definitionHash: e.header.definitionHash,
              engineVersion: e.header.engineVersion,
              ruleKey: e.trace.ruleKey,
              context: { variables: e.trace.variables },
              inputsHash: e.trace.inputsHash,
              outputsHash: e.trace.outputsHash,
            }),
          );
        },
        { readOnly: true },
      );
    },
  };
}

export function createResultsSimulationSource(depsOf: () => ResultsDeps | null, contractId: string): SimulationCaseSource {
  return {
    async buildCaseGroups({ ctx, contractId: requested, dataset, progress }): Promise<readonly SimulationCaseGroup[]> {
      const deps = depsOf();
      if (!deps || requested !== contractId || dataset.periodIds.length === 0) return [];
      const size = Math.min(SIMULATION_MAX_SAMPLE, Math.max(1, dataset.sample?.size ?? SIMULATION_DEFAULT_SAMPLE));
      const seed = dataset.sample?.seed ?? 1;
      await progress(10);
      const evaluations = await deps.db.run(
        ctx,
        async (tx) => {
          const headers = (
            await tx.many(
              `SELECT ${HEADER_COLUMNS} FROM results.period_results r
                WHERE r.status = 'FINAL' AND r.scope = 'PERIOD' AND r.contract_id = $1
                  AND r.academic_period_id = ANY($2::uuid[])
                  AND ($3::uuid[] IS NULL OR r.classroom_id = ANY($3::uuid[]))
                ORDER BY abs(hashtextextended(r.id::text, $4::bigint)), r.id LIMIT $5`,
              [contractId, [...dataset.periodIds], dataset.classroomIds ? [...dataset.classroomIds] : null, seed, size],
            )
          ).map(toHeader);
          return evaluationsOf(tx, headers);
        },
        { readOnly: true },
      );
      await progress(80);
      const byRule = new Map<string, SimulationCaseInput[]>();
      for (const e of evaluations) {
        const list = byRule.get(e.trace.ruleKey) ?? [];
        list.push({ id: refOf(e), context: { variables: e.trace.variables } });
        byRule.set(e.trace.ruleKey, list);
      }
      await progress(100);
      // un groupe par règle : chaque règle s'évalue sur son propre contexte
      return [...byRule.entries()].sort(([a], [b]) => (a < b ? -1 : 1)).map(([ruleKey, cases]) => ({ ruleKeys: [ruleKey], cases }));
    },
  };
}

// ---------------------------------------------------------------------------------------------------------------------
// Branchement dans les registres de `rules` (au démarrage du processus : HTTP `setup`, worker via les jobs du module)
// ---------------------------------------------------------------------------------------------------------------------

let current: ResultsDeps | null = null;
const registered = new Set<string>();

/**
 * Branche (une fois par contrat) les sources de rejeu et de simulation de `results` dans les registres du processus et mémorise
 * l'accès base de données le plus récent : ces sources de `rules` n'ont que le contexte de requête, pas de connexion.
 */
export function bindResultsRulesSources(deps: ResultsDeps): void {
  current = deps;
  for (const contractId of SUPPORTED_CONTRACTS) {
    if (registered.has(contractId)) continue;
    registerReplaySource(contractId, createResultsReplaySource(() => current, contractId));
    registerSimulationCaseSource(contractId, createResultsSimulationSource(() => current, contractId));
    registered.add(contractId);
  }
}
