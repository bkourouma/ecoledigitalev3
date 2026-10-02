// @vitest-environment jsdom
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { accessRoutes, setTestApi } from "@/platform/test/api-mock";
import { json, renderWithProviders } from "@/platform/test/render";
import { absenceRow, summaryDto } from "../../attendance/_test/fixtures";
import { card } from "../../reportcards/_test/fixtures";
import { page } from "../../schedule/_test/fixtures";
import { receipt } from "../../_test/fixtures-finance";
import { enrollment, studentDetail } from "../../_test/fixtures-people";
import { familyInstallment, familyLabels, familyResult, familyStatement, fid, gradesPage, MARIAM, NOT_FOUND, PERIOD_1, publishedGrade } from "../../_test/fixtures-family";
import { StudentAttendance, StudentDocuments, StudentFinance, StudentHome, StudentProfile, StudentReceipt, StudentReportCards, StudentResults, StudentSchedule, StudentUpcoming } from "./StudentScreens";

vi.mock("@/platform/api/default-client", async () => (await import("@/platform/test/api-mock")).defaultClientModule);
vi.mock("next/link", () => ({ default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a> }));
vi.mock("next/navigation", () => ({ usePathname: () => "/v2/student", useRouter: () => ({ push: vi.fn(), replace: vi.fn() }) }));

const STUDENT_PERMISSIONS = [
  "student.self.read",
  "student.self.update",
  "enrollment.self.read",
  "grade.self.read",
  "result.self.read",
  "reportcard.self.read",
  "attendance.self.read",
  "attendance.self.justify",
  "schedule.self.read",
  "higher.self.read",
  "finance.self.read",
  "finance.self.pay",
];

const me = studentDetail({
  id: MARIAM,
  displayName: "KONE Mariam",
  lastName: "KONE",
  firstName: "Mariam",
  studentNumber: "EL-0042",
  phone: "0101010101",
  currentEnrollment: { enrollmentId: fid(1), academicYearId: fid(2), institutionId: fid(3), classroomId: fid(4), classroomName: "6e A", status: "ACTIVE", registrationNumber: "R-42" },
});

const base = (extra: Record<string, unknown> = {}, features: string[] = []) => ({
  ...accessRoutes(STUDENT_PERMISSIONS, features),
  "GET /api/v1/people/me/student": me,
  ...extra,
});
const calls = (api: ReturnType<typeof setTestApi>) => api.calls.filter((c) => !c.path.startsWith("/api/v1/rbac") && !c.path.startsWith("/api/v1/entitlements"));

