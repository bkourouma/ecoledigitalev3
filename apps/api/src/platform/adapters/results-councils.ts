/**
 * results (+ academic, rules) -> councils : `ResultsReadPort` (état de la période, résultats d'un élève, suggestions de règles, appréciations
 * des professeurs), `ResultsWritePort` (délibération, décision de fin d'année, distinction, appréciation générale du conseil) et
 * `RuleCodesPort` (codes finaux permis par le contrat `secondary-annual@1`).
 *
 * Ce fichier ne CALCULE rien : il traduit des lectures et des écritures d'API PUBLIQUES de `results`.
 *  - Lecture : les droits de `results` sont posés par CET adaptateur (`read`), la route de `councils` a déjà exigé `council.*`.
 *    Un bilan de fin d'année (`academicPeriodId = null`) lit la DERNIÈRE période d'enseignement de l'année (là où vivent la moyenne
 *    annuelle et la proposition de fin d'année). Les décimaux restent des chaînes exactes ; les suggestions sont des CODES.
 *  - Écriture : l'API d'écriture des conseils de `results` (`openCouncilDeliberation`, `markDeliberationHeld`, `publishYearDecision`,
 *    `recordDistinction`, `withdrawCouncilDecision`, `writeCouncilAppreciation`) : acteur humain, module appelant et référence OPAQUE de l'acte source tracés et audités,
 *    idempotente, refusée sur une période clôturée. Les erreurs de `results` sont relancées telles quelles (code `results.*`).
 */
import type { AppError, RequestContext } from "@ecoledigitale/kernel";
import { listAcademicPeriods, listReference, type AcademicDeps } from "../../modules/academic";
import {
  getClassMatrix,
  getPeriodView,
  listAppreciations,
  listDeliberations,
  markDeliberationHeld,
  openCouncilDeliberation,
  publishYearDecision,
  recordDistinction,
  updateDeliberation,
  withdrawCouncilDecision,
  writeCouncilAppreciation,
  type ResultsDeps,
} from "../../modules/results";
import { outputLabelOf, type LabelledRule, type RulesApi } from "../../modules/rules";
import type { CouncilsResultsReadPort, CouncilsResultsWritePort, CouncilsRuleCodesPort } from "../../modules/councils";

const READ = { read: true } as const;
const WRITE = { decisionRecord: true } as const;
const SOURCE_KINDS = ["regulation", "institution", "platform", "placeholder"] as const;
type Kind = (typeof SOURCE_KINDS)[number];
const kindOf = (raw: unknown): Kind | null => ((SOURCE_KINDS as readonly string[]).includes(String(raw)) ? (raw as Kind) : null);

function must<T>(r: { ok: true; value: T } | { ok: false; error: AppError }): T {
  if (!r.ok) throw r.error;
  return r.value;
}

/** Contrat des résultats du secondaire (donnée du modèle de pack `academic`) dont les codes finaux de fin d'année sont lus. */
export const SECONDARY_CONTRACT_ID = "secondary-annual@1";

/** Codes de proposition qui ne sont jamais une décision finale (structure du contrat, pas une valeur réglementaire). */
const NOT_FINAL = new Set(["COUNCIL_REVIEW", "PENDING"]);

const asDecimal = (v: unknown): string | null => (typeof v === "string" ? v : typeof v === "number" && Number.isFinite(v) ? String(v) : null);
const asInt = (v: unknown): number | null => (typeof v === "number" && Number.isInteger(v) ? v : null);
const asString = (v: unknown): string | null => (typeof v === "string" && v.length > 0 ? v : null);

/** Dernière période d'ENSEIGNEMENT de premier niveau d'une année : là où le bilan de fin d'année est calculé. */
async function lastTeachingPeriodId(academic: AcademicDeps, ctx: RequestContext, academicYearId: string): Promise<string | null> {
  const periods = await listAcademicPeriods(academic, ctx, academicYearId);
  if (!periods.ok) return null;
  const types = await listReference(academic, ctx, "period-types");
  const teaching = new Set((types.ok ? types.value : []).filter((t) => t.kind === "TEACHING_PERIOD").map((t) => t.code));
  const top = periods.value.filter((p) => p.parentPeriodId === null && (teaching.size === 0 || teaching.has(p.periodTypeCode)));
  top.sort((a, b) => a.startsOn.localeCompare(b.startsOn) || a.ordinal - b.ordinal || a.id.localeCompare(b.id));
  return top.at(-1)?.id ?? null;
}

