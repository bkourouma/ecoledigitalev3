/**
 * Doublons (US11) : rapprochement des autres candidatures (clé d'identité normalisée), des élèves existants (`people`, score et
 * raisons) et des prospects (contacts communs). Les résultats sont des CANDIDATS à trancher (`OPEN`, `CONFIRMED_DUPLICATE`,
 * `DISMISSED`). Aucune donnée nominative n'est conservée dans `duplicate_candidates` : identifiants, score, codes de raison.
 * Un port `people` indisponible n'empêche pas la soumission (il empêche l'ACCEPTATION, qui le requiert).
 */
import type { Tx } from "@ecoledigitale/database";
import { err, ok, type AppError, type RequestContext, type Result } from "@ecoledigitale/kernel";
import type { AdmissionsDuplicateDto } from "@ecoledigitale/contracts/src/v2/admissions";
import { AdmissionsCode, conflict, notFound } from "../domain/errors";
import * as apps from "../infrastructure/application-repository";
import * as cases from "../infrastructure/case-repository";
import { EventBuffer, inTx, type AdmissionsDeps } from "./deps";
import { requireUser } from "./support";

export interface DetectionReport {
  readonly open: number;
  readonly found: number;
}

/** Détecte et enregistre les candidats de doublon d'une candidature (idempotent : un candidat tranché n'est jamais rouvert). */
export async function detectDuplicates(deps: AdmissionsDeps, ctx: RequestContext, tx: Tx, app: apps.ApplicationRow): Promise<DetectionReport> {
  let found = 0;
  for (const m of await cases.findApplicationDuplicates(tx, { applicationId: app.id, institutionId: app.institutionId, identityKey: app.identityKey })) {
    await cases.upsertDuplicate(tx, { id: deps.newId(), tenantId: ctx.tenantId, applicationId: app.id, matchedKind: "APPLICATION", matchedId: m.id, score: 100, reasons: m.sameCampaign ? ["IDENTITY", "SAME_CAMPAIGN"] : ["IDENTITY", "OTHER_CAMPAIGN"] });
    found += 1;
  }
  try {
    const students = await deps.ports.students.findDuplicateStudents(ctx, { lastName: app.applicantLastName, firstName: app.applicantFirstName, birthDate: app.applicantBirthDate });
    for (const s of students) {
      await cases.upsertDuplicate(tx, { id: deps.newId(), tenantId: ctx.tenantId, applicationId: app.id, matchedKind: "STUDENT", matchedId: s.studentId, score: Math.max(0, Math.min(100, Math.round(s.score))), reasons: s.reasons });
      found += 1;
    }
  } catch (e) {
    const code = (e as { code?: string } | null)?.code;
    if (code !== AdmissionsCode.PORT_UNAVAILABLE) throw e;
    deps.logger.warn({ applicationId: app.id }, "admissions : rapprochement des élèves indisponible (port people), ignoré à la soumission");
  }
  const guardians = await apps.listGuardians(tx, app.id);
  const prospects = await cases.findProspectDuplicates(tx, {
    institutionId: app.institutionId,
    emails: guardians.map((g) => g.email).filter((e): e is string => !!e),
    phones: guardians.map((g) => g.phone).filter((p): p is string => !!p),
    excludeProspectId: app.prospectId,
  });
  for (const p of prospects) {
    await cases.upsertDuplicate(tx, { id: deps.newId(), tenantId: ctx.tenantId, applicationId: app.id, matchedKind: "PROSPECT", matchedId: p.id, score: 60, reasons: ["CONTACT"] });
    found += 1;
  }
  return { open: await cases.countOpenDuplicates(tx, app.id), found };
}

export async function listDuplicates(deps: AdmissionsDeps, ctx: RequestContext, applicationId: string): Promise<Result<AdmissionsDuplicateDto[], AppError>> {
  return inTx(
    deps,
    ctx,
    async (tx) => {
      if (!(await apps.getApplicationRow(tx, applicationId))) return err(notFound(AdmissionsCode.APPLICATION_NOT_FOUND, "Candidature", applicationId));
      return ok(await cases.listDuplicates(tx, applicationId));
    },
    { readOnly: true },
  );
}

export async function runDetection(deps: AdmissionsDeps, ctx: RequestContext, applicationId: string): Promise<Result<AdmissionsDuplicateDto[], AppError>> {
  return inTx(deps, ctx, async (tx) => {
    const app = await apps.getApplicationRow(tx, applicationId, { forUpdate: true });
    if (!app) return err(notFound(AdmissionsCode.APPLICATION_NOT_FOUND, "Candidature", applicationId));
    if (app.anonymizedAt) return err(conflict(AdmissionsCode.APPLICATION_ANONYMIZED, "Ce dossier est anonymisé."));
    const report = await detectDuplicates(deps, ctx, tx, app);
    const buffer = new EventBuffer(deps, ctx);
    buffer.audit({ action: "admissions.duplicate.detect", resourceType: "application", resourceId: applicationId, metadata: { open: report.open, found: report.found } });
    await buffer.flush(tx);
    return ok(await cases.listDuplicates(tx, applicationId));
  });
}

export async function resolveDuplicate(deps: AdmissionsDeps, ctx: RequestContext, applicationId: string, duplicateId: string, resolution: "CONFIRMED_DUPLICATE" | "DISMISSED"): Promise<Result<AdmissionsDuplicateDto, AppError>> {
  const user = requireUser(ctx);
  if (!user.ok) return user;
  return inTx(deps, ctx, async (tx) => {
    const app = await apps.getApplicationRow(tx, applicationId, { forUpdate: true });
    if (!app) return err(notFound(AdmissionsCode.APPLICATION_NOT_FOUND, "Candidature", applicationId));
    const current = await cases.getDuplicate(tx, applicationId, duplicateId);
    if (!current) return err(notFound(AdmissionsCode.DUPLICATE_NOT_FOUND, "Rapprochement", duplicateId));
    if (current.status !== "OPEN") return err(conflict(AdmissionsCode.DUPLICATE_NOT_FOUND, "Ce rapprochement est déjà tranché."));
    await cases.resolveDuplicate(tx, applicationId, duplicateId, resolution, user.value);
    const buffer = new EventBuffer(deps, ctx);
    buffer.audit({ action: "admissions.duplicate.resolve", resourceType: "application", resourceId: applicationId, metadata: { duplicateId, kind: current.matchedKind, resolution } });
    await buffer.flush(tx);
    return ok((await cases.getDuplicate(tx, applicationId, duplicateId)) as AdmissionsDuplicateDto);
  });
}
