/**
 * Émission des documents : contrôle préalable, lots (un snapshot par inscription), réémission, relevé cumulé (spec 013 US1,
 * US3, US7). Les résultats viennent du module `results` PAR PORT et ne sont jamais recalculés ici (R-RC-12).
 *
 * Chaînage d'une émission : lecture des ports (hors transaction) -> UNE transaction qui écrit snapshot + index de vérification
 * + événements d'outbox + audit. Dans un lot, chaque inscription s'exécute dans un SAVEPOINT : une inscription en erreur est
 * rapportée sans faire échouer le lot (AC1.3). Relancer un lot (même clé d'idempotence) ne crée aucun doublon (AC1.2).
 */
import { err, ok, type AppError, type RequestContext, type Result } from "@ecoledigitale/kernel";
import { isUniqueViolation, type Tx } from "@ecoledigitale/database";
import { REPORTCARDS_PACK_LIST } from "../domain/constants";
import { ReportcardsCode, conflict, invalid, notFound } from "../domain/errors";
import { ReportcardsEvents } from "../domain/events";
import { canReissue } from "../domain/lifecycle";
import { generateVerificationCode } from "../domain/signing";
import { buildSnapshot } from "../domain/snapshot";
import type { BatchItemRecord, BatchRecord, DocumentKind, FinalResultBundle, PeriodState, ReportCardRecord, RosterEntry, Scope, Uuid } from "../domain/types";
import * as batchRepo from "../infrastructure/batches-repository";
import * as cardsRepo from "../infrastructure/cards-repository";
import { FIX, hasBlocking, loadIssuingContext, type IssuingContext, type PreflightIssue } from "./context";
import { EventBuffer, actorLabel, inTx, todayOf, type ReportcardsDeps } from "./deps";
import { ensureSigningKeyRegistered } from "./platform";

export const ISSUE_CODES = {
  PERIOD_UNKNOWN: "reportcards.period_unknown",
  PERIOD_NOT_CLOSED: ReportcardsCode.PERIOD_NOT_CLOSED,
  DELIBERATION_REQUIRED: ReportcardsCode.DELIBERATION_REQUIRED,
  SIGNING_KEY_MISSING: ReportcardsCode.SIGNING_KEY_MISSING,
  VERIFICATION_URL_MISSING: "reportcards.verification_url_missing",
  NO_ELIGIBLE: "reportcards.no_eligible_enrollment",
  EXCLUDED_ERROR: "reportcards.enrollment_result_error",
  EXCLUDED_MISSING: "reportcards.enrollment_no_final_result",
} as const;

export interface PreflightInput {
  classroomId: Uuid;
  academicPeriodId: Uuid;
  kind?: DocumentKind;
  provisional?: boolean;
}

export interface PreflightView {
  ok: boolean;
  issues: PreflightIssue[];
  resultsVersion: number | null;
  enrollments: { total: number; eligible: number; excluded: number };
}

interface Gathered {
  state: PeriodState;
  roster: readonly RosterEntry[];
  ic: IssuingContext;
  issues: PreflightIssue[];
}

