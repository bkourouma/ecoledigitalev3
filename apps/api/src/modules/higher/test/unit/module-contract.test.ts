import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { PERMISSION_KEY_RE, defineModule, resolveModuleOrder } from "@ecoledigitale/kernel";
import { higherEventPayloadSchemas } from "@ecoledigitale/contracts/src/v2/higher";
import { SYSTEM_ROLE_TEMPLATES, buildPermissionCatalog, resolveSystemRoles, rbacManifest } from "../../../rbac";
import { rulesManifest } from "../../../rules";
import manifest from "../../manifest";
import subscribers from "../../subscribers";
import jobs from "../../jobs";
import { PERMISSIONS as HIGHER_PERMISSIONS } from "../../http/guards";
import { ConsumedEvents } from "../../domain/events";
import allowlist, { higherTenantTables } from "../../../isolation-allowlist.higher";
import { createHigherDeps } from "../../application/deps";
import { unavailablePorts } from "../../infrastructure/in-memory-ports";
import { createRulesAdapter } from "../../infrastructure/rules-adapter";

/** Le module audit (dépendance de rules) n'exporte pas son manifeste par son index : doublure pour l'ordre topologique. */
const auditManifest = defineModule({ key: "audit", title: "Audit", packs: ["CORE"] });

const here = dirname(fileURLToPath(import.meta.url));
const moduleRoot = join(here, "../..");

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) {
      if (name === "test" || name === "node_modules") continue;
      sourceFiles(p, out);
    } else if (/\.(ts|sql)$/.test(name)) out.push(p);
  }
  return out;
}

describe("manifeste du module higher", () => {
  it("clé, dépendances, pack et ordre topologique sans cycle", () => {
    expect(manifest).toMatchObject({ key: "higher", dependsOn: ["rbac", "rules"], packs: ["HIGHER"] });
    const order = resolveModuleOrder([rbacManifest, auditManifest, rulesManifest, manifest]).map((m) => m.key);
    expect(order.indexOf("rules")).toBeLessThan(order.indexOf("higher"));
    expect(order.indexOf("rbac")).toBeLessThan(order.indexOf("higher"));
  });

  it("permissions : format, uniques, toutes utilisées par la couche HTTP, sensibles aux bons endroits (spec §9)", () => {
    const keys = manifest.permissions.map((p) => p.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const k of keys) expect(k).toMatch(PERMISSION_KEY_RE);
    expect([...Object.values(HIGHER_PERMISSIONS)].sort()).toEqual([...keys].sort());
    const sensitive = manifest.permissions.filter((p) => p.sensitive).map((p) => p.key).sort();
    // O-11 (UE annuelle) et O-14 (dispense) : actes qui changent un résultat ou le registre de crédits -> sensibles.
    expect(sensitive).toEqual(["higher.annual_ue.manage", "higher.award.create", "higher.award.force", "higher.award.revoke", "higher.document.issue", "higher.exemption.grant", "higher.slot.manage"]);
    // Spec §9 : les 11 permissions de référence existent telles quelles.
    for (const k of [
      "higher.diploma.read", "higher.diploma.manage", "higher.award.read", "higher.award.create", "higher.award.force", "higher.award.revoke",
      "higher.document.issue", "higher.document.read", "higher.credits.read", "higher.prerequisite.manage", "higher.resit.manage", "higher.slot.manage",
    ]) expect(keys).toContain(k);
  });

  it("événements publiés = schémas du contrat ; consommés = ceux des abonnés ; jobs", () => {
    expect([...manifest.events.publishes].sort()).toEqual(Object.keys(higherEventPayloadSchemas).sort());
    expect([...manifest.events.consumes].sort()).toEqual(Object.values(ConsumedEvents).sort());
    const patterns = subscribers.map((s) => String(s.pattern)).sort();
    for (const consumed of manifest.events.consumes) expect(patterns, consumed).toContain(consumed);
    expect(new Set(subscribers.map((s) => s.name)).size).toBe(subscribers.length);
    // L'éligibilité et la capitalisation sont deux abonnés DISTINCTS (R-HIG-10).
    // Le scellement et le rendu PDF des documents sont deux abonnés dédiés (Chromium : jamais dans la transaction d'un autre effet).
    expect(subscribers.map((s) => s.name).sort()).toEqual(["higher.capitalize-on-period-closed", "higher.evaluate-diplomas-on-capitalized", "higher.render-document", "higher.render-document-requested"]);
    expect(jobs.map((j) => j.name)).toEqual(["higher.expire-credits"]);
  });

  it("features et menus : permission et feature déclarées, packs HIGHER, spec §9 (4 features)", () => {
    expect(manifest.features.map((f) => f.key).sort()).toEqual(["higher.attestations", "higher.diplomas", "higher.prerequisites", "higher.session2"]);
    for (const f of manifest.features) expect(f.packs).toEqual(["HIGHER"]);
    for (const m of manifest.menus) {
      expect(manifest.permissions.some((p) => p.key === m.permission), m.key).toBe(true);
      if (m.feature) expect(manifest.features.some((f) => f.key === m.feature), m.key).toBe(true);
    }
  });

  it("allowlist d’isolation : aucune table globale, 17 tables de tenant attendues (13 + 3 d’UE annuelle O-11 + 1 de dispense O-14)", () => {
    expect(allowlist).toEqual([]);
    expect(higherTenantTables).toHaveLength(17);
  });
});

