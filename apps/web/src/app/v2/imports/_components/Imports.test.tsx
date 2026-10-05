// @vitest-environment jsdom
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ImportJobDto, ImporterDescriptor } from "@ecoledigitale/contracts/v2/imports";
import { accessRoutes, setTestApi } from "@/platform/test/api-mock";
import { json, renderWithProviders } from "@/platform/test/render";
import { uuid } from "../../_test/fixtures";
import { HistoryScreen } from "./HistoryScreen";
import { ImportAssistant } from "./ImportAssistant";
import { SettingsScreen } from "./SettingsScreen";
import { TemplatesScreen } from "./TemplatesScreen";
import { ASSISTANT_STEPS, formatBytes, formatDuration, percent, stepOf, visibleImporters } from "./import-utils";

vi.mock("@/platform/api/default-client", async () => (await import("@/platform/test/api-mock")).defaultClientModule);
vi.mock("next/link", () => ({ default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a> }));

const JOB = uuid(9000);

const column = (key: string, label: string, required = false) => ({ key, label, required, type: "text" as const, description: `Description de ${label}.`, example: "" });
const studentsDescriptor = (over: Partial<ImporterDescriptor> = {}): ImporterDescriptor => ({
  key: "students",
  label: "Élèves",
  description: "Identité, matricule d'origine, naissance.",
  sensitive: false,
  supportsUpdate: true,
  columns: [column("externalRef", "Matricule d'origine"), column("lastName", "Nom", true), column("firstName", "Prénoms", true), column("sex", "Sexe", true)],
  options: [{ key: "duplicatePolicy", label: "Doublons probables", required: false, help: "Refuser ou créer.", kind: "choice", choices: [{ value: "REJECT", label: "Refuser" }, { value: "ACKNOWLEDGE", label: "Créer malgré" }] }],
  importPermission: "imports.import.students",
  targetPermissions: ["student.create"],
  conditionalPermissions: [],
  canUse: true,
  canRun: true,
  ...over,
});
const balancesDescriptor = (): ImporterDescriptor =>
  studentsDescriptor({ key: "opening_balances", label: "Soldes d'ouverture", description: "Factures et avoirs de reprise.", sensitive: true, supportsUpdate: false, targetPermissions: ["finance.invoice.create"], importPermission: "imports.import.opening_balances", canUse: false, canRun: false, options: [] });

const jobDto = (over: Partial<ImportJobDto> = {}): ImportJobDto => ({
  id: JOB,
  importerKey: "students",
  status: "UPLOADED",
  fileName: "eleves.csv",
  fileKind: "CSV",
  fileSize: 2048,
  fileSha256: "a".repeat(64),
  sheetName: null,
  headers: ["Matricule", "Nom", "Prénoms", "Sexe"],
  warnings: [],
  totalRows: 120,
  duplicateOfJobId: null,
  mapping: null,
  mappingTemplateId: null,
  options: {},
  runMode: "VALID_ONLY",
  onExisting: "SKIP",
  validRows: 0,
  invalidRows: 0,
  plannedCreate: 0,
  plannedUpdate: 0,
  plannedSkip: 0,
  validationProgress: 0,
  validatedAt: null,
  processedCount: 0,
  createdCount: 0,
  updatedCount: 0,
  skippedCount: 0,
  failedCount: 0,
  startedAt: null,
  finishedAt: null,
  durationMs: null,
  cancelRequested: false,
  errorCode: null,
  errorMessage: null,
  rawPurged: false,
  createdBy: uuid(7),
  createdAt: "2026-10-02T08:00:00.000Z",
  updatedAt: "2026-10-02T08:00:00.000Z",
  ...over,
});

const issue = (column: string | null, code: string, message: string, severity: "ERROR" | "WARNING" = "ERROR") => ({ column, header: column ? "Prénoms" : null, code, message, severity });
const rowDto = (rowNo: number, over: Record<string, unknown> = {}) => ({ rowNo, raw: ["TA-1", "KONE", "", "F"], values: null, naturalKey: null, validation: "INVALID", plannedAction: null, issues: [issue("firstName", "imports.required", "Le champ « Prénoms » est obligatoire.")], outcome: null, entityId: null, outcomeIssues: [], ...over });
const preview = (over: Record<string, unknown> = {}) => ({
  jobId: JOB,
  totalRows: 120,
  validRows: 110,
  invalidRows: 10,
  willCreate: 100,
  willUpdate: 4,
  willSkip: 6,
  willFail: 10,
  warnings: 3,
  topIssues: [{ code: "imports.required", count: 7, column: "firstName", example: "Le champ « Prénoms » est obligatoire." }],
  samples: { create: [{ ...rowDto(2), validation: "VALID", values: { lastName: "KONE", firstName: "Aminata" }, issues: [] }], update: [], skip: [], error: [] },
  canRun: true,
  blockers: [],
  ...over,
});

