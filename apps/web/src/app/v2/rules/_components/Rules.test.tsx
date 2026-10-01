// @vitest-environment jsdom
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { accessRoutes, setTestApi } from "@/platform/test/api-mock";
import { json, renderWithProviders } from "@/platform/test/render";
import { classroom, period } from "../../_test/fixtures";
import { ruleDef, ruleSet, simulationDto, tenantDraft, uuid, versionDetail, versionSummary } from "../_test/fixtures";
import { RuleSetsScreen } from "./RuleSetsScreen";
import { RuleVersionScreen } from "./RuleVersionScreen";
import { excerptAt } from "./RuleEditor";

vi.mock("@/platform/api/default-client", async () => (await import("@/platform/test/api-mock")).defaultClientModule);

const TENANT_ID = uuid(6101);
const V = (id: string, suffix = "") => `/api/v1/rules/rule-versions/${id}${suffix}`;
const ALL = ["rules.ruleset.read", "rules.version.create", "rules.version.edit", "rules.version.edit_expression", "rules.version.simulate", "rules.version.propose"];
const FEATURES = ["rules.variants", "rules.expression-editor", "rules.simulation"];

describe("RuleSetsScreen — catalogue", () => {
  const sets = [ruleSet(), ruleSet({ id: uuid(6501), code: "ETAB-LMD", name: "Variante de l'établissement", origin: "tenant", basedOnSetId: uuid(6500), versions: [versionSummary({ id: TENANT_ID, ruleSetCode: "ETAB-LMD", origin: "tenant", status: "draft", rowVersion: 2 })] })];

  it("distingue les jeux nationaux (lecture seule) des variantes et propose la dérivation d'une version publiée", async () => {
    const api = setTestApi({
      ...accessRoutes(ALL, FEATURES),
      "GET /api/v1/rules/rule-sets": { items: sets },
      "POST /api/v1/rules/rule-sets/CI-HIGHER-LMD/variants": ({ body }) => json({ ...tenantDraft(), notes: (body as { notes?: string }).notes ?? null }, { status: 201 }),
    });
    renderWithProviders(<RuleSetsScreen />);
    const national = await screen.findByRole("article", { name: "LMD Côte d'Ivoire" });
    expect(within(national).getByText("Lecture seule")).toBeTruthy();
    expect(within(national).getByText("National")).toBeTruthy();
    const tenant = screen.getByRole("article", { name: "Variante de l'établissement" });
    expect(within(tenant).getByText("Brouillon")).toBeTruthy();
    // dérivation seulement depuis une version nationale publiée
    expect(within(tenant).queryByRole("button", { name: /Créer une variante/ })).toBeNull();
    fireEvent.click(await within(national).findByRole("button", { name: /Créer une variante de la version 1/ }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Créer la variante" }));
    await waitFor(() => expect(within(dialog).getAllByRole("alert").length).toBeGreaterThan(0));
    expect(api.calls.filter((c) => c.method === "POST")).toHaveLength(0);
    fireEvent.change(within(dialog).getByLabelText(/Date d'effet/), { target: { value: "2026-09-01" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Créer la variante" }));
    await screen.findByText(/La variante est créée en brouillon/);
    expect(api.calls.find((c) => c.method === "POST")!.body).toEqual({ baseVersionId: uuid(6100), effectiveFrom: "2026-09-01" });
    expect(screen.getByRole("link", { name: "Ouvrir la variante" }).getAttribute("href")).toBe(`/v2/rules/versions/${TENANT_ID}`);
  });

  it("sans permission ou sans option de l'offre : aucune dérivation ; filtre par origine ; état vide", async () => {
    setTestApi({ ...accessRoutes(["rules.ruleset.read"], []), "GET /api/v1/rules/rule-sets": { items: sets } });
    renderWithProviders(<RuleSetsScreen />);
    await screen.findByRole("article", { name: "LMD Côte d'Ivoire" });
    expect(screen.queryByRole("button", { name: /Créer une variante/ })).toBeNull();
    fireEvent.change(screen.getByLabelText("Origine"), { target: { value: "tenant" } });
    expect(screen.queryByRole("article", { name: "LMD Côte d'Ivoire" })).toBeNull();
    fireEvent.change(screen.getByLabelText("Rechercher un jeu de règles"), { target: { value: "zzz" } });
    expect(await screen.findByText("Aucun jeu de règles.")).toBeTruthy();
  });

  it("erreur de l'API avec bouton Réessayer", async () => {
    setTestApi({ ...accessRoutes(ALL, FEATURES), "GET /api/v1/rules/rule-sets": () => json({ code: "FORBIDDEN", message: "Accès refusé au catalogue." }, { status: 403 }) });
    renderWithProviders(<RuleSetsScreen />);
    expect((await screen.findByRole("alert")).textContent).toContain("Accès refusé au catalogue.");
    expect(screen.getByRole("button", { name: "Réessayer" })).toBeTruthy();
  });
});

describe("RuleVersionScreen — éditeur d'expressions", () => {
  const routes = (detail: Record<string, unknown>, extra: Record<string, unknown> = {}) => ({
    ...accessRoutes(ALL, FEATURES),
    [`GET ${V(detail.id as string)}`]: detail,
    "GET /api/v1/rules/contracts/credit-semester@1": {
      id: "credit-semester@1",
      name: "Semestre à crédits",
      description: "Contrat LMD",
      rules: [{ key: "moyenne_ue", type: "period_average", optional: false, inputs: { notes: { type: "array" } }, result: "number?", outputCodes: [], parameters: {}, description: "Moyenne de l'UE." }],
      pipeline: [],
    },
    ...extra,
  });

  it("version nationale : lecture seule (aucune modification, aucune transition)", async () => {
    setTestApi(routes(versionDetail()));
    renderWithProviders(<RuleVersionScreen id={uuid(6100)} />);
    expect(await screen.findByText(/Version nationale : en lecture seule/)).toBeTruthy();
    const area = await screen.findByLabelText(/Expression/);
    expect((area as HTMLTextAreaElement).readOnly).toBe(true);
    expect(screen.queryByRole("button", { name: /Enregistrer l'expression/ })).toBeNull();
    expect(screen.queryByRole("button", { name: "Marquer comme simulée" })).toBeNull();
    expect(screen.queryByLabelText(/Valeur de seuil_validation/)).toBeNull();
  });

  it("expression invalide : refusée par l'API, diagnostic en français avec position et extrait", async () => {
    const api = setTestApi(
      routes(tenantDraft(), {
        [`PUT ${V(TENANT_ID, "/rules/moyenne_ue")}`]: () =>
          json(
            { code: "rules.invalid_input", message: "Expression attendue après « / ».", details: { issues: [{ path: ["expression"], message: "Expression attendue après « / »." }], diagnostics: [{ code: "syntax", phase: "parse", message: "Expression attendue après « / ».", hint: "Ajoutez l'opérande de droite.", position: { start: 13, end: 13, line: 1, column: 14 } }], ruleKey: "moyenne_ue" } },
            { status: 422 },
          ),
      }),
    );
    renderWithProviders(<RuleVersionScreen id={TENANT_ID} />);
    const area = (await screen.findByLabelText(/Expression/)) as HTMLTextAreaElement;
    await waitFor(() => expect(area.readOnly).toBe(false));
    fireEvent.change(area, { target: { value: "sum(notes) / " } });
    fireEvent.click(screen.getByRole("button", { name: "Enregistrer l'expression de moyenne_ue" }));
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("Expression attendue après « / ».");
    expect(alert.textContent).toContain("ligne 1, colonne 14");
    expect(alert.textContent).toContain("Aide : Ajoutez l'opérande de droite.");
    await waitFor(() => expect(area.getAttribute("aria-invalid")).toBe("true"));
    expect(area.getAttribute("aria-describedby")).toContain("diag-moyenne_ue");
    expect(api.calls.find((c) => c.method === "PUT")!.body).toEqual({ expression: "sum(notes) / ", expectedRowVersion: 2 });
  });

  it("expression valide : enregistrée avec la version de ligne ; aide du contrat affichée", async () => {
    const api = setTestApi(
      routes(tenantDraft(), {
        [`PUT ${V(TENANT_ID, "/rules/moyenne_ue")}`]: () => json(tenantDraft({ rowVersion: 3, rules: [ruleDef({ expression: "avg(notes)" })] })),
      }),
    );
    renderWithProviders(<RuleVersionScreen id={TENANT_ID} />);
    const area = (await screen.findByLabelText(/Expression/)) as HTMLTextAreaElement;
    await waitFor(() => expect(area.readOnly).toBe(false));
    fireEvent.change(area, { target: { value: "avg(notes)" } });
    fireEvent.click(screen.getByRole("button", { name: "Enregistrer l'expression de moyenne_ue" }));
    await screen.findByText("Modification enregistrée.");
    expect(api.calls.find((c) => c.method === "PUT")!.body).toEqual({ expression: "avg(notes)", expectedRowVersion: 2 });
    fireEvent.click(await screen.findByText("Aide du contrat"));
    expect(await screen.findByText("notes")).toBeTruthy();
  });

  it("sans droit d'éditer les expressions : paramètres modifiables seulement, bornés par la règle", async () => {
    const api = setTestApi({
      ...routes(tenantDraft(), { [`PATCH ${V(TENANT_ID, "/parameters")}`]: () => json(tenantDraft({ rowVersion: 3 })) }),
      ...accessRoutes(["rules.ruleset.read", "rules.version.edit"], FEATURES),
    });
    renderWithProviders(<RuleVersionScreen id={TENANT_ID} />);
    const field = await screen.findByLabelText(/Valeur de seuil_validation/);
    expect((await screen.findByLabelText(/Expression/) as HTMLTextAreaElement).readOnly).toBe(true);
    fireEvent.change(field, { target: { value: "25" } });
    fireEvent.click(screen.getByRole("button", { name: "Enregistrer les paramètres de moyenne_ue" }));
    expect(await screen.findByText("Au plus 20.")).toBeTruthy();
    expect(api.calls.filter((c) => c.method === "PATCH")).toHaveLength(0);
    fireEvent.change(field, { target: { value: "9,5" } });
    fireEvent.click(screen.getByRole("button", { name: "Enregistrer les paramètres de moyenne_ue" }));
    await screen.findByText("Modification enregistrée.");
    expect(api.calls.find((c) => c.method === "PATCH")!.body).toEqual({ changes: [{ ruleKey: "moyenne_ue", parameter: "seuil_validation", value: 9.5 }], expectedRowVersion: 2 });
  });

  it("validation de la version : violations du contrat et diagnostics par règle", async () => {
    setTestApi(
      routes(tenantDraft(), {
        [`POST ${V(TENANT_ID, "/validate")}`]: () =>
          json({ ok: false, contractId: "credit-semester@1", rules: [{ key: "moyenne_ue", ok: false, diagnostics: [{ code: "type", phase: "check", message: "Le résultat doit être un nombre.", position: { start: 0, end: 4, line: 1, column: 1 } }], resultType: null }], violations: [{ ruleKey: "etat_ue", code: "missing", message: "Règle obligatoire absente : etat_ue." }] }),
      }),
    );
    renderWithProviders(<RuleVersionScreen id={TENANT_ID} />);
    fireEvent.click(await screen.findByRole("button", { name: "Valider la version" }));
    expect(await screen.findByText("La version contient des erreurs à corriger.")).toBeTruthy();
    expect(screen.getByText(/Règle obligatoire absente : etat_ue\./)).toBeTruthy();
    expect(screen.getByText(/Le résultat doit être un nombre\./)).toBeTruthy();
  });

  it("banc d'essai : JSON invalide refusé localement, puis valeur et trace renvoyées par l'API", async () => {
    const api = setTestApi(
      routes(tenantDraft(), {
        "POST /api/v1/rules/evaluate": () =>
          json({ ruleVersionId: TENANT_ID, ruleKey: "moyenne_ue", definitionHash: "a".repeat(64), engineVersion: "1.4.0", type: "number", value: "12.5", nodesEvaluated: 4, trace: [{ seq: 1, kind: "call", label: "somme", source: "sum(notes)", start: 0, end: 10, type: "number", value: "25" }], traceTruncated: false, inputsHash: "d".repeat(64), outputsHash: "e".repeat(64) }),
      }),
    );
    renderWithProviders(<RuleVersionScreen id={TENANT_ID} />);
    fireEvent.click(await screen.findByRole("button", { name: "Tester la règle moyenne_ue" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText(/Variables/), { target: { value: "pas du json" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Évaluer" }));
    expect(await within(dialog).findByText("Saisissez un objet JSON valide.")).toBeTruthy();
    expect(api.calls.filter((c) => c.method === "POST")).toHaveLength(0);
    fireEvent.change(within(dialog).getByLabelText(/Variables/), { target: { value: '{"notes": ["12", "13"]}' } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Évaluer" }));
    expect((await within(dialog).findByTestId("evaluate-value")).textContent).toBe("12.5");
    expect(within(dialog).getByText("sum(notes)")).toBeTruthy();
    expect(api.calls.find((c) => c.method === "POST")!.body).toEqual({ versionId: TENANT_ID, ruleKey: "moyenne_ue", context: { variables: { notes: ["12", "13"] } }, trace: true });
  });
});

describe("RuleVersionScreen — workflow et journal", () => {
  const base = (detail: Record<string, unknown>, extra: Record<string, unknown> = {}) => ({
    ...accessRoutes(ALL, FEATURES),
    [`GET ${V(TENANT_ID)}`]: detail,
    ...extra,
  });

  it("brouillon : « Marquer comme simulée » envoie la transition ; refus de l'API affiché", async () => {
    const api = setTestApi(
      base(tenantDraft(), {
        [`POST ${V(TENANT_ID, "/transitions")}`]: () => json({ code: "rules.simulation_required", message: "Une simulation terminée est requise avant de simuler." }, { status: 409 }),
      }),
    );
    renderWithProviders(<RuleVersionScreen id={TENANT_ID} />);
    fireEvent.click(await screen.findByRole("button", { name: "Marquer comme simulée" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Confirmer" }));
    await within(dialog).findByText("Une simulation terminée est requise avant de simuler.");
    expect(api.calls.find((c) => c.method === "POST")!.body).toEqual({ to: "simulated", expectedRowVersion: 2 });
    // approbation et publication : jamais proposées à l'établissement
    expect(screen.queryByRole("button", { name: /Approuver|Publier/ })).toBeNull();
  });

  it("simulée : proposition avec confirmation de l'impact sur les décisions (pourcentage de la simulation)", async () => {
    const api = setTestApi(
      base(tenantDraft({ status: "simulated", lastSimulationId: uuid(6800) }), {
        [`GET /api/v1/rules/simulations/${uuid(6800)}`]: simulationDto(),
        [`POST ${V(TENANT_ID, "/transitions")}`]: () => json({ version: versionSummary({ id: TENANT_ID, origin: "tenant", status: "proposed", rowVersion: 3 }), decisionChangedPercent: "12.5" }),
      }),
    );
    renderWithProviders(<RuleVersionScreen id={TENANT_ID} />);
    fireEvent.click(await screen.findByRole("button", { name: "Proposer à l'approbation" }));
    const dialog = await screen.findByRole("dialog");
    expect(await within(dialog).findByText("La simulation modifie 12.5 % des décisions évaluées.")).toBeTruthy();
    fireEvent.click(within(dialog).getByRole("checkbox", { name: /pris connaissance de l'impact/ }));
    fireEvent.change(within(dialog).getByLabelText(/Commentaire/), { target: { value: "Prêt pour la rentrée" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Confirmer" }));
    await screen.findByText("La version est passée à l'état « Proposée ».");
    expect(api.calls.find((c) => c.method === "POST")!.body).toEqual({ to: "proposed", comment: "Prêt pour la rentrée", confirmDecisionImpact: true, expectedRowVersion: 2 });
  });

  it("journal des versions : transitions, acteur, nature et commentaire", async () => {
    setTestApi(
      base(
        tenantDraft({
          status: "proposed",
          events: [
            { id: uuid(1), fromStatus: null, toStatus: "draft", actorId: uuid(9), actorName: "Mme Koffi", actorKind: "tenant_admin", comment: null, occurredAt: "2026-09-01T08:00:00.000Z" },
            { id: uuid(2), fromStatus: "draft", toStatus: "proposed", actorId: uuid(9), actorName: "Mme Koffi", actorKind: "tenant_admin", comment: "Prêt pour la rentrée", occurredAt: "2026-09-02T08:00:00.000Z" },
          ],
        }),
      ),
    );
    renderWithProviders(<RuleVersionScreen id={TENANT_ID} />);
    fireEvent.click(await screen.findByRole("tab", { name: "Journal" }));
    const log = await screen.findByRole("list", { name: "Journal des versions" });
    expect(within(log).getByText("Brouillon → Proposée")).toBeTruthy();
    expect(within(log).getByText("Prêt pour la rentrée")).toBeTruthy();
    expect(within(log).getAllByText(/Mme Koffi \(établissement\)/)).toHaveLength(2);
  });
});

describe("RuleVersionScreen — simulation", () => {
  const routes = (extra: Record<string, unknown>) => ({
    ...accessRoutes(ALL, FEATURES),
    [`GET ${V(TENANT_ID)}`]: tenantDraft(),
    [`GET /api/v1/academic/classrooms/${uuid(500)}`]: classroom(),
    "GET /api/v1/academic/classrooms": { items: [classroom()], total: 1, page: 1, pageSize: 200 },
    [`GET /api/v1/academic/years/${uuid(100)}/periods`]: { items: [period()] },
    ...extra,
  });

  it("lance une simulation sur une classe et une période puis affiche le rapport de différences", async () => {
    const api = setTestApi(
      routes({
        [`POST ${V(TENANT_ID, "/simulations")}`]: () => json({ simulationId: uuid(6800), status: "PENDING" }, { status: 202 }),
        [`GET /api/v1/rules/simulations/${uuid(6800)}`]: simulationDto(),
      }),
    );
    renderWithProviders(<RuleVersionScreen id={TENANT_ID} />);
    fireEvent.click(await screen.findByRole("tab", { name: "Simulation" }));
    await screen.findByRole("button", { name: "Lancer la simulation" });
    expect((screen.getByRole("button", { name: "Lancer la simulation" }) as HTMLButtonElement).disabled).toBe(true);
    // Choix de la classe (liste de choix asynchrone) puis de la période.
    fireEvent.focus(screen.getByRole("combobox", { name: "Classe" }));
    fireEvent.click(await screen.findByRole("option", { name: /Licence 1 A/ }));
    await screen.findByRole("option", { name: "Semestre 1" });
    fireEvent.change(screen.getByLabelText("Période"), { target: { value: uuid(200) } });
    fireEvent.click(screen.getByRole("button", { name: "Ajouter" }));
    fireEvent.click(screen.getByRole("button", { name: "Lancer la simulation" }));
    await screen.findByText("Rapport de simulation");
    expect(api.calls.find((c) => c.method === "POST")!.body).toEqual({ dataset: { periodIds: [uuid(200)], classroomIds: [uuid(500)] } });
    expect(await screen.findByText("33.3 %", { exact: false })).toBeTruthy();
    expect(screen.getByText("12.5 %")).toBeTruthy();
    expect(screen.getByText(/RESIT → VALIDATED \(1\)/)).toBeTruthy();
    expect(screen.getByText(/valeur modifiée : 9.5 → 10/)).toBeTruthy();
  });

  it("simulation en cours (dernière simulation de la version) : barre de progression annoncée", async () => {
    // la dernière simulation de la version est reprise
    setTestApi(routes({ [`GET ${V(TENANT_ID)}`]: tenantDraft({ lastSimulationId: uuid(6800) }), [`GET /api/v1/rules/simulations/${uuid(6800)}`]: simulationDto({ status: "RUNNING", progressPercent: 40, summary: null, rules: [], decisionChangedPercent: null, differences: [] }) }));
    renderWithProviders(<RuleVersionScreen id={TENANT_ID} />);
    fireEvent.click(await screen.findByRole("tab", { name: "Simulation" }));
    const bar = await screen.findByRole("progressbar", { name: "Progression de la simulation" });
    expect(bar.getAttribute("aria-valuenow")).toBe("40");
    expect(screen.getByText("Simulation en cours : 40 %")).toBeTruthy();
  });

  it("sans option de l'offre : message d'offre à la place du lancement", async () => {
    setTestApi({ ...routes({}), ...accessRoutes(ALL, []) });
    renderWithProviders(<RuleVersionScreen id={TENANT_ID} />);
    fireEvent.click(await screen.findByRole("tab", { name: "Simulation" }));
    expect(await screen.findByText("Cette fonctionnalité n'est pas incluse dans votre offre.")).toBeTruthy();
  });
});

describe("excerptAt", () => {
  it("place le repère sous la colonne fautive", () => {
    expect(excerptAt("a + b\nc * ", { line: 2, column: 5 })).toEqual({ text: "c * ", pointer: "    ^" });
    expect(excerptAt("a", { line: 3, column: 1 })).toBeNull();
    expect(excerptAt("a", undefined)).toBeNull();
  });
});
