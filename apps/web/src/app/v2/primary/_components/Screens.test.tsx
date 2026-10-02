// @vitest-environment jsdom
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { accessRoutes, setTestApi } from "@/platform/test/api-mock";
import { json, renderWithProviders } from "@/platform/test/render";
import { todayCivil } from "@/platform/v2/dates";
import { IDS as ATT, sessionDetail, sessionDto, STUDENTS } from "../../attendance/_test/fixtures";
import { apiErrorBody, framework, frameworkDetail, ID, myClassroom, P, phrase, progress, ratingScale, report, settings, uuid } from "../_test/fixtures";
import { permissionsLoaded } from "../_test/helpers";
import { AppreciationsScreen } from "./AppreciationsScreen";
import { ClassScreen } from "./ClassScreen";
import { DirectionScreen } from "./DirectionScreen";
import { ReportsScreen } from "./ReportsScreen";
import { SettingsScreen } from "./SettingsScreen";

vi.mock("@/platform/api/default-client", async () => (await import("@/platform/test/api-mock")).defaultClientModule);
const download = vi.hoisted(() => vi.fn());
vi.mock("@/platform/ui/download", () => ({ downloadTextFile: download }));

const banner = { [`GET ${P}/rule-banner`]: { ruleSourceKind: "placeholder", isPlaceholder: true } };

