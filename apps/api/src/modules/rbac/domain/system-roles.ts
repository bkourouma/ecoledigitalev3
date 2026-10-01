/**
 * Résolution PURE des modèles de rôles système contre le catalogue.
 */
import { InternalError } from "@ecoledigitale/kernel";
import { SYSTEM_ROLE_TEMPLATES, type SystemRoleTemplate } from "../templates/system-roles";
import { isValidPermissionPattern, resolvePatterns, type PermissionCatalog } from "./permission-catalog";

export const ROLE_KEY_RE = /^[a-z][a-z0-9_]{1,62}$/;

export interface ResolvedSystemRole {
  readonly template: SystemRoleTemplate;
  /** Permissions concrètes à porter par le rôle. */
  readonly permissions: readonly string[];
  /** Motifs sans correspondance dans le catalogue courant (en attente). */
  readonly pending: readonly string[];
}

/** Valide la structure des modèles (clés uniques, motifs bien formés). Lève `InternalError`. */
export function validateTemplates(templates: readonly SystemRoleTemplate[] = SYSTEM_ROLE_TEMPLATES): void {
  const seen = new Set<string>();
  for (const t of templates) {
    if (!ROLE_KEY_RE.test(t.key)) {
      throw new InternalError(`Modèle de rôle "${t.key}" : clé invalide.`, { code: "rbac.invalid_template" });
    }
    if (seen.has(t.key)) {
      throw new InternalError(`Modèle de rôle "${t.key}" dupliqué.`, { code: "rbac.invalid_template" });
    }
    seen.add(t.key);
    if (t.label.trim() === "") {
      throw new InternalError(`Modèle de rôle "${t.key}" : libellé vide.`, { code: "rbac.invalid_template" });
    }
    for (const p of [...t.permissions, ...(t.except ?? [])]) {
      if (!isValidPermissionPattern(p)) {
        throw new InternalError(`Modèle de rôle "${t.key}" : motif de permission invalide "${p}".`, {
          code: "rbac.invalid_template",
        });
      }
    }
  }
}

export function resolveSystemRole(template: SystemRoleTemplate, catalog: PermissionCatalog): ResolvedSystemRole {
  const { resolved, pending } = resolvePatterns(template.permissions, template.except ?? [], catalog);
  return Object.freeze({ template, permissions: resolved, pending });
}

export function resolveSystemRoles(
  catalog: PermissionCatalog,
  templates: readonly SystemRoleTemplate[] = SYSTEM_ROLE_TEMPLATES,
): ResolvedSystemRole[] {
  validateTemplates(templates);
  return templates.map((t) => resolveSystemRole(t, catalog));
}