describe("portail élève : lui-même uniquement", () => {
  it("mon dossier : fiche, repères du moment, inscriptions ; aucune route « enfant » n'est appelée", async () => {
    const api = setTestApi(
      base({
        "GET /api/v1/results/me/results": { items: [familyResult()] },
        "GET /api/v1/academic/me/labels": familyLabels(),
        "GET /api/v1/academic/me/enrollments": { items: [enrollment({ studentId: MARIAM })] },
        "GET /api/v1/attendance/me/attendance": { studentId: MARIAM, records: [absenceRow(MARIAM)], justifications: [], summary: summaryDto(MARIAM) },
        [`GET /api/v1/finance/me/learners/${MARIAM}/statement`]: familyStatement(MARIAM),
        "GET /api/v1/scheduling/me/timetable": { ...page([]), subject: "STUDENT", subjectId: MARIAM },
      }),
    );
    renderWithProviders(<StudentHome />);
    expect(await screen.findByRole("heading", { level: 1, name: "KONE Mariam" })).toBeTruthy();
    expect(screen.getByText("6e A")).toBeTruthy();
    expect(await screen.findByText("13,50")).toBeTruthy();
    expect(await screen.findByText(/350\D000\sF\sCFA/)).toBeTruthy();
    expect(await screen.findByText("2026-0001")).toBeTruthy();
    expect(calls(api).some((c) => c.path.includes("/children"))).toBe(false);
    expect(calls(api).every((c) => !c.path.includes("/finance/learners/"))).toBe(true);
  });

  it("aucun dossier lié au compte : message explicite et aucune autre lecture", async () => {
    const api = setTestApi(base({ "GET /api/v1/people/me/student": () => json({ code: "people.student_not_found", message: "Aucun dossier." }, { status: 404 }) }));
    renderWithProviders(<StudentResults />);
    expect(await screen.findByText(/Aucun dossier d'élève n'est lié à votre compte/)).toBeTruthy();
    expect(calls(api).map((c) => c.path)).toEqual(["/api/v1/people/me/student"]);
  });

  it("résultats : notes publiées et résultats finaux de l'élève", async () => {
    setTestApi(
      base({
        "GET /api/v1/results/me/results": { items: [familyResult()] },
        "GET /api/v1/academic/me/labels": familyLabels(),
        "GET /api/v1/assess/me/grades": gradesPage([publishedGrade(1)]),
      }),
    );
    renderWithProviders(<StudentResults />);
    expect(await screen.findByRole("heading", { level: 1, name: "Mes résultats" })).toBeTruthy();
    expect(await screen.findByText("13,50")).toBeTruthy();
    const grades = await screen.findByRole("table", { name: "Notes publiées" });
    expect(within(grades).getByText("14,5 / 20")).toBeTruthy();
  });

  it("résultats non visibles (403 de l'API) : message affiché", async () => {
    setTestApi(
      base({
        "GET /api/v1/results/me/results": () => json({ code: "results.not_visible", message: "Résultats non visibles pour le moment." }, { status: 403 }),
        "GET /api/v1/academic/me/labels": familyLabels(),
        "GET /api/v1/assess/me/grades": gradesPage([]),
      }),
    );
    renderWithProviders(<StudentResults />);
    expect(await screen.findByText("Résultats non visibles pour le moment.")).toBeTruthy();
  });

  it("bulletins : liste de l'élève (route « moi »), téléchargement par URL signée", async () => {
    vi.stubGlobal("open", vi.fn());
    setTestApi(
      base({
        "GET /api/v1/reportcards/me/report-cards": { items: [card(1, { studentId: MARIAM, status: "PUBLISHED", publishedAt: "2027-02-10T08:00:00.000Z", academicPeriodId: PERIOD_1 })], nextCursor: null },
        "GET /api/v1/academic/me/labels": familyLabels(),
        [`GET /api/v1/reportcards/report-cards/${card(1).id}/pdf`]: { url: "https://files.example.test/s", expiresAt: "2027-02-10T08:05:00.000Z", fileName: "b.pdf", contentType: "application/pdf", sizeBytes: 10, pdfHash: "a".repeat(64) },
      }),
    );
    renderWithProviders(<StudentReportCards />);
    expect(await screen.findByRole("heading", { level: 2, name: "Bulletin du semestre 1" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Télécharger le bulletin/ }));
    await waitFor(() => expect(window.open).toHaveBeenCalled());
  });

  it("emploi du temps, évaluations à venir et absences de l'élève", async () => {
    const day = new Date().toISOString().slice(0, 10);
    setTestApi(
      base({
        "GET /api/v1/academic/me/labels": familyLabels(),
        "GET /api/v1/scheduling/me/timetable": { ...page([{ ...(await import("../../schedule/_test/fixtures")).occurrence({ id: fid(9), kind: "EXAM", title: "Examen de physique", occursOn: day }) }]), subject: "STUDENT", subjectId: MARIAM },
        "GET /api/v1/attendance/me/attendance": { studentId: MARIAM, records: [absenceRow(MARIAM)], justifications: [], summary: summaryDto(MARIAM) },
      }),
    );
    const a = renderWithProviders(<StudentUpcoming />);
    expect(await screen.findByText("Examen de physique")).toBeTruthy();
    a.unmount();
    const b = renderWithProviders(<StudentSchedule />);
    expect(await screen.findByRole("heading", { level: 1, name: "Mon emploi du temps" })).toBeTruthy();
    b.unmount();
    renderWithProviders(<StudentAttendance />);
    expect(await screen.findByText("À justifier")).toBeTruthy();
  });

  it("scolarité : relevé et reçus sur les routes /finance/me/* avec l'identifiant de SON dossier", async () => {
    const api = setTestApi(
      base({
        [`GET /api/v1/finance/me/learners/${MARIAM}/statement`]: familyStatement(MARIAM),
        [`GET /api/v1/finance/me/learners/${MARIAM}/installments`]: { items: [familyInstallment()] },
        [`GET /api/v1/finance/me/learners/${MARIAM}/receipts`]: { items: [receipt({ learnerId: MARIAM })], total: 1 },
      }),
    );
    renderWithProviders(<StudentFinance />);
    expect(await screen.findByRole("heading", { level: 1, name: "Ma scolarité" })).toBeTruthy();
    expect(await screen.findByText("REC-2026-000001")).toBeTruthy();
    expect(screen.getByRole("link", { name: "REC-2026-000001" }).getAttribute("href")).toBe(`/v2/student/finance/receipts/${fid(80)}`);
    expect(calls(api).filter((c) => c.path.startsWith("/api/v1/finance")).every((c) => c.path.startsWith(`/api/v1/finance/me/learners/${MARIAM}/`))).toBe(true);
    // pas de paiement sans la fonction de l'offre
    expect(screen.queryByRole("button", { name: "Payer en ligne" })).toBeNull();
  });

  it("reçu d'un autre apprenant : 404 uniforme affiché", async () => {
    setTestApi(base({ [`GET /api/v1/finance/me/learners/${MARIAM}/receipts/${fid(81)}`]: () => json(NOT_FOUND, { status: 404 }) }));
    renderWithProviders(<StudentReceipt id={fid(81)} />);
    expect(await screen.findByText("Ressource introuvable.")).toBeTruthy();
  });

  it("documents : bulletins et reçus selon les droits de l'élève", async () => {
    setTestApi(
      base({
        "GET /api/v1/reportcards/me/report-cards": { items: [card(1, { studentId: MARIAM, status: "PUBLISHED", publishedAt: "2027-02-10T08:00:00.000Z" })], nextCursor: null },
        "GET /api/v1/academic/me/labels": familyLabels(),
        [`GET /api/v1/finance/me/learners/${MARIAM}/receipts`]: { items: [], total: 0 },
        "GET /api/v1/higher/me/documents": { items: [] },
      }),
    );
    renderWithProviders(<StudentDocuments />);
    expect(await screen.findByText("Bulletin du semestre 1")).toBeTruthy();
    expect(await screen.findByText("Aucun reçu.")).toBeTruthy();
  });
});