describe("Ma classe", () => {
  const classRoutes = (permissions: string[]) => ({
    ...accessRoutes(permissions, ["primary.competencies"]),
    ...banner,
    [`GET ${P}/my-classrooms`]: { items: [myClassroom(), myClassroom({ classroomId: ID.classroom2, name: "CE1 B", isHomeroom: false, studentCount: 1, periods: [{ id: ID.p1, label: "Trimestre 1", locked: false }] })] },
  });

  it("effectif, titulaire oui/non, périodes verrouillées ou ouvertes, accès en un geste", async () => {
    setTestApi(classRoutes(["attendance.take", "primary.competency.record", "primary.council.read"]));
    renderWithProviders(<ClassScreen />);
    expect(await screen.findByRole("heading", { level: 1, name: "Ma classe" })).toBeTruthy();
    const first = await screen.findByRole("region", { name: "CE1 A" });
    expect(within(first).getByText("3 élèves")).toBeTruthy();
    expect(within(first).getByText("Titulaire")).toBeTruthy();
    expect(within(first).getByText("ouverte")).toBeTruthy();
    expect(within(first).getByText("verrouillée")).toBeTruthy();
    const second = screen.getByRole("region", { name: "CE1 B" });
    expect(within(second).getByText("Non titulaire")).toBeTruthy();
    expect(within(second).getByText("1 élève")).toBeTruthy();
    await within(first).findByRole("button", { name: "Appel du jour" });
    expect(within(first).getByRole("link", { name: "Compétences" }).getAttribute("href")).toBe(`/v2/primary/competences?classe=${ID.classroom}`);
    expect(within(first).getByRole("link", { name: "Conseil" }).getAttribute("href")).toBe(`/v2/primary/conseil?classe=${ID.classroom}`);
    // Bandeau permanent
    expect(await screen.findByTestId("placeholder-notice")).toBeTruthy();
  });

  it("les gestes non permis sont masqués", async () => {
    const api = setTestApi(classRoutes(["primary.competency.read"]));
    renderWithProviders(<ClassScreen />);
    await screen.findByRole("region", { name: "CE1 A" });
    await permissionsLoaded(api);
    expect(screen.queryByRole("button", { name: "Appel du jour" })).toBeNull();
    expect(screen.queryByRole("link", { name: "Conseil" })).toBeNull();
    expect(screen.getAllByRole("link", { name: "Compétences" }).length).toBe(2);
  });

  it("aucune classe : message explicatif", async () => {
    setTestApi({ ...classRoutes([]), [`GET ${P}/my-classrooms`]: { items: [] } });
    renderWithProviders(<ClassScreen />);
    expect(await screen.findByText("Aucune classe ne vous est affectée.")).toBeTruthy();
  });

  describe("appel journalier rapide", () => {
    const today = todayCivil();
    const dailyRoutes = (over: Record<string, unknown> = {}) => ({
      ...classRoutes(["attendance.take", "primary.competency.record"]),
      "POST /api/v1/attendance/sessions": () => json({ session: sessionDto({ scope: "DAILY", classroomId: ID.classroom, sessionDate: today, occurrenceId: null }), created: true }),
      [`GET /api/v1/attendance/sessions/${ATT.session}`]: sessionDetail({ session: { scope: "DAILY", classroomId: ID.classroom, sessionDate: today, occurrenceId: null } }),
      ...over,
    });

    it("tous présents par défaut, un geste pour marquer un absent, un geste pour transmettre", async () => {
      const api = setTestApi(
        dailyRoutes({
          [`PUT /api/v1/attendance/sessions/${ATT.session}/records`]: () => json({ session: sessionDto(), created: 1, updated: 0, unchanged: 0, records: [] }),
          [`POST /api/v1/attendance/sessions/${ATT.session}/submit`]: () => json({ session: sessionDto({ status: "SUBMITTED" }), alreadySubmitted: false, filledByDefault: 2, absentCount: 1, lateCount: 0 }),
        }),
      );
      renderWithProviders(<ClassScreen />);
      const first = await screen.findByRole("region", { name: "CE1 A" });
      fireEvent.click(await within(first).findByRole("button", { name: "Appel du jour" }));
      await screen.findByTestId("daily-counts");
      expect(api.calls.find((c) => c.method === "POST" && c.path.endsWith("/sessions"))!.body).toEqual({ scope: "DAILY", classroomId: ID.classroom, date: today });
      expect(screen.getByTestId("daily-counts").textContent).toBe("3 présents · 0 absents");
      fireEvent.click(screen.getByRole("button", { name: `Marquer ${STUDENTS[0]!.name} absent` }));
      expect(screen.getByTestId("daily-counts").textContent).toBe("2 présents · 1 absents");
      expect(screen.getByText("Non transmis")).toBeTruthy();
      fireEvent.click(screen.getByRole("button", { name: "Transmettre l'appel" }));
      await screen.findByText("Appel transmis : 1 absent.");
      expect(api.calls.find((c) => c.method === "PUT")!.body).toEqual({ entries: [{ studentId: STUDENTS[0]!.id, statusCode: "ABSENT" }] });
      expect(api.calls.find((c) => c.path.endsWith("/submit"))!.body).toEqual({ allPresent: true });
    });

    it("échec d'envoi : le message de l'API est affiché et la saisie n'est pas perdue", async () => {
      setTestApi(dailyRoutes({ [`PUT /api/v1/attendance/sessions/${ATT.session}/records`]: () => json(apiErrorBody("attendance.session_locked", "La séance est verrouillée."), { status: 409 }) }));
      renderWithProviders(<ClassScreen />);
      const first = await screen.findByRole("region", { name: "CE1 A" });
      fireEvent.click(await within(first).findByRole("button", { name: "Appel du jour" }));
      fireEvent.click(await screen.findByRole("button", { name: `Marquer ${STUDENTS[1]!.name} absent` }));
      fireEvent.click(screen.getByRole("button", { name: "Transmettre l'appel" }));
      expect(await screen.findByText("La séance est verrouillée.")).toBeTruthy();
      expect(screen.getByTestId("daily-counts").textContent).toBe("2 présents · 1 absents");
    });
  });
});

