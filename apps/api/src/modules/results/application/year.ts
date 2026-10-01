/**
 * Résultat d'ANNÉE (cycle) d'une inscription — « Phase 3 » du calcul (spec 011 §5.1), DÉRIVÉ des résultats FINAL des périodes.
 *
 *  - une année est calculée seulement quand TOUTES les périodes requises de la classe sont clôturées (FINAL) — R-RES-03 ; sinon
 *    la réponse porte `complete: false` et la liste des périodes manquantes, jamais une moyenne partielle ;
 *  - contrat à crédits : `moyenne_annuelle` (pondérée par les crédits de semestre), `annee_validee` (toutes les UE des périodes
 *    selon le mode du jeu de règles), `credits_valides` / `credits_total`, `mention_diplome`, `rang` sur la cohorte de la classe ;
 *  - contrat à coefficients : l'année est déjà produite par le pipeline du 2ᵉ semestre (ligne `YEAR`) ; elle est restituée telle quelle ;
 *  - la version de règle utilisée est celle ÉPINGLÉE sur le dernier résultat FINAL de l'année (jamais l'heure courante) ⇒ résultat
 *    reproductible. Rien n'est persisté : ce sont des fonctions pures de résultats FINAL immuables et d'une version de règle figée.
 * Aucune formule ici : tout vient des règles.
 */
import { err, ok, type AppError, type RequestContext, type Result } from "@ecoledigitale/kernel";
import { ResultsCode, conflict, forbidden, notFound } from "../domain/errors";
import { hashOf } from "../domain/hash";
import type { LineRecord, ResultHeader } from "../domain/records";
import { StageRunner, asBool, asString, type StageItem } from "../domain/pipeline/runner";
import { listFinalHeadersOfClassroomYear, listHeadersOfEnrollment, listLinesOfHeaders } from "../infrastructure/results-repository";
import { inTx, type ResultsCaps, type ResultsDeps } from "./deps";

export interface YearPeriodSummary {
  academicPeriodId: string;
  rankInYear: number;
  final: boolean;
  version: number | null;
  average: string | null;
  averageDisplay: string | null;
  creditsAcquired: string | null;
  creditsRequired: string | null;
  validated: boolean | null;
  decisionCode: string | null;
}

export interface YearResult {
  enrollmentId: string;
  classroomId: string;
  academicYearId: string;
  contractId: string;
  complete: boolean;
  missingPeriodIds: string[];
  periods: YearPeriodSummary[];
  ruleSetCode: string | null;
  ruleVersionNo: number | null;
  definitionHash: string | null;
  /** Moyenne annuelle (décimal exact) et valeur d'affichage ; `null` tant que l'année n'est pas complète. */
  average: string | null;
  averageDisplay: string | null;
  rank: number | null;
  cohortSize: number | null;
  validated: boolean | null;
  creditsAcquired: string | null;
  creditsRequired: string | null;
  mentionCode: string | null;
  /** Décision de fin d'année (contrat à coefficients) ; `null` pour le contrat à crédits. */
  yearDecisionCode: string | null;
  inputsHash: string | null;
}

const incomplete = (base: Omit<YearResult, "average" | "averageDisplay" | "rank" | "cohortSize" | "validated" | "creditsAcquired" | "creditsRequired" | "mentionCode" | "yearDecisionCode" | "inputsHash" | "ruleSetCode" | "ruleVersionNo" | "definitionHash">): YearResult => ({
  ...base,
  ruleSetCode: null,
  ruleVersionNo: null,
  definitionHash: null,
  average: null,
  averageDisplay: null,
  rank: null,
  cohortSize: null,
  validated: null,
  creditsAcquired: null,
  creditsRequired: null,
  mentionCode: null,
  yearDecisionCode: null,
  inputsHash: null,
});

