// @vitest-environment jsdom
import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { accessRoutes, setTestApi } from "@/platform/test/api-mock";
import { json, renderWithProviders } from "@/platform/test/render";
import { classroom, uuid, year } from "../../_test/fixtures";
import { enrollment, guardian, link, studentDetail, studentSummary } from "../../_test/fixtures-people";
import { ChildDetail, MyChildrenScreen } from "./MyChildren";
import { StudentCreateWizard } from "./StudentCreateWizard";
import { StudentDetail } from "./StudentDetail";
import { StudentsScreen } from "./StudentsScreen";

vi.mock("@/platform/api/default-client", async () => (await import("@/platform/test/api-mock")).defaultClientModule);
vi.mock("next/link", () => ({ default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a> }));

const base = {
  "GET /api/v1/academic/years": { items: [year({ id: uuid(100), label: "2026-2027" })] },
  "GET /api/v1/academic/classrooms": { items: [classroom()], total: 1, page: 1, pageSize: 200 },
};

describe("StudentsScreen", () => {
  beforeEach(() => vi.useFakeTimers({ shouldAdvanceTime: true }));
  afterEach(() => vi.useRealTimers());

  it("recherche temporisée : une requête serveur par pause de frappe, pagination par offset", async () => {
    const api = setTestApi({
      ...accessRoutes(["student.list", "student.create", "student.export"]),
      ...base,
      "GET /api/v1/people/students": ({ url }) => json({ items: [studentSummary({ displayName: `Résultat ${url.searchParams.get("q") ?? "tous"}`, currentEnrollment: { enrollmentId: uuid(1000), academicYearId: uuid(100), institutionId: uuid(1), classroomId: uuid(500), classroomName: "Licence 1 A", status: "ACTIVE", registrationNumber: "2026-0001" } })], total: 45, limit: 20, offset: Number(url.searchParams.get("offset") ?? 0) }),
    });
    renderWithProviders(<StudentsScreen />);
    expect(await screen.findByText("Résultat tous")).toBeTruthy();
    const search = screen.getByRole("searchbox", { name: /Rechercher un élève/ });
    fireEvent.change(search, { target: { value: "tra" } });
    fireEvent.change(search, { target: { value: "trao" } });
    // Aucune requête de recherche avant la fin de la temporisation.
    expect(api.calls.filter((c) => c.query.q)).toHaveLength(0);
    await act(async () => {
      vi.advanceTimersByTime(400);
    });
    expect(await screen.findByText("Résultat trao")).toBeTruthy();
    expect(api.calls.filter((c) => c.query.q)).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: /Suivant/ }));
    await waitFor(() => expect(api.calls.at(-1)!.query).toMatchObject({ q: "trao", offset: "20", limit: "20" }));
    expect(await screen.findByRole("button", { name: /Exporter/ })).toBeTruthy();
  });

  it("enseignant limité (student.class.read) : pas d'export ni de création", async () => {
    setTestApi({ ...accessRoutes(["student.class.read"]), ...base, "GET /api/v1/people/students": { items: [studentSummary()], total: 1, limit: 20, offset: 0 } });
    renderWithProviders(<StudentsScreen />);
    expect(await screen.findByText("TRAORE Awa")).toBeTruthy();
    await waitFor(() => expect(screen.queryByRole("button", { name: /Exporter/ })).toBeNull());
    expect(screen.queryByRole("link", { name: "Nouvel élève" })).toBeNull();
  });

  it("liste vide et erreur de l'API", async () => {
    setTestApi({ ...accessRoutes(["student.list"]), ...base, "GET /api/v1/people/students": { items: [], total: 0, limit: 20, offset: 0 } });
    const first = renderWithProviders(<StudentsScreen />);
    expect(await screen.findByText("Aucun élève pour le moment.")).toBeTruthy();
    first.unmount();
    setTestApi({ ...accessRoutes(["student.list"]), ...base, "GET /api/v1/people/students": () => json({ code: "FORBIDDEN", message: "Liste réservée." }, { status: 403 }) });
    renderWithProviders(<StudentsScreen />);
    expect((await screen.findByRole("alert")).textContent).toContain("Liste réservée.");
  });
});

