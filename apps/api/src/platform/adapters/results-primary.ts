/**
 * results (+ academic, rules, attendance) -> primary_school : `ResultsPort` (délibération COUNCIL, propositions de la règle,
 * confirmation, résultat d'année, origine du jeu de règles) et `RulesPort` (quorum du conseil, motifs d'examen).
 *
 * Le conseil des maîtres RÉUTILISE `results.deliberations` / `results.decisions` : la règle propose, le conseil confirme, la
 * justification d'un écart est conservée par `results`. Ce fichier ne calcule rien : il traduit des lectures d'API publiques.
 *  - Les droits de `results` sont posés par CE adaptateur (`decisionRecord`, `decisionApprove`, `read`) parce que la route de
 *    `primary_school` a déjà exigé `primary.council.manage` / `prepare` (même schéma que les autres adaptateurs).
 *  - Origine du jeu de règles : lue sur la version de règle ÉPINGLÉE de la période (`rules.loadVersion(...).version.source.kind`) ;
 *    une valeur inconnue du module n'est pas inventée (`null`).
 *  - Quorum et motifs d'examen : évalués par les règles `quorum_conseil`, `cas_limite`, `cas_absences`, `cas_deja_redoublant` du
 *    contrat du cycle (`coef-period@1` primaire, `competency-period@1` maternelle). Tant que le contrat n'est pas publié
 *    (`rules.getContract` vide) : AUCUNE règle liée — le quorum n'est pas bloquant et aucun motif n'est inventé.
 */
import { isAppError, type AppError, type RequestContext } from "@ecoledigitale/kernel";
import { getAcademicPeriod, getClassroomFacts, getEnrollment, listEnrollmentsByStudent, type AcademicDeps } from "../../modules/academic";
import { confirmDecision, createDeliberation, getFinalResult, getPeriodView, getYearResult, listDecisions, publishYearDecision, type ResultsDeps } from "../../modules/results";
import type { RulesApi } from "../../modules/rules";
import type { AttendancePort, ConfirmedDecision, ProposalInfo, PrimaryResultsPort as ResultsPort, PrimaryRulesPort as RulesPort } from "../../modules/primary_school";

const READ = { read: true } as const;
const SOURCE_KINDS = ["regulation", "institution", "platform", "placeholder"] as const;
type Kind = (typeof SOURCE_KINDS)[number];

function must<T>(r: { ok: true; value: T } | { ok: false; error: AppError }): T {
  if (!r.ok) throw r.error;
  return r.value;
}

const kindOf = (raw: unknown): Kind | null => ((SOURCE_KINDS as readonly string[]).includes(String(raw)) ? (raw as Kind) : null);

/** Contrat de règles du cycle (donnée du modèle de pack : `calculationContract`) ; le code de cycle est celui d'academic. */
export const PRIMARY_CONTRACT_BY_CYCLE: Readonly<Record<string, string>> = Object.freeze({ PRIMARY: "coef-period@1", PRESCHOOL: "competency-period@1" });

