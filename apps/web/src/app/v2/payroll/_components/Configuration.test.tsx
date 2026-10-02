// @vitest-environment jsdom
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { accessRoutes, setTestApi } from "@/platform/test/api-mock";
import { json, renderWithProviders } from "@/platform/test/render";
import { node as curriculumNode, uuid, version as curriculumVersion } from "../../_test/fixtures";
import { staffSummary } from "../../_test/fixtures-people";
import { config, pid, rate, settings } from "../../_test/fixtures-payroll";
import { ConfigsScreen, RatesScreen, SettingsScreen } from "./Configuration";

vi.mock("@/platform/api/default-client", async () => (await import("@/platform/test/api-mock")).defaultClientModule);
vi.mock("next/link", () => ({ default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a> }));
vi.mock("next/navigation", () => ({ usePathname: () => "/v2/payroll/configuration", useRouter: () => ({ push: vi.fn(), replace: vi.fn() }) }));

const MANAGE = ["payroll.config.read", "payroll.config.manage", "payroll.rate.read", "payroll.rate.manage", "payroll.settings.manage"];
const staff = { items: [staffSummary({ id: pid(20), displayName: "KOUASSI Marc" })], total: 1, limit: 20, offset: 0 };
const staffDetail = { [`GET /api/v1/people/staff/${pid(20)}`]: { ...staffSummary({ id: pid(20), displayName: "KOUASSI Marc" }), otherNames: null, sex: null, email: null, phone: null, phoneAlt: null, addressLine: null, city: null, hiredOn: null, leftOn: null, primaryCampusId: null, affiliations: [], portalAccount: "NONE", externalRef: null, createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" } };
const posts = (api: ReturnType<typeof setTestApi>) => api.calls.filter((c) => c.method === "POST");

describe("ConfigsScreen", () => {
  const base = { ...accessRoutes(MANAGE), "GET /api/v1/people/staff": staff, ...staffDetail };

  it("liste : type, salaires et tarif en francs entiers, seuil et majoration, validité", async () => {
    setTestApi({ ...base, "GET /api/v1/payroll/configs": { items: [config()], total: 1 } });
    renderWithProviders(<ConfigsScreen />);
    const table = await screen.findByRole("table", { name: "Configurations de paie" });
    expect(await within(table).findByText("KOUASSI Marc")).toBeTruthy();
    expect(within(table).getByText("Mixte")).toBeTruthy();
    expect(within(table).getAllByText(/^200\D000\sF\sCFA$/).length).toBeGreaterThan(0);
    expect(within(table).getByText(/au-delà de 40 h\/semaine, ×1,5/)).toBeTruthy();
  });

  it("création mixte : montants entiers, 0 accepté comme taux, majoration 1,5 -> 1500, seuil en minutes", async () => {
    const api = setTestApi({ ...base, "GET /api/v1/payroll/configs": { items: [], total: 0 }, "POST /api/v1/payroll/configs": () => json(config(), { status: 201 }) });
    renderWithProviders(<ConfigsScreen />);
    fireEvent.click(await screen.findByRole("button", { name: "Nouvelle configuration" }));
    const dialog = await screen.findByRole("dialog");
    const staffInput = within(dialog).getByLabelText(/^Enseignant/);
    fireEvent.focus(staffInput);
    fireEvent.click(await within(dialog).findByRole("option", { name: /KOUASSI Marc/ }));
    fireEvent.change(within(dialog).getByLabelText(/^Type de rémunération/), { target: { value: "MIXED" } });
    fireEvent.change(within(dialog).getByLabelText(/^Salaire mensuel/), { target: { value: "200 000" } });
    fireEvent.change(within(dialog).getByLabelText(/^Tarif horaire par défaut/), { target: { value: "0" } });
    fireEvent.change(within(dialog).getByLabelText(/^Seuil d'heures supplémentaires/), { target: { value: "2400" } });
    fireEvent.change(within(dialog).getByLabelText(/^Majoration des heures supplémentaires/), { target: { value: "1,5" } });
    fireEvent.change(within(dialog).getByLabelText(/^En vigueur à partir du/), { target: { value: "2026-09-01" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Enregistrer" }));
    await screen.findByText("La configuration a été enregistrée.");
    expect(posts(api)[0]!.body).toEqual({
      staffId: pid(20),
      type: "MIXED",
      monthlySalary: 200000,
      annualSalary: null,
      defaultHourlyRate: 0,
      overtimeThresholdMinutes: 2400,
      overtimeMultiplierPermille: 1500,
      effectiveFrom: "2026-09-01",
      effectiveTo: null,
    });
  });

  it("majoration hors bornes et salaire décimal refusés sans appel", async () => {
    const api = setTestApi({ ...base, "GET /api/v1/payroll/configs": { items: [], total: 0 } });
    renderWithProviders(<ConfigsScreen />);
    fireEvent.click(await screen.findByRole("button", { name: "Nouvelle configuration" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText(/^Salaire mensuel/), { target: { value: "200000.5" } });
    fireEvent.change(within(dialog).getByLabelText(/^Majoration des heures supplémentaires/), { target: { value: "7" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Enregistrer" }));
    expect((await within(dialog).findAllByText("Le montant est un entier en francs : pas de virgule ni de point.")).length).toBeGreaterThan(0);
    expect(within(dialog).getByText("Le coefficient doit être compris entre 1 et 5.")).toBeTruthy();
    expect(posts(api)).toHaveLength(0);
  });

  it("modification : PUT sans identifiant d'enseignant ; chevauchement refusé par l'API affiché", async () => {
    const api = setTestApi({
      ...base,
      "GET /api/v1/payroll/configs": { items: [config()], total: 1 },
      [`PUT /api/v1/payroll/configs/${pid(60)}`]: () => json({ code: "payroll.config_overlap", message: "Une autre configuration de paie couvre déjà ces dates pour cet enseignant." }, { status: 409 }),
    });
    renderWithProviders(<ConfigsScreen />);
    fireEvent.click(await screen.findByRole("button", { name: /Modifier/ }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText(/^Salaire mensuel/), { target: { value: "210000" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Enregistrer" }));
    expect(await within(dialog).findByText("Une autre configuration de paie couvre déjà ces dates pour cet enseignant.")).toBeTruthy();
    const put = api.calls.find((c) => c.method === "PUT")!;
    expect(put.body).toMatchObject({ type: "MIXED", monthlySalary: 210000, defaultHourlyRate: 5000 });
    expect(put.body).not.toHaveProperty("staffId");
  });

  it("situation d'un enseignant : état calculé par l'API", async () => {
    setTestApi({
      ...base,
      "GET /api/v1/payroll/configs": { items: [], total: 0 },
      [`GET /api/v1/payroll/staff/${pid(20)}/config/current`]: { state: "EXPIRED", config: config({ effectiveTo: "2026-06-30" }) },
    });
    renderWithProviders(<ConfigsScreen />);
    const section = (await screen.findByRole("heading", { name: "Situation d'un enseignant" })).closest("section")!;
    fireEvent.focus(within(section).getByLabelText(/^Enseignant/));
    fireEvent.click(await within(section).findByRole("option", { name: /KOUASSI Marc/ }));
    expect(await within(section).findByText("Configuration expirée")).toBeTruthy();
  });

  it("sans droit de gestion : pas de création ni de modification", async () => {
    setTestApi({ ...accessRoutes(["payroll.config.read"]), "GET /api/v1/payroll/configs": { items: [config()], total: 1 }, ...staffDetail });
    renderWithProviders(<ConfigsScreen />);
    await screen.findByRole("table", { name: "Configurations de paie" });
    expect(screen.queryByRole("button", { name: "Nouvelle configuration" })).toBeNull();
    expect(screen.queryByRole("button", { name: /Modifier/ })).toBeNull();
  });
});

describe("RatesScreen et simulateur", () => {
  const version = curriculumVersion({ id: uuid(500), status: "PUBLISHED", nodeCount: 1 });
  const node = (over: Record<string, unknown> = {}) =>
    curriculumNode({ id: pid(80), versionId: version.id, nodeTypeCode: "ECUE", lineageId: uuid(900), subjectId: uuid(901), code: "MATH-101", label: "Algèbre", ordinal: 1, credits: null, ...over });
  const base = {
    ...accessRoutes(MANAGE),
    "GET /api/v1/people/staff": staff,
    ...staffDetail,
    "GET /api/v1/academic/curriculum-versions": { items: [version] },
    [`GET /api/v1/academic/curriculum-versions/${version.id}`]: { version, roots: [node()] },
    "GET /api/v1/academic/programs": { items: [] },
    "GET /api/v1/academic/years": { items: [] },
  };

  it("liste : cours nommé, tarif générique ou nominatif, tarif en francs entiers", async () => {
    setTestApi({ ...base, "GET /api/v1/payroll/rates": { items: [rate(), rate({ id: pid(71), staffId: pid(20), rate: 8000 })], total: 2 } });
    renderWithProviders(<RatesScreen />);
    const table = await screen.findByRole("table", { name: "Tarifs horaires" });
    await waitFor(() => expect(within(table).getAllByText("MATH-101 · Algèbre")).toHaveLength(2));
    expect(within(table).getByText("Générique")).toBeTruthy();
    expect(await within(table).findByText("KOUASSI Marc")).toBeTruthy();
    expect(within(table).getByText(/^8\D000\sF\sCFA$/)).toBeTruthy();
  });

  it("création d'un tarif générique : cours choisi dans la liste, montant entier ; décimal refusé", async () => {
    const api = setTestApi({ ...base, "GET /api/v1/payroll/rates": { items: [], total: 0 }, "POST /api/v1/payroll/rates": () => json(rate(), { status: 201 }) });
    renderWithProviders(<RatesScreen />);
    fireEvent.click(await screen.findByRole("button", { name: "Nouveau tarif" }));
    const dialog = await screen.findByRole("dialog");
    await within(dialog).findByRole("option", { name: "MATH-101 · Algèbre" });
    fireEvent.change(within(dialog).getByLabelText(/^Cours/), { target: { value: pid(80) } });
    fireEvent.change(within(dialog).getByLabelText(/^Tarif horaire/), { target: { value: "6000,5" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Enregistrer" }));
    expect(await within(dialog).findByText("Le montant est un entier en francs : pas de virgule ni de point.")).toBeTruthy();
    fireEvent.change(within(dialog).getByLabelText(/^Tarif horaire/), { target: { value: "6 000" } });
    fireEvent.change(within(dialog).getByLabelText(/^Valide à partir du/), { target: { value: "2026-09-01" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Enregistrer" }));
    await screen.findByText("Le tarif a été enregistré.");
    expect(posts(api)[0]!.body).toEqual({ curriculumNodeId: pid(80), rate: 6000, validFrom: "2026-09-01", validTo: null, notes: null });
  });

  it("chevauchement refusé par l'API : message affiché", async () => {
    setTestApi({
      ...base,
      "GET /api/v1/payroll/rates": { items: [], total: 0 },
      "POST /api/v1/payroll/rates": () => json({ code: "payroll.rate_overlap", message: "Un tarif chevauchant existe déjà pour ce cours et cet enseignant (TARIF_CHEVAUCHANT)." }, { status: 409 }),
    });
    renderWithProviders(<RatesScreen />);
    fireEvent.click(await screen.findByRole("button", { name: "Nouveau tarif" }));
    const dialog = await screen.findByRole("dialog");
    await within(dialog).findByRole("option", { name: "MATH-101 · Algèbre" });
    fireEvent.change(within(dialog).getByLabelText(/^Cours/), { target: { value: pid(80) } });
    fireEvent.change(within(dialog).getByLabelText(/^Tarif horaire/), { target: { value: "6000" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Enregistrer" }));
    expect(await within(dialog).findByText(/TARIF_CHEVAUCHANT/)).toBeTruthy();
  });

  it("suppression confirmée", async () => {
    const api = setTestApi({ ...base, "GET /api/v1/payroll/rates": { items: [rate()], total: 1 }, [`DELETE /api/v1/payroll/rates/${pid(70)}`]: () => new Response(null, { status: 204 }) });
    renderWithProviders(<RatesScreen />);
    fireEvent.click(await screen.findByRole("button", { name: /Supprimer/ }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Supprimer" }));
    await screen.findByText("Le tarif a été supprimé.");
    expect(api.calls.some((c) => c.method === "DELETE")).toBe(true);
  });

  it("simulateur : tarif et origine renvoyés par l'API ; absence de tarif signalée", async () => {
    let answer: unknown = { rate: 6000, origin: "NODE_GENERIC", configState: "ACTIVE" };
    const api = setTestApi({ ...base, "GET /api/v1/payroll/rates": { items: [], total: 0 }, "GET /api/v1/payroll/rates/resolve": () => json(answer) });
    renderWithProviders(<RatesScreen />);
    const section = (await screen.findByRole("heading", { name: "Simulateur de tarif" })).closest("section")!;
    fireEvent.focus(within(section).getByLabelText(/^Enseignant/));
    fireEvent.click(await within(section).findByRole("option", { name: /KOUASSI Marc/ }));
    await within(section).findByRole("option", { name: "MATH-101 · Algèbre" });
    fireEvent.change(within(section).getByLabelText(/^Cours/), { target: { value: pid(80) } });
    fireEvent.change(within(section).getByLabelText(/^À la date du/), { target: { value: "2026-10-05" } });
    fireEvent.click(within(section).getByRole("button", { name: "Simuler" }));
    expect(await within(section).findByText(/Tarif retenu : 6\D000\sF\sCFA par heure — Tarif générique du cours/)).toBeTruthy();
    expect(api.calls.find((c) => c.path.endsWith("/rates/resolve"))!.query).toMatchObject({ staffId: pid(20), nodeId: pid(80), date: "2026-10-05" });
    answer = { rate: null, origin: null, configState: "ABSENT" };
    fireEvent.change(within(section).getByLabelText(/^À la date du/), { target: { value: "2026-10-06" } });
    fireEvent.click(within(section).getByRole("button", { name: "Simuler" }));
    expect(await within(section).findByText(/Aucun tarif applicable\. Aucune configuration\./)).toBeTruthy();
  });
});

describe("SettingsScreen", () => {
  it("affiche les réglages et n'envoie que des entiers (seuil propriétaire, minutes, millièmes)", async () => {
    const api = setTestApi({ ...accessRoutes(MANAGE), "GET /api/v1/payroll/settings": settings(), "PUT /api/v1/payroll/settings": () => json(settings({ ownerApprovalThreshold: 800000 })) });
    renderWithProviders(<SettingsScreen />);
    expect(await screen.findByDisplayValue("2400")).toBeTruthy();
    expect(screen.getByDisplayValue("1,5")).toBeTruthy();
    expect((screen.getByRole("checkbox", { name: /Séparation des tâches/ }) as HTMLInputElement).checked).toBe(true);
    fireEvent.change(screen.getByLabelText(/^Seuil de validation par le propriétaire/), { target: { value: "800 000" } });
    fireEvent.click(screen.getByRole("button", { name: "Enregistrer les réglages" }));
    await screen.findByText("Les réglages ont été enregistrés.");
    expect(api.calls.find((c) => c.method === "PUT")!.body).toEqual({ defaultOvertimeThresholdMinutes: 2400, defaultOvertimeMultiplierPermille: 1500, requireSeparateApprover: true, ownerApprovalThreshold: 800000 });
  });

  it("seuil vidé : aucun seuil (null) ; décimal refusé", async () => {
    const api = setTestApi({ ...accessRoutes(MANAGE), "GET /api/v1/payroll/settings": settings(), "PUT /api/v1/payroll/settings": () => json(settings({ ownerApprovalThreshold: null })) });
    renderWithProviders(<SettingsScreen />);
    const field = await screen.findByLabelText(/^Seuil de validation par le propriétaire/);
    fireEvent.change(field, { target: { value: "1,5" } });
    fireEvent.click(screen.getByRole("button", { name: "Enregistrer les réglages" }));
    expect((await screen.findAllByText("Le montant est un entier en francs : pas de virgule ni de point.")).length).toBeGreaterThan(0);
    expect(api.calls.some((c) => c.method === "PUT")).toBe(false);
    fireEvent.change(field, { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "Enregistrer les réglages" }));
    await screen.findByText("Les réglages ont été enregistrés.");
    expect((api.calls.find((c) => c.method === "PUT")!.body as { ownerApprovalThreshold: unknown }).ownerApprovalThreshold).toBeNull();
  });

  it("réglages inaccessibles : message de l'API", async () => {
    setTestApi({ ...accessRoutes(MANAGE), "GET /api/v1/payroll/settings": () => json({ code: "forbidden", message: "Réglages réservés au propriétaire." }, { status: 403 }) });
    renderWithProviders(<SettingsScreen />);
    expect(await screen.findByText("Réglages réservés au propriétaire.")).toBeTruthy();
  });
});
