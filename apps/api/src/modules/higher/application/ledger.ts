/**
 * Capitalisation : le registre de crédits est alimenté par les résultats `FINAL` publiés (011), sans doublon ni perte.
 *
 *  - une seule acquisition valide par (étudiant, UE) : rejouer l'événement n'ajoute RIEN (AC1.2) ;
 *  - crédits FIGÉS au résultat (AC1.5), moyenne exacte, session d'obtention, origine ;
 *  - reclôture : une UE devenue non validée REVOQUE l'écriture issue de la version précédente, sauf si un diplôme octroyé
 *    s'appuie dessus — l'opération est alors bloquée et SIGNALÉE (AC1.4) ;
 *  - la durée de validité (réglage de l'établissement) pose `valid_until` ; une écriture expirée est remplacée à la
 *    recapitalisation et balayée par `expireCredits` ;
 *  - AUCUNE évaluation de diplôme ici (R-HIG-10) : l'éligibilité est un abonné distinct de `higher.credits.capitalized`.
 *
 * La validation d'une UE, l'état LMD et la session d'obtention sont DÉCIDÉS par les règles (results/rules) : ce module les
 * lit dans les lignes publiées, il ne recalcule jamais une note.
 */
import { err, ok, type AppError, type RequestContext, type Result } from "@ecoledigitale/kernel";
import { isCurrentlyValid, isoDateOf, validUntilFor } from "../domain/credits";
import { HigherCode, notFound, validation } from "../domain/errors";
import { HigherEvents } from "../domain/events";
import type { AcquiredVia, IsoDate, LedgerEntry, UeDebt, Uuid } from "../domain/types";
import * as repo from "../infrastructure/ledger-repository";
import { EventBuffer, inTx, todayOf, type HigherDeps } from "./deps";
import type { UeResultLine } from "./ports";
import * as resitRepo from "../infrastructure/resit-repository";

export interface CapitalizeInput {
  readonly classroomId: Uuid;
  readonly academicPeriodId: Uuid;
  readonly stateId?: Uuid | undefined;
  readonly resultsVersion?: number | undefined;
}

export interface CapitalizeReport {
  readonly linesRead: number;
  readonly acquired: number;
  readonly alreadyAcquired: number;
  readonly replacedExpired: number;
  readonly revoked: number;
  readonly revocationBlocked: number;
  readonly debtsOpened: number;
  readonly debtsCleared: number;
  readonly rejected: number;
  readonly resitSettled: number;
}

const EMPTY: CapitalizeReport = Object.freeze({
  linesRead: 0, acquired: 0, alreadyAcquired: 0, replacedExpired: 0, revoked: 0, revocationBlocked: 0, debtsOpened: 0, debtsCleared: 0, rejected: 0, resitSettled: 0,
});

/** Cohérence origine / session exigée par la base ; `null` si la ligne est inexploitable. */
export function normalizeAcquisition(line: UeResultLine): { via: AcquiredVia; session: 1 | 2 } | null {
  const session: 1 | 2 = line.sessionObtained ?? (line.via === "RESIT" ? 2 : 1);
  if (line.via === "JURY_OVERRIDE") return line.overrideId ? { via: "JURY_OVERRIDE", session } : null;
  if (line.via === "RESIT" || session === 2) return { via: "RESIT", session: 2 };
  return { via: "DIRECT", session: 1 };
}

/**
 * Capitalise la clôture d'une classe × période. Idempotent. Les lignes sont lues AVANT la transaction (lecture d'un
 * autre module), l'écriture est atomique (registre, dettes, issue des rattrapages, événements d'outbox, audit).
 */
