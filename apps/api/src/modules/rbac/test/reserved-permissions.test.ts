/**
 * Liste blanche des permissions RÉSERVÉES aux modules à venir (`templates/reserved-permissions.ts`).
 *
 * Elle remplace, de façon bornée et documentée, la règle « aucun motif en attente » pour les modules des
 * packs Primary, Secondary, Admissions et Examinations (leurs manifestes sont livrés après les rôles).
 *
 *  1. Forme des entrées : clé exacte valide, unique, module connu, spec existante, convention de portée.
 *  2. Chaque entrée est référencée par au moins un modèle (pas d'entrée inutile) ; tout motif en attente est
 *     dans la liste (un motif hors liste fait échouer — faute de frappe, renommage).
 *  3. NON-OUBLI : une entrée déjà déclarée par un manifeste chargé doit être retirée de la liste ; si le module
 *     est chargé mais ne déclare pas la clé, l'écart est signalé (modèle à corriger).
 *  4. Dès que le manifeste du module apparaît (simulé ici avec un manifeste fictif), la permission est résolue,
 *     aucun motif ne reste en attente, et parent/élève reçoivent exactement les permissions child/self.
 *  5. Provisioning : une permission réservée en attente n'empêche ni le provisioning ni la lecture des droits
 *     (couvert par `system-roles.integration.test.ts`).
 */
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { defineModule, PERMISSION_KEY_RE, type ModuleManifest } from "@ecoledigitale/kernel";
import { beforeAll, describe, expect, it } from "vitest";
import { buildPermissionCatalog, isValidPermissionPattern, matchesPermissionPattern } from "../domain/permission-catalog";
import {
  CHILD_PERMISSION_PATTERNS,
  RESERVED_FOR_UPCOMING_MODULES,
  RESERVED_MODULES,
  RESERVED_PERMISSION_KEYS,
  SELF_PERMISSION_PATTERNS,
  getReservedPermission,
  isReservedPermission,
  permissionScopeOf,
} from "../templates/reserved-permissions";
import { SYSTEM_ROLE_TEMPLATES } from "../templates/system-roles";
import { loadRealCatalog, resolveAgainst, type RealCatalog } from "./real-catalog";

let real: RealCatalog;
beforeAll(async () => {
  real = await loadRealCatalog();
});

const REPO_ROOT = resolve(__dirname, "../../../../../..");
const matchesAny = (patterns: readonly string[], key: string): boolean => patterns.some((p) => matchesPermissionPattern(p, key));

/** Clés exactes référencées par chaque modèle (octrois). */
const referencedBy = (key: string): string[] => SYSTEM_ROLE_TEMPLATES.filter((t) => t.permissions.includes(key)).map((t) => t.key);

/** Un manifeste FICTIF par module à venir : déclare exactement ses permissions réservées, avec leur sensibilité. */
function fakeUpcomingManifests(modules: readonly string[] = RESERVED_MODULES): ModuleManifest[] {
  return modules.map((module) =>
    defineModule({
      key: module,
      title: `Module à venir ${module}`,
      packs: ["CORE"],
      permissions: RESERVED_FOR_UPCOMING_MODULES.filter((r) => r.module === module).map((r) => ({
        key: r.key,
        label: `Réservée ${r.key}`,
        ...(r.sensitive ? { sensitive: true } : {}),
      })),
    }),
  ) as ModuleManifest[];
}

