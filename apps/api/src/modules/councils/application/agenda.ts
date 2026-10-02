/**
 * Ordre du jour : un élément PAR INSCRIPTION ACTIVE de la classe, avec l'instantané `council-facts/1` figé (spec 006 US1).
 *
 *  - COMPOSITION, PAS DUPLICATION : les résultats, absences et comptages de vie scolaire sont LUS par des ports ; le module n'en garde
 *    qu'un instantané hashé (le hash et la version sont posés par la base) et ne calcule aucune valeur.
 *  - Rejouer la préparation est IDEMPOTENT : la version de l'instantané n'augmente que si son contenu change ; un élève dont des
 *    décisions reposent sur l'instantané n'est jamais reconstruit (`councils.facts_locked_by_decision`).
 *  - Les suggestions des règles deviennent des propositions `RULE_SUGGESTION` (jamais acceptées automatiquement).
 *  - Échec fermé : sans le port `results`, la préparation est refusée ; un port d'assiduité ou de vie scolaire indisponible dégrade
 *    l'instantané (`attendance: null`, avertissement) sans rien inventer.
 */
import { err, isAppError, ok, type AppError, type RequestContext, type Result } from "@ecoledigitale/kernel";
import type { Tx } from "@ecoledigitale/database";
import type { CouncilsAgendaDto, CouncilsAgendaItemDetailDto, CouncilsAgendaItemDto, CouncilsFacts, CouncilsPrepareReportDto } from "@ecoledigitale/contracts/src/v2/councils";
import { buildFacts, isFirmSuggestion, type AttendanceFacts, type DisciplineFacts, type ResultsFacts } from "../domain/facts";
import { CouncilsCode, conflict, forbidden, notFound } from "../domain/errors";
import * as repo from "../infrastructure/councils-repository";
import * as reference from "../infrastructure/reference-repository";
import type { AgendaItemRow, CouncilRow } from "../infrastructure/rows";
import { EventBuffer, inTx, requireHuman, todayOf, type CallerCaps, type CouncilsDeps } from "./deps";
import type { RosterEntry } from "./ports";
import { assertMayView, loadCouncil, ruleSourceOf } from "./support";
import { agendaItemDto, decisionDto, factsOf, proposalDto } from "./views";

interface Warning {
  code: string;
  message: string;
}

const degrade = async <T>(label: string, warnings: Warning[], code: string, fn: () => Promise<T | null>): Promise<T | null> => {
  try {
    return await fn();
  } catch (e) {
    if (!isAppError(e)) throw e;
    if (!warnings.some((w) => w.code === code)) warnings.push({ code, message: `${label} indisponible : l'instantané est préparé sans cette donnée.` });
    return null;
  }
};

/** Assemble les faits d'un élève depuis les ports (lectures SÉQUENTIELLES : une seule connexion par transaction). */
async function factsOfEnrollment(deps: CouncilsDeps, ctx: RequestContext, council: CouncilRow, entry: RosterEntry, results: ResultsFacts | undefined, warnings: Warning[]): Promise<CouncilsFacts> {
  const attendance: AttendanceFacts | null = await degrade("L'assiduité", warnings, "attendance_unavailable", () => deps.ports.attendance.summarize(ctx, { enrollmentId: entry.enrollmentId, academicYearId: council.academicYearId, academicPeriodId: council.academicPeriodId }));
  const discipline: DisciplineFacts | null = await degrade("La vie scolaire", warnings, "schoollife_unavailable", () => deps.ports.schoollife.disciplineFacts(ctx, { enrollmentId: entry.enrollmentId, studentId: entry.studentId, academicYearId: council.academicYearId }));
  return buildFacts({ results: results ?? null, attendance, discipline, funding: { type: entry.fundingType, stateAssigned: entry.stateAssigned }, repeating: entry.isRepeating });
}

