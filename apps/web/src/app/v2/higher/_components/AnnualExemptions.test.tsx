// @vitest-environment jsdom
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { accessRoutes, setTestApi } from "@/platform/test/api-mock";
import { json, renderWithProviders } from "@/platform/test/render";
import { node, nodeTypes, period, program, version, year } from "../../_test/fixtures";
import { enrollment, studentDetail as peopleStudentDetail, studentSummary } from "../../_test/fixtures-people";
import { NOW, uuid } from "../_test/fixtures";
import { AnnualUesScreen } from "./AnnualUesScreen";
import { ExemptionsScreen } from "./ExemptionsScreen";

vi.mock("@/platform/api/default-client", async () => (await import("@/platform/test/api-mock")).defaultClientModule);

const H = "/api/v1/higher";
const exemption = (over: Record<string, unknown> = {}) => ({
  id: uuid(9000),
  studentId: uuid(2000),
  enrollmentId: uuid(1000),
  ueNodeId: uuid(8301),
  academicYearId: uuid(100),
  academicPeriodId: uuid(200),
  credits: 6,
  reason: "Équivalence reconnue par la direction",
  creditPolicy: "RECORD_ONLY",
  ledgerId: null,
  status: "ACTIVE",
  grantedBy: uuid(1),
  grantedAt: NOW,
  revokedBy: null,
  revokedAt: null,
  revokeReason: null,
  ueCode: "UE101",
  ueLabel: "Algorithmique",
  ...over,
});
const nodeView = (over: Record<string, unknown> = {}) => ({
  nodeId: uuid(8300),
  lineageId: uuid(8301),
  parentId: null,
  nodeTypeCode: "UE",
  code: "UE101",
  label: "Algorithmique",
  subjectId: null,
  coefficient: null,
  credits: "6",
  isMandatory: true,
  isTransversal: false,
  categoryCode: null,
  periodTypeCode: null,
  periodOrdinal: null,
  registrationKind: "REGULAR",
  enrollmentCourseId: null,
  ...over,
});
const READ = ["higher.exemption.read"];
const GRANT = ["higher.exemption.read", "higher.exemption.grant", "higher.settings.manage"];
const FEATURES = ["higher.diplomas"];
const base = {
  [`GET /api/v1/people/students/${uuid(2000)}`]: peopleStudentDetail(),
};

