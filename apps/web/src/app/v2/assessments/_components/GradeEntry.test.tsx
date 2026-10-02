// @vitest-environment jsdom
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { accessRoutes, setTestApi } from "@/platform/test/api-mock";
import { json, renderWithProviders } from "@/platform/test/render";
import { classroom } from "../../_test/fixtures";
import { assessment, assessmentType, grade, SETTINGS, STUDENTS, uuid } from "../_test/fixtures";
import { GradeEntryScreen } from "./GradeEntry";

vi.mock("@/platform/api/default-client", async () => (await import("@/platform/test/api-mock")).defaultClientModule);

const ENTER = accessRoutes(["grade.enter", "grade.read", "assessment.read"]);
const SHEET_PATH = `GET /api/v1/assess/assessments/${uuid(800)}/grades`;
const PUT_PATH = `PUT /api/v1/assess/assessments/${uuid(800)}/grades`;

function baseRoutes(sheet?: Record<string, unknown>, status = "DRAFT") {
  return {
    ...ENTER,
    [SHEET_PATH]: sheet ?? {
      assessment: assessment({ status }),
      grades: [grade(1, { score: "12.000", entryStatus: "ENTERED" }), grade(2)],
      pending: [{ enrollmentId: uuid(2003), studentId: uuid(3003) }],
    },
    "GET /api/v1/people/students": STUDENTS,
    "GET /api/v1/assess/settings": SETTINGS,
    "GET /api/v1/assess/assessment-types": { items: [assessmentType()] },
    [`GET /api/v1/academic/classrooms/${uuid(500)}`]: classroom(),
    [`GET /api/v1/academic/classrooms/${uuid(500)}/offerings`]: { items: [] },
    [`GET /api/v1/assess/classrooms/${uuid(500)}/periods/${uuid(200)}/lock`]: { lock: null },
  };
}

const savedGrade = (n: number, over: Record<string, unknown> = {}) => grade(n, { rowVersion: 2, ...over });

async function renderGrid(routes = baseRoutes()) {
  const api = setTestApi(routes);
  renderWithProviders(<GradeEntryScreen assessmentId={uuid(800)} />);
  await screen.findByLabelText("Note de Aka Marie");
  return api;
}

const cell = (name: string) => screen.getByLabelText(`Note de ${name}`) as HTMLInputElement;

describe("GradeEntryScreen — affichage", () => {
  it("liste les élèves par ordre alphabétique avec la valeur enregistrée, le barème et l'avancement", async () => {
    await renderGrid();
    const inputs = screen.getAllByLabelText(/^Note de /) as HTMLInputElement[];
    expect(inputs.map((i) => i.getAttribute("aria-label"))).toEqual(["Note de Aka Marie", "Note de Bamba Yao", "Note de Coulibaly Awa"]);
    expect(cell("Aka Marie").value).toBe("12"); // 12.000 -> 12 (aucun flottant, décimale normalisée)
    expect(cell("Bamba Yao").value).toBe("");
    expect(screen.getByRole("columnheader", { name: "Note (sur 20)" })).toBeTruthy();
    expect(screen.getByTestId("progress").textContent).toContain("1 sur 3 élèves notés");
    expect((screen.getByLabelText("État de Aka Marie") as HTMLSelectElement).value).toBe("ENTERED");
  });

  it("états chargement puis erreur de l'API avec bouton Réessayer", async () => {
    setTestApi({ ...baseRoutes(), [SHEET_PATH]: () => json({ code: "assess.not_assigned", message: "Vous n'êtes plus affecté à cette classe." }, { status: 403 }) });
    renderWithProviders(<GradeEntryScreen assessmentId={uuid(800)} />);
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("Vous n'êtes plus affecté à cette classe.");
    expect(screen.getByRole("button", { name: "Réessayer" })).toBeTruthy();
  });

  it("état vide : aucune ligne", async () => {
    setTestApi(baseRoutes({ assessment: assessment(), grades: [], pending: [] }));
    renderWithProviders(<GradeEntryScreen assessmentId={uuid(800)} />);
    expect(await screen.findByText("Aucun élève inscrit dans cette classe pour cette évaluation.")).toBeTruthy();
  });

  it("sans droit de saisie ou notes publiées : cellules en lecture seule, pas d'enregistrement", async () => {
    setTestApi({ ...baseRoutes(undefined, "PUBLISHED"), ...accessRoutes(["grade.read", "assessment.read"]) });
    renderWithProviders(<GradeEntryScreen assessmentId={uuid(800)} />);
    await screen.findByLabelText("Note de Aka Marie");
    expect(cell("Aka Marie").readOnly).toBe(true);
    expect(screen.queryByRole("button", { name: "Enregistrer" })).toBeNull();
    expect(screen.getByText(/Notes publiées : elles ne se modifient plus/)).toBeTruthy();
  });
});