export function createCouncilsResultsRead(input: { results: ResultsDeps; academic: AcademicDeps; rules: RulesApi }): CouncilsResultsReadPort {
  const { results, academic, rules } = input;

  async function periodOf(ctx: RequestContext, q: { academicYearId: string; academicPeriodId: string | null }): Promise<string | null> {
    return q.academicPeriodId ?? (await lastTeachingPeriodId(academic, ctx, q.academicYearId));
  }

  async function sourceKindOfVersion(ctx: RequestContext, ruleVersionId: string) {
    const loaded = await rules.loadVersion(ctx, ruleVersionId);
    return loaded.ok ? kindOf((loaded.value.version.source as { kind?: unknown }).kind) : null;
  }

  return {
    async getStateView(ctx, { classroomId, academicYearId, academicPeriodId }) {
      const periodId = await periodOf(ctx, { academicYearId, academicPeriodId });
      if (!periodId) return null;
      const r = await getPeriodView(results, ctx, { classroomId, academicPeriodId: periodId, caps: READ });
      if (!r.ok) {
        if (r.error.kind === "not_found") return null;
        throw r.error;
      }
      const v = r.value;
      return { stateId: v.state.id, status: v.state.status, ruleVersionRef: `${v.ruleLag.pinned.ruleSetCode}@${v.ruleLag.pinned.ruleVersionNo}`, ruleSourceKind: v.ruleSourceKind ?? kindOf(await sourceKindOfVersion(ctx, v.state.ruleVersionId)) };
    },

    async getEnrollmentFacts(ctx, { classroomId, academicYearId, academicPeriodId, enrollmentIds }) {
      const out = new Map<string, NonNullable<ReturnType<CouncilsResultsReadPort["getEnrollmentFacts"]> extends Promise<ReadonlyMap<string, infer V>> ? V : never>>();
      const periodId = await periodOf(ctx, { academicYearId, academicPeriodId });
      if (!periodId || enrollmentIds.length === 0) return out;
      const yearScope = academicPeriodId === null;
      const matrix = await getClassMatrix(results, ctx, { classroomId, academicPeriodId: periodId, withLines: false, caps: READ });
      if (!matrix.ok) {
        if (matrix.error.kind === "not_found") return out;
        throw matrix.error;
      }
      const view = await getPeriodView(results, ctx, { classroomId, academicPeriodId: periodId, caps: READ });
      const ruleVersionRef = view.ok ? `${view.value.ruleLag.pinned.ruleSetCode}@${view.value.ruleLag.pinned.ruleVersionNo}` : null;
      const ruleSourceKind = view.ok ? (view.value.ruleSourceKind ?? null) : null;
      const appreciations = must(await listAppreciations(results, ctx, { stateId: matrix.value.state.id, caps: READ }));
      // Libellés d'AFFICHAGE des codes proposés : `label_map` de la version de règle épinglée (spec 012). Jamais comparés par la logique ;
      // une version illisible ou sans libellé laisse le code seul (aucun libellé n'est inventé).
      let labelRules: readonly LabelledRule[] = [];
      if (view.ok) {
        const compiled = await rules.loadVersion(ctx, view.value.state.ruleVersionId);
        if (compiled.ok) labelRules = compiled.value.rules;
      }
      const labelled = <T extends { code: string }>(s: T): T & { label?: string } => {
        const label = outputLabelOf(labelRules, s.code);
        return label ? { ...s, label } : s;
      };
      const wanted = new Set(enrollmentIds);
      for (const row of matrix.value.rows) {
        const h = row.header;
        if (!wanted.has(h.enrollmentId)) continue;
        const summary = (h.summary ?? {}) as Record<string, unknown>;
        const annual = (summary.annual ?? null) as Record<string, unknown> | null;
        const useAnnual = yearScope && annual !== null;
        const suggestions: Array<{ kind: "DECISION" | "DISTINCTION" | "APPRECIATION"; code: string; ref: string | null; label?: string }> = [];
        for (const d of matrix.value.decisions.filter((x) => x.enrollmentId === h.enrollmentId && x.status === "PROPOSED" && x.proposedCode !== null)) {
          // La proposition de fin d'année prime pour un bilan ; la proposition de période pour un conseil de période.
          const wantedKind = yearScope ? "YEAR_END" : "COUNCIL";
          if (d.kind === wantedKind && !NOT_FINAL.has(d.proposedCode as string)) suggestions.push(labelled({ kind: "DECISION", code: d.proposedCode as string, ref: ruleVersionRef }));
        }
        const distinction = asString(summary.distinction);
        const appreciation = asString(summary.appreciation);
        if (distinction) suggestions.push(labelled({ kind: "DISTINCTION", code: distinction, ref: ruleVersionRef }));
        if (appreciation) suggestions.push(labelled({ kind: "APPRECIATION", code: appreciation, ref: ruleVersionRef }));
        out.set(h.enrollmentId, {
          status: h.status,
          average: asDecimal(useAnnual ? annual?.average : h.average),
          averageDisplay: asString(useAnnual ? annual?.display : h.averageDisplay),
          rank: asInt(useAnnual ? annual?.rank : h.rank),
          cohortSize: asInt(useAnnual ? annual?.cohortSize : h.cohortSize),
          mentionCode: h.mentionCode,
          missingResults: false, // recalculé par le domaine (statut et moyenne) : jamais décidé ici
          ruleVersionRef,
          ruleSourceKind,
          suggestions,
          appreciations: appreciations.filter((a) => a.enrollmentId === h.enrollmentId).map((a) => ({ authorRole: a.authorRole, curriculumNodeId: a.curriculumNodeId, body: a.body })),
        });
      }
      return out;
    },
  };
}

