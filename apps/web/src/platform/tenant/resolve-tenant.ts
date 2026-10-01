/**
 * Résolution UNIQUE du tenant courant (fonction pure, sans accès à window ni à process.env).
 *
 * Ordre de priorité :
 *   0. `override`  : choix explicite d'un utilisateur autorisé (ex. super-admin qui "entre" dans un tenant) ;
 *   1. `session`   : tenant de la session authentifiée (slug, sinon identifiant) ;
 *   2. domaine     : domaine personnalisé configuré, puis sous-domaine `<slug>.<domaine de base>` ;
 *   3. `env`       : `NEXT_PUBLIC_TENANT_SLUG` (développement local, déploiement mono-tenant).
 *
 * Il n'existe AUCUN repli codé en dur : si rien ne permet de déterminer le tenant, la fonction renvoie
 * `null` et l'appelant gère explicitement l'état « tenant inconnu » (voir `TenantContext`).
 *
 * Les adaptateurs qui lisent l'environnement réel vivent à côté : `browser.ts` (client) et `server.ts` (routes Next).
 */

export type TenantSource = "override" | "session" | "custom-domain" | "subdomain" | "env";

export interface ResolvedTenant {
  /** Valeur à placer dans l'en-tête `X-Tenant` : le slug quand il est connu, sinon l'identifiant. */
  key: string;
  slug: string | null;
  id: string | null;
  source: TenantSource;
}

export interface TenantSessionLike {
  tenantSlug?: string | null;
  tenantId?: string | null;
}

export interface TenantResolverConfig {
  /** Domaines de base : `<slug>.<domaine>` désigne le tenant `<slug>`. */
  baseDomains: readonly string[];
  /** Domaines personnalisés : nom d'hôte complet -> slug du tenant. */
  customDomains: Readonly<Record<string, string>>;
  /** Sous-domaines qui ne sont jamais des tenants. */
  reservedSubdomains: readonly string[];
  /** Suffixes de développement (`<slug>.localhost`). */
  devSuffixes: readonly string[];
}

export const DEFAULT_TENANT_CONFIG: TenantResolverConfig = Object.freeze({
  baseDomains: Object.freeze(["ecoledigitale.allianceconsultants.net"]),
  customDomains: Object.freeze({}),
  reservedSubdomains: Object.freeze(["www", "api", "app", "admin", "static", "cdn", "mail"]),
  devSuffixes: Object.freeze(["localhost"]),
});

export interface TenantResolutionInput {
  override?: string | null;
  session?: TenantSessionLike | null;
  /** Nom d'hôte de la requête (avec ou sans port). */
  hostname?: string | null;
  /** Valeur de `NEXT_PUBLIC_TENANT_SLUG`. */
  env?: string | null;
  config?: Partial<TenantResolverConfig>;
}

const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isTenantUuid(value: string): boolean {
  return UUID_RE.test(value);
}