export function createPrimaryResultsPort(input: { results: ResultsDeps; academic: AcademicDeps; rules: RulesApi }): ResultsPort {
  const { results, academic, rules } = input;

  async function view(ctx: RequestContext, classroomId: string, periodId: string) {
    return must(await getPeriodView(results, ctx, { classroomId, academicPeriodId: periodId, caps: READ }));
  }

  async function sourceKindOfVersion(ctx: RequestContext, ruleVersionId: string): Promise<Kind | null> {
    const loaded = await rules.loadVersion(ctx, ruleVersionId);
    return loaded.ok ? kindOf((loaded.value.version.source as { kind?: unknown }).kind) : null;
  }

  async function decisionsOf(ctx: RequestContext, stateId: string) {
    return must(await listDecisions(results, ctx, { stateId, caps: READ }));
  }

  return {
    async openCouncil(ctx, { classroomId, periodId, heldOn, participants }) {
      const v = await view(ctx, classroomId, periodId);
      const existing = v.deliberations.find((d) => d.kind === "COUNCIL" && d.status !== "CANCELLED");
      if (existing) return { deliberationId: existing.id, stateId: v.state.id, academicYearId: v.state.academicYearId };
      const created = must(
        await createDeliberation(results, ctx, { stateId: v.state.id, kind: "COUNCIL", ...(heldOn ? { heldOn } : {}), participants: participants.map((p) => ({ staffId: p.staffId, role: p.role })), caps: { decisionRecord: true } }),
      );
      return { deliberationId: created.id, stateId: v.state.id, academicYearId: v.state.academicYearId };
    },

    async getDeliberation(ctx, { deliberationId, classroomId, periodId }) {
      let v;
      try {
        v = await view(ctx, classroomId, periodId);
      } catch (e) {
        if (isAppError(e) && e.kind === "not_found") return null;
        throw e;
      }
      const d = v.deliberations.find((x) => x.id === deliberationId);
      if (!d) return null;
      const participants = Array.isArray(d.participants) ? (d.participants as Array<{ staffId?: unknown; role?: unknown }>).filter((p) => typeof p.staffId === "string").map((p) => ({ staffId: p.staffId as string, role: String(p.role ?? "") })) : [];
      return { id: d.id, classroomId: d.classroomId, periodId, academicYearId: v.state.academicYearId, kind: d.kind, heldOn: d.heldOn, status: d.status, participants };
    },

    async listProposals(ctx, { classroomId, periodId }): Promise<readonly ProposalInfo[]> {
      const v = await view(ctx, classroomId, periodId);
      const all = await decisionsOf(ctx, v.state.id);
      // Une décision de FIN D'ANNÉE (portée `YEAR`) prime sur la décision de période pour un même élève.
      const byEnrollment = new Map<string, (typeof all)[number]>();
      for (const d of all.filter((x) => x.status !== "WITHDRAWN")) {
        const known = byEnrollment.get(d.enrollmentId);
        if (!known || (d.kind === "YEAR_END" && known.kind !== "YEAR_END")) byEnrollment.set(d.enrollmentId, d);
      }
      return [...byEnrollment.values()].map((d) => ({
        decisionId: d.id,
        enrollmentId: d.enrollmentId,
        ruleProposalCode: d.proposedCode,
        finalCode: d.status === "CONFIRMED" || d.status === "PUBLISHED" ? d.finalCode : null,
        status: d.status,
        justification: d.justification,
      }));
    },

    async confirmDecision(ctx, { decisionId, deliberationId, finalCode, justification }): Promise<ConfirmedDecision> {
      const rec = must(
        await confirmDecision(results, ctx, { decisionId, deliberationId, ...(finalCode ? { finalCode } : {}), ...(justification ? { justification } : {}), caps: { decisionRecord: true, decisionApprove: true } }),
      );
      return { decisionId: rec.id, enrollmentId: rec.enrollmentId, finalCode: rec.finalCode as string, ruleProposalCode: rec.proposedCode, changedFromProposal: rec.finalCode !== rec.proposedCode };
    },

    async publishManualDecision(ctx, { classroomId, periodId, deliberationId, enrollmentId, finalCode, justification, councilRef }): Promise<ConfirmedDecision> {
      const v = await view(ctx, classroomId, periodId);
      const rec = must(await publishYearDecision(results, ctx, { stateId: v.state.id, enrollmentId, finalCode, deliberationId, justification, actor: { source: "primary_school", councilRef } }));
      return { decisionId: rec.id, enrollmentId: rec.enrollmentId, finalCode: rec.finalCode as string, ruleProposalCode: rec.proposedCode, changedFromProposal: false };
    },

    async getYearResult(ctx, { enrollmentId, academicYearId, lastPeriodId }) {
      const year = must(await getYearResult(results, ctx, { enrollmentId, academicYearId, caps: READ }));
      if (!year.complete || !lastPeriodId) return { complete: false, yearResultRef: null, ruleVersionRef: null, ruleSourceKind: null, yearDecisionCode: year.yearDecisionCode };
      // Référence du résultat d'année : l'en-tête FINAL de la dernière période (porte la version de règle épinglée).
      const header = must(await getFinalResult(results, ctx, { enrollmentId, academicPeriodId: lastPeriodId }));
      if (!header) return { complete: false, yearResultRef: null, ruleVersionRef: null, ruleSourceKind: null, yearDecisionCode: year.yearDecisionCode };
      return { complete: true, yearResultRef: header.id, ruleVersionRef: header.ruleVersionId, ruleSourceKind: await sourceKindOfVersion(ctx, header.ruleVersionId), yearDecisionCode: year.yearDecisionCode };
    },

    async getRuleSourceKind(ctx, { classroomId, periodId }) {
      try {
        const v = await view(ctx, classroomId, periodId);
        return await sourceKindOfVersion(ctx, v.state.ruleVersionId);
      } catch (e) {
        // Aucun résultat calculé pour cette période : pas encore de jeu de règles épinglé, donc pas de filigrane déduit.
        if (isAppError(e) && e.kind === "not_found") return null;
        throw e;
      }
    },

    async getConfirmedYearDecision(ctx, { enrollmentId, classroomId, periodId }) {
      let v;
      try {
        v = await view(ctx, classroomId, periodId);
      } catch (e) {
        if (isAppError(e) && e.kind === "not_found") return null;
        throw e;
      }
      const d = (await decisionsOf(ctx, v.state.id)).find((x) => x.enrollmentId === enrollmentId && x.kind === "YEAR_END" && (x.status === "CONFIRMED" || x.status === "PUBLISHED") && x.finalCode);
      return d ? { decisionId: d.id, finalCode: d.finalCode as string } : null;
    },
  };
}

