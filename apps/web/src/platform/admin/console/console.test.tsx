// @vitest-environment jsdom
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { apiError, json, noContent, renderScreen, routes, type RecordedCall } from "@/platform/admin/test-utils";
import { EntitlementsSection } from "./EntitlementsSection";
import { OperatorLoginPage } from "./OperatorLoginPage";
import { PlansPage } from "./PlansPage";
import { PlatformAuditPage } from "./PlatformAuditPage";
import { ProvisionTenantPage } from "./ProvisionTenantPage";
import { TenantDetailPage } from "./TenantDetailPage";
import { TenantsPage } from "./TenantsPage";
import {
  EMPTY_OVERRIDE,
  EMPTY_PLAN,
  EMPTY_PROVISION,
  slugify,
  statusTargets,
  subscriptionFormFrom,
  validateOverride,
  validatePlan,
  validateProvision,
  validateSubscription,
} from "./lib";

const h = vi.hoisted(() => {
  const replace = vi.fn();
  return { fetchMock: vi.fn(), replace, router: { replace, push: vi.fn() } };
});
vi.mock("@/platform/admin/operator", async () => (await import("@/platform/admin/test-utils")).operatorModule(h.fetchMock));
vi.mock("next/navigation", () => ({ usePathname: () => "/v2/platform/tenants", useRouter: () => h.router }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const U = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const NOW = "2026-10-01T10:00:00.000Z";
const TENANT = U(100);

const summary = (n: number, over: Record<string, unknown> = {}) => ({ id: U(n), slug: `ecole-${n}`, name: `École ${n}`, status: "active", createdAt: NOW, ...over });
const list = (items: unknown[], total = items.length, offset = 0) => json({ items, total, limit: 25, offset });

const catalog = () =>
  json({
    plans: [
      { key: "STARTER", label: "Starter", description: "Pour démarrer", sortOrder: 10, active: true, featureKeys: ["audit.log"] },
      { key: "PROFESSIONAL", label: "Professional", description: null, sortOrder: 20, active: true, featureKeys: ["audit.log", "finance.invoices"] },
    ],
    packs: [{ key: "SECONDARY", label: "Secondaire", description: null, sortOrder: 1, active: true }],
    features: [
      { key: "audit.log", label: "Journal d'audit", moduleKey: "audit", packs: ["CORE"], retired: false },
      { key: "finance.invoices", label: "Factures", moduleKey: "finance", packs: ["SECONDARY"], retired: false },
      { key: "finance.legacy", label: "Ancienne fonction", moduleKey: "finance", packs: ["SECONDARY"], retired: true },
    ],
  });

describe("logique de la console (fonctions pures)", () => {
  it("slugify retire accents, ponctuation et tirets de bord", () => {
    expect(slugify("Lycée Saint-Joseph d'Abidjan")).toBe("lycee-saint-joseph-d-abidjan");
    expect(slugify("  --École 2000!  ")).toBe("ecole-2000");
    expect(slugify("x".repeat(80)).length).toBe(50);
  });

  it("transitions de statut", () => {
    expect(statusTargets("active")).toEqual(["suspended", "archived"]);
    expect(statusTargets("suspended")).toEqual(["active", "archived"]);
    expect(statusTargets("archived")).toEqual(["active"]);
  });

  it("provisionnement : validé par le contrat, corps minimal", () => {
    const empty = validateProvision(EMPTY_PROVISION);
    expect(empty.data).toBeNull();
    expect(empty.errors).toMatchObject({ name: expect.any(String), slug: expect.any(String), packs: "packs", adminName: expect.any(String), adminEmail: expect.any(String) });
    const ok = validateProvision({ ...EMPTY_PROVISION, name: "École Soleil", slug: "ecole-soleil", packs: ["PRIMARY"], adminName: "Awa Koné", adminEmail: "AWA@ecole.ci", trialDays: "14" });
    expect(ok.errors).toEqual({});
    expect(ok.data).toEqual({
      name: "École Soleil",
      slug: "ecole-soleil",
      countryCode: "CI",
      packs: ["PRIMARY"],
      adminContact: { name: "Awa Koné", email: "awa@ecole.ci" },
      trial: { days: 14 },
    });
    expect(validateProvision({ ...EMPTY_PROVISION, name: "X", slug: "Slug Invalide", packs: ["PRIMARY"], adminName: "A B", adminEmail: "a@b.ci", trialDays: "999" }).errors).toMatchObject({ slug: expect.any(String), trialDays: expect.any(String) });
  });

  it("abonnement : offre obligatoire, période cohérente, tranche entière", () => {
    const form = subscriptionFormFrom(null);
    expect(validateSubscription(form).errors).toEqual({ planKey: "plan" });
    expect(validateSubscription({ ...form, planKey: "STARTER", startsAt: "2026-10-02T00:00", endsAt: "2026-10-01T00:00" }).errors.endsAt).toBe("period");
    expect(validateSubscription({ ...form, planKey: "STARTER", learnerTierMax: "1.5" }).errors.learnerTierMax).toBe("learnerTier");
    const ok = validateSubscription({ ...form, planKey: "STARTER", packs: ["SECONDARY"], learnerTierMax: "500" });
    expect(ok.data).toMatchObject({ planKey: "STARTER", packs: ["SECONDARY"], status: "ACTIVE", endsAt: null, learnerTierMax: 500 });
  });

  it("dérogation : fonctionnalité et motif (5 caractères) obligatoires", () => {
    expect(validateOverride(EMPTY_OVERRIDE).errors).toMatchObject({ featureKey: "feature", reason: expect.any(String) });
    expect(validateOverride({ ...EMPTY_OVERRIDE, featureKey: "audit.log", reason: "abc" }).errors.reason).toBeTruthy();
    expect(validateOverride({ ...EMPTY_OVERRIDE, featureKey: "audit.log", effect: "DENY", reason: "Impayé constaté" }).data).toEqual({ effect: "DENY", reason: "Impayé constaté" });
  });

  it("plan : clé en majuscules à la création, libellé obligatoire", () => {
    expect(validatePlan({ ...EMPTY_PLAN, key: "pro", label: "x" }, true).errors).toMatchObject({ key: expect.any(String), label: expect.any(String) });
    expect(validatePlan({ ...EMPTY_PLAN, key: "ENTERPRISE", label: "Enterprise", description: "" }, true).data).toMatchObject({ key: "ENTERPRISE", label: "Enterprise", description: null, active: true, sortOrder: 100 });
    expect(validatePlan({ ...EMPTY_PLAN, key: "", label: "Renommé" }, false).errors).toEqual({});
  });
});

describe("connexion de l'opérateur", () => {
  beforeEach(() => {
    h.fetchMock.mockReset();
    h.replace.mockReset();
    localStorage.clear();
  });

  it("champs obligatoires, aucun appel tant que le formulaire est incomplet", async () => {
    const calls = routes(h.fetchMock, {});
    renderScreen(<OperatorLoginPage />);
    fireEvent.click(screen.getByRole("button", { name: "Se connecter" }));
    expect((await screen.findAllByText("Ce champ est obligatoire.")).length).toBe(2);
    expect(calls).toHaveLength(0);
  });

  it("succès : jeton conservé (stockage séparé), redirection vers la console ; requête publique sans en-tête de tenant", async () => {
    const calls = routes(h.fetchMock, { "POST /api/v1/super-admin/auth/login": json({ token: "jwt-op", superAdmin: { email: "ops@ecoledigitale.net" } }) });
    renderScreen(<OperatorLoginPage />);
    fireEvent.change(screen.getByLabelText(/Adresse e-mail/), { target: { value: " OPS@ecoledigitale.net " } });
    fireEvent.change(screen.getByLabelText(/Mot de passe/), { target: { value: "secret" } });
    fireEvent.click(screen.getByRole("button", { name: "Se connecter" }));
    await waitFor(() => expect(h.replace).toHaveBeenCalledWith("/v2/platform/tenants"));
    expect(localStorage.getItem("superAdminToken")).toBe("jwt-op");
    expect(localStorage.getItem("superAdminEmail")).toBe("ops@ecoledigitale.net");
    expect(calls[0]!.body).toEqual({ email: "ops@ecoledigitale.net", password: "secret" });
    expect(calls[0]!.headers.get("x-tenant")).toBeNull();
    expect(calls[0]!.headers.get("authorization")).toBeNull();
  });

  it("identifiants refusés / API injoignable : messages distincts", async () => {
    routes(h.fetchMock, { "POST /api/v1/super-admin/auth/login": apiError(401, "UNAUTHORIZED", "Identifiants invalides.") });
    const { unmount } = renderScreen(<OperatorLoginPage />);
    fireEvent.change(screen.getByLabelText(/Adresse e-mail/), { target: { value: "a@b.ci" } });
    fireEvent.change(screen.getByLabelText(/Mot de passe/), { target: { value: "x" } });
    fireEvent.click(screen.getByRole("button", { name: "Se connecter" }));
    expect(await screen.findByText("Identifiants d'opérateur invalides.")).toBeTruthy();
    expect(localStorage.getItem("superAdminToken")).toBeNull();
    unmount();

    h.fetchMock.mockReset();
    routes(h.fetchMock, { "POST /api/v1/super-admin/auth/login": apiError(503, "INTERNAL", "Indisponible.") });
    renderScreen(<OperatorLoginPage />);
    fireEvent.change(screen.getByLabelText(/Adresse e-mail/), { target: { value: "a@b.ci" } });
    fireEvent.change(screen.getByLabelText(/Mot de passe/), { target: { value: "x" } });
    fireEvent.click(screen.getByRole("button", { name: "Se connecter" }));
    expect(await screen.findByText(/Impossible de joindre l'API/)).toBeTruthy();
  });

  it("déjà connecté : redirection immédiate", async () => {
    localStorage.setItem("superAdminToken", "tok");
    routes(h.fetchMock, {});
    renderScreen(<OperatorLoginPage />);
    await waitFor(() => expect(h.replace).toHaveBeenCalledWith("/v2/platform/tenants"));
  });
});

describe("liste des organisations", () => {
  let calls: RecordedCall[];
  beforeEach(() => h.fetchMock.mockReset());

  it("affiche statut et lien, envoie le jeton sans X-Tenant, filtre et pagine", async () => {
    calls = routes(h.fetchMock, {
      "GET /api/v1/platform/tenants": (call) =>
        call.query.get("offset") === "25" ? list([summary(26)], 26, 25) : list([summary(1), summary(2, { status: "suspended" })], 26, 0),
    });
    renderScreen(<TenantsPage />);
    const table = await screen.findByRole("table", { name: "Organisations" });
    expect(within(table).getByRole("link", { name: "Ouvrir l'organisation École 1" }).getAttribute("href")).toBe(`/v2/platform/tenants/${U(1)}`);
    expect(within(table).getByText("Suspendue")).toBeTruthy();
    expect(screen.getByText("1 à 2 sur 26")).toBeTruthy();
    expect(calls[0]!.headers.get("x-tenant")).toBeNull();
    expect(calls[0]!.headers.get("authorization")).toBe("Bearer operator-token");
    expect((screen.getByRole("button", { name: "Précédent" }) as HTMLButtonElement).disabled).toBe(true);

    fireEvent.click(screen.getByRole("button", { name: "Suivant" }));
    await screen.findByText("26 à 26 sur 26");
    expect(calls.at(-1)!.query.get("offset")).toBe("25");

    fireEvent.change(screen.getByLabelText("Rechercher"), { target: { value: "soleil" } });
    fireEvent.change(screen.getByLabelText("Statut"), { target: { value: "suspended" } });
    fireEvent.click(screen.getByRole("button", { name: "Filtrer" }));
    await waitFor(() => expect(calls.at(-1)!.query.get("search")).toBe("soleil"));
    expect(calls.at(-1)!.query.get("status")).toBe("suspended");
    expect(calls.at(-1)!.query.get("offset")).toBe("0");
  });

  it("état vide (sans puis avec filtre) et erreur avec réessai", async () => {
    calls = routes(h.fetchMock, { "GET /api/v1/platform/tenants": list([]) });
    const { unmount } = renderScreen(<TenantsPage />);
    expect(await screen.findByText("Aucune organisation pour le moment. Provisionnez la première.")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Rechercher"), { target: { value: "zzz" } });
    fireEvent.click(screen.getByRole("button", { name: "Filtrer" }));
    expect(await screen.findByText("Aucune organisation ne correspond.")).toBeTruthy();
    unmount();

    h.fetchMock.mockReset();
    routes(h.fetchMock, { "GET /api/v1/platform/tenants": apiError(401, "UNAUTHORIZED", "Jeton invalide.") });
    renderScreen(<TenantsPage />);
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("Votre session a expiré");
  });
});

describe("provisionnement", () => {
  let calls: RecordedCall[];
  beforeEach(() => h.fetchMock.mockReset());

  const fill = () => {
    fireEvent.change(screen.getByLabelText(/Nom de l'organisation/), { target: { value: "Lycée Saint-Joseph" } });
    fireEvent.change(screen.getByLabelText(/Nom complet/), { target: { value: "Awa Koné" } });
    fireEvent.change(screen.getByLabelText(/Adresse e-mail/), { target: { value: "awa@lycee.ci" } });
  };

  it("dérive l'identifiant du nom (tant qu'on ne l'a pas modifié) et exige un pack", async () => {
    calls = routes(h.fetchMock, { "GET /api/v1/platform/plans": catalog() });
    renderScreen(<ProvisionTenantPage />);
    fill();
    expect((screen.getByLabelText(/Identifiant \(slug\)/) as HTMLInputElement).value).toBe("lycee-saint-joseph");
    fireEvent.change(screen.getByLabelText(/Identifiant \(slug\)/), { target: { value: "mon-slug" } });
    fireEvent.change(screen.getByLabelText(/Nom de l'organisation/), { target: { value: "Autre nom" } });
    expect((screen.getByLabelText(/Identifiant \(slug\)/) as HTMLInputElement).value).toBe("mon-slug");

    fireEvent.click(screen.getByRole("button", { name: "Provisionner l'organisation" }));
    expect(await screen.findByText("Choisissez au moins un pack.")).toBeTruthy();
    expect(calls.some((c) => c.method === "POST")).toBe(false);
  });

  it("succès : corps conforme au contrat, résumé et lien vers l'organisation", async () => {
    calls = routes(h.fetchMock, {
      "GET /api/v1/platform/plans": catalog(),
      "POST /api/v1/platform/tenants": json(
        { tenantId: TENANT, slug: "lycee-saint-joseph", institutions: [{ id: U(1), code: "secondaire", pack: "SECONDARY", defaultCampusId: U(2) }], owner: { identityId: U(3), membershipId: U(4), email: "awa@lycee.ci" }, subscription: { planKey: "STARTER", status: "TRIALING", endsAt: null } },
        { status: 201 },
      ),
    });
    renderScreen(<ProvisionTenantPage />);
    fill();
    fireEvent.click(screen.getByLabelText("Secondaire"));
    await screen.findByRole("option", { name: "Starter" });
    fireEvent.change(screen.getByLabelText("Offre d'essai"), { target: { value: "STARTER" } });
    fireEvent.click(screen.getByRole("button", { name: "Provisionner l'organisation" }));

    expect(await screen.findByText(/Une invitation a été envoyée à awa@lycee\.ci/)).toBeTruthy();
    expect(calls.find((c) => c.method === "POST")!.body).toEqual({
      name: "Lycée Saint-Joseph",
      slug: "lycee-saint-joseph",
      countryCode: "CI",
      packs: ["SECONDARY"],
      adminContact: { name: "Awa Koné", email: "awa@lycee.ci" },
      trial: { planKey: "STARTER" },
    });
    expect(screen.getByText("1 établissement créé")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Ouvrir l'organisation" }).getAttribute("href")).toBe(`/v2/platform/tenants/${TENANT}`);
  });

  it("provisionnement partiel : message et lien pour reprendre via la réconciliation", async () => {
    calls = routes(h.fetchMock, {
      "GET /api/v1/platform/plans": catalog(),
      "POST /api/v1/platform/tenants": apiError(409, "platform.provisioning_partial", "Provisionnement partiel.", { tenantId: TENANT, step: "services" }),
    });
    renderScreen(<ProvisionTenantPage />);
    fill();
    fireEvent.click(screen.getByLabelText("Secondaire"));
    fireEvent.click(screen.getByRole("button", { name: "Provisionner l'organisation" }));
    expect(await screen.findByText(/Le provisionnement est partiel/)).toBeTruthy();
    expect(screen.getByRole("link", { name: "Ouvrir l'organisation" }).getAttribute("href")).toBe(`/v2/platform/tenants/${TENANT}`);
  });

  it("slug déjà pris : message de l'API", async () => {
    calls = routes(h.fetchMock, {
      "GET /api/v1/platform/plans": catalog(),
      "POST /api/v1/platform/tenants": apiError(409, "tenancy.slug_taken", "Cet identifiant est déjà utilisé."),
    });
    renderScreen(<ProvisionTenantPage />);
    fill();
    fireEvent.click(screen.getByLabelText("Secondaire"));
    fireEvent.click(screen.getByRole("button", { name: "Provisionner l'organisation" }));
    expect(await screen.findByText("Cet identifiant est déjà utilisé.")).toBeTruthy();
  });
});

describe("fiche d'une organisation", () => {
  let calls: RecordedCall[];
  beforeEach(() => h.fetchMock.mockReset());

  const subscription = (over: Record<string, unknown> = {}) => ({
    id: U(200),
    tenantId: TENANT,
    planKey: "STARTER",
    packs: ["SECONDARY"],
    status: "TRIALING",
    startsAt: NOW,
    endsAt: "2026-11-01T00:00:00.000Z",
    learnerTierMax: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...over,
  });

  const overview = (status = "active") => ({
    tenant: { id: TENANT, slug: "ecole-soleil", name: "École Soleil", status, createdAt: NOW },
    profile: {
      tenantId: TENANT,
      slug: "ecole-soleil",
      legalName: "École Soleil SARL",
      tradeName: null,
      countryCode: "CI",
      contactName: "Awa Koné",
      contactEmail: "awa@soleil.ci",
      contactPhone: null,
      address: null,
      branding: { logoUrl: null, primaryColor: null, secondaryColor: null, customDomain: null },
      createdAt: NOW,
      updatedAt: NOW,
    },
    institutions: [{ id: U(10), tenantId: TENANT, code: "primaire", name: "Soleil Primaire", pack: "PRIMARY", educationSystem: "ci", countryCode: "CI", status: "ACTIVE", createdAt: NOW, updatedAt: NOW }],
    subscription: subscription(),
  });

  const override = (key = "finance.invoices") => ({
    id: U(300),
    tenantId: TENANT,
    featureKey: key,
    effect: "GRANT",
    reason: "Geste commercial",
    expiresAt: null,
    createdBy: null,
    createdAt: NOW,
    updatedAt: NOW,
  });

  const base = (extra: Record<string, Response | ((c: RecordedCall) => Response)> = {}) => ({
    [`GET /api/v1/platform/tenants/${TENANT}`]: json(overview()),
    [`GET /api/v1/platform/tenants/${TENANT}/subscription`]: json({ subscription: subscription() }),
    [`GET /api/v1/platform/tenants/${TENANT}/overrides`]: json({ items: [override()] }),
    "GET /api/v1/platform/plans": catalog(),
    [`GET /api/v1/entitlements/admin/tenants/${TENANT}/entitlements`]: json({
      tenantId: TENANT,
      reason: "OK",
      planKey: "STARTER",
      packs: ["SECONDARY"],
      subscriptionStatus: "TRIALING",
      features: ["audit.log"],
      sources: { "audit.log": "CORE" },
      limits: { learnerTierMax: null },
      validUntil: null,
      computedAt: NOW,
    }),
    [`GET /api/v1/entitlements/admin/tenants/${TENANT}/usage`]: json({ items: [{ metric: "SMS_SENT", period: "2026-10-01", value: 42, updatedAt: NOW }] }),
    ...extra,
  });

  it("vue d'ensemble : profil, établissements, abonnement, dérogations, droits effectifs et usage", async () => {
    calls = routes(h.fetchMock, base());
    renderScreen(<TenantDetailPage tenantId={TENANT} />);
    expect(await screen.findByRole("heading", { name: "École Soleil" })).toBeTruthy();
    expect(screen.getByText("École Soleil SARL")).toBeTruthy();
    expect(screen.getByText("Soleil Primaire")).toBeTruthy();
    expect((await screen.findByLabelText(/^Offre/) as HTMLSelectElement).value).toBe("STARTER");
    const overrides = await screen.findByRole("table", { name: "Dérogations" });
    expect(within(overrides).getByText("Factures")).toBeTruthy();
    expect(within(overrides).getByText("Accorder")).toBeTruthy();
    expect(await screen.findByText("1 fonctionnalité accordée")).toBeTruthy();
    expect(await screen.findByText("SMS envoyés")).toBeTruthy();
    // Les routes d'administration d'entitlements utilisent le même client sans tenant.
    expect(calls.every((c) => c.headers.get("x-tenant") === null)).toBe(true);
  });

  it("suspension : motif obligatoire (≥ 3 caractères), confirmation, PATCH avec motif", async () => {
    calls = routes(h.fetchMock, base({ [`PATCH /api/v1/platform/tenants/${TENANT}/status`]: json({ id: TENANT, status: "suspended" }) }));
    renderScreen(<TenantDetailPage tenantId={TENANT} />);
    fireEvent.click(await screen.findByRole("button", { name: "Suspendre" }));
    const dialog = await screen.findByRole("dialog", { name: "Suspendre l'organisation ?" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Suspendre" }));
    expect(await within(dialog).findByText("Indiquez un motif de 3 caractères au moins.")).toBeTruthy();
    expect(calls.some((c) => c.method === "PATCH")).toBe(false);

    fireEvent.change(within(dialog).getByLabelText(/Motif/), { target: { value: "Impayés répétés" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Suspendre" }));
    await waitFor(() => expect(calls.some((c) => c.method === "PATCH")).toBe(true));
    expect(calls.find((c) => c.method === "PATCH")!.body).toEqual({ status: "suspended", reason: "Impayés répétés" });
  });

  it("réactivation d'une organisation suspendue : sans motif obligatoire", async () => {
    calls = routes(
      h.fetchMock,
      base({
        [`GET /api/v1/platform/tenants/${TENANT}`]: json(overview("suspended")),
        [`PATCH /api/v1/platform/tenants/${TENANT}/status`]: json({ id: TENANT, status: "active" }),
      }),
    );
    renderScreen(<TenantDetailPage tenantId={TENANT} />);
    fireEvent.click(await screen.findByRole("button", { name: "Réactiver" }));
    const dialog = await screen.findByRole("dialog", { name: "Réactiver l'organisation ?" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Réactiver" }));
    await waitFor(() => expect(calls.some((c) => c.method === "PATCH")).toBe(true));
    expect(calls.find((c) => c.method === "PATCH")!.body).toEqual({ status: "active" });
  });

  it("abonnement : offre obligatoire puis PUT avec packs et période", async () => {
    calls = routes(
      h.fetchMock,
      base({
        [`GET /api/v1/platform/tenants/${TENANT}/subscription`]: json({ subscription: null }),
        [`PUT /api/v1/platform/tenants/${TENANT}/subscription`]: json(subscription({ planKey: "PROFESSIONAL", status: "ACTIVE" })),
      }),
    );
    renderScreen(<TenantDetailPage tenantId={TENANT} />);
    expect(await screen.findByText("Aucun abonnement pour cette organisation.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Enregistrer l'abonnement" }));
    expect(await screen.findByText("Choisissez une offre.")).toBeTruthy();
    expect(calls.some((c) => c.method === "PUT")).toBe(false);

    await screen.findByRole("option", { name: "Professional" });
    fireEvent.change(screen.getByLabelText(/^Offre/), { target: { value: "PROFESSIONAL" } });
    fireEvent.click(screen.getByLabelText("Supérieur"));
    fireEvent.click(screen.getByRole("button", { name: "Enregistrer l'abonnement" }));
    await waitFor(() => expect(calls.some((c) => c.method === "PUT")).toBe(true));
    expect(calls.find((c) => c.method === "PUT")!.body).toEqual({ planKey: "PROFESSIONAL", packs: ["HIGHER"], status: "ACTIVE", endsAt: null, learnerTierMax: null });
  });

  it("dérogations : ajout avec motif, suppression confirmée", async () => {
    calls = routes(
      h.fetchMock,
      base({
        [`PUT /api/v1/platform/tenants/${TENANT}/overrides/audit.log`]: json(override("audit.log")),
        [`DELETE /api/v1/platform/tenants/${TENANT}/overrides/finance.invoices`]: noContent(),
      }),
    );
    renderScreen(<TenantDetailPage tenantId={TENANT} />);
    const form = await screen.findByRole("form", { name: "Ajouter une dérogation" });
    await within(form).findByRole("option", { name: /Journal d'audit/ });

    fireEvent.click(within(form).getByRole("button", { name: "Enregistrer la dérogation" }));
    expect(await within(form).findByText("Choisissez une fonctionnalité.")).toBeTruthy();
    fireEvent.change(within(form).getByLabelText(/Fonctionnalité/), { target: { value: "audit.log" } });
    fireEvent.change(within(form).getByLabelText(/Effet/), { target: { value: "DENY" } });
    fireEvent.change(within(form).getByLabelText(/Motif/), { target: { value: "Test" } });
    fireEvent.click(within(form).getByRole("button", { name: "Enregistrer la dérogation" }));
    expect(await within(form).findByRole("alert")).toBeTruthy();
    expect(calls.some((c) => c.method === "PUT")).toBe(false);

    fireEvent.change(within(form).getByLabelText(/Motif/), { target: { value: "Fraude suspectée" } });
    fireEvent.click(within(form).getByRole("button", { name: "Enregistrer la dérogation" }));
    await waitFor(() => expect(calls.some((c) => c.method === "PUT")).toBe(true));
    expect(calls.find((c) => c.method === "PUT")!.body).toEqual({ effect: "DENY", reason: "Fraude suspectée" });

    fireEvent.click(screen.getByRole("button", { name: "Supprimer la dérogation de Factures" }));
    const dialog = await screen.findByRole("dialog", { name: "Supprimer cette dérogation ?" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Confirmer" }));
    await waitFor(() => expect(calls.some((c) => c.method === "DELETE")).toBe(true));
  });

  it("réconciliation et organisation introuvable", async () => {
    calls = routes(h.fetchMock, base({ [`POST /api/v1/platform/tenants/${TENANT}/reconcile`]: json({ rolesCreated: 2, rolesExisting: 8, subscriptionCreated: false, foundation: null }) }));
    const { unmount } = renderScreen(<TenantDetailPage tenantId={TENANT} />);
    fireEvent.click(await screen.findByRole("button", { name: "Lancer la réconciliation" }));
    await waitFor(() => expect(calls.some((c) => c.method === "POST")).toBe(true));
    const { toast } = await import("sonner");
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Réconciliation terminée : 2 rôle(s) créé(s), abonnement inchangé."));
    unmount();

    h.fetchMock.mockReset();
    routes(h.fetchMock, { [`GET /api/v1/platform/tenants/${TENANT}`]: apiError(404, "tenancy.tenant_not_found", "Organisation introuvable.") });
    renderScreen(<TenantDetailPage tenantId={TENANT} />);
    expect(await screen.findByText("Cette organisation n'existe pas.")).toBeTruthy();
  });

  it("droits effectifs : erreur d'une section sans bloquer les autres", async () => {
    routes(h.fetchMock, base({ [`GET /api/v1/entitlements/admin/tenants/${TENANT}/usage`]: apiError(500, "INTERNAL", "Erreur.") }));
    renderScreen(<EntitlementsSection tenantId={TENANT} />);
    expect(await screen.findByText("1 fonctionnalité accordée")).toBeTruthy();
    expect(await screen.findByRole("alert")).toBeTruthy();
  });
});

describe("plans et catalogue", () => {
  let calls: RecordedCall[];
  beforeEach(() => h.fetchMock.mockReset());

  it("liste plans, packs et fonctionnalités", async () => {
    calls = routes(h.fetchMock, { "GET /api/v1/platform/plans": catalog() });
    renderScreen(<PlansPage />);
    expect(await screen.findByRole("heading", { name: "Starter" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Professional" })).toBeTruthy();
    expect(screen.getByText("2 fonctionnalités · Ordre : 20")).toBeTruthy();
    expect(screen.getByRole("table", { name: "Packs vendables" })).toBeTruthy();
    const features = screen.getByRole("table", { name: "Catalogue des fonctionnalités" });
    expect(within(features).getByText("Retirée")).toBeTruthy();
  });

  it("création d'un plan : clé validée, PUT avec le corps du contrat", async () => {
    calls = routes(h.fetchMock, {
      "GET /api/v1/platform/plans": catalog(),
      "PUT /api/v1/platform/plans/ENTERPRISE": json({ key: "ENTERPRISE", label: "Enterprise", description: null, sortOrder: 100, active: true, featureKeys: [] }),
    });
    renderScreen(<PlansPage />);
    fireEvent.click(await screen.findByRole("button", { name: /Nouveau plan/ }));
    const dialog = await screen.findByRole("dialog", { name: "Nouveau plan" });
    fireEvent.change(within(dialog).getByLabelText(/^Clé/), { target: { value: "enterprise" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Enregistrer" }));
    expect((await within(dialog).findAllByRole("alert")).length).toBeGreaterThan(0);
    expect(calls.some((c) => c.method === "PUT")).toBe(false);

    fireEvent.change(within(dialog).getByLabelText(/Libellé/), { target: { value: "Enterprise" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Enregistrer" }));
    await waitFor(() => expect(calls.some((c) => c.method === "PUT")).toBe(true));
    expect(calls.find((c) => c.method === "PUT")!.body).toEqual({ label: "Enterprise", description: null, sortOrder: 100, active: true });
  });

  it("fonctionnalités d'un plan : recherche, sélection, PUT de la liste triée", async () => {
    calls = routes(h.fetchMock, {
      "GET /api/v1/platform/plans": catalog(),
      "PUT /api/v1/platform/plans/STARTER/features": json({ key: "STARTER", label: "Starter", description: null, sortOrder: 10, active: true, featureKeys: ["audit.log", "finance.invoices"] }),
    });
    renderScreen(<PlansPage />);
    fireEvent.click(await screen.findByRole("button", { name: "Fonctionnalités du plan Starter" }));
    const dialog = await screen.findByRole("dialog", { name: "Fonctionnalités du plan" });
    expect(within(dialog).getByText("1 sélectionnée")).toBeTruthy();
    fireEvent.change(within(dialog).getByLabelText("Rechercher une fonctionnalité"), { target: { value: "factures" } });
    expect(within(dialog).queryByText("Journal d'audit")).toBeNull();
    fireEvent.click(within(dialog).getByRole("checkbox", { name: /Factures/ }));
    fireEvent.click(within(dialog).getByRole("button", { name: "Enregistrer les fonctionnalités" }));
    await waitFor(() => expect(calls.some((c) => c.method === "PUT")).toBe(true));
    expect(calls.find((c) => c.method === "PUT")!.body).toEqual({ featureKeys: ["audit.log", "finance.invoices"] });
  });
});

describe("journal de plateforme", () => {
  beforeEach(() => h.fetchMock.mockReset());

  it("API antérieure à la route de lecture (404) : explication, pas une panne", async () => {
    routes(h.fetchMock, {});
    renderScreen(<PlatformAuditPage />);
    expect(await screen.findByText("Le journal de plateforme n'est pas disponible sur ce serveur")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Réessayer" })).toBeNull();
  });

  it("route disponible : liste des actions des opérateurs", async () => {
    routes(h.fetchMock, {
      "GET /api/v1/platform/audit/logs": json({
        items: [
          {
            id: U(1),
            tenantId: TENANT,
            seq: 1,
            occurredAt: NOW,
            recordedAt: NOW,
            actorType: "superAdmin",
            actorId: U(9),
            impersonatedBy: null,
            action: "platform.tenant.provisioned",
            entity: "tenant",
            entityId: TENANT,
            diff: null,
            ip: null,
            device: null,
            requestId: null,
            reason: null,
            severity: "notice",
            hash: "a".repeat(64),
          },
        ],
        nextCursor: null,
      }),
    });
    renderScreen(<PlatformAuditPage />);
    const table = await screen.findByRole("table", { name: "Entrées du journal de plateforme" });
    expect(within(table).getByText("platform.tenant.provisioned")).toBeTruthy();
    expect(within(table).getByText("Opérateur plateforme")).toBeTruthy();
  });
});