/** Les suggestions fermes de la règle deviennent des propositions `RULE_SUGGESTION` (sans auteur, jamais acceptées sans humain). */
async function ensureRuleSuggestions(deps: CouncilsDeps, ctx: RequestContext, tx: Tx, council: CouncilRow, item: AgendaItemRow, facts: CouncilsFacts): Promise<void> {
  const known = await repo.listRuleSuggestions(tx, item.id);
  for (const s of facts.results?.suggestions ?? []) {
    if (s.kind === "DECISION" && !isFirmSuggestion(s.code)) continue;
    if (known.some((k) => k.kind === s.kind && k.code === s.code)) continue;
    await repo.insertProposal(tx, { id: deps.newId(), tenantId: ctx.tenantId, councilId: council.id, agendaItemId: item.id, kind: s.kind, code: s.code, body: s.kind === "APPRECIATION" ? s.code : null, origin: "RULE_SUGGESTION", proposedBy: null, proposedByName: null, ruleVersionRef: s.ref });
  }
}

/** Sérialisation à clés triées : `jsonb` ne conserve pas l'ordre d'insertion des clés, la comparaison doit y être indifférente. */
const canonical = (v: unknown): string =>
  JSON.stringify(v, (_k, value: unknown) => (value && typeof value === "object" && !Array.isArray(value) ? Object.fromEntries(Object.entries(value as Record<string, unknown>).sort(([x], [y]) => (x < y ? -1 : x > y ? 1 : 0))) : value));
const sameFacts = (a: unknown, b: unknown): boolean => canonical(a) === canonical(b);

export async function prepareCouncil(deps: CouncilsDeps, ctx: RequestContext, caps: CallerCaps, councilId: string): Promise<Result<CouncilsPrepareReportDto, AppError>> {
  const human = requireHuman(ctx);
  if (!human.ok) return human;
  return inTx(deps, ctx, async (tx) => {
    const loaded = await loadCouncil(tx, councilId, { lock: true });
    if (!loaded.ok) return loaded;
    const council = loaded.value;
    if (council.status !== "PLANNED" && council.status !== "OPEN") return err(conflict(CouncilsCode.INVALID_STATE, `L'ordre du jour d'une séance ${council.status} est figé.`));
    if (!caps.prepare && !caps.manage) return err(forbidden(CouncilsCode.PERMISSION_REQUIRED, "Préparer l'ordre du jour exige l'autorisation de préparation."));
    const warnings: Warning[] = [];
    const roster = await deps.ports.academic.getRoster(ctx, council.classroomId, council.heldOn ?? todayOf(deps));
    // Échec fermé : sans `results`, aucune préparation (aucune donnée de remplacement n'est inventée).
    const results = await deps.ports.resultsRead.getEnrollmentFacts(ctx, { classroomId: council.classroomId, academicYearId: council.academicYearId, academicPeriodId: council.academicPeriodId, enrollmentIds: roster.map((r) => r.enrollmentId) });
    const existing = new Map((await repo.listAgendaItems(tx, councilId)).map((i) => [i.enrollmentId, i]));
    const ordered = [...roster].sort((a, b) => (a.displayName ?? "").localeCompare(b.displayName ?? "", "fr") || a.enrollmentId.localeCompare(b.enrollmentId));
    let created = 0;
    let rebuilt = 0;
    let unchanged = 0;
    let skipped = 0;
    let position = 0;
    for (const entry of ordered) {
      position += 1;
      const name = entry.displayName ?? "Élève";
      const facts = await factsOfEnrollment(deps, ctx, council, entry, results.get(entry.enrollmentId), warnings);
      if (!results.has(entry.enrollmentId) && !warnings.some((w) => w.code === "results_missing")) warnings.push({ code: "results_missing", message: "Des élèves n'ont aucun résultat exploitable : ils sont signalés « résultats manquants »." });
      const item = existing.get(entry.enrollmentId);
      if (!item) {
        const id = deps.newId();
        await repo.insertAgendaItem(tx, { id, tenantId: ctx.tenantId, councilId, enrollmentId: entry.enrollmentId, studentId: entry.studentId, studentDisplayName: name, position, facts, ruleVersionRef: facts.results?.ruleVersionRef ?? null });
        await ensureRuleSuggestions(deps, ctx, tx, council, (await repo.getAgendaItem(tx, id)) as AgendaItemRow, facts);
        created += 1;
        continue;
      }
      const counts = (await repo.agendaCounts(tx, councilId)).get(item.id);
      if ((counts?.decisionCount ?? 0) > 0) {
        skipped += 1;
        continue;
      }
      if (sameFacts(item.facts, facts) && item.studentDisplayName === name) {
        unchanged += 1;
      } else {
        await repo.updateAgendaFacts(tx, item.id, facts, facts.results?.ruleVersionRef ?? null, name, position);
        rebuilt += 1;
      }
      await ensureRuleSuggestions(deps, ctx, tx, council, item, facts);
    }
    // Élèves qui ont quitté la classe : retirés tant que la séance est planifiée et qu'aucune décision n'y repose.
    const present = new Set(roster.map((r) => r.enrollmentId));
    for (const item of existing.values()) {
      if (present.has(item.enrollmentId)) continue;
      const counts = (await repo.agendaCounts(tx, councilId)).get(item.id);
      if (council.status === "PLANNED" && (counts?.decisionCount ?? 0) === 0 && (counts?.pendingProposals ?? 0) === 0) await repo.deleteAgendaItem(tx, item.id);
      else warnings.push({ code: "enrollment_left", message: `${item.studentDisplayName} ne figure plus dans la classe : à examiner avant la clôture.` });
    }
    const ev = new EventBuffer(deps, ctx);
    ev.audit({ action: "councils.agenda.prepared", resourceType: "council", resourceId: councilId, after: { created, rebuilt, unchanged, skipped } });
    await ev.flush(tx);
    return ok({ councilId, created, rebuilt, unchanged, skipped, warnings });
  });
}

