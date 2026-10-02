/**
 * Jobs du module (worker) : alertes d'expiration et entretien (purge de rétention, quarantaine périmée). Un tenant à la fois ;
 * un tenant en échec n'arrête pas les autres. Tous les traitements sont IDEMPOTENTS (le planificateur peut les rejouer).
 */
import { createSystemContext, ok, unwrap, type RequestContext } from "@ecoledigitale/kernel";
import type { ForEachTenantReport, SystemDb } from "@ecoledigitale/database";
import { DocumentsEvents } from "../domain/events";
import { addDays, daysBetween, dueAlert, effectiveAlertDays } from "../domain/expiry";
import * as docs from "../infrastructure/documents-repository";
import * as sharesRepo from "../infrastructure/shares-repository";
import { EventBuffer, inTx, type DocumentsDeps } from "./deps";
import { deleteQuarantine } from "./quarantine";
import { ensureDefaults, todayOf } from "./support";

/** Horizon de recherche des échéances : au-delà d'un an et un mois aucune alerte n'est due (seuils ≤ 365 jours). */
const HORIZON_DAYS = 400;

export interface ExpiryReport {
  checked: number;
  alerted: number;
  expired: number;
}

/**
 * Alertes d'un tenant : pour chaque document actif daté dont l'échéance franchit un seuil non encore émis, UNE alerte
 * `documents.document.expiring` (seuil le plus précis) et les seuils franchis sont mémorisés dans la même transaction ; une fois
 * l'échéance passée, UNE alerte `documents.document.expired`. Aucun titre ni nom de fichier dans les événements.
 */
export async function sweepExpirations(deps: DocumentsDeps, ctx: RequestContext): Promise<ExpiryReport> {
  const report: ExpiryReport = { checked: 0, alerted: 0, expired: 0 };
  const today = todayOf(deps);
  const horizon = addDays(today, HORIZON_DAYS);
  let after: string | null = null;
  for (;;) {
    const batch = unwrap(
      await inTx(deps, ctx, async (tx) => {
        const settings = await ensureDefaults(deps, tx, ctx);
        const rows = await docs.listExpiryCandidates(tx, ctx.tenantId, horizon, after, deps.config.jobBatchSize);
        const now = deps.clock.now();
        const events = new EventBuffer(deps, ctx);
        let alerted = 0;
        let expired = 0;
        for (const d of rows) {
          const days = daysBetween(today, d.expiresOn);
          const base = { v: 1 as const, documentId: d.id, categoryId: d.categoryId, kind: d.kind, ownerType: d.ownerType, ownerId: d.ownerId, createdBy: d.createdBy, expiresOn: d.expiresOn };
          if (days >= 0) {
            const thresholds = effectiveAlertDays(d.alertDays, d.categoryAlertDays, settings.defaultAlertDays);
            const due = dueAlert(days, thresholds, d.alertsSent);
            if (due.emit === null) continue;
            events.add(DocumentsEvents.DOCUMENT_EXPIRING, { ...base, daysLeft: days, threshold: due.emit }, { type: "document", id: d.id });
            await docs.markAlerts(tx, ctx.tenantId, d.id, [...new Set([...d.alertsSent, ...due.mark])], null);
            await sharesRepo.insertHistory(tx, ctx.tenantId, { id: deps.newId(), documentId: d.id, action: "EXPIRY_ALERTED", actorId: null, detail: { daysLeft: days, threshold: due.emit } }, now);
            alerted += 1;
          } else if (d.expiredNotifiedAt === null) {
            events.add(DocumentsEvents.DOCUMENT_EXPIRED, { ...base, daysOverdue: -days }, { type: "document", id: d.id });
            await docs.markAlerts(tx, ctx.tenantId, d.id, d.alertsSent, now);
            await sharesRepo.insertHistory(tx, ctx.tenantId, { id: deps.newId(), documentId: d.id, action: "EXPIRED", actorId: null, detail: { daysOverdue: -days } }, now);
            expired += 1;
          }
        }
        await events.flush(tx);
        return ok({ count: rows.length, last: rows[rows.length - 1]?.id ?? null, alerted, expired });
      }),
    );
    report.checked += batch.count;
    report.alerted += batch.alerted;
    report.expired += batch.expired;
    if (batch.count < deps.config.jobBatchSize || batch.last === null) break;
    after = batch.last;
  }
  return report;
}

