// @vitest-environment jsdom
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { accessRoutes, setTestApi } from "@/platform/test/api-mock";
import { json, renderWithProviders } from "@/platform/test/render";
import { uuid } from "../../_test/fixtures";
import { enrollment, studentDetail } from "../../_test/fixtures-people";
import { ChildDetail } from "../../students/_components/MyChildren";
import { MyRecordScreen } from "./MyRecord";

vi.mock("@/platform/api/default-client", async () => (await import("@/platform/test/api-mock")).defaultClientModule);
vi.mock("next/link", () => ({ default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a> }));

const ME = "GET /api/v1/people/me/student";
const READ = accessRoutes(["student.self.read"]);
const WRITE = accessRoutes(["student.self.read", "student.self.update"]);

const record = (over: Partial<Record<string, unknown>> = {}) =>
  studentDetail({
    id: uuid(2000),
    personId: uuid(2100),
    displayName: "TRAORE Awa",
    studentNumber: "EL-0001",
    status: "ACTIVE",
    access: "SELF",
    otherNames: null,
    birthDate: "2012-03-14",
    birthPlace: "Abidjan",
    nationality: "CI",
    email: "awa@example.org",
    phone: "+2250700000000",
    phoneAlt: null,
    addressLine: "Rue des Jardins",
    city: "Abidjan",
    residence: null,
    firstEnrolledOn: "2024-09-02",
    externalRef: "EXT-SECRET-9",
    portalAccount: "active",
    currentEnrollment: { enrollmentId: uuid(1000), academicYearId: uuid(100), institutionId: uuid(1), classroomId: uuid(500), classroomName: "6e A", status: "ACTIVE", registrationNumber: "2026-0001" },
    primaryGuardian: { guardianId: uuid(3000), displayName: "KONE Mariam", relationshipCode: "MOTHER", phone: "+2250500000000" },
    ...over,
  });

