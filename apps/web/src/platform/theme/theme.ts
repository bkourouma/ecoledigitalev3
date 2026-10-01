/**
 * Thème de tenant : contrat de `GET /api/v1/tenancy/profile` et calcul PUR des variables CSS.
 *
 * Variables posées sur `:root` (jamais sur `[data-role]`, donc le thème par rôle `--role-primary` n'est pas
 * touché) :
 *   --brand-primary / --brand-secondary          couleurs (#rrggbb)
 *   --brand-primary-rgb / --brand-secondary-rgb  "r g b" (utilisable avec rgb(var(--x) / .5))
 *   --brand-logo-url                             `url("…")` ou `none`
 *
 * Les valeurs venant de l'API sont VALIDÉES (couleur hex stricte, URL https ou chemin interne) avant
 * d'être injectées dans le CSS : aucune chaîne libre n'atteint `style`.
 */

import { z } from "zod";

export const TENANCY_PROFILE_ENDPOINT = "/api/v1/tenancy/profile";

export const DEFAULT_BRAND = Object.freeze({
  primary: "#2563eb", // bleu EcoleDigitale (dégradé du logo « ED »)
  secondary: "#059669", // émeraude EcoleDigitale
  logoUrl: null as string | null,
});

/**
 * Deux formes sont acceptées : l'ancienne `{ name, theme: { primaryColor, secondaryColor, logoUrl } }` et le profil réel
 * du module tenancy `{ tradeName, legalName, branding: { logoUrl, primaryColor, secondaryColor } }` (`TenantProfileSchema`).
 * Les deux sont normalisées vers la première.
 */
const BrandingSchema = z
  .object({
    primaryColor: z.string().nullish(),
    secondaryColor: z.string().nullish(),
    logoUrl: z.string().nullish(),
  })
  .nullish();

export interface TenancyProfile {
  name?: string;
  theme?: z.output<typeof BrandingSchema>;
}

export const TenancyProfileSchema = z
  .object({
    name: z.string().optional(),
    tradeName: z.string().nullish(),
    legalName: z.string().optional(),
    theme: BrandingSchema,
    branding: BrandingSchema,
  })
  .transform(
    (value): TenancyProfile => ({
      name: value.name ?? value.tradeName ?? value.legalName ?? undefined,
      theme: value.theme ?? value.branding ?? null,
    }),
  );

const HEX_RE = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;

/** `#abc` / `#aabbcc` -> `#aabbcc` en minuscules, sinon `null`. */
export function sanitizeColor(value: string | null | undefined): string | null {
  const v = (value ?? "").trim();
  if (!HEX_RE.test(v)) return null;
  const hex = v.slice(1).toLowerCase();
  return `#${hex.length === 3 ? hex.split("").map((c) => c + c).join("") : hex}`;
}

/** URL https, ou chemin interne `/…` ; tout le reste (data:, javascript:, guillemets, parenthèses…) est refusé. */
export function sanitizeLogoUrl(value: string | null | undefined): string | null {
  const v = (value ?? "").trim();
  if (!v || v.length > 2048 || /["'()\\\s<>]/.test(v)) return null;
  if (v.startsWith("/") && !v.startsWith("//")) return v;
  try {
    const url = new URL(v);
    return url.protocol === "https:" ? url.href : null;
  } catch {
    return null;
  }
}

export function hexToRgbTriplet(hex: string): string {
  const n = parseInt(hex.slice(1), 16);
  return `${(n >> 16) & 255} ${(n >> 8) & 255} ${n & 255}`;
}

export type BrandVariables = Record<
  "--brand-primary" | "--brand-secondary" | "--brand-primary-rgb" | "--brand-secondary-rgb" | "--brand-logo-url",
  string
>;

/** Variables CSS pour un profil ; toute valeur absente ou invalide retombe sur les défauts EcoleDigitale. */
export function buildBrandVariables(profile?: TenancyProfile | null): BrandVariables {
  const primary = sanitizeColor(profile?.theme?.primaryColor) ?? DEFAULT_BRAND.primary;
  const secondary = sanitizeColor(profile?.theme?.secondaryColor) ?? DEFAULT_BRAND.secondary;
  const logo = sanitizeLogoUrl(profile?.theme?.logoUrl) ?? DEFAULT_BRAND.logoUrl;
  return {
    "--brand-primary": primary,
    "--brand-secondary": secondary,
    "--brand-primary-rgb": hexToRgbTriplet(primary),
    "--brand-secondary-rgb": hexToRgbTriplet(secondary),
    "--brand-logo-url": logo ? `url("${logo}")` : "none",
  };
}