describe("Avancement de la direction", () => {
  const rows = [
    progress(),
    progress({ classroomId: ID.classroom2, name: "CE1 B", competencies: { expected: 12, recorded: 12, validated: 12 }, reviews: { total: 3, sealed: 3 }, locked: true }),
    progress({ classroomId: uuid(502), name: "CP1 A", competencies: { expected: 12, recorded: 0, validated: 0 } }),
  ];
  const directionRoutes = (permissions: string[]) => ({
    ...accessRoutes(permissions, ["primary.reports"]),
    ...banner,
    [`GET ${P}/my-classrooms`]: { items: [myClassroom(), myClassroom({ classroomId: ID.classroom2, name: "CE1 B" })] },
    [`GET ${P}/progress`]: { items: rows },
  });

  it("feux vert / orange / rouge portés par un texte et une icône, calculés à partir des comptages bruts", async () => {
    setTestApi(directionRoutes(["primary.report.read", "primary.class.read_all", "primary.council.manage", "primary.bilan.read", "primary.archive.prepare", "primary.settings.manage"]));
    renderWithProviders(<DirectionScreen />);
    const table = await screen.findByRole("table", { name: "Avancement par classe et par période" });
    const lights = Array.from(table.querySelectorAll("[data-light]")).map((e) => [e.getAttribute("data-light"), e.textContent]);
    expect(lights).toEqual([
      ["orange", "En cours"],
      ["green", "Complet"],
      ["red", "Rien de saisi"],
    ]);
    expect(within(table).getByText("6 sur 12")).toBeTruthy();
    expect(within(table).getAllByText("3 sur 3").length).toBe(1);
    expect(within(table).getByText("Verrouillée")).toBeTruthy();
    // Liens vers conseil, bilans, archives, états, paramètres.
    const nav = await screen.findByRole("navigation", { name: "Accès rapides" });
    await within(nav).findByRole("link", { name: "Paramètres" });
    expect(within(nav).getAllByRole("link").map((a) => a.getAttribute("href"))).toEqual(["/v2/primary/conseil", "/v2/primary/bilans", "/v2/primary/archives", "/v2/primary/etats", "/v2/primary/parametres"]);
  });

  it("les liens non permis sont masqués", async () => {
    const api = setTestApi(directionRoutes(["primary.report.read"]));
    renderWithProviders(<DirectionScreen />);
    await screen.findByRole("table", { name: "Avancement par classe et par période" });
    await permissionsLoaded(api);
    const nav = screen.getByRole("navigation", { name: "Accès rapides" });
    expect(within(nav).getByRole("link", { name: "États" })).toBeTruthy();
    expect(within(nav).queryByRole("link", { name: "Paramètres" })).toBeNull();
    expect(within(nav).queryByRole("link", { name: "Archives" })).toBeNull();
  });

  it("réservé à la direction : l'erreur de l'API est affichée telle quelle", async () => {
    setTestApi({ ...directionRoutes(["primary.report.read"]), [`GET ${P}/progress`]: () => json(apiErrorBody("primary_school.forbidden", "L'avancement de toutes les classes est réservé à la direction."), { status: 403 }) });
    renderWithProviders(<DirectionScreen />);
    expect((await screen.findByRole("alert")).textContent).toContain("L'avancement de toutes les classes est réservé à la direction.");
  });
});