function clean(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/** Minuscules, sans port, sans point final. */
export function normalizeHostname(raw: string | null | undefined): string | null {
  const value = clean(raw);
  if (!value) return null;
  let host = value.toLowerCase();
  if (host.startsWith("[")) return null; // IPv6 littéral : jamais un tenant
  const colon = host.indexOf(":");
  if (colon >= 0) host = host.slice(0, colon);
  host = host.replace(/\.+$/, "");
  return host.length > 0 ? host : null;
}

function mergeConfig(partial?: Partial<TenantResolverConfig>): TenantResolverConfig {
  if (!partial) return DEFAULT_TENANT_CONFIG;
  return {
    baseDomains: partial.baseDomains ?? DEFAULT_TENANT_CONFIG.baseDomains,
    customDomains: partial.customDomains ?? DEFAULT_TENANT_CONFIG.customDomains,
    reservedSubdomains: partial.reservedSubdomains ?? DEFAULT_TENANT_CONFIG.reservedSubdomains,
    devSuffixes: partial.devSuffixes ?? DEFAULT_TENANT_CONFIG.devSuffixes,
  };
}

/**
 * Construit la configuration depuis les variables d'environnement publiques :
 *   NEXT_PUBLIC_TENANT_BASE_DOMAINS   = "ecole.example.ci,autre.example.org"   (s'AJOUTE au domaine par défaut)
 *   NEXT_PUBLIC_TENANT_CUSTOM_DOMAINS = "portail.monecole.ci=monecole,www.x.org=x"
 */
export function buildTenantConfig(raw: {
  baseDomains?: string | null;
  customDomains?: string | null;
}): TenantResolverConfig {
  const extraBase = (clean(raw.baseDomains) ?? "")
    .split(",")
    .map((d) => normalizeHostname(d))
    .filter((d): d is string => Boolean(d));
  const custom: Record<string, string> = {};
  for (const pair of (clean(raw.customDomains) ?? "").split(",")) {
    const [host, slug] = pair.split("=").map((s) => s.trim());
    const normalizedHost = normalizeHostname(host);
    if (normalizedHost && slug && SLUG_RE.test(slug.toLowerCase())) {
      custom[normalizedHost] = slug.toLowerCase();
    }
  }
  return {
    ...DEFAULT_TENANT_CONFIG,
    baseDomains: Array.from(new Set([...DEFAULT_TENANT_CONFIG.baseDomains, ...extraBase])),
    customDomains: custom,
  };
}

/** Slug porté par le nom d'hôte (domaine personnalisé ou `<slug>.<domaine de base>`), sinon `null`. */
export function tenantFromHostname(
  hostname: string | null | undefined,
  configInput?: Partial<TenantResolverConfig>,
): { slug: string; source: "custom-domain" | "subdomain" } | null {
  const host = normalizeHostname(hostname);
  if (!host) return null;
  const config = mergeConfig(configInput);

  const custom = config.customDomains[host];
  if (custom) return { slug: custom, source: "custom-domain" };

  for (const base of [...config.baseDomains, ...config.devSuffixes]) {
    const suffix = `.${base}`;
    if (!host.endsWith(suffix)) continue;
    const label = host.slice(0, -suffix.length);
    // Un seul niveau sous le domaine de base, valide, non réservé.
    if (!label || label.includes(".")) continue;
    if (!SLUG_RE.test(label)) continue;
    if (config.reservedSubdomains.includes(label)) continue;
    return { slug: label, source: "subdomain" };
  }
  return null;
}

function fromKey(key: string, source: TenantSource): ResolvedTenant {
  const isId = isTenantUuid(key);
  return { key, slug: isId ? null : key, id: isId ? key : null, source };
}

/**
 * Résout le tenant. Renvoie `null` quand il est inconnu (état explicite, aucun repli).
 */
export function resolveTenant(input: TenantResolutionInput = {}): ResolvedTenant | null {
  const override = clean(input.override);
  if (override) return fromKey(override, "override");

  const slug = clean(input.session?.tenantSlug);
  const id = clean(input.session?.tenantId);
  if (slug || id) {
    return { key: (slug ?? id) as string, slug, id, source: "session" };
  }

  const fromHost = tenantFromHostname(input.hostname, input.config);
  if (fromHost) return { key: fromHost.slug, slug: fromHost.slug, id: null, source: fromHost.source };

  const env = clean(input.env);
  if (env) return fromKey(env, "env");

  return null;
}

/** Erreur levée par `requireTenant` : le tenant ne peut pas être déterminé. */
export class TenantUnknownError extends Error {
  readonly code = "TENANT_UNKNOWN";
  constructor() {
    super(
      "Tenant inconnu : aucune session, aucun sous-domaine reconnu et NEXT_PUBLIC_TENANT_SLUG n'est pas défini.",
    );
    this.name = "TenantUnknownError";
  }
}

export function requireTenant(input: TenantResolutionInput = {}): ResolvedTenant {
  const resolved = resolveTenant(input);
  if (!resolved) throw new TenantUnknownError();
  return resolved;
}