describe("profil de l'élève", () => {
  it("identité en lecture seule ; coordonnées préremplies ; seuls les champs modifiés sont envoyés", async () => {
    const api = setTestApi(base({ "PATCH /api/v1/people/me/student": me }));
    renderWithProviders(<StudentProfile />);
    expect(await screen.findByRole("heading", { level: 1, name: "Mon profil" })).toBeTruthy();
    expect(screen.getByText("KONE")).toBeTruthy();
    const phone = (await screen.findByLabelText("Téléphone")) as HTMLInputElement;
    expect(phone.value).toBe("0101010101");
    fireEvent.click(screen.getByRole("button", { name: "Enregistrer" }));
    expect(await screen.findByText("Aucune modification à enregistrer.")).toBeTruthy();
    fireEvent.change(phone, { target: { value: "0707070707" } });
    fireEvent.change(screen.getByLabelText("Adresse e-mail"), { target: { value: "mariam@example.test" } });
    fireEvent.click(screen.getByRole("button", { name: "Enregistrer" }));
    expect(await screen.findByText("Coordonnées enregistrées.")).toBeTruthy();
    expect(api.calls.find((c) => c.method === "PATCH")!.body).toEqual({ phone: "0707070707", email: "mariam@example.test" });
  });

  it("sans le droit de modifier : pas de formulaire", async () => {
    setTestApi({ ...accessRoutes(["student.self.read"]), "GET /api/v1/people/me/student": me });
    renderWithProviders(<StudentProfile />);
    await screen.findByRole("heading", { level: 1, name: "Mon profil" });
    expect(screen.queryByRole("form", { name: "Mes coordonnées" })).toBeNull();
  });

  it("refus de l'API (422) sur un champ : message rattaché au champ", async () => {
    setTestApi(
      base({
        "PATCH /api/v1/people/me/student": () => json({ code: "people.invalid_input", message: "Données invalides.", details: { issues: [{ path: ["phone"], message: "Numéro de téléphone invalide." }] } }, { status: 400 }),
      }),
    );
    renderWithProviders(<StudentProfile />);
    const phone = await screen.findByLabelText("Téléphone");
    fireEvent.change(phone, { target: { value: "0707070707" } });
    fireEvent.click(screen.getByRole("button", { name: "Enregistrer" }));
    await waitFor(() => expect(screen.getAllByRole("alert").length).toBeGreaterThan(0));
  });
});
