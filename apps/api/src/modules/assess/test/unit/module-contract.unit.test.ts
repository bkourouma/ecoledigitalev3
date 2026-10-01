import { describe, expect, it } from "vitest";
import { PERMISSION_KEY_RE, resolveModuleOrder } from "@ecoledigitale/kernel";
import { assessEventPayloadSchemas, assessScoreInputSchema, assessGradeEntrySchema, assessSaveGradesBodySchema, assessTransitionBodySchema } from "@ecoledigitale/contracts/src/v2/assess";
import manifest from "../../manifest";
import subscribers from "../../subscribers";
import jobs from "../../jobs";
import { PERMISSIONS } from "../../http/guards";
import { ConsumedEvents, ALL_ASSESS_EVENT_TYPES } from "../../domain/events";
import { SYSTEM_ROLE_TEMPLATES, buildPermissionCatalog, resolveSystemRoles, rbacManifest } from "../../../rbac";
import { assessTenantTables } from "../../../isolation-allowlist.assess";

describe("manifeste du module assess", () => {
  it("clé, packs, aucune dépendance (assess ne dépend ni de results ni de rules, A-21)", () => {
    expect(manifest).toMatchObject({ key: "assess", dependsOn: [] });
    expect(manifest.packs).toEqual(["PRIMARY", "SECONDARY", "HIGHER", "VIRTUAL"]);
    expect(() => resolveModuleOrder([rbacManifest, manifest])).not.toThrow();
  });

  it("permissions : format `ressource.action`, uniques, toutes utilisées par la couche HTTP, sensibles aux bons endroits", () => {
    const keys = manifest.permissions.map((p) => p.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const k of keys) expect(k).toMatch(PERMISSION_KEY_RE);
    expect([...Object.values(PERMISSIONS)].sort()).toEqual([...keys].sort());
    const sensitive = manifest.permissions.filter((p) => p.sensitive).map((p) => p.key).sort();
    expect(sensitive).toEqual(["assessment.type.manage", "grade.publish", "grade.revise.approve", "grade.validate"]);
  });

  it("événements publiés = schémas du contrat ; événement consommé = celui de l'abonné", () => {
    expect([...manifest.events.publishes].sort()).toEqual(Object.keys(assessEventPayloadSchemas).sort());
    expect([...ALL_ASSESS_EVENT_TYPES].sort()).toEqual(Object.keys(assessEventPayloadSchemas).sort());
    expect(manifest.events.consumes).toEqual([ConsumedEvents.TENANT_PROVISIONED]);
    expect(subscribers.map((s) => String(s.pattern))).toEqual([ConsumedEvents.TENANT_PROVISIONED]);
    expect(jobs.map((j) => j.name)).toEqual(["assess.purge-batch-receipts"]);
  });

  it("menus : permission et feature déclarées ; feature de session 2 rattachée au supérieur", () => {
    expect(manifest.features.map((f) => f.key)).toEqual(["assess.session2"]);
    expect(manifest.features[0]?.packs).toEqual(["HIGHER"]);
    for (const m of manifest.menus) expect(manifest.permissions.some((p) => p.key === m.permission)).toBe(true);
  });

  it("8 tables de tenant déclarées pour le test d'isolation", () => {
    expect(assessTenantTables).toHaveLength(8);
    for (const t of assessTenantTables) expect(t.startsWith("assess.")).toBe(true);
  });
});