async function loadItem(tx: Tx, itemId: string, options: { lock?: boolean } = {}): Promise<Result<{ item: AgendaItemRow; council: CouncilRow }, AppError>> {
  const item = await repo.getAgendaItem(tx, itemId, options);
  if (!item) return err(notFound(CouncilsCode.NOT_FOUND, "Élève de l'ordre du jour", itemId));
  const council = await repo.getCouncil(tx, item.councilId, options);
  return council ? ok({ item, council }) : err(notFound(CouncilsCode.NOT_FOUND, "Conseil", item.councilId));
}

export async function getAgenda(deps: CouncilsDeps, ctx: RequestContext, caps: CallerCaps, councilId: string): Promise<Result<CouncilsAgendaDto, AppError>> {
  return inTx(
    deps,
    ctx,
    async (tx) => {
      const loaded = await loadCouncil(tx, councilId);
      if (!loaded.ok) return loaded;
      const may = await assertMayView(deps, ctx, caps, loaded.value);
      if (!may.ok) return may;
      const counts = await repo.agendaCounts(tx, councilId);
      return ok({ councilId, status: loaded.value.status, items: (await repo.listAgendaItems(tx, councilId)).map((i) => agendaItemDto(i, counts.get(i.id))) });
    },
    { readOnly: true },
  );
}

/** Fiche d'un élève : faits figés (version, empreinte), propositions (dont les suggestions de la règle) et décisions. */
export async function getAgendaItemDetail(deps: CouncilsDeps, ctx: RequestContext, caps: CallerCaps, itemId: string): Promise<Result<CouncilsAgendaItemDetailDto, AppError>> {
  return inTx(
    deps,
    ctx,
    async (tx) => {
      const loaded = await loadItem(tx, itemId);
      if (!loaded.ok) return loaded;
      const may = await assertMayView(deps, ctx, caps, loaded.value.council);
      if (!may.ok) return may;
      return ok(await itemDetail(deps, ctx, tx, loaded.value.item, loaded.value.council));
    },
    { readOnly: true },
  );
}

export async function itemDetail(deps: CouncilsDeps, ctx: RequestContext, tx: Tx, item: AgendaItemRow, council: CouncilRow): Promise<CouncilsAgendaItemDetailDto> {
  const counts = (await repo.agendaCounts(tx, council.id)).get(item.id);
  const types = new Map((await reference.listDecisionTypes(tx)).map((t) => [t.id, t]));
  const participants = new Map((await repo.listParticipants(tx, council.id)).map((p) => [p.id, p]));
  const decisions = (await repo.listDecisionsOfItem(tx, item.id)).map((d) => decisionDto(d, { typeLabel: types.get(d.decisionTypeId)?.label ?? null, deciderName: participants.get(d.deciderParticipantId)?.displayName ?? null }));
  return {
    item: agendaItemDto(item, counts),
    facts: factsOf(item),
    proposals: (await repo.listProposals(tx, item.id)).map(proposalDto),
    decisions,
    councilStatus: council.status,
    ruleSourceKind: await ruleSourceOf(deps, ctx, council),
  };
}