const detailRoutes = (perms: string[], extra: Record<string, unknown> = {}) => ({
  ...accessRoutes(perms),
  [`GET /api/v1/people/students/${uuid(2000)}`]: studentDetail({ currentEnrollment: { enrollmentId: uuid(1000), academicYearId: uuid(100), institutionId: uuid(1), classroomId: uuid(500), classroomName: "Licence 1 A", status: "ACTIVE", registrationNumber: "2026-0001" } }),
  [`GET /api/v1/people/students/${uuid(2000)}/guardians`]: { items: [{ link: link(), guardian: guardian() }] },
  [`GET /api/v1/people/students/${uuid(2000)}/emergency-contacts`]: { items: [{ id: uuid(3300), studentId: uuid(2000), contactName: "Oncle Bamba", relationshipLabel: "Oncle", phone: "+2250500000000", phoneAlt: null, email: null, priority: 0 }] },
  "GET /api/v1/people/reference/relationship-types": { items: [{ id: uuid(970), code: "MOTHER", label: "Mère", kind: "GUARDIAN", sortOrder: 1, active: true }, { id: uuid(971), code: "UNCLE", label: "Oncle", kind: "OTHER", sortOrder: 2, active: true }] },
  ...extra,
});

describe("StudentDetail", () => {
  it("fiche complète : identité, état civil, champs sensibles masqués jusqu'à un clic explicite", async () => {
    const api = setTestApi(
      detailRoutes(["student.read", "guardian.read", "student.sensitive.read"], {
        [`GET /api/v1/people/students/${uuid(2000)}/sensitive`]: { studentId: uuid(2000), nationalStudentId: "CI-123456", birthCertificateNumber: "ACTE-77", birthCertificateDate: null, civilRegistryOffice: "Cocody", attributes: {} },
      }),
    );
    renderWithProviders(<StudentDetail id={uuid(2000)} />);
    expect(await screen.findByRole("heading", { level: 1, name: "TRAORE Awa" })).toBeTruthy();
    expect(screen.getAllByText("Abidjan", { selector: "dd" }).length).toBeGreaterThan(0);
    expect(screen.getByText("Féminin")).toBeTruthy();
    const reveal = await screen.findByRole("button", { name: "Afficher les informations sensibles" });
    expect(api.calls.some((c) => c.path.endsWith("/sensitive"))).toBe(false);
    fireEvent.click(reveal);
    expect(await screen.findByText("CI-123456")).toBeTruthy();
    expect(api.calls.filter((c) => c.path.endsWith("/sensitive"))).toHaveLength(1);
  });

  it("fiche réduite (enseignant) : pas d'onglets réservés ni de coordonnées complètes", async () => {
    setTestApi(detailRoutes(["student.class.read"], { [`GET /api/v1/people/students/${uuid(2000)}`]: studentDetail({ access: "CLASS", email: null, phone: null, addressLine: null, birthPlace: null }) }));
    renderWithProviders(<StudentDetail id={uuid(2000)} />);
    expect(await screen.findByText(/Fiche réduite/)).toBeTruthy();
    expect(screen.queryByRole("tab", { name: "Tuteurs" })).toBeNull();
    expect(screen.queryByRole("tab", { name: "Statut" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Afficher les informations sensibles" })).toBeNull();
  });

  it("liens vers la classe et le tuteur : texte simple sans la permission de la page cible (pas de /unauthorized)", async () => {
    const withLinks = { [`GET /api/v1/people/students/${uuid(2000)}`]: studentDetail({ currentEnrollment: { enrollmentId: uuid(1000), academicYearId: uuid(100), institutionId: uuid(1), classroomId: uuid(500), classroomName: "Licence 1 A", status: "ACTIVE", registrationNumber: "2026-0001" }, primaryGuardian: { guardianId: uuid(3000), displayName: "KONE Mariam", relationshipCode: "MOTHER", phone: null } as never }) };
    setTestApi(detailRoutes(["student.read"], withLinks));
    const first = renderWithProviders(<StudentDetail id={uuid(2000)} />);
    expect(await screen.findByText("Licence 1 A")).toBeTruthy();
    await waitFor(() => expect(screen.queryByRole("link", { name: "Licence 1 A" })).toBeNull());
    expect(screen.queryByRole("link", { name: "KONE Mariam" })).toBeNull();
    first.unmount();

    setTestApi(detailRoutes(["student.read", "academic.classroom.read", "guardian.read"], withLinks));
    renderWithProviders(<StudentDetail id={uuid(2000)} />);
    const classLink = await screen.findByRole("link", { name: "Licence 1 A" });
    expect(classLink.getAttribute("href")).toBe(`/v2/academic/classrooms/${uuid(500)}`);
    expect((await screen.findByRole("link", { name: "KONE Mariam" })).getAttribute("href")).toBe(`/v2/guardians/${uuid(3000)}`);
  });

  it("tuteurs : liste avec rôles, lier un tuteur existant (corps exact), clôturer un lien avec motif en paramètres", async () => {
    const api = setTestApi(
      detailRoutes(["student.read", "guardian.read", "guardian.manage"], {
        "GET /api/v1/people/guardians": { items: [guardian({ id: uuid(3001), displayName: "OUATTARA Fanta", personId: uuid(3101) })], total: 1, limit: 20, offset: 0 },
        [`POST /api/v1/people/students/${uuid(2000)}/guardians`]: () => json(link({ id: uuid(3201), guardianId: uuid(3001) }), { status: 201 }),
        [`DELETE /api/v1/people/students/${uuid(2000)}/guardians/${uuid(3200)}`]: link({ validTo: "2026-10-01" }),
      }),
    );
    renderWithProviders(<StudentDetail id={uuid(2000)} />);
    fireEvent.mouseDown(await screen.findByRole("tab", { name: "Tuteurs" }), { button: 0 });
    fireEvent.click(await screen.findByRole("tab", { name: "Tuteurs" }));
    const table = await screen.findByRole("table", { name: "Tuteurs de l'élève" });
    expect(await within(table).findByText("KONE Mariam")).toBeTruthy();
    expect(within(table).getByText("Principal")).toBeTruthy();
    // Les types de lien « non tuteur » (oncle = contact) ne sont pas proposés pour une tutelle.
    fireEvent.click(await screen.findByRole("button", { name: "Lier un tuteur" }));
    const dialog = await screen.findByRole("dialog");
    const input = within(dialog).getByRole("combobox", { name: /^Tuteur/ });
    fireEvent.focus(input);
    fireEvent.click(await within(dialog).findByRole("option", { name: /OUATTARA Fanta/ }));
    await waitFor(() => expect(within(within(dialog).getByLabelText(/Lien de parenté/)).getAllByRole("option").map((o) => o.textContent)).toEqual(["Choisir…", "Mère"]));
    fireEvent.change(within(dialog).getByLabelText(/Lien de parenté/), { target: { value: "MOTHER" } });
    fireEvent.click(within(dialog).getByRole("checkbox", { name: /Autorité légale/ }));
    fireEvent.click(within(dialog).getByRole("button", { name: "Lier un tuteur" }));
    await screen.findByText("Le tuteur est lié.");
    expect(api.calls.find((c) => c.method === "POST")!.body).toEqual({ guardianId: uuid(3001), relationshipCode: "MOTHER", isPrimaryContact: false, isEmergencyContact: false, isFinancialResponsible: false, hasLegalCustody: true, canPickup: false, portalAccess: true });

    fireEvent.click(within(table).getByRole("button", { name: /Clôturer le lien — KONE Mariam/ }));
    const reasonDialog = await screen.findByRole("dialog");
    fireEvent.change(within(reasonDialog).getByLabelText(/Motif/), { target: { value: "Déchéance de l'autorité" } });
    fireEvent.click(within(reasonDialog).getByRole("button", { name: "Clôturer le lien" }));
    await screen.findByText("Le lien est clos.");
    expect(api.calls.find((c) => c.method === "DELETE")!.query).toEqual({ reason: "Déchéance de l'autorité" });
  });

  it("changement de statut : motif transmis et confirmation", async () => {
    const api = setTestApi(detailRoutes(["student.read", "student.status.update"], { [`POST /api/v1/people/students/${uuid(2000)}/status`]: studentDetail({ status: "WITHDRAWN" }) }));
    renderWithProviders(<StudentDetail id={uuid(2000)} />);
    fireEvent.click(await screen.findByRole("button", { name: "Changer le statut" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText(/Nouveau statut/), { target: { value: "WITHDRAWN" } });
    fireEvent.change(within(dialog).getByLabelText(/Motif/), { target: { value: "Départ à l'étranger" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Changer le statut" }));
    await screen.findByText("Le statut a été modifié.");
    expect(api.calls.find((c) => c.method === "POST")!.body).toEqual({ status: "WITHDRAWN", reasonText: "Départ à l'étranger" });
  });

  it("modification : n'envoie que les champs changés dans person (vidé = null)", async () => {
    const api = setTestApi(detailRoutes(["student.read", "student.update"], { [`PATCH /api/v1/people/students/${uuid(2000)}`]: studentDetail({ city: "Bouaké" }) }));
    renderWithProviders(<StudentDetail id={uuid(2000)} />);
    fireEvent.click(await screen.findByRole("button", { name: "Modifier" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText(/^Ville/), { target: { value: "Bouaké" } });
    fireEvent.change(within(dialog).getByLabelText(/^Lieu de naissance/), { target: { value: "" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Enregistrer" }));
    await screen.findByText("La fiche a été mise à jour.");
    expect(api.calls.find((c) => c.method === "PATCH")!.body).toEqual({ person: { city: "Bouaké", birthPlace: null } });
  });

  it("parcours scolaire : inscriptions liées à leur fiche", async () => {
    setTestApi(
      detailRoutes(["student.read"], {
        [`GET /api/v1/people/students/${uuid(2000)}/enrollments`]: { items: [{ enrollmentId: uuid(1000), academicYearId: uuid(100), institutionId: uuid(1), classroomId: uuid(500), classroomName: "Licence 1 A", programLabel: "Licence Informatique", gradeLevelLabel: "Licence 1", mode: "CLASS", status: "ACTIVE", fundingType: "PRIVATE", registrationNumber: "2026-0001", enrolledOn: "2026-09-05" }] },
        [`GET /api/v1/people/students/${uuid(2000)}/prior-education`]: { items: [] },
      }),
    );
    renderWithProviders(<StudentDetail id={uuid(2000)} />);
    fireEvent.mouseDown(await screen.findByRole("tab", { name: "Parcours scolaire" }), { button: 0 });
    const table = await screen.findByRole("table", { name: "Inscriptions de l'élève" });
    expect(await within(table).findByText("Licence Informatique — Licence 1")).toBeTruthy();
    expect(within(table).getByRole("link", { name: "Ouvrir" }).getAttribute("href")).toBe(`/v2/enrollments/${uuid(1000)}`);
  });
});

describe("StudentCreateWizard", () => {
  it("crée l'élève puis lie le tuteur existant ; le matricule attribué est affiché", async () => {
    const api = setTestApi({
      ...accessRoutes(["student.create", "guardian.manage"]),
      "GET /api/v1/people/reference/relationship-types": { items: [{ id: uuid(970), code: "MOTHER", label: "Mère", kind: "GUARDIAN", sortOrder: 1, active: true }] },
      "GET /api/v1/people/guardians": { items: [guardian()], total: 1, limit: 20, offset: 0 },
      "POST /api/v1/people/students": ({ body }) => ((body as { validateOnly?: boolean }).validateOnly ? json({ valid: true, duplicates: [] }) : json({ student: studentDetail({ studentNumber: "EL-0099" }), replayed: false }, { status: 201 })),
      [`POST /api/v1/people/students/${uuid(2000)}/guardians`]: () => json(link(), { status: 201 }),
    });
    renderWithProviders(<StudentCreateWizard />);
    fireEvent.change(await screen.findByLabelText(/^Nom/), { target: { value: "TRAORE" } });
    fireEvent.change(screen.getByLabelText(/^Prénoms/), { target: { value: "Awa" } });
    fireEvent.change(screen.getByLabelText(/^Sexe/), { target: { value: "F" } });
    fireEvent.click(screen.getByRole("button", { name: "Suivant" }));
    await screen.findByRole("heading", { level: 2, name: "Tuteurs" });
    fireEvent.click(screen.getByRole("button", { name: "Ajouter un tuteur existant" }));
    const input = await screen.findByRole("combobox", { name: /^Tuteur/ });
    fireEvent.focus(input);
    fireEvent.click(await screen.findByRole("option", { name: /KONE Mariam/ }));
    await waitFor(() => expect(within(screen.getByLabelText(/Lien de parenté/)).getAllByRole("option")).toHaveLength(2));
    fireEvent.change(screen.getByLabelText(/Lien de parenté/), { target: { value: "MOTHER" } });
    fireEvent.click(screen.getByRole("button", { name: "Suivant" }));
    await screen.findByRole("heading", { level: 2, name: "Récapitulatif" });
    fireEvent.click(screen.getByRole("button", { name: "Créer le dossier" }));
    await screen.findByText(/matricule EL-0099/);
    const posts = api.calls.filter((c) => c.method === "POST");
    expect(posts.map((p) => p.path)).toEqual(["/api/v1/people/students", "/api/v1/people/students", `/api/v1/people/students/${uuid(2000)}/guardians`]);
    expect(posts[2]!.body).toMatchObject({ guardianId: uuid(3000), relationshipCode: "MOTHER", isPrimaryContact: true, hasLegalCustody: false, canPickup: false });
  });

  it("identité incomplète : erreurs de champ du contrat, aucun appel", async () => {
    const api = setTestApi({ ...accessRoutes(["student.create"]) });
    renderWithProviders(<StudentCreateWizard />);
    fireEvent.click(await screen.findByRole("button", { name: "Suivant" }));
    await waitFor(() => expect(screen.getAllByRole("alert").length).toBeGreaterThan(0));
    expect(api.calls.filter((c) => c.method === "POST")).toHaveLength(0);
    expect(screen.getByRole("heading", { level: 2, name: "Identité" })).toBeTruthy();
  });
});

describe("Mes enfants (parent)", () => {
  it("liste uniquement ce que l'API renvoie pour ce compte", async () => {
    setTestApi({ ...accessRoutes(["student.child.read"]), "GET /api/v1/people/children": { items: [studentSummary({ displayName: "TRAORE Awa", currentEnrollment: { enrollmentId: uuid(1000), academicYearId: uuid(100), institutionId: uuid(1), classroomId: uuid(500), classroomName: "6e A", status: "ACTIVE", registrationNumber: "2026-0001" } })] } });
    renderWithProviders(<MyChildrenScreen />);
    const list = await screen.findByRole("list", { name: "Mes enfants" });
    expect(within(list).getAllByRole("listitem")).toHaveLength(1);
    expect(within(list).getByRole("link", { name: "TRAORE Awa" }).getAttribute("href")).toBe(`/v2/students/children/${uuid(2000)}`);
    expect(within(list).getByText("6e A")).toBeTruthy();
  });

  it("aucun enfant rattaché : message explicite", async () => {
    setTestApi({ ...accessRoutes(["student.child.read"]), "GET /api/v1/people/children": { items: [] } });
    renderWithProviders(<MyChildrenScreen />);
    expect(await screen.findByText("Aucun enfant n'est rattaché à votre compte.")).toBeTruthy();
  });

  it("enfant d'un autre parent : 404 de l'API affiché tel quel, aucune donnée", async () => {
    setTestApi({ ...accessRoutes(["student.child.read"]), [`GET /api/v1/people/children/${uuid(2000)}`]: () => json({ code: "people.student_not_found", message: "Élève introuvable." }, { status: 404 }) });
    renderWithProviders(<ChildDetail id={uuid(2000)} />);
    expect((await screen.findByRole("alert")).textContent).toContain("Élève introuvable.");
  });

  it("fiche enfant : coordonnées d'urgence corrigeables (PATCH limité aux champs changés)", async () => {
    const contact = { id: uuid(3300), studentId: uuid(2000), contactName: "Oncle Bamba", relationshipLabel: "Oncle", phone: "+2250500000000", phoneAlt: null, email: null, priority: 0 };
    const api = setTestApi({
      ...accessRoutes(["student.child.read", "student.child.update"]),
      [`GET /api/v1/people/children/${uuid(2000)}`]: { student: studentDetail({ access: "GUARDIAN" }), guardians: [{ guardianId: uuid(3000), displayName: "KONE Mariam", relationshipCode: "MOTHER", isPrimaryContact: true }], emergencyContacts: [contact] },
      [`GET /api/v1/academic/children/${uuid(2000)}/enrollments`]: { items: [enrollment()] },
      [`PATCH /api/v1/people/children/${uuid(2000)}/emergency-contacts/${uuid(3300)}`]: { ...contact, phone: "+2250500000001" },
    });
    renderWithProviders(<ChildDetail id={uuid(2000)} />);
    fireEvent.click(await screen.findByRole("button", { name: /Corriger — Oncle Bamba/ }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText(/^Téléphone/), { target: { value: "+2250500000001" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Enregistrer" }));
    await screen.findByText("Les coordonnées ont été mises à jour.");
    expect(api.calls.find((c) => c.method === "PATCH")!.body).toEqual({ phone: "+2250500000001" });
    expect(await screen.findByText("2026-0001")).toBeTruthy();
  });
});
