// @vitest-environment jsdom
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { accessRoutes, setTestApi } from "@/platform/test/api-mock";
import { json, renderWithProviders } from "@/platform/test/render";
import { classroom, gradeLevels, uuid, year } from "../../_test/fixtures";
import { assignment, staffSummary } from "../../_test/fixtures-people";
import { AssignmentsScreen } from "./AssignmentsScreen";
import { StaffCreate } from "./StaffCreate";
import { StaffDetail } from "./StaffDetail";
import { StaffScreen } from "./StaffScreen";

vi.mock("@/platform/api/default-client", async () => (await import("@/platform/test/api-mock")).defaultClientModule);
vi.mock("next/link", () => ({ default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a> }));

const categories = { items: [{ id: uuid(980), code: "TEACHER", label: "Enseignant", canTeach: true, canSupervise: false, sortOrder: 1, active: true }, { id: uuid(981), code: "ADMIN", label: "Administratif", canTeach: false, canSupervise: false, sortOrder: 2, active: true }] };
const baseYears = { "GET /api/v1/academic/years": { items: [year({ id: uuid(100), label: "2026-2027", isCurrent: true })] } };

describe("StaffScreen", () => {
  it("liste avec catégories résolues, filtres et tri serveur par charge (année requise)", async () => {
    const api = setTestApi({
      ...accessRoutes(["staff.read"]),
      ...baseYears,
      "GET /api/v1/people/reference/staff-categories": categories,
      "GET /api/v1/people/staff/expiring-qualifications": { items: [{ qualificationId: uuid(6000), staffId: uuid(4000), label: "Habilitation secourisme", expiresOn: "2026-10-15", daysLeft: 14 }] },
      "GET /api/v1/people/staff": ({ url }) => json({ items: [staffSummary({ plannedHours: url.searchParams.get("sort") === "load" ? 48 : null })], total: 1, limit: 20, offset: 0 }),
    });
    renderWithProviders(<StaffScreen />);
    const table = await screen.findByRole("table", { name: "Liste du personnel" });
    expect(await within(table).findByText("DIALLO Issa")).toBeTruthy();
    expect(within(table).getByText("Enseignant")).toBeTruthy();
    // Alerte d'expiration fournie par l'API.
    expect(await screen.findByText(/1 qualification arrive à échéance/)).toBeTruthy();
    expect(screen.getByText("Dans 14 jours")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /Trier par Charge prévue/ }));
    await waitFor(() => expect(api.calls.filter((c) => c.path === "/api/v1/people/staff").at(-1)!.query.sort).toBe("load"));
    expect(await within(table).findByText("48 h")).toBeTruthy();
    expect(table.querySelector('th[aria-sort="ascending"]')?.textContent).toContain("Charge prévue");

    fireEvent.change(screen.getByLabelText("Enseigne"), { target: { value: "yes" } });
    await waitFor(() => expect(api.calls.filter((c) => c.path === "/api/v1/people/staff").at(-1)!.query.canTeach).toBe("true"));
  });

  it("sans droit de création : pas de bouton « Nouveau membre »", async () => {
    setTestApi({ ...accessRoutes(["staff.read"]), ...baseYears, "GET /api/v1/people/reference/staff-categories": categories, "GET /api/v1/people/staff": { items: [], total: 0, limit: 20, offset: 0 } });
    renderWithProviders(<StaffScreen />);
    expect(await screen.findByText("Aucun membre du personnel.")).toBeTruthy();
    expect(screen.queryByRole("link", { name: "Nouveau membre" })).toBeNull();
  });
});

