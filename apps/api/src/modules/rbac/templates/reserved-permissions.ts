/**
 * Permissions RÉSERVÉES pour les modules à venir (liste blanche VERSIONNÉE).
 *
 * Contexte. Les modèles de rôles système (`system-roles.ts`) énumèrent des clés exactes qui sont résolues
 * contre le catalogue RÉEL des manifestes. Une clé sans correspondance est « en attente »
 * (`rbac.role_pending_permissions`) : tolérée à l'exécution (module pas encore livré), re-résolue à la
 * prochaine `syncRbac`. Jusqu'ici un test refusait TOUT motif en attente (une faute de frappe ne devait
 * jamais passer en silence). ÉTAT : `primary_school` (005), `schoollife` et `stateassign` (006), `admissions` (007) et
 * `examinations` (018) sont LIVRÉS (leurs permissions sont déclarées par leur manifeste, donc retirées d'ici) ; seul
 * reste `councils` (conseils de classe, spec 006). Les packs livrent leurs
 * modules APRÈS les rôles qui les concernent : ce fichier est l'exception explicite et bornée.
 *
 * Règles (vérifiées par `test/reserved-permissions.test.ts` et `test/system-roles.test.ts`) :
 *   1. un motif en attente HORS de cette liste fait échouer les tests (faute de frappe, renommage) ;
 *   2. chaque entrée est référencée par au moins un modèle de rôle (pas d'entrée inutile) ;
 *   3. NON-OUBLI : dès qu'une entrée est déclarée par un manifeste chargé, les tests échouent avec
 *      « retire-la de la liste » ; et si le module (`module`) est chargé mais ne déclare pas la clé,
 *      ils échouent aussi (renommage non répercuté dans les modèles) ;
 *   4. le drapeau `sensitive` est celui de la spec : une fois le module livré, il doit coïncider avec
 *      le manifeste (sinon `sensitiveJustifications` des modèles serait faux) ;
 *   5. conventions de portée : segment `self` (élève) ⇒ rôle `eleve` seul ; `child` (parent) ⇒ rôle
 *      `parent` seul ; `own` (personnel) ⇒ rôles de personnel.
 *
 * Aucune permission ne figure ici sans modèle de rôle qui la porte, et AUCUN manifeste de module à venir
 * n'est créé par `rbac` : chaque module déclare ses permissions dans SON `manifest.ts`.
 *
 * Pour retirer une entrée : le module la déclare dans son manifeste → supprimer la ligne.
 */

export interface ReservedPermission {
  /** Clé exacte (jamais un motif). */
  readonly key: string;
  /** Clé du module (`manifest.key`) qui la déclarera. */
  readonly module: ReservedModule;
  /** Spec source (chemin depuis la racine du dépôt + section). */
  readonly spec: string;
  /** Sensibilité prévue par la spec (MFA) ; contrôlée contre le manifeste dès que le module est livré. */
  readonly sensitive: boolean;
}

export type ReservedModule = "councils";

export const RESERVED_MODULES: readonly ReservedModule[] = Object.freeze(["councils"]);

const SPEC_SECONDARY = "specs/v2/006-secondary/spec.md §10";

function reserved(module: ReservedModule, spec: string, keys: readonly string[], sensitiveKeys: readonly string[] = []): ReservedPermission[] {
  return keys.map((key) => ({ key, module, spec, sensitive: sensitiveKeys.includes(key) }));
}

export const RESERVED_FOR_UPCOMING_MODULES: readonly ReservedPermission[] = Object.freeze<ReservedPermission[]>([
  // `primary_school`, `schoollife`, `stateassign`, `admissions` et `examinations` sont LIVRÉS : leurs permissions sont
  // déclarées par leurs manifestes et ne figurent plus ici. Reste le module `councils`.

  // ----- Pack Secondary : conseils de classe (module `councils`, spec 006) ---------------------------
  ...reserved(
    "councils",
    SPEC_SECONDARY,
    [
      "council.read",
      "council.manage",
      "council.prepare",
      "council.session.run",
      "council.proposal.write",
      "council.decision.record",
      "council.minutes.generate",
      "council.minutes.read",
      "council.minutes.sign",
      "council.unlock.request",
      "council.effect.manage",
      "council.exclusion.apply",
      "council.settings.manage",
      "council.orientation.read",
      "council.orientation.manage",
      "council.orientation.override",
      "council.self.read",
      "council.child.read",
    ],
    [
      "council.session.run",
      "council.decision.record",
      "council.minutes.sign",
      "council.exclusion.apply",
      "council.settings.manage",
      "council.orientation.override",
    ],
  ),

]);

export const RESERVED_PERMISSION_KEYS: ReadonlySet<string> = new Set(RESERVED_FOR_UPCOMING_MODULES.map((r) => r.key));

const BY_KEY: ReadonlyMap<string, ReservedPermission> = new Map(RESERVED_FOR_UPCOMING_MODULES.map((r) => [r.key, r]));

/** La clé (exacte) figure-t-elle dans la liste blanche des permissions réservées ? */
export function isReservedPermission(key: string): boolean {
  return BY_KEY.has(key);
}

export function getReservedPermission(key: string): ReservedPermission | undefined {
  return BY_KEY.get(key);
}

/**
 * Convention de portée (segments internes de la clé) : `<module>.<…>.self.<action>` (élève),
 * `<module>.<…>.child.<action>` (parent). Le segment est cherché entre le premier et le dernier segment,
 * ce qui couvre les clés à trois segments (`student.child.read`) comme à quatre
 * (`primary.competency.child.read`, `exam.document.self.read`).
 */
export function permissionScopeOf(key: string): "self" | "child" | "own" | "none" {
  const inner = key.split(".").slice(1, -1);
  if (inner.includes("self")) return "self";
  if (inner.includes("child")) return "child";
  if (inner.includes("own") || key.endsWith(".read_own")) return "own";
  return "none";
}

/**
 * Motifs (au sens de `matchesPermissionPattern`) désignant TOUTES les permissions `child` (resp. `self`),
 * à trois ET quatre segments.
 */
export const CHILD_PERMISSION_PATTERNS: readonly string[] = Object.freeze(["*.child.*", "*.*.child.*"]);
export const SELF_PERMISSION_PATTERNS: readonly string[] = Object.freeze(["*.self.*", "*.*.self.*"]);