export async function getYearResult(
  deps: ResultsDeps,
  ctx: RequestContext,
  input: { enrollmentId: string; academicYearId: string; caps?: ResultsCaps | undefined },
): Promise<Result<YearResult, AppError>> {
  if (!input.caps?.read) return err(forbidden(ResultsCode.FORBIDDEN, "Vous n'avez pas le droit de consulter les résultats."));
  return inTx(
    deps,
    ctx,
    async (tx) => {
      const mine = (await listHeadersOfEnrollment(tx, input.enrollmentId)).filter((h) => h.academicYearId === input.academicYearId && h.scope === "PERIOD" && h.academicPeriodId !== null && h.status !== "SUPERSEDED");
      const any = mine[0];
      if (!any) return err(notFound(ResultsCode.RESULT_NOT_FOUND, "Résultat d'année", `${input.enrollmentId}/${input.academicYearId}`));
      const classroomId = any.classroomId;
      const structure = await deps.ports.curriculum.getStructure(ctx, { classroomId, academicPeriodId: any.academicPeriodId as string });
      if (!structure) return err(notFound(ResultsCode.CURRICULUM_UNAVAILABLE, "Structure du curriculum", `${classroomId}/${any.academicPeriodId}`));
      const required = structure.yearPeriods;

      const finals = await listFinalHeadersOfClassroomYear(tx, classroomId, input.academicYearId);
      const finalOf = (periodId: string, enrollmentId: string): ResultHeader | undefined => finals.find((h) => h.academicPeriodId === periodId && h.enrollmentId === enrollmentId);
      const linesByHeader = new Map<string, LineRecord[]>();
      for (const l of await listLinesOfHeaders(tx, finals.map((h) => h.id))) linesByHeader.set(l.periodResultId, [...(linesByHeader.get(l.periodResultId) ?? []), l]);

      const summaries: YearPeriodSummary[] = required.map((p) => {
        const h = finalOf(p.id, input.enrollmentId);
        return { academicPeriodId: p.id, rankInYear: p.rankInYear, final: h !== undefined, version: h?.version ?? null, average: h?.average ?? null, averageDisplay: h?.averageDisplay ?? null, creditsAcquired: h?.creditsAcquired ?? null, creditsRequired: h?.creditsRequired ?? null, validated: h?.validated ?? null, decisionCode: h?.decisionCode ?? null };
      });
      const missing = summaries.filter((s) => !s.final).map((s) => s.academicPeriodId);
      const base = { enrollmentId: input.enrollmentId, classroomId, academicYearId: input.academicYearId, contractId: any.contractId, complete: missing.length === 0, missingPeriodIds: missing, periods: summaries };
      if (missing.length > 0) return ok(incomplete(base));

      const lastPeriod = required[required.length - 1] as (typeof required)[number];
      const lastFinal = finalOf(lastPeriod.id, input.enrollmentId) as ResultHeader;

      // ---- contrat à coefficients : l'année est portée par la ligne YEAR du dernier semestre ------------------------------
      if (any.contractId === "coef-semester@1") {
        const year = (linesByHeader.get(lastFinal.id) ?? []).find((l) => l.level === "YEAR");
        return ok({
          ...base,
          ruleSetCode: lastFinal.ruleSetCode,
          ruleVersionNo: lastFinal.ruleVersionNo,
          definitionHash: lastFinal.definitionHash,
          average: year?.value ?? null,
          averageDisplay: year?.displayValue ?? null,
          rank: year?.rank ?? null,
          cohortSize: year?.cohortSize ?? null,
          validated: null,
          creditsAcquired: null,
          creditsRequired: null,
          mentionCode: null,
          yearDecisionCode: year?.statusCode ?? null,
          inputsHash: lastFinal.inputsHash,
        });
      }

      // ---- contrat à crédits : règles de l'étape « année » sur la cohorte de la classe ------------------------------------
      const session = await deps.ports.rules.open(ctx, { ruleVersionKind: lastFinal.ruleVersionKind as "TENANT" | "NATIONAL", ruleVersionId: lastFinal.ruleVersionId, ruleSetCode: lastFinal.ruleSetCode, ruleVersionNo: lastFinal.ruleVersionNo, definitionHash: lastFinal.definitionHash, contractId: lastFinal.contractId });
      if (!session.ok) return session;
      const runner = new StageRunner(session.value.evaluator({ trace: false }), false);

      const cohort = [...new Set(finals.map((h) => h.enrollmentId))].filter((e) => required.every((p) => finalOf(p.id, e) !== undefined)).sort();
      const index = new Map(cohort.map((e, i) => [e, i]));
      const ueRowsOf = (e: string) =>
        required.flatMap((p) => {
          const h = finalOf(p.id, e) as ResultHeader;
          return (linesByHeader.get(h.id) ?? []).filter((l) => l.level === "UE").map((l) => ({ moyenne: l.value, credits: l.credits ?? "0", validee: l.validated === true }));
        });
      const semestresOf = (e: string) => required.map((p) => ({ moyenne: (finalOf(p.id, e) as ResultHeader).average, credits: (finalOf(p.id, e) as ResultHeader).creditsRequired ?? "0" }));

      interface YearState {
        average: string | null;
        display: string | null;
        validated: boolean | null;
        acquired: string | null;
        total: string | null;
        mention: string | null;
        rank: number | null;
      }
      const states: YearState[] = cohort.map(() => ({ average: null, display: null, validated: null, acquired: null, total: null, mention: null, rank: null }));
      type Tag = { s: YearState; what: string };
      const stage1: Array<StageItem<Tag>> = [];
      cohort.forEach((e, i) => {
        const s = states[i] as YearState;
        const ues = ueRowsOf(e);
        stage1.push({ owner: i, ruleKey: "moyenne_annuelle", variables: { semestres: semestresOf(e) }, tag: { s, what: "average" } });
        stage1.push({ owner: i, ruleKey: "annee_validee", variables: { ues: ues.map((u) => ({ validee: u.validee, credits: u.credits })) }, tag: { s, what: "validated" } });
        stage1.push({ owner: i, ruleKey: "credits_valides", variables: { ues }, tag: { s, what: "acquired" } });
        stage1.push({ owner: i, ruleKey: "credits_total", variables: { ues }, tag: { s, what: "total" } });
      });
      for (const o of runner.batch(stage1)) {
        const { s, what } = o.tag;
        if (what === "average") s.average = asString(o.value);
        else if (what === "validated") s.validated = asBool(o.value);
        else if (what === "acquired") s.acquired = asString(o.value);
        else s.total = asString(o.value);
      }
      const stage2: Array<StageItem<Tag>> = [];
      cohort.forEach((_e, i) => {
        const s = states[i] as YearState;
        stage2.push({ owner: i, ruleKey: "mention_diplome", variables: { moyenne: s.average }, tag: { s, what: "mention" } });
        stage2.push({ owner: i, ruleKey: "arrondi_affichage", variables: { valeur: s.average }, tag: { s, what: "display" } });
      });
      for (const o of runner.batch(stage2)) {
        if (o.tag.what === "mention") o.tag.s.mention = asString(o.value);
        else o.tag.s.display = asString(o.value);
      }
      const ranked = cohort.map((_e, i) => i).filter((i) => !runner.isFailed(i) && (states[i] as YearState).average !== null);
      const values = ranked.map((i) => (states[i] as YearState).average);
      for (const o of runner.batch(ranked.map((i): StageItem<Tag> => ({ owner: i, ruleKey: "rang", variables: { moyenne: (states[i] as YearState).average, cohorte: values }, tag: { s: states[i] as YearState, what: "rank" } })))) {
        o.tag.s.rank = o.value === null ? null : Number(o.value);
      }

      const me = index.get(input.enrollmentId) as number; // présent : cette inscription a tous ses FINAL (vérifié plus haut)
      const failure = runner.failures.get(me);
      if (failure) return err(conflict(ResultsCode.CALCULATION_ERRORS, "Le calcul de l'année est en erreur pour cette inscription.", { ruleKey: failure.ruleKey, code: failure.code, message: failure.message }));
      const mineState = states[me] as YearState;
      return ok({
        ...base,
        ruleSetCode: lastFinal.ruleSetCode,
        ruleVersionNo: lastFinal.ruleVersionNo,
        definitionHash: lastFinal.definitionHash,
        average: mineState.average,
        averageDisplay: mineState.display,
        rank: mineState.rank,
        cohortSize: mineState.rank === null ? null : ranked.length,
        validated: mineState.average === null ? null : mineState.validated,
        creditsAcquired: mineState.acquired,
        creditsRequired: mineState.total,
        mentionCode: mineState.mention,
        yearDecisionCode: null,
        inputsHash: hashOf({ periods: required.map((p) => (finalOf(p.id, input.enrollmentId) as ResultHeader).outputsHash), pin: lastFinal.definitionHash }),
      });
    },
    { readOnly: true },
  );
}