describe("StaffCreate", () => {
  it("catégorie obligatoire (contrat), puis création et lien vers la fiche", async () => {
    const api = setTestApi({
      ...accessRoutes(["staff.create"]),
      "GET /api/v1/people/reference/staff-categories": categories,
      "POST /api/v1/people/staff": () => json({ staff: { ...staffSummary(), otherNames: null, sex: "M", email: null, phone: null, phoneAlt: null, addressLine: null, city: null, hiredOn: null, leftOn: null, primaryCampusId: null, affiliations: [], portalAccount: "NONE", externalRef: null, createdAt: "2026-09-01T08:00:00.000Z", updatedAt: "2026-09-01T08:00:00.000Z" }, replayed: false }, { status: 201 }),
    });
    renderWithProviders(<StaffCreate />);
    fireEvent.change(await screen.findByLabelText(/^Nom/), { target: { value: "DIALLO" } });
    fireEvent.change(screen.getByLabelText(/^Prénoms/), { target: { value: "Issa" } });
    fireEvent.click(screen.getByRole("button", { name: "Créer la fiche" }));
    await waitFor(() => expect(screen.getAllByRole("alert").length).toBeGreaterThan(0));
    expect(api.calls.filter((c) => c.method === "POST")).toHaveLength(0);
    await waitFor(() => expect(within(screen.getByLabelText(/^Catégorie/)).getAllByRole("option")).toHaveLength(3));
    fireEvent.change(screen.getByLabelText(/^Catégorie/), { target: { value: "TEACHER" } });
    fireEvent.click(screen.getByRole("button", { name: "Créer la fiche" }));
    await screen.findByText(/matricule PE-0001/);
    expect(api.calls.find((c) => c.method === "POST")!.body).toEqual({ person: { lastName: "DIALLO", firstName: "Issa" }, categoryCode: "TEACHER" });
    expect(screen.getByRole("link", { name: "Ouvrir la fiche" }).getAttribute("href")).toBe(`/v2/staff/${uuid(4000)}`);
  });
});

const staffDetail = { ...staffSummary(), otherNames: null, sex: "M", email: "issa@example.org", phone: null, phoneAlt: null, addressLine: null, city: "Abidjan", hiredOn: "2020-09-01", leftOn: null, primaryCampusId: null, affiliations: [], portalAccount: "NONE", externalRef: null, createdAt: "2026-09-01T08:00:00.000Z", updatedAt: "2026-09-01T08:00:00.000Z" };

const detailRoutes = (perms: string[], extra: Record<string, unknown> = {}) => ({
  ...accessRoutes(perms),
  ...baseYears,
  [`GET /api/v1/people/staff/${uuid(4000)}`]: staffDetail,
  "GET /api/v1/people/reference/staff-categories": categories,
  "GET /api/v1/people/reference/contract-types": { items: [{ id: uuid(990), code: "CDI", label: "CDI", kind: "PERMANENT", active: true }] },
  "GET /api/v1/people/staff/expiring-qualifications": { items: [{ qualificationId: uuid(6000), staffId: uuid(4000), label: "Habilitation secourisme", expiresOn: "2026-10-15", daysLeft: 14 }] },
  "GET /api/v1/tenancy/institutions": { items: [] },
  ...extra,
});

