/**
 * Archivage d'une année : GEL LOGIQUE (`PREPARING` -> `READY` -> `FROZEN`) avec manifeste et empreinte, sans déplacement ni purge.
 *
 *  - `prepare` exige `academic.closeAcademicYear` accompli ; il dénombre les bilans et produit le manifeste (classes, hashes) ;
 *  - `READY` exige que 100 % des bilans soient scellés et que chaque inscription ait son bilan ;
 *  - `FROZEN` est irréversible : plus aucun bilan de cet établissement et de cette année ne s'écrit (déclencheur), l'archive ne se
 *    supprime pas ; les données restent lisibles ;
 *  - aucune durée de conservation officielle n'est connue : `archive_retention_years` est NULL par défaut, aucune purge n'existe.
 */
import { err, ok, type AppError, type RequestContext, type Result } from "@ecoledigitale/kernel";
import type { PrimaryPrepareArchiveBody } from "@ecoledigitale/contracts/src/v2/primary_school";
import { archiveBlockers, buildManifest, manifestHash } from "../domain/review";
import { PrimaryCode, conflict, forbidden, notFound } from "../domain/errors";
import { PrimaryEvents } from "../domain/events";
import type { Uuid, YearArchive } from "../domain/types";
import { guarded } from "../infrastructure/db-errors";
import { freezeArchiveRow, getArchiveOf, getArchiveRow, insertArchiveRow, listArchiveRows, listReviewRows, updateArchiveRow } from "../infrastructure/reviews-repository";
import { resolveInstitution } from "./access";
import { EventBuffer, inTx, type PrimarySchoolDeps } from "./deps";

export interface ArchiveView extends YearArchive {
  blockers: Array<{ code: string; message: string }>;
}

export async function prepareYearArchive(deps: PrimarySchoolDeps, ctx: RequestContext, input: PrimaryPrepareArchiveBody): Promise<Result<ArchiveView, AppError>> {
  const institution = await resolveInstitution(deps, ctx, input.institutionId);
  if (!institution.ok) return institution;
  const year = await deps.ports.classrooms.getYear(ctx, input.academicYearId);
  if (!year) return err(notFound(PrimaryCode.ARCHIVE_NOT_FOUND, "Année académique", input.academicYearId));
  // Inscriptions attendues : une par élève de chaque classe de l'établissement pour l'année.
  const classrooms = await deps.ports.classrooms.listClassrooms(ctx, { academicYearId: input.academicYearId, institutionId: institution.value });
  let expected = 0;
  for (const c of classrooms) expected += (await deps.ports.classrooms.listRoster(ctx, c.id)).length;

  return inTx(deps, ctx, async (tx) => {
    let archive = await getArchiveOf(tx, institution.value, input.academicYearId, true);
    if (archive?.status === "FROZEN") return err(conflict(PrimaryCode.ARCHIVE_FROZEN, "Cette année est archivée et figée.", { archiveId: archive.id }));
    archive ??= await insertArchiveRow(tx, { id: deps.newId(), tenantId: ctx.tenantId, institutionId: institution.value, yearId: input.academicYearId });
    const live = await listReviewRows(tx, { yearId: input.academicYearId, liveOnly: true, limit: 5000 });
    const mine = live.filter((r) => r.institutionId === institution.value);
    const sealed = mine.filter((r) => r.status === "SEALED");
    const blockers = archiveBlockers({ reviewsTotal: mine.length, reviewsSealed: sealed.length }, year.closed);
    if (mine.length < expected) blockers.push({ code: PrimaryCode.ARCHIVE_NOT_READY, message: `${expected - mine.length} inscription(s) sans bilan annuel.` });
    // Le PDF d'un bilan ne se renseigne plus une fois l'année gelée (déclencheur) : il doit être ÉMIS avant le gel.
    const withoutPdf = sealed.filter((r) => r.reportcardId === null).length;
    if (withoutPdf > 0) blockers.push({ code: PrimaryCode.ARCHIVE_NOT_READY, message: `${withoutPdf} bilan(s) scellé(s) sans PDF émis.` });
    const ready = blockers.length === 0;
    const manifest = ready ? buildManifest({ institutionId: institution.value, academicYearId: input.academicYearId, sealed }) : null;
    const hash = manifest ? manifestHash(manifest) : null;
    const wasReady = archive.status === "READY";
    const updated = await guarded(() =>
      updateArchiveRow(tx, archive.id, { reviewsTotal: mine.length, reviewsSealed: sealed.length, manifest, manifestHash: hash, status: ready ? "READY" : "PREPARING", preparedBy: ctx.userId, preparedAt: deps.clock.now() }),
    );
    const events = new EventBuffer(deps, ctx);
    if (ready && !wasReady) {
      events.add(PrimaryEvents.YEAR_ARCHIVE_READY, { v: 1, archiveId: updated.id, institutionId: institution.value, academicYearId: input.academicYearId, reviews: mine.length, manifestHash: hash }, { type: "primary_school.year_archive", id: updated.id });
    }
    events.audit({ action: "primary_school.year_archive.prepared", resourceType: "year_archive", resourceId: updated.id, metadata: { academicYearId: input.academicYearId, reviewsTotal: mine.length, reviewsSealed: sealed.length, status: updated.status } });
    await events.flush(tx);
    return ok<ArchiveView>({ ...updated, blockers });
  });
}

