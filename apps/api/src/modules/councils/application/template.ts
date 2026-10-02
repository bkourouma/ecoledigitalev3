/**
 * `instantiateCouncilsReferenceData` : instancie, depuis le modèle de pack `councils` (DONNÉES), les rôles de participants, les types de
 * conseil, les types de décision et les réglages d'un établissement du pack SECONDARY.
 *
 * Idempotent : rejoué, il ne crée AUCUNE ligne ; il ne modifie JAMAIS une ligne existante (un code déjà présent est conservé tel que
 * l'établissement l'a personnalisé) ; il ne supprime jamais rien. Sans modèle pour le système éducatif, le module échoue FERMÉ
 * (`councils.template_unavailable`) — jamais de repli silencieux. Tout le modèle livré est générique et de démonstration : aucun quorum,
 * aucun parcours d'orientation, aucune règle de passage officiels.
 */
import { err, InternalError, ok, type AppError, type RequestContext, type Result } from "@ecoledigitale/kernel";
import { CouncilsCode, invalid } from "../domain/errors";
import { CouncilsPackTemplateSchema } from "../domain/template";
import * as reference from "../infrastructure/reference-repository";
import { EventBuffer, inTx, type CouncilsDeps } from "./deps";

export interface TemplateResult {
  institutionId: string;
  templateVersion: number;
  created: { roles: number; councilTypes: number; decisionTypes: number; settings: number };
}

export async function instantiateCouncilsReferenceData(deps: CouncilsDeps, ctx: RequestContext, input: { institutionId: string; educationSystem?: string | undefined }): Promise<Result<TemplateResult, AppError>> {
  const educationSystem = input.educationSystem ?? "CI";
  const raw = deps.ports.templates.getSection(educationSystem);
  if (raw === null || raw === undefined) return err(new InternalError(`Aucun modèle de pack « councils » pour le système éducatif ${educationSystem}.`, { code: CouncilsCode.TEMPLATE_UNAVAILABLE, details: { educationSystem } }));
  const parsed = CouncilsPackTemplateSchema.safeParse(raw);
  if (!parsed.success) return err(invalid(CouncilsCode.TEMPLATE_UNAVAILABLE, `Le modèle de pack est invalide : ${parsed.error.issues[0]?.message ?? "format"}.`, "template"));
  const template = parsed.data;
  return inTx(deps, ctx, async (tx) => {
    // Sérialise deux instanciations simultanées du même établissement.
    await reference.lockTemplateInstantiation(tx, `councils:template:${ctx.tenantId}:${input.institutionId}`);
    const created = { roles: 0, councilTypes: 0, decisionTypes: 0, settings: 0 };
    for (const r of template.participantRoles) {
      if (await reference.getRoleByCode(tx, r.code)) continue;
      await reference.upsertRole(tx, ctx.tenantId, deps.newId(), { code: r.code, label: r.label, isVoting: r.isVoting, countsForQuorum: r.countsForQuorum, maySign: r.maySign, canDecide: r.canDecide, isExternal: r.isExternal, sortOrder: r.sortOrder, active: true });
      created.roles += 1;
    }
    for (const t of template.councilTypes) {
      if (await reference.getCouncilTypeByCode(tx, t.code)) continue;
      await reference.upsertCouncilType(tx, ctx.tenantId, deps.newId(), { code: t.code, label: t.label, scope: t.scope, minResultsStatus: t.minResultsStatus, minParticipants: t.minParticipants, requiredRoleCodes: t.requiredRoleCodes, signerFunctions: t.signerFunctions, signerRoleCodes: t.signerRoleCodes, requiresDecisionPerStudent: t.requiresDecisionPerStudent, sortOrder: t.sortOrder, active: true });
      created.councilTypes += 1;
    }
    for (const d of template.decisionTypes) {
      if (await reference.getDecisionTypeByCode(tx, d.code)) continue;
      await reference.upsertDecisionType(
        tx,
        ctx.tenantId,
        deps.newId(),
        {
          code: d.code,
          label: d.label,
          family: d.family,
          appliesTo: d.appliesTo,
          exclusiveGroup: d.exclusiveGroup,
          requiresJustification: d.requiresJustification,
          requiresVote: d.requiresVote,
          requiresTarget: d.requiresTarget || d.family === "ORIENTATION" || d.family === "REORIENTATION",
          resultsDecisionKind: d.resultsDecisionKind,
          resultsFinalCode: d.resultsFinalCode,
          academicOutcomeCode: d.academicOutcomeCode,
          needsHumanApplication: d.needsHumanApplication || d.family === "EXCLUSION",
          studentStatus: d.studentStatus,
          sortOrder: d.sortOrder,
          active: true,
        },
        true,
      );
      created.decisionTypes += 1;
    }
    if (await reference.insertSettingsIfAbsent(tx, ctx.tenantId, input.institutionId, { ...template.settings, minutesTemplateKey: null })) created.settings += 1;
    const ev = new EventBuffer(deps, ctx);
    ev.audit({ action: "councils.template.applied", resourceType: "institution", resourceId: input.institutionId, sensitive: true, after: { templateVersion: template.templateVersion, ...created } });
    await ev.flush(tx);
    return ok<TemplateResult>({ institutionId: input.institutionId, templateVersion: template.templateVersion, created });
  });
}