async function gather(deps: ReportcardsDeps, ctx: RequestContext, input: PreflightInput): Promise<Result<Gathered, AppError>> {
  const kind = input.kind ?? "REPORT_CARD";
  const provisional = input.provisional === true;
  const state = await deps.ports.results.getPeriodState(ctx, { classroomId: input.classroomId, academicPeriodId: input.academicPeriodId });
  if (!state) return err(notFound("Période de la classe", input.academicPeriodId));
  if (!REPORTCARDS_PACK_LIST.includes(state.pack)) return err(invalid("Pack de la classe inconnu.", ReportcardsCode.INVALID_TEMPLATE));
  const roster = await deps.ports.results.listRoster(ctx, { classroomId: input.classroomId, academicPeriodId: input.academicPeriodId });
  const loaded = await inTx(
    deps,
    ctx,
    async (tx) => ok(await loadIssuingContext(tx, { institutionId: state.institutionId, documentKind: kind, pack: state.pack, onDate: todayOf(deps) })),
    { readOnly: true },
  );
  if (!loaded.ok) return loaded;
  const ic = loaded.value;
  const issues: PreflightIssue[] = [...ic.issues];
  if (!provisional && state.status !== "CLOSED") {
    issues.push({ code: ISSUE_CODES.PERIOD_NOT_CLOSED, message: "La période n'est pas clôturée pour cette classe : les bulletins définitifs s'émettent à partir de résultats clôturés.", blocking: true, fixHref: FIX.results });
  }
  if (!provisional && ic.settings.requireDeliberation && !state.deliberationHeld) {
    issues.push({ code: ISSUE_CODES.DELIBERATION_REQUIRED, message: "La délibération (conseil de classe ou jury) n'a pas été tenue pour cette période.", blocking: true, fixHref: FIX.results });
  }
  if (!deps.keys) issues.push({ code: ISSUE_CODES.SIGNING_KEY_MISSING, message: "Aucune clé de signature n'est configurée sur le serveur.", blocking: true, fixHref: null });
  if (!provisional && !deps.config.verificationBaseUrl) {
    issues.push({ code: ISSUE_CODES.VERIFICATION_URL_MISSING, message: "Le domaine public de vérification des documents n'est pas configuré.", blocking: true, fixHref: null });
  }
  const eligible = roster.filter((r) => r.outcome === "FINAL").length;
  const errored = roster.filter((r) => r.outcome === "ERROR").length;
  const missing = roster.filter((r) => r.outcome === "MISSING").length;
  if (errored) issues.push({ code: ISSUE_CODES.EXCLUDED_ERROR, message: `${errored} inscription(s) en erreur de calcul seront exclues du lot.`, blocking: false, fixHref: FIX.results });
  if (missing) issues.push({ code: ISSUE_CODES.EXCLUDED_MISSING, message: `${missing} inscription(s) sans résultat définitif seront exclues du lot.`, blocking: false, fixHref: FIX.results });
  if (eligible === 0) issues.push({ code: ISSUE_CODES.NO_ELIGIBLE, message: "Aucune inscription n'a de résultat définitif à émettre.", blocking: true, fixHref: FIX.results });
  return ok({ state, roster, ic, issues });
}

/** Contrôle préalable (AC1.1) : chaque manque est listé avec son lien de correction ; rien n'est écrit. */
export async function preflight(deps: ReportcardsDeps, ctx: RequestContext, input: PreflightInput): Promise<Result<PreflightView, AppError>> {
  const g = await gather(deps, ctx, input);
  if (!g.ok) return g;
  const eligible = g.value.roster.filter((r) => r.outcome === "FINAL").length;
  return ok({
    ok: !hasBlocking(g.value.issues),
    issues: g.value.issues,
    resultsVersion: g.value.state.resultsVersion,
    enrollments: { total: g.value.roster.length, eligible, excluded: g.value.roster.length - eligible },
  });
}

// ---------------------------------------------------------------------------
// Émission d'un snapshot (partagée)
// ---------------------------------------------------------------------------

interface IssueParams {
  kind: DocumentKind;
  scope: Scope;
  provisional: boolean;
  bundle: FinalResultBundle;
  ic: IssuingContext;
  issuedAt: Date;
  issuer: { id: Uuid | null; name: string };
  supersedes: ReportCardRecord | null;
  version: number;
  supersedeReason: string | null;
  batchId: Uuid | null;
}

