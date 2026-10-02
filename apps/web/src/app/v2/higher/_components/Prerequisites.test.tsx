// @vitest-environment jsdom
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { accessRoutes, setTestApi } from "@/platform/test/api-mock";
import { json, renderWithProviders } from "@/platform/test/render";
import { node, nodeTypes, program, uuid, version, year } from "../../_test/fixtures";
import { studentDetail, studentSummary } from "../../_test/fixtures-people";
import { PrerequisitesScreen } from "./PrerequisitesScreen";
import { candidateUes, flattenTree } from "./prerequisites-model";

vi.mock("@/platform/api/default-client", async () => (await import("@/platform/test/api-mock")).defaultClientModule);
vi.mock("next/link", () => ({ default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a> }));

const H = "/api/v1/higher";
const UE1 = uuid(8101);
const UE2 = uuid(8102);
const UE3 = uuid(8103);
const ECUE = uuid(8104);
const ALL = accessRoutes(["higher.prerequisite.manage", "higher.credits.read"], ["higher.prerequisites"]);

const tree = {
  version: version({ id: uuid(700), status: "PUBLISHED" }),
  roots: [
    node({
      id: uuid(8100),
      nodeTypeCode: "SEMESTER",
      code: "S1",
      label: "Semestre 1",
      credits: null,
      children: [
        node({ id: UE1, code: "UE1", label: "Algorithmique", parentId: uuid(8100) }),
        node({ id: UE2, code: "UE2", label: "Bases de données", parentId: uuid(8100), credits: "4" }),
        node({ id: UE3, code: "UE3", label: "Réseaux", parentId: uuid(8100), credits: "5" }),
        node({ id: ECUE, nodeTypeCode: "SEMESTER_TXT", code: "TXT", label: "Texte libre", parentId: uuid(8100), credits: null }),
      ],
    }),
  ],
};

const base = {
  ...ALL,
  "GET /api/v1/academic/programs": { items: [program({ id: uuid(300), label: "Licence Informatique" })] },
  "GET /api/v1/academic/years": { items: [year({ id: uuid(100), label: "Année 2026-2027" })] },
  "GET /api/v1/academic/curriculum-versions": { items: [version({ id: uuid(700), status: "PUBLISHED" })] },
  [`GET /api/v1/academic/curriculum-versions/${uuid(700)}`]: tree,
  "GET /api/v1/academic/reference/node-types": { items: nodeTypes },
};

const prereq = (over: Partial<Record<string, unknown>> = {}) => ({ id: uuid(8800), ueNodeId: UE3, prerequisiteNodeId: UE1, mode: "VALIDATED", minAverage: null, ...over });

async function pickProgramAndYear() {
  const programs = (await screen.findByLabelText("Programme")) as HTMLSelectElement;
  await waitFor(() => expect(programs.options.length).toBeGreaterThan(1));
  fireEvent.change(programs, { target: { value: uuid(300) } });
  const years = (await screen.findByLabelText("Année")) as HTMLSelectElement;
  await waitFor(() => expect(years.options.length).toBeGreaterThan(1));
  fireEvent.change(years, { target: { value: uuid(100) } });
}

async function openUe(label: RegExp) {
  await pickProgramAndYear();
  fireEvent.click(await screen.findByRole("button", { name: label }));
}

describe("prerequisites-model", () => {
  it("aplatit l'arbre et ne retient, par défaut, que les éléments dont le type porte des crédits", () => {
    const flat = flattenTree(tree.roots as never);
    expect(flat.map((n) => [n.code, n.depth])).toEqual([["S1", 0], ["UE1", 1], ["UE2", 1], ["UE3", 1], ["TXT", 1]]);
    expect(candidateUes(flat, new Set(["UE"]), false).map((n) => n.code)).toEqual(["UE1", "UE2", "UE3"]);
    expect(candidateUes(flat, new Set(["UE"]), true)).toHaveLength(5);
    expect(candidateUes(flat, null, false)).toHaveLength(5);
  });
});

