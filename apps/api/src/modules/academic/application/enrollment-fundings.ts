/**
 * Cumul de financements d'une inscription (O-04) : bourse + État + famille… avec une PART par financement (pourcentage ou montant).
 *
 *  - `setEnrollmentFundings` : REMPLACE atomiquement le cumul (les anciennes parts sont terminées, jamais supprimées) ;
 *  - `upsertEnrollmentFundingShare` : pose ou met à jour UNE part sans toucher aux autres (vérification d'un dossier d'affectation
 *    par `stateassign`, bourse ajoutée plus tard…) ;
 *  - le type PRINCIPAL de l'inscription (`enrollments.funding_type`, lu par les autres modules) reste cohérent : il se déduit de
 *    la plus grande part (voir `principalOf`). Pour `upsertEnrollmentFundingShare`, un principal déjà non privé et différent n'est
 *    pas écrasé (c'est le cumul).
 *  - la somme des parts en pourcentage ne dépasse jamais 100 % (contrôlé ici ET par le déclencheur 0710) ; le reste est à la
 *    charge de la famille.
 * Historique : une entrée `FUNDING` par changement ; événement `academic.enrollment.funding_changed` (charge enrichie de `fundings`).
 */
import { err, ok, type AppError, type RequestContext, type Result } from "@ecoledigitale/kernel";
import { AcademicCode, conflict, validation } from "../domain/errors";
import { AcademicEvents } from "../domain/events";
import { normalizeFunding } from "../domain/enrollment";
import {
  familyRemainderBps,
  principalOf,
  validateFundingShares,
  type EnrollmentFunding,
  type FundingShareInput,
} from "../domain/enrollment-funding";
import type { Enrollment } from "../domain/records";
import * as enr from "../infrastructure/enrollment-repository";
import * as fund from "../infrastructure/enrollment-funding-repository";
import * as ref from "../infrastructure/reference-repository";
import { EventBuffer, actorId, inReadTx, inTx, type AcademicDeps } from "./deps";
import { loadEnrollmentInScope, writeHistory } from "./enrollment-core";

export interface EnrollmentFundingsView {
  readonly enrollmentId: string;
  /** Type principal historique (`enrollments.funding_type`). */
  readonly principalFundingType: string;
  readonly fundings: readonly EnrollmentFunding[];
  /** Part laissée à la famille en points de base ; `null` si une part en montant intervient (connue seulement à la facturation). */
  readonly familyRemainderBps: number | null;
}

const toView = (e: Enrollment, fundings: EnrollmentFunding[]): EnrollmentFundingsView => ({
  enrollmentId: e.id,
  principalFundingType: e.fundingType,
  fundings,
  familyRemainderBps: familyRemainderBps(fundings),
});

const snapshot = (list: ReadonlyArray<{ fundingType: string; share: unknown; funderLabel?: string | null | undefined; assignmentReference?: string | null | undefined }>) =>
  list.map((f) => ({ fundingType: f.fundingType, share: f.share, funderLabel: f.funderLabel ?? null, assignmentReference: f.assignmentReference ?? null }));

export async function listEnrollmentFundings(deps: AcademicDeps, ctx: RequestContext, enrollmentId: string): Promise<Result<EnrollmentFundingsView, AppError>> {
  return inReadTx(deps, ctx, async (tx) => {
    const l = await loadEnrollmentInScope(tx, ctx, enrollmentId);
    if (!l.ok) return l;
    return ok(toView(l.value, await fund.listFundings(tx, enrollmentId)));
  });
}

export interface SetEnrollmentFundingsInput {
  readonly shares: ReadonlyArray<FundingShareInput>;
  readonly reason: string;
}

export async function setEnrollmentFundings(
  deps: AcademicDeps,
  ctx: RequestContext,
  enrollmentId: string,
  input: SetEnrollmentFundingsInput,
): Promise<Result<EnrollmentFundingsView, AppError>> {
  return writeFundings(deps, ctx, enrollmentId, input.reason, (_current) => ({ shares: input.shares, principal: "DERIVE" }));
}

export interface UpsertFundingShareInput {
  readonly share: FundingShareInput;
  readonly assignmentIssuedOn?: string | null | undefined;
  readonly reason: string;
}

/** Pose ou remplace la part de ce type de financement ; les autres parts restent intactes. */
export async function upsertEnrollmentFundingShare(
  deps: AcademicDeps,
  ctx: RequestContext,
  enrollmentId: string,
  input: UpsertFundingShareInput,
): Promise<Result<EnrollmentFundingsView, AppError>> {
  return writeFundings(
    deps,
    ctx,
    enrollmentId,
    input.reason,
    (current) => ({
      shares: [...current.filter((f) => f.fundingType !== input.share.fundingType).map(asInput), input.share],
      principal: "KEEP_UNLESS_PRIVATE",
      issuedOn: input.assignmentIssuedOn ?? null,
      favoured: input.share.fundingType,
    }),
  );
}

const asInput = (f: EnrollmentFunding): FundingShareInput => ({
  fundingType: f.fundingType,
  share: f.share,
  funderLabel: f.funderLabel,
  assignmentReference: f.assignmentReference,
  notes: f.notes,
});

interface Plan {
  readonly shares: ReadonlyArray<FundingShareInput>;
  /** `DERIVE` : principal = plus grande part ; `KEEP_UNLESS_PRIVATE` : conserve un principal non privé déjà posé. */
  readonly principal: "DERIVE" | "KEEP_UNLESS_PRIVATE";
  readonly issuedOn?: string | null;
  /** Type dont la part devient le principal quand l'inscription était privée. */
  readonly favoured?: string;
}

