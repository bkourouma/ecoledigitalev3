// @vitest-environment jsdom
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { accessRoutes, setTestApi } from "@/platform/test/api-mock";
import { json, renderWithProviders } from "@/platform/test/render";
import { educationLevels, institution, program, uuid } from "../../_test/fixtures";
import { ruleSet } from "../_test/fixtures";
import { BindingsScreen } from "./BindingsScreen";
import { bindingState, groupByContract, isEffective, programsWithoutBinding, scopeKind } from "./bindings-model";

vi.mock("@/platform/api/default-client", async () => (await import("@/platform/test/api-mock")).defaultClientModule);
vi.mock("next/link", () => ({ default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a> }));

const READ = accessRoutes(["rules.ruleset.read"]);
const WRITE = accessRoutes(["rules.ruleset.read", "rules.binding.manage"]);

const CREDIT = "credit-semester@1";
const COEF = "coef-semester@1";
const contracts = {
  items: [
    { id: CREDIT, name: "Semestre à crédits", description: "Moyennes par UE et crédits capitalisables." },
    { id: COEF, name: "Semestre à coefficients", description: "Moyennes pondérées par coefficients." },
  ],
};
const binding = (over: Partial<Record<string, unknown>> = {}) => ({
  id: uuid(7000),
  contractId: CREDIT,
  ruleSetCode: "CI-HIGHER-LMD",
  institutionId: null,
  curriculumNodeId: null,
  levelCode: null,
  effectiveFrom: "2025-09-01",
  effectiveTo: null,
  createdAt: "2026-01-01T08:00:00.000Z",
  ...over,
});

const programInfo = program({ id: uuid(300), label: "Licence Informatique", code: "LIC_INFO" });
const programGestion = program({ id: uuid(301), label: "Licence Gestion", code: "LIC_GEST" });
const BINDINGS = "GET /api/v1/rules/bindings";

function routes(bindings: unknown[], extra: Record<string, unknown> = {}) {
  return {
    "GET /api/v1/rules/contracts": contracts,
    [BINDINGS]: { items: bindings },
    "GET /api/v1/rules/rule-sets": { items: [ruleSet(), ruleSet({ id: uuid(6501), code: "CI-HIGHER-ALT", name: "Variante de l'établissement", origin: "tenant" })] },
    "GET /api/v1/academic/programs": { items: [programInfo, programGestion] },
    "GET /api/v1/academic/reference/education-levels": { items: educationLevels },
    "GET /api/v1/tenancy/institutions": { items: [institution] },
    ...extra,
  };
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-02T09:00:00.000Z"));
});
afterEach(() => vi.useRealTimers());

describe("bindings-model", () => {
  it("nature du périmètre, état par date, regroupement par contrat", () => {
    expect(scopeKind({ institutionId: null, curriculumNodeId: null, levelCode: null })).toBe("tenant");
    expect(scopeKind({ institutionId: uuid(1), curriculumNodeId: null, levelCode: null })).toBe("institution");
    expect(scopeKind({ institutionId: null, curriculumNodeId: uuid(300), levelCode: null })).toBe("program");
    expect(scopeKind({ institutionId: null, curriculumNodeId: null, levelCode: "HIGHER" })).toBe("level");
    expect(bindingState({ effectiveFrom: "2026-11-01", effectiveTo: null }, "2026-10-02")).toBe("upcoming");
    expect(bindingState({ effectiveFrom: "2025-09-01", effectiveTo: "2026-08-31" }, "2026-10-02")).toBe("expired");
    expect(isEffective({ effectiveFrom: "2025-09-01", effectiveTo: "2026-10-02" }, "2026-10-02")).toBe(true);
    const groups = groupByContract([{ contractId: "b@1" }, { contractId: "a@1" }, { contractId: "z@9" }], ["a@1", "b@1"]);
    expect(groups.map((g) => [g.contractId, g.items.length])).toEqual([["a@1", 1], ["b@1", 1], ["z@9", 1]]);
  });

  it("programme sans liaison : ni propre, ni générale, ni par niveau", () => {
    const b = (over: Record<string, unknown>) => binding(over) as never;
    const programs = [{ id: "p1" }, { id: "p2" }];
    const of = () => CREDIT;
    expect(programsWithoutBinding(programs, of, CREDIT, [], "2026-10-02").map((p) => p.id)).toEqual(["p1", "p2"]);
    expect(programsWithoutBinding(programs, of, CREDIT, [b({ curriculumNodeId: "p1" })], "2026-10-02").map((p) => p.id)).toEqual(["p2"]);
    expect(programsWithoutBinding(programs, of, CREDIT, [b({})], "2026-10-02")).toEqual([]);
    expect(programsWithoutBinding(programs, of, CREDIT, [b({ levelCode: "HIGHER" })], "2026-10-02")).toEqual([]);
    // Une liaison échue ne compte pas.
    expect(programsWithoutBinding(programs, of, CREDIT, [b({ effectiveTo: "2026-08-31" })], "2026-10-02").map((p) => p.id)).toEqual(["p1", "p2"]);
    // Autre contrat : ignoré.
    expect(programsWithoutBinding(programs, () => COEF, CREDIT, [], "2026-10-02")).toEqual([]);
  });
});