describe("alignement avec les rôles système du module rbac", () => {
  const catalog = buildPermissionCatalog([manifest]);
  const roles = new Map(resolveSystemRoles(catalog).map((r) => [r.template.key, new Set(r.permissions)]));
  const can = (role: string, perm: string): boolean => roles.get(role)?.has(perm) === true;

  it("l'enseignant n'a AUCUNE permission du module (parité 029) ; le propriétaire et la direction ont tout", () => {
    for (const p of manifest.permissions.map((x) => x.key)) {
      expect(can("enseignant", p), `enseignant ${p}`).toBe(false);
    }
    expect(SYSTEM_ROLE_TEMPLATES.length).toBeGreaterThan(5);
    for (const role of ["owner", "directeur"]) {
      if (!roles.has(role)) continue;
      for (const p of manifest.permissions.map((x) => x.key)) expect(can(role, p), `${role} ${p}`).toBe(true);
    }
  });

  it("convention .self / .child des modèles de rôles : l'élève lit son parcours, le parent celui de son enfant, et rien d'autre", () => {
    expect(can("eleve", "higher.self.read")).toBe(true);
    expect(can("eleve", "higher.child.read")).toBe(false);
    expect(can("parent", "higher.child.read")).toBe(true);
    expect(can("parent", "higher.self.read")).toBe(false);
    for (const p of ["higher.diploma.read", "higher.award.read", "higher.credits.read", "higher.document.read", "higher.award.create", "higher.slot.manage"]) {
      expect(can("eleve", p), `eleve ${p}`).toBe(false);
      expect(can("parent", p), `parent ${p}`).toBe(false);
    }
  });
});

describe("règles d'architecture propres au module", () => {
  it("aucun signataire par défaut, aucun nom de personne codé en dur dans le code du module (critère de sortie 6)", () => {
    const offenders: string[] = [];
    for (const file of sourceFiles(moduleRoot)) {
      const text = readFileSync(file, "utf8");
      const rel = relative(moduleRoot, file);
      if (/SIGNATAIRES?_DEFAULTS?|DEFAULT_SIGNATOR|defaultSignator|signatairesParD[ée]faut/i.test(text)) offenders.push(`${rel} : signataire par défaut`);
      if (/signatory.*(?:fullName|name)\s*[:=]\s*["'`][A-ZÉ][a-zéèï]+\s+[A-ZÉ]/.test(text) && !rel.startsWith("infrastructure/in-memory-ports")) offenders.push(`${rel} : nom de signataire littéral`);
    }
    expect(offenders).toEqual([]);
  });

  it("le moteur de règles n'est jamais importé directement ; aucun seuil / formule académique en dur", () => {
    const offenders: string[] = [];
    for (const file of sourceFiles(moduleRoot)) {
      if (!file.endsWith(".ts")) continue;
      const text = readFileSync(file, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
      const rel = relative(moduleRoot, file);
      if (/rules-engine/.test(text)) offenders.push(`${rel} : import direct du moteur`);
      // Comparaison d'une moyenne / note à un seuil littéral (>= 10, > 12…), ou « 20 / 48 crédits » en dur.
      if (/\b(moyenne|average|averageExact|note|avg)\w*\s*(>=|>|<=|<)\s*[1-9]/i.test(text)) offenders.push(`${rel} : seuil de note littéral`);
      if (/\bcredits?\w*\s*(>=|>)\s*(20|48)\b/i.test(text)) offenders.push(`${rel} : seuil de crédits littéral`);
    }
    expect(offenders).toEqual([]);
  });

  it("SQL : aucune constante réglementaire (seuils de notes, 20 crédits, 48 crédits) dans les migrations", () => {
    const offenders: string[] = [];
    for (const file of sourceFiles(moduleRoot).filter((f) => f.endsWith(".sql"))) {
      const text = readFileSync(file, "utf8").replace(/--.*$/gm, "");
      if (/credits\s*(?:>=|>)\s*(?:20|48)\b|moyenne\s*(?:>=|>)\s*\d|average\w*\s*(?:>=|>)\s*\d+(?!\.)/i.test(text)) offenders.push(relative(moduleRoot, file));
    }
    expect(offenders).toEqual([]);
  });
});

describe("échec fermé : ports non branchés", () => {
  it("chaque port indisponible refuse l'opération avec higher.port_unavailable (jamais de valeur implicite)", async () => {
    const deps = createHigherDeps({ db: {} as never });
    const ports = unavailablePorts();
    await expect(ports.credits.listFinalUeLines({} as never, { classroomId: "c", academicPeriodId: "p" })).rejects.toMatchObject({ code: "higher.port_unavailable" });
    await expect(ports.curriculum.getUe({} as never, "u")).rejects.toMatchObject({ code: "higher.port_unavailable" });
    await expect(ports.rules.evaluateEligibility({} as never, { exigences: [], uvRequises: 1, scope: { onDate: "2026-01-01" } })).rejects.toMatchObject({ code: "higher.port_unavailable" });
    await expect(deps.ports.signatories.getSignatory({} as never, "s")).rejects.toMatchObject({ code: "higher.port_unavailable" });
    await expect(deps.ports.students.isGuardianOf({} as never, { userId: "u", studentId: "s" })).rejects.toMatchObject({ code: "higher.port_unavailable" });
  });

  it("l'adaptateur de règles sans module rules : higher.rules_unavailable, jamais une éligibilité supposée", async () => {
    const adapter = createRulesAdapter(() => undefined);
    await expect(adapter.evaluateEligibility({} as never, { exigences: [], uvRequises: 1, scope: { onDate: "2026-01-01" } })).rejects.toMatchObject({ code: "higher.rules_unavailable" });
  });
});