describe("liste blanche : forme des entrées", () => {
  it("clés exactes valides (jamais un motif), uniques", () => {
    const keys = RESERVED_FOR_UPCOMING_MODULES.map((r) => r.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const k of keys) {
      expect(PERMISSION_KEY_RE.test(k), `clé invalide ${k}`).toBe(true);
      expect(k.includes("*"), `motif interdit dans la liste : ${k}`).toBe(false);
      expect(isValidPermissionPattern(k), k).toBe(true);
    }
    expect(RESERVED_PERMISSION_KEYS.size).toBe(keys.length);
  });

  it("chaque entrée nomme un module futur connu, une spec existante et une sensibilité explicite", () => {
    for (const r of RESERVED_FOR_UPCOMING_MODULES) {
      expect(RESERVED_MODULES, r.key).toContain(r.module);
      const specPath = r.spec.split(" ")[0] as string;
      expect(/^specs\/v2\/\d{3}-[a-z-]+\/[a-z-]+\.md$/.test(specPath), `${r.key} : spec « ${r.spec} »`).toBe(true);
      expect(existsSync(resolve(REPO_ROOT, specPath)), `${r.key} : ${specPath} introuvable`).toBe(true);
      expect(typeof r.sensitive, r.key).toBe("boolean");
    }
  });

  it("aucun module de la liste n'est un module déjà livré du dépôt (la liste ne couvre QUE l'à-venir)", () => {
    const delivered = new Set(real.manifests.map((m) => m.key));
    // un module livré peut apparaître (c'est le scénario de non-oubli) ; ici on vérifie seulement que les
    // modules LIVRÉS AUJOURD'HUI n'ont aucune permission en double entre la liste et leur manifeste
    for (const r of RESERVED_FOR_UPCOMING_MODULES) {
      if (delivered.has(r.module)) continue;
      expect(real.catalog.byKey.has(r.key), `${r.key} est déjà déclarée par un autre module : retire-la de la liste`).toBe(false);
    }
  });

  it("convention de portée : `self` ⇒ réservée à `eleve`, `child` ⇒ réservée à `parent`, `own` jamais dans la liste", () => {
    for (const r of RESERVED_FOR_UPCOMING_MODULES) {
      const scope = permissionScopeOf(r.key);
      const holders = referencedBy(r.key);
      if (scope === "self") expect(holders, `${r.key} (self)`).toEqual(["eleve"]);
      else if (scope === "child") expect(holders, `${r.key} (child)`).toEqual(["parent"]);
      else {
        expect(scope, `${r.key} : pas de portée « own » réservée (le personnel passe par les modules livrés)`).toBe("none");
        expect(holders, `${r.key} : portée de gestion, ni parent ni élève`).not.toContain("parent");
        expect(holders, `${r.key} : portée de gestion, ni parent ni élève`).not.toContain("eleve");
      }
      // les motifs child/self couvrent bien les clés de portail, et uniquement elles
      expect(matchesAny(CHILD_PERMISSION_PATTERNS, r.key), `${r.key} child`).toBe(scope === "child");
      expect(matchesAny(SELF_PERMISSION_PATTERNS, r.key), `${r.key} self`).toBe(scope === "self");
    }
  });

  it("les clés `child` / `self` à quatre segments sont bien reconnues par les motifs de portail", () => {
    expect(matchesAny(CHILD_PERMISSION_PATTERNS, "primary.competency.child.read")).toBe(true);
    expect(matchesAny(CHILD_PERMISSION_PATTERNS, "student.child.read")).toBe(true);
    expect(matchesAny(SELF_PERMISSION_PATTERNS, "exam.document.self.read")).toBe(true);
    expect(matchesAny(SELF_PERMISSION_PATTERNS, "grade.self.read")).toBe(true);
    // pas de faux positif : `child`/`self` doivent être des segments internes
    expect(matchesAny(CHILD_PERMISSION_PATTERNS, "student.childcare.read")).toBe(false);
    expect(matchesAny(SELF_PERMISSION_PATTERNS, "payroll.payslip.read_own")).toBe(false);
  });
});

