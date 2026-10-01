import { describe, expect, it } from "vitest";
import {
  TenantUnknownError,
  buildTenantConfig,
  normalizeHostname,
  requireTenant,
  resolveTenant,
  tenantFromHostname,
} from "./resolve-tenant";

const UUID = "0b1c2d3e-4f50-4a6b-8c7d-9e0f1a2b3c4d";

describe("resolveTenant — ordre de priorité", () => {
  it("la session l'emporte sur le sous-domaine et l'environnement", () => {
    const r = resolveTenant({
      session: { tenantSlug: "ipam", tenantId: UUID },
      hostname: "autre.ecoledigitale.allianceconsultants.net",
      env: "dev",
    });
    expect(r).toMatchObject({ key: "ipam", slug: "ipam", id: UUID, source: "session" });
  });

  it("session sans slug : l'identifiant sert de clé", () => {
    const r = resolveTenant({ session: { tenantId: UUID } });
    expect(r).toMatchObject({ key: UUID, slug: null, id: UUID, source: "session" });
  });

  it("le sous-domaine l'emporte sur l'environnement", () => {
    const r = resolveTenant({ hostname: "ipam.ecoledigitale.allianceconsultants.net", env: "dev" });
    expect(r).toMatchObject({ key: "ipam", source: "subdomain" });
  });

  it("un domaine personnalisé configuré est reconnu", () => {
    const config = buildTenantConfig({ customDomains: "Portail.MonEcole.ci=monecole" });
    const r = resolveTenant({ hostname: "portail.monecole.ci:443", config, env: "dev" });
    expect(r).toMatchObject({ key: "monecole", source: "custom-domain" });
  });

  it("repli sur NEXT_PUBLIC_TENANT_SLUG quand l'hôte ne désigne pas de tenant", () => {
    expect(resolveTenant({ hostname: "localhost", env: "dev-ecole" })).toMatchObject({
      key: "dev-ecole",
      source: "env",
    });
    expect(resolveTenant({ env: "  dev-ecole " })).toMatchObject({ key: "dev-ecole", source: "env" });
  });

  it("l'override explicite (super-admin) précède la session", () => {
    const r = resolveTenant({ override: "autre", session: { tenantSlug: "ipam" } });
    expect(r).toMatchObject({ key: "autre", source: "override" });
  });

  it("un UUID dans env ou override remplit `id`, pas `slug`", () => {
    expect(resolveTenant({ env: UUID })).toMatchObject({ slug: null, id: UUID });
  });
});

describe("resolveTenant — tenant inconnu (aucun repli codé en dur)", () => {
  it.each([
    [{}],
    [{ hostname: "localhost" }],
    [{ hostname: "ecoledigitale.allianceconsultants.net" }],
    [{ session: { tenantSlug: " ", tenantId: null }, env: "" }],
    [{ hostname: "www.ecoledigitale.allianceconsultants.net" }],
  ])("renvoie null pour %j", (input) => {
    expect(resolveTenant(input)).toBeNull();
  });

  it("ne renvoie jamais un des anciens replis", () => {
    for (const input of [{}, { hostname: "localhost" }, { hostname: "exemple.com" }]) {
      const r = resolveTenant(input);
      expect(r?.key ?? null).toBeNull();
    }
  });

  it("requireTenant lève TenantUnknownError", () => {
    expect(() => requireTenant({})).toThrow(TenantUnknownError);
    expect(requireTenant({ env: "x" }).key).toBe("x");
  });
});

describe("tenantFromHostname", () => {
  it("ignore les hôtes non listés (pas de 'premier label' générique)", () => {
    expect(tenantFromHostname("app.exemple.com")).toBeNull();
    expect(tenantFromHostname("ipam.exemple.ci")).toBeNull();
  });

  it("ne reconnaît qu'un niveau sous le domaine de base", () => {
    expect(tenantFromHostname("a.b.ecoledigitale.allianceconsultants.net")).toBeNull();
    expect(tenantFromHostname("a.ecoledigitale.allianceconsultants.net")?.slug).toBe("a");
  });

  it("rejette les sous-domaines réservés et les labels invalides", () => {
    expect(tenantFromHostname("api.ecoledigitale.allianceconsultants.net")).toBeNull();
    expect(tenantFromHostname("-x.ecoledigitale.allianceconsultants.net")).toBeNull();
  });

  it("accepte <slug>.localhost en développement", () => {
    expect(tenantFromHostname("ipam.localhost:3000")).toEqual({ slug: "ipam", source: "subdomain" });
    expect(tenantFromHostname("localhost:3000")).toBeNull();
  });

  it("insensible à la casse, au port et au point final", () => {
    expect(tenantFromHostname("IPAM.EcoleDigitale.AllianceConsultants.net.:443")?.slug).toBe("ipam");
  });

  it("buildTenantConfig AJOUTE des domaines de base sans retirer celui par défaut", () => {
    const config = buildTenantConfig({ baseDomains: "ecole.example.ci" });
    expect(tenantFromHostname("x.ecole.example.ci", config)?.slug).toBe("x");
    expect(tenantFromHostname("y.ecoledigitale.allianceconsultants.net", config)?.slug).toBe("y");
  });

  it("buildTenantConfig ignore les paires invalides", () => {
    const config = buildTenantConfig({ customDomains: "sans-egal,h.ci=Slug Invalide,ok.ci=ok" });
    expect(config.customDomains).toEqual({ "ok.ci": "ok" });
  });
});

describe("normalizeHostname", () => {
  it("normalise et rejette l'inutilisable", () => {
    expect(normalizeHostname("Foo.Bar:8080")).toBe("foo.bar");
    expect(normalizeHostname("")).toBeNull();
    expect(normalizeHostname(null)).toBeNull();
    expect(normalizeHostname("[::1]:3000")).toBeNull();
  });
});