/** Construit, signe et insère le snapshot ; inscrit le code dans l'index public ; prépare les événements. */
async function issueSnapshot(deps: ReportcardsDeps, tx: Tx, ctx: RequestContext, events: EventBuffer, p: IssueParams): Promise<Result<ReportCardRecord, AppError>> {
  const { ic } = p;
  if (!ic.branding || !ic.config || !ic.template || !ic.options) return err(conflict("Configuration d'émission incomplète.", ReportcardsCode.PREFLIGHT_FAILED));
  if (!deps.keys) return err(conflict("Aucune clé de signature n'est configurée.", ReportcardsCode.SIGNING_KEY_MISSING));
  const built = buildSnapshot({
    kind: p.kind,
    scope: p.scope,
    version: p.version,
    provisional: p.provisional,
    issuedAt: p.issuedAt,
    issuedBy: p.issuer,
    bundle: p.bundle,
    branding: ic.branding,
    signatories: ic.signatories,
    template: { key: ic.template.key, version: ic.template.version, configVersion: ic.config.configVersion, options: ic.options },
  });
  if (!built.ok) return err(invalid("Les résultats ne produisent pas un snapshot valide.", ReportcardsCode.INVALID_SNAPSHOT, { issues: built.issues }));
  const code = generateVerificationCode();
  const signature = deps.keys.sign({ snapshotHash: built.hash, verificationCode: code, issuedAt: p.issuedAt });
  const b = p.bundle;
  const card = await cardsRepo.insertCard(tx, {
    id: deps.newId(),
    tenantId: ctx.tenantId,
    documentKind: p.kind,
    enrollmentId: b.enrollment.id,
    studentId: b.student.id,
    classroomId: b.enrollment.classroomId,
    academicYearId: b.enrollment.academicYearId,
    academicPeriodId: b.enrollment.periodId,
    scope: p.scope,
    version: p.version,
    provisional: p.provisional,
    snapshot: built.snapshot,
    explain: built.explain,
    snapshotHash: built.hash,
    ruleSetCode: b.rules.ruleSetCode,
    ruleVersionId: b.rules.ruleVersionId,
    ruleVersionNo: b.rules.ruleVersionNo,
    definitionHash: b.rules.definitionHash,
    resultsStateId: b.rules.resultsStateId,
    resultsVersion: b.rules.resultsVersion,
    closureHash: b.rules.closureHash,
    templateKey: ic.template.key,
    templateVersion: ic.template.version,
    configVersion: ic.config.configVersion,
    verificationCode: code,
    signingKeyId: deps.keys.keyId,
    signature,
    issuedAt: p.issuedAt,
    issuedBy: p.issuer.id,
    issuedByName: p.issuer.name,
    supersedesId: p.supersedes?.id ?? null,
    supersedeReason: p.supersedeReason,
    batchId: p.batchId,
  });
  if (!p.provisional) await cardsRepo.registerVerification(tx, { code, tenantId: ctx.tenantId, documentKind: p.kind, documentId: card.id });
  events.add(
    ReportcardsEvents.SNAPSHOT_CREATED,
    { v: 1, reportCardId: card.id, enrollmentId: card.enrollmentId, studentId: card.studentId, periodId: card.academicPeriodId, kind: card.documentKind, version: card.version, snapshotHash: card.snapshotHash, batchId: card.batchId, provisional: card.provisional },
    { type: "report_card", id: card.id },
  );
  if (p.supersedes && (p.supersedes.status === "ISSUED" || p.supersedes.status === "PUBLISHED")) {
    events.add(
      ReportcardsEvents.SUPERSEDED,
      { v: 1, reportCardId: p.supersedes.id, newReportCardId: card.id, studentId: card.studentId, reason: p.supersedeReason ?? "" },
      { type: "report_card", id: p.supersedes.id },
    );
  }
  return ok(card);
}

/**
 * Résultats FINAL d'une inscription (port `results`) + absences lues au moment de l'émission (port `attendance`, qui prime sur
 * celles que le bundle porterait) : tout est figé dans le snapshot, jamais relu au rendu (spec 013 §5, parité P-RC-07).
 */
async function readBundle(deps: ReportcardsDeps, ctx: RequestContext, enrollmentId: Uuid, academicPeriodId: Uuid): Promise<FinalResultBundle | null> {
  const bundle = await deps.ports.results.getFinalBundle(ctx, { enrollmentId, academicPeriodId });
  if (!bundle || !deps.ports.attendance) return bundle;
  const summary = await deps.ports.attendance.getSummary(ctx, { enrollmentId, academicPeriodId });
  return summary ? { ...bundle, attendance: { justifiedMinutes: summary.justifiedMinutes, unjustifiedMinutes: summary.unjustifiedMinutes, lateCount: summary.lateCount } } : bundle;
}

const lockKey = async (tx: Tx, ctx: RequestContext, scope: string, key: string): Promise<void> => {
  await tx.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [`reportcards:${scope}:${ctx.tenantId}:${key}`]);
};

async function mapLimit<T, R>(items: readonly T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      out[i] = await fn(items[i]!);
    }
  });
  await Promise.all(workers);
  return out;
}

// ---------------------------------------------------------------------------
// Lot de génération
// ---------------------------------------------------------------------------