describe("liste blanche ⇄ modèles de rôles", () => {
  it("chaque entrée est référencée par au moins un modèle de rôle système (pas d'entrée inutile)", () => {
    const unused = RESERVED_FOR_UPCOMING_MODULES.map((r) => r.key).filter((k) => referencedBy(k).length === 0);
    expect(unused, "entrées sans modèle de rôle : retire-les de la liste ou accorde-les").toEqual([]);
  });

  it("tout motif en attente de tout modèle figure dans la liste ; sinon le test échoue (c'est l'ancien test, borné par la liste)", () => {
    const roles = resolveAgainst(real, SYSTEM_ROLE_TEMPLATES);
    for (const [role, r] of roles) {
      const outside = r.pending.filter((p) => !RESERVED_PERMISSION_KEYS.has(p));
      expect(outside, `${role} : motifs en attente hors RESERVED_FOR_UPCOMING_MODULES`).toEqual([]);
    }
  });

  it("une permission en attente HORS liste serait détectée (le contrôle n'est pas vide)", () => {
    const roles = resolveAgainst(real, [
      { key: "faux_role", label: "Faux", description: "d", permissions: ["primary.competency.read", "primary.competency.recorded", "grade.enter"] },
    ]);
    const pending = roles.get("faux_role")?.pending ?? [];
    expect(pending.filter((p) => !RESERVED_PERMISSION_KEYS.has(p))).toEqual(["primary.competency.recorded"]);
  });

  it("les clés réservées ne sont jamais accordées tant que le manifeste du module n'est pas chargé", () => {
    const roles = resolveAgainst(real, SYSTEM_ROLE_TEMPLATES);
    for (const r of RESERVED_FOR_UPCOMING_MODULES) {
      const loaded = real.catalog.byKey.has(r.key);
      for (const [role, resolved] of roles) {
        if (role === "owner" || role === "directeur") continue;
        if (!loaded) expect(resolved.permissions.has(r.key), `${role} ne peut pas détenir ${r.key} sans catalogue`).toBe(false);
      }
    }
  });
});

describe("non-oubli : la liste ne survit pas à la livraison du module", () => {
  it("aucune entrée n'est déjà déclarée par un manifeste chargé : sinon « retire-la de la liste »", () => {
    const stale = RESERVED_FOR_UPCOMING_MODULES.filter((r) => real.catalog.byKey.has(r.key)).map((r) => `${r.key} (déclarée par ${real.catalog.byKey.get(r.key)?.moduleKey})`);
    expect(stale, "ces permissions sont maintenant déclarées par un manifeste : retire-les de RESERVED_FOR_UPCOMING_MODULES (templates/reserved-permissions.ts)").toEqual([]);
  });

  it("si le module d'une entrée est chargé, la permission doit y être déclarée (renommage non répercuté dans les modèles)", () => {
    const loaded = new Set(real.manifests.map((m) => m.key));
    const missing = RESERVED_FOR_UPCOMING_MODULES.filter((r) => loaded.has(r.module) && !real.catalog.byKey.has(r.key)).map((r) => `${r.key} (module ${r.module} chargé)`);
    expect(missing, "le module est livré mais ne déclare pas ces permissions : aligne le modèle de rôle (ou le manifeste), puis retire l'entrée").toEqual([]);
  });

  it("le non-oubli détecterait une entrée devenue réelle (simulation : catalogue + manifeste du module)", () => {
    const withModule = buildPermissionCatalog([...real.manifests, ...fakeUpcomingManifests(["primary_school"])]);
    const stale = RESERVED_FOR_UPCOMING_MODULES.filter((r) => r.module === "primary_school" && withModule.byKey.has(r.key));
    expect(stale.length).toBeGreaterThan(0);
    // c'est exactement la condition qui fait échouer « aucune entrée n'est déjà déclarée » sur le vrai catalogue
  });

  it("drapeau `sensitive` : celui de la spec, contrôlé contre le manifeste dès que le module est chargé", () => {
    for (const r of RESERVED_FOR_UPCOMING_MODULES) {
      const entry = real.catalog.byKey.get(r.key);
      if (!entry) continue;
      expect(entry.sensitive, `${r.key} : sensibilité du manifeste ≠ spec (${r.spec}) ; mets à jour sensitiveJustifications des modèles`).toBe(r.sensitive);
    }
  });
});

