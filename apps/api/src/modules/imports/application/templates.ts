/**
 * Modèles de mapping de colonnes, propres au tenant et à l'importeur : création (depuis un mapping validé), liste,
 * renommage / remplacement du mapping, suppression. Un nom est unique par importeur (insensible à la casse).
 */
import { err, ok, type AppError, type RequestContext, type Result } from "@ecoledigitale/kernel";
import type { ImportCreateTemplateBody, ImportMappingTemplateDto, ImporterKey } from "@ecoledigitale/contracts/src/v2/imports";
import { conflict, notFound, validation } from "../domain/errors";
import { validateMapping } from "../domain/mapping";
import { deleteTemplate, getTemplate, insertTemplate, listTemplates, updateTemplate } from "../infrastructure/jobs-repository";
import { findImporter } from "../importers/registry";
import { EventBuffer, inTx, type ImportsDeps } from "./deps";
import { toTemplateDto } from "./views";

export async function listMappingTemplates(deps: ImportsDeps, ctx: RequestContext, importerKey?: ImporterKey): Promise<Result<ImportMappingTemplateDto[], AppError>> {
  return inTx(deps, ctx, async (tx) => ok((await listTemplates(tx, importerKey)).map(toTemplateDto)), { readOnly: true });
}

const isUniqueViolation = (e: unknown): boolean => typeof e === "object" && e !== null && (e as { code?: string }).code === "23505";

export async function createMappingTemplate(deps: ImportsDeps, ctx: RequestContext, body: ImportCreateTemplateBody): Promise<Result<ImportMappingTemplateDto, AppError>> {
  const importer = findImporter(body.importerKey);
  if (!importer) return err(validation("imports.importer_unknown", "Importeur inconnu.", "importerKey"));
  // Un modèle n'a pas à être complet (l'utilisateur peut en enregistrer un partiel) : on refuse seulement les champs inconnus.
  const known = new Set(importer.columns.map((c) => c.key));
  const unknown = Object.keys(body.mapping).filter((k) => !known.has(k));
  if (unknown.length > 0) return err(validation("imports.mapping_invalid", `Champ(s) inconnu(s) : ${unknown.join(", ")}.`, "mapping"));
  return inTx(deps, ctx, async (tx) => {
    const id = deps.newId();
    const headers = body.headers ?? Object.values(body.mapping).filter((v): v is string => typeof v === "string");
    try {
      await tx.transaction((sp) => insertTemplate(sp, { id, tenantId: ctx.tenantId, importerKey: body.importerKey, name: body.name, mapping: body.mapping, headers, createdBy: ctx.userId }, deps.clock.now()));
    } catch (e) {
      if (isUniqueViolation(e)) return err(conflict("imports.template_exists", "Un modèle de ce nom existe déjà pour cet importeur."));
      throw e;
    }
    const events = new EventBuffer(deps, ctx);
    events.audit({ action: "imports.template.create", entity: "mapping_template", entityId: id, metadata: { importerKey: body.importerKey, name: body.name } });
    await events.flush(tx);
    const created = await getTemplate(tx, id);
    return created ? ok(toTemplateDto(created)) : err(notFound("imports.template_not_found", "Modèle de mapping", id));
  });
}

export async function updateMappingTemplate(
  deps: ImportsDeps,
  ctx: RequestContext,
  id: string,
  patch: { name?: string | undefined; mapping?: Record<string, string | null> | undefined },
): Promise<Result<ImportMappingTemplateDto, AppError>> {
  return inTx(deps, ctx, async (tx) => {
    const current = await getTemplate(tx, id);
    if (!current) return err(notFound("imports.template_not_found", "Modèle de mapping", id));
    if (patch.mapping) {
      const importer = findImporter(current.importerKey);
      const known = new Set((importer?.columns ?? []).map((c) => c.key));
      if (Object.keys(patch.mapping).some((k) => !known.has(k))) return err(validation("imports.mapping_invalid", "Champ inconnu dans le mapping.", "mapping"));
    }
    try {
      await tx.transaction((sp) => updateTemplate(sp, id, patch, deps.clock.now()));
    } catch (e) {
      if (isUniqueViolation(e)) return err(conflict("imports.template_exists", "Un modèle de ce nom existe déjà pour cet importeur."));
      throw e;
    }
    const events = new EventBuffer(deps, ctx);
    events.audit({ action: "imports.template.update", entity: "mapping_template", entityId: id, metadata: { fields: Object.keys(patch) } });
    await events.flush(tx);
    const updated = await getTemplate(tx, id);
    return updated ? ok(toTemplateDto(updated)) : err(notFound("imports.template_not_found", "Modèle de mapping", id));
  });
}

export async function removeMappingTemplate(deps: ImportsDeps, ctx: RequestContext, id: string): Promise<Result<{ id: string }, AppError>> {
  return inTx(deps, ctx, async (tx) => {
    const current = await getTemplate(tx, id);
    if (!current) return err(notFound("imports.template_not_found", "Modèle de mapping", id));
    await deleteTemplate(tx, id);
    const events = new EventBuffer(deps, ctx);
    events.audit({ action: "imports.template.delete", entity: "mapping_template", entityId: id, metadata: { importerKey: current.importerKey, name: current.name } });
    await events.flush(tx);
    return ok({ id });
  });
}

export { validateMapping };
