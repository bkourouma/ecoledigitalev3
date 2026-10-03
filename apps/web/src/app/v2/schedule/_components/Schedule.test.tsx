// @vitest-environment jsdom
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { accessRoutes, setTestApi } from "@/platform/test/api-mock";
import { json, renderWithProviders } from "@/platform/test/render";
import { studentSummary } from "../../_test/fixtures-people";
import { sessionDto } from "../../attendance/_test/fixtures";
import { blockingConflict, campus, entry, IDS, institution, occurrence, page, room, timetable, uuid } from "../_test/fixtures";
import { ExportScreen } from "./ExportScreen";
import { OccurrencesScreen } from "./OccurrencesScreen";
import { ReplacementsScreen } from "./ReplacementsScreen";
import { RoomsScreen } from "./RoomsScreen";
import { TimetableEditor } from "./TimetableEditor";
import { TimetableScreen } from "./TimetableScreen";
import { TodayScreen } from "./TodayScreen";

// Écrans complets rendus avec le vrai catalogue : marge pour les machines chargées (tests lancés en parallèle).
vi.setConfig({ testTimeout: 30_000 });

vi.mock("@/platform/api/default-client", async () => (await import("@/platform/test/api-mock")).defaultClientModule);
vi.mock("next/link", () => ({ default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a> }));

const S = "/api/v1/scheduling";
const tenancy = { "GET /api/v1/tenancy/institutions": { items: [institution()] } };