export async function capitalizePeriod(deps: HigherDeps, ctx: RequestContext, input: CapitalizeInput): Promise<Result<CapitalizeReport, AppError>> {
  const lines = await deps.ports.credits.listFinalUeLines(ctx, {
    classroomId: input.classroomId,
    academicPeriodId: input.academicPeriodId,
    stateId: input.stateId,
    resultsVersion: input.resultsVersion,
  });
  if (lines.length === 0) return ok({ ...EMPTY });
  const ordered = [...lines].sort((a, b) => a.studentId.localeCompare(b.studentId) || a.ueNodeId.localeCompare(b.ueNodeId));

  return inTx(deps, ctx, async (tx) => {
    const settings = await repo.getSettings(tx);
    const now = deps.clock.now();
    const today = todayOf(deps);
    const events = new EventBuffer(deps, ctx);
    const r = { acquired: 0, alreadyAcquired: 0, replacedExpired: 0, revoked: 0, revocationBlocked: 0, debtsOpened: 0, debtsCleared: 0, rejected: 0, resitSettled: 0 };
    const maxVersion = ordered.reduce((m, l) => Math.max(m, l.resultsVersion), 0);

    for (const line of ordered) {
      if (line.validated) {
        const norm = normalizeAcquisition(line);
        if (!norm) {
          r.rejected += 1;
          deps.logger.warn({ ueNodeId: line.ueNodeId, studentId: line.studentId }, "higher : ligne de résultat inexploitable ignorée (validation par jury sans référence)");
          continue;
        }
        const existing = await repo.findAcquired(tx, line.studentId, line.ueNodeId, true);
        if (existing) {
          if (isCurrentlyValid(existing, today)) {
            r.alreadyAcquired += 1;
            continue;
          }
          // Acquisition périmée (durée de validité dépassée) : remplacée, sauf si un diplôme octroyé s'appuie dessus.
          if ((await repo.listAwardsUsingLedger(tx, existing.studentId, existing.id)).length > 0) {
            r.alreadyAcquired += 1;
            continue;
          }
          await repo.markExpired(tx, existing.id, now);
          events.add(HigherEvents.CREDITS_EXPIRED, { v: 1, ledgerId: existing.id, studentId: existing.studentId, ueNodeId: existing.ueNodeId }, { type: "credit_ledger", id: existing.id });
          r.replacedExpired += 1;
        }
        const acquiredAt = line.validatedAt ?? now;
        const entry = await repo.insertAcquisition(tx, {
          id: deps.newId(),
          tenantId: ctx.tenantId,
          studentId: line.studentId,
          enrollmentId: line.enrollmentId,
          ueNodeId: line.ueNodeId,
          academicYearId: line.academicYearId,
          academicPeriodId: line.academicPeriodId,
          credits: line.credits,
          averageExact: line.averageExact,
          acquiredVia: norm.via,
          sessionObtained: norm.session,
          compensatedEcueCount: line.compensatedEcueCount,
          overrideId: line.overrideId,
          sourceResultId: line.sourceResultId,
          sourceResultsVersion: line.resultsVersion,
          validUntil: validUntilFor(isoDateOf(acquiredAt), settings.creditValidityMonths),
          acquiredAt,
        });
        if (!entry) {
          r.alreadyAcquired += 1; // course perdue : une autre transaction a capitalisé la même UE
          continue;
        }
        r.acquired += 1;
        r.debtsCleared += await repo.clearDebts(tx, line.studentId, line.ueNodeId, now, entry.id);
        events.add(
          HigherEvents.CREDITS_CAPITALIZED,
          {
            v: 1,
            studentId: entry.studentId,
            ueNodeId: entry.ueNodeId,
            credits: entry.credits,
            yearId: entry.academicYearId,
            via: entry.acquiredVia,
            sessionObtained: entry.sessionObtained,
            ledgerId: entry.id,
          },
          { type: "credit_ledger", id: entry.id },
        );
        continue;
      }

      // --- UE non validée ----------------------------------------------------------------------------------------
      // 1) une écriture issue d'une version PRÉCÉDENTE de ce résultat n'est plus fondée : révocation (sauf diplôme).
      const stale = await repo.findAcquired(tx, line.studentId, line.ueNodeId, true);
      if (stale && stale.academicPeriodId === line.academicPeriodId && stale.sourceResultsVersion < line.resultsVersion) {
        const awards = await repo.listAwardsUsingLedger(tx, stale.studentId, stale.id);
        if (awards.length > 0) {
          r.revocationBlocked += 1;
          events.add(
            HigherEvents.CREDITS_REVOCATION_BLOCKED,
            { v: 1, ledgerId: stale.id, studentId: stale.studentId, ueNodeId: stale.ueNodeId, awardIds: awards },
            { type: "credit_ledger", id: stale.id },
          );
        } else if (await repo.markRevoked(tx, stale.id, now, `Résultat remplacé (version ${line.resultsVersion})`, line.resultsVersion)) {
          r.revoked += 1;
          events.add(
            HigherEvents.CREDITS_REVOKED,
            { v: 1, ledgerId: stale.id, studentId: stale.studentId, ueNodeId: stale.ueNodeId, reason: "result_replaced" },
            { type: "credit_ledger", id: stale.id },
          );
        }
      }
      // 2) dette : état `DEBT` rendu par la règle `etat_ue` (jamais décidé ici).
      if (line.ueState === "DEBT") {
        const stillAcquired = await repo.findAcquired(tx, line.studentId, line.ueNodeId);
        if (!stillAcquired) {
          const opened = await repo.openDebt(tx, {
            id: deps.newId(), tenantId: ctx.tenantId, studentId: line.studentId, enrollmentId: line.enrollmentId, ueNodeId: line.ueNodeId,
            academicYearId: line.academicYearId, academicPeriodId: line.academicPeriodId, sourceResultId: line.sourceResultId, detectedAt: now,
          });
          if (opened) {
            r.debtsOpened += 1;
            events.add(
              HigherEvents.UE_DEBT_DETECTED,
              { v: 1, studentId: line.studentId, ueNodeId: line.ueNodeId, periodId: line.academicPeriodId },
              { type: "ue_debt", id: `${line.studentId}:${line.ueNodeId}` },
            );
          }
        }
      }
    }

    // --- issue des rattrapages : la session 2 a été tentée (l'UE n'est plus « à repasser ») ----------------------------
    const registrations = await resitRepo.listRegistrationsForPeriod(tx, input.academicPeriodId, [...new Set(ordered.map((l) => l.enrollmentId))]);
    const lineOf = new Map(ordered.map((l) => [`${l.enrollmentId}|${l.ueNodeId}`, l]));
    for (const reg of registrations) {
      const line = lineOf.get(`${reg.enrollmentId}|${reg.ueNodeId}`);
      if (!line || line.ueState === "RESIT") continue;
      if (await resitRepo.settleRegistration(tx, reg.id, line.validated ? "VALIDATED" : "NOT_VALIDATED", now)) r.resitSettled += 1;
    }

    if (r.acquired + r.revoked + r.revocationBlocked + r.debtsOpened + r.replacedExpired + r.resitSettled > 0) {
      events.audit({
        action: "higher.ledger.capitalized",
        resourceType: "credit_ledger_batch",
        resourceId: `${input.classroomId}:${input.academicPeriodId}:v${maxVersion}`,
        metadata: { classroomId: input.classroomId, academicPeriodId: input.academicPeriodId, resultsVersion: maxVersion, ...r },
      });
    }
    await events.flush(tx);
    return ok({ linesRead: ordered.length, ...r });
  });
}

