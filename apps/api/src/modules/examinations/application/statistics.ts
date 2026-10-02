/**
 * STATISTIQUES : compteurs en SQL (`result_counts`, regroupement en liste blanche, sous la RLS de l'appelant) ; TAUX de réussite
 * calculé par la RÈGLE `taux_reussite` de la version épinglée à la session — dont le dénominateur (présents ou inscrits) est un
 * PARAMÈTRE de la règle, jamais du code (la définition officielle est une question métier, Q-E08). Dénominateur nul : valeur
 * absente (jamais 100 %). Sans règle épinglée, les compteurs restent disponibles et le taux est indiqué indisponible.
 */
import { err, ok, type AppError, type RequestContext, type Result } from "@ecoledigitale/kernel";
import type { ExamCountGroup, ExamStatisticsDto, ExamStatisticsGroupDto } from "@ecoledigitale/contracts/src/v2/examinations";
import { ExamCode, notFound, validation } from "../domain/errors";
import { COUNT_GROUPS, type CountsRow, type SessionRow } from "../domain/types";
import * as ref from "../infrastructure/reference-repo";
import * as sess from "../infrastructure/sessions-repo";
import { inTx, type ExaminationsDeps } from "./deps";
import type { RuleSession } from "./ports";

interface Rated {
  groups: ExamStatisticsGroupDto[];
  total: ExamStatisticsGroupDto;
  rateAvailable: boolean;
  rateNote: string | null;
  demoRules: boolean;
}

const emptyCounts = (groupKey: string): CountsRow => ({ groupKey, registered: 0, present: 0, admitted: 0, failed: 0, absent: 0, excluded: 0, deferred: 0 });

function rateOf(rule: RuleSession | null, c: CountsRow): string | null {
  if (!rule) return null;
  const [r] = rule.evaluate([{ ruleKey: "taux_reussite", variables: { admis: String(c.admitted), presents: String(c.present), inscrits: String(c.registered) } }]);
  return r && r.ok && typeof r.value === "string" ? r.value : null;
}

async function openRule(deps: ExaminationsDeps, ctx: RequestContext, s: SessionRow): Promise<{ rule: RuleSession | null; note: string | null }> {
  if (!s.ruleVersionRef) return { rule: null, note: "Aucune version de la règle « taux de réussite » n'est épinglée à cette session : seuls les compteurs sont fournis." };
  try {
    const opened = await deps.ports.rules.open(ctx, s.ruleVersionRef);
    if (!opened.ok) return { rule: null, note: `La règle « taux de réussite » est indisponible (${opened.error.code}) : seuls les compteurs sont fournis.` };
    return { rule: opened.value, note: null };
  } catch {
    return { rule: null, note: "La règle « taux de réussite » est indisponible : seuls les compteurs sont fournis." };
  }
}

async function ratedCounts(deps: ExaminationsDeps, ctx: RequestContext, s: SessionRow, typeSourceKind: string, groupBy: ExamCountGroup): Promise<Result<Rated, AppError>> {
  const loaded = await inTx(
    deps,
    ctx,
    async (tx) => ok({ groups: await sess.resultCounts(tx, s.id, groupBy), all: await sess.resultCounts(tx, s.id, "ALL") }),
    { readOnly: true },
  );
  if (!loaded.ok) return loaded;
  const { rule, note } = await openRule(deps, ctx, s);
  const dto = (c: CountsRow): ExamStatisticsGroupDto => ({ ...c, rate: rateOf(rule, c) });
  return ok({
    groups: loaded.value.groups.map(dto),
    total: dto(loaded.value.all[0] ?? emptyCounts("ALL")),
    rateAvailable: rule !== null,
    rateNote: note,
    demoRules: typeSourceKind === "placeholder" || s.sourceKind === "placeholder" || rule?.pin.sourceKind === "placeholder",
  });
}

export async function getStatistics(deps: ExaminationsDeps, ctx: RequestContext, sessionId: string, input: { groupBy: ExamCountGroup; compare?: "previous_year" | "mock" | undefined }): Promise<Result<ExamStatisticsDto, AppError>> {
  if (!(COUNT_GROUPS as readonly string[]).includes(input.groupBy)) return err(validation(ExamCode.GROUP_UNKNOWN, "Regroupement inconnu.", "groupBy"));
  const base = await inTx(
    deps,
    ctx,
    async (tx) => {
      const s = await sess.getSession(tx, sessionId);
      if (!s) return err(notFound(ExamCode.SESSION_NOT_FOUND, "Session d'examen", sessionId));
      const type = await ref.getType(tx, s.examTypeId);
      let other: SessionRow | null = null;
      let label = "";
      if (input.compare === "previous_year") {
        other = await sess.findPreviousSession(tx, { examTypeId: s.examTypeId, institutionId: s.institutionId, sessionYear: s.sessionYear, id: s.id, sessionKind: s.sessionKind });
        label = other ? `Édition précédente (${other.sessionYear})` : "";
      } else if (input.compare === "mock") {
        other = s.sessionKind === "OFFICIAL" ? await sess.findMockOf(tx, s.id) : s.mockOfSessionId ? await sess.getSession(tx, s.mockOfSessionId) : null;
        label = other ? (other.sessionKind === "MOCK" ? `Examen blanc « ${other.label} »` : `Session officielle « ${other.label} »`) : "";
      }
      return ok({ s, typeKind: type?.sourceKind ?? "institution", other, label });
    },
    { readOnly: true },
  );
  if (!base.ok) return base;
  const { s, typeKind, other, label } = base.value;
  const main = await ratedCounts(deps, ctx, s, typeKind, input.groupBy);
  if (!main.ok) return main;
  let compare: ExamStatisticsDto["compare"] = null;
  if (other) {
    const c = await ratedCounts(deps, ctx, other, typeKind, input.groupBy);
    if (c.ok) compare = { label, sessionId: other.id, groups: c.value.groups, total: c.value.total };
  }
  return ok({ sessionId: sessionId, groupBy: input.groupBy, groups: main.value.groups, total: main.value.total, rateAvailable: main.value.rateAvailable, rateNote: main.value.rateNote, demoRules: main.value.demoRules, compare });
}

/** Lignes de statistiques pour un export (compteurs + taux) : mêmes valeurs que l'écran. */
export async function statisticsRows(deps: ExaminationsDeps, ctx: RequestContext, sessionId: string, groupBy: ExamCountGroup): Promise<Result<ExamStatisticsGroupDto[], AppError>> {
  const r = await getStatistics(deps, ctx, sessionId, { groupBy });
  return r.ok ? ok([...r.value.groups, ...(groupBy === "ALL" ? [] : [{ ...r.value.total, groupKey: "TOTAL" }])]) : r;
}
