// @vitest-environment jsdom
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { accessRoutes, setTestApi } from "@/platform/test/api-mock";
import { json, renderWithProviders } from "@/platform/test/render";
import { educationLevels, gradeLevels, node, nodeTypes, program, uuid, version, year } from "../../_test/fixtures";
import { CurriculumScreen } from "./CurriculumScreen";

vi.mock("@/platform/api/default-client", async () => (await import("@/platform/test/api-mock")).defaultClientModule);

const VERSION = version({ id: uuid(700), status: "DRAFT", nodeCount: 3 });
const ue = node({ id: uuid(801), code: "UE1", label: "Fondamentaux", credits: "6", children: [node({ id: uuid(802), parentId: uuid(801), nodeTypeCode: "ECUE", code: "ALGO", label: "Algorithmique", coefficient: "2", credits: "3", ordinal: 0 }), node({ id: uuid(803), parentId: uuid(801), nodeTypeCode: "ECUE", code: "BDD", label: "Bases de données", coefficient: "1.5", credits: "3", ordinal: 10 })] });
const TREE = { version: VERSION, roots: [ue] };

function routes(extra: Record<string, unknown> = {}, perms = ["curriculum.read", "curriculum.manage", "curriculum.publish", "curriculum.amend"]) {
  return {
    ...accessRoutes(perms),
    "GET /api/v1/academic/programs": { items: [program()] },
    "GET /api/v1/academic/years": { items: [year({ id: uuid(100), label: "2026-2027" }), year({ id: uuid(101), label: "2027-2028", startsOn: "2027-09-01", endsOn: "2028-08-31" })] },
    "GET /api/v1/academic/reference/node-types": { items: nodeTypes },
    "GET /api/v1/academic/reference/grade-levels": { items: gradeLevels },
    "GET /api/v1/academic/reference/period-types": { items: [] },
    "GET /api/v1/academic/reference/education-levels": { items: educationLevels },
    "GET /api/v1/academic/curriculum-versions": { items: [VERSION] },
    [`GET /api/v1/academic/curriculum-versions/${uuid(700)}`]: TREE,
    ...extra,
  };
}

async function pickProgramAndYear() {
  // Les options arrivent de l'API : attendre leur chargement avant de choisir.
  await screen.findByRole("option", { name: /Licence Informatique/ });
  await screen.findByRole("option", { name: "2026-2027" });
  fireEvent.change(screen.getByLabelText("Programme"), { target: { value: uuid(300) } });
  fireEvent.change(screen.getByLabelText("Année"), { target: { value: uuid(100) } });
}

async function openTree() {
  await pickProgramAndYear();
  return screen.findByRole("tree", { name: "Curriculum" });
}