describe("MyRecordScreen", () => {
  it("affiche l'identité, le matricule, la classe, les coordonnées, le tuteur et les inscriptions ; aucun champ interne", async () => {
    setTestApi({ ...READ, [ME]: record(), "GET /api/v1/academic/me/enrollments": { items: [enrollment({ id: uuid(1000) }), enrollment({ id: uuid(1001), status: "COMPLETED", registrationNumber: "2025-0003", enrolledOn: "2025-09-02", isRepeating: true })] } });
    renderWithProviders(<MyRecordScreen />);
    const identity = await screen.findByRole("heading", { name: /TRAORE Awa/ });
    expect(within(identity).getByText("Actif")).toBeTruthy();
    const section = identity.closest("section")!;
    expect(within(section).getByText("EL-0001")).toBeTruthy();
    expect(within(section).getByText("Féminin")).toBeTruthy();
    expect(within(section).getByText("Abidjan")).toBeTruthy();
    // Champ non renseigné côté identité : la ligne est masquée.
    expect(within(section).queryByText("Autres prénoms")).toBeNull();
    // Classe actuelle.
    const klass = screen.getByRole("heading", { name: "Ma classe" }).closest("section")!;
    expect(within(klass).getByText("6e A")).toBeTruthy();
    expect(within(klass).getByText("2026-0001")).toBeTruthy();
    // Coordonnées : les champs vides sont signalés comme non renseignés.
    const contact = screen.getByRole("heading", { name: "Mes coordonnées" }).closest("section")!;
    expect(within(contact).getByText("awa@example.org")).toBeTruthy();
    expect(within(contact).getAllByText("Non renseigné")).toHaveLength(2); // autre téléphone, résidence
    // Tuteur principal.
    expect(screen.getByText("KONE Mariam")).toBeTruthy();
    // Inscriptions.
    const list = await screen.findByRole("list", { name: "Mes inscriptions" });
    expect(within(list).getAllByRole("listitem")).toHaveLength(2);
    expect(within(list).getByText("2025-0003")).toBeTruthy();
    expect(within(list).getByText("Redoublement")).toBeTruthy();
    // Aucun champ interne ni identifiant technique.
    const text = document.body.textContent ?? "";
    for (const forbidden of ["EXT-SECRET-9", uuid(2000), uuid(2100), "portalAccount", "externalRef", "SELF", "2026-01-01T", "Compte"]) expect(text).not.toContain(forbidden);
    // Lecture seule : pas de bouton de modification sans `student.self.update`.
    expect(screen.queryByRole("button", { name: "Mettre à jour mes coordonnées" })).toBeNull();
  });

  it("met à jour les coordonnées : seuls les champs modifiés partent, un champ vidé devient null", async () => {
    const api = setTestApi({
      ...WRITE,
      [ME]: record(),
      "GET /api/v1/academic/me/enrollments": { items: [] },
      "PATCH /api/v1/people/me/student": () => json({ personId: uuid(2100), fields: ["phone", "city"] }),
    });
    renderWithProviders(<MyRecordScreen />);
    fireEvent.click(await screen.findByRole("button", { name: "Mettre à jour mes coordonnées" }));
    const dialog = await screen.findByRole("dialog", { name: "Mettre à jour mes coordonnées" });
    // Rien de modifié : fermeture sans appel.
    fireEvent.change(within(dialog).getByLabelText("Téléphone"), { target: { value: "+2250700000001" } });
    fireEvent.change(within(dialog).getByLabelText("Ville"), { target: { value: "" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Enregistrer" }));
    await screen.findByText("Vos coordonnées ont été mises à jour.");
    expect(api.calls.find((c) => c.method === "PATCH")!.body).toEqual({ phone: "+2250700000001", city: null });
    // Aucun champ interne dans le corps.
    expect(Object.keys(api.calls.find((c) => c.method === "PATCH")!.body as object)).toEqual(["phone", "city"]);
  });

  it("e-mail invalide : refusé par le contrat sans appel ; l'erreur du serveur est affichée", async () => {
    let fail = true;
    const api = setTestApi({
      ...WRITE,
      [ME]: record(),
      "GET /api/v1/academic/me/enrollments": { items: [] },
      "PATCH /api/v1/people/me/student": () => {
        if (fail) {
          fail = false;
          return json({ code: "people.phone_invalid", message: "Ce numéro de téléphone n'est pas valide.", details: { issues: [{ path: ["phone"], message: "Ce numéro de téléphone n'est pas valide." }] } }, { status: 400 });
        }
        return json({ personId: uuid(2100), fields: ["email"] });
      },
    });
    renderWithProviders(<MyRecordScreen />);
    fireEvent.click(await screen.findByRole("button", { name: "Mettre à jour mes coordonnées" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText("Adresse e-mail"), { target: { value: "pas-un-courriel" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Enregistrer" }));
    await waitFor(() => expect(within(dialog).getAllByRole("alert").length).toBeGreaterThan(0));
    expect(api.calls.filter((c) => c.method === "PATCH")).toHaveLength(0);
    fireEvent.change(within(dialog).getByLabelText("Adresse e-mail"), { target: { value: "awa.t@example.org" } });
    fireEvent.change(within(dialog).getByLabelText("Téléphone"), { target: { value: "+2250700000009" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Enregistrer" }));
    expect((await within(dialog).findAllByText("Ce numéro de téléphone n'est pas valide.")).length).toBeGreaterThan(0);
    fireEvent.change(within(dialog).getByLabelText("Téléphone"), { target: { value: "+2250700000000" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Enregistrer" }));
    await screen.findByText("Vos coordonnées ont été mises à jour.");
    expect(api.calls.filter((c) => c.method === "PATCH").at(-1)!.body).toEqual({ email: "awa.t@example.org" });
  });

  it("non inscrit, sans tuteur, inscriptions indisponibles : messages explicites, rien n'est inventé", async () => {
    setTestApi({
      ...READ,
      [ME]: record({ currentEnrollment: null, primaryGuardian: null, birthDate: null, birthPlace: null, nationality: null, sex: null, firstEnrolledOn: null }),
      "GET /api/v1/academic/me/enrollments": () => json({ code: "FORBIDDEN", message: "Action non autorisée." }, { status: 403 }),
    });
    renderWithProviders(<MyRecordScreen />);
    expect(await screen.findByText("Vous n'êtes inscrit dans aucune classe pour le moment.")).toBeTruthy();
    expect(screen.queryByText("Mon tuteur principal")).toBeNull();
    expect(screen.queryByText("Date de naissance")).toBeNull();
    expect(await screen.findByText("Vos inscriptions ne sont pas disponibles pour le moment.")).toBeTruthy();
  });

  it("sans permission : accès refusé ; dossier introuvable : message de l'API", async () => {
    setTestApi({ ...accessRoutes([]), [ME]: record() });
    const { unmount } = renderWithProviders(<MyRecordScreen />);
    expect(await screen.findByText("Vous n'avez pas les droits nécessaires pour cette action.")).toBeTruthy();
    unmount();
    setTestApi({ ...READ, [ME]: () => json({ code: "people.student_not_found", message: "Aucun dossier élève n'est lié à votre compte." }, { status: 404 }), "GET /api/v1/academic/me/enrollments": { items: [] } });
    renderWithProviders(<MyRecordScreen />);
    expect(await screen.findByText("Aucun dossier élève n'est lié à votre compte.")).toBeTruthy();
  });
});

describe("Fiche enfant (parent) : droit de correction", () => {
  const contact = { id: uuid(3300), studentId: uuid(2000), contactName: "Oncle Bamba", relationshipLabel: "Oncle", phone: "+2250500000000", phoneAlt: null, email: null, priority: 0 };
  const child = {
    [`GET /api/v1/people/children/${uuid(2000)}`]: { student: studentDetail({ access: "GUARDIAN" }), guardians: [{ guardianId: uuid(3000), displayName: "KONE Mariam", relationshipCode: "MOTHER", isPrimaryContact: true }], emergencyContacts: [contact] },
    [`GET /api/v1/academic/children/${uuid(2000)}/enrollments`]: { items: [enrollment()] },
  };

  it("sans student.child.update : contacts d'urgence en lecture seule (ni bouton Corriger, ni invitation à corriger)", async () => {
    setTestApi({ ...accessRoutes(["student.child.read"]), ...child });
    renderWithProviders(<ChildDetail id={uuid(2000)} />);
    expect(await screen.findByText("Oncle Bamba")).toBeTruthy();
    await screen.findByText("2026-0001");
    expect(screen.queryByRole("button", { name: /Corriger/ })).toBeNull();
    expect(screen.queryByText(/Vous pouvez corriger/)).toBeNull();
  });

  it("avec student.child.update : bouton Corriger proposé", async () => {
    setTestApi({ ...accessRoutes(["student.child.read", "student.child.update"]), ...child });
    renderWithProviders(<ChildDetail id={uuid(2000)} />);
    expect(await screen.findByRole("button", { name: /Corriger — Oncle Bamba/ })).toBeTruthy();
    expect(screen.getByText(/Vous pouvez corriger/)).toBeTruthy();
  });
});
