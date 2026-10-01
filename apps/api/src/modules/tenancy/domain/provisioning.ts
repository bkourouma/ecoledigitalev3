/**
 * Plan de provisioning — PUR. Transforme une demande + des modèles de pack en
 * la liste exacte de ce qu'il faut créer ; la persistance est ailleurs.
 */
import { ValidationError, err, ok, type Result } from "@ecoledigitale/kernel";
import type { InstitutionPack, ProvisionTenantInput } from "@ecoledigitale/contracts/src/v2/tenancy";
import type { PackTemplates } from "../templates";

/** Slugs réservés à la plateforme (sous-domaines techniques). */
export const RESERVED_SLUGS: ReadonlySet<string> = new Set([
  "www",
  "api",
  "app",
  "admin",
  "auth",
  "login",
  "mail",
  "static",
  "assets",
  "support",
  "status",
  "platform",
  "console",
  "super-admin",
  "superadmin",
  "demo",
  "test",
]);

export interface CountryRef {
  code: string;
  educationSystem: string;
}

export interface PlannedInstitution {
  id: string;
  code: string;
  name: string;
  pack: InstitutionPack;
  educationSystem: string;
  countryCode: string;
  campus: { id: string; code: string; name: string };
}

export interface ProvisionPlan {
  tenantId: string;
  slug: string;
  name: string;
  countryCode: string;
  institutions: PlannedInstitution[];
}

export function validateSlug(slug: string): Result<string, ValidationError> {
  if (RESERVED_SLUGS.has(slug)) {
    return err(ValidationError.field("slug", `Le slug « ${slug} » est réservé.`, "tenancy.slug_reserved"));
  }
  return ok(slug);
}

/**
 * @param tenantId identifiant du nouveau tenant (déjà généré par l'appelant)
 * @param newId générateur d'identifiants (injecté : déterminisme en test)
 */
export function planProvisioning(
  input: Pick<ProvisionTenantInput, "name" | "slug" | "packs">,
  tenantId: string,
  country: CountryRef,
  templates: PackTemplates,
  newId: () => string,
): Result<ProvisionPlan, ValidationError> {
  const slug = validateSlug(input.slug);
  if (!slug.ok) return slug;

  const packs = [...new Set(input.packs)];
  if (packs.length === 0) {
    return err(ValidationError.field("packs", "Au moins un pack est requis.", "tenancy.packs_required"));
  }

  const institutions: PlannedInstitution[] = [];
  for (const pack of packs) {
    const template = templates.get(pack);
    if (!template) {
      return err(ValidationError.field("packs", `Aucun modèle pour le pack « ${pack} ».`, "tenancy.pack_template_missing"));
    }
    // Un seul pack : l'établissement porte le nom de l'organisation ; plusieurs : on les distingue.
    const name =
      packs.length === 1 ? input.name : template.institution.nameTemplate.replaceAll("{organisation}", input.name);
    institutions.push({
      id: newId(),
      code: template.institution.code,
      name,
      pack,
      educationSystem: country.educationSystem,
      countryCode: country.code,
      campus: { id: newId(), code: template.defaultCampus.code, name: template.defaultCampus.name },
    });
  }

  return ok({
    tenantId,
    slug: input.slug,
    name: input.name,
    countryCode: country.code,
    institutions,
  });
}

/** Code lisible dérivé d'un libellé : minuscules, sans accents, tirets. */
export function deriveCode(label: string, fallback = "item"): string {
  const base = label
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 28)
    .replace(/-+$/g, "");
  return base.length > 0 ? base : fallback;
}

/** Premier code libre parmi `base`, `base-2`, `base-3`… */
export function uniqueCode(base: string, taken: ReadonlySet<string>): string {
  if (!taken.has(base)) return base;
  for (let n = 2; n < 1000; n += 1) {
    const candidate = `${base}-${n}`;
    if (!taken.has(candidate)) return candidate;
  }
  throw new Error(`Impossible de dériver un code unique à partir de « ${base} ».`);
}