describe("ExemptionsScreen (O-14)", () => {
  it("liste les dispenses avec UE, effet sur les crédits et motif ; filtre par état envoyé à l'API", async () => {
    const api = setTestApi({
      ...accessRoutes(READ, FEATURES),
      ...base,
      [`GET ${H}/exemptions`]: ({ url }) => json({ items: url.searchParams.get("status") === "REVOKED" ? [exemption({ id: uuid(9001), status: "REVOKED", revokeReason: "Accordée par erreur", creditPolicy: "GRANT_CREDITS" })] : [exemption()] }),
    });
    renderWithProviders(<ExemptionsScreen />);
    const table = await screen.findByRole("table", { name: "Liste des dispenses d'UE" });
    expect(await within(table).findByText("TRAORE Awa")).toBeTruthy();
    expect(within(table).getByText("UE101 — Algorithmique")).toBeTruthy();
    expect(within(table).getByText("Aucun effet sur les crédits")).toBeTruthy();
    expect(within(table).getByText(/Équivalence reconnue par la direction/)).toBeTruthy();
    // lecture seule : ni octroi, ni révocation, ni paramètre
    expect(screen.queryByRole("button", { name: "Accorder une dispense" })).toBeNull();
    expect(screen.queryByRole("button", { name: /Révoquer/ })).toBeNull();
    expect(screen.queryByLabelText("Politique de crédits")).toBeNull();
    fireEvent.change(screen.getByLabelText("Afficher"), { target: { value: "REVOKED" } });
    await waitFor(() => expect(api.calls.filter((c) => c.path === `${H}/exemptions`).at(-1)!.query).toMatchObject({ status: "REVOKED" }));
    expect(await within(await screen.findByRole("table", { name: "Liste des dispenses d'UE" })).findByText("5 crédits inscrits au registre".replace("5", "6"))).toBeTruthy();
  });

  it("révocation : motif de 10 caractères au moins, envoyé à l'API", async () => {
    const api = setTestApi({
      ...accessRoutes(GRANT, FEATURES),
      ...base,
      [`GET ${H}/exemptions`]: { items: [exemption()] },
      [`GET ${H}/exemption-settings`]: { exemptionCreditPolicy: "RECORD_ONLY" },
      [`POST ${H}/exemptions/${uuid(9000)}/revoke`]: () => json(exemption({ status: "REVOKED", revokedBy: uuid(1), revokedAt: NOW, revokeReason: "Dispense accordée par erreur" })),
    });
    renderWithProviders(<ExemptionsScreen />);
    fireEvent.click(await screen.findByRole("button", { name: /Révoquer la dispense de UE101/ }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText(/Motif/), { target: { value: "bref" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Révoquer" }));
    expect(api.calls.filter((c) => c.method === "POST")).toHaveLength(0);
    fireEvent.change(within(dialog).getByLabelText(/Motif/), { target: { value: "Dispense accordée par erreur" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Révoquer" }));
    await screen.findByText("La dispense est révoquée.");
    expect(api.calls.find((c) => c.method === "POST")!.body).toEqual({ reason: "Dispense accordée par erreur" });
  });

  it("paramètre d'établissement : la politique de crédits se change avec higher.settings.manage (corps exact)", async () => {
    const api = setTestApi({
      ...accessRoutes(GRANT, FEATURES),
      ...base,
      [`GET ${H}/exemptions`]: { items: [] },
      [`GET ${H}/exemption-settings`]: { exemptionCreditPolicy: "RECORD_ONLY" },
      [`PUT ${H}/exemption-settings`]: () => json({ exemptionCreditPolicy: "GRANT_CREDITS" }),
    });
    renderWithProviders(<ExemptionsScreen />);
    const select = await screen.findByLabelText("Politique de crédits");
    await waitFor(() => expect((select as HTMLSelectElement).disabled).toBe(false));
    expect(screen.getByText(/ne change ni les crédits, ni la validation/)).toBeTruthy();
    fireEvent.change(select, { target: { value: "GRANT_CREDITS" } });
    await waitFor(() => expect(api.calls.find((c) => c.method === "PUT")?.body).toEqual({ exemptionCreditPolicy: "GRANT_CREDITS" }));
  });

  it("octroi : étudiant, inscription, UE (lignée), semestre et motif ; le contrat refuse un motif court sans appel", async () => {
    const api = setTestApi({
      ...accessRoutes(GRANT, FEATURES),
      ...base,
      [`GET ${H}/exemptions`]: { items: [] },
      [`GET ${H}/exemption-settings`]: { exemptionCreditPolicy: "GRANT_CREDITS" },
      "GET /api/v1/people/students": { items: [studentSummary()], total: 1, limit: 20, offset: 0 },
      "GET /api/v1/academic/enrollments": { items: [enrollment()], total: 1, page: 1, pageSize: 20 },
      [`GET /api/v1/academic/classrooms/${uuid(500)}/nodes`]: { items: [nodeView({ nodeId: uuid(8300), lineageId: uuid(8301) }), nodeView({ nodeId: uuid(8310), lineageId: uuid(8311), parentId: uuid(8300), nodeTypeCode: "ECUE", code: "E1", label: "Élément 1" })] },
      [`GET /api/v1/academic/years/${uuid(100)}/periods`]: { items: [period({ id: uuid(200) })] },
      "GET /api/v1/academic/reference/node-types": { items: nodeTypes },
      [`POST ${H}/exemptions`]: () => json(exemption(), { status: 201 }),
    });
    renderWithProviders(<ExemptionsScreen />);
    fireEvent.click(await screen.findByRole("button", { name: "Accorder une dispense" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Accorder la dispense" }));
    await waitFor(() => expect(within(dialog).getAllByRole("alert").length).toBeGreaterThan(0));
    expect(api.calls.filter((c) => c.method === "POST")).toHaveLength(0);

    const input = within(dialog).getByRole("combobox", { name: /^Étudiant/ });
    fireEvent.focus(input);
    fireEvent.click(await within(dialog).findByRole("option", { name: /TRAORE Awa/ }));
    await within(dialog).findByRole("option", { name: /2026-0001/ });
    fireEvent.change(within(dialog).getByLabelText(/^Inscription/), { target: { value: uuid(1000) } });
    // seule l'UE (élément à crédits qui a des sous-éléments) est proposée, identifiée par sa LIGNÉE
    const ue = await within(dialog).findByLabelText(/UE dispensée/);
    await waitFor(() => expect(within(ue).getAllByRole("option").map((o) => o.textContent)).toEqual(["Choisir l'UE", "UE101 — Algorithmique"]));
    fireEvent.change(ue, { target: { value: uuid(8301) } });
    await within(dialog).findByRole("option", { name: "Semestre 1" });
    fireEvent.change(within(dialog).getByLabelText(/Semestre de rattachement/), { target: { value: uuid(200) } });
    fireEvent.change(within(dialog).getByLabelText(/Motif de la dispense/), { target: { value: "court" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Accorder la dispense" }));
    await waitFor(() => expect(within(dialog).getAllByRole("alert").length).toBeGreaterThan(0));
    expect(api.calls.filter((c) => c.method === "POST")).toHaveLength(0);
    fireEvent.change(within(dialog).getByLabelText(/Motif de la dispense/), { target: { value: "Équivalence reconnue par la direction" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Accorder la dispense" }));
    await screen.findByText("La dispense est accordée.");
    expect(api.calls.find((c) => c.method === "POST")!.body).toEqual({
      studentId: uuid(2000),
      enrollmentId: uuid(1000),
      ueNodeId: uuid(8301),
      academicPeriodId: uuid(200),
      reason: "Équivalence reconnue par la direction",
    });
  });

  it("erreur métier de l'API (déjà dispensé) : message du serveur affiché, le formulaire reste ouvert", async () => {
    setTestApi({
      ...accessRoutes(GRANT, FEATURES),
      ...base,
      [`GET ${H}/exemptions`]: { items: [] },
      [`GET ${H}/exemption-settings`]: { exemptionCreditPolicy: "RECORD_ONLY" },
      "GET /api/v1/people/students": { items: [studentSummary()], total: 1, limit: 20, offset: 0 },
      "GET /api/v1/academic/enrollments": { items: [enrollment()], total: 1, page: 1, pageSize: 20 },
      [`GET /api/v1/academic/classrooms/${uuid(500)}/nodes`]: { items: [nodeView()] },
      [`GET /api/v1/academic/years/${uuid(100)}/periods`]: { items: [period({ id: uuid(200) })] },
      "GET /api/v1/academic/reference/node-types": { items: nodeTypes },
      [`POST ${H}/exemptions`]: () => json({ code: "higher.exemption_exists", message: "Cet étudiant est déjà dispensé de cette UE." }, { status: 409 }),
    });
    renderWithProviders(<ExemptionsScreen />);
    fireEvent.click(await screen.findByRole("button", { name: "Accorder une dispense" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.focus(within(dialog).getByRole("combobox", { name: /^Étudiant/ }));
    fireEvent.click(await within(dialog).findByRole("option", { name: /TRAORE Awa/ }));
    await within(dialog).findByRole("option", { name: /2026-0001/ });
    fireEvent.change(within(dialog).getByLabelText(/^Inscription/), { target: { value: uuid(1000) } });
    await within(dialog).findByRole("option", { name: "UE101 — Algorithmique" });
    fireEvent.change(within(dialog).getByLabelText(/UE dispensée/), { target: { value: uuid(8301) } });
    await within(dialog).findByRole("option", { name: "Semestre 1" });
    fireEvent.change(within(dialog).getByLabelText(/Semestre de rattachement/), { target: { value: uuid(200) } });
    fireEvent.change(within(dialog).getByLabelText(/Motif de la dispense/), { target: { value: "Équivalence reconnue par la direction" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Accorder la dispense" }));
    expect((await within(dialog).findAllByText(/déjà dispensé/)).length).toBeGreaterThan(0);
    expect(screen.getByRole("dialog")).toBeTruthy();
  });

  it("accès : sans higher.exemption.read, refus ; sans la fonction diplômes, avis d'offre", async () => {
    setTestApi({ ...accessRoutes([], FEATURES) });
    const { unmount } = renderWithProviders(<ExemptionsScreen />);
    expect(await screen.findByText(/pas autorisé|n'avez pas|refusé|autoris/i)).toBeTruthy();
    unmount();
    setTestApi({ ...accessRoutes(READ, []) });
    renderWithProviders(<ExemptionsScreen />);
    expect(await screen.findByText(/pas incluse|pas inclus/)).toBeTruthy();
  });
});

describe("AnnualUesScreen (O-11)", () => {
  const annual = (over: Record<string, unknown> = {}) => ({
    id: uuid(9100),
    ueNodeId: uuid(8301),
    memberNodeIds: [uuid(8301), uuid(8311)],
    partsExpected: 2,
    reason: "UE annuelle de la licence",
    createdAt: NOW,
    ueCode: "UE101",
    ueLabel: "Algorithmique",
    members: [
      { ueNodeId: uuid(8301), code: "UE101", label: "Algorithmique" },
      { ueNodeId: uuid(8311), code: "UE102", label: "Algorithmique 2" },
    ],
    ...over,
  });

  it("liste les UE annuelles, rappelle que les règles décident du résultat commun ; lecture seule sans higher.annual_ue.manage", async () => {
    setTestApi({ ...accessRoutes(["higher.diploma.read"], FEATURES), [`GET ${H}/annual-ues`]: { items: [annual()] } });
    renderWithProviders(<AnnualUesScreen />);
    const list = await screen.findByRole("list", { name: "UE annuelles déclarées" });
    expect(within(list).getByText("UE101 — Algorithmique")).toBeTruthy();
    expect(within(list).getByText("2 semestres")).toBeTruthy();
    expect(within(list).getByText(/UE102 — Algorithmique 2/)).toBeTruthy();
    expect(screen.getByText(/calculés par les règles de calcul de l'établissement/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Déclarer une UE annuelle" })).toBeNull();
    expect(screen.queryByRole("button", { name: /Retirer/ })).toBeNull();
  });

  it("état vide", async () => {
    setTestApi({ ...accessRoutes(["higher.diploma.read"], FEATURES), [`GET ${H}/annual-ues`]: { items: [] } });
    renderWithProviders(<AnnualUesScreen />);
    expect(await screen.findByText("Aucune UE annuelle")).toBeTruthy();
  });

  it("retrait : motif obligatoire, envoyé à l'API", async () => {
    const api = setTestApi({
      ...accessRoutes(["higher.diploma.read", "higher.annual_ue.manage"], FEATURES),
      [`GET ${H}/annual-ues`]: { items: [annual()] },
      [`POST ${H}/annual-ues/${uuid(9100)}/remove`]: () => json({ removed: true }),
    });
    renderWithProviders(<AnnualUesScreen />);
    fireEvent.click(await screen.findByRole("button", { name: /Retirer — UE101/ }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText(/Motif/), { target: { value: "ab" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Retirer" }));
    expect(api.calls.filter((c) => c.method === "POST")).toHaveLength(0);
    fireEvent.change(within(dialog).getByLabelText(/Motif/), { target: { value: "Déclaration erronée" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Retirer" }));
    await screen.findByText("La déclaration est retirée.");
    expect(api.calls.find((c) => c.method === "POST")!.body).toEqual({ reason: "Déclaration erronée" });
  });

  it("déclaration : UE principale et UE du second semestre choisies par LIGNÉE, nombre de semestres et motif (corps validé par le contrat)", async () => {
    const api = setTestApi({
      ...accessRoutes(["higher.diploma.read", "higher.annual_ue.manage"], FEATURES),
      [`GET ${H}/annual-ues`]: { items: [] },
      "GET /api/v1/academic/programs": { items: [program()] },
      "GET /api/v1/academic/years": { items: [year()] },
      "GET /api/v1/academic/curriculum-versions": { items: [version({ id: uuid(700), status: "PUBLISHED" })] },
      [`GET /api/v1/academic/curriculum-versions/${uuid(700)}`]: {
        version: version({ id: uuid(700), status: "PUBLISHED" }),
        roots: [node({ id: uuid(8300), lineageId: uuid(8301), code: "UE101", label: "Algorithmique" }), node({ id: uuid(8310), lineageId: uuid(8311), code: "UE102", label: "Algorithmique 2" })],
      },
      [`POST ${H}/annual-ues`]: () => json(annual(), { status: 201 }),
    });
    renderWithProviders(<AnnualUesScreen />);
    fireEvent.click(await screen.findByRole("button", { name: "Déclarer une UE annuelle" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Déclarer" }));
    await waitFor(() => expect(within(dialog).getAllByRole("alert").length).toBeGreaterThan(0));
    expect(api.calls.filter((c) => c.method === "POST")).toHaveLength(0);
    const fieldsets = within(dialog).getAllByRole("group");
    const main = within(fieldsets[0]!);
    const second = within(fieldsets[1]!);
    await main.findByRole("option", { name: /Licence Informatique/ });
    fireEvent.change(main.getByLabelText("Programme"), { target: { value: uuid(300) } });
    fireEvent.change(main.getByLabelText("Année académique"), { target: { value: uuid(100) } });
    await main.findByRole("option", { name: /UE101/ });
    fireEvent.change(main.getByLabelText(/Nœud du curriculum/), { target: { value: uuid(8300) } });
    fireEvent.change(second.getByLabelText("Programme"), { target: { value: uuid(300) } });
    fireEvent.change(second.getByLabelText("Année académique"), { target: { value: uuid(100) } });
    await second.findByRole("option", { name: /UE102/ });
    fireEvent.change(second.getByLabelText(/Nœud du curriculum/), { target: { value: uuid(8310) } });
    fireEvent.change(within(dialog).getByLabelText(/Motif de la déclaration/), { target: { value: "UE annuelle de la licence" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Déclarer" }));
    await screen.findByText("L'UE annuelle est déclarée.");
    expect(api.calls.find((c) => c.method === "POST")!.body).toEqual({ ueNodeId: uuid(8301), memberNodeIds: [uuid(8311)], partsExpected: 2, reason: "UE annuelle de la licence" });
  });
});