const base = (perms: string[] = ["imports.read", "imports.create", "imports.cancel"]) => ({
  ...accessRoutes(perms),
  "GET /api/v1/imports/importers": { items: [studentsDescriptor(), balancesDescriptor()] },
  "GET /api/v1/imports/templates": { items: [] },
});

describe("importeurs visibles (O-02, O-13)", () => {
  const d = (key: string, canUse: boolean) => ({ key, canUse });
  it("« Notes de mes classes » n'est proposé qu'à qui ne peut pas utiliser « Notes » ; la direction ne voit que « Notes »", () => {
    expect(visibleImporters([d("students", true), d("grades", true), d("grades_own", true)]).map((i) => i.key)).toEqual(["students", "grades"]);
    expect(visibleImporters([d("students", false), d("grades", false), d("grades_own", true)]).map((i) => i.key)).toEqual(["students", "grades_own"]);
    expect(visibleImporters([d("grades", false), d("grades_own", false)]).map((i) => i.key)).toEqual(["grades"]);
    expect(visibleImporters([d("enrollments", true)]).map((i) => i.key)).toEqual(["enrollments"]);
  });
});

describe("utilitaires d'affichage", () => {
  it("déduit l'étape de l'assistant de l'état serveur", () => {
    expect(stepOf(null)).toBe("upload");
    expect(stepOf({ status: "UPLOADED" })).toBe("mapping");
    expect(stepOf({ status: "MAPPED" })).toBe("mapping");
    expect(stepOf({ status: "VALIDATING" })).toBe("validation");
    expect(stepOf({ status: "VALIDATED" })).toBe("preview");
    expect(stepOf({ status: "QUEUED" })).toBe("import");
    expect(stepOf({ status: "RUNNING" })).toBe("import");
    for (const s of ["COMPLETED", "COMPLETED_WITH_ERRORS", "FAILED", "CANCELLED"] as const) expect(stepOf({ status: s })).toBe("report");
    expect(ASSISTANT_STEPS).toHaveLength(6);
  });
  it("formate pourcentages, durées et tailles", () => {
    expect(percent(50, 200)).toBe(25);
    expect(percent(5, 0)).toBe(0);
    expect(percent(300, 200)).toBe(100);
    expect(formatDuration(450)).toBe("450 ms");
    expect(formatDuration(75_000)).toBe("1 min 15 s");
    expect(formatDuration(null)).toBe("—");
    expect(formatBytes(2048)).toBe("2 Ko");
  });
});