type MainChoice = { readonly kind: "KEEP" } | { readonly kind: "SET"; readonly share: FundingShareInput | null };

/**
 * Principal de l'inscription après l'écriture. `DERIVE` : la plus grande part (ou privé si le cumul est vide).
 * `KEEP_UNLESS_PRIVATE` : un principal déjà non privé (autre que le type posé) est conservé — c'est justement le cumul ;
 * sinon le principal devient le type posé.
 */
function chooseMain(plan: Plan, enrollment: Enrollment): MainChoice {
  if (plan.principal === "DERIVE") return { kind: "SET", share: principalOf(plan.shares) };
  if (enrollment.fundingType !== "PRIVATE" && enrollment.fundingType !== plan.favoured) return { kind: "KEEP" };
  return { kind: "SET", share: plan.shares.find((s) => s.fundingType === plan.favoured) ?? null };
}

async function writeFundings(
  deps: AcademicDeps,
  ctx: RequestContext,
  enrollmentId: string,
  reasonRaw: string,
  plan: (current: EnrollmentFunding[]) => Plan,
): Promise<Result<EnrollmentFundingsView, AppError>> {
  const reason = reasonRaw?.trim() ?? "";
  if (reason.length < 5) return err(validation(AcademicCode.ENROLLMENT_REASON_REQUIRED, "Un motif de 5 caractères minimum est requis.", "reason"));
  return inTx(deps, ctx, async (tx) => {
    const l = await loadEnrollmentInScope(tx, ctx, enrollmentId, true);
    if (!l.ok) return l;
    const enrollment = l.value;
    if (enrollment.status === "CANCELLED" || enrollment.status === "WITHDRAWN" || enrollment.status === "TRANSFERRED_OUT") {
      return err(conflict(AcademicCode.ENROLLMENT_TRANSITION, `L'inscription est ${enrollment.status} : son financement ne change plus.`));
    }
    const types = await ref.listFundingTypes(tx);
    const before = await fund.listFundings(tx, enrollmentId);
    const next = plan(before);
    const problem = validateFundingShares(types, next.shares);
    if (problem) return err(problem);

    await fund.endActiveFundings(tx, enrollmentId);
    for (const s of next.shares) await fund.insertFunding(tx, { id: deps.newId(), enrollmentId, input: s, createdBy: actorId(ctx) });

    // Type principal (lecture historique) : déduit du cumul, ou conservé quand il est déjà non privé (ajout d'une part).
    const beforeMain = { fundingType: enrollment.fundingType, assignmentReference: enrollment.assignmentReference };
    const choice = chooseMain(next, enrollment);
    if (choice.kind === "SET") {
      const main = choice.share;
      if (main === null) {
        await enr.setEnrollmentFunding(tx, enrollmentId, { fundingType: "PRIVATE", assignmentReference: null, assignmentIssuedOn: null, funderLabel: null, fundingNotes: null });
      } else {
        const norm = normalizeFunding({ fundingType: main.fundingType, assignmentReference: main.assignmentReference ?? null, funderLabel: main.funderLabel ?? null });
        await enr.setEnrollmentFunding(tx, enrollmentId, {
          fundingType: main.fundingType,
          assignmentReference: norm.assignmentReference,
          assignmentIssuedOn: next.issuedOn ?? (enrollment.fundingType === main.fundingType ? enrollment.assignmentIssuedOn : null),
          funderLabel: norm.funderLabel,
          fundingNotes: main.notes ?? enrollment.fundingNotes,
        });
      }
    }

    const updated = (await enr.getEnrollment(tx, enrollmentId)) as Enrollment;
    const after = await fund.listFundings(tx, enrollmentId);
    await writeHistory(deps, ctx, tx, enrollmentId, {
      kind: "FUNDING",
      from: { ...beforeMain, fundings: snapshot(before) },
      to: { fundingType: updated.fundingType, assignmentReference: updated.assignmentReference, fundings: snapshot(after) },
      reason,
    });
    const events = new EventBuffer(deps, ctx);
    events.add(
      AcademicEvents.ENROLLMENT_FUNDING_CHANGED,
      {
        v: 1,
        institutionId: updated.institutionId,
        academicYearId: updated.academicYearId,
        enrollmentId,
        studentId: updated.studentId,
        classroomId: updated.classroomId,
        from: beforeMain,
        to: { fundingType: updated.fundingType, assignmentReference: updated.assignmentReference },
        reason,
        // Additif (O-04) : le cumul complet ; absent des émetteurs historiques.
        fundings: after.map((f) => ({ fundingType: f.fundingType, shareKind: f.share.kind, shareBps: f.share.kind === "PERCENT" ? f.share.bps : null, shareAmount: f.share.kind === "AMOUNT" ? f.share.amount : null, currency: f.share.kind === "AMOUNT" ? f.share.currency : null })),
      },
      { type: "enrollment", id: enrollmentId },
    );
    const sensitive = [...before, ...after].some((f) => types.find((t) => t.code === f.fundingType)?.requiresReference);
    if (sensitive) {
      events.audit({
        action: "academic.enrollment.fundings_changed",
        resourceType: "enrollment",
        resourceId: enrollmentId,
        sensitive: true,
        before: { principal: beforeMain.fundingType, fundings: snapshot(before) },
        after: { principal: updated.fundingType, fundings: snapshot(after) },
        reason,
      });
    }
    await events.flush(tx);
    return ok(toView(updated, after));
  });
}