export interface CreateBatchInput extends PreflightInput {
  enrollmentIds?: readonly Uuid[];
  /** Réémet (nouvelle version) les bulletins dont les résultats ont changé, avec ce motif. */
  reissueReason?: string;
  idempotencyKey?: string;
}

export interface BatchView {
  batch: BatchRecord;
  items: BatchItemRecord[];
  /** `true` si le lot existait déjà (même clé d'idempotence) : rien n'a été recréé. */
  replayed: boolean;
}

type ItemOutcome =
  | { kind: "ISSUED"; card: ReportCardRecord; reason: string | null }
  | { kind: "EXCLUDED"; reason: string; message: string };

export async function createBatch(deps: ReportcardsDeps, ctx: RequestContext, input: CreateBatchInput): Promise<Result<BatchView, AppError>> {
  const kind = input.kind ?? "REPORT_CARD";
  if (kind !== "REPORT_CARD") return err(invalid("Un lot de période n'émet que des bulletins ; utilisez la demande de relevé pour un relevé cumulé.", ReportcardsCode.UNKNOWN_DOCUMENT_KIND));
  const provisional = input.provisional === true;
  const g = await gather(deps, ctx, input);
  if (!g.ok) return g;
  const { state, roster, ic, issues } = g.value;
  if (hasBlocking(issues)) return err(conflict("Le contrôle préalable a relevé des points bloquants : aucun bulletin n'a été généré.", ReportcardsCode.PREFLIGHT_FAILED, { issues }));
  const keyOk = await ensureSigningKeyRegistered(deps);
  if (!keyOk.ok) return keyOk;

  const idempotencyKey = input.idempotencyKey ?? `${kind}:${input.classroomId}:${input.academicPeriodId}:v${state.resultsVersion}:${provisional ? "provisional" : "final"}${input.reissueReason ? ":reissue" : ""}`;
  const wanted = input.enrollmentIds ? new Set(input.enrollmentIds) : null;
  const scope = roster.filter((r) => !wanted || wanted.has(r.enrollmentId));
  const unknownIds = wanted ? [...wanted].filter((id) => !roster.some((r) => r.enrollmentId === id)) : [];

  // Lecture des résultats (ports) AVANT la transaction d'écriture : aucun appel externe pendant qu'une transaction est ouverte.
  const toRead = scope.filter((r) => r.outcome === "FINAL");
  const bundles = new Map<Uuid, FinalResultBundle | null | "ERROR">();
  await mapLimit(toRead, 8, async (r) => {
    try {
      bundles.set(r.enrollmentId, await readBundle(deps, ctx, r.enrollmentId, input.academicPeriodId));
    } catch (e) {
      deps.logger.warn({ enrollmentId: r.enrollmentId, err: e instanceof Error ? e.message : String(e) }, "reportcards : lecture des résultats en échec");
      bundles.set(r.enrollmentId, "ERROR");
    }
  });
  const issuer = { id: ctx.userId, name: await actorLabel(deps, ctx) };

  return inTx<BatchView>(deps, ctx, async (tx) => {
    await lockKey(tx, ctx, "batch", `${input.classroomId}:${input.academicPeriodId}:${kind}`);
    const replay = await batchRepo.findBatchByKey(tx, idempotencyKey);
    if (replay) return ok({ batch: replay, items: await batchRepo.listBatchItems(tx, replay.id), replayed: true });

    const events = new EventBuffer(deps, ctx);
    const issuedAt = deps.clock.now();
    const batch = await batchRepo.insertBatch(tx, {
      id: deps.newId(),
      tenantId: ctx.tenantId,
      documentKind: kind,
      classroomId: input.classroomId,
      academicPeriodId: input.academicPeriodId,
      resultsStateId: state.stateId,
      resultsVersion: state.resultsVersion,
      idempotencyKey,
      provisional,
      total: scope.length + unknownIds.length,
      requestedBy: ctx.userId,
      requestedAt: issuedAt,
    });

    let issued = 0;
    let excluded = 0;
    let failed = 0;
    const record = async (enrollmentId: Uuid, outcome: "ISSUED" | "EXCLUDED" | "FAILED", reportCardId: Uuid | null, reasonCode: string | null, message: string | null): Promise<void> => {
      await batchRepo.insertBatchItem(tx, { id: deps.newId(), tenantId: ctx.tenantId, batchId: batch.id, enrollmentId, reportCardId, outcome, reasonCode, message });
      if (outcome === "ISSUED") issued += 1;
      else if (outcome === "EXCLUDED") excluded += 1;
      else failed += 1;
    };

    for (const id of unknownIds) await record(id, "EXCLUDED", null, "NOT_IN_CLASS", "Cette inscription n'appartient pas à la classe pour cette période.");
    for (const entry of scope) {
      if (entry.outcome !== "FINAL") {
        await record(entry.enrollmentId, "EXCLUDED", null, entry.outcome === "ERROR" ? "RESULT_ERROR" : "NO_FINAL_RESULT", entry.outcome === "ERROR" ? "Erreur de calcul : aucun bulletin n'est émis pour cette inscription." : "Aucun résultat définitif pour cette inscription.");
        continue;
      }
      const bundle = bundles.get(entry.enrollmentId);
      if (bundle === "ERROR") {
        await record(entry.enrollmentId, "FAILED", null, "RESULT_READ_FAILED", "Les résultats n'ont pas pu être lus ; relancez le lot.");
        continue;
      }
      if (!bundle) {
        await record(entry.enrollmentId, "EXCLUDED", null, "NO_FINAL_RESULT", "Aucun résultat définitif pour cette inscription.");
        continue;
      }
      if (bundle.enrollment.id !== entry.enrollmentId || bundle.enrollment.periodId !== input.academicPeriodId || bundle.student.id !== entry.studentId) {
        await record(entry.enrollmentId, "FAILED", null, "RESULT_MISMATCH", "Les résultats reçus ne correspondent pas à l'inscription demandée.");
        continue;
      }
      try {
        const outcome = await tx.transaction<ItemOutcome>(async (sp) => {
          const key = { documentKind: kind, studentId: bundle.student.id, enrollmentId: bundle.enrollment.id, academicPeriodId: bundle.enrollment.periodId, scope: "PERIOD" as Scope };
          let supersedes: ReportCardRecord | null = null;
          let version = 1;
          let reason: string | null = null;
          if (!provisional) {
            const live = await cardsRepo.findLiveCard(sp, key, { forUpdate: true });
            if (live) {
              if (live.resultsVersion >= state.resultsVersion && live.closureHash === bundle.rules.closureHash) return { kind: "ISSUED", card: live, reason: "ALREADY_ISSUED" };
              if (!input.reissueReason) return { kind: "EXCLUDED", reason: "NEEDS_REISSUE", message: "Les résultats ont changé depuis l'émission : réémettez ce bulletin (motif obligatoire)." };
              supersedes = live;
              version = live.version + 1;
              reason = input.reissueReason;
            } else {
              const latest = await cardsRepo.findLatestVersion(sp, key);
              if (latest) {
                supersedes = latest;
                version = latest.version + 1;
                reason = input.reissueReason ?? "Nouvelle émission après révocation.";
              }
            }
          }
          const issuedCard = await issueSnapshot(deps, sp, ctx, events, { kind, scope: "PERIOD", provisional, bundle, ic, issuedAt, issuer, supersedes, version, supersedeReason: reason, batchId: batch.id });
          if (!issuedCard.ok) throw issuedCard.error;
          return { kind: "ISSUED", card: issuedCard.value, reason: null };
        });
        if (outcome.kind === "ISSUED") await record(entry.enrollmentId, "ISSUED", outcome.card.id, outcome.reason, outcome.reason ? "Bulletin déjà émis pour ces résultats : rien n'a été recréé." : null);
        else await record(entry.enrollmentId, "EXCLUDED", null, outcome.reason, outcome.message);
      } catch (e) {
        deps.logger.warn({ enrollmentId: entry.enrollmentId, err: e instanceof Error ? e.message : String(e) }, "reportcards : émission en échec pour une inscription");
        const unique = isUniqueViolation(e);
        await record(entry.enrollmentId, "FAILED", null, unique ? "CONCURRENT_ISSUE" : "ISSUE_FAILED", unique ? "Un autre traitement a émis ce bulletin en même temps : relancez le lot." : "L'émission a échoué pour cette inscription.");
      }
    }

    await batchRepo.setBatchCounts(tx, batch.id, { issued, excluded, failed, status: "RENDERING" });
    const progress = await batchRepo.refreshBatchProgress(tx, batch.id, issuedAt);
    if (progress.justCompleted) {
      events.add(ReportcardsEvents.BATCH_COMPLETED, { v: 1, batchId: batch.id, issued, excluded, failed }, { type: "batch", id: batch.id });
    }
    events.audit({
      action: "reportcards.batch.generated",
      resourceType: "batch",
      resourceId: batch.id,
      sensitive: true,
      metadata: { classroomId: input.classroomId, academicPeriodId: input.academicPeriodId, kind, provisional, resultsVersion: state.resultsVersion, issued, excluded, failed },
    });
    await events.flush(tx);
    return ok({ batch: progress.batch, items: await batchRepo.listBatchItems(tx, batch.id), replayed: false });
  });
}

