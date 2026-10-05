// @vitest-environment jsdom
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { accessRoutes, setTestApi } from "@/platform/test/api-mock";
import { json, renderWithProviders } from "@/platform/test/render";
import { absenceRow, summaryDto } from "../../attendance/_test/fixtures";
import { card } from "../../reportcards/_test/fixtures";
import { occurrence, page } from "../../schedule/_test/fixtures";
import { invoiceDetail, receipt, paymentView, payment } from "../../_test/fixtures-finance";
import {
  CLASSROOM,
  familyInstallment,
  familyLabels,
  familyResult,
  familyStatement,
  fid,
  gradesPage,
  MARIAM,
  mariam,
  NODE_MATHS,
  NOT_FOUND,
  PERIOD_1,
  publishedGrade,
  STRANGER,
  YAO,
  yao,
} from "../../_test/fixtures-family";
import { ChildAttendance, ChildDocuments, ChildFile, ChildFinance, ChildReceipt, ChildReportCards, ChildResults, ChildSchedule, ChildUpcoming } from "./ChildScreens";
import { ChildDashboard, ParentHome } from "./ParentHome";
import { ParentAccount } from "./ParentAccount";

vi.mock("@/platform/api/default-client", async () => (await import("@/platform/test/api-mock")).defaultClientModule);
vi.mock("next/link", () => ({ default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a> }));
vi.mock("next/navigation", () => ({ usePathname: () => "/v2/parent", useRouter: () => ({ push: vi.fn(), replace: vi.fn() }) }));
vi.mock("next-auth/react", () => ({ useSession: () => ({ data: { user: { name: "Mme KONE", email: "parent@example.test" } } }), signOut: vi.fn() }));

const PARENT_PERMISSIONS = [
  "student.child.read",
  "student.child.update",
  "enrollment.child.read",
  "grade.child.read",
  "result.child.read",
  "reportcard.child.read",
  "attendance.child.read",
  "attendance.child.justify",
  "schedule.child.read",
  "higher.child.read",
  "finance.child.read",
  "finance.child.pay",
];

const base = (extra: Record<string, unknown> = {}, features: string[] = []) => ({
  ...accessRoutes(PARENT_PERMISSIONS, features),
  "GET /api/v1/people/children": { items: [mariam, yao] },
  ...extra,
});

/** Appels dont le chemin désigne l'enfant NON lié : doit toujours être vide. */
const strangerCalls = (api: ReturnType<typeof setTestApi>) => api.calls.filter((c) => c.path.includes(STRANGER));
const dataCalls = (api: ReturnType<typeof setTestApi>) => api.calls.filter((c) => !c.path.startsWith("/api/v1/rbac") && !c.path.startsWith("/api/v1/entitlements") && c.path !== "/api/v1/people/children");

beforeEach(() => {
  vi.stubGlobal("open", vi.fn());
});

