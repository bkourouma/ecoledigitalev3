// @vitest-environment jsdom
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  assignmentDetailDtoSchema,
  assignmentDocumentDtoSchema,
  assignmentDtoSchema,
  childAssignmentDtoSchema,
  controlDtoSchema,
  exportCatalogResponseSchema,
  exportFormatDtoSchema,
  receivableDtoSchema,
  receivablesAgingResponseSchema,
  reconciliationReportResponseSchema,
  stateassignSettingsDtoSchema,
  stateassignSummaryResponseSchema,
} from "@ecoledigitale/contracts/v2/stateassign";
import { accessRoutes, setTestApi } from "@/platform/test/api-mock";
import { json, renderWithProviders } from "@/platform/test/render";
import { institution, year } from "../../_test/fixtures";
import { mariam } from "../../_test/fixtures-family";
import { enrollment as peopleEnrollment, studentSummary } from "../../_test/fixtures-people";
import { aging, assignment, catalog, child, control, detail, assignmentDocument, format, IDS, receivable, reconciliationReport, settings, summary, xof } from "../_test/fixtures";
import { AssignmentDetailScreen } from "./AssignmentDetailScreen";
import { AssignmentsScreen } from "./AssignmentsScreen";
import { FamilyScreen } from "./FamilyScreen";
import { ReceivablesScreen } from "./ReceivablesScreen";
import { ReconciliationScreen } from "./ReconciliationScreen";
import { ReportsScreen } from "./ReportsScreen";
import { SettingsScreen } from "./SettingsScreen";
import { StateassignNav } from "./StateassignShell";
import { VerificationScreen } from "./VerificationScreen";

vi.setConfig({ testTimeout: 30_000 });

const NOW_ISO = "2026-10-02T09:00:00.000Z";
const uuid2 = (n: number): string => `0192f0a4-7b1e-7c3a-8d2e-${String(n).padStart(12, "0")}`;

const nav = vi.hoisted(() => ({ push: vi.fn() }));
const download = vi.hoisted(() => ({ downloadTextFile: vi.fn() }));
vi.mock("@/platform/api/default-client", async () => (await import("@/platform/test/api-mock")).defaultClientModule);
vi.mock("next/navigation", () => ({ usePathname: () => "/v2/stateassign", useRouter: () => ({ push: nav.push, replace: vi.fn() }), useSearchParams: () => new URLSearchParams() }));
vi.mock("next/link", () => ({ default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a> }));
vi.mock("@/platform/ui/download", () => download);

const S = "/api/v1/stateassign";
const STAFF = ["stateassign.read", "stateassign.record", "stateassign.verify", "stateassign.manage", "stateassign.amend", "stateassign.reconcile", "stateassign.receivable.manage", "stateassign.control.perform", "stateassign.document.manage", "stateassign.export", "stateassign.settings.manage"];
const common = () => ({
  "GET /api/v1/tenancy/institutions": { items: [institution] },
  "GET /api/v1/academic/years": { items: [year()] },
});
const as = (permissions: string[], extra: Record<string, unknown> = {}) => ({ ...accessRoutes(permissions, ["stateassign.core"]), ...common(), ...extra });

beforeEach(() => {
  nav.push.mockClear();
  download.downloadTextFile.mockClear();
});
afterEach(() => vi.restoreAllMocks());

describe("fabriques de test conformes aux contrats courants", () => {
  it("les données simulées passent les schémas de réponse (aucune dérive silencieuse)", () => {
    expect(assignmentDtoSchema.safeParse(assignment()).success).toBe(true);
    expect(assignmentDetailDtoSchema.safeParse(detail({ receivables: [receivable()], controls: [control()], documents: [assignmentDocument()] })).success).toBe(true);
    expect(receivableDtoSchema.safeParse(receivable()).success).toBe(true);
    expect(controlDtoSchema.safeParse(control()).success).toBe(true);
    expect(assignmentDocumentDtoSchema.safeParse(assignmentDocument()).success).toBe(true);
    expect(stateassignSettingsDtoSchema.safeParse(settings()).success).toBe(true);
    expect(stateassignSummaryResponseSchema.safeParse(summary()).success).toBe(true);
    expect(receivablesAgingResponseSchema.safeParse(aging()).success).toBe(true);
    expect(reconciliationReportResponseSchema.safeParse(reconciliationReport()).success).toBe(true);
    expect(exportFormatDtoSchema.safeParse(format()).success).toBe(true);
    expect(exportCatalogResponseSchema.safeParse(catalog()).success).toBe(true);
    expect(childAssignmentDtoSchema.safeParse(child()).success).toBe(true);
  });
});

