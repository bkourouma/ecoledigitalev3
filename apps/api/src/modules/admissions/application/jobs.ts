/**
 * Travaux planifiés (jobs du worker) : expiration des offres, délai de paiement des frais d'inscription (compensation), purge
 * des jetons de formulaire et des tentatives, anonymisation échue. Tous IDEMPOTENTS (le planificateur peut rejouer) ; un échec
 * sur un dossier n'arrête pas les autres ; un tenant en échec n'arrête pas les autres.
 */
import { createSystemContext, ok, type RequestContext } from "@ecoledigitale/kernel";
import type { ForEachTenantReport, SystemDb } from "@ecoledigitale/database";
import * as apps from "../infrastructure/application-repository";
import * as cases from "../infrastructure/case-repository";
import * as pub from "../infrastructure/public-repository";
import { anonymizeExpired, type AnonymizeReport } from "./anonymize";
import { EventBuffer, inTx, type AdmissionsDeps } from "./deps";
import { expireOffer, findClosure, closeApplication } from "./offers";
import { nowIso } from "./support";

export interface ExpireReport {
  readonly expired: number;
  readonly failed: number;
}

/** Offres `PENDING` échues : `EXPIRED`, dossier clos « offre expirée », place libérée (promotion éventuelle). */
export async function expireOffers(deps: AdmissionsDeps, ctx: RequestContext): Promise<ExpireReport> {
  const due = await inTx(deps, ctx, async (tx) => ok(await cases.listExpiredPendingOffers(tx, nowIso(deps), deps.config.jobBatchSize)), { readOnly: true });
  if (!due.ok) throw due.error;
  let expired = 0;
  let failed = 0;
  for (const o of due.value) {
    const r = await expireOffer(deps, ctx, o.offerId);
    if (!r.ok) {
      failed += 1;
      deps.logger.warn({ offerId: o.offerId, code: r.error.code }, "admissions : expiration d'offre en échec");
    } else if (r.value.expired) expired += 1;
  }
  return { expired, failed };
}

export interface DeadlineReport {
  readonly cancelled: number;
  readonly skipped: number;
}

/**
 * Délai de paiement (`payment_deadline_days`, VIDE par défaut : aucune annulation automatique). Passé le délai, sans confirmation :
 * inscription en attente annulée (`academic`), facture annulée (`finance`), dossier clos « offre expirée » par une décision
 * système, place libérée. Le dossier de l'élève n'est JAMAIS supprimé (son matricule reste consommé, aucun numéro n'est réutilisé).
 * Une facture déjà partiellement payée ne s'annule pas : le dossier est laissé tel quel et signalé (journal).
 */
export async function enforcePaymentDeadline(deps: AdmissionsDeps, ctx: RequestContext): Promise<DeadlineReport> {
  const due = await inTx(
    deps,
    ctx,
    async (tx) =>
      ok(
        await tx.many<{ id: string }>(
          `SELECT a.id FROM admissions.applications a
             JOIN admissions.workflow_stages s ON s.tenant_id = a.tenant_id AND s.id = a.stage_id
             JOIN admissions.settings st ON st.tenant_id = a.tenant_id AND st.institution_id = a.institution_id
            WHERE s.creates_enrollment AND a.enrollment_confirmed_at IS NULL AND a.enrollment_id IS NOT NULL AND st.payment_deadline_days IS NOT NULL
              AND (SELECT max(t.occurred_at) FROM admissions.transitions t WHERE t.tenant_id = a.tenant_id AND t.application_id = a.id AND t.to_stage_id = a.stage_id)
                  + make_interval(days => st.payment_deadline_days) <= $1::timestamptz
            ORDER BY a.updated_at LIMIT $2`,
          [nowIso(deps), deps.config.jobBatchSize],
        ),
      ),
    { readOnly: true },
  );
  if (!due.ok) throw due.error;
  let cancelled = 0;
  let skipped = 0;
  for (const { id } of due.value) {
    const r = await inTx(deps, ctx, async (tx, scope) => {
      const app = await apps.getApplicationRow(tx, id, { forUpdate: true });
      if (!app || !app.stageCreatesEnrollment || app.enrollmentConfirmedAt || !app.enrollmentId) return ok(false);
      if (!(await findClosure(tx, app, ["OFFER_EXPIRED", "WITHDRAWN_BY_FAMILY"]))) return ok(false);
      await deps.ports.enrollments.cancelEnrollment(ctx, app.enrollmentId, "Délai de paiement des frais d'inscription dépassé");
      if (app.invoiceId) await deps.ports.fees.cancelInvoice(ctx, app.invoiceId, "Délai de paiement des frais d'inscription dépassé");
      const events = new EventBuffer(deps, ctx);
      const closed = await closeApplication(deps, ctx, tx, scope, events, app, "OFFER_EXPIRED", "PAYMENT_DEADLINE");
      events.audit({ action: "admissions.payment_deadline.enforce", resourceType: "application", resourceId: app.id, metadata: { enrollmentId: app.enrollmentId, invoiceId: app.invoiceId } });
      await events.flush(tx);
      return ok(closed);
    });
    if (r.ok && r.value) cancelled += 1;
    else {
      skipped += 1;
      if (!r.ok) deps.logger.warn({ applicationId: id, code: r.error.code }, "admissions : annulation au délai de paiement impossible, dossier laissé en l'état");
    }
  }
  return { cancelled, skipped };
}

export interface PurgeReport {
  readonly sessions: number;
  readonly attempts: number;
}

/** Jetons de formulaire expirés et tentatives de plus de 30 jours (rétention courte, empreintes seulement). */
export async function purgePublicFormData(deps: AdmissionsDeps, ctx: RequestContext): Promise<PurgeReport> {
  const r = await inTx(deps, ctx, async (tx) => ok({ sessions: await pub.purgeFormSessions(tx, 1), attempts: await pub.purgeAttempts(tx, deps.config.attemptsRetentionDays) }));
  if (!r.ok) throw r.error;
  return r.value;
}

// ---------------------------------------------------------------------------
// Tous les tenants (jobs)
// ---------------------------------------------------------------------------

export const expireOffersAllTenants = (deps: AdmissionsDeps, systemDb: SystemDb): Promise<ForEachTenantReport<ExpireReport>> =>
  systemDb.forEachTenant("admissions-expire-offers", async (_tx, tenant) => expireOffers(deps, createSystemContext(tenant.id)));

export const enforcePaymentDeadlineAllTenants = (deps: AdmissionsDeps, systemDb: SystemDb): Promise<ForEachTenantReport<DeadlineReport>> =>
  systemDb.forEachTenant("admissions-payment-deadline", async (_tx, tenant) => enforcePaymentDeadline(deps, createSystemContext(tenant.id)));

export const purgePublicFormDataAllTenants = (deps: AdmissionsDeps, systemDb: SystemDb): Promise<ForEachTenantReport<PurgeReport>> =>
  systemDb.forEachTenant("admissions-purge-public", async (_tx, tenant) => purgePublicFormData(deps, createSystemContext(tenant.id)));

export const anonymizeExpiredAllTenants = (deps: AdmissionsDeps, systemDb: SystemDb): Promise<ForEachTenantReport<AnonymizeReport>> =>
  systemDb.forEachTenant("admissions-anonymize-expired", async (_tx, tenant) => anonymizeExpired(deps, createSystemContext(tenant.id)));
