/**
 * Contrat de module (ADR-001). Chaque module backend expose un `manifest.ts`
 * qui exporte `default defineModule({...})`. Le registre de modules, le RBAC,
 * les entitlements, la sidebar et la console super-admin se génèrent à partir
 * de ces manifestes : ils sont la SEULE source de vérité des permissions,
 * features, menus et événements.
 */

export const PACK_KEYS = ["CORE", "PRIMARY", "SECONDARY", "HIGHER", "VIRTUAL"] as const;
export type PackKey = (typeof PACK_KEYS)[number];

/** Format d'une permission : `ressource.action` ou `ressource.sous.action` (minuscules, chiffres, `_`). */
export const PERMISSION_KEY_RE = /^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*){1,3}$/;

export interface PermissionDef {
  /** Ex. `grade.enter`, `finance.payment.create`. Préfixe = ressource du module. */
  key: string;
  /** Libellé affiché dans l'éditeur de rôles (français). */
  label: string;
  description?: string;
  /** Permission sensible : exige MFA et est toujours auditée. */
  sensitive?: boolean;
}

export interface FeatureDef {
  /** Ex. `finance.online-payment`. Contrôlé par les entitlements (plan/pack/override). */
  key: string;
  label: string;
  /** Packs qui incluent cette feature par défaut. `CORE` = toujours disponible. */
  packs: PackKey[];
}

export interface MenuDef {
  key: string;
  label: string;
  /** Route web cible. */
  href: string;
  /** Permission requise pour voir l'entrée (déduite : l'entrée est masquée sinon). */
  permission: string;
  /** Feature requise (entitlement) ; absent = toujours visible si la permission est accordée. */
  feature?: string;
  /** Portail d'affichage. */
  portal: "admin" | "teacher" | "parent" | "student" | "owner" | "super-admin";
  icon?: string;
  order?: number;
}

export interface ModuleManifest {
  /** Identifiant stable, = nom du dossier sous `modules/` et schéma Postgres du module. */
  key: string;
  title: string;
  /** Packs qui activent ce module. `["CORE"]` = socle toujours actif. */
  packs: PackKey[];
  /** Modules dont celui-ci dépend (via leur `index.ts` public uniquement). */
  dependsOn: string[];
  permissions: PermissionDef[];
  features: FeatureDef[];
  menus: MenuDef[];
  events: {
    publishes: string[];
    consumes: string[];
  };
}

export type ModuleManifestInput = Partial<Pick<ModuleManifest, "dependsOn" | "permissions" | "features" | "menus" | "events">> &
  Pick<ModuleManifest, "key" | "title" | "packs">;

const MODULE_KEY_RE = /^[a-z][a-z0-9_]*$/;

/** Valide et normalise un manifeste. Lève une `Error` explicite en cas d'incohérence. */
export function defineModule(input: ModuleManifestInput): Readonly<ModuleManifest> {
  if (!MODULE_KEY_RE.test(input.key)) {
    throw new Error(`Module "${input.key}" : clé invalide (minuscules, chiffres, "_").`);
  }
  const manifest: ModuleManifest = {
    key: input.key,
    title: input.title,
    packs: [...input.packs],
    dependsOn: [...(input.dependsOn ?? [])],
    permissions: [...(input.permissions ?? [])],
    features: [...(input.features ?? [])],
    menus: [...(input.menus ?? [])],
    events: {
      publishes: [...(input.events?.publishes ?? [])],
      consumes: [...(input.events?.consumes ?? [])],
    },
  };

  if (manifest.packs.length === 0) throw new Error(`Module "${manifest.key}" : au moins un pack requis.`);
  for (const p of manifest.packs) {
    if (!(PACK_KEYS as readonly string[]).includes(p)) throw new Error(`Module "${manifest.key}" : pack inconnu "${p}".`);
  }
  const seen = new Set<string>();
  for (const perm of manifest.permissions) {
    if (!PERMISSION_KEY_RE.test(perm.key)) throw new Error(`Module "${manifest.key}" : permission invalide "${perm.key}".`);
    if (seen.has(perm.key)) throw new Error(`Module "${manifest.key}" : permission dupliquée "${perm.key}".`);
    seen.add(perm.key);
  }
  for (const m of manifest.menus) {
    if (!seen.has(m.permission)) {
      throw new Error(`Module "${manifest.key}" : le menu "${m.key}" référence la permission inconnue "${m.permission}" (déclarez-la dans ce module).`);
    }
    if (m.feature && !manifest.features.some((f) => f.key === m.feature)) {
      throw new Error(`Module "${manifest.key}" : le menu "${m.key}" référence la feature inconnue "${m.feature}".`);
    }
  }
  return Object.freeze(manifest);
}

/**
 * Vérifie un ensemble de manifestes : unicité des clés, dépendances existantes et sans cycle,
 * permissions/features uniques globalement. Retourne les modules en ordre topologique.
 */
export function resolveModuleOrder(manifests: readonly ModuleManifest[]): ModuleManifest[] {
  const byKey = new Map<string, ModuleManifest>();
  const perms = new Map<string, string>();
  const feats = new Map<string, string>();
  for (const m of manifests) {
    if (byKey.has(m.key)) throw new Error(`Module dupliqué "${m.key}".`);
    byKey.set(m.key, m);
    for (const p of m.permissions) {
      const owner = perms.get(p.key);
      if (owner) throw new Error(`Permission "${p.key}" déclarée par "${owner}" et "${m.key}".`);
      perms.set(p.key, m.key);
    }
    for (const f of m.features) {
      const owner = feats.get(f.key);
      if (owner) throw new Error(`Feature "${f.key}" déclarée par "${owner}" et "${m.key}".`);
      feats.set(f.key, m.key);
    }
  }
  const ordered: ModuleManifest[] = [];
  const state = new Map<string, "visiting" | "done">();
  const visit = (key: string, path: string[]): void => {
    const s = state.get(key);
    if (s === "done") return;
    if (s === "visiting") throw new Error(`Cycle de dépendances entre modules : ${[...path, key].join(" -> ")}.`);
    const m = byKey.get(key);
    if (!m) throw new Error(`Dépendance de module inconnue "${key}" (requise par ${path[path.length - 1] ?? "?"}).`);
    state.set(key, "visiting");
    for (const dep of m.dependsOn) visit(dep, [...path, key]);
    state.set(key, "done");
    ordered.push(m);
  };
  for (const m of [...manifests].sort((a, b) => a.key.localeCompare(b.key))) visit(m.key, []);
  return ordered;
}
