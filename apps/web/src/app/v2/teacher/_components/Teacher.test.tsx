// @vitest-environment jsdom
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { accessRoutes, setTestApi } from "@/platform/test/api-mock";
import { json, renderWithProviders } from "@/platform/test/render";
import { sessionDto } from "../../attendance/_test/fixtures";
import { AssessmentCreate } from "../../assessments/_components/AssessmentCreate";
import { assessment, assessmentType } from "../../assessments/_test/fixtures";
import { occurrence } from "../../schedule/_test/fixtures";
import { payslip, payslipData, pid } from "../../_test/fixtures-payroll";
import { staffSummary, studentSummary } from "../../_test/fixtures-people";
import { uuid } from "../../_test/fixtures";
import { TeacherAssessments } from "./TeacherAssessments";
import { TeacherClassDetail, TeacherClasses } from "./TeacherClasses";
import { TeacherPayslip, TeacherPayslips } from "./TeacherPayslips";
import { TeacherProfile } from "./TeacherProfile";
import { TeacherToday } from "./TeacherToday";

vi.mock("@/platform/api/default-client", async () => (await import("@/platform/test/api-mock")).defaultClientModule);
vi.mock("next/link", () => ({ default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a> }));
vi.mock("next/navigation", () => ({ usePathname: () => "/v2/teacher", useRouter: () => ({ push: vi.fn(), replace: vi.fn() }) }));

const TEACHER_PERMISSIONS = [
  "assessment.type.read",
  "assessment.read",
  "assessment.create",
  "grade.read",
  "grade.enter",
  "attendance.read",
  "attendance.take",
  "student.class.read",
  "schedule.own.read",
  "staff.own.read",
  "staff.own.update",
  "attendance.own.read",
  "payroll.payslip.read_own",
  "payroll.my.dispute",
];

const MINE = uuid(500);
const FOREIGN = uuid(599);
const MATHS = uuid(510);
const PERIOD = uuid(200);
const myClass = {
  classroomId: MINE,
  academicYearId: uuid(100),
  classroomName: "6e A",
  classroomCode: "6A",
  periods: [{ id: PERIOD, label: "Semestre 1", startsOn: "2026-09-01", endsOn: "2027-01-31" }],
  nodes: [{ id: MATHS, label: "Mathématiques" }],
  assignments: [{ assignmentId: uuid(900), roleCode: "LEAD", curriculumNodeId: MATHS, nodeLabel: "Mathématiques", coversAllSubjects: false }],
};

const base = (extra: Record<string, unknown> = {}, features: string[] = []) => ({
  ...accessRoutes(TEACHER_PERMISSIONS, features),
  "GET /api/v1/people/me/classes": { items: [myClass] },
  ...extra,
});
const calls = (api: ReturnType<typeof setTestApi>) => api.calls.filter((c) => !c.path.startsWith("/api/v1/rbac") && !c.path.startsWith("/api/v1/entitlements"));

describe("Aujourd'hui", () => {
  const today = new Date().toISOString().slice(0, 10);
  it("séances du jour avec classe et matière nommées (sans lecture académique), appel et notes dans le portail", async () => {
    const api = setTestApi(
      base({
        "GET /api/v1/scheduling/me/today": { date: today, staffId: uuid(4000), items: [occurrence({ id: uuid(9001), title: null, classroomId: MINE, curriculumNodeId: MATHS }), occurrence({ id: uuid(9002), title: "Annulée", status: "CANCELLED" })] },
        "GET /api/v1/attendance/sessions": { items: [sessionDto({ occurrenceId: uuid(9001), status: "SUBMITTED" })], nextCursor: null },
      }),
    );
    renderWithProviders(<TeacherToday />);
    expect(await screen.findByRole("heading", { level: 1, name: "Aujourd'hui" })).toBeTruthy();
    expect((await screen.findAllByText("Mathématiques")).length).toBeGreaterThan(0);
    expect((await screen.findAllByText(/6e A/)).length).toBeGreaterThan(0);
    // appel déjà soumis : « Voir l'appel » ; séance annulée : aucune action
    expect(screen.getByRole("link", { name: "Voir l'appel" }).getAttribute("href")).toBe(`/v2/teacher/attendance/call/occurrence/${uuid(9001)}`);
    expect(screen.getByRole("link", { name: "Saisir les notes" }).getAttribute("href")).toBe(`/v2/teacher/assessments?classroom=${MINE}`);
    expect(screen.queryAllByRole("link", { name: "Faire l'appel" })).toHaveLength(0);
    expect(calls(api).some((c) => c.path.startsWith("/api/v1/academic"))).toBe(false);
  });

  it("appel à faire : lien « Faire l'appel » et compteur ; journée vide : état vide", async () => {
    setTestApi(
      base({
        "GET /api/v1/scheduling/me/today": { date: today, staffId: uuid(4000), items: [occurrence({ id: uuid(9001), classroomId: MINE })] },
        "GET /api/v1/attendance/sessions": { items: [], nextCursor: null },
      }),
    );
    const a = renderWithProviders(<TeacherToday />);
    expect(await screen.findByRole("link", { name: "Faire l'appel" })).toBeTruthy();
    await waitFor(() => expect(screen.getByText("Appels à faire").nextElementSibling?.textContent).toBe("1"));
    a.unmount();
    setTestApi(base({ "GET /api/v1/scheduling/me/today": { date: today, staffId: uuid(4000), items: [] } }));
    renderWithProviders(<TeacherToday />);
    expect(await screen.findByText("Aucune séance aujourd'hui.")).toBeTruthy();
  });

  it("erreur de l'API : message affiché avec « Réessayer »", async () => {
    setTestApi(base({ "GET /api/v1/scheduling/me/today": () => json({ code: "scheduling.staff_not_linked", message: "Aucune fiche de personnel n'est liée à votre compte." }, { status: 403 }) }));
    renderWithProviders(<TeacherToday />);
    expect(await screen.findByText("Aucune fiche de personnel n'est liée à votre compte.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Réessayer" })).toBeTruthy();
  });
});

