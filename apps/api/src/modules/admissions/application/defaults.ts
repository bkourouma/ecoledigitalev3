/**
 * Initialisation d'un établissement (`tenancy.institution.created`) : ligne de paramètres (valeurs par défaut de la base),
 * workflow modèle PUBLIÉ (étapes et transitions livrées en donnée), motifs de décision par défaut. Idempotent : ne touche jamais
 * une ligne personnalisée. Aucune classe de priorité, aucune pièce exigée, aucun texte de consentement n'est imposé (données de
 * l'établissement) ; le formulaire public reste FERMÉ tant qu'aucun texte de consentement n'est publié et désigné.
 */
import { ok, type AppError, type RequestContext, type Result } from "@ecoledigitale/kernel";
import { DEFAULT_DECISION_REASONS, DEFAULT_WORKFLOW_CODE, DEFAULT_WORKFLOW_LABEL } from "../domain/default-workflow";
import * as ref from "../infrastructure/reference-repository";
import * as wf from "../infrastructure/workflow-repository";
import { EventBuffer, inTx, type AdmissionsDeps } from "./deps";
import { ensureDefaultWorkflow } from "./workflows";

export interface DefaultsReport {
  readonly workflowId: string;
  readonly workflowCreated: boolean;
  readonly reasonsCreated: number;
}

export async function ensureInstitutionDefaults(deps: AdmissionsDeps, ctx: RequestContext, institutionId: string): Promise<Result<DefaultsReport, AppError>> {
  return inTx(deps, ctx, async (tx) => {
    await ref.ensureSettingsRow(tx, ctx.tenantId, institutionId);
    const before = await wf.getPublishedWorkflowId(tx, institutionId, null);
    const workflowId = await ensureDefaultWorkflow(deps, ctx, tx, institutionId, DEFAULT_WORKFLOW_CODE, DEFAULT_WORKFLOW_LABEL);
    let reasonsCreated = 0;
    for (const r of DEFAULT_DECISION_REASONS) {
      if (await ref.insertDecisionReasonIfAbsent(tx, { id: deps.newId(), tenantId: ctx.tenantId, institutionId, code: r.code, kind: r.kind, label: r.label })) reasonsCreated += 1;
    }
    if (!before || reasonsCreated > 0) {
      const buffer = new EventBuffer(deps, ctx);
      buffer.audit({ action: "admissions.institution.initialize", resourceType: "settings", resourceId: institutionId, metadata: { workflowCreated: !before, reasonsCreated } });
      await buffer.flush(tx);
    }
    return ok({ workflowId, workflowCreated: !before, reasonsCreated });
  });
}