describe("quand les manifestes des modules à venir apparaissent : tout se résout", () => {
  // Catalogue réel SANS les modules à venir déjà chargés (si l'un l'est, on le remplace par le manifeste fictif
  // identique) + un manifeste fictif par module à venir.
  const manifestsWithAll = (): ModuleManifest[] => [...real.manifests.filter((m) => !RESERVED_MODULES.includes(m.key as never)), ...fakeUpcomingManifests()];

  it("aucun motif en attente pour AUCUN rôle, et chaque rôle reçoit ses permissions réservées", () => {
    const catalog = buildPermissionCatalog(manifestsWithAll());
    const roles = resolveAgainst({ ...real, catalog }, SYSTEM_ROLE_TEMPLATES);
    for (const [role, r] of roles) expect(r.pending, `${role} : motifs encore en attente`).toEqual([]);
    for (const t of SYSTEM_ROLE_TEMPLATES) {
      if (t.key === "owner" || t.key === "directeur") continue;
      for (const key of t.permissions.filter(isReservedPermission)) {
        expect(roles.get(t.key)?.permissions.has(key), `${t.key} doit recevoir ${key} une fois le module chargé`).toBe(true);
      }
    }
    // la direction reçoit tout, y compris les nouvelles permissions
    for (const r of RESERVED_FOR_UPCOMING_MODULES) {
      expect(roles.get("owner")?.permissions.has(r.key), `owner ${r.key}`).toBe(true);
      expect(roles.get("directeur")?.permissions.has(r.key), `directeur ${r.key}`).toBe(true);
    }
  });

  it("parent = exactement les clés `child` du catalogue ; élève = exactement les `self` (à 3 ET 4 segments)", () => {
    const catalog = buildPermissionCatalog(manifestsWithAll());
    const roles = resolveAgainst({ ...real, catalog }, SYSTEM_ROLE_TEMPLATES);
    const child = catalog.keys.filter((k) => matchesAny(CHILD_PERMISSION_PATTERNS, k)).sort();
    const self = catalog.keys.filter((k) => matchesAny(SELF_PERMISSION_PATTERNS, k)).sort();
    expect([...(roles.get("parent")?.permissions ?? [])].sort()).toEqual(child);
    expect([...(roles.get("eleve")?.permissions ?? [])].sort()).toEqual(self);
    for (const key of ["primary.competency.child.read", "primary.bilan.child.read", "exam.document.child.read"]) expect(child).toContain(key);
    for (const key of ["primary.competency.self.read", "primary.bilan.self.read", "exam.document.self.read"]) expect(self).toContain(key);
  });

  it("le rôle `instituteur` ne reçoit ni validation/publication des notes, ni révision, ni scellé, ni finance (spec 005 §7)", () => {
    const catalog = buildPermissionCatalog([
      ...manifestsWithAll(),
      // permissions futures NON accordées à l'instituteur, déclarées par le module pour prouver qu'aucun motif large ne les capte
      defineModule({
        key: "primary_extra",
        title: "Primary — permissions non accordées",
        packs: ["CORE"],
        permissions: [
          { key: "primary.competency.revise", label: "Réviser", sensitive: true },
          { key: "primary.bilan.seal", label: "Sceller", sensitive: true },
          { key: "primary.bilan.prepare", label: "Préparer le bilan" },
        ],
      }) as ModuleManifest,
    ]);
    const instituteur = resolveAgainst({ ...real, catalog }, SYSTEM_ROLE_TEMPLATES).get("instituteur")?.permissions ?? new Set<string>();
    for (const k of ["grade.validate", "grade.publish", "grade.revise.approve", "period.close", "primary.competency.revise", "primary.bilan.seal"]) {
      expect(instituteur.has(k), k).toBe(false);
    }
    expect([...instituteur].filter((k) => k.startsWith("finance."))).toEqual([]);
    for (const k of ["primary.competency.read", "primary.competency.record", "primary.competency.validate", "primary.council.prepare", "grade.enter", "attendance.take"]) {
      expect(instituteur.has(k), k).toBe(true);
    }
  });

  it("les permissions sensibles réservées portent bien `sensitive` dans le manifeste fictif (cohérence avec la spec)", () => {
    const sensitive = RESERVED_FOR_UPCOMING_MODULES.filter((r) => r.sensitive).map((r) => r.key).sort();
    expect(sensitive).toEqual([
      "council.decision.record",
      "council.exclusion.apply",
      "council.minutes.sign",
      "council.orientation.override",
      "council.session.run",
      "council.settings.manage",
    ]);
    for (const k of sensitive) expect(getReservedPermission(k)?.module).toBe("councils");
  });
});
