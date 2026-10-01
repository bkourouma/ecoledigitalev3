import { describe, expect, it } from "vitest";
import {
  INSTITUTION_PACKS,
  ProvisionTenantInputSchema,
} from "@ecoledigitale/contracts/src/v2/tenancy";
import { RESERVED_SLUGS, deriveCode, planProvisioning, uniqueCode } from "../domain/provisioning";
import { buildPackTemplates, defaultPackTemplates, PackTemplateSchema } from "../templates";
import manifest from "../manifest";

const CI = { code: "CI", educationSystem: "CI" };
const counter = () => {
  let n = 0;
  return () => `id-${++n}`;
};

describe("modèles de pack", () => {
  it("un modèle valide par pack, drapeau de pack = pack", () => {
    const t = defaultPackTemplates();
    expect([...t.keys()].sort()).toEqual([...INSTITUTION_PACKS].sort());
    for (const [pack, template] of t) expect(template.pack).toBe(pack);
  });

  it("les modèles ne contiennent que le socle : institution + campus par défaut (niveaux/périodes réservés, vides)", () => {
    for (const template of defaultPackTemplates().values()) {
      expect(template.institution.code).toMatch(/^[a-z0-9-]+$/);
      expect(template.defaultCampus.name.length).toBeGreaterThan(1);
      expect(template.levels).toEqual([]);
      expect(template.periods).toEqual([]);
    }
  });

  it("refuse un modèle en double, manquant ou mal formé", () => {
    const base = [...defaultPackTemplates().values()];
    expect(() => buildPackTemplates([...base, base[0]])).toThrow(/double/);
    expect(() => buildPackTemplates(base.slice(1))).toThrow(/manquant/);
    expect(() => PackTemplateSchema.parse({ ...base[0], institution: { code: "x", nameTemplate: "sans variable" } })).toThrow();
    expect(() => PackTemplateSchema.parse({ ...base[0], extra: 1 })).toThrow();
  });
});

describe("planProvisioning", () => {
  const templates = defaultPackTemplates();

  it("une institution + un campus par défaut par pack, dans l'ordre demandé, sans doublon", () => {
    const r = planProvisioning({ name: "Groupe Les Lauriers", slug: "lauriers", packs: ["SECONDARY", "PRIMARY", "SECONDARY"] }, "tenant-1", CI, templates, counter());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.tenantId).toBe("tenant-1");
    expect(r.value.institutions.map((i) => i.pack)).toEqual(["SECONDARY", "PRIMARY"]);
    for (const inst of r.value.institutions) {
      expect(inst.campus.id).toBeTruthy();
      expect(inst.educationSystem).toBe("CI");
      expect(inst.countryCode).toBe("CI");
    }
    // Plusieurs packs : les établissements se distinguent par le nom.
    expect(r.value.institutions.map((i) => i.name)).toEqual([
      "Groupe Les Lauriers - Secondaire",
      "Groupe Les Lauriers - Primaire",
    ]);
  });

  it("un seul pack : l'établissement porte le nom de l'organisation", () => {
    const r = planProvisioning({ name: "École Les Palmiers", slug: "palmiers", packs: ["PRIMARY"] }, "t", CI, templates, counter());
    expect(r.ok && r.value.institutions[0]?.name).toBe("École Les Palmiers");
  });

  it("identifiants tous distincts", () => {
    const r = planProvisioning({ name: "X Y", slug: "xy", packs: ["PRIMARY", "SECONDARY", "HIGHER", "VIRTUAL"] }, "t", CI, templates, counter());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const ids = r.value.institutions.flatMap((i) => [i.id, i.campus.id]);
    expect(new Set(ids).size).toBe(8);
  });

  it("refuse un slug réservé", () => {
    for (const slug of ["admin", "api", "www", "super-admin"]) {
      expect(RESERVED_SLUGS.has(slug)).toBe(true);
      const r = planProvisioning({ name: "Test", slug, packs: ["PRIMARY"] }, "t", CI, templates, counter());
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error.issues[0]?.code).toBe("tenancy.slug_reserved");
    }
  });
});

describe("codes lisibles", () => {
  it("deriveCode : minuscules, sans accents, tirets, borné", () => {
    expect(deriveCode("Campus Plateau - Abidjan")).toBe("campus-plateau-abidjan");
    expect(deriveCode("École Supérieure d'Économie")).toBe("ecole-superieure-d-economie");
    expect(deriveCode("   ")).toBe("item");
    expect(deriveCode("***", "campus")).toBe("campus");
    expect(deriveCode("a".repeat(100)).length).toBeLessThanOrEqual(28);
    expect(deriveCode("a".repeat(27) + " bcd")).not.toMatch(/-$/);
  });

  it("uniqueCode : premier code libre", () => {
    expect(uniqueCode("primary", new Set())).toBe("primary");
    expect(uniqueCode("primary", new Set(["primary"]))).toBe("primary-2");
    expect(uniqueCode("primary", new Set(["primary", "primary-2"]))).toBe("primary-3");
  });
});

describe("contrat ProvisionTenantInput", () => {
  const valid = {
    name: "École Les Palmiers",
    slug: "palmiers",
    countryCode: "CI",
    packs: ["PRIMARY"],
    adminContact: { name: "Awa Koné", email: "AWA@Palmiers.ci" },
  };

  it("accepte une demande valide et normalise l'e-mail en minuscules", () => {
    const r = ProvisionTenantInputSchema.parse(valid);
    expect(r.adminContact.email).toBe("awa@palmiers.ci");
  });

  it.each([
    ["slug en majuscules", { slug: "Palmiers" }],
    ["slug trop court", { slug: "a" }],
    ["slug commençant par un tiret", { slug: "-abc" }],
    ["pays en minuscules", { countryCode: "ci" }],
    ["aucun pack", { packs: [] }],
    ["pack inconnu", { packs: ["MATERNELLE"] }],
    ["e-mail invalide", { adminContact: { name: "Awa Koné", email: "pas-un-email" } }],
    ["champ inconnu", { surprise: true }],
  ])("refuse : %s", (_label, patch) => {
    expect(ProvisionTenantInputSchema.safeParse({ ...valid, ...patch }).success).toBe(false);
  });
});

describe("manifeste", () => {
  it("clé, pack CORE, permissions demandées, événements publiés", () => {
    expect(manifest.key).toBe("tenancy");
    expect(manifest.packs).toEqual(["CORE"]);
    expect(manifest.permissions.map((p) => p.key)).toEqual([
      "tenancy.institution.read",
      "tenancy.institution.manage",
      "tenancy.campus.manage",
    ]);
    expect(manifest.events.publishes).toEqual(
      expect.arrayContaining(["tenancy.institution.created", "tenancy.tenant.provisioned"]),
    );
  });
});
