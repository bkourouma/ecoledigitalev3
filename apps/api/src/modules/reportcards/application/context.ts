/**
 * Résolution de ce qu'il faut pour ÉMETTRE un document : identité courante, configuration de gabarit, gabarit plateforme,
 * options résolues, signataires, réglages. Chaque manque est un problème nommé avec son lien de correction (AC1.1) ; aucune
 * valeur par défaut d'établissement ni de signataire n'est inventée (AC5.5, Q-21).
 */
import type { Tx } from "@ecoledigitale/database";
import { ReportcardsCode } from "../domain/errors";
import { resolveOptions, type ResolvedOptions } from "../domain/options-schema";
import { blockingSignatoryProblems, resolveSignatories, type ResolvedSignatory } from "../domain/snapshot";
import type { Branding, DocumentKind, Pack, PlatformTemplate, ReportcardsSettings, TemplateConfig, Uuid } from "../domain/types";
import * as refRepo from "../infrastructure/reference-repository";

export interface PreflightIssue {
  readonly code: string;
  readonly message: string;
  readonly blocking: boolean;
  readonly fixHref: string | null;
}

export const FIX = {
  branding: "/admin/bulletins/identite",
  signatories: "/admin/bulletins/identite#signataires",
  templates: "/admin/bulletins/modeles",
  results: "/admin/resultats",
} as const;

export interface IssuingContext {
  readonly branding: Branding | null;
  readonly config: TemplateConfig | null;
  readonly template: PlatformTemplate | null;
  readonly options: ResolvedOptions | null;
  readonly signatories: readonly ResolvedSignatory[];
  readonly settings: ReportcardsSettings;
  readonly issues: PreflightIssue[];
}

export async function loadIssuingContext(
  tx: Tx,
  input: { institutionId: Uuid | null; documentKind: DocumentKind; pack: Pack; onDate: string },
): Promise<IssuingContext> {
  const issues: PreflightIssue[] = [];
  const settings = await refRepo.getSettings(tx);
  const branding = await refRepo.getCurrentBranding(tx, input.institutionId);
  if (!branding) {
    issues.push({ code: ReportcardsCode.BRANDING_MISSING, message: "L'identité de l'établissement (nom, mentions officielles, logo) n'est pas renseignée.", blocking: true, fixHref: FIX.branding });
  }
  const config = await refRepo.getCurrentTemplateConfig(tx, { institutionId: input.institutionId, documentKind: input.documentKind, pack: input.pack });
  let template: PlatformTemplate | null = null;
  let options: ResolvedOptions | null = null;
  let signatories: ResolvedSignatory[] = [];
  if (!config) {
    issues.push({ code: ReportcardsCode.TEMPLATE_CONFIG_MISSING, message: "Aucun modèle de document n'est configuré pour cette nature de document et ce niveau d'enseignement.", blocking: true, fixHref: FIX.templates });
  } else {
    template = await refRepo.getPlatformTemplate(tx, config.templateKey, config.templateVersion);
    if (!template || template.status === "DRAFT") {
      issues.push({ code: ReportcardsCode.TEMPLATE_NOT_FOUND, message: "Le modèle de document configuré est introuvable.", blocking: true, fixHref: FIX.templates });
      template = null;
    } else if (template.status === "RETIRED") {
      issues.push({ code: ReportcardsCode.TEMPLATE_NOT_FOUND, message: "Le modèle de document configuré est retiré : choisissez une version en vigueur.", blocking: true, fixHref: FIX.templates });
      template = null;
    }
    if (template) {
      const resolved = resolveOptions(template.optionsSchema, config.options);
      if (resolved.ok) options = resolved.value;
      else issues.push({ code: ReportcardsCode.INVALID_OPTIONS, message: `Les options du modèle ne sont plus valides : ${resolved.problems.map((p) => `${p.path} ${p.message}`).join(", ")}.`, blocking: true, fixHref: FIX.templates });
      const all = await refRepo.listSignatories(tx);
      const { resolved: ok, problems } = resolveSignatories({ slots: template.signatureSlots, assignments: config.signatureAssignments, signatories: all, onDate: input.onDate });
      signatories = ok;
      for (const p of blockingSignatoryProblems(problems)) {
        issues.push({ code: ReportcardsCode.SIGNATORY_MISSING, message: p.message, blocking: true, fixHref: FIX.signatories });
      }
    }
  }
  return { branding, config, template, options, signatories, settings, issues };
}

export const hasBlocking = (issues: readonly PreflightIssue[]): boolean => issues.some((i) => i.blocking);
