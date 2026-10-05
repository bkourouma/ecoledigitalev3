// @vitest-environment jsdom
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { accessRoutes, setTestApi } from "@/platform/test/api-mock";
import { json, renderWithProviders } from "@/platform/test/render";
import { classroom, uuid, year } from "../../_test/fixtures";
import { enrollment, fundingTypes, studentDetail, studentSummary } from "../../_test/fixtures-people";
import { EnrollmentDetail } from "./EnrollmentDetail";
import { EnrollmentWizard } from "./EnrollmentWizard";
import { EnrollmentsScreen } from "./EnrollmentsScreen";

vi.mock("@/platform/api/default-client", async () => (await import("@/platform/test/api-mock")).defaultClientModule);
vi.mock("next/link", () => ({ default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a> }));

const common = {
  "GET /api/v1/academic/years": { items: [year({ id: uuid(100), label: "2026-2027", isCurrent: true })] },
  [`GET /api/v1/people/students/${uuid(2000)}`]: studentDetail(),
  [`GET /api/v1/academic/classrooms/${uuid(500)}`]: classroom(),
};

describe("EnrollmentsScreen", () => {
  it("liste paginée et filtrable côté serveur, noms résolus par fiche", async () => {
    const api = setTestApi({
      ...accessRoutes(["enrollment.read", "enrollment.create"]),
      ...common,
      "GET /api/v1/academic/enrollments": ({ url }) => json({ items: [enrollment()], total: 1, page: Number(url.searchParams.get("page")), pageSize: 20 }),
    });
    renderWithProviders(<EnrollmentsScreen />);
    const table = await screen.findByRole("table", { name: "Liste des inscriptions" });
    expect(await within(table).findByText("TRAORE Awa")).toBeTruthy();
    expect(within(table).getByText("2026-0001")).toBeTruthy();
    expect(within(table).getByText("Active")).toBeTruthy();
    expect(within(table).getByText("Privé")).toBeTruthy();

    fireEvent.change(screen.getByLabelText("Statut"), { target: { value: "PENDING" } });
    fireEvent.change(screen.getByLabelText("Financement"), { target: { value: "STATE_ASSIGNED" } });
    await waitFor(() => expect(api.calls.filter((c) => c.path === "/api/v1/academic/enrollments").at(-1)!.query).toMatchObject({ status: "PENDING", fundingType: "STATE_ASSIGNED", page: "1" }));
    expect(await screen.findByRole("link", { name: /Nouvelle inscription/ })).toBeTruthy();
  });

  it("aucun résultat : état vide", async () => {
    setTestApi({ ...accessRoutes(["enrollment.read"]), ...common, "GET /api/v1/academic/enrollments": { items: [], total: 0, page: 1, pageSize: 20 } });
    renderWithProviders(<EnrollmentsScreen />);
    expect(await screen.findByText("Aucune inscription ne correspond.")).toBeTruthy();
  });
});

const wizardRoutes = (extra: Record<string, unknown> = {}) => ({
  ...accessRoutes(["enrollment.create", "student.create", "student.list"], ["academic.state-assigned"]),
  ...common,
  "GET /api/v1/academic/reference/funding-types": { items: fundingTypes },
  "GET /api/v1/academic/classrooms": { items: [classroom()], total: 1, page: 1, pageSize: 200 },
  "GET /api/v1/academic/enrollments": { items: [], total: 0, page: 1, pageSize: 20 },
  "GET /api/v1/people/students": { items: [studentSummary()], total: 1, limit: 20, offset: 0 },
  ...extra,
});

async function chooseExistingStudent() {
  const input = await screen.findByRole("combobox", { name: /^Élève/ });
  fireEvent.focus(input);
  fireEvent.click(await screen.findByRole("option", { name: /TRAORE Awa/ }));
}

async function chooseClassroom() {
  const input = screen.getByRole("combobox", { name: /Classe/ });
  fireEvent.focus(input);
  fireEvent.click(await screen.findByRole("option", { name: /Licence 1 A/ }));
}