describe("PrerequisitesScreen", () => {
  it("programme -> année -> UE : affiche les prérequis de l'UE (UE choisie dans la version)", async () => {
    const api = setTestApi({ ...base, [`GET ${H}/ue/${UE3}/prerequisites`]: { items: [prereq(), prereq({ id: uuid(8801), prerequisiteNodeId: UE2, mode: "MIN_AVERAGE", minAverage: "12" })] } });
    renderWithProviders(<PrerequisitesScreen />);
    expect(await screen.findByText("Choisissez un programme et une année pour afficher ses UE.")).toBeTruthy();
    await openUe(/Réseaux/);
    const form = await screen.findByRole("form", { name: "Prérequis de Réseaux" });
    const list = await within(form).findByRole("list", { name: "Prérequis" });
    await waitFor(() => expect(within(list).getAllByRole("listitem")).toHaveLength(2));
    const selects = within(list).getAllByLabelText(/UE prérequise/) as HTMLSelectElement[];
    expect(selects.map((s) => s.value)).toEqual([UE1, UE2]);
    expect((within(list).getByLabelText(/Moyenne minimale/) as HTMLInputElement).value).toBe("12");
    // Texte libre (type sans crédits) : non proposé comme UE.
    expect(screen.queryByRole("button", { name: /Texte libre/ })).toBeNull();
    // Chaque UE est lue séparément, à la demande.
    expect(api.calls.filter((c) => c.path.endsWith("/prerequisites"))).toHaveLength(1);
  });

  it("édition : ajout d'un prérequis « moyenne minimale », corps exact ; les inscrits qui ne satisferaient plus sont signalés", async () => {
    const api = setTestApi({
      ...base,
      [`GET ${H}/ue/${UE3}/prerequisites`]: { items: [prereq()] },
      [`PUT ${H}/ue/${UE3}/prerequisites`]: () =>
        json({
          prerequisites: [prereq(), prereq({ id: uuid(8802), prerequisiteNodeId: UE2, mode: "MIN_AVERAGE", minAverage: "12.5" })],
          warnings: [{ studentId: uuid(3001), missing: [{ prerequisiteNodeId: UE2, mode: "MIN_AVERAGE", minAverage: "12.5", reason: "AVERAGE_TOO_LOW" }] }],
        }),
      [`GET /api/v1/people/students/${uuid(3001)}`]: studentDetail({ id: uuid(3001), displayName: "AKA Marie" }),
    });
    renderWithProviders(<PrerequisitesScreen />);
    await openUe(/Réseaux/);
    const form = await screen.findByRole("form", { name: "Prérequis de Réseaux" });
    await within(form).findByLabelText(/UE prérequise/);
    fireEvent.click(within(form).getByRole("button", { name: "Ajouter un prérequis" }));
    // Envoi d'une ligne vide : contrôle de forme du contrat, aucun appel.
    fireEvent.click(within(form).getByRole("button", { name: "Enregistrer les prérequis" }));
    await waitFor(() => expect(within(form).getAllByRole("alert").length).toBeGreaterThan(0));
    expect(api.calls.filter((c) => c.method === "PUT")).toHaveLength(0);
    const selects = within(form).getAllByLabelText(/UE prérequise/) as HTMLSelectElement[];
    // L'UE elle-même et celles déjà prises ne sont pas proposées.
    expect(Array.from(selects[1]!.options).map((o) => o.value)).toEqual(["", UE2]);
    fireEvent.change(selects[1]!, { target: { value: UE2 } });
    fireEvent.change(within(form).getAllByLabelText(/Condition/)[1]!, { target: { value: "MIN_AVERAGE" } });
    fireEvent.click(within(form).getByRole("button", { name: "Enregistrer les prérequis" }));
    await waitFor(() => expect(within(form).getAllByRole("alert").length).toBeGreaterThan(0)); // moyenne absente
    expect(api.calls.filter((c) => c.method === "PUT")).toHaveLength(0);
    fireEvent.change(within(form).getByLabelText(/Moyenne minimale/), { target: { value: "12,5" } });
    fireEvent.click(within(form).getByRole("button", { name: "Enregistrer les prérequis" }));
    await screen.findByText("Les prérequis de Réseaux sont enregistrés.");
    expect(api.calls.find((c) => c.method === "PUT")!.body).toEqual({
      prerequisites: [
        { prerequisiteNodeId: UE1, mode: "VALIDATED" },
        { prerequisiteNodeId: UE2, mode: "MIN_AVERAGE", minAverage: 12.5 },
      ],
    });
    expect(await screen.findByText("1 étudiant inscrit ne satisferait plus ces prérequis")).toBeTruthy();
    expect(await screen.findByText(/AKA Marie/)).toBeTruthy();
    expect(screen.getByText(/moyenne insuffisante/)).toBeTruthy();
  });

  it("le serveur détecte un cycle : son message est affiché et rien n'est considéré comme enregistré", async () => {
    setTestApi({
      ...base,
      [`GET ${H}/ue/${UE1}/prerequisites`]: { items: [] },
      [`PUT ${H}/ue/${UE1}/prerequisites`]: () => json({ code: "higher.prerequisite_cycle", message: "Ces prérequis créeraient un cycle entre UE.", details: { cycle: [UE1, UE3, UE1] } }, { status: 422 }),
    });
    renderWithProviders(<PrerequisitesScreen />);
    await openUe(/Algorithmique/);
    const form = await screen.findByRole("form", { name: "Prérequis de Algorithmique" });
    expect(await within(form).findByText("Cette UE n'a aucun prérequis.")).toBeTruthy();
    fireEvent.click(within(form).getByRole("button", { name: "Ajouter un prérequis" }));
    fireEvent.change(within(form).getByLabelText(/UE prérequise/), { target: { value: UE3 } });
    fireEvent.click(within(form).getByRole("button", { name: "Enregistrer les prérequis" }));
    expect(await within(form).findByText("Ces prérequis créeraient un cycle entre UE.")).toBeTruthy();
    expect(screen.queryByText("Les prérequis de Algorithmique sont enregistrés.")).toBeNull();
  });

  it("retirer tous les prérequis envoie une liste vide", async () => {
    const api = setTestApi({
      ...base,
      [`GET ${H}/ue/${UE3}/prerequisites`]: { items: [prereq()] },
      [`PUT ${H}/ue/${UE3}/prerequisites`]: () => json({ prerequisites: [], warnings: [] }),
    });
    renderWithProviders(<PrerequisitesScreen />);
    await openUe(/Réseaux/);
    const form = await screen.findByRole("form", { name: "Prérequis de Réseaux" });
    fireEvent.click(await within(form).findByRole("button", { name: /Retirer le prérequis Algorithmique/ }));
    fireEvent.click(within(form).getByRole("button", { name: "Enregistrer les prérequis" }));
    await screen.findByText("Les prérequis de Réseaux sont enregistrés.");
    expect(api.calls.find((c) => c.method === "PUT")!.body).toEqual({ prerequisites: [] });
  });

  it("contrôle d'un étudiant : le verdict du serveur et les prérequis manquants sont affichés", async () => {
    const api = setTestApi({
      ...base,
      [`GET ${H}/ue/${UE3}/prerequisites`]: { items: [prereq()] },
      "GET /api/v1/people/students": { items: [studentSummary({ id: uuid(3001), displayName: "AKA Marie" })], total: 1, limit: 20, offset: 0 },
      [`GET ${H}/students/${uuid(3001)}/prerequisites-check`]: { satisfied: false, missing: [{ prerequisiteNodeId: UE1, mode: "VALIDATED", minAverage: null, reason: "NOT_ACQUIRED" }] },
    });
    renderWithProviders(<PrerequisitesScreen />);
    await openUe(/Réseaux/);
    fireEvent.focus(await screen.findByRole("combobox", { name: /Étudiant/ }));
    fireEvent.click(await screen.findByRole("option", { name: /AKA Marie/ }));
    expect(await screen.findByText("Prérequis non satisfaits")).toBeTruthy();
    const missing = screen.getByRole("list", { name: "Prérequis manquants" });
    expect(within(missing).getByText(/UE validée : UE non acquise/)).toBeTruthy();
    const call = api.calls.find((c) => c.path.endsWith("/prerequisites-check"))!;
    expect(call.query).toEqual({ nodeId: UE3 });
  });

  it("lecture seule (higher.credits.read) : liste sans édition, contrôle disponible", async () => {
    setTestApi({
      ...base,
      ...accessRoutes(["higher.credits.read"], ["higher.prerequisites"]),
      [`GET ${H}/ue/${UE3}/prerequisites`]: { items: [prereq({ mode: "MIN_AVERAGE", minAverage: "10" })] },
    });
    renderWithProviders(<PrerequisitesScreen />);
    await openUe(/Réseaux/);
    const form = await screen.findByRole("form", { name: "Prérequis de Réseaux" });
    expect(await within(form).findByText("Algorithmique")).toBeTruthy();
    expect(within(form).getByText("moyenne d'au moins 10")).toBeTruthy();
    expect(within(form).queryByRole("button", { name: "Enregistrer les prérequis" })).toBeNull();
    expect(within(form).queryByRole("button", { name: "Ajouter un prérequis" })).toBeNull();
    expect(screen.getByRole("combobox", { name: /Étudiant/ })).toBeTruthy();
  });

  it("sans permission : accès refusé ; fonction absente de l'offre : message", async () => {
    setTestApi({ ...base, ...accessRoutes([], ["higher.prerequisites"]) });
    const { unmount } = renderWithProviders(<PrerequisitesScreen />);
    expect(await screen.findByText("Vous n'avez pas les droits nécessaires pour cette action.")).toBeTruthy();
    unmount();
    setTestApi({ ...base, ...accessRoutes(["higher.prerequisite.manage"], []) });
    renderWithProviders(<PrerequisitesScreen />);
    expect(await screen.findByText("Les prérequis entre UE ne sont pas inclus dans l'offre de votre établissement.")).toBeTruthy();
  });

  it("« Afficher tous les éléments » propose aussi les nœuds sans crédits", async () => {
    setTestApi({ ...base, [`GET ${H}/ue/${UE3}/prerequisites`]: { items: [] } });
    renderWithProviders(<PrerequisitesScreen />);
    await pickProgramAndYear();
    await screen.findByRole("button", { name: /Réseaux/ });
    expect(screen.queryByRole("button", { name: /Texte libre/ })).toBeNull();
    fireEvent.click(screen.getByRole("checkbox", { name: /Afficher tous les éléments/ }));
    expect(await screen.findByRole("button", { name: /Texte libre/ })).toBeTruthy();
  });
});
