/**
 * Données personnelles d'enfants (US13) : anonymisation d'un dossier CLOS SANS INSCRIPTION (refusé, retiré, offre expirée) à
 * l'échéance de `rejected_retention_months` (VIDE par défaut : aucune purge automatique, question Q-A04) ou sur demande motivée
 * (permission sensible, MFA, audit) ; export du dossier (droit d'accès).
 *
 * Ordre : les FICHIERS sont purgés d'abord (port `DocumentStore`), puis la fonction SQL `anonymize_application` neutralise
 * identité, tuteurs, pièces et champs libres (atomique, idempotente) ; décisions, dates et compteurs (sans nom) sont conservés.
 * Un dossier inscrit n'est JAMAIS anonymisé ici (voir people `anonymizeStudent`).
 */
import { err, ok, type AppError, type RequestContext, type Result } from "@ecoledigitale/kernel";
import type { AdmissionsApplicationDetailDto, AdmissionsHistoryDto } from "@ecoledigitale/contracts/src/v2/admissions";
import { AdmissionsCode, conflict, notFound } from "../domain/errors";
import { AdmissionsEvents } from "../domain/events";
import * as apps from "../infrastructure/application-repository";
import * as cases from "../infrastructure/case-repository";
import * as ref from "../infrastructure/reference-repository";
import { buildDetail } from "./applications";
import { EventBuffer, inTx, type AdmissionsDeps } from "./deps";
import { applicationRef } from "./transitions";

function eligible(app: apps.ApplicationRow): AppError | null {
  if (app.status !== "REJECTED" || app.studentId || !app.closedAt) {
    return conflict(AdmissionsCode.ANONYMIZE_FORBIDDEN, "Seule une candidature close sans inscription s'anonymise (un dossier inscrit relève de people).", { status: app.status });
  }
  return null;
}

export interface AnonymizeInput {
  readonly applicationId: string;
  /** Motif (demande de la famille, fin de conservation…) : conservé dans l'audit. */
  readonly reason: string;
  readonly retention?: boolean;
}

export async function anonymizeApplication(deps: AdmissionsDeps, ctx: RequestContext, input: AnonymizeInput): Promise<Result<{ anonymized: true; applicationId: string }, AppError>> {
  // Temps 1 : éligibilité et liste des fichiers (lecture).
  const plan = await inTx(
    deps,
    ctx,
    async (tx) => {
      const app = await apps.getApplicationRow(tx, input.applicationId);
      if (!app) return err(notFound(AdmissionsCode.APPLICATION_NOT_FOUND, "Candidature", input.applicationId));
      if (app.anonymizedAt) return ok({ already: true, files: [] as Array<{ storageKey: string | null; documentRef: string | null }> });
      const problem = eligible(app);
      if (problem) return err(problem);
      return ok({ already: false, files: await cases.listDocumentFiles(tx, input.applicationId) });
    },
    { readOnly: true },
  );
  if (!plan.ok) return plan;
  if (plan.value.already) return ok({ anonymized: true as const, applicationId: input.applicationId });

  // Temps 2 : purge des fichiers AVANT la fonction SQL (tolérante : un fichier déjà absent n'arrête rien).
  for (const f of plan.value.files) {
    await deps.ports.documents.remove(ctx, { storageKey: f.storageKey, documentRef: f.documentRef });
  }

  // Temps 3 : neutralisation atomique.
  return inTx(deps, ctx, async (tx) => {
    const app = await apps.getApplicationRow(tx, input.applicationId, { forUpdate: true });
    if (!app) return err(notFound(AdmissionsCode.APPLICATION_NOT_FOUND, "Candidature", input.applicationId));
    const problem = eligible(app);
    if (problem && !app.anonymizedAt) return err(problem);
    await tx.query(`SELECT admissions.anonymize_application($1)`, [input.applicationId]);
    const buffer = new EventBuffer(deps, ctx);
    buffer.add(AdmissionsEvents.APPLICATION_ANONYMIZED, { v: 1, ...applicationRef(app) }, { type: "application", id: app.id });
    buffer.audit({ action: "admissions.application.anonymize", resourceType: "application", resourceId: app.id, sensitive: true, reason: input.reason, metadata: { retention: input.retention === true, files: plan.value.files.length } });
    await buffer.flush(tx);
    return ok({ anonymized: true as const, applicationId: app.id });
  });
}

export interface AnonymizeReport {
  readonly anonymized: number;
  readonly failed: number;
}

/** Travail planifié (par tenant) : anonymise les dossiers clos sans inscription dont la conservation est échue. Inactif tant que la durée est vide. */
export async function anonymizeExpired(deps: AdmissionsDeps, ctx: RequestContext): Promise<AnonymizeReport> {
  const due = await inTx(
    deps,
    ctx,
    async (tx) => {
      const settings = await tx.many<{ institutionId: string; months: number }>(`SELECT institution_id AS "institutionId", rejected_retention_months AS months FROM admissions.settings WHERE rejected_retention_months IS NOT NULL`);
      const ids: string[] = [];
      for (const s of settings) {
        const rows = await tx.many<{ id: string }>(
          `SELECT id FROM admissions.applications
            WHERE institution_id = $1 AND status = 'REJECTED' AND student_id IS NULL AND anonymized_at IS NULL AND closed_at IS NOT NULL
              AND closed_at <= $2::timestamptz - make_interval(months => $3)
            ORDER BY closed_at LIMIT $4`,
          [s.institutionId, deps.clock.now().toISOString(), s.months, deps.config.jobBatchSize],
        );
        ids.push(...rows.map((r) => r.id));
      }
      return ok(ids);
    },
    { readOnly: true },
  );
  if (!due.ok) throw due.error;
  let anonymized = 0;
  let failed = 0;
  for (const applicationId of due.value) {
    const r = await anonymizeApplication(deps, ctx, { applicationId, reason: "Fin de la durée de conservation des dossiers clos", retention: true });
    if (r.ok) anonymized += 1;
    else {
      failed += 1;
      deps.logger.warn({ applicationId, code: r.error.code }, "admissions : anonymisation échue en échec");
    }
  }
  return { anonymized, failed };
}

// ---------------------------------------------------------------------------
// Droit d'accès : export du dossier
// ---------------------------------------------------------------------------

export interface ApplicationExport {
  readonly exportedAt: string;
  readonly application: AdmissionsApplicationDetailDto;
  readonly history: AdmissionsHistoryDto;
  readonly notifications: Array<{ templateCode: string; channel: string; status: string; queuedAt: string }>;
}

/** Export du dossier d'un candidat (identité, tuteurs, consentements, pièces, décisions, historique) : lecture AUDITÉE. */
export async function exportApplication(deps: AdmissionsDeps, ctx: RequestContext, applicationId: string): Promise<Result<ApplicationExport, AppError>> {
  return inTx(deps, ctx, async (tx) => {
    const app = await apps.getApplicationRow(tx, applicationId);
    if (!app) return err(notFound(AdmissionsCode.APPLICATION_NOT_FOUND, "Candidature", applicationId));
    const detail = await buildDetail(deps, tx, app);
    const history = await apps.getHistory(tx, applicationId);
    const notifications = (await cases.listNotifications(tx, applicationId)).map((n) => ({ templateCode: n.templateCode, channel: n.channel, status: n.status, queuedAt: n.queuedAt }));
    const buffer = new EventBuffer(deps, ctx);
    buffer.audit({ action: "admissions.application.export", resourceType: "application", resourceId: applicationId, sensitive: true });
    await buffer.flush(tx);
    void ref;
    return ok({ exportedAt: deps.clock.now().toISOString(), application: detail, history, notifications });
  });
}