export function createCouncilsResultsWrite(results: ResultsDeps): CouncilsResultsWritePort {
  const actor = (councilRef: string) => ({ source: "councils" as const, councilRef });

  /** Mise à jour d'une délibération : un état déjà atteint n'est pas une erreur (rejeu, réouverture puis reclôture). */
  async function update(ctx: RequestContext, input: { deliberationId: string; status?: "HELD" | "SIGNED" | "CANCELLED"; heldOn?: string; participants?: ReadonlyArray<{ staffId: string; role: string }> }): Promise<void> {
    const r = await updateDeliberation(results, ctx, { deliberationId: input.deliberationId, ...(input.status ? { status: input.status } : {}), ...(input.heldOn ? { heldOn: input.heldOn } : {}), ...(input.participants ? { participants: input.participants } : {}), caps: WRITE });
    if (r.ok) return;
    if (input.status && r.error.code === "results.invalid_state_transition") {
      // déjà dans cet état (ou plus avancé) : seules les informations de séance sont rafraîchies
      if (input.heldOn || input.participants) must(await updateDeliberation(results, ctx, { deliberationId: input.deliberationId, ...(input.heldOn ? { heldOn: input.heldOn } : {}), ...(input.participants ? { participants: input.participants } : {}), caps: WRITE }));
      return;
    }
    throw r.error;
  }

  return {
    async openDeliberation(ctx, { stateId, heldOn, participants, councilRef }) {
      const existing = must(await listDeliberations(results, ctx, { stateId, caps: READ })).find((d) => d.kind === "COUNCIL" && d.status !== "CANCELLED");
      if (existing) return { deliberationId: existing.id };
      const d = must(await openCouncilDeliberation(results, ctx, { stateId, heldOn, participants: participants.map((p) => ({ staffId: p.staffId, role: p.role })), actor: actor(councilRef) }));
      return { deliberationId: d.id };
    },
    async markDeliberationHeld(ctx, { deliberationId, heldOn, participants, councilRef }) {
      const r = await markDeliberationHeld(results, ctx, { deliberationId, heldOn, participants: participants.map((p) => ({ staffId: p.staffId, role: p.role })), actor: actor(councilRef) });
      if (r.ok) return;
      if (r.error.code === "results.invalid_state_transition") {
        await update(ctx, { deliberationId, heldOn, participants });
        return;
      }
      throw r.error;
    },
    async markDeliberationSigned(ctx, { deliberationId, heldOn }) {
      await update(ctx, { deliberationId, status: "SIGNED", heldOn });
    },
    async cancelDeliberation(ctx, { deliberationId }) {
      await update(ctx, { deliberationId, status: "CANCELLED" });
    },
    async publishYearDecision(ctx, { stateId, enrollmentId, finalCode, deliberationId, justification, councilRef }) {
      const d = must(await publishYearDecision(results, ctx, { stateId, enrollmentId, finalCode, ...(deliberationId ? { deliberationId } : {}), ...(justification ? { justification } : {}), actor: actor(councilRef) }));
      return { decisionId: d.id };
    },
    async recordDistinction(ctx, { stateId, enrollmentId, distinctionCode, scope, deliberationId, councilRef }) {
      const d = must(await recordDistinction(results, ctx, { stateId, enrollmentId, distinctionCode, scope, ...(deliberationId ? { deliberationId } : {}), actor: actor(councilRef) }));
      return { decisionId: d.id };
    },
    async withdrawDecision(ctx, { decisionId, reason, councilRef }) {
      must(await withdrawCouncilDecision(results, ctx, { decisionId, reason, actor: actor(councilRef) }));
    },
    async writeAppreciation(ctx, { stateId, enrollmentId, authorStaffId, body, councilRef }) {
      const a = must(await writeCouncilAppreciation(results, ctx, { stateId, enrollmentId, authorStaffId, body, actor: actor(councilRef) }));
      return { appreciationId: a.id };
    },
  };
}

export function createCouncilsRuleCodes(rules: RulesApi): CouncilsRuleCodesPort {
  return {
    async allowedYearEndCodes() {
      const contract = rules.getContract(SECONDARY_CONTRACT_ID);
      const rule = contract?.rules.find((r) => r.key === "decision_fin_annee");
      if (!rule) return null; // contrat non publié : aucun code ne peut être contrôlé ici (results revalide à l'application)
      return (rule.outputCodes ?? []).filter((c) => !NOT_FINAL.has(c));
    },
  };
}