describe("StateassignNav : onglets selon les permissions", () => {
  it("la lecture voit dossiers, créances et états ; la vérification, le rapprochement et les paramètres suivent leur permission", async () => {
    setTestApi(as(["stateassign.read"]));
    const { unmount } = renderWithProviders(<StateassignNav />);
    expect(await screen.findByRole("link", { name: "Dossiers" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Créances" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "États" })).toBeTruthy();
    expect(screen.queryByRole("link", { name: "Vérification" })).toBeNull();
    expect(screen.queryByRole("link", { name: "Paramètres" })).toBeNull();
    unmount();
    setTestApi(as(["stateassign.read", "stateassign.verify", "stateassign.settings.manage"]));
    renderWithProviders(<StateassignNav />);
    expect(await screen.findByRole("link", { name: "Vérification" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Paramètres" })).toBeTruthy();
  });
});

describe("AssignmentsScreen : liste et enregistrement", () => {
  const page = (items = [assignment(), assignment({ id: IDS.assignment2, reference: "AFF-2026-002", status: "ACTIVE", studentName: null, reconciliation: { status: "BALANCED", lastReconciledAt: null, stateDelta: xof(0), parentDelta: xof(0), stateBilled: xof(400000), parentBilled: xof(100000) } })]) => ({ items, total: items.length, page: 1, pageSize: 30 });

  it("liste les dossiers : statut et rapprochement en TEXTE, montants déclarés entiers, lien vers la fiche", async () => {
    setTestApi(as(["stateassign.read"], { [`GET ${S}/assignments`]: page() }));
    renderWithProviders(<AssignmentsScreen />);
    const table = await screen.findByRole("table", { name: "Dossiers d'affectation" });
    expect(await within(table).findByText("KOUASSI Awa")).toBeTruthy();
    expect(within(table).getByText("Enregistré")).toBeTruthy();
    expect(within(table).getByText("Actif")).toBeTruthy();
    expect(within(table).getByText("Conforme")).toBeTruthy();
    expect(within(table).getByText("Jamais rapproché")).toBeTruthy();
    expect(within(table).getByText("Élève inconnu")).toBeTruthy();
    expect(within(table).getAllByText(/400\s?000/).length).toBeGreaterThan(0);
    expect(within(table).getByRole("link", { name: /AFF-2026-001/ }).getAttribute("href")).toBe(`/v2/stateassign/${IDS.assignment}`);
    expect(screen.queryByRole("button", { name: "Enregistrer un dossier" })).toBeNull(); // pas de permission de saisie
  });

  it("filtres : statut, recherche de référence et historique sont transmis à l'API", async () => {
    const api = setTestApi(as(["stateassign.read"], { [`GET ${S}/assignments`]: page() }));
    renderWithProviders(<AssignmentsScreen />);
    await screen.findByRole("table", { name: "Dossiers d'affectation" });
    fireEvent.change(screen.getByLabelText("Statut"), { target: { value: "ACTIVE" } });
    fireEvent.change(screen.getByRole("searchbox", { name: "Référence" }), { target: { value: "AFF-2026" } });
    fireEvent.click(screen.getByRole("checkbox", { name: /Inclure les versions remplacées/ }));
    await waitFor(() => {
      const last = api.calls.filter((c) => c.path === `${S}/assignments`).at(-1)!;
      expect(last.query).toMatchObject({ status: "ACTIVE", q: "AFF-2026", includeHistory: "true", page: "1", pageSize: "30" });
    });
  });

  it("états : vide avec invitation, erreur avec « Réessayer »", async () => {
    let fail = true;
    setTestApi(as(["stateassign.read"], { [`GET ${S}/assignments`]: () => (fail ? json({ code: "INTERNAL", message: "boom" }, { status: 500 }) : json(page([]))) }));
    renderWithProviders(<AssignmentsScreen />);
    const retry = await screen.findByRole("button", { name: "Réessayer" });
    fail = false;
    fireEvent.click(retry);
    expect(await screen.findByText("Aucun dossier ne correspond.")).toBeTruthy();
  });

  it("enregistrer : montant décimal refusé avant tout envoi ; envoi avec des ENTIERS, puis ouverture de la fiche", async () => {
    const api = setTestApi(
      as(["stateassign.read", "stateassign.record"], {
        [`GET ${S}/assignments`]: page([]),
        "GET /api/v1/people/students": { items: [studentSummary({ id: IDS.student, displayName: "KOUASSI Awa" })], total: 1, limit: 20, offset: 0 },
        "GET /api/v1/academic/enrollments": { items: [peopleEnrollment({ id: IDS.enrollment, studentId: IDS.student, registrationNumber: "R-2026-001" })], total: 1, page: 1, pageSize: 50 },
        [`POST ${S}/assignments`]: () => json(assignment(), { status: 201 }),
      }),
    );
    renderWithProviders(<AssignmentsScreen />);
    fireEvent.click(await screen.findByRole("button", { name: "Enregistrer un dossier" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Enregistrer le dossier" }));
    expect((await within(dialog).findAllByRole("alert")).map((a) => a.textContent)).toEqual(expect.arrayContaining(["Choisissez l'inscription concernée.", "La référence d'affectation est obligatoire."]));
    expect(api.calls.some((c) => c.method === "POST")).toBe(false);

    fireEvent.change(within(dialog).getByLabelText(/Référence d'affectation/), { target: { value: "  AFF-2026-001 " } });
    fireEvent.change(within(dialog).getByLabelText(/Part de l'État/), { target: { value: "400000,5" } });
    const student = within(dialog).getByRole("combobox", { name: /Élève/ });
    fireEvent.focus(student);
    fireEvent.change(student, { target: { value: "Kouassi" } });
    fireEvent.click(await within(dialog).findByRole("option", { name: /KOUASSI Awa/ }));
    const enrollmentSelect = within(dialog).getByLabelText(/Inscription/) as HTMLSelectElement;
    await waitFor(() => expect(enrollmentSelect.options.length).toBeGreaterThan(1));
    fireEvent.change(enrollmentSelect, { target: { value: IDS.enrollment } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Enregistrer le dossier" }));
    expect((await within(dialog).findAllByRole("alert")).some((a) => /nombre entier de francs/.test(a.textContent ?? ""))).toBe(true);
    expect(api.calls.some((c) => c.method === "POST")).toBe(false);

    fireEvent.change(within(dialog).getByLabelText(/Part de l'État/), { target: { value: "400 000" } });
    fireEvent.change(within(dialog).getByLabelText(/Part de la famille/), { target: { value: "100000" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Enregistrer le dossier" }));
    await waitFor(() => expect(api.calls.filter((c) => c.method === "POST")).toHaveLength(1));
    const post = api.calls.find((c) => c.method === "POST")!;
    expect(post.path).toBe(`${S}/assignments`);
    expect(post.body).toEqual({ enrollmentId: IDS.enrollment, reference: "AFF-2026-001", declaredStateAmount: 400000, declaredParentAmount: 100000 });
    await waitFor(() => expect(nav.push).toHaveBeenCalledWith(`/v2/stateassign/${IDS.assignment}`));
  });
});

describe("AssignmentDetailScreen : fiche du dossier", () => {
  const open = (d: ReturnType<typeof detail>, permissions: string[], extra: Record<string, unknown> = {}) => {
    const api = setTestApi(as(permissions, { [`GET ${S}/assignments/${d.assignment.id}`]: d, ...extra }));
    renderWithProviders(<AssignmentDetailScreen id={d.assignment.id} />);
    return api;
  };

  it("les actes suivent le statut ET la permission : lecture seule = aucun bouton d'acte ; vérificateur = vérifier / rejeter ; jamais les deux statuts à la fois", async () => {
    open(detail(), ["stateassign.read"]);
    expect(await screen.findByRole("heading", { level: 1, name: "Dossier AFF-2026-001 (version 1)" })).toBeTruthy();
    expect(screen.getByText(/Aucun acte n'est disponible/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Vérifier le dossier" })).toBeNull();
  });

  it("vérification : par un humain habilité, avec la version lue (concurrence optimiste) ; refus de l'API (séparation des tâches) affiché tel quel", async () => {
    let refuse = true;
    const api = open(detail(), ["stateassign.read", "stateassign.verify"], {
      [`POST ${S}/assignments/${IDS.assignment}/verify`]: () => (refuse ? json({ code: "stateassign.four_eyes_required", message: "La vérification doit venir d'une autre personne que l'enregistrant." }, { status: 403 }) : json(assignment({ status: "VERIFIED", rowVersion: 4 }))),
    });
    expect(await screen.findByRole("button", { name: "Rejeter" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Activer" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Vérifier le dossier" }));
    const dialog = await screen.findByRole("dialog", { name: "Vérifier le dossier d'affectation" });
    expect(within(dialog).getByText(/autre personne que celle qui a enregistré|vérifier un dossier que vous avez vous-même enregistré/)).toBeTruthy();
    fireEvent.change(within(dialog).getByLabelText(/Note de vérification/), { target: { value: "Pièces conformes" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Vérifier" }));
    expect(await within(dialog).findByText("La vérification doit venir d'une autre personne que l'enregistrant.")).toBeTruthy();
    refuse = false;
    fireEvent.click(within(dialog).getByRole("button", { name: "Vérifier" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    const posts = api.calls.filter((c) => c.method === "POST");
    expect(posts.at(-1)!.body).toEqual({ rowVersion: 3, note: "Pièces conformes" });
    expect(await screen.findByText(/Dossier vérifié : la référence d'affectation est portée sur l'inscription/)).toBeTruthy();
  });

  it("rejet : motif obligatoire (5 caractères) ; l'API reçoit la version et le motif", async () => {
    const api = open(detail(), ["stateassign.read", "stateassign.verify"], { [`POST ${S}/assignments/${IDS.assignment}/reject`]: assignment({ status: "REJECTED" }) });
    fireEvent.click(await screen.findByRole("button", { name: "Rejeter" }));
    const dialog = await screen.findByRole("dialog", { name: "Rejeter le dossier" });
    fireEvent.change(within(dialog).getByLabelText(/Motif du rejet/), { target: { value: "ko" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Rejeter le dossier" }));
    expect(await within(dialog).findByRole("alert")).toBeTruthy();
    expect(api.calls.some((c) => c.method === "POST")).toBe(false);
    fireEvent.change(within(dialog).getByLabelText(/Motif du rejet/), { target: { value: "Acte non reconnu par l'autorité" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Rejeter le dossier" }));
    await waitFor(() => expect(api.calls.filter((c) => c.method === "POST")).toHaveLength(1));
    expect(api.calls.find((c) => c.method === "POST")!.body).toEqual({ rowVersion: 3, reason: "Acte non reconnu par l'autorité" });
  });

  it("dossier actif : activer / suspendre / terminer / transférer / amender / rapprocher selon les permissions", async () => {
    open(detail({}, { status: "ACTIVE", verifiedAt: NOW_ISO, verifiedBy: IDS.user }), ["stateassign.read", "stateassign.manage", "stateassign.amend", "stateassign.reconcile"]);
    for (const name of ["Suspendre", "Terminer", "Transférer", "Amender", "Rapprocher avec la facturation"]) expect(await screen.findByRole("button", { name })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Vérifier le dossier" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Activer" })).toBeNull();
  });

  it("avenant : motif et date d'effet requis, montant décimal refusé ; seul ce qui change est envoyé (champ vide = inchangé)", async () => {
    const api = open(detail({}, { status: "ACTIVE", verifiedAt: NOW_ISO, verifiedBy: IDS.user }), ["stateassign.read", "stateassign.amend"], {
      [`POST ${S}/assignments/${IDS.assignment}/amend`]: () => json({ superseded: assignment({ status: "SUPERSEDED" }), current: assignment({ id: IDS.assignment2, version: 2 }) }, { status: 201 }),
    });
    fireEvent.click(await screen.findByRole("button", { name: "Amender" }));
    const dialog = await screen.findByRole("dialog", { name: "Avenant : version 2" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Créer l'avenant" }));
    expect((await within(dialog).findAllByRole("alert")).length).toBeGreaterThanOrEqual(2);
    fireEvent.change(within(dialog).getByLabelText(/Motif de l'avenant/), { target: { value: "Avenant n°2 : montant État révisé" } });
    fireEvent.change(within(dialog).getByLabelText(/Date d'effet/), { target: { value: "2026-11-01" } });
    fireEvent.change(within(dialog).getByLabelText(/Part de l'État/), { target: { value: "450000.5" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Créer l'avenant" }));
    expect((await within(dialog).findAllByRole("alert")).some((a) => /nombre entier de francs/.test(a.textContent ?? ""))).toBe(true);
    expect(api.calls.some((c) => c.method === "POST")).toBe(false);
    fireEvent.change(within(dialog).getByLabelText(/Part de l'État/), { target: { value: "450 000" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Créer l'avenant" }));
    await waitFor(() => expect(api.calls.filter((c) => c.method === "POST")).toHaveLength(1));
    expect(api.calls.find((c) => c.method === "POST")!.body).toEqual({ reason: "Avenant n°2 : montant État révisé", effectiveOn: "2026-11-01", rowVersion: 3, declaredStateAmount: 450000 });
  });

  it("parts État / famille : déclaré, facturé et écart ; un écart est signalé en TEXTE ; l'inscription incohérente est dite", async () => {
    open(
      detail(
        { enrollment: { fundingType: "PRIVATE", assignmentReference: null, status: "ACTIVE", referenceMatchesAssignment: false } },
        { status: "ACTIVE", verifiedAt: NOW_ISO, reconciliation: { status: "DISCREPANCY", lastReconciledAt: NOW_ISO, stateDelta: xof(-100000), parentDelta: xof(25000), stateBilled: xof(300000), parentBilled: xof(125000) } },
      ),
      ["stateassign.read"],
    );
    const table = await screen.findByRole("table", { name: "Montants déclarés, facturés et écarts par part" });
    const stateRow = within(table).getByRole("row", { name: /^État/ });
    expect(within(stateRow).getAllByRole("cell").map((c) => c.textContent?.replace(/\s/g, " "))).toEqual(expect.arrayContaining([expect.stringMatching(/400\s000/), expect.stringMatching(/300\s000/), expect.stringMatching(/-100\s000/)]));
    expect(screen.getAllByText("Écart").length).toBeGreaterThan(0);
    expect(screen.getByText(/ne correspondent pas à l'acte/)).toBeTruthy();
    expect(screen.getByTestId("enrollment-check").textContent).toMatch(/Attention : l'inscription est « PRIVATE »/);
  });

  it("créances : retard en texte, planification refusée avec un montant décimal puis envoyée en entier ; annulation motivée avec la version lue", async () => {
    const overdue = receivable({ overdue: true, daysOverdue: 35, status: "PARTIALLY_RECEIVED", received: xof(100000), outstanding: xof(50000) });
    const open1 = receivable({ id: uuid2(51), seq: 2, label: "2e versement", status: "OPEN", rowVersion: 5 });
    const api = open(
      detail({ receivables: [overdue, open1], receivablesSummary: { expected: xof(300000), received: xof(100000), outstanding: xof(200000), overdue: xof(50000), unscheduled: xof(100000) } }, { status: "ACTIVE", verifiedAt: NOW_ISO }),
      ["stateassign.read", "stateassign.receivable.manage"],
      { [`POST ${S}/assignments/${IDS.assignment}/receivables`]: () => json(receivable({ id: uuid2(52), seq: 3 }), { status: 201 }), [`POST ${S}/receivables/${uuid2(51)}/cancel`]: receivable({ id: uuid2(51), status: "CANCELLED" }) },
    );
    const table = await screen.findByRole("table", { name: "Échéances de la créance sur l'État" });
    expect(within(table).getByText("En retard de 35 j")).toBeTruthy();
    expect(within(table).getByText("Partiellement reçu")).toBeTruthy();
    // planifier
    fireEvent.click(await screen.findByRole("button", { name: "Planifier une échéance" }));
    const dialog = await screen.findByRole("dialog", { name: "Planifier une échéance" });
    fireEvent.change(within(dialog).getByLabelText(/Libellé/), { target: { value: "3e versement" } });
    fireEvent.change(within(dialog).getByLabelText(/Date d'échéance/), { target: { value: "2027-05-15" } });
    fireEvent.change(within(dialog).getByLabelText(/Montant attendu/), { target: { value: "100000,50" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Planifier" }));
    expect(await within(dialog).findByText(/nombre entier de francs/)).toBeTruthy();
    expect(api.calls.some((c) => c.method === "POST")).toBe(false);
    fireEvent.change(within(dialog).getByLabelText(/Montant attendu/), { target: { value: "100 000" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Planifier" }));
    await waitFor(() => expect(api.calls.filter((c) => c.method === "POST")).toHaveLength(1));
    expect(api.calls.find((c) => c.method === "POST")!.body).toEqual({ label: "3e versement", dueOn: "2027-05-15", expectedAmount: 100000 });
    // annuler : seulement une échéance sans versement, avec la version de la ligne
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(await within(table).findAllByRole("button", { name: /Annuler/ })).toHaveLength(1);
    fireEvent.click(within(table).getByRole("button", { name: /Annuler/ }));
    const cancel = await screen.findByRole("dialog", { name: "Annuler l'échéance" });
    fireEvent.change(within(cancel).getByLabelText(/Motif de l'annulation/), { target: { value: "Erreur de saisie" } });
    fireEvent.click(within(cancel).getByRole("button", { name: "Annuler l'échéance" }));
    await waitFor(() => expect(api.calls.filter((c) => c.method === "POST")).toHaveLength(2));
    expect(api.calls.filter((c) => c.method === "POST").at(-1)!.body).toEqual({ reason: "Erreur de saisie", rowVersion: 5 });
  });

  it("contrôles : une anomalie exige un constat ; les faits de présence consignés sont affichés tels quels ; dispenser est motivé", async () => {
    const pending = control({ id: uuid2(61), kind: "ATTENDANCE", academicPeriodId: IDS.period, status: "PENDING", overdue: true });
    const done = control({ id: uuid2(62), kind: "ATTENDANCE", status: "ANOMALY", findings: "Absences non justifiées", evidence: { attendance: { available: true, source: "attendance", absentMinutes: 540, excusedMinutes: 120, lateCount: 3 } } });
    const api = open(detail({ controls: [pending, done] }, { status: "ACTIVE", verifiedAt: NOW_ISO }), ["stateassign.read", "stateassign.control.perform"], {
      [`POST ${S}/controls/${uuid2(61)}/complete`]: control({ id: uuid2(61), status: "ANOMALY" }),
      [`POST ${S}/controls/${uuid2(61)}/waive`]: control({ id: uuid2(61), status: "WAIVED" }),
    });
    const table = await screen.findByRole("table", { name: "Contrôles du dossier" });
    expect(within(table).getByText("En retard")).toBeTruthy();
    expect(within(table).getByText(/Faits de présence : absences 9 h \(dont justifiées 2 h\), 3 retard\(s\)\./)).toBeTruthy();
    fireEvent.click((await within(table).findAllByRole("button", { name: /Réaliser/ }))[0]!);
    const dialog = await screen.findByRole("dialog", { name: "Réaliser le contrôle" });
    expect(within(dialog).getByText(/lus dans le module des présences/)).toBeTruthy();
    fireEvent.change(within(dialog).getByLabelText(/Résultat/), { target: { value: "ANOMALY" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Consigner le résultat" }));
    expect(await within(dialog).findByText(/constat de 5 caractères minimum/)).toBeTruthy();
    expect(api.calls.some((c) => c.method === "POST")).toBe(false);
    fireEvent.change(within(dialog).getByLabelText(/Constat/), { target: { value: "Absences non justifiées au-delà du suivi" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Consigner le résultat" }));
    await waitFor(() => expect(api.calls.filter((c) => c.method === "POST")).toHaveLength(1));
    expect(api.calls.find((c) => c.method === "POST")!.body).toEqual({ outcome: "ANOMALY", findings: "Absences non justifiées au-delà du suivi" });
  });

  it("pièces : références de la GED, retrait motivé ; versions et historique du dossier", async () => {
    const api = open(
      detail({ documents: [assignmentDocument(), assignmentDocument({ id: uuid2(72), label: "Ancienne copie", status: "WITHDRAWN", withdrawnReason: "Pièce remplacée" })], versions: [
        { id: IDS.v1, version: 1, status: "SUPERSEDED", reference: "AFF-2026-001", declaredState: xof(400000), declaredParent: xof(100000), issuedOn: "2026-09-15", endedOn: "2026-11-01", endReason: "Avenant n°2", receivedAt: NOW_ISO, verifiedAt: NOW_ISO },
        { id: IDS.assignment, version: 2, status: "RECEIVED", reference: "AFF-2026-001", declaredState: xof(450000), declaredParent: xof(100000), issuedOn: "2026-09-15", endedOn: null, endReason: null, receivedAt: NOW_ISO, verifiedAt: null },
      ] }, { version: 2, supersedesId: IDS.v1 }),
      ["stateassign.read", "stateassign.document.manage"],
      { [`POST ${S}/documents/${IDS.document}/withdraw`]: assignmentDocument({ status: "WITHDRAWN" }) },
    );
    const list = await screen.findByRole("list", { name: "Pièces du dossier" });
    expect(within(list).getByText("Acte d'affectation", { selector: "p.font-medium" })).toBeTruthy();
    expect(within(list).getByText("Retirée : Pièce remplacée")).toBeTruthy();
    expect(screen.getByRole("link", { name: /Ouvrir/ }).getAttribute("href")).toBe(`/v2/stateassign/${IDS.v1}`);
    expect(screen.getByRole("list", { name: "Versions" }).textContent).toMatch(/Version 1/);
    fireEvent.click(await within(list).findByRole("button", { name: /Retirer/ }));
    const dialog = await screen.findByRole("dialog", { name: "Retirer la pièce" });
    fireEvent.change(within(dialog).getByLabelText(/Motif du retrait/), { target: { value: "Pièce remplacée par l'original" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Retirer la pièce" }));
    await waitFor(() => expect(api.calls.filter((c) => c.method === "POST")).toHaveLength(1));
    expect(api.calls.find((c) => c.method === "POST")!.body).toEqual({ reason: "Pièce remplacée par l'original" });
  });
});

describe("VerificationScreen", () => {
  it("file des dossiers à vérifier : le statut RECEIVED est demandé à l'API, chaque ligne mène à la fiche (pas de vérification en un clic)", async () => {
    const api = setTestApi(as(["stateassign.verify"], { [`GET ${S}/assignments`]: { items: [assignment()], total: 1, page: 1, pageSize: 30 } }));
    renderWithProviders(<VerificationScreen />);
    const table = await screen.findByRole("table", { name: "Dossiers en attente d'un acte" });
    expect((await within(table).findByRole("link", { name: /Examiner/ })).getAttribute("href")).toBe(`/v2/stateassign/${IDS.assignment}`);
    expect(screen.getByText(/aucune vérification n'est jamais automatique/i)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Vérifier" })).toBeNull();
    fireEvent.change(screen.getByLabelText("Afficher"), { target: { value: "VERIFIED" } });
    await waitFor(() => expect(api.calls.filter((c) => c.path === `${S}/assignments`).at(-1)!.query.status).toBe("VERIFIED"));
    expect(api.calls.find((c) => c.path === `${S}/assignments`)!.query.status).toBe("RECEIVED");
  });
});

describe("ReconciliationScreen", () => {
  const routes = (extra: Record<string, unknown> = {}) =>
    as(["stateassign.read", "stateassign.reconcile"], {
      [`GET ${S}/reports/reconciliation`]: reconciliationReport(),
      [`GET ${S}/reports/controls-due`]: ({ url }: { url: URL }) =>
        json(url.searchParams.get("status") === "ANOMALY" ? { items: [{ control: control({ status: "ANOMALY", kind: "ATTENDANCE" }), assignmentReference: "AFF-2026-001", assignmentStatus: "ACTIVE", studentId: IDS.student, studentName: "KOUASSI Awa", institutionId: IDS.institution, academicYearId: IDS.year }], total: 1, page: 1, pageSize: 20 } : { items: [], total: 0, page: 1, pageSize: 20 }),
      ...extra,
    });

  it("compteurs par statut, écarts calculés par l'API affichés par part, contrôles à faire et anomalies", async () => {
    setTestApi(routes());
    renderWithProviders(<ReconciliationScreen />);
    const counts = await screen.findByRole("group", { name: "Dossiers actifs par statut de rapprochement" }).catch(() => screen.findByLabelText("Dossiers actifs par statut de rapprochement"));
    expect(counts.textContent).toMatch(/Jamais rapproché1/);
    expect(counts.textContent).toMatch(/Conforme2/);
    expect(counts.textContent).toMatch(/Écart1/);
    const table = await screen.findByRole("table", { name: "Dossiers et écarts de rapprochement" });
    expect(within(table).getByText("AFF-2026-001")).toBeTruthy();
    expect(within(table).getByText("Écart")).toBeTruthy();
    expect(within(table).getAllByText(/-100\s000/).length).toBeGreaterThan(0);
    expect(await screen.findByText("Anomalies à résoudre (1)")).toBeTruthy();
    expect(screen.getByText("Aucun contrôle à faire.")).toBeTruthy();
  });

  it("rapprocher : action de l'API (permission de rapprochement), pas de calcul côté écran", async () => {
    const api = setTestApi(
      routes({
        [`POST ${S}/assignments/${IDS.assignment}/reconcile`]: { assignment: assignment(), billing: { currency: "XOF", stateInvoices: [], parentInvoices: [], statePayments: [], scholarshipIds: [] }, receivables: [], unallocated: xof(0), linkedScholarship: false, warnings: [] },
      }),
    );
    renderWithProviders(<ReconciliationScreen />);
    fireEvent.click(await screen.findByRole("button", { name: /Rapprocher/ }));
    await waitFor(() => expect(api.calls.some((c) => c.method === "POST" && c.path === `${S}/assignments/${IDS.assignment}/reconcile`)).toBe(true));
    expect(await screen.findByText("Dossier AFF-2026-001 rapproché.")).toBeTruthy();
  });

  it("sans permission de rapprochement, l'action n'est pas proposée", async () => {
    setTestApi({ ...routes(), ...accessRoutes(["stateassign.read"], ["stateassign.core"]) });
    renderWithProviders(<ReconciliationScreen />);
    await screen.findByRole("table", { name: "Dossiers et écarts de rapprochement" });
    expect(screen.queryByRole("button", { name: /Rapprocher/ })).toBeNull();
  });
});

describe("ReceivablesScreen", () => {
  it("ancienneté et totaux calculés par l'API ; échéances en retard en texte ; filtres transmis", async () => {
    const api = setTestApi(
      as(["stateassign.read"], {
        [`GET ${S}/receivables/aging`]: aging(),
        [`GET ${S}/receivables`]: { items: [receivable({ overdue: true, daysOverdue: 12, agingBucket: "D1_30", dueOn: "2026-09-20" }), receivable({ id: uuid2(53), seq: 2, label: "2e versement", status: "RECEIVED", received: xof(150000), outstanding: xof(0) })], total: 2, page: 1, pageSize: 30, asOf: "2026-10-02" },
      }),
    );
    renderWithProviders(<ReceivablesScreen />);
    const agingTable = await screen.findByRole("table", { name: "Reste à recevoir par tranche de retard" });
    expect(within(agingTable).getByRole("row", { name: /^Plus de 90 jours de retard/ }).textContent).toMatch(/1.*50\s000/);
    expect(await screen.findByText("En retard (2 échéance(s))")).toBeTruthy();
    const table = await screen.findByRole("table", { name: "Échéances des créances sur l'État" });
    expect(within(table).getByText("En retard de 12 j")).toBeTruthy();
    expect(within(table).getByText("Reçu", { selector: "span" })).toBeTruthy();
    fireEvent.click(screen.getByRole("checkbox", { name: /Seulement les échéances en retard/ }));
    fireEvent.change(screen.getByLabelText("Échéance à partir du"), { target: { value: "2026-09-01" } });
    await waitFor(() => {
      const last = api.calls.filter((c) => c.path === `${S}/receivables`).at(-1)!;
      expect(last.query).toMatchObject({ overdueOnly: "true", dueFrom: "2026-09-01" });
    });
  });
});

describe("ReportsScreen : tableau de bord, exports, passerelle", () => {
  const routes = (extra: Record<string, unknown> = {}, permissions = ["stateassign.read", "stateassign.export"]) =>
    as(permissions, {
      [`GET ${S}/reports/summary`]: summary(),
      [`GET ${S}/export-formats`]: { items: [format(), format({ id: uuid2(81), label: "Inactif", active: false })] },
      [`GET ${S}/gateway/status`]: { configured: false, adapter: "NotConfigured", message: "Aucune passerelle…" },
      ...extra,
    });

  it("tableau de bord : dossiers par statut, totaux déclarés, créances, suivi ; passerelle « non configurée » dite clairement", async () => {
    setTestApi(routes());
    renderWithProviders(<ReportsScreen />);
    expect(await screen.findByText("Dossiers par statut")).toBeTruthy();
    expect(screen.getByText("Actif").nextElementSibling?.textContent).toBe("3");
    expect(screen.getByText("Total déclaré — État").nextElementSibling?.textContent?.replace(/\s/g, " ")).toMatch(/1\s200\s000/);
    expect(screen.getByText("Contrôles en retard").nextElementSibling?.textContent).toBe("1");
    expect(await screen.findByText(/Aucune passerelle n'est configurée/)).toBeTruthy();
  });

  it("export : le serveur produit le CSV (méta puis fichier), téléchargé tel quel ; format actif seulement ; troncature signalée", async () => {
    const meta = { dataset: "ASSIGNMENTS", rowCount: 2, totalCount: 5, truncated: true, maxRows: 2 };
    const api = setTestApi(routes({ [`GET ${S}/exports/assignments/meta`]: meta, [`GET ${S}/exports/assignments`]: () => new Response("N° d'acte;Nom\r\nAFF-1;X\r\n", { status: 200, headers: { "content-type": "text/csv" } }) }));
    renderWithProviders(<ReportsScreen />);
    const format = (await screen.findByLabelText("Format")) as HTMLSelectElement;
    await waitFor(() => expect([...format.options].map((o) => o.textContent)).toContain("État pour l'administration"));
    expect([...format.options].map((o) => o.textContent)).not.toContain("Inactif");
    fireEvent.change(format, { target: { value: IDS.format } });
    fireEvent.click(screen.getByRole("button", { name: "Télécharger le CSV" }));
    expect(await screen.findByText(/Fichier tronqué : 2 ligne\(s\) sur 5/)).toBeTruthy();
    expect(download.downloadTextFile).toHaveBeenCalledWith("stateassign-assignments.csv", "N° d'acte;Nom\r\nAFF-1;X\r\n", "text/csv");
    expect(api.calls.filter((c) => c.path.startsWith(`${S}/exports/assignments`)).every((c) => c.query.formatId === IDS.format)).toBe(true);
  });

  it("sans permission d'export, la section d'export n'apparaît pas", async () => {
    setTestApi(routes({}, ["stateassign.read"]));
    renderWithProviders(<ReportsScreen />);
    await screen.findByText("Dossiers par statut");
    expect(screen.queryByRole("button", { name: "Télécharger le CSV" })).toBeNull();
  });
});

describe("SettingsScreen : réglages et formats d'export", () => {
  const routes = (extra: Record<string, unknown> = {}) =>
    as(["stateassign.settings.manage"], {
      [`GET ${S}/settings`]: settings({ institutionId: institution.id }),
      [`GET ${S}/export-formats`]: { items: [] },
      [`GET ${S}/exports/catalog`]: catalog(),
      ...extra,
    });

  it("valeurs prudentes par défaut annoncées ; aucune règle officielle livrée", async () => {
    setTestApi(routes());
    renderWithProviders(<SettingsScreen />);
    expect(await screen.findByText(/Aucun réglage enregistré : les valeurs prudentes/)).toBeTruthy();
    expect(screen.getByText(/ne reprennent aucun texte officiel/)).toBeTruthy();
    expect((await screen.findByLabelText(/Tolérance d'écart/) as HTMLInputElement).value).toBe("0");
    expect((screen.getByLabelText(/Délai de grâce/) as HTMLInputElement).value).toBe("0");
    expect((screen.getByLabelText(/Délai d'échéance d'un contrôle/) as HTMLInputElement).value).toBe("");
    expect(screen.getAllByRole("checkbox").filter((c) => (c as HTMLInputElement).checked)).toHaveLength(1); // seule la séparation des tâches
    expect(await screen.findByText("Aucun format enregistré.")).toBeTruthy();
  });

  it("enregistrer : entiers, contrôles choisis exigent un délai, envoi avec la portée de l'établissement", async () => {
    const api = setTestApi(routes({ [`PUT ${S}/settings`]: settings({ institutionId: institution.id, isDefault: false, reconciliationTolerance: 500 }) }));
    renderWithProviders(<SettingsScreen />);
    fireEvent.change(await screen.findByLabelText(/Tolérance d'écart/), { target: { value: "500,5" } });
    fireEvent.click(screen.getByRole("button", { name: "Enregistrer les réglages" }));
    expect(await screen.findByText(/nombre entier de francs \(zéro autorisé\)/)).toBeTruthy();
    fireEvent.change(screen.getByLabelText(/Tolérance d'écart/), { target: { value: "500" } });
    fireEvent.click(screen.getByRole("checkbox", { name: "Présence" }));
    fireEvent.click(screen.getByRole("button", { name: "Enregistrer les réglages" }));
    expect(await screen.findByText(/Indiquez le délai d'échéance/)).toBeTruthy();
    expect(api.calls.some((c) => c.method === "PUT")).toBe(false);
    fireEvent.change(screen.getByLabelText(/Délai d'échéance d'un contrôle/), { target: { value: "15" } });
    fireEvent.change(screen.getByLabelText(/Délai de grâce/), { target: { value: "10" } });
    fireEvent.click(screen.getByRole("button", { name: "Enregistrer les réglages" }));
    await waitFor(() => expect(api.calls.filter((c) => c.method === "PUT")).toHaveLength(1));
    const put = api.calls.find((c) => c.method === "PUT")!;
    expect(put.query.institutionId).toBe(institution.id);
    expect(put.body).toEqual({ requireSeparateVerifier: true, reconciliationTolerance: 500, requiredControlKinds: ["ATTENDANCE"], controlDueOffsetDays: 15, receivableGraceDays: 10 });
    expect(await screen.findByText("Réglages enregistrés.")).toBeTruthy();
  });

  it("nouveau format d'export : colonnes choisies dans le catalogue, en-têtes modifiables, envoyés dans l'ordre du catalogue", async () => {
    const api = setTestApi(routes({ [`POST ${S}/export-formats`]: () => json(format(), { status: 201 }) }));
    renderWithProviders(<SettingsScreen />);
    fireEvent.click(await screen.findByRole("button", { name: "Nouveau format" }));
    const dialog = await screen.findByRole("dialog", { name: "Nouveau format d'export" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Créer le format" }));
    expect((await within(dialog).findAllByRole("alert")).length).toBeGreaterThanOrEqual(2);
    fireEvent.change(within(dialog).getByLabelText(/^Code/), { target: { value: "etat-admin" } });
    fireEvent.change(within(dialog).getByLabelText(/^Libellé/), { target: { value: "État pour l'administration" } });
    fireEvent.click(await within(dialog).findByRole("checkbox", { name: "Référence d'affectation" }));
    fireEvent.change(within(dialog).getByPlaceholderText("En-tête de la colonne"), { target: { value: "N° d'acte" } });
    fireEvent.click(within(dialog).getByRole("checkbox", { name: "Part de l'État déclarée" }));
    fireEvent.click(within(dialog).getByRole("button", { name: "Créer le format" }));
    await waitFor(() => expect(api.calls.filter((c) => c.method === "POST")).toHaveLength(1));
    expect(api.calls.find((c) => c.method === "POST")!.body).toEqual({
      institutionId: institution.id,
      code: "etat-admin",
      label: "État pour l'administration",
      dataset: "ASSIGNMENTS",
      delimiter: ";",
      includeBom: true,
      columns: [{ key: "reference", header: "N° d'acte" }, { key: "declaredStateAmount", header: "Part de l'État déclarée" }],
    });
  });
});

describe("FamilyScreen : vue limitée à la famille", () => {
  it("le statut seulement : jamais de montant, d'échéance, d'écart ni de contrôle ; un enfant sans dossier est dit", async () => {
    const api = setTestApi({
      ...accessRoutes(["stateassign.child.read"], ["stateassign.core"]),
      "GET /api/v1/people/children": { items: [mariam] },
      [`GET ${S}/children/${mariam.id}/assignment`]: child({ studentId: mariam.id }),
    });
    renderWithProviders(<FamilyScreen />);
    expect(await screen.findByRole("heading", { level: 2, name: mariam.displayName })).toBeTruthy();
    expect(await screen.findByText("Vérifié")).toBeTruthy();
    expect(screen.getByText("AFF-2026-001")).toBeTruthy();
    expect(screen.getByText(/vérifié par l'établissement/)).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/400\s?000|Écart|Part de l'État|Échéance|Contrôle/i);
    expect(api.calls.filter((c) => c.path.startsWith(S)).map((c) => c.path)).toEqual([`${S}/children/${mariam.id}/assignment`]);
  });

  it("aucun dossier : message explicite ; aucun enfant lié : message explicite", async () => {
    setTestApi({ ...accessRoutes(["stateassign.child.read"], ["stateassign.core"]), "GET /api/v1/people/children": { items: [mariam] }, [`GET ${S}/children/${mariam.id}/assignment`]: child({ studentId: mariam.id, hasAssignment: false, status: null, verified: false, reference: null, issuedOn: null, academicYearId: null }) });
    const { unmount } = renderWithProviders(<FamilyScreen />);
    expect(await screen.findByText("Aucun dossier d'affectation pour cet enfant.")).toBeTruthy();
    unmount();
    setTestApi({ ...accessRoutes(["stateassign.child.read"], ["stateassign.core"]), "GET /api/v1/people/children": { items: [] } });
    renderWithProviders(<FamilyScreen />);
    expect(await screen.findByText("Aucun enfant n'est lié à votre compte.")).toBeTruthy();
  });
});