describe("accueil du parent", () => {
  it("un bloc par enfant lié avec ses repères ; aucun appel pour un autre élève", async () => {
    const api = setTestApi(
      base({
        [`GET /api/v1/results/children/${MARIAM}/results`]: { items: [familyResult()] },
        [`GET /api/v1/results/children/${YAO}/results`]: { items: [] },
        [`GET /api/v1/academic/children/${MARIAM}/labels`]: familyLabels(),
        [`GET /api/v1/academic/children/${YAO}/labels`]: familyLabels({ periods: [] }),
        [`GET /api/v1/attendance/children/${MARIAM}/attendance`]: { studentId: MARIAM, records: [absenceRow(MARIAM)], justifications: [], summary: summaryDto(MARIAM) },
        [`GET /api/v1/attendance/children/${YAO}/attendance`]: { studentId: YAO, records: [], justifications: [], summary: null },
        [`GET /api/v1/finance/me/learners/${MARIAM}/statement`]: familyStatement(MARIAM),
        [`GET /api/v1/finance/me/learners/${YAO}/statement`]: familyStatement(YAO, { totals: { billed: { amount: 0, currency: "XOF" }, credited: { amount: 0, currency: "XOF" }, collected: { amount: 0, currency: "XOF" }, outstanding: { amount: 0, currency: "XOF" }, unallocatedPayments: { amount: 0, currency: "XOF" } } }),
        [`GET /api/v1/scheduling/children/${MARIAM}/timetable`]: page([]),
        [`GET /api/v1/scheduling/children/${YAO}/timetable`]: page([]),
      }),
    );
    renderWithProviders(<ParentHome />);
    expect(await screen.findByRole("heading", { level: 2, name: "KONE Mariam" })).toBeTruthy();
    expect(screen.getByRole("heading", { level: 2, name: "KONE Yao" })).toBeTruthy();
    // moyenne publiée (valeur de l'API, libellé de la période issu des libellés famille), absences, reste à payer
    expect(await screen.findByText("13,50")).toBeTruthy();
    expect(await screen.findByText(/Semestre 1/)).toBeTruthy();
    expect(await screen.findByText(/350\D000\sF\sCFA/)).toBeTruthy();
    expect(await screen.findByText(/3 absence\(s\), 2 retard\(s\)/)).toBeTruthy();
    expect(screen.getAllByRole("link", { name: /Ouvrir/ }).map((a) => a.getAttribute("href"))).toEqual([`/v2/parent/children/${MARIAM}`, `/v2/parent/children/${YAO}`]);
    expect(strangerCalls(api)).toHaveLength(0);
  });

  it("aucun enfant lié : état vide explicite, aucune lecture de données", async () => {
    const api = setTestApi(base({ "GET /api/v1/people/children": { items: [] } }));
    renderWithProviders(<ParentHome />);
    expect(await screen.findByText("Aucun enfant n'est rattaché à votre compte.")).toBeTruthy();
    expect(dataCalls(api)).toHaveLength(0);
  });

  it("liste des enfants en erreur (403) : le message de l'API est affiché avec « Réessayer »", async () => {
    setTestApi(base({ "GET /api/v1/people/children": () => json({ code: "forbidden", message: "Accès refusé." }, { status: 403 }) }));
    renderWithProviders(<ParentHome />);
    expect(await screen.findByText("Accès refusé.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Réessayer" })).toBeTruthy();
  });

  it("une carte indisponible (403 d'un module) n'empêche pas les autres", async () => {
    setTestApi(
      base({
        "GET /api/v1/people/children": { items: [mariam] },
        [`GET /api/v1/results/children/${MARIAM}/results`]: () => json({ code: "results.not_visible", message: "Résultats non visibles." }, { status: 403 }),
        [`GET /api/v1/academic/children/${MARIAM}/labels`]: familyLabels(),
        [`GET /api/v1/attendance/children/${MARIAM}/attendance`]: { studentId: MARIAM, records: [], justifications: [], summary: summaryDto(MARIAM) },
        [`GET /api/v1/finance/me/learners/${MARIAM}/statement`]: familyStatement(MARIAM),
        [`GET /api/v1/scheduling/children/${MARIAM}/timetable`]: page([]),
      }),
    );
    renderWithProviders(<ParentHome />);
    expect(await screen.findByText(/350\D000\sF\sCFA/)).toBeTruthy();
    expect((await screen.findAllByText("Information indisponible pour le moment.")).length).toBeGreaterThanOrEqual(1);
  });
});