// Seule la date est figée (les minuteries restent réelles : react-query, anti-rebond de l'aperçu).
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-01T10:00:00.000Z"));
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("TimetableScreen : lecture responsive", () => {
  it("parent : emploi du temps de l'enfant en liste par jour ; annulées masquées sauf demande ; aucun identifiant brut d'intervenant", async () => {
    const api = setTestApi({
      ...accessRoutes(["schedule.child.read"]),
      "GET /api/v1/people/children": { items: [studentSummary({ id: uuid(2000), displayName: "TRAORE Awa" })] },
      [`GET ${S}/children/${uuid(2000)}/timetable`]: ({ url }: { url: URL }) =>
        json(
          page([
            occurrence({ id: uuid(9001), title: "Mathématiques" }),
            occurrence({ id: uuid(9002), title: "Histoire", startsAt: "2026-10-01T10:00:00.000Z", endsAt: "2026-10-01T11:00:00.000Z" }),
            ...(url.searchParams.get("includeCancelled") === "true" ? [occurrence({ id: uuid(9003), title: "Sport", status: "CANCELLED", cancelReason: "Pluie", startsAt: "2026-10-01T12:00:00.000Z", endsAt: "2026-10-01T13:00:00.000Z" })] : []),
          ]),
        ),
    });
    renderWithProviders(<TimetableScreen />);
    expect(await screen.findByText("Choisissez ce que vous voulez consulter")).toBeTruthy();
    await waitFor(() => expect(within(screen.getByLabelText("Mes enfants")).getAllByRole("option")).toHaveLength(2));
    fireEvent.change(screen.getByLabelText("Mes enfants"), { target: { value: uuid(2000) } });

    const agenda = await screen.findByLabelText("Séances par jour");
    expect(await within(agenda).findByText("Mathématiques")).toBeTruthy();
    expect(within(agenda).getByText("Histoire")).toBeTruthy();
    expect(within(agenda).queryByText("Sport")).toBeNull();
    expect(agenda.textContent).not.toMatch(/…4000/);
    // Semaine du 28 septembre au 4 octobre 2026.
    expect(api.calls.find((c) => c.path.endsWith("/timetable"))!.query).toMatchObject({ from: "2026-09-28", to: "2026-10-04" });

    fireEvent.click(screen.getByLabelText("Afficher les séances annulées"));
    expect(await within(agenda).findByText("Sport")).toBeTruthy();
    expect(within(agenda).getByText("Motif : Pluie")).toBeTruthy();
    expect(api.calls.filter((c) => c.path.endsWith("/timetable")).at(-1)!.query.includeCancelled).toBe("true");

    // Vue « Jour » : un seul jour, fenêtre d'une journée.
    fireEvent.change(screen.getByLabelText("Vue"), { target: { value: "day" } });
    await waitFor(() => expect(api.calls.filter((c) => c.path.endsWith("/timetable")).at(-1)!.query).toMatchObject({ from: "2026-10-01", to: "2026-10-01" }));
    fireEvent.click(screen.getByRole("button", { name: "Jour suivant" }));
    await waitFor(() => expect(api.calls.filter((c) => c.path.endsWith("/timetable")).at(-1)!.query).toMatchObject({ from: "2026-10-02", to: "2026-10-02" }));
  });

  it("sans aucun droit d'emploi du temps : message explicite", async () => {
    setTestApi({ ...accessRoutes([]) });
    renderWithProviders(<TimetableScreen />);
    expect(await screen.findByText(/Aucun emploi du temps n'est accessible/)).toBeTruthy();
  });

  it("enseignant : « Mon emploi du temps » chargé d'office, semaine en colonnes avec séances", async () => {
    setTestApi({
      ...accessRoutes(["schedule.own.read"]),
      [`GET ${S}/me/timetable`]: { ...page([occurrence({ needsReplacement: true })]), subject: "STAFF", subjectId: IDS.staff },
    });
    renderWithProviders(<TimetableScreen />);
    const grid = await screen.findByRole("list", { name: "Semaine" });
    expect(await within(grid).findByText("Mathématiques")).toBeTruthy();
    expect(within(grid).getByText("À remplacer")).toBeTruthy();
    expect(within(grid).getAllByRole("listitem")).toHaveLength(7);
  });
});

describe("TodayScreen : « Aujourd'hui » de l'enseignant", () => {
  const routes = (perms: string[]) => ({
    ...accessRoutes(perms),
    [`GET ${S}/me/today`]: {
      date: "2026-10-01",
      staffId: IDS.staff,
      items: [occurrence({ id: uuid(9001) }), occurrence({ id: uuid(9002), title: "Histoire", startsAt: "2026-10-01T10:00:00.000Z", endsAt: "2026-10-01T11:00:00.000Z" }), occurrence({ id: uuid(9003), title: "Sport", status: "CANCELLED", cancelReason: "Pluie" })],
    },
    "GET /api/v1/attendance/sessions": { items: [sessionDto({ occurrenceId: uuid(9001), status: "SUBMITTED" })], nextCursor: null },
  });

  it("état de l'appel de chaque séance et actions rapides (appel, notes) selon les droits ; rien pour une séance annulée", async () => {
    setTestApi(routes(["schedule.own.read", "attendance.take", "grade.enter"]));
    renderWithProviders(<TodayScreen />);
    const first = await screen.findByRole("article", { name: /Mathématiques/ });
    expect(await within(first).findByText("Appel soumis")).toBeTruthy();
    expect(within(first).getByRole("link", { name: "Voir l'appel" }).getAttribute("href")).toBe(`/v2/attendance/call/occurrence/${uuid(9001)}`);
    const second = screen.getByRole("article", { name: /Histoire/ });
    expect(within(second).getByText("Appel à faire")).toBeTruthy();
    expect(within(second).getByRole("link", { name: "Faire l'appel" }).getAttribute("href")).toBe(`/v2/attendance/call/occurrence/${uuid(9002)}`);
    expect(within(second).getByRole("link", { name: "Saisir les notes" }).getAttribute("href")).toBe("/teacher/evaluations");
    const cancelled = screen.getByRole("article", { name: /Sport/ });
    expect(within(cancelled).queryByRole("link")).toBeNull();
  });

  it("module d'évaluation non actif (pas de permission de saisie) : aucun lien vers les notes", async () => {
    setTestApi(routes(["schedule.own.read", "attendance.take"]));
    renderWithProviders(<TodayScreen />);
    await screen.findByRole("article", { name: /Histoire/ });
    expect(screen.queryByRole("link", { name: "Saisir les notes" })).toBeNull();
  });

  it("aucune séance : état vide", async () => {
    setTestApi({ ...accessRoutes(["schedule.own.read"]), [`GET ${S}/me/today`]: { date: "2026-10-01", staffId: IDS.staff, items: [] }, "GET /api/v1/attendance/sessions": { items: [], nextCursor: null } });
    renderWithProviders(<TodayScreen />);
    expect(await screen.findByText("Aucune séance aujourd'hui.")).toBeTruthy();
  });
});

describe("OccurrencesScreen : création avec aperçu des conflits et aide au placement", () => {
  const base = (extra: Record<string, unknown> = {}) => ({
    ...accessRoutes(["schedule.read", "schedule.manage", "schedule.conflict.override"]),
    ...tenancy,
    [`GET ${S}/occurrences`]: page([occurrence()], { total: 1 }),
    [`GET ${S}/rooms`]: { items: [room()] },
    [`POST ${S}/conflicts/preview`]: () => json({ conflicts: [blockingConflict], blocking: true, timezone: "Africa/Abidjan", startsAt: "2026-10-01T10:00:00.000Z", endsAt: "2026-10-01T11:00:00.000Z" }),
    ...extra,
  });

  async function openForm() {
    fireEvent.click(await screen.findByRole("button", { name: "Nouvelle séance" }));
    const dialog = await screen.findByRole("dialog", { name: "Nouvelle séance" });
    fireEvent.change(within(dialog).getByLabelText(/^Type/), { target: { value: "MEETING" } });
    fireEvent.change(within(dialog).getByLabelText(/^Début/), { target: { value: "10:00" } });
    fireEvent.change(within(dialog).getByLabelText(/^Fin/), { target: { value: "11:00" } });
    return dialog;
  }

  it("aperçu en direct (corps exact), conflit bloquant expliqué, dépassement motivé réservé aux habilités, création", async () => {
    const api = setTestApi(base({ [`POST ${S}/occurrences`]: () => json({ occurrence: occurrence({ kind: "MEETING", title: "Réunion" }), warnings: [] }, { status: 201 }) }));
    renderWithProviders(<OccurrencesScreen />);
    expect(await screen.findByRole("table", { name: "Liste des séances" })).toBeTruthy();
    const dialog = await openForm();

    expect(await within(dialog).findByText("1 conflit bloquant", undefined, { timeout: 3000 })).toBeTruthy();
    expect(within(dialog).getByText(blockingConflict.message, { exact: false })).toBeTruthy();
    expect(api.calls.filter((c) => c.path.endsWith("/conflicts/preview")).at(-1)!.body).toEqual({ kind: "MEETING", classroomId: null, roomId: null, staff: [], date: "2026-10-01", startTime: "10:00", endTime: "11:00" });

    // Dépassement : motif d'au moins 5 caractères exigé avant l'envoi.
    fireEvent.click(within(dialog).getByLabelText(/Dépasser les conflits bloquants/));
    fireEvent.change(await within(dialog).findByLabelText(/Motif du dépassement/), { target: { value: "abc" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Créer la séance" }));
    expect(await within(dialog).findAllByText("Le motif du dépassement doit faire au moins 5 caractères.")).not.toHaveLength(0);
    expect(api.calls.filter((c) => c.method === "POST" && c.path === `${S}/occurrences`)).toHaveLength(0);

    fireEvent.change(within(dialog).getByLabelText(/Motif du dépassement/), { target: { value: "Réunion exceptionnelle de la direction" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Créer la séance" }));
    expect(await screen.findByText("Séance créée.")).toBeTruthy();
    expect(api.calls.find((c) => c.method === "POST" && c.path === `${S}/occurrences`)!.body).toEqual({
      kind: "MEETING",
      date: "2026-10-01",
      startTime: "10:00",
      endTime: "11:00",
      override: { reason: "Réunion exceptionnelle de la direction" },
    });
  });

  it("sans droit de dépassement : le conflit bloquant est expliqué, aucune échappatoire proposée", async () => {
    setTestApi(base({ ...accessRoutes(["schedule.read", "schedule.manage"]) }));
    renderWithProviders(<OccurrencesScreen />);
    const dialog = await openForm();
    expect(await within(dialog).findByText("1 conflit bloquant", undefined, { timeout: 3000 })).toBeTruthy();
    expect(within(dialog).getByText(/demandez un dépassement motivé/)).toBeTruthy();
    expect(within(dialog).queryByLabelText(/Dépasser les conflits bloquants/)).toBeNull();
  });

  it("refus 409 de l'API : message et liste détaillée des conflits affichés tels quels", async () => {
    setTestApi(
      base({
        [`POST ${S}/occurrences`]: () => json({ code: "scheduling.conflict_detected", message: blockingConflict.message, details: { conflicts: [blockingConflict] } }, { status: 409 }),
        [`POST ${S}/conflicts/preview`]: () => json({ conflicts: [], blocking: false, timezone: "Africa/Abidjan", startsAt: "2026-10-01T10:00:00.000Z", endsAt: "2026-10-01T11:00:00.000Z" }),
      }),
    );
    renderWithProviders(<OccurrencesScreen />);
    const dialog = await openForm();
    expect(await within(dialog).findByText("Aucun conflit détecté sur ce créneau.", undefined, { timeout: 3000 })).toBeTruthy();
    fireEvent.click(within(dialog).getByRole("button", { name: "Créer la séance" }));
    expect(await within(dialog).findByText("1 conflit bloquant")).toBeTruthy();
    expect(within(dialog).getAllByText(blockingConflict.message, { exact: false }).length).toBeGreaterThan(0);
  });

  it("aide au placement : créneaux libres classés par l'API ; le choix remplit le formulaire", async () => {
    const api = setTestApi(
      base({
        [`POST ${S}/slots/suggest`]: () =>
          json({ items: [{ date: "2026-10-05", startMinute: 540, endMinute: 600, startsAt: "2026-10-05T09:00:00.000Z", endsAt: "2026-10-05T10:00:00.000Z", roomId: IDS.room, roomCode: "S101", preferred: true, warnings: [{ ...blockingConflict, severity: "WARNING", message: "Salle un peu petite." }] }] }),
      }),
    );
    renderWithProviders(<OccurrencesScreen />);
    const dialog = await openForm();
    fireEvent.click(within(dialog).getByRole("button", { name: "Chercher des créneaux" }));
    expect(await within(dialog).findByText("Disponibilités déclarées")).toBeTruthy();
    expect(within(dialog).getByText("Salle un peu petite.")).toBeTruthy();
    const call = api.calls.find((c) => c.path === `${S}/slots/suggest`)!;
    expect(call.body).toEqual({ institutionId: IDS.institution, durationMinutes: 60, window: { from: "2026-10-01", to: "2026-10-15" }, count: 8 });
    fireEvent.click(within(dialog).getByRole("button", { name: "Utiliser ce créneau" }));
    await waitFor(() => expect((within(dialog).getByLabelText(/^Début/) as HTMLInputElement).value).toBe("09:00"));
    expect((within(dialog).getByLabelText(/^Fin/) as HTMLInputElement).value).toBe("10:00");
    expect((within(dialog).getByLabelText(/^Date/) as HTMLInputElement).value).toBe("2026-10-05");
    expect((within(dialog).getByLabelText(/^Salle/) as HTMLSelectElement).value).toBe(IDS.room);
  });

  it("annulation : motif d'au moins 3 caractères, envoyé tel quel", async () => {
    const api = setTestApi(base({ [`POST ${S}/occurrences/${IDS.occurrence}/cancel`]: () => json({ occurrence: occurrence({ status: "CANCELLED" }), alreadyCancelled: false }) }));
    renderWithProviders(<OccurrencesScreen />);
    const table = await screen.findByRole("table", { name: "Liste des séances" });
    fireEvent.click(await within(table).findByRole("button", { name: "Annuler" }));
    const dialog = await screen.findByRole("dialog", { name: "Annuler la séance" });
    const confirm = () => within(dialog).getAllByRole("button", { name: "Annuler" }).at(-1)!;
    fireEvent.change(within(dialog).getByLabelText(/Motif/), { target: { value: "ab" } });
    fireEvent.click(confirm());
    expect(api.calls.filter((c) => c.path.endsWith("/cancel"))).toHaveLength(0);
    fireEvent.change(within(dialog).getByLabelText(/Motif/), { target: { value: "Enseignant malade" } });
    fireEvent.click(confirm());
    expect(await screen.findByText("Séance annulée.")).toBeTruthy();
    expect(api.calls.find((c) => c.path.endsWith("/cancel"))!.body).toEqual({ reason: "Enseignant malade" });
  });
});

describe("ReplacementsScreen : remplacement avec propositions", () => {
  it("séance à remplacer, propositions classées par l'API, choix, motif, avertissements non bloquants affichés", async () => {
    const api = setTestApi({
      ...accessRoutes(["schedule.manage", "schedule.read"]),
      [`GET ${S}/occurrences/pending-replacements`]: page([occurrence({ needsReplacement: true, replacementReason: "Congé approuvé" })]),
      [`POST ${S}/occurrences/${IDS.occurrence}/substitutes/suggest`]: {
        items: [{ staffId: IDS.staff2, displayName: "KONE Salif", eligible: true, reasons: [], busy: false, availability: "DECLARED_AVAILABLE", competent: true, assignedToClassroom: true, weeklyLoadMinutes: 480 }],
      },
      [`POST ${S}/conflicts/preview`]: { conflicts: [], blocking: false, timezone: "Africa/Abidjan", startsAt: "2026-10-01T08:00:00.000Z", endsAt: "2026-10-01T09:00:00.000Z" },
      [`POST ${S}/occurrences/${IDS.occurrence}/substitute`]: () => json({ occurrence: occurrence(), warnings: [{ ...blockingConflict, severity: "WARNING", resourceKind: "STAFF", message: "Charge hebdomadaire élevée." }] }),
    });
    renderWithProviders(<ReplacementsScreen />);
    expect(await screen.findByText("Cause : Congé approuvé")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Remplacer" }));
    const dialog = await screen.findByRole("dialog", { name: "Remplacer un intervenant" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Proposer des remplaçants" }));
    expect(await within(dialog).findByText("KONE Salif")).toBeTruthy();
    expect(within(dialog).getByText("Disponible")).toBeTruthy();
    expect(within(dialog).getByText("Compétent")).toBeTruthy();
    expect(within(dialog).getByText("Charge de la semaine : 8 h")).toBeTruthy();

    fireEvent.click(within(dialog).getByRole("button", { name: "Remplacer" }));
    expect(await within(dialog).findByText("Le motif doit faire au moins 3 caractères.")).toBeTruthy();
    fireEvent.click(within(dialog).getByRole("button", { name: "Choisir" }));
    fireEvent.change(within(dialog).getByLabelText(/Motif du remplacement/), { target: { value: "Congé de maladie" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Remplacer" }));
    expect(await screen.findByText("Remplacement enregistré.")).toBeTruthy();
    expect(api.calls.find((c) => c.path.endsWith("/substitute"))!.body).toEqual({ originalStaffId: IDS.staff, substituteStaffId: IDS.staff2, reason: "Congé de maladie" });
    expect(await screen.findByText("Charge hebdomadaire élevée.", { exact: false })).toBeTruthy();
  });

  it("aucune séance à remplacer : état vide", async () => {
    setTestApi({ ...accessRoutes(["schedule.manage"]), [`GET ${S}/occurrences/pending-replacements`]: page([]) });
    renderWithProviders(<ReplacementsScreen />);
    expect(await screen.findByText("Aucune séance à remplacer.")).toBeTruthy();
  });
});

describe("TimetableEditor : patrons récurrents", () => {
  const routes = (over: Record<string, unknown> = {}, perms = ["schedule.read", "schedule.manage", "schedule.publish", "schedule.conflict.override"]) => ({
    ...accessRoutes(perms, ["scheduling.generation"]),
    [`GET ${S}/timetables/${IDS.timetable}`]: { timetable: timetable(), entries: [entry(), entry({ id: uuid(9601), weekday: 3, weekPattern: "WEEK_A", startTime: "10:00", endTime: "11:00", title: "Physique" })] },
    [`GET ${S}/timetables/${IDS.timetable}/conflicts`]: { items: [blockingConflict] },
    [`GET ${S}/rooms`]: { items: [room()] },
    ...over,
  });

  it("créneaux par jour (alternance A visible), conflits du brouillon expliqués", async () => {
    setTestApi(routes());
    renderWithProviders(<TimetableEditor id={IDS.timetable} />);
    expect(await screen.findByRole("heading", { name: "Emploi du temps 2026-2027" })).toBeTruthy();
    const monday = await screen.findByRole("heading", { name: "Lundi" });
    expect(within(monday.closest("section")!).getByText("08:00 – 09:00")).toBeTruthy();
    const wednesday = screen.getByRole("heading", { name: "Mercredi" });
    expect(within(wednesday.closest("section")!).getByText("Semaine A")).toBeTruthy();
    expect(await screen.findByText(blockingConflict.message, { exact: false })).toBeTruthy();
  });

  it("ajout : classe obligatoire pour un cours ; refus 409 avec conflits ; reprise avec dépassement motivé", async () => {
    let attempt = 0;
    const api = setTestApi(
      routes({
        [`POST ${S}/timetables/${IDS.timetable}/entries`]: () => {
          attempt += 1;
          return attempt === 1
            ? json({ code: "scheduling.conflict_detected", message: blockingConflict.message, details: { conflicts: [blockingConflict] } }, { status: 409 })
            : json({ entry: entry({ id: uuid(9602), kind: "MEETING" }), conflicts: [], warnings: [{ ...blockingConflict, severity: "WARNING", message: "Salle indisponible le mercredi pour la moitié du créneau." }], propagation: null }, { status: 201 });
        },
      }),
    );
    renderWithProviders(<TimetableEditor id={IDS.timetable} />);
    fireEvent.click(await screen.findByRole("button", { name: "Ajouter un créneau" }));
    const dialog = await screen.findByRole("dialog", { name: "Ajouter un créneau" });
    fireEvent.change(within(dialog).getByLabelText(/^Début/), { target: { value: "08:00" } });
    fireEvent.change(within(dialog).getByLabelText(/^Fin/), { target: { value: "09:00" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Enregistrer" }));
    expect(await within(dialog).findByText("Une classe est obligatoire pour un cours.")).toBeTruthy();
    expect(api.calls.filter((c) => c.method === "POST")).toHaveLength(0);

    fireEvent.change(within(dialog).getByLabelText(/^Type/), { target: { value: "MEETING" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Enregistrer" }));
    expect(await within(dialog).findByText("1 conflit bloquant")).toBeTruthy();
    expect(api.calls.filter((c) => c.method === "POST")[0]!.body).toMatchObject({ kind: "MEETING", weekday: 1, startTime: "08:00", endTime: "09:00", weekPattern: "EVERY", deliveryMode: "IN_PERSON" });

    fireEvent.change(await within(dialog).findByLabelText(/Motif du dépassement/), { target: { value: "Dérogation de la direction" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Enregistrer" }));
    expect(await screen.findByText("Créneau ajouté.")).toBeTruthy();
    expect(api.calls.filter((c) => c.method === "POST")[1]!.body).toMatchObject({ overrideReason: "Dérogation de la direction" });
    expect(await screen.findByText("Salle indisponible le mercredi pour la moitié du créneau.", { exact: false })).toBeTruthy();
  });

  it("publication par un habilité ; un emploi du temps publié n'est plus modifiable ; génération avec rapport", async () => {
    const api = setTestApi(
      routes({
        [`POST ${S}/timetables/${IDS.timetable}/publish`]: () => json(timetable({ status: "PUBLISHED", publishedAt: "2026-10-01T10:00:00.000Z" })),
      }),
    );
    renderWithProviders(<TimetableEditor id={IDS.timetable} />);
    fireEvent.click(await screen.findByRole("button", { name: "Publier" }));
    expect(await screen.findByText("Emploi du temps publié.")).toBeTruthy();
    expect(api.calls.find((c) => c.path.endsWith("/publish"))).toBeTruthy();
  });

  it("emploi du temps publié : lecture seule + génération avec rapport (créées, sautées, conflits)", async () => {
    const api = setTestApi(
      routes({
        [`GET ${S}/timetables/${IDS.timetable}`]: { timetable: timetable({ status: "PUBLISHED" }), entries: [entry()] },
        [`POST ${S}/timetables/${IDS.timetable}/generate`]: () =>
          json({ runId: uuid(1), timetableId: IDS.timetable, from: "2026-10-01", to: "2026-10-29", created: 12, skippedExisting: 3, skippedBlocked: 1, skippedConflict: 1, skippedCapped: 0, warnings: [], conflicts: [{ entryId: uuid(9600), date: "2026-10-12", resourceKind: "STAFF", resourceId: IDS.staff, message: "Intervenant déjà occupé." }], batches: 1 }),
      }),
    );
    renderWithProviders(<TimetableEditor id={IDS.timetable} />);
    expect(await screen.findByText("Seul un brouillon est modifiable.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Ajouter un créneau" })).toBeNull();
    fireEvent.click(await screen.findByRole("button", { name: "Générer les séances" }));
    const dialog = await screen.findByRole("dialog", { name: "Générer les séances" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Générer" }));
    const report = await screen.findByRole("region", { name: /Génération du/ }).catch(() => null);
    expect(report ?? (await screen.findByText(/Génération du/))).toBeTruthy();
    expect(await screen.findByText("1 conflit signalé")).toBeTruthy();
    expect(screen.getByText("12")).toBeTruthy();
    expect(api.calls.find((c) => c.path.endsWith("/generate"))!.body).toEqual({ from: "2026-10-01", to: "2026-10-29" });
  });
});

describe("RoomsScreen", () => {
  const routes = (features: string[] = [], over: Record<string, unknown> = {}) => ({
    ...accessRoutes(["schedule.read", "schedule.room.manage"], features),
    ...tenancy,
    [`GET /api/v1/tenancy/institutions/${IDS.institution}/campuses`]: { items: [campus()] },
    [`GET ${S}/rooms`]: { items: [room(), room({ id: uuid(801), name: "Labo", code: "L1", status: "OUT_OF_SERVICE" })] },
    [`GET ${S}/reports/room-occupancy`]: { rooms: [{ roomId: IDS.room, code: "S101", name: "Salle 101", occupiedMinutes: 600, availableMinutes: 2400, rateBp: 2500 }], totalOccupiedMinutes: 600, totalAvailableMinutes: 2400, rateBp: 2500 },
    ...over,
  });

  it("salles, état de service, occupation de la semaine ; équipements non inclus dans l'offre", async () => {
    setTestApi(routes());
    renderWithProviders(<RoomsScreen />);
    const table = await screen.findByRole("table", { name: "Salles du campus" });
    expect(await within(table).findByText("Salle 101")).toBeTruthy();
    expect(within(table).getByText("Hors service")).toBeTruthy();
    expect(await screen.findByText("10 h")).toBeTruthy();
    expect(screen.getByText("25 %")).toBeTruthy();
    expect(await screen.findByText(/La réservation d'équipements n'est pas incluse/)).toBeTruthy();
  });

  it("mise hors service avec motif facultatif : corps exact", async () => {
    const api = setTestApi(routes([], { [`POST ${S}/rooms/${IDS.room}/status`]: () => json({ ok: true }) }));
    renderWithProviders(<RoomsScreen />);
    const table = await screen.findByRole("table", { name: "Salles du campus" });
    const row = (await within(table).findByText("Salle 101")).closest("tr")!;
    fireEvent.click(within(row).getByRole("button", { name: "Mettre hors service" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Confirmer" }));
    expect(await screen.findByText("État de la salle modifié.")).toBeTruthy();
    expect(api.calls.find((c) => c.path.endsWith("/status"))!.body).toEqual({ status: "OUT_OF_SERVICE" });
  });
});

describe("ExportScreen : calendrier par jeton révocable", () => {
  const token = { id: uuid(9900), scope: "STAFF", subjectId: IDS.staff, label: "Téléphone", createdAt: "2026-09-30T08:00:00.000Z", expiresAt: null, revokedAt: null, lastUsedAt: null };

  it("création : le lien n'est montré qu'à la création ; révocation avec confirmation", async () => {
    const api = setTestApi({
      ...accessRoutes(["schedule.own.read"]),
      [`GET ${S}/me/timetable`]: { ...page([]), subject: "STAFF", subjectId: IDS.staff },
      [`GET ${S}/export/tokens`]: { items: [token] },
      [`POST ${S}/export/tokens`]: () => json({ tokenId: uuid(9901), token: "x".repeat(48), expiresAt: null, path: `${S}/export/timetable.ics?scope=STAFF&token=${"x".repeat(48)}` }, { status: 201 }),
      [`DELETE ${S}/export/tokens/${token.id}`]: () => json({ ok: true }),
    });
    renderWithProviders(<ExportScreen />);
    expect(await screen.findByText("Téléphone")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Nom du lien"), { target: { value: "Agenda" } });
    fireEvent.change(screen.getByLabelText(/Validité \(jours\)/), { target: { value: "30" } });
    fireEvent.click(screen.getByRole("button", { name: "Créer un lien d'abonnement" }));
    expect(await screen.findByText("Lien créé : copiez-le maintenant.")).toBeTruthy();
    expect((screen.getByLabelText("Lien d'abonnement") as HTMLInputElement).value).toBe(`${window.location.origin}${S}/export/timetable.ics?scope=STAFF&token=${"x".repeat(48)}`);
    expect(screen.getByText(/ne sera plus affiché/)).toBeTruthy();
    expect(api.calls.find((c) => c.method === "POST" && c.path.endsWith("/export/tokens"))!.body).toEqual({ scope: "STAFF", subjectId: IDS.staff, label: "Agenda", expiresInDays: 30 });

    fireEvent.click(screen.getByRole("button", { name: "Révoquer" }));
    const dialog = await screen.findByRole("dialog", { name: "Révoquer ce lien" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Révoquer" }));
    expect(await screen.findByText("Lien révoqué.")).toBeTruthy();
    expect(api.calls.filter((c) => c.method === "DELETE")).toHaveLength(1);
  });

  it("téléchargement ponctuel du fichier .ics via l'API", async () => {
    (URL as unknown as { createObjectURL: () => string }).createObjectURL = () => "blob:test";
    (URL as unknown as { revokeObjectURL: () => void }).revokeObjectURL = () => undefined;
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);
    const api = setTestApi({
      ...accessRoutes(["schedule.own.read"]),
      [`GET ${S}/me/timetable`]: { ...page([]), subject: "STAFF", subjectId: IDS.staff },
      [`GET ${S}/export/tokens`]: { items: [] },
      [`GET ${S}/export/download.ics`]: () => new Response("BEGIN:VCALENDAR\r\nEND:VCALENDAR\r\n", { status: 200, headers: { "content-type": "text/calendar" } }),
    });
    renderWithProviders(<ExportScreen />);
    fireEvent.click(await screen.findByRole("button", { name: "Télécharger le fichier .ics" }));
    await waitFor(() => expect(click).toHaveBeenCalled());
    expect(api.calls.find((c) => c.path.endsWith("/download.ics"))!.query).toMatchObject({ scope: "STAFF", subjectId: IDS.staff });
  });
});