/** Reconstruit l'instantané d'UN élève (refusé dès qu'une décision enregistrée s'appuie sur lui). */
export async function rebuildAgendaItem(deps: CouncilsDeps, ctx: RequestContext, caps: CallerCaps, itemId: string): Promise<Result<CouncilsAgendaItemDetailDto, AppError>> {
  const human = requireHuman(ctx);
  if (!human.ok) return human;
  return inTx(deps, ctx, async (tx) => {
    const loaded = await loadItem(tx, itemId, { lock: true });
    if (!loaded.ok) return loaded;
    const { item, council } = loaded.value;
    if (council.status !== "PLANNED" && council.status !== "OPEN") return err(conflict(CouncilsCode.INVALID_STATE, `L'ordre du jour d'une séance ${council.status} est figé.`));
    if (!caps.prepare && !caps.manage) return err(forbidden(CouncilsCode.PERMISSION_REQUIRED, "Reconstruire un instantané exige l'autorisation de préparation."));
    const counts = (await repo.agendaCounts(tx, council.id)).get(item.id);
    if ((counts?.decisionCount ?? 0) > 0) return err(conflict("councils.facts_locked_by_decision", "Des décisions reposent sur cet instantané : retirez-les avant de le reconstruire."));
    const roster = await deps.ports.academic.getRoster(ctx, council.classroomId, council.heldOn ?? todayOf(deps));
    const entry = roster.find((r) => r.enrollmentId === item.enrollmentId);
    if (!entry) return err(notFound(CouncilsCode.ENROLLMENT_NOT_FOUND, "Inscription active de la classe", item.enrollmentId));
    const results = await deps.ports.resultsRead.getEnrollmentFacts(ctx, { classroomId: council.classroomId, academicYearId: council.academicYearId, academicPeriodId: council.academicPeriodId, enrollmentIds: [item.enrollmentId] });
    const warnings: Warning[] = [];
    const facts = await factsOfEnrollment(deps, ctx, council, entry, results.get(item.enrollmentId), warnings);
    await repo.updateAgendaFacts(tx, item.id, facts, facts.results?.ruleVersionRef ?? null, entry.displayName ?? item.studentDisplayName, item.position);
    const fresh = (await repo.getAgendaItem(tx, item.id)) as AgendaItemRow;
    await ensureRuleSuggestions(deps, ctx, tx, council, fresh, facts);
    const ev = new EventBuffer(deps, ctx);
    ev.audit({ action: "councils.agenda_item.rebuilt", resourceType: "agenda_item", resourceId: item.id, after: { factsVersion: fresh.factsVersion } });
    await ev.flush(tx);
    return ok(await itemDetail(deps, ctx, tx, fresh, council));
  });
}

/** Marque un élève « examiné » (jamais « décidé » à la main : cet état est posé par la base dès qu'une décision est enregistrée). */
export async function reviewAgendaItem(deps: CouncilsDeps, ctx: RequestContext, caps: CallerCaps, itemId: string): Promise<Result<CouncilsAgendaItemDto, AppError>> {
  const human = requireHuman(ctx);
  if (!human.ok) return human;
  return inTx(deps, ctx, async (tx) => {
    const loaded = await loadItem(tx, itemId, { lock: true });
    if (!loaded.ok) return loaded;
    const { item, council } = loaded.value;
    if (!caps.prepare && !caps.manage) return err(forbidden(CouncilsCode.PERMISSION_REQUIRED, "Marquer un élève examiné exige l'autorisation de préparation."));
    if (council.status !== "PLANNED" && council.status !== "OPEN") return err(conflict(CouncilsCode.INVALID_STATE, `L'ordre du jour d'une séance ${council.status} est figé.`));
    if (item.status === "DECIDED") return err(conflict(CouncilsCode.INVALID_STATE, "Cet élève est déjà décidé."));
    await repo.setAgendaStatus(tx, itemId, item.status === "REVIEWED" ? "PENDING" : "REVIEWED");
    const fresh = (await repo.getAgendaItem(tx, itemId)) as AgendaItemRow;
    return ok(agendaItemDto(fresh, (await repo.agendaCounts(tx, council.id)).get(itemId)));
  });
}