describe("Mes classes : périmètre de l'enseignant", () => {
  it("liste de SES classes avec matières et gestes rapides", async () => {
    setTestApi(base());
    renderWithProviders(<TeacherClasses />);
    expect(await screen.findByRole("heading", { level: 2, name: "6e A" })).toBeTruthy();
    expect(screen.getByText("Mathématiques")).toBeTruthy();
    expect(screen.getByRole("link", { name: /Élèves/ }).getAttribute("href")).toBe(`/v2/teacher/classes/${MINE}`);
    expect(screen.getByRole("link", { name: /Évaluations/ }).getAttribute("href")).toBe(`/v2/teacher/assessments?classroom=${MINE}`);
  });

  it("aucune affectation : état vide", async () => {
    setTestApi(base({ "GET /api/v1/people/me/classes": { items: [] } }));
    renderWithProviders(<TeacherClasses />);
    expect(await screen.findByText("Aucune classe ne vous est affectée aujourd'hui.")).toBeTruthy();
  });

  it("élèves de ma classe : liste de l'API (fiche réduite)", async () => {
    const api = setTestApi(base({ "GET /api/v1/people/students": { items: [studentSummary({ id: uuid(2001), displayName: "KONE Mariam", studentNumber: "EL-1" })], total: 1, limit: 200, offset: 0 } }));
    renderWithProviders(<TeacherClassDetail classroomId={MINE} />);
    expect(await screen.findByRole("link", { name: "KONE Mariam" })).toBeTruthy();
    expect(api.calls.find((c) => c.path === "/api/v1/people/students")!.query.classroomId).toBe(MINE);
  });

  it("classe d'un autre enseignant : refus explicite, AUCUNE lecture d'élèves", async () => {
    const api = setTestApi(base());
    renderWithProviders(<TeacherClassDetail classroomId={FOREIGN} />);
    expect(await screen.findByText(/ne fait pas partie de vos classes/)).toBeTruthy();
    expect(screen.getByRole("link", { name: "Retour à mes classes" }).getAttribute("href")).toBe("/v2/teacher/classes");
    expect(calls(api).filter((c) => c.path === "/api/v1/people/students")).toHaveLength(0);
  });

  it("l'API refuse la classe (404 uniforme) : message de l'API affiché", async () => {
    setTestApi(base({ "GET /api/v1/people/students": () => json({ code: "people.classroom_forbidden", message: "Classe hors de votre périmètre." }, { status: 404 }) }));
    renderWithProviders(<TeacherClassDetail classroomId={MINE} />);
    expect(await screen.findByText("Classe hors de votre périmètre.")).toBeTruthy();
  });
});

