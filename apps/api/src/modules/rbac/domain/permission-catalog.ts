/**
 * Catalogue de permissions : agrégé (fonction PURE) depuis les manifestes des
 * modules. Les manifestes sont la SEULE source de vérité ; la table
 * `rbac.permissions` n'en est que le reflet synchronisé (`syncPermissionCatalog`).
 *
 * Motifs de permissions (modèles de rôles, exclusions) :
 *   - `grade.enter`     clé exacte ;
 *   - `finance.*`       `*` FINAL = un ou plusieurs segments restants
 *                       (`finance.payment`, `finance.payment.create`, …) ;
 *   - `*.self.read`     `*` NON final = exactement un segment ;
 *   - `*`               toutes les permissions du catalogue.
 */
import { PERMISSION_KEY_RE, type ModuleManifest } from "@ecoledigitale/kernel";
import { InternalError, ValidationError } from "@ecoledigitale/kernel";

export interface CatalogEntry {
  readonly key: string;
  readonly label: string;
  readonly description: string | null;
  readonly sensitive: boolean;
  /** Module déclarant. */
  readonly moduleKey: string;
}

export interface PermissionCatalog {
  /** Triées par clé. */
  readonly entries: readonly CatalogEntry[];
  readonly byKey: ReadonlyMap<string, CatalogEntry>;
  readonly keys: readonly string[];
}

const SEGMENT_RE = /^[a-z][a-z0-9_]*$/;

/** Un motif valide : `*`, une clé exacte, ou des segments dont certains sont `*`. */
export function isValidPermissionPattern(pattern: string): boolean {
  if (pattern === "*") return true;
  const segments = pattern.split(".");
  if (segments.length < 2 || segments.length > 4) return false;
  return segments.every((s) => s === "*" || SEGMENT_RE.test(s));
}

export function isPermissionKey(value: string): boolean {
  return PERMISSION_KEY_RE.test(value);
}

export function isWildcardPattern(pattern: string): boolean {
  return pattern.includes("*");
}

/** Le motif `pattern` désigne-t-il la clé concrète `key` ? */
export function matchesPermissionPattern(pattern: string, key: string): boolean {
  if (pattern === "*") return true;
  if (!isWildcardPattern(pattern)) return pattern === key;
  const p = pattern.split(".");
  const k = key.split(".");
  const last = p[p.length - 1];
  if (last === "*") {
    // `a.b.*` : préfixe exact `a.b`, puis au moins un segment de plus.
    if (k.length < p.length) return false;
    for (let i = 0; i < p.length - 1; i += 1) {
      if (p[i] !== "*" && p[i] !== k[i]) return false;
    }
    return true;
  }
  if (k.length !== p.length) return false;
  return p.every((seg, i) => seg === "*" || seg === k[i]);
}

/**
 * Agrège les manifestes en catalogue. Lève si une clé est déclarée deux fois
 * (par deux modules, ou deux fois dans un même manifeste).
 */
export function buildPermissionCatalog(manifests: readonly ModuleManifest[]): PermissionCatalog {
  const byKey = new Map<string, CatalogEntry>();
  for (const manifest of manifests) {
    for (const def of manifest.permissions) {
      if (!PERMISSION_KEY_RE.test(def.key)) {
        throw new InternalError(`Module "${manifest.key}" : permission invalide "${def.key}".`, {
          code: "rbac.invalid_permission_key",
        });
      }
      const existing = byKey.get(def.key);
      if (existing) {
        throw new InternalError(
          `Permission "${def.key}" déclarée par "${existing.moduleKey}" et "${manifest.key}".`,
          { code: "rbac.duplicate_permission" },
        );
      }
      byKey.set(
        def.key,
        Object.freeze({
          key: def.key,
          label: def.label,
          description: def.description ?? null,
          sensitive: def.sensitive === true,
          moduleKey: manifest.key,
        }),
      );
    }
  }
  const entries = [...byKey.values()].sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  return Object.freeze({
    entries: Object.freeze(entries),
    byKey: new Map(entries.map((e) => [e.key, e])),
    keys: Object.freeze(entries.map((e) => e.key)),
  });
}

/** Catalogue reconstruit depuis des lignes (table `rbac.permissions`). */
export function catalogFromEntries(entries: readonly CatalogEntry[]): PermissionCatalog {
  const sorted = [...entries].sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  return Object.freeze({
    entries: Object.freeze(sorted),
    byKey: new Map(sorted.map((e) => [e.key, e])),
    keys: Object.freeze(sorted.map((e) => e.key)),
  });
}

/** Clés du catalogue désignées par `pattern`. */
export function expandPattern(pattern: string, catalog: PermissionCatalog): string[] {
  if (pattern === "*") return [...catalog.keys];
  if (!isWildcardPattern(pattern)) return catalog.byKey.has(pattern) ? [pattern] : [];
  return catalog.keys.filter((key) => matchesPermissionPattern(pattern, key));
}

export interface PatternResolution {
  /** Clés concrètes (triées, sans doublon) = ∪ grant − ∪ except. */
  readonly resolved: readonly string[];
  /**
   * Motifs d'octroi qui ne désignent encore AUCUNE permission du catalogue
   * (module pas encore déployé…). Conservés « en attente » : ils sont re-résolus
   * à la prochaine synchronisation, jamais abandonnés.
   */
  readonly pending: readonly string[];
}

/** Résout des motifs d'octroi (moins des motifs d'exclusion) contre le catalogue. Pure. */
export function resolvePatterns(
  grants: readonly string[],
  except: readonly string[],
  catalog: PermissionCatalog,
): PatternResolution {
  for (const p of [...grants, ...except]) {
    if (!isValidPermissionPattern(p)) {
      throw ValidationError.field("permissions", `Motif de permission invalide : "${p}".`, "rbac.invalid_pattern");
    }
  }
  const granted = new Set<string>();
  const pending: string[] = [];
  for (const pattern of new Set(grants)) {
    const keys = expandPattern(pattern, catalog);
    if (keys.length === 0) pending.push(pattern);
    for (const k of keys) granted.add(k);
  }
  for (const pattern of new Set(except)) {
    for (const k of expandPattern(pattern, catalog)) granted.delete(k);
  }
  return Object.freeze({
    resolved: Object.freeze([...granted].sort()),
    pending: Object.freeze(pending.sort()),
  });
}