export async function getBatchView(deps: ReportcardsDeps, ctx: RequestContext, batchId: Uuid): Promise<Result<BatchView, AppError>> {
  return inTx(
    deps,
    ctx,
    async (tx) => {
      const batch = await batchRepo.getBatch(tx, batchId);
      if (!batch) return err(notFound("Lot de génération", batchId));
      return ok({ batch, items: await batchRepo.listBatchItems(tx, batchId), replayed: false });
    },
    { readOnly: true },
  );
}

// ---------------------------------------------------------------------------
// Réémission d'un bulletin
// ---------------------------------------------------------------------------

export async function reissueReportCard(deps: ReportcardsDeps, ctx: RequestContext, input: { reportCardId: Uuid; reason: string }): Promise<Result<ReportCardRecord, AppError>> {
  const current = await inTx(deps, ctx, async (tx) => {
    const card = await cardsRepo.getCard(tx, input.reportCardId);
    if (!card) return err(notFound("Bulletin", input.reportCardId));
    const decision = canReissue(card);
    if (!decision.ok) return err(conflict(decision.message, decision.code === "provisional" ? ReportcardsCode.PROVISIONAL : ReportcardsCode.INVALID_STATE));
    if (card.documentKind !== "REPORT_CARD" || !card.enrollmentId || !card.academicPeriodId || !card.classroomId) {
      return err(invalid("Seul un bulletin de période se réémet ici ; demandez un nouveau relevé pour un relevé cumulé.", ReportcardsCode.INVALID_STATE));
    }
    return ok(card);
  }, { readOnly: true });
  if (!current.ok) return current;
  const old = current.value;
  const state = await deps.ports.results.getPeriodState(ctx, { classroomId: old.classroomId!, academicPeriodId: old.academicPeriodId! });
  if (!state) return err(notFound("Période de la classe", old.academicPeriodId!));
  if (state.status !== "CLOSED") return err(conflict("La période n'est pas clôturée : réémission impossible.", ReportcardsCode.PERIOD_NOT_CLOSED));
  const keyOk = await ensureSigningKeyRegistered(deps);
  if (!keyOk.ok) return keyOk;
  const bundle = await readBundle(deps, ctx, old.enrollmentId!, old.academicPeriodId!);
  if (!bundle) return err(conflict("Aucun résultat définitif à figer pour cette inscription.", ReportcardsCode.NO_FINAL_RESULT));
  if (bundle.enrollment.id !== old.enrollmentId || bundle.student.id !== old.studentId) return err(conflict("Les résultats reçus ne correspondent pas à ce bulletin.", ReportcardsCode.NO_FINAL_RESULT));
  const issuer = { id: ctx.userId, name: await actorLabel(deps, ctx) };

  return inTx(deps, ctx, async (tx) => {
    await lockKey(tx, ctx, "issue", `${old.studentId}:${old.enrollmentId}:${old.academicPeriodId}`);
    const locked = await cardsRepo.getCard(tx, old.id, { forUpdate: true });
    if (!locked) return err(notFound("Bulletin", old.id));
    const decision = canReissue(locked);
    if (!decision.ok) return err(conflict(decision.message, ReportcardsCode.INVALID_STATE));
    const ic = await loadIssuingContext(tx, { institutionId: state.institutionId, documentKind: "REPORT_CARD", pack: state.pack, onDate: todayOf(deps) });
    if (hasBlocking(ic.issues)) return err(conflict("Le contrôle préalable a relevé des points bloquants.", ReportcardsCode.PREFLIGHT_FAILED, { issues: ic.issues }));
    const events = new EventBuffer(deps, ctx);
    const created = await issueSnapshot(deps, tx, ctx, events, {
      kind: "REPORT_CARD", scope: "PERIOD", provisional: false, bundle, ic, issuedAt: deps.clock.now(), issuer, supersedes: locked, version: locked.version + 1, supersedeReason: input.reason, batchId: null,
    });
    if (!created.ok) return created;
    events.audit({
      action: "reportcards.report_card.reissued",
      resourceType: "report_card",
      resourceId: created.value.id,
      sensitive: true,
      reason: input.reason,
      before: { id: locked.id, version: locked.version, status: locked.status },
      after: { id: created.value.id, version: created.value.version },
      metadata: { studentId: locked.studentId, supersedes: locked.id },
    });
    await events.flush(tx);
    return created;
  });
}

