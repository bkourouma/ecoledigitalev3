// @vitest-environment jsdom
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { accessRoutes, setTestApi } from "@/platform/test/api-mock";
import { json, renderWithProviders } from "@/platform/test/render";
import { classroom, period, uuid as academicUuid, year } from "../../_test/fixtures";
import { absenceRow, conflictDto, IDS, justificationDto, leaveDto, sessionDto, STUDENTS, summaryDto } from "../_test/fixtures";
import { AbsencesScreen } from "./AbsencesScreen";
import { AlertsScreen } from "./AlertsScreen";
import { ComplianceScreen } from "./ComplianceScreen";
import { ConflictsScreen } from "./ConflictsScreen";
import { DashboardScreen } from "./DashboardScreen";
import { JustificationsScreen } from "./JustificationsScreen";
import { PortalScreen } from "./PortalScreen";
import { SessionsScreen } from "./SessionsScreen";
import { StaffAttendanceScreen } from "./StaffAttendanceScreen";

vi.mock("@/platform/api/default-client", async () => (await import("@/platform/test/api-mock")).defaultClientModule);
vi.mock("next/link", () => ({ default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a> }));

const A = "/api/v1/attendance";
const baseAcademic = {
  "GET /api/v1/academic/years": { items: [year({ id: academicUuid(100), label: "2026-2027", isCurrent: true })] },
  [`GET /api/v1/academic/years/${academicUuid(100)}/periods`]: { items: [period({ id: academicUuid(200), label: "Semestre 1" })] },
  "GET /api/v1/academic/classrooms": { items: [classroom()], total: 1, page: 1, pageSize: 200 },
};
const reasons = { items: [{ id: academicUuid(1), code: "ILLNESS", label: "Maladie", requiresAttachment: false, sortOrder: 1, active: true }] };

afterEach(() => vi.restoreAllMocks());

async function pickClassroom() {
  await waitFor(() => expect((screen.getByLabelText("Année scolaire") as HTMLSelectElement).value).toBe(academicUuid(100)));
  fireEvent.focus(await screen.findByRole("combobox", { name: /^Classe/ }));
  fireEvent.click(await screen.findByRole("option", { name: /Licence 1 A/ }));
}