describe("matrice d'accès : enfant non lié", () => {
  it("tableau de bord, résultats, bulletins, absences, emploi du temps, scolarité, documents, dossier : refus et AUCUN appel pour l'élève étranger", async () => {
    const api = setTestApi(base());
    const screens = [ChildDashboard, ChildResults, ChildReportCards, ChildAttendance, ChildSchedule, ChildUpcoming, ChildFinance, ChildDocuments, ChildFile];
    for (const Screen of screens) {
      const { unmount } = renderWithProviders(<Screen childId={STRANGER} />);
      expect(await screen.findByText(/n'est pas rattaché à votre compte/)).toBeTruthy();
      expect(screen.getByRole("link", { name: "Retour à mes enfants" }).getAttribute("href")).toBe("/v2/parent");
      unmount();
    }
    expect(dataCalls(api)).toHaveLength(0);
    expect(strangerCalls(api)).toHaveLength(0);
  });

  it("reçu d'un enfant non lié : même refus", async () => {
    const api = setTestApi(base());
    renderWithProviders(<ChildReceipt childId={STRANGER} id={fid(80)} />);
    expect(await screen.findByText(/n'est pas rattaché à votre compte/)).toBeTruthy();
    expect(dataCalls(api)).toHaveLength(0);
  });
});

describe("résultats de l'enfant", () => {
  it("résultats officiels avec matières nommées et notes publiées ; une absence n'est jamais un zéro", async () => {
    setTestApi(
      base({
        [`GET /api/v1/results/children/${MARIAM}/results`]: { items: [familyResult()] },
        [`GET /api/v1/academic/children/${MARIAM}/labels`]: familyLabels(),
        [`GET /api/v1/assess/children/${MARIAM}/grades`]: gradesPage([publishedGrade(1), publishedGrade(2, { title: "Devoir 2", score: null, entryStatus: "ABSENT_UNEXCUSED" })]),
      }),
    );
    renderWithProviders(<ChildResults childId={MARIAM} />);
    expect(await screen.findByRole("heading", { level: 1, name: "Résultats de KONE Mariam" })).toBeTruthy();
    expect(await screen.findByText("13,50")).toBeTruthy();
    expect(screen.getByText("3 sur 30")).toBeTruthy();
    expect(screen.getByText("Admis")).toBeTruthy();
    expect(screen.getAllByText("Validé").length).toBeGreaterThan(0);
    // détail par matière : libellés issus des libellés famille
    fireEvent.click(screen.getByText(/Détail par matière/));
    const lines = await screen.findByRole("table", { name: "Détail des résultats par matière" });
    expect(within(lines).getByText("Mathématiques")).toBeTruthy();
    expect(within(lines).getByText("Français")).toBeTruthy();
    expect(within(lines).getByText("Non validé")).toBeTruthy();
    // notes publiées
    const grades = await screen.findByRole("table", { name: "Notes publiées" });
    expect(within(grades).getByText("14,5 / 20")).toBeTruthy();
    expect(within(grades).getByText("Absent non justifié")).toBeTruthy();
    expect(within(grades).queryByText(/^0/)).toBeNull();
  });

  it("Q-P18 : un rang provisoire (classe marquée prête) s'affiche seul, signalé provisoire, sans moyenne ni mention ni crédits", async () => {
    setTestApi(
      base({
        [`GET /api/v1/results/children/${MARIAM}/results`]: {
          items: [familyResult({ provisional: true, average: null, averageDisplay: null, rank: 2, cohortSize: 28, mentionCode: null, decisionCode: null, decisionOutcome: null, creditsAcquired: null, creditsRequired: null, validated: null, finalizedAt: null, lines: [] })],
        },
        [`GET /api/v1/academic/children/${MARIAM}/labels`]: familyLabels(),
        [`GET /api/v1/assess/children/${MARIAM}/grades`]: gradesPage([]),
      }),
    );
    renderWithProviders(<ChildResults childId={MARIAM} />);
    expect(await screen.findByText("2 sur 28")).toBeTruthy();
    expect(screen.getByText("Rang provisoire")).toBeTruthy();
    expect(screen.getByText(/seul le rang est communiqué/)).toBeTruthy();
    expect(screen.queryByText("Moyenne")).toBeNull();
    expect(screen.queryByText("Mention")).toBeNull();
    expect(screen.queryByText("Crédits")).toBeNull();
    expect(screen.queryByText("Résultat arrêté le", { exact: false })).toBeNull();
  });

  it("lien de tutelle clos côté serveur : le 403 de l'API est affiché tel quel, sans données", async () => {
    setTestApi(
      base({
        [`GET /api/v1/results/children/${MARIAM}/results`]: () => json({ code: "results.not_visible", message: "Vous n'êtes pas le tuteur de cet élève." }, { status: 403 }),
        [`GET /api/v1/academic/children/${MARIAM}/labels`]: () => json(NOT_FOUND, { status: 404 }),
        [`GET /api/v1/assess/children/${MARIAM}/grades`]: () => json({ code: "assess.not_visible", message: "Vous n'êtes pas le tuteur de cet élève." }, { status: 403 }),
      }),
    );
    renderWithProviders(<ChildResults childId={MARIAM} />);
    await waitFor(() => expect(screen.getAllByText("Vous n'êtes pas le tuteur de cet élève.")).toHaveLength(2));
    expect(screen.queryByText("13,50")).toBeNull();
  });

  it("aucune note ni résultat : états vides", async () => {
    setTestApi(
      base({
        [`GET /api/v1/results/children/${MARIAM}/results`]: { items: [] },
        [`GET /api/v1/academic/children/${MARIAM}/labels`]: familyLabels(),
        [`GET /api/v1/assess/children/${MARIAM}/grades`]: gradesPage([]),
      }),
    );
    renderWithProviders(<ChildResults childId={MARIAM} />);
    expect(await screen.findByText("Aucun résultat publié pour le moment.")).toBeTruthy();
    expect(await screen.findByText("Aucune note publiée.")).toBeTruthy();
  });

  it("pagination des notes par curseur", async () => {
    const api = setTestApi(
      base({
        [`GET /api/v1/results/children/${MARIAM}/results`]: { items: [] },
        [`GET /api/v1/academic/children/${MARIAM}/labels`]: familyLabels(),
        [`GET /api/v1/assess/children/${MARIAM}/grades`]: ({ url }: { url: URL }) =>
          json(url.searchParams.get("cursor") === "c2" ? gradesPage([publishedGrade(2, { title: "Devoir 2" })]) : gradesPage([publishedGrade(1)], "c2")),
      }),
    );
    renderWithProviders(<ChildResults childId={MARIAM} />);
    expect(await screen.findByText("Composition 1")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Afficher plus" }));
    expect(await screen.findByText("Devoir 2")).toBeTruthy();
    expect(api.calls.filter((c) => c.path.endsWith("/grades")).map((c) => c.query.cursor)).toEqual([undefined, "c2"]);
  });
});

describe("bulletins et documents", () => {
  it("bulletins publiés de l'enfant : téléchargement contrôlé (URL signée) et code de vérification", async () => {
    const api = setTestApi(
      base({
        [`GET /api/v1/reportcards/children/${MARIAM}/report-cards`]: { items: [card(1, { studentId: MARIAM, status: "PUBLISHED", publishedAt: "2027-02-10T08:00:00.000Z", academicPeriodId: PERIOD_1 })], nextCursor: null },
        [`GET /api/v1/academic/children/${MARIAM}/labels`]: familyLabels(),
        [`GET /api/v1/reportcards/report-cards/${card(1).id}/pdf`]: { url: "https://files.example.test/signed?x=1", expiresAt: "2027-02-10T08:05:00.000Z", fileName: "bulletin.pdf", contentType: "application/pdf", sizeBytes: 1024, pdfHash: "a".repeat(64) },
      }),
    );
    renderWithProviders(<ChildReportCards childId={MARIAM} />);
    expect(await screen.findByRole("heading", { level: 2, name: "Bulletin du semestre 1" })).toBeTruthy();
    expect(screen.getByText(/Semestre 1 · Aka Marie/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Télécharger le bulletin/ }));
    await waitFor(() => expect(window.open).toHaveBeenCalledWith("https://files.example.test/signed?x=1", "_blank", "noopener,noreferrer"));
    // la vérification publique : code et lien, jamais l'URL signée affichée
    fireEvent.click(screen.getByRole("button", { name: "Vérifier l'authenticité" }));
    expect(await screen.findByTestId("verification-code")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Ouvrir la page de vérification" }).getAttribute("href")).toBe(`/v2/verify/${card(1).verificationCode}`);
    expect(document.body.textContent).not.toContain("files.example.test");
    expect(api.calls.some((c) => c.path === "/api/v1/reportcards/me/report-cards")).toBe(false);
  });

  it("documents : bulletins, reçus et rubrique du supérieur masquée quand la fonction est absente (403)", async () => {
    setTestApi(
      base({
        [`GET /api/v1/reportcards/children/${MARIAM}/report-cards`]: { items: [card(1, { studentId: MARIAM, status: "PUBLISHED", publishedAt: "2027-02-10T08:00:00.000Z" })], nextCursor: null },
        [`GET /api/v1/academic/children/${MARIAM}/labels`]: familyLabels(),
        [`GET /api/v1/finance/me/learners/${MARIAM}/receipts`]: { items: [receipt({ learnerId: MARIAM })], total: 1 },
        [`GET /api/v1/higher/children/${MARIAM}/documents`]: () => json({ code: "entitlements.feature_not_available", message: "Fonction non incluse." }, { status: 403 }),
      }),
    );
    renderWithProviders(<ChildDocuments childId={MARIAM} />);
    expect(await screen.findByText("Bulletin du semestre 1")).toBeTruthy();
    expect(await screen.findByText("REC-2026-000001")).toBeTruthy();
    expect(screen.queryByText("Diplômes et attestations")).toBeNull();
  });
});

describe("absences et emploi du temps", () => {
  it("absences : récapitulatif de l'API et absence à justifier", async () => {
    setTestApi(
      base({
        [`GET /api/v1/attendance/children/${MARIAM}/attendance`]: { studentId: MARIAM, records: [absenceRow(MARIAM)], justifications: [], summary: summaryDto(MARIAM) },
      }),
    );
    renderWithProviders(<ChildAttendance childId={MARIAM} />);
    expect(await screen.findByRole("heading", { level: 1, name: /Absences/ })).toBeTruthy();
    expect(await screen.findByText("À justifier")).toBeTruthy();
    expect(screen.getByRole("button", { name: /Déposer un justificatif/ })).toBeTruthy();
  });

  it("emploi du temps : séances de la semaine avec matière et classe nommées", async () => {
    setTestApi(
      base({
        [`GET /api/v1/academic/children/${MARIAM}/labels`]: familyLabels(),
        [`GET /api/v1/scheduling/children/${MARIAM}/timetable`]: page([occurrence({ id: fid(5), title: null, classroomId: CLASSROOM, curriculumNodeId: NODE_MATHS, occursOn: new Date().toISOString().slice(0, 10), startsAt: new Date().toISOString(), endsAt: new Date(Date.now() + 3_600_000).toISOString() })]),
      }),
    );
    renderWithProviders(<ChildSchedule childId={MARIAM} />);
    expect(await screen.findByRole("heading", { level: 1, name: "Emploi du temps de KONE Mariam" })).toBeTruthy();
    await waitFor(() => expect(screen.getAllByText("Mathématiques").length).toBeGreaterThan(0));
  });

  it("emploi du temps refusé par l'API (403) : message affiché", async () => {
    setTestApi(
      base({
        [`GET /api/v1/academic/children/${MARIAM}/labels`]: familyLabels(),
        [`GET /api/v1/scheduling/children/${MARIAM}/timetable`]: () => json({ code: "scheduling.forbidden", message: "Accès à cet emploi du temps refusé." }, { status: 403 }),
      }),
    );
    renderWithProviders(<ChildSchedule childId={MARIAM} />);
    expect(await screen.findByText("Accès à cet emploi du temps refusé.")).toBeTruthy();
  });

  it("évaluations à venir : seuls les examens planifiés non annulés", async () => {
    const day = new Date().toISOString().slice(0, 10);
    setTestApi(
      base({
        [`GET /api/v1/academic/children/${MARIAM}/labels`]: familyLabels(),
        [`GET /api/v1/scheduling/children/${MARIAM}/timetable`]: page([
          occurrence({ id: fid(6), kind: "EXAM", title: "Composition de maths", occursOn: day }),
          occurrence({ id: fid(7), kind: "LESSON", title: "Cours ordinaire", occursOn: day }),
          occurrence({ id: fid(8), kind: "EXAM", title: "Examen annulé", status: "CANCELLED", occursOn: day }),
        ]),
      }),
    );
    renderWithProviders(<ChildUpcoming childId={MARIAM} />);
    expect(await screen.findByText("Composition de maths")).toBeTruthy();
    expect(screen.queryByText("Cours ordinaire")).toBeNull();
    expect(screen.queryByText("Examen annulé")).toBeNull();
  });
});

describe("scolarité de l'enfant : routes /finance/me/*", () => {
  const finance = (extra: Record<string, unknown> = {}, features: string[] = ["finance.online-payment"]) =>
    base(
      {
        [`GET /api/v1/finance/me/learners/${MARIAM}/statement`]: familyStatement(MARIAM),
        [`GET /api/v1/finance/me/learners/${MARIAM}/installments`]: { items: [familyInstallment({ dueDate: "2020-01-01", status: "OVERDUE" })] },
        [`GET /api/v1/finance/me/learners/${MARIAM}/receipts`]: { items: [receipt({ learnerId: MARIAM })], total: 1 },
        [`GET /api/v1/finance/me/learners/${MARIAM}/invoices/${fid(50)}`]: invoiceDetail({ learnerId: MARIAM }),
        ...extra,
      },
      features,
    );
  const financeCalls = (api: ReturnType<typeof setTestApi>) => api.calls.filter((c) => c.path.startsWith("/api/v1/finance"));

  it("ne lit JAMAIS les anciennes routes /finance/learners/* ; totaux, échéances, factures dépliables, reçus", async () => {
    const api = setTestApi(finance());
    renderWithProviders(<ChildFinance childId={MARIAM} />);
    expect(await screen.findByRole("heading", { level: 1, name: "Scolarité de KONE Mariam" })).toBeTruthy();
    expect((await screen.findAllByText(/Reste à payer/)).length).toBeGreaterThan(0);
    expect((await screen.findAllByText(/350\D000\sF\sCFA/)).length).toBeGreaterThan(0);
    expect(await screen.findByRole("table", { name: "Échéances à payer" })).toBeTruthy();
    fireEvent.click(document.querySelector("details > summary")!);
    expect(await screen.findByRole("table", { name: /Échéances de la facture FAC-2026-000001/ })).toBeTruthy();
    expect(await screen.findByText("REC-2026-000001")).toBeTruthy();
    expect(financeCalls(api).every((c) => c.path.startsWith("/api/v1/finance/me/learners/"))).toBe(true);
    expect(financeCalls(api).some((c) => /\/finance\/(learners|payments|receipts|invoices)\b/.test(c.path))).toBe(false);
  });

  it("scolarité d'un enfant dont le lien n'existe pas : 404 uniforme de l'API affiché", async () => {
    setTestApi(
      finance({
        [`GET /api/v1/finance/me/learners/${MARIAM}/statement`]: () => json(NOT_FOUND, { status: 404 }),
        [`GET /api/v1/finance/me/learners/${MARIAM}/installments`]: () => json(NOT_FOUND, { status: 404 }),
        [`GET /api/v1/finance/me/learners/${MARIAM}/receipts`]: () => json(NOT_FOUND, { status: 404 }),
      }),
    );
    renderWithProviders(<ChildFinance childId={MARIAM} />);
    expect((await screen.findAllByText("Ressource introuvable.")).length).toBeGreaterThanOrEqual(1);
    expect(screen.queryByRole("button", { name: "Payer en ligne" })).toBeNull();
  });

  it("paiement en ligne : facture obligatoire, montant entier, clé d'idempotence (en-tête et corps), double clic = une seule demande", async () => {
    let posts = 0;
    const api = setTestApi(
      finance({
        [`POST /api/v1/finance/me/learners/${MARIAM}/payments/online`]: () => {
          posts += 1;
          return json({ ...paymentView({ payment: payment({ id: fid(71), learnerId: MARIAM, status: "PENDING", confirmedAt: null }), receipt: null, allocations: [] }), instructions: { instructions: "Validez sur votre téléphone.", ussdCode: "#144#" } }, { status: 201 });
        },
        [`GET /api/v1/finance/me/learners/${MARIAM}/payments/${fid(71)}`]: paymentView({ payment: payment({ id: fid(71), learnerId: MARIAM, status: "PENDING", confirmedAt: null }), receipt: null, allocations: [] }),
      }),
    );
    renderWithProviders(<ChildFinance childId={MARIAM} />);
    fireEvent.click(await screen.findByRole("button", { name: "Payer en ligne" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText(/Montant/), { target: { value: "100000" } });
    fireEvent.change(within(dialog).getByLabelText(/Numéro de téléphone/), { target: { value: "0707070707" } });
    const submit = within(dialog).getByRole("button", { name: "Payer" });
    fireEvent.click(submit);
    fireEvent.click(submit);
    expect(await screen.findByText("Suivi du paiement")).toBeTruthy();
    expect(screen.getByText("#144#")).toBeTruthy();
    expect(posts).toBe(1);
    const post = api.calls.find((c) => c.method === "POST" && c.path.endsWith("/payments/online"))!;
    expect(post.body).toMatchObject({ invoiceId: fid(50), amount: 100000, provider: "orange_money", payer: { phoneNumber: "0707070707" } });
    expect(post.headers["idempotency-key"]).toBe((post.body as { idempotencyKey: string }).idempotencyKey);
  });

  it("décimale refusée plutôt que devinée ; montant au-delà du reste dû : refus de l'API affiché", async () => {
    setTestApi(
      finance({
        [`POST /api/v1/finance/me/learners/${MARIAM}/payments/online`]: () => json({ code: "finance.amount_exceeds_balance", message: "Le montant dépasse le reste dû de la facture." }, { status: 422 }),
      }),
    );
    renderWithProviders(<ChildFinance childId={MARIAM} />);
    fireEvent.click(await screen.findByRole("button", { name: "Payer en ligne" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText(/Montant/), { target: { value: "1.500" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Payer" }));
    expect((await within(dialog).findAllByRole("alert")).length).toBeGreaterThan(0);
    fireEvent.change(within(dialog).getByLabelText(/Montant/), { target: { value: "999999" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Payer" }));
    expect(await within(dialog).findByText("Le montant dépasse le reste dû de la facture.")).toBeTruthy();
  });

  it("sans la fonction de paiement en ligne ou sans permission de payer : aucun bouton « Payer »", async () => {
    setTestApi(finance({}, []));
    renderWithProviders(<ChildFinance childId={MARIAM} />);
    await screen.findAllByText(/Reste à payer/);
    expect(screen.queryByRole("button", { name: "Payer en ligne" })).toBeNull();
  });

  it("reçu : instantané de l'API et PDF scellé demandé sur la route famille", async () => {
    vi.stubGlobal("URL", Object.assign(URL, { createObjectURL: vi.fn(() => "blob:test"), revokeObjectURL: vi.fn() }));
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);
    const api = setTestApi(
      base({
        [`GET /api/v1/finance/me/learners/${MARIAM}/receipts/${fid(80)}`]: receipt({ learnerId: MARIAM }),
        [`GET /api/v1/finance/me/learners/${MARIAM}/receipts/${fid(80)}/pdf`]: () => new Response(new Blob(["%PDF-1.7"], { type: "application/pdf" }), { status: 200, headers: { "content-type": "application/pdf" } }),
      }),
    );
    renderWithProviders(<ChildReceipt childId={MARIAM} id={fid(80)} />);
    expect(await screen.findByRole("heading", { level: 1, name: "Reçu REC-2026-000001" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Retour à la scolarité" }).getAttribute("href")).toBe(`/v2/parent/children/${MARIAM}/finance`);
    fireEvent.click(screen.getByRole("button", { name: "Télécharger le PDF" }));
    await waitFor(() => expect(api.calls.some((c) => c.path.endsWith(`/receipts/${fid(80)}/pdf`))).toBe(true));
    await waitFor(() => expect(click).toHaveBeenCalled());
  });

  it("reçu d'un autre apprenant : 404 uniforme affiché, jamais le contenu", async () => {
    setTestApi(base({ [`GET /api/v1/finance/me/learners/${MARIAM}/receipts/${fid(81)}`]: () => json(NOT_FOUND, { status: 404 }) }));
    renderWithProviders(<ChildReceipt childId={MARIAM} id={fid(81)} />);
    expect(await screen.findByText("Ressource introuvable.")).toBeTruthy();
  });
});

describe("dossier de l'enfant et compte du parent", () => {
  it("contacts d'urgence : modification limitée aux champs changés", async () => {
    const contact = { id: fid(500), studentId: MARIAM, contactName: "Oncle Kofi", phone: "0101010101", phoneAlt: null, email: null, relationshipLabel: "Oncle", priority: 1 };
    const api = setTestApi(
      base({
        [`GET /api/v1/people/children/${MARIAM}`]: {
          student: { ...mariam, access: "FULL", otherNames: null, birthDate: "2014-05-01", birthPlace: null, nationality: null, email: null, phone: null, phoneAlt: null, addressLine: null, city: null, residence: null, firstEnrolledOn: null, leftOn: null, primaryGuardian: null, portalAccount: "NONE", externalRef: null, createdAt: "2026-09-01T08:00:00.000Z", updatedAt: "2026-09-01T08:00:00.000Z" },
          guardians: [],
          emergencyContacts: [contact],
        },
        [`GET /api/v1/academic/children/${MARIAM}/enrollments`]: { items: [] },
        [`PATCH /api/v1/people/children/${MARIAM}/emergency-contacts/${fid(500)}`]: { ...contact, phone: "0202020202" },
      }),
    );
    renderWithProviders(<ChildFile childId={MARIAM} />);
    expect(await screen.findByText("Oncle Kofi")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Modifier — Oncle Kofi/ }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText(/^Téléphone/), { target: { value: "0202020202" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Enregistrer" }));
    await waitFor(() => expect(api.calls.some((c) => c.method === "PATCH")).toBe(true));
    expect(api.calls.find((c) => c.method === "PATCH")!.body).toEqual({ phone: "0202020202" });
  });

  it("compte : coordonnées vides au départ, seuls les champs saisis sont envoyés", async () => {
    const api = setTestApi(base({ "PATCH /api/v1/people/me/guardian": { ok: true } }));
    renderWithProviders(<ParentAccount />);
    expect(await screen.findByText("Mme KONE")).toBeTruthy();
    expect(screen.getByText("parent@example.test")).toBeTruthy();
    fireEvent.click(await screen.findByRole("button", { name: "Enregistrer" }));
    expect(await screen.findByText("Aucune modification à enregistrer.")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Téléphone"), { target: { value: "0707070707" } });
    fireEvent.click(screen.getByRole("button", { name: "Enregistrer" }));
    expect(await screen.findByText("Coordonnées enregistrées.")).toBeTruthy();
    expect(api.calls.find((c) => c.method === "PATCH")!.body).toEqual({ phone: "0707070707" });
  });
});