describe("CurriculumScreen", () => {
  it("demande d'abord un programme et une année, puis affiche l'arbre avec coefficients et crédits", async () => {
    setTestApi(routes());
    renderWithProviders(<CurriculumScreen />);
    expect(await screen.findByText("Choisissez un programme et une année pour afficher son curriculum.")).toBeTruthy();
    const tree = await openTree();
    const items = within(tree).getAllByRole("treeitem");
    expect(items.map((i) => i.textContent)).toEqual([expect.stringContaining("Fondamentaux"), expect.stringContaining("Algorithmique"), expect.stringContaining("Bases de données")]);
    // Décimaux exacts affichés à la française, sans passer par un flottant.
    expect(items[2]!.textContent).toContain("coef. 1,5");
    expect(items[1]!.textContent).toContain("3 crédits");
  });

  it("aucune version : propose de créer un brouillon et envoie programme + année", async () => {
    const api = setTestApi(routes({ "GET /api/v1/academic/curriculum-versions": { items: [] }, "POST /api/v1/academic/curriculum-versions": () => json(VERSION, { status: 201 }) }));
    renderWithProviders(<CurriculumScreen />);
    await pickProgramAndYear();
    fireEvent.click(await screen.findByRole("button", { name: "Créer une version vide" }));
    await screen.findByText("La version a été créée.");
    expect(api.calls.find((c) => c.method === "POST")!.body).toEqual({ programId: uuid(300), academicYearId: uuid(100) });
  });

  it("édition d'un nœud : n'envoie que les champs modifiés, décimal normalisé (virgule -> point)", async () => {
    const api = setTestApi(routes({ [`PATCH /api/v1/academic/curriculum-nodes/${uuid(802)}`]: () => json({ ...ue.children[0], coefficient: "2.5" }) }));
    renderWithProviders(<CurriculumScreen />);
    const tree = await openTree();
    fireEvent.click(within(tree).getByRole("treeitem", { name: /Algorithmique/ }));
    fireEvent.click(await screen.findByRole("button", { name: "Modifier" }));
    const form = await screen.findByRole("form", { name: "Modification du nœud" });
    fireEvent.change(within(form).getByLabelText("Coefficient"), { target: { value: "2,5" } });
    fireEvent.click(within(form).getByRole("button", { name: "Enregistrer" }));
    await screen.findByText("Le nœud a été mis à jour.");
    expect(api.calls.find((c) => c.method === "PATCH")!.body).toEqual({ coefficient: "2.5" });
  });

  it("une valeur décimale invalide est refusée localement par le contrat", async () => {
    const api = setTestApi(routes());
    renderWithProviders(<CurriculumScreen />);
    const tree = await openTree();
    fireEvent.click(within(tree).getByRole("treeitem", { name: /Algorithmique/ }));
    fireEvent.click(await screen.findByRole("button", { name: "Modifier" }));
    const form = await screen.findByRole("form", { name: "Modification du nœud" });
    fireEvent.change(within(form).getByLabelText("Coefficient"), { target: { value: "beaucoup" } });
    fireEvent.click(within(form).getByRole("button", { name: "Enregistrer" }));
    await waitFor(() => expect(within(form).getAllByRole("alert").length).toBeGreaterThan(0));
    expect(api.calls.filter((c) => c.method === "PATCH")).toHaveLength(0);
  });

  it("ajout d'un enfant : les types proposés suivent la grammaire de l'API (parents autorisés)", async () => {
    const api = setTestApi(routes({ [`POST /api/v1/academic/curriculum-versions/${uuid(700)}/nodes`]: ({ body }) => json({ ...node({ id: uuid(850), code: (body as { code: string }).code, label: (body as { label: string }).label, nodeTypeCode: "ECUE" }) }, { status: 201 }) }));
    renderWithProviders(<CurriculumScreen />);
    const tree = await openTree();
    fireEvent.click(within(tree).getByRole("treeitem", { name: /Fondamentaux/ }));
    fireEvent.click(await screen.findByRole("button", { name: "Ajouter un enfant" }));
    const dialog = await screen.findByRole("dialog");
    const select = await within(dialog).findByLabelText(/Type de nœud/);
    // Sous une UE : seul ECUE est autorisé (UE et Semestre n'ont que la racine pour parent).
    await waitFor(() => expect(within(select).getAllByRole("option").map((o) => o.textContent)).toEqual(["Choisir…", "Élément constitutif"]));
    fireEvent.change(select, { target: { value: "ECUE" } });
    fireEvent.change(within(dialog).getByLabelText(/^Code/), { target: { value: "reseaux" } });
    fireEvent.change(within(dialog).getByLabelText(/^Libellé/), { target: { value: "Réseaux" } });
    fireEvent.change(within(dialog).getByLabelText("Coefficient"), { target: { value: "2" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Ajouter" }));
    await screen.findByText("Le nœud Réseaux a été ajouté.");
    expect(api.calls.find((c) => c.method === "POST")!.body).toEqual({ parentId: uuid(801), nodeTypeCode: "ECUE", code: "RESEAUX", label: "Réseaux", isMandatory: true, coefficient: "2" });
  });

  it("version publiée : édition directe masquée, amendement motivé proposé", async () => {
    const published = { version: version({ id: uuid(700), status: "PUBLISHED" }), roots: [ue] };
    const api = setTestApi(routes({ [`GET /api/v1/academic/curriculum-versions/${uuid(700)}`]: published, [`POST /api/v1/academic/curriculum-versions/${uuid(700)}/amend`]: {} }));
    renderWithProviders(<CurriculumScreen />);
    const tree = await openTree();
    fireEvent.click(within(tree).getByRole("treeitem", { name: /Algorithmique/ }));
    await screen.findByRole("button", { name: "Amender" });
    expect(screen.queryByRole("button", { name: "Modifier" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Publier" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Amender" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText("Coefficient"), { target: { value: "3" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Continuer" }));
    const reasonDialog = await screen.findByRole("dialog");
    fireEvent.change(within(reasonDialog).getByLabelText(/Motif/), { target: { value: "Décision du conseil pédagogique" } });
    fireEvent.click(within(reasonDialog).getByRole("button", { name: "Amender" }));
    await screen.findByText("L'amendement a été enregistré.");
    expect(api.calls.find((c) => c.method === "POST")!.body).toEqual({ reason: "Décision du conseil pédagogique", operations: [{ op: "UPDATE_NODE", nodeId: uuid(802), patch: { coefficient: "3" } }] });
  });

  it("clonage : aperçu du contenu copié, avertissement si l'année cible a déjà une version", async () => {
    const api = setTestApi(
      routes({
        "GET /api/v1/academic/curriculum-versions": ({ url }) => json({ items: url.searchParams.get("yearId") === uuid(101) ? [version({ id: uuid(710), academicYearId: uuid(101) })] : [VERSION] }),
        [`GET /api/v1/academic/curriculum-versions/${uuid(700)}/validate`]: { versionId: uuid(700), valid: true, errors: 0, warnings: 0, issues: [], stats: { nodes: 3, byType: { UE: 1, ECUE: 2 } } },
        [`POST /api/v1/academic/curriculum-versions/${uuid(700)}/clone`]: () => json(version({ id: uuid(711), academicYearId: uuid(101) }), { status: 201 }),
      }),
    );
    renderWithProviders(<CurriculumScreen />);
    await openTree();
    fireEvent.click(await screen.findByRole("button", { name: "Cloner vers une autre année" }));
    const dialog = await screen.findByRole("dialog");
    // L'année suivante est proposée d'office ; l'aperçu compte les nœuds par type.
    await waitFor(() => expect((within(dialog).getByLabelText(/Année de destination/) as HTMLSelectElement).value).toBe(uuid(101)));
    expect(within(dialog).getByText("3 nœuds seront copiés.")).toBeTruthy();
    expect(within(dialog).getByText("Unité d'enseignement : 1")).toBeTruthy();
    expect(within(dialog).getByText("Élément constitutif : 2")).toBeTruthy();
    await within(dialog).findByText(/déjà une version de ce programme/);
    fireEvent.click(within(dialog).getByRole("button", { name: "Cloner" }));
    await screen.findByText(/Le curriculum a été cloné/);
    expect(api.calls.find((c) => c.method === "POST")!.body).toEqual({ academicYearId: uuid(101) });
  });

  it("rapport de validation : erreurs listées avec accès au nœud concerné", async () => {
    setTestApi(
      routes({
        [`GET /api/v1/academic/curriculum-versions/${uuid(700)}/validate`]: {
          versionId: uuid(700),
          valid: false,
          errors: 1,
          warnings: 0,
          issues: [{ severity: "ERROR", code: "academic.credits_mismatch", nodeId: uuid(801), message: "Les crédits de l'UE ne correspondent pas à ses enfants." }],
          stats: { nodes: 3, byType: {} },
        },
      }),
    );
    renderWithProviders(<CurriculumScreen />);
    await openTree();
    fireEvent.click(await screen.findByRole("button", { name: "Rapport de validation" }));
    await screen.findByText("1 erreur et aucun avertissement à corriger avant publication.");
    fireEvent.click(screen.getByRole("button", { name: "Aller au nœud" }));
    expect(await screen.findByRole("heading", { level: 2, name: "Fondamentaux" })).toBeTruthy();
  });
});