// ---------------------------------------------------------------------------
// Relevé cumulé (US7)
// ---------------------------------------------------------------------------

export async function createTranscript(
  deps: ReportcardsDeps,
  ctx: RequestContext,
  input: { studentId: Uuid; academicYearIds?: readonly Uuid[]; pack?: "HIGHER" | "VIRTUAL" },
): Promise<Result<ReportCardRecord, AppError>> {
  const pack = input.pack ?? "HIGHER";
  const keyOk = await ensureSigningKeyRegistered(deps);
  if (!keyOk.ok) return keyOk;
  if (!deps.config.verificationBaseUrl) return err(conflict("Le domaine public de vérification des documents n'est pas configuré.", ReportcardsCode.PREFLIGHT_FAILED));
  const bundle = await deps.ports.results.getCumulativeBundle(ctx, { studentId: input.studentId, ...(input.academicYearIds ? { academicYearIds: input.academicYearIds } : {}) });
  if (!bundle || bundle.lines.length === 0) return err(conflict("Aucun résultat définitif à reporter dans un relevé pour cet élève.", ReportcardsCode.TRANSCRIPT_EMPTY));
  if (bundle.student.id !== input.studentId) return err(conflict("Les résultats reçus ne correspondent pas à cet élève.", ReportcardsCode.NO_FINAL_RESULT));
  const issuer = { id: ctx.userId, name: await actorLabel(deps, ctx) };
  return inTx(deps, ctx, async (tx) => {
    await lockKey(tx, ctx, "issue", `transcript:${input.studentId}`);
    const ic = await loadIssuingContext(tx, { institutionId: null, documentKind: "TRANSCRIPT", pack, onDate: todayOf(deps) });
    if (hasBlocking(ic.issues)) return err(conflict("Le contrôle préalable a relevé des points bloquants.", ReportcardsCode.PREFLIGHT_FAILED, { issues: ic.issues }));
    const key = { documentKind: "TRANSCRIPT" as const, studentId: input.studentId, enrollmentId: null, academicPeriodId: null, scope: "CUMULATIVE" as Scope };
    const latest = await cardsRepo.findLatestVersion(tx, key);
    const live = latest && (latest.status === "ISSUED" || latest.status === "PUBLISHED") ? latest : null;
    const events = new EventBuffer(deps, ctx);
    const created = await issueSnapshot(deps, tx, ctx, events, {
      kind: "TRANSCRIPT", scope: "CUMULATIVE", provisional: false, bundle: { ...bundle, enrollment: { ...bundle.enrollment, id: null, classroomId: null, periodId: null } }, ic,
      issuedAt: deps.clock.now(), issuer, supersedes: latest ?? null, version: latest ? latest.version + 1 : 1, supersedeReason: latest ? "Mise à jour du relevé à la demande." : null, batchId: null,
    });
    if (!created.ok) return created;
    events.audit({
      action: "reportcards.transcript.issued",
      resourceType: "report_card",
      resourceId: created.value.id,
      sensitive: true,
      metadata: { studentId: input.studentId, version: created.value.version, supersedes: live?.id ?? null },
    });
    await events.flush(tx);
    return created;
  });
}