describe("Mes évaluations", () => {
  it("liste des évaluations avec classe et matière nommées, accès à la grille dans le portail", async () => {
    const api = setTestApi(
      base({
        "GET /api/v1/assess/assessments": { items: [assessment({ id: uuid(800), title: "Devoir 1", classroomId: MINE, curriculumNodeId: MATHS })], nextCursor: null },
        "GET /api/v1/assess/assessment-types": { items: [assessmentType()] },
      }),
    );
    renderWithProviders(<TeacherAssessments />);
    const link = await screen.findByRole("link", { name: "Devoir 1" });
    expect(link.getAttribute("href")).toBe(`/v2/teacher/assessments/${uuid(800)}`);
    expect(within(screen.getByRole("table", { name: "Évaluations" })).getByText("6e A")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Notes de l'évaluation Devoir 1" }).getAttribute("href")).toBe(`/v2/teacher/assessments/${uuid(800)}/grades`);
    expect(calls(api).some((c) => c.path.startsWith("/api/v1/academic"))).toBe(false);
  });

  it("filtre par classe : envoyé à l'API ; le sélecteur ne propose que mes classes", async () => {
    const api = setTestApi(base({ "GET /api/v1/assess/assessments": { items: [], nextCursor: null }, "GET /api/v1/assess/assessment-types": { items: [] } }));
    renderWithProviders(<TeacherAssessments />);
    const select = (await screen.findByLabelText("Classe")) as HTMLSelectElement;
    await waitFor(() => expect(select.options.length).toBe(2));
    fireEvent.change(select, { target: { value: MINE } });
    await waitFor(() => expect(api.calls.some((c) => c.path === "/api/v1/assess/assessments" && c.query.classroomId === MINE)).toBe(true));
  });

  it("création sans lecture académique : classes, matières et périodes viennent de « mes classes » ; corps exact envoyé", async () => {
    const api = setTestApi(
      base({
        "GET /api/v1/assess/assessment-types": { items: [assessmentType()] },
        "POST /api/v1/assess/assessments": () => json(assessment({ title: "Devoir 2" }), { status: 201 }),
      }),
    );
    renderWithProviders(<AssessmentCreate initialClassroomId={MINE} />);
    await screen.findByRole("option", { name: "Devoir" });
    fireEvent.change(screen.getByLabelText(/Type d'évaluation/), { target: { value: uuid(700) } });
    fireEvent.change(screen.getByLabelText(/Intitulé/), { target: { value: "Devoir 2" } });
    fireEvent.change(screen.getByLabelText(/Date de l'évaluation/), { target: { value: "2026-10-15" } });
    await screen.findByRole("option", { name: "Mathématiques" });
    fireEvent.change(screen.getByLabelText(/^Cours/), { target: { value: MATHS } });
    await screen.findByRole("option", { name: "Semestre 1" });
    fireEvent.change(screen.getByLabelText(/^Période/), { target: { value: PERIOD } });
    fireEvent.click(screen.getByRole("button", { name: "Créer l'évaluation" }));
    await screen.findByText("1 évaluation créée.");
    expect(api.calls.find((c) => c.method === "POST")!.body).toEqual({ typeId: uuid(700), academicPeriodId: PERIOD, title: "Devoir 2", assessedOn: "2026-10-15", classroomId: MINE, curriculumNodeId: MATHS });
    expect(calls(api).some((c) => c.path.startsWith("/api/v1/academic"))).toBe(false);
  });
});

describe("Mes bulletins de paie", () => {
  it("liste de mes bulletins (montants arrêtés) avec lien vers le détail dans le portail", async () => {
    setTestApi(base({ "GET /api/v1/payroll/my/payslips": { items: [payslip({ id: pid(1), status: "APPROVED" })], total: 1 } }));
    renderWithProviders(<TeacherPayslips />);
    const link = await screen.findByRole("link", { name: /2026|\d{4}/ });
    expect(link.getAttribute("href")).toBe(`/v2/teacher/payslips/${pid(1)}`);
  });

  it("contestation : motif obligatoire (3 caractères), route « my » dédiée, bulletin passé à « Contesté »", async () => {
    const api = setTestApi(
      base({
        [`GET /api/v1/payroll/my/payslips/${pid(1)}`]: payslipData({ status: "APPROVED" }),
        [`POST /api/v1/payroll/my/payslips/${pid(1)}/dispute`]: () => json(payslip({ id: pid(1), status: "DISPUTED", disputedAt: "2026-10-02T08:00:00.000Z", disputeReason: "Heures manquantes" })),
      }),
    );
    renderWithProviders(<TeacherPayslip id={pid(1)} />);
    fireEvent.click(await screen.findByRole("button", { name: "Contester ce bulletin" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText(/Motif de la contestation/), { target: { value: "ab" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Envoyer la contestation" }));
    expect(calls(api).filter((c) => c.method === "POST")).toHaveLength(0);
    fireEvent.change(within(dialog).getByLabelText(/Motif de la contestation/), { target: { value: "Heures manquantes" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Envoyer la contestation" }));
    expect(await screen.findByText("Votre contestation a été transmise à la gestion de la paie.")).toBeTruthy();
    const post = api.calls.find((c) => c.method === "POST")!;
    expect(post.path).toBe(`/api/v1/payroll/my/payslips/${pid(1)}/dispute`);
    expect(post.body).toEqual({ reason: "Heures manquantes" });
  });

  it("bulletin non contestable (409 de l'API) : message affiché dans la fenêtre", async () => {
    setTestApi(
      base({
        [`GET /api/v1/payroll/my/payslips/${pid(1)}`]: payslipData({ status: "APPROVED" }),
        [`POST /api/v1/payroll/my/payslips/${pid(1)}/dispute`]: () => json({ code: "payroll.invalid_transition", message: "Ce bulletin a déjà été versé : il n'est plus contestable." }, { status: 409 }),
      }),
    );
    renderWithProviders(<TeacherPayslip id={pid(1)} />);
    fireEvent.click(await screen.findByRole("button", { name: "Contester ce bulletin" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText(/Motif de la contestation/), { target: { value: "Tarif erroné" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Envoyer la contestation" }));
    expect(await within(dialog).findByText("Ce bulletin a déjà été versé : il n'est plus contestable.")).toBeTruthy();
  });

  it("bulletin versé ou contesté, ou sans la permission : pas de bouton de contestation ; bulletin d'un autre : 404 affiché", async () => {
    setTestApi(base({ [`GET /api/v1/payroll/my/payslips/${pid(1)}`]: payslipData({ status: "PAID" }) }));
    const a = renderWithProviders(<TeacherPayslip id={pid(1)} />);
    await screen.findByRole("button", { name: "Télécharger le PDF" });
    expect(screen.queryByRole("button", { name: "Contester ce bulletin" })).toBeNull();
    a.unmount();
    setTestApi({ ...accessRoutes(["payroll.payslip.read_own"]), [`GET /api/v1/payroll/my/payslips/${pid(1)}`]: payslipData({ status: "APPROVED" }) });
    const b = renderWithProviders(<TeacherPayslip id={pid(1)} />);
    await screen.findByRole("button", { name: "Télécharger le PDF" });
    expect(screen.queryByRole("button", { name: "Contester ce bulletin" })).toBeNull();
    b.unmount();
    setTestApi(base({ [`GET /api/v1/payroll/my/payslips/${pid(2)}`]: () => json({ code: "payroll.not_found", message: "Bulletin introuvable." }, { status: 404 }) }));
    renderWithProviders(<TeacherPayslip id={pid(2)} />);
    expect(await screen.findByText("Bulletin introuvable.")).toBeTruthy();
  });
});

describe("Profil de l'enseignant", () => {
  it("fiche, affectations et coordonnées : seuls les champs modifiés sont envoyés dans `contact`", async () => {
    const api = setTestApi(
      base({
        "GET /api/v1/people/me/staff": { ...staffSummary({ id: uuid(4000), displayName: "DIALLO Issa" }), otherNames: null, sex: null, email: "issa@example.test", phone: "0101010101", phoneAlt: null, addressLine: null, city: null, hiredOn: "2020-09-01", leftOn: null, primaryCampusId: null, affiliations: [], portalAccount: "active", externalRef: null, createdAt: "2020-09-01T08:00:00.000Z", updatedAt: "2020-09-01T08:00:00.000Z" },
        "PATCH /api/v1/people/me/staff": { ok: true },
      }),
    );
    renderWithProviders(<TeacherProfile />);
    expect(await screen.findByRole("heading", { level: 2, name: /DIALLO Issa/ })).toBeTruthy();
    expect(screen.getAllByText("6e A").length).toBeGreaterThan(0);
    const phone = (await screen.findByLabelText("Téléphone")) as HTMLInputElement;
    expect(phone.value).toBe("0101010101");
    fireEvent.change(phone, { target: { value: "0202020202" } });
    fireEvent.click(screen.getByRole("button", { name: "Enregistrer" }));
    expect(await screen.findByText("Coordonnées enregistrées.")).toBeTruthy();
    expect(api.calls.find((c) => c.method === "PATCH")!.body).toEqual({ contact: { phone: "0202020202" } });
  });
});