/** Balayage des acquisitions dont la durée de validité est dépassée (job quotidien). Épargne celles d'un diplôme octroyé. */
export async function expireCredits(deps: HigherDeps, ctx: RequestContext, options: { batchSize?: number } = {}): Promise<Result<{ expired: number }, AppError>> {
  return inTx(deps, ctx, async (tx) => {
    const now = deps.clock.now();
    const due = await repo.listDue(tx, todayOf(deps), Math.min(Math.max(options.batchSize ?? 500, 1), 5000));
    const events = new EventBuffer(deps, ctx);
    let expired = 0;
    for (const e of due) {
      if (!(await repo.markExpired(tx, e.id, now))) continue;
      expired += 1;
      events.add(HigherEvents.CREDITS_EXPIRED, { v: 1, ledgerId: e.id, studentId: e.studentId, ueNodeId: e.ueNodeId }, { type: "credit_ledger", id: e.id });
    }
    if (expired > 0) events.audit({ action: "higher.ledger.expired", resourceType: "credit_ledger_batch", resourceId: todayOf(deps), metadata: { expired } });
    await events.flush(tx);
    return ok({ expired });
  });
}

// ---------------------------------------------------------------------------
// Lectures (API publique du module : 004, 013, 025)
// ---------------------------------------------------------------------------