describe("États", () => {
  const reportRoutes = (permissions: string[], over: Record<string, unknown> = {}) => ({
    ...accessRoutes(permissions, ["primary.reports"]),
    ...banner,
    [`GET ${P}/my-classrooms`]: { items: [myClassroom()] },
    [`GET ${P}/councils`]: { items: [] },
    ...over,
  });

  it("rapports réservés à la direction masqués sans accès à toutes les classes", async () => {
    const api = setTestApi(reportRoutes(["primary.report.read"]));
    renderWithProviders(<ReportsScreen />);
    const select = await screen.findByLabelText(/Rapport/);
    await permissionsLoaded(api);
    const names = within(select).getAllByRole("option").map((o) => o.textContent);
    expect(names).toContain("Liste de classe");
    expect(names).not.toContain("Effectifs par niveau et par classe");
    expect(names).not.toContain("Redoublants");
    expect(names).not.toContain("Avancement des classes");
  });

  it("direction : les 7 rapports", async () => {
    const api = setTestApi(reportRoutes(["primary.report.read", "primary.class.read_all"]));
    renderWithProviders(<ReportsScreen />);
    const select = await screen.findByLabelText(/Rapport/);
    await permissionsLoaded(api);
    await waitFor(() => expect(within(select).getAllByRole("option").length).toBe(8));
  });

  it("aperçu en tableau avec paramètres rappelés, puis export CSV par téléchargement du fichier", async () => {
    download.mockClear();
    const api = setTestApi(
      reportRoutes(["primary.report.read"], {
        [`GET ${P}/reports/class-list`]: ({ url }) => (url.searchParams.get("format") === "csv" ? new Response("﻿Nom;Effectif\r\nAka Marie;1\r\n", { status: 200, headers: { "content-type": "text/csv" } }) : json(report())),
      }),
    );
    renderWithProviders(<ReportsScreen />);
    await screen.findByLabelText(/Rapport/);
    await screen.findByRole("option", { name: "Liste de classe" });
    fireEvent.change(screen.getByLabelText(/Rapport/), { target: { value: "class-list" } });
    const show = screen.getByRole("button", { name: "Afficher l'aperçu" }) as HTMLButtonElement;
    expect(show.disabled).toBe(true);
    fireEvent.change(await screen.findByLabelText(/Classe/), { target: { value: ID.classroom } });
    expect(show.disabled).toBe(false);
    fireEvent.click(show);
    const table = await screen.findByRole("table", { name: "Liste de classe" });
    expect(within(table).getByText("Aka Marie")).toBeTruthy();
    expect(screen.getByText(ID.classroom)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Exporter en CSV" }));
    await waitFor(() => expect(download).toHaveBeenCalledTimes(1));
    expect(download.mock.calls[0]![0]).toBe("class-list.csv");
    expect(download.mock.calls[0]![1]).toContain("Aka Marie;1");
    expect(download.mock.calls[0]![3]).toEqual({ bom: true });
    expect(api.calls.find((c) => c.query.format === "csv")!.query).toMatchObject({ classroomId: ID.classroom, format: "csv" });
    // Jamais d'URL affichée
    expect(document.body.textContent).not.toMatch(/https?:\/\//);
  });

  it("paramètre obligatoire manquant : aucun appel", async () => {
    const api = setTestApi(reportRoutes(["primary.report.read"]));
    renderWithProviders(<ReportsScreen />);
    await screen.findByRole("option", { name: "Registre d'appel mensuel" });
    fireEvent.change(screen.getByLabelText(/Rapport/), { target: { value: "attendance-register" } });
    fireEvent.change(await screen.findByLabelText(/Classe/), { target: { value: ID.classroom } });
    expect((screen.getByRole("button", { name: "Afficher l'aperçu" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText("Renseignez les paramètres obligatoires pour produire ce rapport.")).toBeTruthy();
    expect(api.calls.filter((c) => c.path.includes("/reports/"))).toHaveLength(0);
  });
});

describe("Paramètres", () => {
  const SETTINGS = `${P}/settings`;
  const ALL = ["primary.settings.manage", "primary.template.apply", "primary.scale.manage", "primary.framework.read", "primary.framework.manage", "primary.framework.publish"];
  const settingsRoutes = (permissions: string[], over: Record<string, unknown> = {}) => ({
    ...accessRoutes(permissions, []),
    ...banner,
    [`GET ${SETTINGS}`]: settings(),
    [`GET ${P}/rating-scales`]: { items: [ratingScale()] },
    [`GET ${P}/frameworks`]: { items: [framework(), framework({ id: ID.domainA, status: "DRAFT", label: "Brouillon fictif", publishedAt: null })] },
    ...over,
  });

  it("enregistre les réglages (corps validé par le contrat)", async () => {
    const api = setTestApi(settingsRoutes(ALL, { [`PUT ${SETTINGS}`]: () => json(settings({ councilRequiredForBilan: false, archiveRetentionYears: 5 })) }));
    renderWithProviders(<SettingsScreen />);
    fireEvent.click(await screen.findByLabelText(/Exiger la décision du conseil pour sceller un bilan/));
    fireEvent.change(screen.getByLabelText(/Durée de conservation des archives/), { target: { value: "5" } });
    fireEvent.click(screen.getByRole("button", { name: "Enregistrer les réglages" }));
    await screen.findByText("Réglages enregistrés.");
    expect(api.calls.find((c) => c.method === "PUT")!.body).toEqual({ requireHomeroomForActivation: true, councilRequiredForBilan: false, phraseBankEnabled: true, defaultRatingScaleId: null, archiveRetentionYears: 5 });
  });

  it("application du modèle de pack : acte sensible confirmé dans un dialogue", async () => {
    const api = setTestApi(settingsRoutes(ALL, { [`POST ${P}/template/apply`]: () => json({ institutionId: ID.institution, templateVersion: 1, alreadyApplied: false, created: { scales: 1, frameworks: 1, phrases: 6, settings: 1 } }) }));
    renderWithProviders(<SettingsScreen />);
    fireEvent.click(await screen.findByRole("button", { name: "Appliquer le modèle de pack" }));
    const dialog = await screen.findByRole("dialog");
    expect(api.calls.filter((c) => c.method === "POST")).toHaveLength(0);
    fireEvent.click(within(dialog).getByRole("button", { name: "Appliquer le modèle" }));
    await screen.findByText("Modèle appliqué : 1 échelles, 1 référentiels et 6 phrases créés.");
  });

  it("sans la permission sensible : pas de modèle de pack", async () => {
    const api = setTestApi(settingsRoutes(["primary.settings.manage"]));
    renderWithProviders(<SettingsScreen />);
    await screen.findByRole("button", { name: "Enregistrer les réglages" });
    await permissionsLoaded(api);
    expect(screen.queryByRole("button", { name: "Appliquer le modèle de pack" })).toBeNull();
    expect(screen.queryByText("Référentiels de compétences")).toBeNull();
  });

  it("un référentiel publié est immuable : on propose une nouvelle version, pas de modification", async () => {
    const api = setTestApi(
      settingsRoutes(ALL, {
        [`GET ${P}/frameworks/${ID.framework}`]: frameworkDetail(),
        [`POST ${P}/frameworks/${ID.framework}/new-version`]: () => json(frameworkDetail({ id: ID.domainB, version: 2, status: "DRAFT", publishedAt: null }), { status: 201 }),
      }),
    );
    renderWithProviders(<SettingsScreen />);
    fireEvent.click(await screen.findByRole("button", { name: "Détail du référentiel Référentiel de démonstration (fictif), version 1" }));
    expect(await screen.findByText("Référentiel publié : immuable. Créez une nouvelle version pour le modifier.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Modifier la structure" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Publier" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Créer une nouvelle version" }));
    await screen.findByText("Version 2 créée en brouillon.");
    expect(api.calls.filter((c) => c.method === "POST")).toHaveLength(1);
  });

  it("publication d'un brouillon : confirmation explicite, manques affichés tels que renvoyés par l'API", async () => {
    const api = setTestApi(
      settingsRoutes(ALL, {
        [`GET ${P}/frameworks/${ID.domainA}`]: frameworkDetail({ id: ID.domainA, status: "DRAFT", publishedAt: null, publishBlockers: [{ code: "primary_school.framework_no_level", message: "Indiquer au moins un niveau d'application." }] }),
        [`POST ${P}/frameworks/${ID.domainA}/publish`]: () => json(apiErrorBody("primary_school.framework_no_level", "Le référentiel n'est pas publiable.", { details: { blockers: [{ code: "primary_school.framework_no_level", message: "Indiquer au moins un niveau d'application." }] } }), { status: 409 }),
      }),
    );
    renderWithProviders(<SettingsScreen />);
    fireEvent.click(await screen.findByRole("button", { name: "Détail du référentiel Brouillon fictif, version 1" }));
    expect(await screen.findByText("Ce qui empêche la publication :")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Publier" }));
    const dialog = await screen.findByRole("dialog");
    const confirm = within(dialog).getByRole("button", { name: "Publier" }) as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);
    fireEvent.click(within(dialog).getByRole("checkbox", { name: "Je comprends que la publication est définitive" }));
    fireEvent.click(confirm);
    const alert = await within(dialog).findByRole("alert");
    expect(alert.textContent).toContain("Le référentiel n'est pas publiable.");
    expect(alert.textContent).toContain("Indiquer au moins un niveau d'application.");
    expect(api.calls.filter((c) => c.method === "POST")).toHaveLength(1);
  });
});

describe("Appréciations", () => {
  const phraseRoutes = (permissions: string[], over: Record<string, unknown> = {}) => ({
    ...accessRoutes(permissions, ["primary.competencies"]),
    ...banner,
    [`GET ${P}/phrases`]: { items: [phrase(1), phrase(2, { sourceKind: "institution", scope: "YEAR", active: false })] },
    [`GET ${P}/rating-scales`]: { items: [ratingScale()] },
    [`GET ${P}/my-classrooms`]: { items: [myClassroom()] },
    ...over,
  });

  it("la phrase est copiée dans un champ que l'instituteur valide ; une phrase fictive est étiquetée « Démonstration »", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    setTestApi(phraseRoutes(["primary.phrase.read"]));
    renderWithProviders(<AppreciationsScreen />);
    const list = await screen.findByRole("list", { name: "Phrases de la banque" });
    expect(within(list).getByText("Démonstration")).toBeTruthy();
    expect(within(list).getByText("Désactivée")).toBeTruthy();
    // La phrase désactivée ne s'insère pas.
    expect((within(list).getByRole("button", { name: "Ajouter la phrase PHRASE_2 à ma rédaction" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(within(list).getByRole("button", { name: "Ajouter la phrase PHRASE_1 à ma rédaction" }));
    const field = screen.getByLabelText("Texte de l'appréciation") as HTMLTextAreaElement;
    expect(field.value).toBe("Phrase fictive numéro 1.");
    // Jamais appliquée seule : la copie exige la validation (case « relu »).
    const copy = screen.getByRole("button", { name: "Copier le texte validé" }) as HTMLButtonElement;
    expect(copy.disabled).toBe(true);
    fireEvent.change(field, { target: { value: "Phrase fictive numéro 1. Élève sérieux." } });
    fireEvent.click(screen.getByRole("checkbox", { name: "J'ai relu et je valide ce texte" }));
    fireEvent.click(copy);
    await screen.findByText("Texte copié : collez-le dans l'appréciation du bulletin.");
    expect(writeText).toHaveBeenCalledWith("Phrase fictive numéro 1. Élève sérieux.");
    expect(screen.getByText(/L'appréciation générale s'écrit dans le module Résultats/)).toBeTruthy();
  });

  it("filtres portée / niveau / classe transmis à l'API ; gestion masquée sans permission", async () => {
    const api = setTestApi(phraseRoutes(["primary.phrase.read"]));
    renderWithProviders(<AppreciationsScreen />);
    await screen.findByRole("list", { name: "Phrases de la banque" });
    fireEvent.change(screen.getByLabelText("Portée"), { target: { value: "YEAR" } });
    fireEvent.change(await screen.findByLabelText("Niveau de maîtrise"), { target: { value: "N3" } });
    await waitFor(() => expect(api.calls.some((c) => c.query.scope === "YEAR" && c.query.ratingLevelCode === "N3")).toBe(true));
    await permissionsLoaded(api);
    expect(screen.queryByRole("button", { name: "Nouvelle phrase" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Désactiver" })).toBeNull();
  });

  it("gestion : création validée par le contrat, activation / désactivation", async () => {
    const api = setTestApi(
      phraseRoutes(["primary.phrase.read", "primary.phrase.manage"], {
        [`POST ${P}/phrases`]: () => json(phrase(3, { sourceKind: "institution" }), { status: 201 }),
        [`PATCH ${P}/phrases/${phrase(1).id}`]: () => json(phrase(1, { active: false })),
      }),
    );
    renderWithProviders(<AppreciationsScreen />);
    fireEvent.click(await screen.findByRole("button", { name: "Nouvelle phrase" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Créer la phrase" }));
    await waitFor(() => expect(within(dialog).getAllByRole("alert").length).toBeGreaterThan(0));
    expect(api.calls.filter((c) => c.method === "POST")).toHaveLength(0);
    fireEvent.change(within(dialog).getByLabelText(/Code/), { target: { value: "phrase_3" } });
    fireEvent.change(within(dialog).getByLabelText(/Texte de la phrase/), { target: { value: "Bon travail ce trimestre." } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Créer la phrase" }));
    await screen.findByText("Phrase créée.");
    expect(api.calls.find((c) => c.method === "POST")!.body).toEqual({ code: "PHRASE_3", scope: "PERIOD", body: "Bon travail ce trimestre.", sourceKind: "institution" });
    fireEvent.click(await screen.findByRole("button", { name: "Désactiver" }));
    await waitFor(() => expect(api.calls.some((c) => c.method === "PATCH")).toBe(true));
    expect(api.calls.find((c) => c.method === "PATCH")!.body).toEqual({ active: false });
  });
});
