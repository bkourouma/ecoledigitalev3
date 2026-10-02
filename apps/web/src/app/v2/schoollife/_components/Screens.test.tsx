// @vitest-environment jsdom
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { accessRoutes, setTestApi } from "@/platform/test/api-mock";
import { json, renderWithProviders } from "@/platform/test/render";
import { classroom } from "../../_test/fixtures";
import { appealDto, convocationDto, dashboardDto, effectDto, familyItem, incidentDto, IDS, lifeDto, measureDto, noteDto, referenceDto, uuid } from "../_test/fixtures";
import { ConvocationsScreen } from "./ConvocationsScreen";
import { DashboardScreen } from "./DashboardScreen";
import { FamilyScreen } from "./FamilyScreen";
import { QuickEntryScreen } from "./QuickEntryScreen";
import { SettingsScreen } from "./SettingsScreen";
import { StudentFileScreen } from "./StudentFileScreen";
import { ValidationsScreen } from "./ValidationsScreen";

// Écrans complets rendus avec le vrai catalogue : marge pour les machines chargées (tests lancés en parallèle).
vi.setConfig({ testTimeout: 30_000 });

vi.mock("@/platform/api/default-client", async () => (await import("@/platform/test/api-mock")).defaultClientModule);
vi.mock("next/link", () => ({ default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a> }));

const S = "/api/v1/schoollife";
afterEach(() => vi.restoreAllMocks());