describe("StaffDetail", () => {
  it("contrats : liste, ajout (volume horaire + unité ensemble) sans aucun champ de salaire", async () => {
    const api = setTestApi(
      detailRoutes(["staff.read", "staff.contract.read", "staff.contract.manage"], {
        [`GET /api/v1/people/staff/${uuid(4000)}/contracts`]: { items: [{ id: uuid(7000), staffId: uuid(4000), contractTypeCode: "CDI", startsOn: "2020-09-01", endsOn: null, committedHours: 18, committedHoursUnit: "PER_WEEK", status: "ACTIVE", note: null }] },
        [`POST /api/v1/people/staff/${uuid(4000)}/contracts`]: () => json({ id: uuid(7001), staffId: uuid(4000), contractTypeCode: "CDI", startsOn: "2026-09-01", endsOn: null, committedHours: null, committedHoursUnit: null, status: "ACTIVE", note: null }, { status: 201 }),
      }),
    );
    renderWithProviders(<StaffDetail id={uuid(4000)} />);
    expect(await screen.findByRole("heading", { level: 1, name: "DIALLO Issa" })).toBeTruthy();
    fireEvent.mouseDown(await screen.findByRole("tab", { name: "Contrats" }), { button: 0 });
    const table = await screen.findByRole("table", { name: "Contrats du membre du personnel" });
    expect(await within(table).findByText("18 h / semaine")).toBeTruthy();
    expect(screen.getByText(/ni tarif ni salaire/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Ajouter un contrat" }));
    const dialog = await screen.findByRole("dialog");
    await waitFor(() => expect(within(within(dialog).getByLabelText(/Type de contrat/)).getAllByRole("option")).toHaveLength(2));
    fireEvent.change(within(dialog).getByLabelText(/Type de contrat/), { target: { value: "CDI" } });
    fireEvent.change(within(dialog).getByLabelText(/Début/), { target: { value: "2026-09-01" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Ajouter un contrat" }));
    await screen.findByText("Le contrat a été ajouté.");
    const body = api.calls.find((c) => c.method === "POST")!.body as Record<string, unknown>;
    expect(body).toEqual({ contractTypeCode: "CDI", startsOn: "2026-09-01", status: "ACTIVE" });
    expect(Object.keys(body).some((k) => /salary|rate|tarif|amount/i.test(k))).toBe(false);
  });

  it("qualifications : l'alerte d'expiration vient de l'API", async () => {
    setTestApi(
      detailRoutes(["staff.read"], {
        [`GET /api/v1/people/staff/${uuid(4000)}/qualifications`]: { items: [{ id: uuid(6000), staffId: uuid(4000), kind: "AUTHORIZATION", label: "Habilitation secourisme", issuer: "Croix-Rouge", obtainedOn: "2024-10-15", expiresOn: "2026-10-15", note: null }, { id: uuid(6001), staffId: uuid(4000), kind: "DIPLOMA", label: "Licence de mathématiques", issuer: null, obtainedOn: null, expiresOn: null, note: null }] },
      }),
    );
    renderWithProviders(<StaffDetail id={uuid(4000)} />);
    fireEvent.mouseDown(await screen.findByRole("tab", { name: "Qualifications" }), { button: 0 });
    const table = await screen.findByRole("table", { name: "Diplômes, certifications et habilitations" });
    expect(await within(table).findByText("Expire dans 14 jours")).toBeTruthy();
    expect(within(table).getByText("sans échéance")).toBeTruthy();
  });

  it("disponibilités : grille hebdomadaire, ajout d'un créneau (l'API remplace la liste entière)", async () => {
    const slot = { id: uuid(8000), staffId: uuid(4000), campusId: null, weekday: 3, startTime: "14:00:00", endTime: "18:00:00", kind: "UNAVAILABLE", validFrom: null, validTo: null, reason: "Cours à l'université" };
    const api = setTestApi(
      detailRoutes(["staff.read", "staff.availability.manage"], {
        [`GET /api/v1/people/staff/${uuid(4000)}/availabilities`]: { items: [slot] },
        [`PUT /api/v1/people/staff/${uuid(4000)}/availabilities`]: { items: [slot] },
      }),
    );
    renderWithProviders(<StaffDetail id={uuid(4000)} />);
    fireEvent.mouseDown(await screen.findByRole("tab", { name: "Disponibilités" }), { button: 0 });
    const grid = await screen.findByRole("list", { name: "Semaine type" });
    expect(within(grid).getByText(/14:00–18:00 · Indisponible — Cours à l'université/)).toBeTruthy();
    expect(within(grid).getAllByRole("heading", { level: 3 })).toHaveLength(7);
    fireEvent.click(await screen.findByRole("button", { name: "Ajouter un créneau" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText(/^Jour/), { target: { value: "5" } });
    fireEvent.change(within(dialog).getByLabelText(/^Début/), { target: { value: "08:00" } });
    fireEvent.change(within(dialog).getByLabelText(/^Fin/), { target: { value: "10:00" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Ajouter un créneau" }));
    await screen.findByText("Les disponibilités sont enregistrées.");
    expect(api.calls.find((c) => c.method === "PUT")!.body).toEqual({
      availabilities: [
        { weekday: 3, startTime: "14:00", endTime: "18:00", kind: "UNAVAILABLE", reason: "Cours à l'université" },
        { weekday: 5, startTime: "08:00", endTime: "10:00", kind: "UNAVAILABLE" },
      ],
    });
  });

  it("créneau incohérent (fin avant début) : refusé localement", async () => {
    const api = setTestApi(detailRoutes(["staff.read", "staff.availability.manage"], { [`GET /api/v1/people/staff/${uuid(4000)}/availabilities`]: { items: [] } }));
    renderWithProviders(<StaffDetail id={uuid(4000)} />);
    fireEvent.mouseDown(await screen.findByRole("tab", { name: "Disponibilités" }), { button: 0 });
    fireEvent.click(await screen.findByRole("button", { name: "Ajouter un créneau" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText(/^Début/), { target: { value: "12:00" } });
    fireEvent.change(within(dialog).getByLabelText(/^Fin/), { target: { value: "08:00" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Ajouter un créneau" }));
    await waitFor(() => expect(within(dialog).getAllByRole("alert").length).toBeGreaterThan(0));
    expect(api.calls.filter((c) => c.method === "PUT")).toHaveLength(0);
  });

  it("charge horaire : heures prévues et volume contractuel de l'année, affectations", async () => {
    setTestApi(
      detailRoutes(["staff.read", "teaching.read"], {
        [`GET /api/v1/people/staff/${uuid(4000)}/load`]: { staffId: uuid(4000), academicYearId: uuid(100), plannedHours: 48, byClassroom: [], byPeriod: [], contractualHoursPerWeek: 18, contractualHoursPerYear: null, weeksPerYearUsed: null },
        [`GET /api/v1/people/staff/${uuid(4000)}/assignments`]: { items: [assignment()] },
        [`GET /api/v1/academic/classrooms/${uuid(500)}`]: classroom(),
      }),
    );
    renderWithProviders(<StaffDetail id={uuid(4000)} />);
    fireEvent.mouseDown(await screen.findByRole("tab", { name: "Charge horaire" }), { button: 0 });
    expect(await screen.findByText("48 h", { selector: "dd" })).toBeTruthy();
    expect(screen.getByText("18 h", { selector: "dd" })).toBeTruthy();
    expect(screen.getByText(/n'est pas converti en année/)).toBeTruthy();
    expect(await screen.findByRole("link", { name: "Licence 1 A" })).toBeTruthy();
  });

  it("changement de statut vers « Parti » : date de départ transmise", async () => {
    const api = setTestApi(detailRoutes(["staff.read", "staff.status.update"], { [`POST /api/v1/people/staff/${uuid(4000)}/status`]: { ...staffDetail, status: "LEFT" } }));
    renderWithProviders(<StaffDetail id={uuid(4000)} />);
    fireEvent.click(await screen.findByRole("button", { name: "Changer le statut" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText(/Nouveau statut/), { target: { value: "LEFT" } });
    fireEvent.change(await within(dialog).findByLabelText("Date de départ"), { target: { value: "2026-12-31" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Changer le statut" }));
    await screen.findByText("Le statut a été modifié.");
    expect(api.calls.find((c) => c.method === "POST")!.body).toEqual({ status: "LEFT", leftOn: "2026-12-31" });
  });
});

describe("AssignmentsScreen", () => {
  const node = (n: number, code: string, label: string) => ({ nodeId: uuid(800 + n), lineageId: uuid(800 + n), parentId: null, nodeTypeCode: "ECUE", code, label, subjectId: uuid(900 + n), coefficient: null, credits: null, isMandatory: true, isTransversal: false, categoryCode: null, periodTypeCode: null, periodOrdinal: null, registrationKind: "REGULAR", enrollmentCourseId: null });
  const routes = (extra: Record<string, unknown> = {}) => ({
    ...accessRoutes(["teaching.read", "teaching.assign"]),
    ...baseYears,
    "GET /api/v1/academic/classrooms": { items: [classroom()], total: 1, page: 1, pageSize: 200 },
    [`GET /api/v1/academic/classrooms/${uuid(500)}`]: classroom(),
    [`GET /api/v1/academic/classrooms/${uuid(500)}/nodes`]: { items: [node(1, "MATH", "Mathématiques"), node(2, "PHYS", "Physique")] },
    [`GET /api/v1/people/classrooms/${uuid(500)}/assignments`]: { items: [assignment({ curriculumNodeId: uuid(801) })] },
    "GET /api/v1/people/teaching-assignments/unstaffed": { items: [{ classroomId: uuid(500), curriculumNodeId: uuid(802), label: "Physique" }] },
    [`GET /api/v1/academic/years/${uuid(100)}/periods`]: { items: [] },
    "GET /api/v1/people/staff": { items: [staffSummary({ id: uuid(4001), displayName: "BAMBA Fatou" })], total: 1, limit: 20, offset: 0 },
    ...extra,
  });

  async function openClassroom() {
    // L'année courante est choisie d'office dès que la liste arrive : attendre ce changement avant d'ouvrir la liste des classes.
    await waitFor(() => expect((screen.getByLabelText("Année") as HTMLSelectElement).value).toBe(uuid(100)));
    fireEvent.focus(await screen.findByRole("combobox", { name: /^Classe/ }));
    fireEvent.click(await screen.findByRole("option", { name: /Licence 1 A/ }));
  }

  it("matrice matière × rôle : responsables affichés, matière sans responsable signalée par l'API", async () => {
    setTestApi(routes());
    renderWithProviders(<AssignmentsScreen />);
    await openClassroom();
    const table = await screen.findByRole("table", { name: "Matrice matière par rôle d'enseignement" });
    const math = await within(table).findByRole("rowheader", { name: /Mathématiques/ });
    expect(within(math.closest("tr")!).getByText("DIALLO Issa")).toBeTruthy();
    const phys = within(table).getByRole("rowheader", { name: /Physique/ });
    expect(within(phys).getByText("Sans responsable")).toBeTruthy();
    expect(await screen.findByText("1 matière sans responsable")).toBeTruthy();
  });

  it("affectation : corps exact, avertissements non bloquants affichés", async () => {
    const api = setTestApi(
      routes({
        "POST /api/v1/people/teaching-assignments": () => json({ assignment: assignment({ id: uuid(5001), staffId: uuid(4001) }), warnings: [{ code: "people.no_matching_competency", message: "Aucune compétence déclarée pour cette matière." }] }, { status: 201 }),
      }),
    );
    renderWithProviders(<AssignmentsScreen />);
    await openClassroom();
    fireEvent.click(await screen.findByRole("button", { name: "Affecter — Physique" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.focus(within(dialog).getByRole("combobox", { name: /^Enseignant/ }));
    fireEvent.click(await within(dialog).findByRole("option", { name: /BAMBA Fatou/ }));
    fireEvent.change(within(dialog).getByLabelText(/^Début/), { target: { value: "2026-09-07" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Affecter" }));
    await screen.findByText("L'affectation est enregistrée.");
    expect(await screen.findByText("Aucune compétence déclarée pour cette matière.")).toBeTruthy();
    expect(api.calls.find((c) => c.method === "POST")!.body).toEqual({ staffId: uuid(4001), academicYearId: uuid(100), classroomId: uuid(500), curriculumNodeId: uuid(802), roleCode: "LEAD", startsOn: "2026-09-07" });
  });

  it("remplacement : nouvel enseignant, date et motif", async () => {
    const api = setTestApi(routes({ [`POST /api/v1/people/teaching-assignments/${uuid(5000)}/replace`]: { assignment: assignment({ id: uuid(5002), staffId: uuid(4001) }), warnings: [], replacedAssignment: assignment({ status: "ENDED" }) } }));
    renderWithProviders(<AssignmentsScreen />);
    await openClassroom();
    fireEvent.click(await screen.findByRole("button", { name: /Remplacer — DIALLO Issa/ }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.focus(within(dialog).getByRole("combobox", { name: /^Nouvel enseignant/ }));
    fireEvent.click(await within(dialog).findByRole("option", { name: /BAMBA Fatou/ }));
    fireEvent.change(within(dialog).getByLabelText(/^Date d'effet/), { target: { value: "2026-11-02" } });
    fireEvent.change(within(dialog).getByLabelText(/^Motif/), { target: { value: "Congé maladie" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Remplacer" }));
    await screen.findByText("Le remplacement est enregistré.");
    expect(api.calls.find((c) => c.method === "POST")!.body).toEqual({ newStaffId: uuid(4001), effectiveOn: "2026-11-02", reason: "Congé maladie" });
  });

  it("sans droit d'affecter : lecture seule", async () => {
    setTestApi(routes({ ...accessRoutes(["teaching.read"]) }));
    renderWithProviders(<AssignmentsScreen />);
    await openClassroom();
    await screen.findByRole("rowheader", { name: /Mathématiques/ });
    await waitFor(() => expect(screen.queryByRole("button", { name: /Affecter —/ })).toBeNull());
    expect(screen.queryByRole("button", { name: /Remplacer —/ })).toBeNull();
  });

  it("conflit d'affectation renvoyé par l'API : message affiché dans la boîte de dialogue", async () => {
    setTestApi(routes({ "POST /api/v1/people/teaching-assignments": () => json({ code: "people.assignment_conflict", message: "Un responsable est déjà affecté à cette matière." }, { status: 409 }) }));
    renderWithProviders(<AssignmentsScreen />);
    await openClassroom();
    fireEvent.click(await screen.findByRole("button", { name: "Affecter — Physique" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.focus(within(dialog).getByRole("combobox", { name: /^Enseignant/ }));
    fireEvent.click(await within(dialog).findByRole("option", { name: /BAMBA Fatou/ }));
    fireEvent.click(within(dialog).getByRole("button", { name: "Affecter" }));
    expect((await within(dialog).findByText("Un responsable est déjà affecté à cette matière.")).getAttribute("role")).toBe("alert");
  });

  void gradeLevels;
});