export interface HousekeepingReport {
  documentsPurged: number;
  versionsPurged: number;
  quarantineDeleted: number;
  failures: number;
}

/**
 * Entretien d'un tenant : (1) purge des documents ARCHIVÉS dont la rétention est échue — les objets sont supprimés D'ABORD,
 * la ligne n'est marquée purgée que si le stockage a répondu (échec : la ligne reste, le job réessaiera) ; l'historique et les
 * empreintes restent, le contenu descriptif est effacé ; (2) destruction des fichiers de quarantaine non traités échus.
 */
export async function runHousekeeping(deps: DocumentsDeps, ctx: RequestContext): Promise<HousekeepingReport> {
  const report: HousekeepingReport = { documentsPurged: 0, versionsPurged: 0, quarantineDeleted: 0, failures: 0 };
  const now = deps.clock.now();

  const candidates = unwrap(await inTx(deps, ctx, async (tx) => ok(await docs.listPurgeCandidates(tx, ctx.tenantId, now, deps.config.jobBatchSize)), { readOnly: true }));
  for (const c of candidates) {
    const versions = unwrap(await inTx(deps, ctx, async (tx) => ok(await docs.listActiveVersionsOf(tx, ctx.tenantId, c.id)), { readOnly: true }));
    try {
      for (const v of versions) {
        await deps.ports.storage.delete(v.storageKey);
        if (v.renditionKey) await deps.ports.storage.delete(v.renditionKey);
      }
    } catch (e) {
      report.failures += 1;
      deps.logger.warn({ documentId: c.id, err: e instanceof Error ? e.message : String(e) }, "documents : purge reportée (suppression d'objet impossible)");
      continue;
    }
    unwrap(
      await inTx(deps, ctx, async (tx) => {
        const at = deps.clock.now();
        const purged = await docs.markVersionsPurged(tx, ctx.tenantId, c.id, at);
        await docs.markDocumentPurged(tx, ctx.tenantId, c.id, at);
        await sharesRepo.insertHistory(tx, ctx.tenantId, { id: deps.newId(), documentId: c.id, action: "PURGED", actorId: null, detail: { versionsPurged: purged } }, at);
        const events = new EventBuffer(deps, ctx);
        events.add(DocumentsEvents.DOCUMENT_PURGED, { v: 1, documentId: c.id, categoryId: c.categoryId, kind: c.kind, ownerType: c.ownerType, ownerId: c.ownerId, versionsPurged: purged }, { type: "document", id: c.id });
        events.audit({ action: "documents.document.purged", resourceType: "document", resourceId: c.id, sensitive: true, metadata: { versionsPurged: purged, categoryId: c.categoryId, automatic: true } });
        await events.flush(tx);
        report.versionsPurged += purged;
        return ok(true as const);
      }),
    );
    report.documentsPurged += 1;
  }

  const settings = unwrap(await inTx(deps, ctx, async (tx) => ok(await ensureDefaults(deps, tx, ctx))));
  const before = new Date(now.getTime() - settings.quarantineRetentionDays * 86_400_000);
  const held = unwrap(await inTx(deps, ctx, async (tx) => ok(await sharesRepo.listExpiredQuarantine(tx, ctx.tenantId, before, deps.config.jobBatchSize)), { readOnly: true }));
  for (const q of held) {
    try {
      const r = await deleteQuarantine(deps, ctx, { id: q.id, note: "Rétention de quarantaine échue.", automatic: true });
      if (r.ok) report.quarantineDeleted += 1;
      else report.failures += 1;
    } catch (e) {
      report.failures += 1;
      deps.logger.warn({ quarantineId: q.id, err: e instanceof Error ? e.message : String(e) }, "documents : destruction de quarantaine reportée");
    }
  }
  return report;
}

// ---------------------------------------------------------------------------
// Tous les tenants (jobs)
// ---------------------------------------------------------------------------

export function sweepExpirationsAllTenants(deps: DocumentsDeps, systemDb: SystemDb): Promise<ForEachTenantReport<ExpiryReport>> {
  return systemDb.forEachTenant("documents-expiry-sweep", async (_tx, tenant) => sweepExpirations(deps, createSystemContext(tenant.id)));
}

export function housekeepingAllTenants(deps: DocumentsDeps, systemDb: SystemDb): Promise<ForEachTenantReport<HousekeepingReport>> {
  return systemDb.forEachTenant("documents-housekeeping", async (_tx, tenant) => runHousekeeping(deps, createSystemContext(tenant.id)));
}