describe("DashboardScreen : récapitulatif de classe et surcharge tracée", () => {
  const rows = [summaryDto(STUDENTS[0]!.id, { periodId: academicUuid(200) }), summaryDto(STUDENTS[1]!.id, { periodId: academicUuid(200), overridden: true, override: { absentMinutes: 600, excusedMinutes: 60, reason: "Régularisation", setBy: academicUuid(9), setAt: "2026-10-01T09:00:00.000Z" } })];

  it("affiche les comptages effectifs renvoyés par l'API, sans calcul local", async () => {
    setTestApi({
      ...accessRoutes(["attendance.read"]),
      ...baseAcademic,
      [`GET ${A}/classrooms/${academicUuid(500)}/summary`]: { classroomId: academicUuid(500), periodId: academicUuid(200), rows },
    });
    renderWithProviders(<DashboardScreen />);
    await pickClassroom();
    const table = await screen.findByRole("table", { name: "Récapitulatif d'assiduité de la classe" });
    const body = within(table);
    expect((await body.findAllByText("3 dont 1 justifiée(s)")).length).toBe(2);
    expect(body.getByText("Surchargé")).toBeTruthy();
    expect(body.getByText("Calculé")).toBeTruthy();
    // Sans droit de surcharge : aucune action.
    expect(screen.queryByRole("button", { name: "Surcharger" })).toBeNull();
  });

  it("surcharge : règle de forme du contrat (justifié ≤ total, motif ≥ 5), corps exact, puis retrait", async () => {
    const api = setTestApi({
      ...accessRoutes(["attendance.read", "attendance.summary.override"]),
      ...baseAcademic,
      [`GET ${A}/classrooms/${academicUuid(500)}/summary`]: { classroomId: academicUuid(500), periodId: academicUuid(200), rows },
      [`PUT ${A}/summary-overrides`]: ({ body }: { body: unknown }) => json({ ...rows[0], overridden: true, effective: { ...rows[0]!.effective, absentMinutes: (body as { absentMinutes: number }).absentMinutes } }),
      [`DELETE ${A}/summary-overrides`]: () => json(rows[1]),
    });
    renderWithProviders(<DashboardScreen />);
    await pickClassroom();
    await screen.findByRole("table", { name: "Récapitulatif d'assiduité de la classe" });
    fireEvent.click((await screen.findAllByRole("button", { name: "Surcharger" }))[0]!);
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText(/Minutes d'absence \(total\)/), { target: { value: "100" } });
    fireEvent.change(within(dialog).getByLabelText(/dont minutes justifiées/), { target: { value: "200" } });
    fireEvent.change(within(dialog).getByLabelText(/Motif de la surcharge/), { target: { value: "abc" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Enregistrer la surcharge" }));
    expect(await within(dialog).findByText("Les minutes justifiées ne peuvent pas dépasser les minutes d'absence.")).toBeTruthy();
    expect(within(dialog).getAllByRole("alert").some((a) => /5 caractères/.test(a.textContent ?? ""))).toBe(true);
    expect(api.calls.filter((c) => c.method === "PUT")).toHaveLength(0);

    fireEvent.change(within(dialog).getByLabelText(/dont minutes justifiées/), { target: { value: "60" } });
    fireEvent.change(within(dialog).getByLabelText(/Motif de la surcharge/), { target: { value: "Saisie manuelle de la scolarité" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Enregistrer la surcharge" }));
    expect(await screen.findByText(/Surcharge enregistrée/)).toBeTruthy();
    expect(api.calls.find((c) => c.method === "PUT")!.body).toEqual({ enrollmentId: rows[0]!.enrollmentId, periodId: academicUuid(200), absentMinutes: 100, excusedMinutes: 60, reason: "Saisie manuelle de la scolarité" });

    fireEvent.click(await screen.findByRole("button", { name: "Retirer la surcharge" }));
    const removeDialog = await screen.findByRole("dialog");
    fireEvent.click(within(removeDialog).getByRole("button", { name: "Retirer la surcharge" }));
    await screen.findByText(/Surcharge retirée/);
    expect(api.calls.find((c) => c.method === "DELETE")!.query).toMatchObject({ enrollmentId: rows[1]!.enrollmentId, periodId: academicUuid(200) });
  });
});

describe("JustificationsScreen : workflow de décision", () => {
  const pending = justificationDto();
  const routes = (extra: Record<string, unknown> = {}, perms = ["attendance.justification.read", "attendance.justification.decide"]) => ({
    ...accessRoutes(perms),
    [`GET ${A}/justifications`]: ({ url }: { url: URL }) => json({ items: url.searchParams.get("status") === "PENDING" ? [pending] : [], nextCursor: null }),
    [`GET ${A}/justifications/${pending.id}`]: pending,
    [`GET ${A}/reference/justification-reasons`]: reasons,
    ...extra,
  });

  it("file « en attente » par défaut, détail avec pièce (lien signé court) et acceptation", async () => {
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    const api = setTestApi(
      routes({
        [`GET ${A}/justifications/${pending.id}/attachments/${pending.attachments[0]!.id}`]: { url: "https://files.example/signed?x=1", expiresAt: "2026-10-01T10:05:00.000Z", fileName: "certificat.pdf", detectedMime: "application/pdf" },
        [`POST ${A}/justifications/${pending.id}/accept`]: () => json({ ...pending, status: "ACCEPTED", coveredRecordCount: 2 }),
      }),
    );
    renderWithProviders(<JustificationsScreen />);
    const table = await screen.findByRole("table", { name: "Liste des justificatifs" });
    expect(api.calls.find((c) => c.path === `${A}/justifications`)!.query.status).toBe("PENDING");
    fireEvent.click(await within(table).findByRole("button", { name: /…0011/ }));
    const dialog = await screen.findByRole("dialog", { name: "Justificatif d'absence" });
    expect(await within(dialog).findByText("Maladie")).toBeTruthy();
    expect(within(dialog).getByText("Fièvre, certificat joint.")).toBeTruthy();
    fireEvent.click(within(dialog).getByRole("button", { name: "Ouvrir" }));
    await waitFor(() => expect(open).toHaveBeenCalledWith("https://files.example/signed?x=1", "_blank", "noopener,noreferrer"));

    fireEvent.click(within(dialog).getByRole("button", { name: "Accepter" }));
    const confirm = await screen.findByRole("dialog", { name: "Accepter le justificatif" });
    fireEvent.click(within(confirm).getByRole("button", { name: "Accepter" }));
    expect(await screen.findByText("Justificatif accepté.")).toBeTruthy();
    expect(api.calls.find((c) => c.path.endsWith("/accept"))!.body).toEqual({});
  });

  it("rejet : motif obligatoire (3 caractères), transmis tel quel ; révocation : motif de 5 caractères", async () => {
    const api = setTestApi(
      routes({
        [`POST ${A}/justifications/${pending.id}/reject`]: () => json({ ...pending, status: "REJECTED" }),
      }),
    );
    renderWithProviders(<JustificationsScreen />);
    fireEvent.click(await screen.findByRole("button", { name: /…0011/ }));
    const dialog = await screen.findByRole("dialog", { name: "Justificatif d'absence" });
    fireEvent.click(await within(dialog).findByRole("button", { name: "Rejeter" }));
    const reject = await screen.findByRole("dialog", { name: "Rejeter le justificatif" });
    fireEvent.change(within(reject).getByLabelText(/Motif du rejet/), { target: { value: "ab" } });
    fireEvent.click(within(reject).getByRole("button", { name: "Rejeter" }));
    expect(api.calls.filter((c) => c.path.endsWith("/reject"))).toHaveLength(0);
    fireEvent.change(within(reject).getByLabelText(/Motif du rejet/), { target: { value: "Pièce illisible" } });
    fireEvent.click(within(reject).getByRole("button", { name: "Rejeter" }));
    expect(await screen.findByText("Justificatif rejeté.")).toBeTruthy();
    expect(api.calls.find((c) => c.path.endsWith("/reject"))!.body).toEqual({ note: "Pièce illisible" });
  });

  it("justificatif accepté : révocation motivée proposée ; sans droit de décision : aucune action", async () => {
    const accepted = { ...pending, status: "ACCEPTED", decidedAt: "2026-09-30T08:00:00.000Z", decisionNote: "RAS", coveredRecordCount: 2 };
    const api = setTestApi(
      routes(
        {
          [`GET ${A}/justifications`]: { items: [accepted], nextCursor: null },
          [`GET ${A}/justifications/${pending.id}`]: accepted,
          [`POST ${A}/justifications/${pending.id}/revoke`]: () => json({ ...accepted, status: "REVOKED" }),
        },
        ["attendance.justification.read", "attendance.justification.decide"],
      ),
    );
    // Le statut par défaut est « En attente » : on bascule sur « Accepté ».
    renderWithProviders(<JustificationsScreen />);
    fireEvent.change(await screen.findByLabelText("État"), { target: { value: "ACCEPTED" } });
    fireEvent.click(await screen.findByRole("button", { name: /…0011/ }));
    const dialog = await screen.findByRole("dialog", { name: "Justificatif d'absence" });
    expect(await within(dialog).findByText("2 pointages couverts")).toBeTruthy();
    fireEvent.click(within(dialog).getByRole("button", { name: "Révoquer" }));
    const revoke = await screen.findByRole("dialog", { name: "Révoquer le justificatif" });
    fireEvent.change(within(revoke).getByLabelText(/Motif de la révocation/), { target: { value: "Faux certificat" } });
    fireEvent.click(within(revoke).getByRole("button", { name: "Révoquer" }));
    expect(await screen.findByText("Justificatif révoqué.")).toBeTruthy();
    expect(api.calls.find((c) => c.path.endsWith("/revoke"))!.body).toEqual({ reason: "Faux certificat" });
  });

  it("lecture seule : pas de boutons de décision", async () => {
    setTestApi(routes({}, ["attendance.justification.read"]));
    renderWithProviders(<JustificationsScreen />);
    fireEvent.click(await screen.findByRole("button", { name: /…0011/ }));
    const dialog = await screen.findByRole("dialog", { name: "Justificatif d'absence" });
    await within(dialog).findByText("Maladie");
    expect(within(dialog).queryByRole("button", { name: "Accepter" })).toBeNull();
    expect(within(dialog).queryByRole("button", { name: "Rejeter" })).toBeNull();
  });
});

describe("AbsencesScreen : absences à justifier, dépôt, export", () => {
  it("filtre « à justifier » par défaut ; dépôt d'un justificatif prérempli ; export CSV via l'API", async () => {
    const created = justificationDto({ id: academicUuid(7777), status: "PENDING" });
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);
    // jsdom n'implémente pas les URL d'objets.
    (URL as unknown as { createObjectURL: () => string }).createObjectURL = () => "blob:test";
    (URL as unknown as { revokeObjectURL: () => void }).revokeObjectURL = () => undefined;
    const api = setTestApi({
      ...accessRoutes(["attendance.report.read", "attendance.justification.submit"]),
      ...baseAcademic,
      [`GET ${A}/reports/absences`]: ({ url }: { url: URL }) =>
        url.searchParams.get("format") === "csv" ? new Response("date;eleve\r\n2026-09-28;X\r\n", { status: 200, headers: { "content-type": "text/csv" } }) : json({ items: [absenceRow(STUDENTS[0]!.id), absenceRow(STUDENTS[1]!.id, { excused: true })], nextCursor: null }),
      [`GET ${A}/reference/justification-reasons`]: reasons,
      [`GET ${A}/reference/settings`]: { attachmentMaxBytes: null, allowedAttachmentTypes: null, allowFutureJustifications: false, alertRules: [] },
      [`POST ${A}/justifications`]: () => json(created, { status: 201 }),
    });
    renderWithProviders(<AbsencesScreen />);
    const table = await screen.findByRole("table", { name: "Liste des absences et retards" });
    expect(api.calls.find((c) => c.path === `${A}/reports/absences`)!.query).toMatchObject({ excused: "false" });
    expect(await within(table).findAllByText("Absent")).toHaveLength(2);
    expect(within(table).getByText("À justifier")).toBeTruthy();
    expect(within(table).getAllByText("Justifiée")).toHaveLength(1);

    fireEvent.click(within(table).getByRole("button", { name: "Justifier" }));
    const dialog = await screen.findByRole("dialog", { name: "Déposer un justificatif" });
    expect((within(dialog).getByLabelText(/Premier jour d'absence/) as HTMLInputElement).value).toBe("2026-09-28");
    fireEvent.change(await within(dialog).findByLabelText(/^Motif/), { target: { value: "ILLNESS" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Déposer" }));
    expect(await screen.findByText("Justificatif déposé.")).toBeTruthy();
    expect(api.calls.find((c) => c.method === "POST" && c.path === `${A}/justifications`)!.body).toEqual({ studentId: STUDENTS[0]!.id, fromDate: "2026-09-28", toDate: "2026-09-28", reasonCode: "ILLNESS" });

    fireEvent.click(screen.getByRole("button", { name: "Exporter en CSV" }));
    expect(await screen.findByText("Export téléchargé.")).toBeTruthy();
    const csvCall = api.calls.filter((c) => c.path === `${A}/reports/absences`).at(-1)!;
    expect(csvCall.query).toMatchObject({ format: "csv", excused: "false" });
    expect(click).toHaveBeenCalled();
  });

  it("dépôt avec pièce : le justificatif est créé puis la pièce envoyée en base64 ; refus de l'API affiché", async () => {
    const created = justificationDto({ id: academicUuid(7777) });
    const api = setTestApi({
      ...accessRoutes(["attendance.report.read", "attendance.justification.submit"]),
      ...baseAcademic,
      [`GET ${A}/reports/absences`]: { items: [absenceRow(STUDENTS[0]!.id)], nextCursor: null },
      // Le référentiel n'est pas lisible : repli sur les motifs du modèle d'établissement.
      [`GET ${A}/reference/justification-reasons`]: () => json({ code: "FORBIDDEN", message: "Interdit" }, { status: 403 }),
      [`GET ${A}/reference/settings`]: () => json({ code: "FORBIDDEN", message: "Interdit" }, { status: 403 }),
      [`POST ${A}/justifications`]: () => json(created, { status: 201 }),
      [`POST ${A}/justifications/${created.id}/attachments`]: () => json({ code: "attendance.attachment_type_refused", message: "Type de fichier non accepté." }, { status: 422 }),
    });
    renderWithProviders(<AbsencesScreen />);
    fireEvent.click(await screen.findByRole("button", { name: "Justifier" }));
    const dialog = await screen.findByRole("dialog", { name: "Déposer un justificatif" });
    fireEvent.change(within(dialog).getByLabelText(/^Motif/), { target: { value: "TRANSPORT" } });
    const file = new File([new Uint8Array([1, 2, 3, 4])], "scan.pdf", { type: "application/pdf" });
    fireEvent.change(within(dialog).getByLabelText(/Pièce jointe/), { target: { files: [file] } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Déposer" }));
    expect(await within(dialog).findByText(/la pièce n'a pas pu être jointe : Type de fichier non accepté\./)).toBeTruthy();
    const attach = api.calls.find((c) => c.path.endsWith("/attachments"))!;
    expect(attach.body).toEqual({ fileName: "scan.pdf", contentBase64: "AQIDBA==" });
  });
});

describe("SessionsScreen : suivi, validation, réouverture", () => {
  const submitted = sessionDto({ status: "SUBMITTED" });
  const validated = sessionDto({ id: academicUuid(5001), status: "VALIDATED", occurrenceId: null, scope: "DAILY" });

  it("valide un appel soumis ; la réouverture d'un appel validé exige un motif de 5 caractères", async () => {
    const api = setTestApi({
      ...accessRoutes(["attendance.read", "attendance.validate", "attendance.session.reopen"]),
      [`GET ${A}/sessions`]: { items: [submitted, validated], nextCursor: null },
      [`POST ${A}/sessions/${submitted.id}/validate`]: () => json({ ...submitted, status: "VALIDATED" }),
      [`POST ${A}/sessions/${validated.id}/reopen`]: () => json({ ...validated, status: "SUBMITTED" }),
    });
    renderWithProviders(<SessionsScreen />);
    const table = await screen.findByRole("table", { name: "Liste des appels" });
    expect(await within(table).findByText("Soumis")).toBeTruthy();
    expect(within(table).getAllByRole("link", { name: "Ouvrir" }).map((a) => a.getAttribute("href"))).toEqual([
      `/v2/attendance/call/occurrence/${IDS.occurrence}`,
      `/v2/attendance/call/daily/${IDS.classroom}?date=2026-10-01`,
    ]);
    fireEvent.click(within(table).getByRole("button", { name: "Valider" }));
    expect(await screen.findByText("Appel validé.")).toBeTruthy();

    fireEvent.click(within(table).getByRole("button", { name: "Rouvrir" }));
    const dialog = await screen.findByRole("dialog", { name: "Rouvrir l'appel" });
    fireEvent.change(within(dialog).getByLabelText(/Motif/), { target: { value: "oups" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Rouvrir" }));
    expect(api.calls.filter((c) => c.path.endsWith("/reopen"))).toHaveLength(0);
    fireEvent.change(within(dialog).getByLabelText(/Motif/), { target: { value: "Erreur de pointage constatée" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Rouvrir" }));
    expect(await screen.findByText("Appel rouvert.")).toBeTruthy();
    expect(api.calls.find((c) => c.path.endsWith("/reopen"))!.body).toEqual({ reason: "Erreur de pointage constatée" });
  });

  it("validation en lot : une requête par appel, les échecs sont listés sans bloquer les autres", async () => {
    const second = sessionDto({ id: academicUuid(5002), occurrenceId: academicUuid(5102), status: "SUBMITTED" });
    const api = setTestApi({
      ...accessRoutes(["attendance.read", "attendance.validate"]),
      [`GET ${A}/sessions`]: { items: [submitted, second], nextCursor: null },
      [`POST ${A}/sessions/${submitted.id}/validate`]: () => json({ ...submitted, status: "VALIDATED" }),
      [`POST ${A}/sessions/${second.id}/validate`]: () => json({ code: "attendance.unmarked_students", message: "Des élèves ne sont pas pointés." }, { status: 422 }),
    });
    renderWithProviders(<SessionsScreen />);
    const table = await screen.findByRole("table", { name: "Liste des appels" });
    for (const box of await within(table).findAllByRole("checkbox")) fireEvent.click(box);
    fireEvent.click(screen.getByRole("button", { name: "Valider les 2 séances sélectionnées" }));
    expect(await screen.findByText("1 appel validé.")).toBeTruthy();
    expect(await screen.findByText("1 appel n'a pas pu être validé")).toBeTruthy();
    expect(screen.getByText("Des élèves ne sont pas pointés.")).toBeTruthy();
    expect(api.calls.filter((c) => c.path.endsWith("/validate"))).toHaveLength(2);
  });
});

describe("ComplianceScreen : appels non faits", () => {
  it("taux en pourcentage (affichage), détail par classe et liste des séances sans appel", async () => {
    setTestApi({
      ...accessRoutes([]),
      [`GET ${A}/reports/call-compliance`]: {
        from: "2026-09-25",
        to: "2026-10-01",
        expected: 20,
        taken: 17,
        missing: 3,
        rateBps: 8500,
        byStaff: [{ staffId: academicUuid(4000), expected: 10, taken: 7, missing: 3, rateBps: 7000 }],
        byClassroom: [{ classroomId: IDS.classroom, expected: 20, taken: 17, missing: 3, rateBps: 8500 }],
        missingOccurrences: [{ occurrenceId: IDS.occurrence, classroomId: IDS.classroom, date: "2026-09-30", staffIds: [academicUuid(4000)] }],
      },
    });
    renderWithProviders(<ComplianceScreen />);
    const rate = await screen.findAllByText("85 %");
    expect(rate.length).toBeGreaterThan(1);
    expect(screen.getByText("70 %")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Faire l'appel" }).getAttribute("href")).toBe(`/v2/attendance/call/occurrence/${IDS.occurrence}`);
  });
});

describe("ConflictsScreen : arbitrage", () => {
  it("compare saisie de l'appareil et pointage actuel, puis applique avec note", async () => {
    const api = setTestApi({
      ...accessRoutes(["attendance.manage"], ["attendance.offline"]),
      [`GET ${A}/sync/conflicts`]: ({ url }: { url: URL }) => json({ items: url.searchParams.get("status") === "OPEN" ? [conflictDto()] : [], nextCursor: null }),
      [`POST ${A}/sync/conflicts/${conflictDto().id}/resolve`]: () => json(conflictDto({ status: "RESOLVED", resolution: "ACCEPT_INCOMING" })),
    });
    renderWithProviders(<ConflictsScreen />);
    expect(await screen.findByText("Appel verrouillé")).toBeTruthy();
    expect(screen.getByText("L'appel était validé ou annulé quand la saisie est arrivée.")).toBeTruthy();
    expect(screen.getByText("Absent")).toBeTruthy();
    expect(screen.getByText("Présent")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Appliquer la saisie de l'appareil" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText(/Note/), { target: { value: "Vérifié avec l'enseignant" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Appliquer la saisie de l'appareil" }));
    expect(await screen.findByText("Conflit arbitré.")).toBeTruthy();
    expect(api.calls.find((c) => c.path.endsWith("/resolve"))!.body).toEqual({ resolution: "ACCEPT_INCOMING", note: "Vérifié avec l'enseignant" });
  });

  it("sans la fonction hors ligne dans l'offre : message explicite", async () => {
    setTestApi({ ...accessRoutes(["attendance.manage"], []) });
    renderWithProviders(<ConflictsScreen />);
    expect(await screen.findByText(/n'est pas incluse dans votre offre/)).toBeTruthy();
  });
});

describe("PortalScreen : parent", () => {
  it("absences de l'enfant, dépôt d'un justificatif, retrait d'un justificatif en attente", async () => {
    const pendingJ = justificationDto({ id: academicUuid(7010) });
    const api = setTestApi({
      ...accessRoutes(["attendance.child.read", "attendance.child.justify"]),
      [`GET ${A}/children/${STUDENTS[0]!.id}/attendance`]: { studentId: STUDENTS[0]!.id, records: [absenceRow(STUDENTS[0]!.id)], justifications: [pendingJ], summary: summaryDto(STUDENTS[0]!.id) },
      [`GET ${A}/reference/justification-reasons`]: () => json({ code: "FORBIDDEN", message: "Interdit" }, { status: 403 }),
      [`GET ${A}/reference/settings`]: () => json({ code: "FORBIDDEN", message: "Interdit" }, { status: 403 }),
      [`POST ${A}/justifications`]: () => json(justificationDto(), { status: 201 }),
      [`POST ${A}/justifications/${pendingJ.id}/withdraw`]: () => json({ ...pendingJ, status: "WITHDRAWN" }),
    });
    renderWithProviders(<PortalScreen via="child" studentId={STUDENTS[0]!.id} />);
    expect(await screen.findByText("Absences de l'enfant")).toBeTruthy();
    expect(screen.getByText("À justifier")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Retirer ce justificatif" }));
    expect(await screen.findByText("Justificatif retiré.")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Justifier" }));
    const dialog = await screen.findByRole("dialog", { name: "Déposer un justificatif" });
    expect(within(dialog).queryByRole("combobox", { name: /Élève/ })).toBeNull(); // l'enfant est imposé
    expect(within(dialog).getByText(/Élève/)).toBeTruthy();
    fireEvent.change(within(dialog).getByLabelText(/^Motif/), { target: { value: "ILLNESS" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Déposer" }));
    expect(await screen.findByText("Justificatif déposé.")).toBeTruthy();
    expect(api.calls.find((c) => c.method === "POST" && c.path === `${A}/justifications`)!.body).toEqual({ studentId: STUDENTS[0]!.id, fromDate: "2026-09-28", toDate: "2026-09-28", reasonCode: "ILLNESS" });
  });
});

describe("StaffAttendanceScreen", () => {
  const base = {
    [`GET ${A}/reports/staff-summary`]: { from: "2026-09-25", to: "2026-10-01", rows: [{ staffId: academicUuid(4000), days: 5, byStatus: { PRESENT: 4, LATE: 1 }, lateMinutes: 12, approvedLeaveDays: 0 }] },
    [`GET ${A}/staff/records`]: { items: [], nextCursor: null },
  };

  it("direction : congé demandé approuvé, refus motivé", async () => {
    const api = setTestApi({
      ...accessRoutes(["attendance.staff.read", "attendance.leave.decide"], ["attendance.staff"]),
      ...base,
      [`GET ${A}/staff/leaves`]: { items: [leaveDto(), leaveDto({ id: academicUuid(9301) })], nextCursor: null },
      [`POST ${A}/staff/leaves/${academicUuid(9300)}/approve`]: () => json(leaveDto({ status: "APPROVED" })),
      [`POST ${A}/staff/leaves/${academicUuid(9301)}/reject`]: () => json(leaveDto({ status: "REJECTED" })),
    });
    renderWithProviders(<StaffAttendanceScreen mode="manage" />);
    const leaves = await screen.findByRole("table", { name: "Congés du personnel" });
    expect(api.calls.find((c) => c.path === `${A}/staff/leaves`)!.query.status).toBe("REQUESTED");
    fireEvent.click((await within(leaves).findAllByRole("button", { name: "Approuver" }))[0]!);
    expect(await screen.findByText("Congé approuvé.")).toBeTruthy();
    fireEvent.click(within(leaves).getAllByRole("button", { name: "Refuser" })[1]!);
    const dialog = await screen.findByRole("dialog", { name: "Refuser le congé" });
    fireEvent.change(within(dialog).getByLabelText(/Motif du refus/), { target: { value: "Période d'examens" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Refuser" }));
    expect(await screen.findByText("Congé refusé.")).toBeTruthy();
    expect(api.calls.find((c) => c.path.endsWith("/reject"))!.body).toEqual({ note: "Période d'examens" });
  });

  it("personnel : pointe son arrivée ; fonction non incluse dans l'offre : message", async () => {
    const api = setTestApi({
      ...accessRoutes(["attendance.own.read", "attendance.own.record"], ["attendance.staff"]),
      [`GET ${A}/me/staff-attendance`]: { records: [], leaves: [], nextCursor: null },
      [`POST ${A}/staff/check-in`]: () => json({ record: { id: academicUuid(9400), staffId: academicUuid(4000), workDate: "2026-10-01", occurrenceId: null, statusCode: "PRESENT", checkInAt: "2026-10-01T07:30:00.000Z", checkOutAt: null, minutesLate: null, leaveId: null, note: null, source: "SELF", markedBy: academicUuid(9), markedAt: "2026-10-01T07:30:00.000Z" }, replayed: false }),
    });
    renderWithProviders(<StaffAttendanceScreen mode="own" />);
    fireEvent.click(await screen.findByRole("button", { name: "Arrivée" }));
    expect(await screen.findByText("Arrivée enregistrée.")).toBeTruthy();
    expect(api.calls.find((c) => c.path.endsWith("/check-in"))!.body).toEqual({});
  });

  it("fonction non incluse", async () => {
    setTestApi({ ...accessRoutes(["attendance.staff.read"], []) });
    renderWithProviders(<StaffAttendanceScreen mode="manage" />);
    expect(await screen.findByText(/n'est pas incluse dans votre offre/)).toBeTruthy();
  });
});

describe("AlertsScreen : règles fournies par l'établissement", () => {
  it("aucune règle par défaut ; ajout validé par le contrat puis envoyé en bloc ; seuil jamais codé", async () => {
    let stored: unknown[] = [];
    const settings = () => ({ attachmentMaxBytes: null, allowedAttachmentTypes: null, allowFutureJustifications: false, alertRules: stored });
    const api = setTestApi({
      ...accessRoutes(["attendance.read", "attendance.settings.manage"]),
      [`GET ${A}/reference/settings`]: () => json(settings()),
      [`PUT ${A}/reference/settings`]: ({ body }: { body: { alertRules: unknown[] } }) => {
        stored = body.alertRules;
        return json(settings());
      },
    });
    renderWithProviders(<AlertsScreen />);
    expect(await screen.findByText("Aucune règle d'alerte.")).toBeTruthy();
    fireEvent.change(await screen.findByLabelText(/Code de la règle/), { target: { value: "absences non justifiées" } });
    fireEvent.click(screen.getByRole("button", { name: "Ajouter la règle" }));
    expect((await screen.findAllByRole("alert")).length).toBeGreaterThan(0);
    expect(api.calls.filter((c) => c.method === "PUT")).toHaveLength(0);

    fireEvent.change(screen.getByLabelText(/Code de la règle/), { target: { value: "abs_nj" } });
    fireEvent.change(screen.getByLabelText(/Indicateur/), { target: { value: "UNEXCUSED_ABSENT_COUNT" } });
    fireEvent.change(screen.getByLabelText(/^Seuil/), { target: { value: "5" } });
    fireEvent.click(screen.getByRole("button", { name: "Ajouter la règle" }));
    expect(await screen.findByText("Règle ajoutée.")).toBeTruthy();
    expect(api.calls.find((c) => c.method === "PUT")!.body).toEqual({ alertRules: [{ code: "ABS_NJ", metric: "UNEXCUSED_ABSENT_COUNT", threshold: 5, active: true }] });
    expect(await screen.findByText("Nombre d'absences non justifiées — seuil : 5")).toBeTruthy();
  });
});