export function createPrimaryRulesPort(input: { academic: AcademicDeps; rules: RulesApi; results: ResultsDeps; attendance: AttendancePort }): RulesPort {
  const { academic, rules, results, attendance } = input;

  /** Contrat du cycle de la classe + date de début de la période ; `null` si le contrat n'est pas publié (aucune règle liée). */
  async function scopeOf(ctx: RequestContext, classroomId: string, periodId: string) {
    const facts = await getClassroomFacts(academic, ctx, classroomId);
    if (!facts.ok) return null;
    const contractId = PRIMARY_CONTRACT_BY_CYCLE[facts.value.educationLevelCode];
    if (!contractId || !rules.getContract(contractId)) return null;
    const period = await getAcademicPeriod(academic, ctx, periodId);
    if (!period.ok) return null;
    return { contractId, institutionId: facts.value.institutionId, levelCode: facts.value.educationLevelCode, date: period.value.startsOn, yearId: facts.value.academicYearId };
  }

  return {
    async quorum(ctx, { classroomId, periodId, convened, present }) {
      const scope = await scopeOf(ctx, classroomId, periodId);
      if (!scope) return null;
      const r = await rules.evaluateRuleSet(ctx, { contractId: scope.contractId, institutionId: scope.institutionId, levelCode: scope.levelCode, date: scope.date }, [
        { ruleKey: "quorum_conseil", context: { variables: { convoques: String(convened), presents: String(present) } } },
      ]);
      // Aucun jeu lié, ou une règle absente du jeu : pas de quorum bloquant (Q-P14).
      if (!r.ok) return null;
      const out = r.value.results[0];
      return out && out.ok && typeof out.value.value === "boolean" ? { met: out.value.value } : null;
    },

    async councilFlags(ctx, { classroomId, periodId, enrollmentIds }) {
      const flags = new Map<string, readonly string[]>();
      const scope = await scopeOf(ctx, classroomId, periodId);
      if (!scope || scope.contractId !== "coef-period@1") return flags; // la maternelle n'a pas de motifs chiffrés
      for (const enrollmentId of enrollmentIds) {
        const enrollment = await getEnrollment(academic, ctx, enrollmentId);
        if (!enrollment.ok) continue;
        const year = await getYearResult(results, ctx, { enrollmentId, academicYearId: scope.yearId, caps: READ });
        const att = await attendance.summarize(ctx, { enrollmentId, academicYearId: scope.yearId });
        const history = await listEnrollmentsByStudent(academic, ctx, enrollment.value.studentId);
        const repeats = history.ok ? history.value.filter((e) => e.isRepeating).length : 0;
        const calls = [
          { ruleKey: "cas_limite", reason: "BORDERLINE", variables: { mga: year.ok ? year.value.average : null } },
          { ruleKey: "cas_absences", reason: "LONG_ABSENCE", variables: { absences_journees: String(att.absentDays ?? 0), jours_ouverts: String(att.openDays ?? 0) } },
          { ruleKey: "cas_deja_redoublant", reason: "ALREADY_REPEATED", variables: { redoublements_cycle: String(repeats) } },
        ];
        const r = await rules.evaluateRuleSet(ctx, { contractId: scope.contractId, institutionId: scope.institutionId, levelCode: scope.levelCode, date: scope.date }, calls.map((c) => ({ ruleKey: c.ruleKey, context: { variables: c.variables } })));
        if (!r.ok) continue;
        const reasons: string[] = [];
        r.value.results.forEach((out, i) => {
          if (out.ok && out.value.value === true) reasons.push((calls[i] as (typeof calls)[number]).reason);
        });
        flags.set(enrollmentId, reasons);
      }
      return flags;
    },
  };
}
