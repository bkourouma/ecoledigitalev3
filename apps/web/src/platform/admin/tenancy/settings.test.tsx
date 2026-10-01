// @vitest-environment jsdom
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Campus, Institution, OnboardingState, TenantProfile } from "@ecoledigitale/contracts/v2/tenancy";
import { apiError, json, noContent, renderScreen, routes, type RecordedCall } from "@/platform/admin/test-utils";
import { InstitutionsPage } from "./InstitutionsPage";
import { OnboardingPage } from "./OnboardingPage";
import { ProfilePage } from "./ProfilePage";
import { SettingsNav } from "./SettingsNav";
import { groupFeatures, humanBytes, SubscriptionPage } from "./SubscriptionPage";
import {
  diffProfile,
  toFormState,
  validateCampusCreate,
  validateCampusUpdate,
  validateInstitutionCreate,
  validateInstitutionUpdate,
  validateProfilePatch,
} from "./profile";

const h = vi.hoisted(() => ({ fetchMock: vi.fn() }));
vi.mock("@/platform/api/default-client", async () => (await import("@/platform/admin/test-utils")).defaultClientModule(h.fetchMock));
vi.mock("next/navigation", () => ({ usePathname: () => "/v2/settings/institutions", useRouter: () => ({ push: vi.fn(), replace: vi.fn() }) }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const U = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const NOW = "2026-10-01T10:00:00.000Z";
const TENANT = U(900);

const profile = (over: Partial<TenantProfile> = {}): TenantProfile => ({
  tenantId: TENANT,
  slug: "ipam",
  legalName: "IPAM SARL",
  tradeName: "IPAM Académie",
  countryCode: "CI",
  contactName: "Awa Koné",
  contactEmail: "awa@ipam.ci",
  contactPhone: "+225 01 02 03 04",
  address: "Cocody, Abidjan",
  branding: { logoUrl: "https://cdn.example.org/logo.png", primaryColor: "#1A73E8", secondaryColor: null, customDomain: null },
  createdAt: NOW,
  updatedAt: NOW,
  ...over,
});

const institution = (n: number, over: Partial<Institution> = {}): Institution => ({
  id: U(n),
  tenantId: TENANT,
  code: "lycee",
  name: "Lycée Central",
  pack: "SECONDARY",
  educationSystem: "ci-secondaire",
  countryCode: "CI",
  status: "ACTIVE",
  createdAt: NOW,
  updatedAt: NOW,
  ...over,
});

const campus = (n: number, over: Partial<Campus> = {}): Campus => ({
  id: U(n),
  tenantId: TENANT,
  institutionId: U(10),
  code: "principal",
  name: "Campus principal",
  address: null,
  city: "Abidjan",
  phone: null,
  isDefault: true,
  status: "ACTIVE",
  createdAt: NOW,
  updatedAt: NOW,
  ...over,
});

const permissions = (...keys: string[]) =>
  json({ tenantId: TENANT, userId: U(901), mfa: true, permissions: keys.map((key) => ({ key, sensitive: false, scopes: [{ type: "tenant" }] })), requiresMfa: [] });

const MANAGE = ["tenancy.institution.read", "tenancy.institution.manage", "tenancy.campus.manage", "entitlements.read"];

describe("formulaires du profil (fonctions pures)", () => {
  it("n'envoie que les champs modifiés ; un champ facultatif vidé devient null", () => {
    const p = profile();
    const form = toFormState(p);
    expect(diffProfile(form, p)).toEqual({});
    expect(diffProfile({ ...form, tradeName: "Nouveau nom", contactName: "  ", primaryColor: "#000000" }, p)).toEqual({
      tradeName: "Nouveau nom",
      contactName: null,
      primaryColor: "#000000",
    });
  });

  it("valide avec les schémas du contrat (messages français du contrat)", () => {
    expect(validateProfilePatch({ primaryColor: "bleu" }).errors.primaryColor).toContain("Couleur hexadécimale");
    expect(validateProfilePatch({ customDomain: "Ecole.Example" }).errors.customDomain).toBeTruthy();
    expect(validateProfilePatch({ contactEmail: "pas-un-mail" }).errors.contactEmail).toBeTruthy();
    const ok = validateProfilePatch({ primaryColor: "#112233", logoUrl: null });
    expect(ok.data).toEqual({ primaryColor: "#112233", logoUrl: null });
  });

  it("établissements et campus : création et modification validées par le contrat", () => {
    expect(validateInstitutionCreate({ name: "A", pack: "", code: "", educationSystem: "" }).errors).toMatchObject({ name: expect.any(String), pack: expect.any(String) });
    expect(validateInstitutionCreate({ name: "Lycée Nord", pack: "SECONDARY", code: "", educationSystem: "" }).data).toEqual({ name: "Lycée Nord", pack: "SECONDARY" });
    expect(validateInstitutionCreate({ name: "Lycée Nord", pack: "SECONDARY", code: "Code Invalide", educationSystem: "" }).errors.code).toBeTruthy();

    const inst = institution(10);
    expect(validateInstitutionUpdate({ name: inst.name, educationSystem: inst.educationSystem, status: inst.status }, inst)).toEqual({ data: null, errors: {} });
    expect(validateInstitutionUpdate({ name: "X", educationSystem: inst.educationSystem, status: "SUSPENDED" }, inst).errors.name).toBeTruthy();
    expect(validateInstitutionUpdate({ name: "Lycée Sud", educationSystem: inst.educationSystem, status: "SUSPENDED" }, inst).data).toEqual({ name: "Lycée Sud", status: "SUSPENDED" });

    expect(validateCampusCreate({ name: "N", code: "", address: "", city: "", phone: "" }).errors.name).toBeTruthy();
    expect(validateCampusCreate({ name: "Campus Nord", code: "", address: "", city: "Bouaké", phone: "abc" }).errors.phone).toBeTruthy();
    const c = campus(20);
    expect(validateCampusUpdate({ name: c.name, code: c.code, address: "", city: "Abidjan", phone: "", status: "ACTIVE" }, c).data).toBeNull();
    expect(validateCampusUpdate({ name: c.name, code: c.code, address: "", city: "", phone: "", status: "ARCHIVED" }, c).data).toEqual({ city: null, status: "ARCHIVED" });
  });
});

describe("abonnement (fonctions pures)", () => {
  it("taille lisible et regroupement des fonctionnalités", () => {
    expect(humanBytes(0)).toEqual({ value: 0, unit: "o" });
    expect(humanBytes(1536)).toEqual({ value: 1.5, unit: "Ko" });
    expect(humanBytes(5 * 1024 ** 3)).toEqual({ value: 5, unit: "Go" });
    expect(groupFeatures(["finance.online-payment", "audit.log", "finance.invoices"])).toEqual([
      { module: "audit", keys: ["audit.log"] },
      { module: "finance", keys: ["finance.invoices", "finance.online-payment"] },
    ]);
  });
});

describe("SettingsNav", () => {
  it("marque la section la plus spécifique comme page courante", () => {
    renderScreen(<SettingsNav activePath="/v2/settings/onboarding" />);
    expect(screen.getByRole("link", { name: "Mise en service" }).getAttribute("aria-current")).toBe("page");
    expect(screen.getByRole("link", { name: "Profil et marque" }).getAttribute("aria-current")).toBeNull();
  });
  it("la racine active le profil", () => {
    renderScreen(<SettingsNav activePath="/v2/settings" />);
    expect(screen.getByRole("link", { name: "Profil et marque" }).getAttribute("aria-current")).toBe("page");
  });
});

describe("profil et marque", () => {
  let calls: RecordedCall[];
  beforeEach(() => h.fetchMock.mockReset());

  const base = (held = MANAGE) => ({
    "GET /api/v1/tenancy/profile": json(profile()),
    "GET /api/v1/tenancy/countries": json({
      items: [
        { code: "CI", name: "Côte d'Ivoire", currencyCode: "XOF", currencyExponent: 0, locale: "fr-CI", timezone: "Africa/Abidjan", phonePrefix: "+225", educationSystem: "ci" },
        { code: "SN", name: "Sénégal", currencyCode: "XOF", currencyExponent: 0, locale: "fr-SN", timezone: "Africa/Dakar", phonePrefix: "+221", educationSystem: "sn" },
      ],
    }),
    "GET /api/v1/rbac/me/permissions": permissions(...held),
  });

  it("préremplit le formulaire, n'active « Enregistrer » qu'après modification et n'envoie que le changement", async () => {
    calls = routes(h.fetchMock, { ...base(), "PATCH /api/v1/tenancy/profile": json(profile({ tradeName: "IPAM Campus", updatedAt: "2026-10-02T00:00:00.000Z" })) });
    renderScreen(<ProfilePage />);
    const trade = (await screen.findByLabelText(/Nom commercial/)) as HTMLInputElement;
    expect(trade.value).toBe("IPAM Académie");
    // Le bouton n'apparaît qu'une fois la permission de gestion connue.
    const save = (await screen.findByRole("button", { name: "Enregistrer le profil" })) as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    await waitFor(() => expect(screen.getByLabelText(/Pays/).tagName).toBe("SELECT"));

    fireEvent.change(trade, { target: { value: "IPAM Campus" } });
    expect(save.disabled).toBe(false);
    fireEvent.click(save);
    await waitFor(() => expect(calls.some((c) => c.method === "PATCH")).toBe(true));
    expect(calls.find((c) => c.method === "PATCH")!.body).toEqual({ tradeName: "IPAM Campus" });
    const { toast } = await import("sonner");
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Profil enregistré."));
  });

  it("couleur invalide : message du contrat, aucun appel ; l'aperçu reprend les couleurs valides", async () => {
    calls = routes(h.fetchMock, base());
    renderScreen(<ProfilePage />);
    const primary = (await screen.findByLabelText(/^Couleur principale/)) as HTMLInputElement;
    fireEvent.change(primary, { target: { value: "bleu" } });
    fireEvent.click(await screen.findByRole("button", { name: "Enregistrer le profil" }));
    expect(await screen.findByText(/Couleur hexadécimale attendue/)).toBeTruthy();
    expect(calls.some((c) => c.method === "PATCH")).toBe(false);

    fireEvent.change(primary, { target: { value: "#ff0000" } });
    const preview = screen.getByRole("group", { name: "Aperçu" });
    const bar = preview.querySelector("[style*='background-color']") as HTMLElement;
    expect(bar.style.backgroundColor).toBe("rgb(255, 0, 0)");
  });

  it("erreur de validation du serveur restituée sur le champ", async () => {
    calls = routes(h.fetchMock, {
      ...base(),
      "PATCH /api/v1/tenancy/profile": apiError(400, "VALIDATION_FAILED", "Données invalides.", [{ path: ["customDomain"], message: "Domaine déjà utilisé." }]),
    });
    renderScreen(<ProfilePage />);
    const domain = await screen.findByLabelText(/Domaine personnalisé/);
    fireEvent.change(domain, { target: { value: "ecole.example.org" } });
    fireEvent.click(screen.getByRole("button", { name: "Enregistrer le profil" }));
    expect(await screen.findByText("Domaine déjà utilisé.")).toBeTruthy();
  });

  it("sans droit de gestion : champs en lecture seule et pas de bouton", async () => {
    calls = routes(h.fetchMock, base(["tenancy.institution.read"]));
    renderScreen(<ProfilePage />);
    const trade = (await screen.findByLabelText(/Nom commercial/)) as HTMLInputElement;
    await screen.findByText(/consulter ces informations mais pas les modifier/);
    expect(trade.readOnly).toBe(true);
    expect(screen.queryByRole("button", { name: "Enregistrer le profil" })).toBeNull();
  });

  it("erreur de chargement avec « Réessayer »", async () => {
    let attempt = 0;
    routes(h.fetchMock, {
      ...base(),
      "GET /api/v1/tenancy/profile": () => {
        attempt += 1;
        return attempt === 1 ? apiError(403, "FORBIDDEN", "Interdit.") : json(profile());
      },
    });
    renderScreen(<ProfilePage />);
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("Interdit.");
    fireEvent.click(within(alert).getByRole("button", { name: "Réessayer" }));
    expect(await screen.findByLabelText(/Raison sociale/)).toBeTruthy();
  });
});

describe("établissements et campus", () => {
  let calls: RecordedCall[];
  beforeEach(() => h.fetchMock.mockReset());

  const base = (extra: Record<string, Response | ((c: RecordedCall) => Response)> = {}) => ({
    "GET /api/v1/tenancy/institutions": json({ items: [institution(10), institution(11, { name: "École primaire Nord", pack: "PRIMARY", status: "SUSPENDED", code: "primaire" })] }),
    [`GET /api/v1/tenancy/institutions/${U(10)}/campuses`]: json({ items: [campus(20), campus(21, { name: "Annexe", code: "annexe", isDefault: false, city: null })] }),
    "GET /api/v1/rbac/me/permissions": permissions(...MANAGE),
    ...extra,
  });

  it("liste les établissements avec pack et statut", async () => {
    calls = routes(h.fetchMock, base());
    renderScreen(<InstitutionsPage />);
    const list = await screen.findByRole("list", { name: "Établissements" });
    expect(within(list).getByText("Lycée Central")).toBeTruthy();
    expect(within(list).getByText("Secondaire")).toBeTruthy();
    expect(within(list).getByText("Suspendu")).toBeTruthy();
    expect(within(list).getByText(/Code : primaire/)).toBeTruthy();
  });

  it("état vide invitant à créer le premier établissement", async () => {
    calls = routes(h.fetchMock, base({ "GET /api/v1/tenancy/institutions": json({ items: [] }) }));
    renderScreen(<InstitutionsPage />);
    expect(await screen.findByText("Aucun établissement pour le moment.")).toBeTruthy();
  });

  it("création : validation du contrat, puis POST ; erreur d'unicité du code restituée", async () => {
    calls = routes(
      h.fetchMock,
      base({ "POST /api/v1/tenancy/institutions": apiError(409, "tenancy.code_taken", "Ce code est déjà utilisé.") }),
    );
    renderScreen(<InstitutionsPage />);
    fireEvent.click(await screen.findByRole("button", { name: /Nouvel établissement/ }));
    const dialog = await screen.findByRole("dialog", { name: "Nouvel établissement" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Créer l'établissement" }));
    expect((await within(dialog).findAllByRole("alert")).length).toBeGreaterThan(0);
    expect(calls.some((c) => c.method === "POST")).toBe(false);

    fireEvent.change(within(dialog).getByLabelText(/Nom de l'établissement/), { target: { value: "Lycée Sud" } });
    fireEvent.change(within(dialog).getByLabelText(/^Pack/), { target: { value: "SECONDARY" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Créer l'établissement" }));
    expect(await within(dialog).findByText("Ce code est déjà utilisé.")).toBeTruthy();
    expect(calls.find((c) => c.method === "POST")!.body).toEqual({ name: "Lycée Sud", pack: "SECONDARY" });
  });

  it("modification : n'envoie que le champ changé", async () => {
    calls = routes(h.fetchMock, base({ [`PATCH /api/v1/tenancy/institutions/${U(10)}`]: json(institution(10, { status: "SUSPENDED" })) }));
    renderScreen(<InstitutionsPage />);
    fireEvent.click(await screen.findByRole("button", { name: "Modifier Lycée Central" }));
    const dialog = await screen.findByRole("dialog", { name: "Modifier l'établissement" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Enregistrer" }));
    expect(await within(dialog).findByText("Aucune modification.")).toBeTruthy();
    expect(calls.some((c) => c.method === "PATCH")).toBe(false);

    fireEvent.change(within(dialog).getByLabelText("Statut"), { target: { value: "SUSPENDED" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Enregistrer" }));
    await waitFor(() => expect(calls.some((c) => c.method === "PATCH")).toBe(true));
    expect(calls.find((c) => c.method === "PATCH")!.body).toEqual({ status: "SUSPENDED" });
  });

  it("campus : affichage à la demande, création, campus par défaut, suppression protégée", async () => {
    let deletes = 0;
    calls = routes(
      h.fetchMock,
      base({
        [`POST /api/v1/tenancy/institutions/${U(10)}/campuses`]: json(campus(22, { name: "Campus Est", isDefault: false }), { status: 201 }),
        [`PATCH /api/v1/tenancy/campuses/${U(21)}`]: json(campus(21, { isDefault: true })),
        [`DELETE /api/v1/tenancy/campuses/${U(20)}`]: () => {
          deletes += 1;
          return apiError(409, "tenancy.campus_default_protected", "Le campus par défaut ne peut pas être supprimé : désignez d'abord un autre campus par défaut.");
        },
      }),
    );
    renderScreen(<InstitutionsPage />);
    await screen.findByRole("list", { name: "Établissements" });
    expect(calls.some((c) => c.path.endsWith("/campuses"))).toBe(false);

    const toggle = screen.getByRole("button", { name: "Voir les campus de Lycée Central" });
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(toggle);
    const table = await screen.findByRole("table", { name: "Campus de Lycée Central" });
    expect(within(table).getByText("Par défaut")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Masquer les campus de Lycée Central" }).getAttribute("aria-expanded")).toBe("true");

    // Nouveau campus.
    fireEvent.click(screen.getByRole("button", { name: /Nouveau campus/ }));
    const dialog = await screen.findByRole("dialog", { name: "Nouveau campus" });
    fireEvent.change(within(dialog).getByLabelText(/Nom du campus/), { target: { value: "Campus Est" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Enregistrer" }));
    await waitFor(() => expect(calls.some((c) => c.method === "POST")).toBe(true));
    expect(calls.find((c) => c.method === "POST")!.body).toEqual({ name: "Campus Est" });

    // Promotion en campus par défaut.
    fireEvent.click(within(table).getByRole("button", { name: "Définir Annexe comme campus par défaut" }));
    await waitFor(() => expect(calls.some((c) => c.method === "PATCH")).toBe(true));
    expect(calls.find((c) => c.method === "PATCH")!.body).toEqual({ isDefault: true });

    // Suppression du campus par défaut refusée : message de l'API.
    fireEvent.click(within(table).getByRole("button", { name: "Supprimer le campus Campus principal" }));
    const confirm = await screen.findByRole("dialog", { name: "Supprimer ce campus ?" });
    fireEvent.click(within(confirm).getByRole("button", { name: "Confirmer" }));
    expect(await within(confirm).findByText(/désignez d'abord un autre campus par défaut/)).toBeTruthy();
    expect(deletes).toBe(1);
  });

  it("sans droit de gestion : pas de création ni d'actions", async () => {
    calls = routes(h.fetchMock, base({ "GET /api/v1/rbac/me/permissions": permissions("tenancy.institution.read") }));
    renderScreen(<InstitutionsPage />);
    await screen.findByRole("list", { name: "Établissements" });
    await screen.findByText(/consulter ces informations mais pas les modifier/);
    expect(screen.queryByRole("button", { name: /Nouvel établissement/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /Modifier/ })).toBeNull();
    void noContent;
  });
});

describe("mise en service (onboarding)", () => {
  let calls: RecordedCall[];
  beforeEach(() => h.fetchMock.mockReset());

  const step = (key: string, order: number, over: Record<string, unknown> = {}) => ({
    key,
    order,
    optional: false,
    status: "PENDING",
    available: false,
    completedAt: null,
    ...over,
  });

  const state = (over: Partial<OnboardingState> = {}): OnboardingState =>
    ({
      status: "IN_PROGRESS",
      currentStep: "ACADEMIC_YEAR",
      progress: { done: 5, total: 11, percent: 45 },
      steps: [
        step("ACCOUNT", 0, { status: "COMPLETED", completedAt: NOW }),
        step("ACADEMIC_YEAR", 5, { available: true }),
        step("STUDENT_IMPORT", 6, { optional: true, available: true }),
        step("CLASSES", 7),
        step("GO_LIVE", 10),
      ],
      ...over,
    }) as unknown as OnboardingState;

  const base = (extra: Record<string, Response | ((c: RecordedCall) => Response)> = {}) => ({
    "GET /api/v1/tenancy/onboarding": json(state()),
    "GET /api/v1/rbac/me/permissions": permissions(...MANAGE),
    ...extra,
  });

  it("progression accessible, étapes avec statut, étape bloquée sans action", async () => {
    calls = routes(h.fetchMock, base());
    renderScreen(<OnboardingPage />);
    const bar = await screen.findByRole("progressbar", { name: "Progression de la mise en service" });
    expect(bar.getAttribute("aria-valuenow")).toBe("45");
    expect(screen.getByText("Progression : 5 étape(s) sur 11")).toBeTruthy();
    expect(screen.getByText("Prochaine étape : Année académique")).toBeTruthy();
    const steps = screen.getByRole("list", { name: "Étapes de la mise en service" });
    expect(within(steps).getAllByRole("listitem")).toHaveLength(5);
    expect(within(steps).getByText("Terminée")).toBeTruthy();
    expect(within(steps).getAllByText("Disponible une fois les étapes précédentes résolues.", { selector: "p" })).toHaveLength(2);
    // Seules les étapes disponibles ont des actions ; l'ignorance est réservée aux étapes facultatives.
    expect(await screen.findByRole("button", { name: "Marquer l'étape « Année académique » comme terminée" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Ignorer l'étape « Année académique »" })).toBeNull();
    expect(screen.getByRole("button", { name: "Ignorer l'étape « Import des élèves »" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Marquer l'étape « Classes » comme terminée" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Passer en production" })).toBeNull();
  });

  it("terminer et ignorer une étape appellent les bonnes routes", async () => {
    calls = routes(
      h.fetchMock,
      base({
        "POST /api/v1/tenancy/onboarding/steps/ACADEMIC_YEAR/complete": json(state()),
        "POST /api/v1/tenancy/onboarding/steps/STUDENT_IMPORT/skip": json(state()),
      }),
    );
    renderScreen(<OnboardingPage />);
    fireEvent.click(await screen.findByRole("button", { name: "Marquer l'étape « Année académique » comme terminée" }));
    await waitFor(() => expect(calls.some((c) => c.path.endsWith("/ACADEMIC_YEAR/complete"))).toBe(true));
    fireEvent.click(await screen.findByRole("button", { name: "Ignorer l'étape « Import des élèves »" }));
    await waitFor(() => expect(calls.some((c) => c.path.endsWith("/STUDENT_IMPORT/skip"))).toBe(true));
  });

  it("GO LIVE : confirmation obligatoire avant l'appel ; refus de l'API restitué", async () => {
    const ready = state({
      currentStep: "GO_LIVE",
      progress: { done: 10, total: 11, percent: 91 },
      steps: [step("ACCOUNT", 0, { status: "COMPLETED" }), step("GO_LIVE", 10, { available: true })],
    } as Partial<OnboardingState>);
    calls = routes(
      h.fetchMock,
      base({
        "GET /api/v1/tenancy/onboarding": json(ready),
        "POST /api/v1/tenancy/onboarding/steps/GO_LIVE/complete": apiError(409, "tenancy.onboarding_blocked", "Des étapes obligatoires restent à traiter."),
      }),
    );
    renderScreen(<OnboardingPage />);
    fireEvent.click(await screen.findByRole("button", { name: "Passer en production" }));
    const dialog = await screen.findByRole("dialog", { name: "Passer en production ?" });
    expect(calls.some((c) => c.method === "POST")).toBe(false);
    expect(within(dialog).getByText(/Cette action est définitive/)).toBeTruthy();
    fireEvent.click(within(dialog).getByRole("button", { name: "Passer en production" }));
    expect(await within(dialog).findByText("Des étapes obligatoires restent à traiter.")).toBeTruthy();
  });

  it("établissement en production : message de réussite et plus aucune action", async () => {
    const live = state({
      status: "LIVE",
      currentStep: null,
      progress: { done: 11, total: 11, percent: 100 },
      steps: [step("ACCOUNT", 0, { status: "COMPLETED" }), step("GO_LIVE", 10, { status: "COMPLETED", completedAt: NOW })],
    } as Partial<OnboardingState>);
    calls = routes(h.fetchMock, base({ "GET /api/v1/tenancy/onboarding": json(live) }));
    renderScreen(<OnboardingPage />);
    expect(await screen.findByText("La mise en service est terminée. Toutes les fonctionnalités de votre offre sont disponibles.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Marquer|Ignorer|Passer/ })).toBeNull();
  });

  it("sans droit de gestion : consultation seule", async () => {
    calls = routes(h.fetchMock, base({ "GET /api/v1/rbac/me/permissions": permissions("tenancy.institution.read") }));
    renderScreen(<OnboardingPage />);
    await screen.findByRole("progressbar");
    await waitFor(() => expect(calls.some((c) => c.path.includes("me/permissions"))).toBe(true));
    expect(screen.queryByRole("button", { name: /Marquer/ })).toBeNull();
  });
});

describe("abonnement et usage", () => {
  beforeEach(() => h.fetchMock.mockReset());

  const effective = (over: Record<string, unknown> = {}) => ({
    tenantId: TENANT,
    reason: "OK",
    planKey: "PROFESSIONAL",
    packs: ["SECONDARY", "HIGHER"],
    subscriptionStatus: "ACTIVE",
    features: ["audit.log", "finance.invoices"],
    sources: { "audit.log": "CORE", "finance.invoices": "PLAN" },
    limits: { learnerTierMax: 1000 },
    validUntil: "2027-01-01T00:00:00.000Z",
    computedAt: NOW,
    ...over,
  });

  it("résumé de l'offre, packs, tranche, fonctionnalités par module, usage formaté", async () => {
    routes(h.fetchMock, {
      "GET /api/v1/entitlements/me": json(effective()),
      "GET /api/v1/entitlements/me/usage": json({
        items: [
          { metric: "ACTIVE_LEARNERS", period: "2026-10-01", value: 1234, updatedAt: NOW },
          { metric: "STORAGE_BYTES", period: "2026-10-01", value: 1536 * 1024, updatedAt: NOW },
        ],
      }),
    });
    renderScreen(<SubscriptionPage />);
    expect(await screen.findByText("PROFESSIONAL")).toBeTruthy();
    expect(screen.getByText("Actif")).toBeTruthy();
    expect(screen.getByText("Secondaire")).toBeTruthy();
    expect(screen.getByText("Supérieur")).toBeTruthy();
    expect(screen.getByText(/jusqu'à/).textContent).toMatch(/1\D?000/);
    expect(screen.getByText("2 fonctionnalités")).toBeTruthy();
    const usage = await screen.findByRole("table", { name: "Compteurs d'usage" });
    expect(within(usage).getByText("Apprenants actifs")).toBeTruthy();
    expect(within(usage).getByText(/1\D?234/)).toBeTruthy();
    expect(within(usage).getByText(/1,5 Mo/)).toBeTruthy();
    expect(within(usage).getAllByText(/octobre 2026/)).toHaveLength(2);
  });

  it("abonnement inactif : avertissement explicite ; aucun usage : état vide", async () => {
    routes(h.fetchMock, {
      "GET /api/v1/entitlements/me": json(effective({ reason: "SUBSCRIPTION_INACTIVE", subscriptionStatus: "EXPIRED", planKey: null, packs: [], limits: { learnerTierMax: null }, validUntil: null })),
      "GET /api/v1/entitlements/me/usage": json({ items: [] }),
    });
    renderScreen(<SubscriptionPage />);
    expect(await screen.findByText("L'abonnement n'est plus actif : seules les fonctionnalités de base sont accordées.")).toBeTruthy();
    expect(screen.getByText("Aucune offre active")).toBeTruthy();
    expect(screen.getByText("Illimitée")).toBeTruthy();
    expect(await screen.findByText("Aucun usage mesuré pour le moment.")).toBeTruthy();
  });

  it("endpoint refusé : erreur avec réessai", async () => {
    routes(h.fetchMock, {
      "GET /api/v1/entitlements/me": apiError(403, "FORBIDDEN", "Permission entitlements.read requise."),
      "GET /api/v1/entitlements/me/usage": apiError(403, "FORBIDDEN", "Permission entitlements.read requise."),
    });
    renderScreen(<SubscriptionPage />);
    expect((await screen.findAllByRole("alert")).length).toBeGreaterThan(0);
    expect(screen.getAllByText("Permission entitlements.read requise.").length).toBeGreaterThan(0);
  });
});