describe("BindingsScreen", () => {
  it("regroupe par contrat, nomme le programme, le niveau et l'établissement, situe chaque liaison dans le temps", async () => {
    setTestApi({
      ...READ,
      ...routes([
        binding({ id: uuid(7001), curriculumNodeId: uuid(300) }),
        binding({ id: uuid(7002), levelCode: "HIGHER", effectiveFrom: "2026-11-01" }),
        binding({ id: uuid(7003), contractId: COEF, institutionId: institution.id, effectiveFrom: "2024-09-01", effectiveTo: "2025-08-31", ruleSetCode: "CI-HIGHER-ALT" }),
        binding({ id: uuid(7004), contractId: COEF }),
      ]),
    });
    renderWithProviders(<BindingsScreen />);
    const credit = await screen.findByRole("table", { name: "Liaisons du contrat Semestre à crédits" });
    expect(within(credit).getByText("Programme : Licence Informatique")).toBeTruthy();
    expect(within(credit).getByText("Niveau : HIGHER")).toBeTruthy();
    expect(within(credit).getAllByText("LMD Côte d'Ivoire").length).toBe(2);
    expect(within(credit).getByText("En vigueur")).toBeTruthy();
    expect(within(credit).getByText("À venir")).toBeTruthy();
    const coef = screen.getByRole("table", { name: "Liaisons du contrat Semestre à coefficients" });
    expect(within(coef).getByText("Établissement : Établissement principal")).toBeTruthy();
    expect(within(coef).getByText("Tout l'établissement (par défaut)")).toBeTruthy();
    expect(within(coef).getByText("Échue")).toBeTruthy();
    expect(within(coef).getByText("Variante de l'établissement")).toBeTruthy();
    // Lecture seule : aucune action d'écriture.
    expect(screen.queryByRole("button", { name: "Ajouter une liaison" })).toBeNull();
    expect(screen.queryByRole("button", { name: /Supprimer — / })).toBeNull();
  });

  it("alerte « aucune règle active » pour un programme sans liaison, croisée avec la liste des programmes", async () => {
    setTestApi({
      ...READ,
      ...routes([binding({ id: uuid(7001), curriculumNodeId: uuid(300) }), binding({ id: uuid(7005), contractId: COEF })]),
    });
    renderWithProviders(<BindingsScreen />);
    const alert = await screen.findByText("1 programme sans règle active");
    const box = alert.closest("[role=alert]") as HTMLElement;
    expect(within(box).getByText("Le programme « Licence Gestion » n'a aucune règle active pour le contrat « Semestre à crédits ».")).toBeTruthy();
    expect(within(box).queryByText(/Licence Informatique/)).toBeNull();
    expect(within(box).getByText(/Seul le serveur détermine/)).toBeTruthy();
  });

  it("aucune alerte quand une liaison générale couvre le contrat", async () => {
    setTestApi({ ...READ, ...routes([binding()]) });
    renderWithProviders(<BindingsScreen />);
    await screen.findByRole("table", { name: "Liaisons du contrat Semestre à crédits" });
    expect(screen.queryByText(/sans règle active/)).toBeNull();
  });

  it("contrat sans liaison : état vide explicite", async () => {
    setTestApi({ ...READ, ...routes([binding({ contractId: COEF })]) });
    renderWithProviders(<BindingsScreen />);
    expect(await screen.findByText("Aucune liaison pour ce contrat.")).toBeTruthy();
  });

  it("création pour un programme : validation de forme sans appel, puis corps exact", async () => {
    const api = setTestApi({
      ...WRITE,
      ...routes([binding({ contractId: COEF })], { "PUT /api/v1/rules/bindings": ({ body }) => json({ ...binding({ id: uuid(7010) }), ...(body as object) }) }),
    });
    renderWithProviders(<BindingsScreen />);
    await screen.findAllByRole("table", { name: /Liaisons du contrat/ });
    fireEvent.click(await screen.findByRole("button", { name: "Ajouter une liaison" }));
    const dialog = await screen.findByRole("dialog", { name: "Ajouter une liaison" });
    fireEvent.click(within(dialog).getByRole("radio", { name: /Un programme/ }));
    fireEvent.click(within(dialog).getByRole("button", { name: "Enregistrer" }));
    await waitFor(() => expect(within(dialog).getAllByRole("alert").length).toBeGreaterThan(0));
    expect(within(dialog).getByText("Choisissez le programme.")).toBeTruthy();
    expect(api.calls.filter((c) => c.method === "PUT")).toHaveLength(0);

    fireEvent.change(within(dialog).getByLabelText(/Contrat de calcul/), { target: { value: CREDIT } });
    const ruleSets = within(dialog).getByLabelText(/Jeu de règles/) as HTMLSelectElement;
    await waitFor(() => expect(ruleSets.options.length).toBeGreaterThan(1));
    fireEvent.change(ruleSets, { target: { value: "CI-HIGHER-LMD" } });
    const programs = within(dialog).getByLabelText(/^Programme/) as HTMLSelectElement;
    await waitFor(() => expect(programs.options.length).toBeGreaterThan(1));
    fireEvent.change(programs, { target: { value: uuid(301) } });
    fireEvent.change(within(dialog).getByLabelText(/En vigueur à partir du/), { target: { value: "2026-09-01" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Enregistrer" }));
    await screen.findByText("La liaison est créée.");
    expect(api.calls.find((c) => c.method === "PUT")!.body).toEqual({
      contractId: CREDIT,
      ruleSetCode: "CI-HIGHER-LMD",
      institutionId: null,
      curriculumNodeId: uuid(301),
      levelCode: null,
      effectiveFrom: "2026-09-01",
      effectiveTo: null,
    });
  });

  it("création pour un niveau avec date de fin ; l'erreur du serveur (403 sensible) est affichée", async () => {
    let denied = true;
    const api = setTestApi({
      ...WRITE,
      ...routes([], {
        "PUT /api/v1/rules/bindings": () => {
          if (denied) {
            denied = false;
            return json({ code: "rules.binding_conflict", message: "Une liaison existe déjà pour ce périmètre à cette date." }, { status: 409 });
          }
          return json(binding({ id: uuid(7011), levelCode: "HIGHER" }));
        },
      }),
    });
    renderWithProviders(<BindingsScreen />);
    await screen.findAllByRole("table", { name: /Liaisons du contrat/ });
    fireEvent.click(await screen.findByRole("button", { name: "Ajouter une liaison" }));
    const dialog = await screen.findByRole("dialog", { name: "Ajouter une liaison" });
    fireEvent.change(within(dialog).getByLabelText(/Contrat de calcul/), { target: { value: CREDIT } });
    const ruleSets = within(dialog).getByLabelText(/Jeu de règles/) as HTMLSelectElement;
    await waitFor(() => expect(ruleSets.options.length).toBeGreaterThan(1));
    fireEvent.change(ruleSets, { target: { value: "CI-HIGHER-ALT" } });
    fireEvent.click(within(dialog).getByRole("radio", { name: /Un niveau/ }));
    fireEvent.change(within(dialog).getByLabelText(/Code du niveau/), { target: { value: "HIGHER" } });
    fireEvent.change(within(dialog).getByLabelText(/En vigueur à partir du/), { target: { value: "2026-09-01" } });
    fireEvent.change(within(dialog).getByLabelText(/Jusqu'au/), { target: { value: "2027-08-31" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Enregistrer" }));
    expect(await within(dialog).findByText("Une liaison existe déjà pour ce périmètre à cette date.")).toBeTruthy();
    fireEvent.click(within(dialog).getByRole("button", { name: "Enregistrer" }));
    await screen.findByText("La liaison est créée.");
    expect(api.calls.filter((c) => c.method === "PUT")[1]!.body).toEqual({
      contractId: CREDIT,
      ruleSetCode: "CI-HIGHER-ALT",
      institutionId: null,
      curriculumNodeId: null,
      levelCode: "HIGHER",
      effectiveFrom: "2026-09-01",
      effectiveTo: "2027-08-31",
    });
  });

  it("modification : périmètre et date de début verrouillés, le jeu de règles et la date de fin partent", async () => {
    const api = setTestApi({
      ...WRITE,
      ...routes([binding({ id: uuid(7001), curriculumNodeId: uuid(300) })], { "PUT /api/v1/rules/bindings": () => json(binding({ id: uuid(7001), curriculumNodeId: uuid(300), ruleSetCode: "CI-HIGHER-ALT", effectiveTo: "2027-08-31" })) }),
    });
    renderWithProviders(<BindingsScreen />);
    fireEvent.click(await screen.findByRole("button", { name: /Modifier — CI-HIGHER-LMD \(Programme : Licence Informatique\)/ }));
    const dialog = await screen.findByRole("dialog", { name: "Modifier la liaison" });
    expect((within(dialog).getByLabelText(/Contrat de calcul/) as HTMLSelectElement).disabled).toBe(true);
    expect((within(dialog).getByLabelText(/En vigueur à partir du/) as HTMLInputElement).disabled).toBe(true);
    expect(within(dialog).getByRole("radio", { name: /Un programme/ }).matches(":disabled")).toBe(true);
    const ruleSets = within(dialog).getByLabelText(/Jeu de règles/) as HTMLSelectElement;
    await waitFor(() => expect(ruleSets.options.length).toBeGreaterThan(2));
    fireEvent.change(ruleSets, { target: { value: "CI-HIGHER-ALT" } });
    fireEvent.change(within(dialog).getByLabelText(/Jusqu'au/), { target: { value: "2027-08-31" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Enregistrer" }));
    await screen.findByText("La liaison est enregistrée.");
    expect(api.calls.find((c) => c.method === "PUT")!.body).toEqual({
      contractId: CREDIT,
      ruleSetCode: "CI-HIGHER-ALT",
      institutionId: null,
      curriculumNodeId: uuid(300),
      levelCode: null,
      effectiveFrom: "2025-09-01",
      effectiveTo: "2027-08-31",
    });
  });

  it("suppression : confirmation explicite, puis DELETE ; erreur du serveur affichée dans la boîte", async () => {
    let fail = true;
    const api = setTestApi({
      ...WRITE,
      ...routes([binding({ id: uuid(7001), curriculumNodeId: uuid(300) }), binding({ id: uuid(7002) })], {
        [`DELETE /api/v1/rules/bindings/${uuid(7001)}`]: () => {
          if (fail) {
            fail = false;
            return json({ code: "rules.binding_in_use", message: "Cette liaison est utilisée par une période verrouillée." }, { status: 409 });
          }
          return new Response(null, { status: 204 });
        },
      }),
    });
    renderWithProviders(<BindingsScreen />);
    fireEvent.click(await screen.findByRole("button", { name: /Supprimer — CI-HIGHER-LMD \(Programme : Licence Informatique\)/ }));
    const dialog = await screen.findByRole("dialog", { name: "Supprimer cette liaison ?" });
    expect(api.calls.filter((c) => c.method === "DELETE")).toHaveLength(0);
    fireEvent.click(within(dialog).getByRole("button", { name: "Supprimer la liaison" }));
    expect(await within(dialog).findByText("Cette liaison est utilisée par une période verrouillée.")).toBeTruthy();
    fireEvent.click(within(dialog).getByRole("button", { name: "Supprimer la liaison" }));
    await screen.findByText("La liaison est supprimée.");
    expect(api.calls.filter((c) => c.method === "DELETE")).toHaveLength(2);
  });

  it("sans la permission de lecture : accès refusé ; erreur de chargement affichée", async () => {
    setTestApi({ ...accessRoutes([]), ...routes([]) });
    const { unmount } = renderWithProviders(<BindingsScreen />);
    expect(await screen.findByText("Vous n'avez pas les droits nécessaires pour cette action.")).toBeTruthy();
    unmount();
    setTestApi({ ...READ, ...routes([]), [BINDINGS]: () => json({ code: "rules.unavailable", message: "Le moteur de règles est indisponible." }, { status: 422 }) });
    renderWithProviders(<BindingsScreen />);
    expect(await screen.findByText("Le moteur de règles est indisponible.")).toBeTruthy();
  });
});
