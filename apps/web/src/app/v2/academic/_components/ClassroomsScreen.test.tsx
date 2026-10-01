// @vitest-environment jsdom
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { accessRoutes, setTestApi } from "@/platform/test/api-mock";
import { json, renderWithProviders } from "@/platform/test/render";
import { classroom, educationLevels, gradeLevels, program, uuid, year } from "../../_test/fixtures";
import { ClassroomsScreen } from "./ClassroomsScreen";
import { OfferingsScreen } from "./OfferingsScreen";
import { ProgramsScreen } from "./ProgramsScreen";

vi.mock("@/platform/api/default-client", async () => (await import("@/platform/test/api-mock")).defaultClientModule);
vi.mock("next/link", () => ({ default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a> }));

const base = {
  "GET /api/v1/academic/years": { items: [year({ id: uuid(100), label: "2026-2027" })] },
  "GET /api/v1/academic/programs": { items: [program()] },
  "GET /api/v1/academic/reference/grade-levels": { items: gradeLevels },
  "GET /api/v1/academic/reference/education-levels": { items: educationLevels },
};

describe("ClassroomsScreen", () => {
  it("liste paginée côté serveur : la page et les filtres partent dans la requête", async () => {
    const api = setTestApi({
      ...accessRoutes(["academic.classroom.read"]),
      ...base,
      "GET /api/v1/academic/classrooms": ({ url }) => json({ items: [classroom({ name: `Classe page ${url.searchParams.get("page")}` })], total: 45, page: Number(url.searchParams.get("page")), pageSize: Number(url.searchParams.get("pageSize")) }),
    });
    renderWithProviders(<ClassroomsScreen />);
    const table = await screen.findByRole("table", { name: "Liste des classes" });
    expect(await within(table).findByText("Classe page 1")).toBeTruthy();
    // Effectif / capacité, niveau résolu depuis le référentiel.
    expect(within(table).getByText("12 / 40")).toBeTruthy();
    expect(within(table).getByText("Licence 1")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Suivant/ }));
    await screen.findByText("Classe page 2");
    expect(api.calls.filter((c) => c.path === "/api/v1/academic/classrooms").at(-1)!.query).toMatchObject({ page: "2", pageSize: "20" });

    fireEvent.change(screen.getByLabelText("État"), { target: { value: "ACTIVE" } });
    await waitFor(() => expect(api.calls.filter((c) => c.path === "/api/v1/academic/classrooms").at(-1)!.query).toMatchObject({ status: "ACTIVE", page: "1" }));
  });

  it("le nom de la classe mène à sa fiche", async () => {
    setTestApi({ ...accessRoutes(["academic.classroom.read"]), ...base, "GET /api/v1/academic/classrooms": { items: [classroom()], total: 1, page: 1, pageSize: 20 } });
    renderWithProviders(<ClassroomsScreen />);
    const link = await screen.findByRole("link", { name: "Licence 1 A" });
    expect(link.getAttribute("href")).toBe(`/v2/academic/classrooms/${uuid(500)}`);
  });

  it("erreur de l'API : message et bouton Réessayer", async () => {
    setTestApi({ ...accessRoutes(["academic.classroom.read"]), ...base, "GET /api/v1/academic/classrooms": () => json({ code: "FORBIDDEN", message: "Lecture des classes refusée." }, { status: 403 }) });
    renderWithProviders(<ClassroomsScreen />);
    expect((await screen.findByRole("alert")).textContent).toContain("Lecture des classes refusée.");
    expect(screen.getByRole("button", { name: "Réessayer" })).toBeTruthy();
  });
});

describe("OfferingsScreen", () => {
  it("fonction non incluse dans l'offre : message explicite", async () => {
    setTestApi({ ...accessRoutes(["academic.classroom.read"], []), ...base });
    renderWithProviders(<OfferingsScreen />);
    expect(await screen.findByText(/n'est pas incluse dans l'offre/)).toBeTruthy();
    expect(screen.getByText("Choisissez une classe pour afficher ses offres.")).toBeTruthy();
  });

  it("offres d'une classe : places prises, état et actions selon l'état", async () => {
    const offering = { id: uuid(900), classroomId: uuid(500), curriculumNodeId: uuid(801), label: "Semestre 1", startsOn: "2026-09-01", endsOn: "2027-01-31", registrationOpensAt: null, registrationClosesAt: null, capacity: 30, status: "DRAFT", heldPlaces: 4 };
    const api = setTestApi({
      ...accessRoutes(["academic.classroom.read", "academic.classroom.manage"], ["academic.a-la-carte"]),
      ...base,
      "GET /api/v1/academic/classrooms": { items: [classroom()], total: 1, page: 1, pageSize: 200 },
      [`GET /api/v1/academic/classrooms/${uuid(500)}/offerings`]: { items: [offering] },
      [`POST /api/v1/academic/offerings/${uuid(900)}/open`]: { ...offering, status: "OPEN" },
    });
    renderWithProviders(<OfferingsScreen />);
    const input = await screen.findByRole("combobox", { name: /Classe ou promotion/ });
    fireEvent.focus(input);
    fireEvent.click(await screen.findByRole("option", { name: /Licence 1 A/ }));
    const table = await screen.findByRole("table", { name: "Offres de la classe" });
    expect(await within(table).findByText("4 / 30")).toBeTruthy();
    expect(within(table).getByText("Brouillon")).toBeTruthy();
    fireEvent.click(await within(table).findByRole("button", { name: /Ouvrir — Semestre 1/ }));
    await screen.findByText("L'offre Semestre 1 est ouverte.");
    expect(api.calls.some((c) => c.method === "POST" && c.path.endsWith("/open"))).toBe(true);
  });
});

describe("ProgramsScreen", () => {
  it("arbre des programmes (parent -> enfants) et niveaux couverts modifiables", async () => {
    const parent = program({ id: uuid(300), code: "LIC", label: "Licences", gradeLevelIds: [uuid(600)] });
    const child = program({ id: uuid(301), code: "LIC_INFO", label: "Licence Informatique", parentProgramId: uuid(300), gradeLevelIds: [] });
    const api = setTestApi({
      ...accessRoutes(["academic.program.read", "academic.program.manage"]),
      ...base,
      "GET /api/v1/academic/programs": { items: [child, parent] },
      [`PUT /api/v1/academic/programs/${uuid(300)}/grade-levels`]: { ...parent, gradeLevelIds: [uuid(600), uuid(601)] },
    });
    renderWithProviders(<ProgramsScreen />);
    const tree = await screen.findByRole("tree", { name: "Programmes" });
    const items = within(tree).getAllByRole("treeitem");
    expect(items[0]!.textContent).toContain("Licences");
    expect(items[0]!.getAttribute("aria-level")).toBe("1");
    expect(items[1]!.textContent).toContain("Licence Informatique");
    expect(items[1]!.getAttribute("aria-level")).toBe("2");
    fireEvent.click(items[0]!);
    const l1 = await screen.findByRole("checkbox", { name: /Licence 1/ });
    expect((l1 as HTMLInputElement).checked).toBe(true);
    const save = screen.getByRole("button", { name: "Enregistrer les niveaux" });
    expect((save as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole("checkbox", { name: /Licence 2/ }));
    await waitFor(() => expect((screen.getByRole("button", { name: "Enregistrer les niveaux" }) as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(screen.getByRole("button", { name: "Enregistrer les niveaux" }));
    await screen.findByText("Les niveaux couverts ont été enregistrés.");
    expect(api.calls.find((c) => c.method === "PUT")!.body).toEqual({ gradeLevelIds: [uuid(600), uuid(601)] });
  });
});