export interface CreditSummary {
  readonly studentId: Uuid;
  /** Σ des crédits des acquisitions valables. */
  readonly totalCredits: number;
  readonly acquiredUeCount: number;
  readonly byYear: ReadonlyArray<{ academicYearId: Uuid; credits: number; ueCount: number }>;
  readonly byPeriod: ReadonlyArray<{ academicPeriodId: Uuid; credits: number; ueCount: number }>;
  readonly openDebtCount: number;
}

export async function listAcquiredUe(deps: HigherDeps, ctx: RequestContext, studentId: Uuid): Promise<Result<LedgerEntry[], AppError>> {
  return inTx(
    deps,
    ctx,
    async (tx) => {
      const today = todayOf(deps);
      return ok((await repo.listAcquiredForStudent(tx, studentId)).filter((e) => isCurrentlyValid(e, today)));
    },
    { readOnly: true },
  );
}

export async function getCreditSummary(deps: HigherDeps, ctx: RequestContext, studentId: Uuid): Promise<Result<CreditSummary, AppError>> {
  return inTx(
    deps,
    ctx,
    async (tx) => {
      const today = todayOf(deps);
      const entries = (await repo.listAcquiredForStudent(tx, studentId)).filter((e) => isCurrentlyValid(e, today));
      const debts = await repo.listOpenDebts(tx, studentId);
      return ok(summarize(studentId, entries, debts));
    },
    { readOnly: true },
  );
}

export function summarize(studentId: Uuid, entries: readonly LedgerEntry[], debts: readonly UeDebt[]): CreditSummary {
  const hundredths = (e: LedgerEntry): number => Math.round(e.credits * 100);
  const group = <K extends string>(key: (e: LedgerEntry) => Uuid, name: K) => {
    const m = new Map<Uuid, { credits: number; ueCount: number }>();
    for (const e of entries) {
      const g = m.get(key(e)) ?? { credits: 0, ueCount: 0 };
      g.credits += hundredths(e);
      g.ueCount += 1;
      m.set(key(e), g);
    }
    return [...m.entries()].map(([id, g]) => ({ [name]: id, credits: g.credits / 100, ueCount: g.ueCount }) as { credits: number; ueCount: number } & Record<K, Uuid>);
  };
  return {
    studentId,
    totalCredits: entries.reduce((s, e) => s + hundredths(e), 0) / 100,
    acquiredUeCount: entries.length,
    byYear: group((e) => e.academicYearId, "academicYearId"),
    byPeriod: group((e) => e.academicPeriodId, "academicPeriodId"),
    openDebtCount: debts.length,
  };
}

export async function listDebts(deps: HigherDeps, ctx: RequestContext, studentId: Uuid): Promise<Result<UeDebt[], AppError>> {
  return inTx(deps, ctx, async (tx) => ok(await repo.listOpenDebts(tx, studentId)), { readOnly: true });
}

export async function getLedgerHistory(
  deps: HigherDeps,
  ctx: RequestContext,
  studentId: Uuid,
  f: { status?: LedgerEntry["status"] | undefined; limit?: number | undefined; cursor?: string | undefined } = {},
): Promise<Result<{ items: LedgerEntry[]; nextCursor: string | null }, AppError>> {
  return inTx(deps, ctx, async (tx) => ok(await repo.listLedgerForStudent(tx, studentId, f)), { readOnly: true });
}

export async function getLedgerEntry(deps: HigherDeps, ctx: RequestContext, id: Uuid): Promise<Result<LedgerEntry, AppError>> {
  return inTx(
    deps,
    ctx,
    async (tx) => {
      const e = await repo.getLedgerEntry(tx, id);
      return e ? ok(e) : err(notFound(HigherCode.LEDGER_NOT_FOUND, "Acquisition de crédits", id));
    },
    { readOnly: true },
  );
}

/** Garde de saisie : `today` explicite pour les appels de test. */
export function assertIsoDate(value: string, field: string): Result<IsoDate, AppError> {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? ok(value) : err(validation(HigherCode.INVALID_INPUT, `Date invalide (${field}).`, field));
}