describe("DashboardScreen : tableau de bord de la vie scolaire", () => {
  it("affiche les indicateurs et les files renvoyés par l'API ; un incident confidentiel reste masqué", async () => {
    setTestApi({
      ...accessRoutes(["schoollife.read.all", "schoollife.incident.write"]),
      [`GET ${S}/dashboard`]: dashboardDto({ recentIncidents: [incidentDto(), incidentDto({ id: uuid(5002), masked: true, description: null, typeLabel: null, confidentiality: "CONFIDENTIAL" })] }),
    });
    renderWithProviders(<DashboardScreen />);
    const counts = await screen.findByRole("list", { name: "Indicateurs de la vie scolaire" });
    expect(within(counts).getByText("2")).toBeTruthy();
    expect(within(counts).getByText("Mesures à valider")).toBeTruthy();
    expect(await screen.findByText("Altercation dans la cour")).toBeTruthy();
    expect(screen.getByText("Élément confidentiel (masqué)")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Saisie rapide" })).toBeTruthy();
    expect(screen.getAllByRole("link", { name: "Ouvrir le dossier" })[0]?.getAttribute("href")).toBe(`/v2/schoollife/eleves/${IDS.student}`);
  });

  it("sans permission de saisie : aucun raccourci", async () => {
    setTestApi({ ...accessRoutes(["schoollife.read.all"]), [`GET ${S}/dashboard`]: dashboardDto() });
    renderWithProviders(<DashboardScreen />);
    await screen.findByRole("list", { name: "Indicateurs de la vie scolaire" });
    expect(screen.queryByRole("link", { name: "Saisie rapide" })).toBeNull();
  });
});

describe("StudentFileScreen : contrôle d'accès par niveau de confidentialité", () => {
  const secret = incidentDto({ id: uuid(5002), masked: true, description: null, typeLabel: null, confidentiality: "CONFIDENTIAL", involvements: [] });
  const life = (clearance: string) => lifeDto({ clearance, incidents: [incidentDto(), secret], notes: [noteDto()], measures: [measureDto({ status: "NOTIFIED" })] });

  it("niveau STANDARD : les éléments absents n'existent pas, aucun bouton de lecture, aucune mention de contenu masqué ne fuit", async () => {
    setTestApi({ ...accessRoutes(["schoollife.read"]), [`GET ${S}/students/${IDS.student}/life`]: lifeDto({ clearance: "STANDARD", incidents: [incidentDto()], notes: [noteDto()] }) });
    renderWithProviders(<StudentFileScreen studentId={IDS.student} />);
    expect(await screen.findByText("Altercation dans la cour")).toBeTruthy();
    expect(screen.getByText("Excellente participation")).toBeTruthy();
    expect(screen.getByText("Les éléments restreints et confidentiels ne vous sont pas montrés.")).toBeTruthy();
    expect(screen.queryByText(/masqué/)).toBeNull();
    expect(screen.queryByRole("button", { name: /Lire/ })).toBeNull();
    // Sans droit de saisie : aucune action de création
    expect(screen.queryByRole("button", { name: "Proposer une mesure" })).toBeNull();
  });

  it("niveau CONFIDENTIEL sans la permission de lecture : élément masqué, pas de bouton « lire »", async () => {
    setTestApi({ ...accessRoutes(["schoollife.read"]), [`GET ${S}/students/${IDS.student}/life`]: life("CONFIDENTIAL") });
    renderWithProviders(<StudentFileScreen studentId={IDS.student} />);
    expect(await screen.findByText("Élément confidentiel : le contenu est masqué.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Lire/ })).toBeNull();
  });

  it("lecture confidentielle : motif exigé (≥ 5), corps exact envoyé, contenu affiché dans une fenêtre éphémère, puis effacé", async () => {
    const api = setTestApi({
      ...accessRoutes(["schoollife.read", "schoollife.confidential.read"]),
      [`GET ${S}/students/${IDS.student}/life`]: life("CONFIDENTIAL"),
      [`POST ${S}/confidential-reads`]: () => json({ entityKind: "INCIDENT", incident: incidentDto({ id: uuid(5002), confidentiality: "CONFIDENTIAL", description: "Fait très grave et protégé", involvements: [] }) }),
    });
    renderWithProviders(<StudentFileScreen studentId={IDS.student} />);
    expect(screen.queryByText("Fait très grave et protégé")).toBeNull();
    fireEvent.click(await screen.findByRole("button", { name: "Lire (motif exigé)" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText(/Motif de la lecture/), { target: { value: "abc" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Lire" }));
    expect(await within(dialog).findByText(/5 caractères/)).toBeTruthy();
    expect(api.calls.filter((c) => c.method === "POST")).toHaveLength(0);
    fireEvent.change(within(dialog).getByLabelText(/Motif de la lecture/), { target: { value: "Instruction du dossier" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Lire" }));
    expect(await screen.findByText("Fait très grave et protégé")).toBeTruthy();
    expect(api.calls.find((c) => c.method === "POST")?.body).toEqual({ entityKind: "INCIDENT", entityId: uuid(5002), purpose: "Instruction du dossier" });
    fireEvent.click(screen.getAllByRole("button", { name: "Fermer" }).find((b) => b.textContent === "Fermer")!);
    await waitFor(() => expect(screen.queryByText("Fait très grave et protégé")).toBeNull());
  });

  it("vue d'assiduité en lecture seule ; indisponible : message explicite, le dossier reste lisible", async () => {
    setTestApi({
      ...accessRoutes(["schoollife.read"]),
      [`GET ${S}/students/${IDS.student}/life`]: lifeDto({ attendance: { available: true, absences: [{ recordId: uuid(1), sessionDate: "2026-10-12", statusCode: "ABSENT", excused: true, countedMinutes: 60, minutesLate: null }], summary: { absentCount: 1, excusedCount: 1, lateCount: 0 } } }),
    });
    const first = renderWithProviders(<StudentFileScreen studentId={IDS.student} />);
    expect(await screen.findByText("1 absence(s), dont 1 justifiée(s) ; 0 retard(s).")).toBeTruthy();
    expect(screen.getByRole("table", { name: "Retards et absences de l'élève" })).toBeTruthy();
    first.unmount();
    setTestApi({ ...accessRoutes(["schoollife.read"]), [`GET ${S}/students/${IDS.student}/life`]: lifeDto({ attendance: { available: false, absences: [], summary: null } }) });
    renderWithProviders(<StudentFileScreen studentId={IDS.student} />);
    expect(await screen.findByText("Les présences ne sont pas disponibles pour le moment.")).toBeTruthy();
  });

  it("points de conduite : barème de démonstration signalé, solde et registre ; ajustement manuel soumis au contrat", async () => {
    const conduct = { studentId: IDS.student, enabled: true, balance: { scaleId: uuid(401), scaleCode: "DEMO", scaleLabel: "Barème de démonstration", isPlaceholder: true, points: 17, enrollmentId: IDS.enrollment }, movements: [{ id: uuid(402), scaleId: uuid(401), delta: -3, reason: "Mesure validée : Type sanction (test)", sourceKind: "MEASURE", sourceId: uuid(6001), reversesId: null, academicPeriodId: null, createdAt: "2026-11-02T09:30:00.000Z" }] };
    const api = setTestApi({
      ...accessRoutes(["schoollife.read", "schoollife.conduct.adjust"]),
      [`GET ${S}/students/${IDS.student}/life`]: lifeDto({ conduct }),
      [`POST ${S}/conduct-movements`]: () => json({ movementId: uuid(403) }, { status: 201 }),
    });
    renderWithProviders(<StudentFileScreen studentId={IDS.student} />);
    expect(await screen.findByText("17")).toBeTruthy();
    expect(screen.getByText("Barème de démonstration", { selector: "span" })).toBeTruthy();
    expect(screen.getByText("-3")).toBeTruthy();
    fireEvent.click(await screen.findByRole("button", { name: "Ajuster les points" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText(/Points \(négatif pour retirer\)/), { target: { value: "0" } });
    fireEvent.change(within(dialog).getByLabelText(/Motif/), { target: { value: "x" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Enregistrer l'ajustement" }));
    expect(await within(dialog).findByText("La valeur ne peut pas être nulle.")).toBeTruthy();
    expect(api.calls.filter((c) => c.method === "POST")).toHaveLength(0);
    fireEvent.change(within(dialog).getByLabelText(/Points \(négatif pour retirer\)/), { target: { value: "2" } });
    fireEvent.change(within(dialog).getByLabelText(/Motif/), { target: { value: "Bonus du conseil" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Enregistrer l'ajustement" }));
    await waitFor(() => expect(api.calls.find((c) => c.method === "POST")?.body).toEqual({ enrollmentId: IDS.enrollment, scaleId: uuid(401), delta: 2, reason: "Bonus du conseil" }));
  });

  it("la note d'un élève se retire avec un motif (jamais supprimée)", async () => {
    const api = setTestApi({
      ...accessRoutes(["schoollife.read", "schoollife.note.write"]),
      [`GET ${S}/students/${IDS.student}/life`]: lifeDto({ notes: [noteDto()] }),
      [`POST ${S}/notes/${uuid(8001)}/withdraw`]: () => json(noteDto({ status: "WITHDRAWN", withdrawnReason: "Erreur de saisie" })),
    });
    renderWithProviders(<StudentFileScreen studentId={IDS.student} />);
    fireEvent.click(await screen.findByRole("button", { name: "Retirer la note" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText(/Motif du retrait/), { target: { value: "Erreur de saisie" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Retirer" }));
    await waitFor(() => expect(api.calls.find((c) => c.method === "POST")?.body).toEqual({ reason: "Erreur de saisie" }));
  });
});

describe("ValidationsScreen : file de validation de la direction", () => {
  const routes = (perms: string[], extra: Record<string, unknown> = {}) => ({
    ...accessRoutes(perms),
    [`GET ${S}/measures`]: ({ url }: { url: URL }) => {
      const status = url.searchParams.get("status");
      if (status === "PROPOSED") return json({ items: [measureDto()] });
      if (status === "VALIDATED") return json({ items: [measureDto({ id: uuid(6002), status: "VALIDATED", kind: "TEMP_EXCLUSION", startsOn: "2026-12-01", endsOn: "2026-12-03", typeLabel: "Type exclusion (test)" })] });
      if (status === "APPEALED") return json({ items: [measureDto({ id: uuid(6003), status: "APPEALED", appeals: [appealDto({ measureId: uuid(6003) })] })] });
      return json({ items: [] });
    },
    [`GET ${S}/measure-effects`]: { items: [effectDto()] },
    ...extra,
  });

  it("valide avec une note facultative : corps exact ; le refus « quatre yeux » du serveur s'affiche tel quel", async () => {
    let attempts = 0;
    const api = setTestApi(
      routes(["schoollife.measure.validate", "schoollife.exclusion.validate"], {
        [`POST ${S}/measures/${uuid(6001)}/validate`]: () => {
          attempts += 1;
          return attempts === 1 ? json({ code: "schoollife.four_eyes_required", message: "La validation doit venir d'une autre personne que le proposant (séparation des tâches)." }, { status: 403 }) : json(measureDto({ status: "VALIDATED" }));
        },
      }),
    );
    renderWithProviders(<ValidationsScreen />);
    const section = (await screen.findByRole("heading", { name: "À valider" })).closest("section")!;
    expect(await within(section).findByText("validation par une autre personne exigée", { exact: false })).toBeTruthy();
    fireEvent.click(await within(section).findByRole("button", { name: "Valider" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Valider" }));
    expect(await within(dialog).findByText(/autre personne que le proposant/)).toBeTruthy();
    fireEvent.change(within(dialog).getByLabelText(/Note de validation/), { target: { value: "Faits établis" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Valider" }));
    await waitFor(() => expect(api.calls.filter((c) => c.method === "POST")).toHaveLength(2));
    expect(api.calls.filter((c) => c.method === "POST")[1]?.body).toEqual({ note: "Faits établis" });
  });

  it("rejet : motif d'au moins 5 caractères ; sans permission de valider, aucune action", async () => {
    const api = setTestApi(routes(["schoollife.measure.validate"], { [`POST ${S}/measures/${uuid(6001)}/reject`]: () => json(measureDto({ status: "REJECTED" })) }));
    renderWithProviders(<ValidationsScreen />);
    const section = (await screen.findByRole("heading", { name: "À valider" })).closest("section")!;
    fireEvent.click(await within(section).findByRole("button", { name: "Rejeter" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText(/Motif du rejet/), { target: { value: "non" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Rejeter" }));
    expect(await within(dialog).findByText(/5 caractères/)).toBeTruthy();
    expect(api.calls.filter((c) => c.method === "POST")).toHaveLength(0);
    fireEvent.change(within(dialog).getByLabelText(/Motif du rejet/), { target: { value: "Faits insuffisamment établis" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Rejeter" }));
    await waitFor(() => expect(api.calls.find((c) => c.method === "POST")?.body).toEqual({ note: "Faits insuffisamment établis" }));
  });

  it("une exclusion validée n'applique JAMAIS d'elle-même la suspension : l'effet attend un humain habilité (statut choisi, corps exact)", async () => {
    const api = setTestApi(routes(["schoollife.measure.validate", "schoollife.exclusion.apply"], { [`POST ${S}/measure-effects/${uuid(9501)}/apply`]: () => json(effectDto({ status: "APPLIED", appliedStatus: "EXCLUDED" })) }));
    renderWithProviders(<ValidationsScreen />);
    const section = (await screen.findByRole("heading", { name: "Effets d'exclusion en attente" })).closest("section")!;
    expect(within(section).getByText("Demande de changement de statut de l'élève")).toBeTruthy();
    fireEvent.click(within(section).getByRole("button", { name: "Appliquer" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText(/Nouveau statut de l'élève/), { target: { value: "EXCLUDED" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Appliquer" }));
    await waitFor(() => expect(api.calls.find((c) => c.method === "POST")?.body).toEqual({ status: "EXCLUDED" }));
  });

  it("sans la permission d'application, la section des effets n'existe pas ; recours : décision motivée (≥ 10 caractères)", async () => {
    const api = setTestApi(routes(["schoollife.measure.validate", "schoollife.appeal.decide"], { [`POST ${S}/appeals/${uuid(7001)}/uphold`]: () => json(appealDto({ status: "UPHELD" })) }));
    renderWithProviders(<ValidationsScreen />);
    await screen.findByRole("heading", { name: "Recours déposés" });
    expect(screen.queryByRole("heading", { name: "Effets d'exclusion en attente" })).toBeNull();
    const section = screen.getByRole("heading", { name: "Recours déposés" }).closest("section")!;
    expect(await within(section).findByText(/Je conteste cette décision/)).toBeTruthy();
    fireEvent.click(within(section).getByRole("button", { name: "Maintenir la mesure" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText(/Motivation de la décision/), { target: { value: "court" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Maintenir" }));
    expect(await within(dialog).findByText(/10 caractères/)).toBeTruthy();
    fireEvent.change(within(dialog).getByLabelText(/Motivation de la décision/), { target: { value: "Sanction proportionnée aux faits" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Maintenir" }));
    await waitFor(() => expect(api.calls.find((c) => c.method === "POST")?.body).toEqual({ decisionNote: "Sanction proportionnée aux faits" }));
  });
});

describe("FamilyScreen : ce que la règle de visibilité ouvre à la famille et à l'élève", () => {
  it("parent : décisions notifiées, notes partagées, convocation ; recours motivé (≥ 10) et accusé de réception ; jamais d'incident", async () => {
    const api = setTestApi({
      ...accessRoutes(["schoollife.child.read", "schoollife.child.appeal", "schoollife.child.acknowledge"]),
      [`GET ${S}/me/children`]: { items: [{ studentId: IDS.student, studentName: "KOUASSI Awa" }] },
      [`GET ${S}/children/${IDS.student}/life`]: {
        studentId: IDS.student,
        studentName: "KOUASSI Awa",
        items: [familyItem(), familyItem({ id: uuid(8001), entityKind: "NOTE", title: "Encouragement", kind: "ENCOURAGEMENT", status: "ACTIVE", text: "Excellente participation", appealable: false }), familyItem({ id: uuid(8501), entityKind: "CONVOCATION", title: "Convocation", kind: "DISCIPLINE", status: "SENT", text: "Entretien", scheduledAt: "2026-12-01T08:00:00.000Z", location: "Bureau", appealable: false, canAcknowledge: true })],
      },
      [`POST ${S}/measures/${uuid(6001)}/appeals`]: () => json(appealDto(), { status: 201 }),
      [`POST ${S}/convocations/${uuid(8501)}/acknowledge`]: () => json(convocationDto({ status: "ACKNOWLEDGED" })),
    });
    renderWithProviders(<FamilyScreen mode="guardian" />);
    expect(await screen.findByText("Comportement répété en classe")).toBeTruthy();
    expect(screen.getByText("Excellente participation")).toBeTruthy();
    expect(screen.queryByText(/Incident/)).toBeNull();
    fireEvent.click(await screen.findByRole("button", { name: "Accuser réception" }));
    await waitFor(() => expect(api.calls.find((c) => c.path.endsWith("/acknowledge"))?.body).toEqual({}));
    fireEvent.click(await screen.findByRole("button", { name: "Déposer un recours" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText(/Motif du recours/), { target: { value: "court" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Déposer le recours" }));
    expect(await within(dialog).findByText(/10 caractères/)).toBeTruthy();
    fireEvent.change(within(dialog).getByLabelText(/Motif du recours/), { target: { value: "Je conteste cette décision" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Déposer le recours" }));
    await waitFor(() => expect(api.calls.find((c) => c.path.endsWith("/appeals"))?.body).toEqual({ reason: "Je conteste cette décision" }));
  });

  it("élève : aucune action d'accusé de réception ; sans lien (404), message d'erreur de l'API", async () => {
    setTestApi({
      ...accessRoutes(["schoollife.self.read"]),
      [`GET ${S}/me/life`]: { studentId: IDS.student, studentName: "KOUASSI Awa", items: [familyItem({ appealable: false })] },
    });
    const first = renderWithProviders(<FamilyScreen mode="student" />);
    expect(await screen.findByText("Comportement répété en classe")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Accuser réception" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Déposer un recours" })).toBeNull();
    first.unmount();
    setTestApi({ ...accessRoutes(["schoollife.self.read"]), [`GET ${S}/me/life`]: () => json({ code: "schoollife.not_found", message: "Élève introuvable." }, { status: 404 }) });
    renderWithProviders(<FamilyScreen mode="student" />);
    expect(await screen.findByText("Élève introuvable.")).toBeTruthy();
  });
});

describe("QuickEntryScreen : saisie rapide mobile-first", () => {
  it("incident en trois gestes (classe, élève, texte) : l'élève part comme INSCRIPTION, aucun déclarant dans le corps", async () => {
    const api = setTestApi({
      ...accessRoutes(["schoollife.read", "schoollife.incident.write", "schoollife.note.write", "academic.classroom.read", "attendance.take"]),
      [`GET ${S}/reference`]: referenceDto(),
      "GET /api/v1/academic/classrooms": { items: [classroom({ id: IDS.classroom, name: "6e A" })], total: 1, page: 1, pageSize: 200 },
      "GET /api/v1/people/students": {
        items: [{ id: IDS.student, personId: uuid(31), studentNumber: "E1", sequenceNumber: 1, lastName: "KOUASSI", firstName: "Awa", displayName: "KOUASSI Awa", sex: "F", status: "ACTIVE", hasPhoto: false, currentEnrollment: { enrollmentId: IDS.enrollment, academicYearId: IDS.year, institutionId: IDS.institution, classroomId: IDS.classroom, classroomName: "6e A", status: "ACTIVE", registrationNumber: null } }],
        total: 1,
        limit: 200,
        offset: 0,
      },
      [`POST ${S}/incidents`]: () => json(incidentDto(), { status: 201 }),
    });
    renderWithProviders(<QuickEntryScreen />);
    expect((await screen.findByRole("link", { name: "Ouvrir l'appel" })).getAttribute("href")).toBe("/v2/attendance/call");
    fireEvent.click(await screen.findByRole("button", { name: /Déclarer un incident/ }));
    const dialog = await screen.findByRole("dialog");
    await waitFor(() => expect((within(dialog).getByLabelText(/^Classe/) as HTMLSelectElement).options.length).toBeGreaterThan(1));
    fireEvent.change(within(dialog).getByLabelText(/^Classe/), { target: { value: IDS.classroom } });
    await waitFor(() => expect((within(dialog).getByLabelText(/^Élève/) as HTMLSelectElement).options.length).toBeGreaterThan(1));
    fireEvent.change(within(dialog).getByLabelText(/^Élève/), { target: { value: IDS.student } });
    fireEvent.change(within(dialog).getByLabelText(/^Type/), { target: { value: IDS.typeInc } });
    fireEvent.change(within(dialog).getByLabelText(/Description des faits/), { target: { value: "ab" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Déclarer l'incident" }));
    expect(await within(dialog).findAllByRole("alert")).not.toHaveLength(0);
    expect(api.calls.filter((c) => c.method === "POST")).toHaveLength(0);
    fireEvent.change(within(dialog).getByLabelText(/Description des faits/), { target: { value: "Altercation dans la cour" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Déclarer l'incident" }));
    await waitFor(() => expect(api.calls.some((c) => c.method === "POST")).toBe(true));
    const body = api.calls.find((c) => c.method === "POST")!.body as Record<string, unknown>;
    expect(body).toMatchObject({ typeId: IDS.typeInc, description: "Altercation dans la cour", involvements: [{ enrollmentId: IDS.enrollment, role: "AUTHOR" }] });
    expect(Object.keys(body)).not.toContain("reportedBy");
    expect(Object.keys(body)).not.toContain("studentId");
    expect(await screen.findByText("Incident enregistré.")).toBeTruthy();
  });

  it("un enseignant qui ne peut que rédiger une note n'a pas le bouton d'incident", async () => {
    setTestApi({ ...accessRoutes(["schoollife.read", "schoollife.note.write"]), [`GET ${S}/reference`]: referenceDto() });
    renderWithProviders(<QuickEntryScreen />);
    expect(await screen.findByRole("button", { name: /Encourager un élève/ })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Déclarer un incident/ })).toBeNull();
  });
});

describe("SettingsScreen : tout est donnée d'établissement", () => {
  const baseRoutes = (perms: string[], ref = referenceDto({ eventTypes: [], severityLevels: [] }), extra: Record<string, unknown> = {}) => ({
    ...accessRoutes(perms, ["schoollife.core", "schoollife.conduct-points"]),
    [`GET ${S}/reference`]: ref,
    "GET /api/v1/tenancy/institutions": { items: [{ id: IDS.institution, tenantId: uuid(2), code: "COLLEGE", name: "Collège Les Palmiers", pack: "SECONDARY", educationSystem: "CI", countryCode: "CI", status: "ACTIVE", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" }] },
    [`GET ${S}/conduct-scales`]: { items: [] },
    ...extra,
  });

  it("listes vides par défaut : aucune valeur livrée, avec explication", async () => {
    setTestApi(baseRoutes(["schoollife.settings.manage"]));
    renderWithProviders(<SettingsScreen />);
    expect(await screen.findByText("Aucun type d'événement.")).toBeTruthy();
    expect(screen.getByText("Aucun niveau de gravité.")).toBeTruthy();
    expect(screen.getByText(/Aucune valeur n'est fournie par défaut/)).toBeTruthy();
    // sans la permission de gérer les barèmes : section absente
    expect(screen.queryByRole("heading", { name: "Barèmes de points de conduite" })).toBeNull();
  });

  it("type d'événement : une exclusion temporaire impose la validation ; le corps respecte le contrat strict", async () => {
    const api = setTestApi(baseRoutes(["schoollife.settings.manage"], undefined, { [`PUT ${S}/event-types`]: () => json(referenceDto().eventTypes[2]) }));
    renderWithProviders(<SettingsScreen />);
    const section = (await screen.findByRole("heading", { name: "Types d'événements" })).closest("section")!;
    fireEvent.click(within(section).getByRole("button", { name: "Ajouter un type" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText(/^Code/), { target: { value: "exclusion_x" } });
    fireEvent.change(within(dialog).getByLabelText(/^Libellé/), { target: { value: "Exclusion temporaire" } });
    fireEvent.change(within(dialog).getByLabelText(/^Famille/), { target: { value: "TEMP_EXCLUSION" } });
    expect(await within(dialog).findByText("Une exclusion temporaire est toujours validée.")).toBeTruthy();
    expect((within(dialog).getByLabelText(/Validation exigée/) as HTMLInputElement).checked).toBe(true);
    expect((within(dialog).getByLabelText(/Validation exigée/) as HTMLInputElement).disabled).toBe(true);
    fireEvent.click(within(dialog).getByLabelText(/Séparation des tâches/));
    fireEvent.click(within(dialog).getByRole("button", { name: "Enregistrer" }));
    await waitFor(() => expect(api.calls.some((c) => c.method === "PUT")).toBe(true));
    expect(api.calls.find((c) => c.method === "PUT")?.body).toMatchObject({ code: "EXCLUSION_X", label: "Exclusion temporaire", kind: "TEMP_EXCLUSION", requiresValidation: true, requiresFourEyes: true, confidentialityDefault: "STANDARD" });
  });

  it("barème : créé en brouillon, valeurs par type (ni incident ni observation), activation seulement avec des valeurs ; démonstration signalée", async () => {
    const scale = { id: uuid(401), institutionId: IDS.institution, code: "DEMO", label: "Barème de démonstration", gradeLevelId: null, initialPoints: 20, minPoints: 0, maxPoints: 20, resetScope: "YEAR", effectiveFrom: "2026-09-01", effectiveTo: null, status: "DRAFT", sourceKind: "placeholder", isPlaceholder: true, items: [] };
    const api = setTestApi(
      baseRoutes(["schoollife.settings.manage", "schoollife.conduct.manage"], referenceDto(), {
        [`GET ${S}/conduct-scales`]: { items: [scale] },
        [`PUT ${S}/conduct-scales/${uuid(401)}/items`]: () => json({ ...scale, items: [{ eventTypeId: IDS.typeSanc, eventTypeLabel: "Type SANC", pointsDelta: -3 }] }),
      }),
    );
    renderWithProviders(<SettingsScreen />);
    expect((await screen.findByRole("button", { name: "Activer" })).hasAttribute("disabled")).toBe(true); // aucune valeur : pas d'activation
    expect(screen.getAllByText("Démonstration").length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole("button", { name: "Valeurs par type" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).queryByLabelText(/Type INC/)).toBeNull(); // un incident n'a pas de valeur en points
    expect(within(dialog).queryByLabelText(/Type OBS/)).toBeNull();
    fireEvent.change(within(dialog).getByLabelText(/Type SANC/), { target: { value: "0" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Enregistrer les valeurs" }));
    expect(await within(dialog).findByText("Chaque valeur est un entier non nul.")).toBeTruthy();
    fireEvent.change(within(dialog).getByLabelText(/Type SANC/), { target: { value: "-3" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Enregistrer les valeurs" }));
    await waitFor(() => expect(api.calls.find((c) => c.method === "PUT")?.body).toEqual({ items: [{ eventTypeId: IDS.typeSanc, pointsDelta: -3 }] }));
  });
});

describe("ConvocationsScreen : convocations des tuteurs", () => {
  it("envoi par les canaux choisis (corps exact) ; une convocation envoyée se tient, se reporte ou s'annule avec un motif", async () => {
    const api = setTestApi({
      ...accessRoutes(["schoollife.convocation.manage", "schoollife.read"]),
      [`GET ${S}/convocations`]: { items: [convocationDto(), convocationDto({ id: uuid(8502), status: "SENT", sentAt: "2026-11-20T08:00:00.000Z" })] },
      [`POST ${S}/convocations/${uuid(8501)}/send`]: () => json(convocationDto({ status: "SENT" })),
      [`POST ${S}/convocations/${uuid(8502)}/cancel`]: () => json(convocationDto({ id: uuid(8502), status: "CANCELLED" })),
    });
    renderWithProviders(<ConvocationsScreen />);
    const list = await screen.findByRole("list", { name: "Convocations" });
    const draft = within(list).getAllByRole("listitem")[0]!;
    fireEvent.click(within(draft).getByRole("button", { name: "Envoyer" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByLabelText("SMS"));
    fireEvent.click(within(dialog).getByRole("button", { name: "Envoyer" }));
    await waitFor(() => expect(api.calls.find((c) => c.path.endsWith("/send"))?.body).toEqual({ channels: ["IN_APP", "EMAIL", "SMS"] }));
    const sent = within(list).getAllByRole("listitem")[1]!;
    expect(within(sent).getByRole("button", { name: "Entretien tenu" })).toBeTruthy();
    expect(within(draft).queryByRole("button", { name: "Entretien tenu" })).toBeNull(); // un brouillon ne se « tient » pas
    fireEvent.click(within(sent).getByRole("button", { name: "Annuler" }));
    const reason = await screen.findByRole("dialog");
    fireEvent.change(within(reason).getByLabelText(/Motif de l'annulation/), { target: { value: "Famille indisponible" } });
    fireEvent.click(within(reason).getByRole("button", { name: "Annuler la convocation" }));
    await waitFor(() => expect(api.calls.find((c) => c.path.endsWith("/cancel"))?.body).toEqual({ reason: "Famille indisponible" }));
  });
});