export async function listYearArchives(deps: PrimarySchoolDeps, ctx: RequestContext, filter: { yearId?: Uuid | undefined } = {}): Promise<Result<YearArchive[], AppError>> {
  return inTx(deps, ctx, async (tx) => ok(await listArchiveRows(tx, filter.yearId)), { readOnly: true });
}

export async function getYearArchive(deps: PrimarySchoolDeps, ctx: RequestContext, id: Uuid): Promise<Result<YearArchive, AppError>> {
  return inTx(
    deps,
    ctx,
    async (tx) => {
      const a = await getArchiveRow(tx, id);
      return a ? ok(a) : err(notFound(PrimaryCode.ARCHIVE_NOT_FOUND, "Archive d'année", id));
    },
    { readOnly: true },
  );
}

export async function freezeYearArchive(deps: PrimarySchoolDeps, ctx: RequestContext, id: Uuid): Promise<Result<YearArchive, AppError>> {
  if (!ctx.userId) return err(forbidden("Un utilisateur authentifié est requis."));
  const userId = ctx.userId;
  return inTx(deps, ctx, async (tx) => {
    const archive = await getArchiveRow(tx, id, true);
    if (!archive) return err(notFound(PrimaryCode.ARCHIVE_NOT_FOUND, "Archive d'année", id));
    if (archive.status === "FROZEN") return err(conflict(PrimaryCode.ARCHIVE_FROZEN, "Cette année est déjà archivée.", { archiveId: id }));
    if (archive.status !== "READY") return err(conflict(PrimaryCode.ARCHIVE_NOT_READY, "L'archive n'est pas prête : préparer l'archive et sceller tous les bilans.", { status: archive.status }));
    // Re-vérification à l'instant du gel : aucun bilan vivant ne doit être resté non scellé depuis la préparation.
    const live = (await listReviewRows(tx, { yearId: archive.academicYearId, liveOnly: true, limit: 5000 })).filter((r) => r.institutionId === archive.institutionId);
    const unsealed = live.filter((r) => r.status !== "SEALED" || r.reportcardId === null).length;
    if (unsealed > 0 || live.length !== archive.reviewsTotal) {
      return err(conflict(PrimaryCode.ARCHIVE_NOT_READY, "Des bilans ont changé depuis la préparation : préparer à nouveau l'archive.", { unsealed, counted: archive.reviewsTotal, now: live.length }));
    }
    const frozen = await guarded(() => freezeArchiveRow(tx, id, userId, deps.clock.now()));
    const events = new EventBuffer(deps, ctx);
    events.add(PrimaryEvents.YEAR_ARCHIVE_FROZEN, { v: 1, archiveId: frozen.id, institutionId: frozen.institutionId, academicYearId: frozen.academicYearId, reviews: frozen.reviewsTotal, manifestHash: frozen.manifestHash }, { type: "primary_school.year_archive", id: frozen.id });
    events.audit({ action: "primary_school.year_archive.frozen", resourceType: "year_archive", resourceId: frozen.id, after: { reviews: frozen.reviewsTotal, manifestHash: frozen.manifestHash }, sensitive: true });
    await events.flush(tx);
    return ok(frozen);
  });
}