describe("EnrollmentWizard", () => {
  it("élève existant, classe, financement privé : envoie le corps exact et affiche le numéro d'inscription", async () => {
    const api = setTestApi(wizardRoutes({ "POST /api/v1/academic/enrollments": () => json(enrollment({ status: "PENDING", registrationNumber: "2026-0042" }), { status: 201 }) }));
    renderWithProviders(<EnrollmentWizard />);
    await chooseExistingStudent();
    fireEvent.click(screen.getByRole("button", { name: "Suivant" }));
    await screen.findByRole("heading", { level: 2, name: "Classe" });
    await chooseClassroom();
    // Capacité indicative affichée d'après la classe choisie.
    expect(await screen.findByText(/Effectif : 12 sur 40/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Suivant" }));
    await screen.findByRole("heading", { level: 2, name: "Financement" });
    fireEvent.click(screen.getByRole("button", { name: "Suivant" }));
    await screen.findByRole("heading", { level: 2, name: "Récapitulatif" });
    fireEvent.click(screen.getByRole("button", { name: "Inscrire" }));
    await screen.findByText(/N° d'inscription : 2026-0042/);
    expect(screen.getByText(/en attente de confirmation/)).toBeTruthy();
    expect(api.calls.find((c) => c.method === "POST")!.body).toEqual({ studentId: uuid(2000), classroomId: uuid(500), mode: "CLASS", fundingType: "PRIVATE" });
  });

  it("financement affecté par l'État : la référence d'affectation est exigée (donnée du type de financement)", async () => {
    const api = setTestApi(wizardRoutes({ "POST /api/v1/academic/enrollments": () => json(enrollment({ fundingType: "STATE_ASSIGNED", assignmentReference: "AFF-2026-77" }), { status: 201 }) }));
    renderWithProviders(<EnrollmentWizard initialStudentId={uuid(2000)} initialClassroomId={uuid(500)} />);
    fireEvent.click(await screen.findByRole("button", { name: "Suivant" }));
    await screen.findByRole("heading", { level: 2, name: "Classe" });
    fireEvent.click(screen.getByRole("button", { name: "Suivant" }));
    await screen.findByRole("heading", { level: 2, name: "Financement" });
    await waitFor(() => expect(within(screen.getByLabelText(/Type de financement/)).getAllByRole("option")).toHaveLength(3));
    fireEvent.change(screen.getByLabelText(/Type de financement/), { target: { value: "STATE_ASSIGNED" } });
    fireEvent.click(screen.getByRole("button", { name: "Suivant" }));
    await waitFor(() => expect(screen.getByText("La référence d'affectation est obligatoire pour ce financement.")).toBeTruthy());
    expect(screen.getByRole("heading", { level: 2, name: "Financement" })).toBeTruthy();
    fireEvent.change(screen.getByLabelText(/Référence d'affectation/), { target: { value: "AFF-2026-77" } });
    fireEvent.click(screen.getByRole("button", { name: "Suivant" }));
    await screen.findByRole("heading", { level: 2, name: "Récapitulatif" });
    fireEvent.click(screen.getByRole("button", { name: "Inscrire" }));
    await screen.findByText(/Inscription enregistrée/);
    expect(api.calls.find((c) => c.method === "POST")!.body).toMatchObject({ fundingType: "STATE_ASSIGNED", assignmentReference: "AFF-2026-77" });
  });

  it("sans la fonctionnalité de l'offre, l'affectation par l'État n'est pas proposée", async () => {
    setTestApi(wizardRoutes({ ...accessRoutes(["enrollment.create"], []) }));
    renderWithProviders(<EnrollmentWizard initialStudentId={uuid(2000)} initialClassroomId={uuid(500)} />);
    fireEvent.click(await screen.findByRole("button", { name: "Suivant" }));
    await screen.findByRole("heading", { level: 2, name: "Classe" });
    fireEvent.click(screen.getByRole("button", { name: "Suivant" }));
    await screen.findByRole("heading", { level: 2, name: "Financement" });
    await waitFor(() => expect(within(screen.getByLabelText(/Type de financement/)).getAllByRole("option").map((o) => o.textContent)).toEqual(["Privé", "Bourse"]));
  });

  it("nouvel élève : avertissement de doublon bloquant jusqu'à confirmation motivée, puis création de l'élève avant l'inscription", async () => {
    const duplicate = { personId: uuid(2100), displayName: "TRAORE Awa", birthDate: "2012-03-14", match: "EXACT", roles: ["STUDENT"], studentId: uuid(2000), studentNumber: "EL-0001" };
    const api = setTestApi(
      wizardRoutes({
        "POST /api/v1/people/students": ({ body }) => {
          const b = body as { validateOnly?: boolean };
          if (b.validateOnly) return json({ valid: true, duplicates: [duplicate] });
          return json({ student: studentDetail({ id: uuid(2001), displayName: "TRAORE Awa" }), replayed: false }, { status: 201 });
        },
        "POST /api/v1/academic/enrollments": () => json(enrollment({ studentId: uuid(2001) }), { status: 201 }),
      }),
    );
    renderWithProviders(<EnrollmentWizard initialClassroomId={uuid(500)} />);
    fireEvent.click(await screen.findByRole("radio", { name: "Nouvel élève" }));
    fireEvent.change(screen.getByLabelText(/^Nom/), { target: { value: "TRAORE" } });
    fireEvent.change(screen.getByLabelText(/^Prénoms/), { target: { value: "Awa" } });
    fireEvent.change(screen.getByLabelText(/^Sexe/), { target: { value: "F" } });
    fireEvent.change(screen.getByLabelText(/^Date de naissance/), { target: { value: "2012-03-14" } });
    fireEvent.click(screen.getByRole("button", { name: "Suivant" }));
    const warning = await screen.findByRole("region", { name: /ressemble/ });
    expect(within(warning).getByText("Même nom et même date")).toBeTruthy();
    // Toujours à l'étape 1 tant que le doublon n'est pas confirmé.
    expect(screen.getByRole("heading", { level: 2, name: "Élève" })).toBeTruthy();
    fireEvent.click(within(warning).getByRole("checkbox", { name: /créer quand même/ }));
    fireEvent.change(within(warning).getByLabelText(/Motif de la création/), { target: { value: "Homonyme, famille différente" } });
    fireEvent.click(screen.getByRole("button", { name: "Suivant" }));
    await screen.findByRole("heading", { level: 2, name: "Classe" });
    fireEvent.click(screen.getByRole("button", { name: "Suivant" }));
    await screen.findByRole("heading", { level: 2, name: "Financement" });
    fireEvent.click(screen.getByRole("button", { name: "Suivant" }));
    await screen.findByRole("heading", { level: 2, name: "Récapitulatif" });
    fireEvent.click(screen.getByRole("button", { name: "Inscrire" }));
    await screen.findByText(/Inscription enregistrée/);
    const posts = api.calls.filter((c) => c.method === "POST");
    expect(posts.map((p) => p.path)).toEqual(["/api/v1/people/students", "/api/v1/people/students", "/api/v1/academic/enrollments"]);
    expect(posts[1]!.body).toMatchObject({ person: { lastName: "TRAORE", firstName: "Awa", sex: "F", birthDate: "2012-03-14" }, acknowledgeDuplicate: true, duplicateReason: "Homonyme, famille différente" });
    expect(posts[2]!.body).toMatchObject({ studentId: uuid(2001), classroomId: uuid(500) });
  });

  it("nouvel élève sans sexe : refusé localement par le contrat (aucun appel)", async () => {
    const api = setTestApi(wizardRoutes());
    renderWithProviders(<EnrollmentWizard />);
    fireEvent.click(await screen.findByRole("radio", { name: "Nouvel élève" }));
    fireEvent.change(screen.getByLabelText(/^Nom/), { target: { value: "TRAORE" } });
    fireEvent.change(screen.getByLabelText(/^Prénoms/), { target: { value: "Awa" } });
    fireEvent.click(screen.getByRole("button", { name: "Suivant" }));
    await waitFor(() => expect(screen.getByText("Le sexe est obligatoire pour un élève.")).toBeTruthy());
    expect(api.calls.filter((c) => c.method === "POST")).toHaveLength(0);
  });

  it("erreur métier de l'API (classe complète) : message du serveur, l'assistant reste utilisable", async () => {
    setTestApi(wizardRoutes({ "POST /api/v1/academic/enrollments": () => json({ code: "academic.classroom_full", message: "La classe est complète." }, { status: 409 }) }));
    renderWithProviders(<EnrollmentWizard initialStudentId={uuid(2000)} initialClassroomId={uuid(500)} />);
    for (const heading of ["Classe", "Financement", "Récapitulatif"]) {
      fireEvent.click(await screen.findByRole("button", { name: "Suivant" }));
      await screen.findByRole("heading", { level: 2, name: heading });
    }
    fireEvent.click(screen.getByRole("button", { name: "Inscrire" }));
    expect((await screen.findByRole("alert")).textContent).toContain("La classe est complète.");
    expect(screen.getByRole("button", { name: "Inscrire" })).toBeTruthy();
  });
});

const detailRoutes = (status: string, extra: Record<string, unknown> = {}) => ({
  ...accessRoutes(["enrollment.read", "enrollment.update", "enrollment.funding.update", "enrollment.course.manage"]),
  ...common,
  [`GET /api/v1/academic/enrollments/${uuid(1000)}`]: { enrollment: enrollment({ status }), courses: [], placements: [{ id: uuid(1100), enrollmentId: uuid(1000), classroomId: uuid(500), startsOn: "2026-09-05", endsOn: null, reason: null }] },
  [`GET /api/v1/academic/enrollments/${uuid(1000)}/history`]: { items: [{ id: uuid(1200), enrollmentId: uuid(1000), kind: "CREATED", fromValue: null, toValue: "PENDING", reason: null, actorId: null, occurredAt: "2026-09-05T08:00:00.000Z" }] },
  [`GET /api/v1/academic/institutions/${uuid(1)}/settings`]: { institutionId: uuid(1), enrollmentConfirmationPolicy: "ON_REGISTRATION_FEE_PAID", courseConfirmationPolicy: "AUTO", pendingHoldMinutes: null, registrationNumberPrefix: null, registrationNumberPattern: null },
  ...extra,
});

describe("EnrollmentDetail", () => {
  const settingsRoute = (policy: string) => ({
    [`GET /api/v1/academic/institutions/${uuid(1)}/settings`]: { institutionId: uuid(1), enrollmentConfirmationPolicy: policy, courseConfirmationPolicy: "AUTO", pendingHoldMinutes: null, registrationNumberPrefix: null, registrationNumberPattern: null },
  });

  it("en attente sous une politique liée au paiement : pas de confirmation directe sans la permission de dérogation", async () => {
    setTestApi(detailRoutes("PENDING"));
    renderWithProviders(<EnrollmentDetail id={uuid(1000)} />);
    expect(await screen.findByRole("heading", { level: 1, name: "Inscription 2026-0001" })).toBeTruthy();
    expect(await screen.findByText(/confirmée au paiement des frais d'inscription/)).toBeTruthy();
    expect(screen.getByText(/attend sa confirmation/)).toBeTruthy();
    await screen.findByText(/confirmée automatiquement au paiement/);
    expect(screen.getByRole("button", { name: "Annuler" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Confirmer" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Confirmer sans paiement" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Suspendre" })).toBeNull();
    expect(await screen.findByText("Création")).toBeTruthy();
    expect(await screen.findByRole("table", { name: "Placements de l'élève dans les classes" })).toBeTruthy();
  });

  it("O-01 dérogation : la direction confirme sans paiement avec un motif obligatoire (5 caractères), envoyé à l'API", async () => {
    const api = setTestApi(
      detailRoutes("PENDING", {
        ...accessRoutes(["enrollment.read", "enrollment.update", "enrollment.confirm.override"]),
        [`POST /api/v1/academic/enrollments/${uuid(1000)}/confirm`]: enrollment({ status: "ACTIVE", confirmationMode: "OVERRIDE", confirmationReason: "Échéancier accepté" }),
      }),
    );
    renderWithProviders(<EnrollmentDetail id={uuid(1000)} />);
    fireEvent.click(await screen.findByRole("button", { name: "Confirmer sans paiement" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText(/dérogation de la direction/)).toBeTruthy();
    fireEvent.change(within(dialog).getByLabelText(/Motif/), { target: { value: "ab" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Confirmer sans paiement" }));
    expect(api.calls.filter((c) => c.method === "POST")).toHaveLength(0);
    fireEvent.change(within(dialog).getByLabelText(/Motif/), { target: { value: "Échéancier accepté par la direction" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Confirmer sans paiement" }));
    await screen.findByText("L'inscription est confirmée par dérogation.");
    expect(api.calls.find((c) => c.method === "POST")!.body).toEqual({ reason: "Échéancier accepté par la direction" });
  });

  it("O-01 : une inscription confirmée par dérogation affiche son mode et le motif au personnel", async () => {
    setTestApi(detailRoutes("ACTIVE", { [`GET /api/v1/academic/enrollments/${uuid(1000)}`]: { enrollment: enrollment({ status: "ACTIVE", confirmedAt: "2026-09-06T08:00:00.000Z", confirmationMode: "OVERRIDE", confirmationReason: "Échéancier accepté par la direction" }), courses: [], placements: [] } }));
    renderWithProviders(<EnrollmentDetail id={uuid(1000)} />);
    expect(await screen.findByText(/Mode de confirmation : dérogation de la direction/)).toBeTruthy();
    expect(screen.getByText(/Motif de la dérogation : Échéancier accepté par la direction/)).toBeTruthy();
  });

  it("politique manuelle : confirmer envoie POST /confirm sans motif (confirmation ordinaire)", async () => {
    const api = setTestApi(detailRoutes("PENDING", { ...settingsRoute("MANUAL"), [`POST /api/v1/academic/enrollments/${uuid(1000)}/confirm`]: enrollment({ status: "ACTIVE" }) }));
    renderWithProviders(<EnrollmentDetail id={uuid(1000)} />);
    fireEvent.click(await screen.findByRole("button", { name: "Confirmer" }));
    await screen.findByText("L'inscription est confirmée.");
    expect(api.calls.find((c) => c.method === "POST")!.body).toEqual({});
  });

  it("retrait : motif obligatoire (5 caractères) puis envoi du motif", async () => {
    const api = setTestApi(detailRoutes("ACTIVE", { [`POST /api/v1/academic/enrollments/${uuid(1000)}/withdraw`]: enrollment({ status: "WITHDRAWN" }) }));
    renderWithProviders(<EnrollmentDetail id={uuid(1000)} />);
    fireEvent.click(await screen.findByRole("button", { name: "Retirer l'élève" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText(/Motif/), { target: { value: "ab" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Retirer l'élève" }));
    expect(api.calls.filter((c) => c.method === "POST")).toHaveLength(0);
    fireEvent.change(within(dialog).getByLabelText(/Motif/), { target: { value: "Déménagement de la famille" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Retirer l'élève" }));
    await screen.findByText("L'élève est retiré.");
    expect(api.calls.find((c) => c.method === "POST")!.body).toEqual({ reason: "Déménagement de la famille" });
  });

  it("transfert : classe de destination et motif, envoyés à l'API", async () => {
    const other = classroom({ id: uuid(501), name: "Licence 1 B", code: "L1-B" });
    const api = setTestApi(
      detailRoutes("ACTIVE", {
        "GET /api/v1/academic/classrooms": { items: [classroom(), other], total: 2, page: 1, pageSize: 200 },
        [`POST /api/v1/academic/enrollments/${uuid(1000)}/transfer`]: enrollment({ classroomId: uuid(501) }),
      }),
    );
    renderWithProviders(<EnrollmentDetail id={uuid(1000)} />);
    fireEvent.click(await screen.findByRole("button", { name: "Transférer" }));
    const dialog = await screen.findByRole("dialog");
    const input = within(dialog).getByRole("combobox");
    fireEvent.focus(input);
    fireEvent.click(await within(dialog).findByRole("option", { name: /Licence 1 B/ }));
    fireEvent.change(within(dialog).getByLabelText(/Motif/), { target: { value: "Changement de groupe de TD" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Transférer" }));
    await screen.findByText("L'élève est transféré.");
    expect(api.calls.find((c) => c.method === "POST")!.body).toEqual({ toClassroomId: uuid(501), reason: "Changement de groupe de TD" });
  });

  it("sans droit de modification : aucune action d'état", async () => {
    setTestApi({ ...detailRoutes("ACTIVE"), ...accessRoutes(["enrollment.read"]) });
    renderWithProviders(<EnrollmentDetail id={uuid(1000)} />);
    await screen.findByRole("heading", { level: 1, name: "Inscription 2026-0001" });
    await waitFor(() => expect(screen.queryByRole("button", { name: "Suspendre" })).toBeNull());
    expect(screen.queryByRole("button", { name: "Changer le financement" })).toBeNull();
  });

  it("introuvable : message de l'API", async () => {
    setTestApi({ ...accessRoutes(["enrollment.read"]), [`GET /api/v1/academic/enrollments/${uuid(1000)}`]: () => json({ code: "academic.enrollment_not_found", message: "Inscription introuvable." }, { status: 404 }) });
    renderWithProviders(<EnrollmentDetail id={uuid(1000)} />);
    expect((await screen.findByRole("alert")).textContent).toContain("Inscription introuvable.");
  });
});
