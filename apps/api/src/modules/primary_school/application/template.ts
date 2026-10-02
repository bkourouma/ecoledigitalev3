/**
 * `instantiatePrimaryReferenceData` : instancie, depuis le modèle de pack `primary_school` (DONNÉES), l'échelle, les référentiels
 * (publiés : ils sont de démonstration), la banque de phrases et les paramètres d'un établissement.
 *
 * Idempotent par (établissement, système éducatif, version de modèle) : rejoué, il ne crée AUCUNE ligne ; il ne modifie jamais
 * une ligne existante (un code déjà présent est conservé tel que le tenant l'a laissé) ; il ne supprime jamais rien.
 * Sans fournisseur de modèle, le module échoue FERMÉ (`primary_school.template_unavailable`), sans repli silencieux.
 */
import { err, ok, type AppError, type RequestContext, type Result } from "@ecoledigitale/kernel";
import { PrimaryEvents } from "../domain/events";
import { PrimaryCode, validation } from "../domain/errors";
import { PrimarySchoolPackTemplateSchema } from "../domain/template";
import type { Uuid } from "../domain/types";
import { guarded } from "../infrastructure/db-errors";
import {
  findPhraseByCode,
  findScaleByCode,
  getTemplateApplication,
  insertFrameworkRow,
  insertPhraseRow,
  insertScaleRow,
  insertSettingsIfAbsent,
  insertTemplateApplication,
  listFrameworkRows,
  maxFrameworkVersion,
  replaceGradeLevels,
  replaceLevels,
  replaceStructure,
  setFrameworkStatus,
} from "../infrastructure/reference-repository";
import { resolveInstitution } from "./access";
import { actorOf, EventBuffer, inTx, type PrimarySchoolDeps } from "./deps";
import { InternalError } from "@ecoledigitale/kernel";

export interface TemplateResult {
  institutionId: Uuid;
  templateVersion: number;
  alreadyApplied: boolean;
  created: { scales: number; frameworks: number; phrases: number; settings: number };
}

export async function instantiatePrimaryReferenceData(
  deps: PrimarySchoolDeps,
  ctx: RequestContext,
  input: { institutionId?: Uuid | undefined; educationSystem?: string | undefined },
): Promise<Result<TemplateResult, AppError>> {
  const institution = await resolveInstitution(deps, ctx, input.institutionId);
  if (!institution.ok) return institution;
  const educationSystem = input.educationSystem ?? "CI";
  const raw = deps.ports.templates.getSection(educationSystem);
  if (raw === null || raw === undefined) {
    return err(new InternalError(`Aucun modèle de pack « primary_school » pour le système éducatif ${educationSystem}.`, { code: PrimaryCode.TEMPLATE_UNAVAILABLE, details: { educationSystem } }));
  }
  const parsed = PrimarySchoolPackTemplateSchema.safeParse(raw);
  if (!parsed.success) {
    return err(validation(PrimaryCode.TEMPLATE_UNAVAILABLE, `Le modèle de pack est invalide : ${parsed.error.issues[0]?.message ?? "format"}.`, "template"));
  }
  const template = parsed.data;

  return inTx(deps, ctx, async (tx) => {
    // Sérialise deux activations simultanées du même établissement.
    await tx.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [`primary_school:template:${ctx.tenantId}:${institution.value}`]);
    const applied = await getTemplateApplication(tx, institution.value, educationSystem, template.templateVersion);
    if (applied) {
      return ok<TemplateResult>({ institutionId: institution.value, templateVersion: template.templateVersion, alreadyApplied: true, created: { scales: 0, frameworks: 0, phrases: 0, settings: 0 } });
    }
    const created = { scales: 0, frameworks: 0, phrases: 0, settings: 0 };
    const scaleIds = new Map<string, Uuid>();
    await guarded(async () => {
      for (const s of template.ratingScales) {
        const existing = await findScaleByCode(tx, s.code);
        if (existing) {
          scaleIds.set(s.code, existing.id);
          continue;
        }
        const id = deps.newId();
        await insertScaleRow(tx, { id, tenantId: ctx.tenantId, code: s.code, label: s.label, sourceKind: s.sourceKind, sourceReference: s.sourceReference ?? null });
        await replaceLevels(tx, ctx.tenantId, id, s.levels.map((l) => ({ id: deps.newId(), ...l })));
        scaleIds.set(s.code, id);
        created.scales += 1;
      }
      const knownFrameworks = new Set((await listFrameworkRows(tx)).map((f) => f.code));
      for (const f of template.competencyFrameworks) {
        if (knownFrameworks.has(f.code) || (await maxFrameworkVersion(tx, f.code)) > 0) continue;
        const id = deps.newId();
        await insertFrameworkRow(tx, { id, tenantId: ctx.tenantId, code: f.code, version: 1, label: f.label, scaleId: scaleIds.get(f.scale) as Uuid, sourceKind: f.sourceKind, sourceReference: f.sourceReference ?? null });
        await replaceGradeLevels(tx, ctx.tenantId, id, f.gradeLevels);
        await replaceStructure(tx, ctx.tenantId, id, f, deps.newId);
        // Le jeu de démonstration est directement utilisable : publié.
        await setFrameworkStatus(tx, id, "PUBLISHED", actorOf(ctx), deps.clock.now());
        created.frameworks += 1;
      }
      for (const p of template.appreciationPhrases) {
        if (await findPhraseByCode(tx, p.code)) continue;
        await insertPhraseRow(tx, { id: deps.newId(), tenantId: ctx.tenantId, code: p.code, scope: p.scope, body: p.body, ratingLevelCode: p.ratingLevelCode ?? null, gradeLevelCode: p.gradeLevelCode ?? null, sourceKind: p.sourceKind });
        created.phrases += 1;
      }
      const defaultScale = template.ratingScales[0] ? scaleIds.get(template.ratingScales[0].code) ?? null : null;
      if (await insertSettingsIfAbsent(tx, ctx.tenantId, { institutionId: institution.value, ...template.settings, defaultRatingScaleId: defaultScale })) created.settings += 1;
      await insertTemplateApplication(tx, { id: deps.newId(), tenantId: ctx.tenantId, institutionId: institution.value, educationSystem, templateVersion: template.templateVersion, appliedBy: actorOf(ctx), summary: created });
    });
    const events = new EventBuffer(deps, ctx);
    events.add(PrimaryEvents.TEMPLATE_APPLIED, { v: 1, institutionId: institution.value, educationSystem, templateVersion: template.templateVersion, ...created }, { type: "primary_school.template", id: institution.value });
    events.audit({ action: "primary_school.template.applied", resourceType: "institution", resourceId: institution.value, after: { templateVersion: template.templateVersion, ...created }, sensitive: true });
    await events.flush(tx);
    return ok<TemplateResult>({ institutionId: institution.value, templateVersion: template.templateVersion, alreadyApplied: false, created });
  });
}