describe("GradeEntryScreen — clavier et collage", () => {
  it("Entrée et flèches déplacent le focus d'une ligne à l'autre", async () => {
    await renderGrid();
    cell("Aka Marie").focus();
    fireEvent.keyDown(cell("Aka Marie"), { key: "Enter" });
    expect(document.activeElement).toBe(cell("Bamba Yao"));
    fireEvent.keyDown(cell("Bamba Yao"), { key: "ArrowDown" });
    expect(document.activeElement).toBe(cell("Coulibaly Awa"));
    fireEvent.keyDown(cell("Coulibaly Awa"), { key: "ArrowDown" }); // dernière ligne : on reste
    expect(document.activeElement).toBe(cell("Coulibaly Awa"));
    fireEvent.keyDown(cell("Coulibaly Awa"), { key: "ArrowUp" });
    expect(document.activeElement).toBe(cell("Bamba Yao"));
    fireEvent.keyDown(cell("Bamba Yao"), { key: "Enter", shiftKey: true });
    expect(document.activeElement).toBe(cell("Aka Marie"));
  });

  it("le collage de plusieurs cellules remplit la colonne à partir de la ligne active", async () => {
    await renderGrid();
    fireEvent.paste(cell("Bamba Yao"), { clipboardData: { getData: () => "14,5\r\nABS\r\n" } });
    await waitFor(() => expect(cell("Bamba Yao").value).toBe("14,5"));
    // 2e ligne collée : ABS dans « Coulibaly Awa »
    expect(cell("Coulibaly Awa").value).toBe("ABS");
    expect((screen.getByLabelText("État de Coulibaly Awa") as HTMLSelectElement).value).toBe("ABSENT_UNEXCUSED");
    expect(screen.getByText(/2 cellules collées/)).toBeTruthy();
    expect(screen.getByText("2 modifications non enregistrées")).toBeTruthy();
  });

  it("le collage par matricule place les notes sur les bons élèves", async () => {
    await renderGrid();
    fireEvent.paste(cell("Aka Marie"), { clipboardData: { getData: () => "ELV-003\tCoulibaly Awa\t8\nELV-002\tBamba Yao\tABJ" } });
    await waitFor(() => expect(cell("Coulibaly Awa").value).toBe("8"));
    expect(cell("Bamba Yao").value).toBe("ABJ");
    expect(cell("Aka Marie").value).toBe("12");
    expect(screen.getByText(/2 notes collées par matricule/)).toBeTruthy();
  });

  it("un collage d'une seule valeur garde le comportement natif (aucun remplissage de grille)", async () => {
    await renderGrid();
    fireEvent.paste(cell("Bamba Yao"), { clipboardData: { getData: () => "13" } });
    expect(screen.queryByText(/cellules collées/)).toBeNull();
  });

  it("la liste d'état écrit le code d'état dans la cellule : une absence n'est pas un zéro", async () => {
    await renderGrid();
    fireEvent.change(screen.getByLabelText("État de Bamba Yao"), { target: { value: "EXEMPT" } });
    expect(cell("Bamba Yao").value).toBe("DISP");
    fireEvent.change(screen.getByLabelText("État de Bamba Yao"), { target: { value: "ENTERED" } });
    expect(cell("Bamba Yao").value).toBe("");
  });
});

describe("GradeEntryScreen — contrôle de saisie", () => {
  it("signale une note supérieure au barème et bloque l'enregistrement", async () => {
    const api = await renderGrid();
    fireEvent.change(cell("Bamba Yao"), { target: { value: "25" } });
    expect(await screen.findByText("La note dépasse le barème (20).")).toBeTruthy();
    expect(cell("Bamba Yao").getAttribute("aria-invalid")).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: "Enregistrer" }));
    await screen.findByText("1 ligne invalide à corriger");
    expect(api.calls.some((c) => c.method === "PUT")).toBe(false);
  });

  it("refuse plus de décimales que le réglage de l'établissement", async () => {
    await renderGrid();
    fireEvent.change(cell("Bamba Yao"), { target: { value: "12,555" } });
    expect(await screen.findByText("Au plus 2 décimale(s).")).toBeTruthy();
  });
});