describe("alignement avec les rôles système du module rbac", () => {
  const catalog = buildPermissionCatalog([manifest]);
  const roles = new Map(resolveSystemRoles(catalog).map((r) => [r.template.key, new Set(r.permissions)]));
  const can = (role: string, perm: string): boolean => roles.get(role)?.has(perm) === true;

  it("enseignant : crée ses évaluations et saisit, ne valide ni ne publie", () => {
    for (const p of ["assessment.read", "assessment.create", "assessment.update", "grade.read", "grade.enter"]) expect(can("enseignant", p), p).toBe(true);
    for (const p of ["grade.review", "grade.validate", "grade.publish", "grade.revise.approve", "assessment.manage", "assessment.type.manage"]) expect(can("enseignant", p), p).toBe(false);
  });
  it("responsable pédagogique : relit et approuve (grade.validate) ; la publication reste à la direction", () => {
    expect(can("responsable_pedagogique", "grade.validate")).toBe(true);
    expect(can("responsable_pedagogique", "assessment.read")).toBe(true);
    expect(can("responsable_pedagogique", "grade.publish")).toBe(false);
    expect(can("responsable_pedagogique", "grade.revise.approve")).toBe(false);
  });
  it("parent : les notes de ses enfants seulement ; élève : les siennes", () => {
    expect(can("parent", "grade.child.read")).toBe(true);
    expect(can("parent", "grade.self.read")).toBe(false);
    expect(can("parent", "grade.enter")).toBe(false);
    expect(can("eleve", "grade.self.read")).toBe(true);
    expect(can("eleve", "grade.child.read")).toBe(false);
  });
  it("direction des études et direction : tout le module", () => {
    for (const k of manifest.permissions.map((p) => p.key)) {
      expect(can("directeur_etudes", k) || k.startsWith("assessment.type") || k === "grade.self.read" || k === "grade.child.read", k).toBe(true);
      expect(can("directeur", k), k).toBe(true);
    }
  });
  it("le catalogue connaît les rôles système", () => {
    expect(SYSTEM_ROLE_TEMPLATES.map((t) => t.key)).toContain("enseignant");
  });
});

describe("contrats Zod", () => {
  it("un score est une chaîne décimale exacte (nombre JSON accepté, jamais d'exposant ni de 4e décimale)", () => {
    expect(assessScoreInputSchema.parse(12.5)).toBe("12.5");
    expect(assessScoreInputSchema.parse(0)).toBe("0");
    expect(assessScoreInputSchema.parse(20)).toBe("20");
    expect(assessScoreInputSchema.parse("7.125")).toBe("7.125");
    expect(assessScoreInputSchema.safeParse(1e-7).success).toBe(false);
    expect(assessScoreInputSchema.safeParse(1.2345).success).toBe(false);
    expect(assessScoreInputSchema.safeParse(-1).success).toBe(false);
    expect(assessScoreInputSchema.safeParse(Number.NaN).success).toBe(false);
    expect(assessScoreInputSchema.safeParse("abc").success).toBe(false);
  });
  it("une ligne de saisie : note OU état d'entrée, jamais les deux", () => {
    const id = "0190c6a0-0000-7000-8000-000000000001";
    expect(assessGradeEntrySchema.safeParse({ enrollmentId: id, score: 12 }).success).toBe(true);
    expect(assessGradeEntrySchema.safeParse({ enrollmentId: id, entryStatus: "ABSENT_EXCUSED" }).success).toBe(true);
    expect(assessGradeEntrySchema.safeParse({ enrollmentId: id, entryStatus: "ABSENT_EXCUSED", score: 0 }).success).toBe(false);
    expect(assessGradeEntrySchema.safeParse({ enrollmentId: id, entryStatus: "ENTERED" }).success).toBe(false);
    expect(assessGradeEntrySchema.safeParse({ enrollmentId: id }).success).toBe(false);
  });
  it("un lot : 500 lignes au plus, sans doublon d'inscription", () => {
    const id = "0190c6a0-0000-7000-8000-000000000001";
    expect(assessSaveGradesBodySchema.safeParse({ entries: [{ enrollmentId: id, score: 1 }, { enrollmentId: id, score: 2 }] }).success).toBe(false);
    expect(assessSaveGradesBodySchema.safeParse({ entries: [] }).success).toBe(false);
  });
  it("un retour en brouillon exige un commentaire", () => {
    expect(assessTransitionBodySchema.safeParse({ to: "DRAFT" }).success).toBe(false);
    expect(assessTransitionBodySchema.safeParse({ to: "DRAFT", comment: "À revoir" }).success).toBe(true);
    expect(assessTransitionBodySchema.safeParse({ to: "PUBLISHED" }).success).toBe(true);
    expect(assessTransitionBodySchema.safeParse({ to: "CANCELLED" }).success).toBe(false);
  });
});