describe("HistoryScreen", () => {
  it("liste les imports avec leur état, filtre par état, et propose « Nouvel import » avec imports.create", async () => {
    const api = setTestApi({
      ...base(),
      "GET /api/v1/imports/jobs": ({ url }) =>
        json({
          items: [jobDto({ status: "COMPLETED_WITH_ERRORS", createdCount: 100, failedCount: 5, durationMs: 4200 }), jobDto({ id: uuid(9001), fileName: "enseignants.xlsx", importerKey: "staff", status: "RUNNING" })].filter((j) => !url.searchParams.get("status") || j.status === url.searchParams.get("status")),
          total: 2,
          limit: 20,
          offset: 0,
        }),
    });
    renderWithProviders(<HistoryScreen />);
    const table = await screen.findByRole("table", { name: "Historique des imports" });
    expect(await within(table).findByRole("link", { name: "eleves.csv" })).toBeTruthy();
    expect(within(table).getByRole("link", { name: "eleves.csv" }).getAttribute("href")).toBe(`/v2/imports/${JOB}`);
    expect(within(table).getByText("Terminé avec des erreurs")).toBeTruthy();
    expect(within(table).getByText("Import en cours")).toBeTruthy();
    expect(within(table).getByText("100 créée(s), 0 mise(s) à jour, 0 ignorée(s), 5 en erreur")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Nouvel import" }).getAttribute("href")).toBe("/v2/imports/new");

    fireEvent.change(screen.getByLabelText("État"), { target: { value: "RUNNING" } });
    await waitFor(() => expect(api.calls.filter((c) => c.path === "/api/v1/imports/jobs").at(-1)!.query.status).toBe("RUNNING"));
    await waitFor(() => expect(within(screen.getByRole("table", { name: "Historique des imports" })).queryByText("Terminé avec des erreurs")).toBeNull());
  });

  it("sans imports.create : pas de bouton « Nouvel import » ; historique vide expliqué", async () => {
    setTestApi({ ...base(["imports.read"]), "GET /api/v1/imports/jobs": { items: [], total: 0, limit: 20, offset: 0 } });
    renderWithProviders(<HistoryScreen />);
    expect(await screen.findByText("Aucun import pour le moment.")).toBeTruthy();
    expect(screen.queryByRole("link", { name: "Nouvel import" })).toBeNull();
  });
});

describe("ImportAssistant : inscriptions et notes de l'enseignant", () => {
  const enrollmentsDescriptor = (): ImporterDescriptor =>
    studentsDescriptor({
      key: "enrollments",
      label: "Inscriptions",
      description: "Inscrit des élèves déjà enregistrés dans les classes de l'année courante.",
      supportsUpdate: false,
      columns: [column("studentRef", "Matricule de l'élève", true), column("classCode", "Classe (code)", true)],
      options: [{ key: "academicYearId", label: "Année scolaire des inscriptions", required: true, help: "L'année courante.", kind: "choice" }],
      importPermission: "imports.import.enrollments",
      targetPermissions: ["enrollment.create"],
    });
  const gradesDescriptor = (key: "grades" | "grades_own", canUse: boolean) =>
    studentsDescriptor({ key, label: key === "grades" ? "Notes" : "Notes de mes classes", description: "Notes d'une évaluation.", targetPermissions: key === "grades" ? ["grade.enter", "assessment.manage"] : ["grade.enter"], importPermission: `imports.import.${key}`, canUse, canRun: canUse, options: [] });

  it("l'importeur d'inscriptions apparaît dans l'assistant avec ses droits, son modèle CSV / Excel et son option d'année ; sans droit, il est désactivé et expliqué", async () => {
    setTestApi({ ...accessRoutes(["imports.read", "imports.create"]), "GET /api/v1/imports/importers": { items: [enrollmentsDescriptor()] }, "GET /api/v1/imports/templates": { items: [] } });
    renderWithProviders(<ImportAssistant />);
    const radio = await screen.findByRole("radio", { name: /Inscriptions/ });
    expect((radio as HTMLInputElement).disabled).toBe(false);
    fireEvent.click(radio);
    expect(await screen.findByText("Colonnes attendues pour « Inscriptions »")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Télécharger le modèle Excel" })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Télécharger le modèle CSV/ })).toBeTruthy();
  });
  it("un importeur d'inscriptions non autorisé est désactivé : droits manquants nommés", async () => {
    setTestApi({ ...accessRoutes(["imports.read"]), "GET /api/v1/imports/importers": { items: [{ ...enrollmentsDescriptor(), canUse: false, canRun: false }] }, "GET /api/v1/imports/templates": { items: [] } });
    renderWithProviders(<ImportAssistant />);
    const radio = await screen.findByRole("radio", { name: /Inscriptions/ });
    expect((radio as HTMLInputElement).disabled).toBe(true);
    expect(screen.getByText(/Droits manquants : enrollment\.create/)).toBeTruthy();
  });
  it("un enseignant voit « Notes de mes classes » (pas « Notes » désactivé) ; la direction voit « Notes » seulement", async () => {
    setTestApi({ ...accessRoutes(["imports.read", "imports.create"]), "GET /api/v1/imports/importers": { items: [gradesDescriptor("grades", false), gradesDescriptor("grades_own", true)] }, "GET /api/v1/imports/templates": { items: [] } });
    const first = renderWithProviders(<ImportAssistant />);
    expect(await screen.findByRole("radio", { name: /Notes de mes classes/ })).toBeTruthy();
    expect(screen.queryByRole("radio", { name: /^Notes$/ })).toBeNull();
    first.unmount();
    setTestApi({ ...accessRoutes(["imports.read", "imports.create"]), "GET /api/v1/imports/importers": { items: [gradesDescriptor("grades", true), gradesDescriptor("grades_own", true)] }, "GET /api/v1/imports/templates": { items: [] } });
    renderWithProviders(<ImportAssistant />);
    expect(await screen.findByRole("radio", { name: /^Notes/ })).toBeTruthy();
    expect(screen.queryByRole("radio", { name: /Notes de mes classes/ })).toBeNull();
  });
});

describe("ImportAssistant : étape Fichier", () => {
  it("importeur et fichier obligatoires (alertes, aucun envoi) ; un importeur dont les droits manquent est désactivé et expliqué", async () => {
    const api = setTestApi(base());
    renderWithProviders(<ImportAssistant />);
    const balances = await screen.findByRole("radio", { name: /Soldes d'ouverture/ });
    expect((balances as HTMLInputElement).disabled).toBe(true);
    expect(screen.getByText(/Droits manquants : finance\.invoice\.create/)).toBeTruthy();
    expect(screen.getByText("Authentification renforcée")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Envoyer et continuer" }));
    await waitFor(() => expect(screen.getAllByRole("alert").length).toBeGreaterThanOrEqual(2));
    expect(screen.getByText("Choisissez le type de données à importer.")).toBeTruthy();
    expect(screen.getByText("Choisissez un fichier .xlsx ou .csv.")).toBeTruthy();
    expect(api.calls.filter((c) => c.method === "POST")).toHaveLength(0);
  });

  it("envoie le fichier en corps BRUT (octets exacts, jamais JSON), puis affiche l'association des colonnes proposée", async () => {
    const csv = "Matricule;Nom;Prénoms;Sexe\r\nTA-1;KONE;Aminata;F\r\n";
    let status: ImportJobDto["status"] = "UPLOADED";
    const api = setTestApi({
      ...base(),
      "POST /api/v1/imports/jobs": () =>
        json(
          {
            job: jobDto(),
            suggestedMapping: { externalRef: "Matricule", lastName: "Nom", firstName: "Prénoms", sex: "Sexe" },
            suggestedTemplateId: null,
            missingRequired: [],
            unmappedHeaders: [],
            sample: [["TA-1", "KONE", "Aminata", "F"]],
          },
          { status: 201 },
        ),
      [`GET /api/v1/imports/jobs/${JOB}`]: () => json(jobDto({ status })),
    });
    renderWithProviders(<ImportAssistant />);
    fireEvent.click(await screen.findByRole("radio", { name: /Élèves/ }));
    expect(await screen.findByText("Colonnes attendues pour « Élèves »")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Télécharger le modèle Excel" })).toBeTruthy();
    const file = new File([csv], "eleves.csv", { type: "text/csv" });
    fireEvent.change(screen.getByLabelText(/^Fichier à importer/), { target: { files: [file] } });
    fireEvent.click(screen.getByRole("button", { name: "Envoyer et continuer" }));
    await screen.findByRole("heading", { name: "2. Associer les colonnes du fichier" });
    const post = api.calls.find((c) => c.method === "POST" && c.path === "/api/v1/imports/jobs")!;
    expect(post.query).toEqual({ importer: "students", fileName: "eleves.csv" });
    expect(post.headers["content-type"]).toBe("application/octet-stream");
    expect(new TextDecoder().decode(post.body as Uint8Array)).toBe(csv); // octets exacts, pas un JSON
    // la proposition automatique est préremplie
    expect((screen.getByLabelText(/^Nom/) as HTMLSelectElement).value).toBe("Nom");
    expect((screen.getByLabelText(/^Prénoms/) as HTMLSelectElement).value).toBe("Prénoms");
    expect(screen.getByRole("heading", { name: "Premières lignes du fichier" })).toBeTruthy();
    // l'étape courante est annoncée
    expect(screen.getByRole("list", { name: "Étapes de l'import" }).querySelector('[aria-current="step"]')?.textContent).toContain("Colonnes");
    void status;
  });

  it("un fichier refusé par le serveur affiche son message (type réel contrôlé côté serveur)", async () => {
    setTestApi({
      ...base(),
      "POST /api/v1/imports/jobs": () => json({ status: 400, code: "imports.file_type_mismatch", kind: "validation", message: "Le fichier se nomme « .xlsx » mais son contenu est du texte, pas un classeur Excel." }, { status: 400 }),
    });
    renderWithProviders(<ImportAssistant />);
    fireEvent.click(await screen.findByRole("radio", { name: /Élèves/ }));
    fireEvent.change(screen.getByLabelText(/^Fichier à importer/), { target: { files: [new File(["a;b"], "eleves.xlsx")] } });
    fireEvent.click(screen.getByRole("button", { name: "Envoyer et continuer" }));
    expect(await screen.findByText(/son contenu est du texte/)).toBeTruthy();
  });
});

describe("ImportAssistant : association des colonnes", () => {
  const mapped = { externalRef: "Matricule", lastName: "Nom", firstName: "Prénoms", sex: "Sexe" };
  it("champ obligatoire sans colonne : erreur de champ, aucun envoi ; sinon enregistre le mapping puis demande la validation", async () => {
    let status: ImportJobDto["status"] = "UPLOADED";
    const api = setTestApi({
      ...base(),
      [`GET /api/v1/imports/jobs/${JOB}`]: () => json(jobDto({ status, ...(status === "VALIDATING" ? { validationProgress: 30 } : {}) })),
      [`PUT /api/v1/imports/jobs/${JOB}/mapping`]: () => {
        status = "MAPPED";
        return json(jobDto({ status }));
      },
      [`POST /api/v1/imports/jobs/${JOB}/validate`]: () => {
        status = "VALIDATING";
        return json(jobDto({ status }), { status: 202 });
      },
    });
    renderWithProviders(<ImportAssistant jobId={JOB} />);
    await screen.findByRole("heading", { name: "2. Associer les colonnes du fichier" });
    // associe tout sauf « Nom » (obligatoire)
    fireEvent.change(screen.getByLabelText(/^Prénoms/), { target: { value: "Prénoms" } });
    fireEvent.change(screen.getByLabelText(/^Sexe/), { target: { value: "Sexe" } });
    fireEvent.click(screen.getByRole("button", { name: "Enregistrer et valider le fichier" }));
    expect((await screen.findAllByText("Associez une colonne à ce champ obligatoire.")).length).toBeGreaterThan(0);
    expect(api.calls.filter((c) => c.method === "PUT" || c.method === "POST")).toHaveLength(0);

    fireEvent.change(screen.getByLabelText(/^Nom/), { target: { value: "Nom" } });
    fireEvent.click(screen.getByLabelText(/Mettre à jour les lignes déjà présentes/));
    fireEvent.click(screen.getByRole("button", { name: "Enregistrer et valider le fichier" }));
    await screen.findByRole("heading", { name: "3. Validation du fichier en cours" });
    const put = api.calls.find((c) => c.method === "PUT")!;
    expect(put.body).toEqual({ mapping: { externalRef: null, lastName: "Nom", firstName: "Prénoms", sex: "Sexe" }, options: { duplicatePolicy: "REJECT" }, runMode: "VALID_ONLY", onExisting: "UPDATE" });
    expect(api.calls.some((c) => c.method === "POST" && c.path.endsWith("/validate"))).toBe(true);
    const bar = await screen.findByRole("progressbar", { name: "Validation des lignes" });
    await waitFor(() => expect(bar.getAttribute("aria-valuenow")).toBe("25"));
    void mapped;
  });

  it("un en-tête ne peut alimenter deux champs ; un modèle de mapping enregistré s'applique aux en-têtes du fichier", async () => {
    setTestApi({
      ...base(),
      "GET /api/v1/imports/templates": { items: [{ id: uuid(8001), importerKey: "students", name: "Export logiciel X", mapping: { lastName: "NOM", firstName: "PRENOMS", sex: "SEXE" }, headers: ["NOM", "PRENOMS", "SEXE"], createdBy: null, createdAt: "2026-10-01T08:00:00.000Z", updatedAt: "2026-10-01T08:00:00.000Z" }] },
      [`GET /api/v1/imports/jobs/${JOB}`]: jobDto({ headers: ["Matricule", "Nom", "Prénoms", "Sexe"], mapping: { externalRef: "Matricule", lastName: "Nom", firstName: null, sex: null } }),
    });
    renderWithProviders(<ImportAssistant jobId={JOB} />);
    await screen.findByRole("heading", { name: "2. Associer les colonnes du fichier" });
    const firstName = screen.getByLabelText(/^Prénoms/) as HTMLSelectElement;
    const used = within(firstName).getByRole("option", { name: /^Nom — déjà utilisée/ }) as HTMLOptionElement;
    expect(used.disabled).toBe(true);
    fireEvent.change(await screen.findByLabelText("Appliquer un modèle enregistré"), { target: { value: uuid(8001) } });
    await waitFor(() => expect((screen.getByLabelText(/^Prénoms/) as HTMLSelectElement).value).toBe("Prénoms"));
    expect((screen.getByLabelText(/^Sexe/) as HTMLSelectElement).value).toBe("Sexe");
  });
});

describe("ImportAssistant : aperçu, erreurs et lancement", () => {
  const validated = jobDto({ status: "VALIDATED", mapping: { externalRef: "Matricule", lastName: "Nom", firstName: "Prénoms", sex: "Sexe" }, validRows: 110, invalidRows: 10, plannedCreate: 100, plannedUpdate: 4, plannedSkip: 6, validationProgress: 120, validatedAt: "2026-10-02T08:05:00.000Z" });
  const routes = (extra: Record<string, unknown> = {}) => ({
    ...base(["imports.read", "imports.create", "imports.import.students"]),
    [`GET /api/v1/imports/jobs/${JOB}`]: validated,
    [`GET /api/v1/imports/jobs/${JOB}/preview`]: preview(),
    [`GET /api/v1/imports/jobs/${JOB}/rows`]: ({ url }: { url: URL }) => json({ items: [rowDto(5), rowDto(9, { issues: [issue("sex", "imports.invalid_value", "« Sexe » : valeur non reconnue (attendu M ou F).")] })].filter((r) => !url.searchParams.get("column") || r.issues.some((i) => i.column === url.searchParams.get("column"))), total: 2, limit: 20, offset: 0 }),
    ...extra,
  });

  it("affiche ce qui sera créé / mis à jour / ignoré / refusé SANS écrire, et le tableau des erreurs (filtrable par champ)", async () => {
    const api = setTestApi(routes());
    renderWithProviders(<ImportAssistant jobId={JOB} />);
    const summary = await screen.findByRole("group", { name: /Ce qui va se passer/ }).catch(() => null);
    void summary;
    expect(await screen.findByText("À créer")).toBeTruthy();
    expect(screen.getByText("100")).toBeTruthy();
    expect(screen.getByText(/Cet aperçu n'écrit rien/)).toBeTruthy();
    expect(screen.getByText(/7 ×/)).toBeTruthy();
    const list = await screen.findByRole("list", { name: "Lignes" });
    expect(within(list).getAllByText(/Ligne \d/).length).toBeGreaterThanOrEqual(2);
    expect(within(list).getByText(/« Prénoms » est obligatoire/)).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Champ concerné"), { target: { value: "sex" } });
    await waitFor(() => expect(api.calls.filter((c) => c.path.endsWith("/rows")).at(-1)!.query.column).toBe("sex"));
    await waitFor(() => expect(within(screen.getByRole("list", { name: "Lignes" })).getAllByText(/Ligne \d/)).toHaveLength(1));
    expect(api.calls.filter((c) => c.method !== "GET")).toHaveLength(0); // consulter n'écrit rien
  });

  it("le lancement exige une confirmation explicite ; « tout ou rien » est refusé tant que des erreurs subsistent ; le corps envoyé est exact", async () => {
    let status: ImportJobDto["status"] = "VALIDATED";
    const api = setTestApi(
      routes({
        [`GET /api/v1/imports/jobs/${JOB}`]: () => json(status === "VALIDATED" ? validated : jobDto({ status: "QUEUED", validRows: 110 })),
        [`POST /api/v1/imports/jobs/${JOB}/run`]: () => {
          status = "QUEUED";
          return json(jobDto({ status: "QUEUED" }), { status: 202 });
        },
      }),
    );
    renderWithProviders(<ImportAssistant jobId={JOB} />);
    const launch = (await screen.findByRole("button", { name: "Lancer l'import" })) as HTMLButtonElement;
    expect(launch.disabled).toBe(true);
    expect((screen.getByLabelText(/Tout ou rien/) as HTMLInputElement).disabled).toBe(true);
    expect(screen.getByText("Indisponible tant que le fichier contient des erreurs.")).toBeTruthy();
    fireEvent.click(screen.getByLabelText(/J'ai consulté l'aperçu/));
    expect(launch.disabled).toBe(false);
    fireEvent.click(launch);
    await screen.findByRole("heading", { name: "5. Import en cours" });
    expect(api.calls.find((c) => c.method === "POST" && c.path.endsWith("/run"))!.body).toEqual({ runMode: "VALID_ONLY", onExisting: "SKIP", confirm: true });
  });

  it("un refus du serveur (MFA exigée pour les soldes) est affiché tel quel, sans changer d'étape", async () => {
    setTestApi(
      routes({
        [`GET /api/v1/imports/jobs/${JOB}`]: jobDto({ ...validated, importerKey: "opening_balances", invalidRows: 0 }),
        "GET /api/v1/imports/importers": { items: [studentsDescriptor(), { ...balancesDescriptor(), canUse: true, canRun: true }] },
        [`GET /api/v1/imports/jobs/${JOB}/preview`]: preview({ invalidRows: 0, willFail: 0, topIssues: [] }),
        [`POST /api/v1/imports/jobs/${JOB}/run`]: () => json({ status: 403, code: "imports.mfa_required", kind: "forbidden", message: "Confirmez votre identité par l'authentification renforcée avant de lancer cet import." }, { status: 403 }),
      }),
    );
    renderWithProviders(<ImportAssistant jobId={JOB} />);
    expect(await screen.findByText(/crée des documents financiers/)).toBeTruthy();
    fireEvent.click(await screen.findByLabelText(/J'ai consulté l'aperçu/));
    fireEvent.click(screen.getByRole("button", { name: "Lancer l'import" }));
    // Élévation d'authentification : le code TOTP est demandé ; annuler garde le message du serveur, sans changer d'étape.
    const stepUp = await screen.findByRole("dialog", { name: "Confirmez votre identité" });
    fireEvent.click(within(stepUp).getByRole("button", { name: "Annuler" }));
    expect(await screen.findByText("Confirmez votre identité par l'authentification renforcée avant de lancer cet import.")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "4. Erreurs et aperçu avant import" })).toBeTruthy();
  });

  it("MFA exigée : code TOTP demandé, puis le lancement est rejoué UNE fois avec le même corps", async () => {
    let runs = 0;
    const api = setTestApi(
      routes({
        [`GET /api/v1/imports/jobs/${JOB}`]: jobDto({ ...validated, importerKey: "opening_balances", invalidRows: 0 }),
        "GET /api/v1/imports/importers": { items: [studentsDescriptor(), { ...balancesDescriptor(), canUse: true, canRun: true }] },
        [`GET /api/v1/imports/jobs/${JOB}/preview`]: preview({ invalidRows: 0, willFail: 0, topIssues: [] }),
        [`POST /api/v1/imports/jobs/${JOB}/run`]: () =>
          ++runs === 1 ? json({ status: 403, code: "imports.mfa_required", kind: "forbidden", message: "MFA requise." }, { status: 403 }) : json(jobDto({ status: "QUEUED" }), { status: 202 }),
        "POST /api/v1/iam/mfa/step-up": { elevated: true, expiresAt: "2026-10-02T10:05:00.000Z", ttlSec: 300 },
      }),
    );
    renderWithProviders(<ImportAssistant jobId={JOB} />);
    fireEvent.click(await screen.findByLabelText(/J'ai consulté l'aperçu/));
    fireEvent.click(screen.getByRole("button", { name: "Lancer l'import" }));
    const stepUp = await screen.findByRole("dialog", { name: "Confirmez votre identité" });
    fireEvent.change(within(stepUp).getByLabelText(/Code à 6 chiffres/), { target: { value: "123456" } });
    fireEvent.click(within(stepUp).getByRole("button", { name: "Confirmer et continuer" }));
    await waitFor(() => expect(runs).toBe(2));
    const runCalls = api.calls.filter((c) => c.method === "POST" && c.path.endsWith("/run"));
    expect(runCalls).toHaveLength(2);
    expect(runCalls[1]!.body).toEqual(runCalls[0]!.body);
    expect(api.calls.filter((c) => c.path === "/api/v1/iam/mfa/step-up")).toHaveLength(1);
  });
});

describe("ImportAssistant : import en cours et rapport", () => {
  it("progression en direct et annulation confirmée", async () => {
    const api = setTestApi({
      ...base(),
      [`GET /api/v1/imports/jobs/${JOB}`]: jobDto({ status: "RUNNING", validRows: 200, processedCount: 50, createdCount: 48, failedCount: 2 }),
      [`POST /api/v1/imports/jobs/${JOB}/cancel`]: () => json(jobDto({ status: "RUNNING", cancelRequested: true })),
    });
    renderWithProviders(<ImportAssistant jobId={JOB} />);
    const bar = await screen.findByRole("progressbar", { name: "Lignes traitées" });
    expect(bar.getAttribute("aria-valuenow")).toBe("25");
    expect(screen.getByText("48")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Annuler l'import" }));
    expect(screen.getByText(/Les lignes déjà écrites sont conservées/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Oui, annuler l'import" }));
    await waitFor(() => expect(api.calls.some((c) => c.method === "POST" && c.path.endsWith("/cancel"))).toBe(true));
  });

  it("rapport : décomptes, durée, auteur, erreurs par ligne et téléchargement (CSV neutralisé côté serveur)", async () => {
    const created = vi.fn(() => "blob:test");
    const revoked = vi.fn();
    Object.assign(URL, { createObjectURL: created, revokeObjectURL: revoked });
    const done = jobDto({ status: "COMPLETED_WITH_ERRORS", createdCount: 100, updatedCount: 4, skippedCount: 6, failedCount: 10, processedCount: 110, startedAt: "2026-10-02T08:06:00.000Z", durationMs: 75_000 });
    const api = setTestApi({
      ...base(),
      [`GET /api/v1/imports/jobs/${JOB}`]: done,
      [`GET /api/v1/imports/jobs/${JOB}/summary`]: { job: done, author: { userId: uuid(7), displayName: "Awa Koné" }, totals: { created: 100, updated: 4, skipped: 6, failed: 10, processed: 110, total: 120 }, topIssues: [{ code: "imports.required", count: 7, column: "firstName", example: "Le champ « Prénoms » est obligatoire." }] },
      [`GET /api/v1/imports/jobs/${JOB}/rows`]: { items: [rowDto(5)], total: 1, limit: 20, offset: 0 },
      [`GET /api/v1/imports/jobs/${JOB}/report`]: () => new Response("Ligne;Message\r\n5;ok\r\n", { status: 200, headers: { "content-type": "text/csv" } }),
    });
    renderWithProviders(<ImportAssistant jobId={JOB} />);
    expect(await screen.findByText("Import terminé avec des erreurs")).toBeTruthy();
    const totals = await screen.findByRole("group", { name: "Décomptes de l'import" }).catch(() => null);
    void totals;
    expect(await screen.findByText("Awa Koné")).toBeTruthy();
    expect(screen.getByText("1 min 15 s")).toBeTruthy();
    expect(screen.getByText("Lignes valides seulement")).toBeTruthy();
    expect(await screen.findByRole("heading", { name: "Lignes en erreur" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Télécharger le rapport (CSV)" }));
    await waitFor(() => expect(created).toHaveBeenCalled());
    const call = api.calls.find((c) => c.path.endsWith("/report"))!;
    expect(call.query).toEqual({ format: "csv", kind: "full" });
    expect(screen.getByRole("link", { name: "Nouvel import" }).getAttribute("href")).toBe("/v2/imports/new");
  });

  it("import en échec en mode « tout ou rien » : le message du serveur et l'absence d'écriture sont expliqués", async () => {
    const failed = jobDto({ status: "FAILED", runMode: "ALL_OR_NOTHING", errorCode: "imports.write_failed", errorMessage: "Mode « tout ou rien » : la ligne 16 a été refusée par le module cible. Aucune donnée n'a été écrite." });
    setTestApi({
      ...base(),
      [`GET /api/v1/imports/jobs/${JOB}`]: failed,
      [`GET /api/v1/imports/jobs/${JOB}/summary`]: { job: failed, author: { userId: uuid(7), displayName: null }, totals: { created: 0, updated: 0, skipped: 0, failed: 1, processed: 1, total: 20 }, topIssues: [] },
      [`GET /api/v1/imports/jobs/${JOB}/rows`]: { items: [], total: 0, limit: 20, offset: 0 },
    });
    renderWithProviders(<ImportAssistant jobId={JOB} />);
    expect(await screen.findByText("Import en échec")).toBeTruthy();
    expect(screen.getAllByText(/Aucune donnée n'a été écrite/).length).toBeGreaterThanOrEqual(1);
  });
});

describe("TemplatesScreen", () => {
  beforeEach(() => {
    Object.assign(URL, { createObjectURL: () => "blob:test", revokeObjectURL: () => undefined });
  });
  afterEach(() => vi.restoreAllMocks());

  it("modèles de fichier téléchargeables par importeur et gestion des modèles de mapping (suppression confirmée)", async () => {
    const api = setTestApi({
      ...base(["imports.read", "imports.template.manage"]),
      "GET /api/v1/imports/templates": { items: [{ id: uuid(8001), importerKey: "students", name: "Export logiciel X", mapping: { lastName: "NOM" }, headers: ["NOM"], createdBy: null, createdAt: "2026-10-01T08:00:00.000Z", updatedAt: "2026-10-01T08:00:00.000Z" }] },
      "GET /api/v1/imports/importers/students/template": () => new Response("a;b", { status: 200, headers: { "content-type": "text/csv" } }),
      [`DELETE /api/v1/imports/templates/${uuid(8001)}`]: () => new Response(null, { status: 204 }),
    });
    renderWithProviders(<TemplatesScreen />);
    fireEvent.click(await screen.findByRole("button", { name: "Modèle Excel : Élèves" }));
    await waitFor(() => expect(api.calls.find((c) => c.path === "/api/v1/imports/importers/students/template")!.query).toEqual({ format: "xlsx" }));
    const table = await screen.findByRole("table", { name: "Modèles de mapping" });
    expect(within(table).getByText("Export logiciel X")).toBeTruthy();
    fireEvent.click(within(table).getByRole("button", { name: "Supprimer le modèle Export logiciel X" }));
    fireEvent.click(within(table).getByRole("button", { name: "Confirmer la suppression" }));
    await waitFor(() => expect(api.calls.some((c) => c.method === "DELETE")).toBe(true));
  });

  it("sans imports.template.manage : lecture seule", async () => {
    setTestApi({ ...base(["imports.read"]), "GET /api/v1/imports/templates": { items: [{ id: uuid(8001), importerKey: "students", name: "Export logiciel X", mapping: {}, headers: [], createdBy: null, createdAt: "2026-10-01T08:00:00.000Z", updatedAt: "2026-10-01T08:00:00.000Z" }] } });
    renderWithProviders(<TemplatesScreen />);
    expect(await screen.findByText("Export logiciel X")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Supprimer le modèle/ })).toBeNull();
  });
});

describe("SettingsScreen", () => {
  const settings = { maxRows: 5000, maxColumns: 100, maxFileBytes: 5242880, batchSize: 200, allOrNothingMaxRows: 5000, maxActiveJobs: 5, maxJobsPerDay: 50, retentionDays: 30, hardLimits: { maxRows: 20000, maxColumns: 200, maxFileBytes: 20971520 } };
  it("refuse une valeur hors plafond (message de champ, aucun envoi) puis enregistre", async () => {
    const api = setTestApi({ ...base(["imports.manage"]), "GET /api/v1/imports/settings": settings, "PUT /api/v1/imports/settings": ({ body }) => json({ ...settings, ...(body as object), hardLimits: settings.hardLimits }) });
    renderWithProviders(<SettingsScreen />);
    const rows = (await screen.findByLabelText("Lignes par fichier")) as HTMLInputElement;
    fireEvent.change(rows, { target: { value: "50000" } });
    fireEvent.click(screen.getByRole("button", { name: "Enregistrer" }));
    expect(await screen.findByText("Entrez un nombre entier entre 1 et 20000.")).toBeTruthy();
    expect(api.calls.filter((c) => c.method === "PUT")).toHaveLength(0);
    fireEvent.change(rows, { target: { value: "8000" } });
    fireEvent.click(screen.getByRole("button", { name: "Enregistrer" }));
    expect(await screen.findByText("Paramètres enregistrés.")).toBeTruthy();
    expect(api.calls.find((c) => c.method === "PUT")!.body).toMatchObject({ maxRows: 8000, maxFileBytes: 5242880, batchSize: 200 });
  });
});