describe("GradeEntryScreen — enregistrement par lot", () => {
  it("envoie un lot idempotent (Idempotency-Key, rowVersion) puis fusionne le résultat", async () => {
    const api = await renderGrid({
      ...baseRoutes(),
      [PUT_PATH]: ({ body }) => {
        const entries = (body as { entries: Array<{ enrollmentId: string }> }).entries;
        return json({
          assessmentId: uuid(800),
          created: 1,
          updated: entries.length - 1,
          unchanged: 0,
          replayed: false,
          grades: [savedGrade(2, { score: "9.5", entryStatus: "ENTERED" }), savedGrade(3, { score: null, entryStatus: "ABSENT_UNEXCUSED" }), savedGrade(1, { score: "13", entryStatus: "ENTERED" })],
        });
      },
    });
    fireEvent.change(cell("Aka Marie"), { target: { value: "13" } });
    fireEvent.change(cell("Bamba Yao"), { target: { value: "9,5" } });
    fireEvent.change(cell("Coulibaly Awa"), { target: { value: "abs" } });
    fireEvent.click(screen.getByRole("button", { name: "Enregistrer" }));
    await waitFor(() => expect(screen.getByTestId("save-indicator").textContent).toContain("Enregistré à"));
    const put = api.calls.find((c) => c.method === "PUT")!;
    expect(put.headers["idempotency-key"]).toMatch(/.{8,}/);
    expect(put.body).toEqual({
      entries: [
        { enrollmentId: uuid(2001), entryStatus: "ENTERED", score: "13", rowVersion: 1 },
        { enrollmentId: uuid(2002), entryStatus: "ENTERED", score: "9.5", rowVersion: 1 },
        { enrollmentId: uuid(2003), entryStatus: "ABSENT_UNEXCUSED" },
      ],
    });
    expect(screen.getByTestId("save-indicator").textContent).toContain("1 créée(s), 2 modifiée(s), 0 inchangée(s)");
    // Plus rien en attente : le bouton est désactivé, les lignes passent à « Enregistrée ».
    expect((screen.getByRole("button", { name: "Enregistrer" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("Ctrl+S enregistre depuis une cellule", async () => {
    const api = await renderGrid({
      ...baseRoutes(),
      [PUT_PATH]: json({ assessmentId: uuid(800), created: 0, updated: 1, unchanged: 0, replayed: false, grades: [savedGrade(1, { score: "15", entryStatus: "ENTERED" })] }),
    });
    fireEvent.change(cell("Aka Marie"), { target: { value: "15" } });
    fireEvent.keyDown(cell("Aka Marie"), { key: "s", ctrlKey: true });
    await waitFor(() => expect(api.calls.some((c) => c.method === "PUT")).toBe(true));
  });

  it("erreur réseau : les saisies sont conservées et le MÊME lot (même clé) est rejoué", async () => {
    let attempts = 0;
    const api = setTestApi({
      ...baseRoutes(),
      [PUT_PATH]: () => {
        attempts += 1;
        if (attempts === 1) throw new TypeError("Failed to fetch");
        return json({ assessmentId: uuid(800), created: 0, updated: 1, unchanged: 0, replayed: true, grades: [savedGrade(1, { score: "15", entryStatus: "ENTERED" })] });
      },
    });
    renderWithProviders(<GradeEntryScreen assessmentId={uuid(800)} />);
    await screen.findByLabelText("Note de Aka Marie");
    fireEvent.change(cell("Aka Marie"), { target: { value: "15" } });
    fireEvent.click(screen.getByRole("button", { name: "Enregistrer" }));
    await screen.findByText("Envoi interrompu : vos saisies sont conservées, réessayez.");
    expect(cell("Aka Marie").value).toBe("15");
    fireEvent.click(screen.getByRole("button", { name: "Réessayer l'enregistrement" }));
    await waitFor(() => expect(screen.getByTestId("save-indicator").textContent).toContain("lot déjà enregistré"));
    const puts = api.calls.filter((c) => c.method === "PUT");
    expect(puts).toHaveLength(2);
    expect(puts[0]!.headers["idempotency-key"]).toBe(puts[1]!.headers["idempotency-key"]);
    expect(puts[1]!.body).toEqual(puts[0]!.body);
  });

  it("conflit de version (409) : message explicite et feuille à recharger, saisies non écrasées", async () => {
    await renderGrid({ ...baseRoutes(), [PUT_PATH]: () => json({ code: "assess.stale_grade", message: "Cette note a été modifiée par un autre utilisateur." }, { status: 409 }) });
    fireEvent.change(cell("Aka Marie"), { target: { value: "15" } });
    fireEvent.click(screen.getByRole("button", { name: "Enregistrer" }));
    await screen.findByText(/Une note a été modifiée par quelqu'un d'autre/);
    expect(screen.getAllByRole("button", { name: "Recharger la feuille" }).length).toBeGreaterThan(0);
    expect(cell("Aka Marie").value).toBe("15");
  });

  it("refus 400 avec détail par ligne : l'erreur s'affiche sur la bonne ligne", async () => {
    await renderGrid({
      ...baseRoutes(),
      [PUT_PATH]: () => json({ code: "validation_error", message: "Données invalides.", details: { issues: [{ path: ["entries", 1, "score"], message: "La note dépasse le barème de l'évaluation." }] } }, { status: 400 }),
    });
    fireEvent.change(cell("Aka Marie"), { target: { value: "13" } });
    fireEvent.change(cell("Bamba Yao"), { target: { value: "9" } });
    fireEvent.click(screen.getByRole("button", { name: "Enregistrer" }));
    const bamba = cell("Bamba Yao");
    await waitFor(() => expect(bamba.getAttribute("aria-invalid")).toBe("true"));
    const describedBy = bamba.getAttribute("aria-describedby")!;
    expect(document.getElementById(describedBy)!.textContent).toBe("La note dépasse le barème de l'évaluation.");
    expect(cell("Aka Marie").getAttribute("aria-invalid")).toBeNull();
  });

  it("une période verrouillée est signalée avant la saisie", async () => {
    setTestApi({
      ...baseRoutes(),
      [`GET /api/v1/assess/classrooms/${uuid(500)}/periods/${uuid(200)}/lock`]: { lock: { id: uuid(1), classroomId: uuid(500), academicPeriodId: uuid(200), lockedAt: "2026-10-01T08:00:00.000Z", lockedBy: uuid(2), lockReason: null, lockedSessions: [1], releasedAt: null, releaseReason: null } },
    });
    renderWithProviders(<GradeEntryScreen assessmentId={uuid(800)} />);
    expect(await screen.findByText(/Les notes de cette période sont verrouillées/)).toBeTruthy();
  });
});

describe("GradeEntryScreen — notes publiées", () => {
  it("propose Corriger avec la permission, envoie la demande motivée et l'historique", async () => {
    const api = setTestApi({
      ...baseRoutes(undefined, "PUBLISHED"),
      ...accessRoutes(["grade.read", "grade.revise.request", "grade.revise.approve"]),
      [`POST /api/v1/assess/grades/${uuid(1001)}/revisions`]: () =>
        json(
        { id: uuid(1500), assessmentId: uuid(800), gradeId: uuid(1001), enrollmentId: uuid(2001), kind: "CORRECTION", oldScore: "12", oldEntryStatus: "ENTERED", newScore: "14", newEntryStatus: "ENTERED", reason: "Erreur de report de la note.", requestedBy: uuid(901), requestedByName: "M. Koné", requestedAt: "2026-10-01T08:00:00.000Z", status: "REQUESTED", decidedBy: null, decidedByName: null, decidedAt: null, decisionComment: null, fourEyesWaived: false, appliedAt: null, batchId: null },
        { status: 201 },
      ),
      [`GET /api/v1/assess/grades/${uuid(1001)}/history`]: {
        gradeId: uuid(1001),
        assessmentId: uuid(800),
        enrollmentId: uuid(2001),
        current: grade(1, { score: "12", entryStatus: "ENTERED", status: "PUBLISHED" }),
        assessmentStatusTrail: [{ status: "PUBLISHED", at: "2026-10-01T08:00:00.000Z", by: null }],
        revisions: [],
      },
    });
    renderWithProviders(<GradeEntryScreen assessmentId={uuid(800)} />);
    fireEvent.click(await screen.findByRole("button", { name: "Demander la correction de la note de Aka Marie" }));
    const dialog = await screen.findByRole("dialog");
    // Motif trop court : refusé sans appel.
    fireEvent.change(within(dialog).getByLabelText(/Nouvelle valeur/), { target: { value: "14" } });
    fireEvent.change(within(dialog).getByLabelText(/Motif de la correction/), { target: { value: "court" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Envoyer la demande" }));
    await waitFor(() => expect(within(dialog).getAllByRole("alert").length).toBeGreaterThan(0));
    expect(api.calls.filter((c) => c.method === "POST")).toHaveLength(0);
    fireEvent.change(within(dialog).getByLabelText(/Motif de la correction/), { target: { value: "Erreur de report de la note." } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Envoyer la demande" }));
    await screen.findByText("La demande de correction est envoyée pour approbation.");
    expect(api.calls.find((c) => c.method === "POST")!.body).toEqual({ newScore: "14", reason: "Erreur de report de la note." });

    fireEvent.click(screen.getByRole("button", { name: "Historique de la note de Aka Marie" }));
    const history = await screen.findByRole("dialog", { name: "Historique de la note de Aka Marie" });
    expect(await within(history).findByText("Aucune correction.")).toBeTruthy();
  });
});
