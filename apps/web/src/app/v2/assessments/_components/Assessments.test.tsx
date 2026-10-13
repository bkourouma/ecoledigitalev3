// @vitest-environment jsdom
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { accessRoutes, setTestApi } from "@/platform/test/api-mock";
import { json, renderWithProviders } from "@/platform/test/render";
import { classroom, period } from "../../_test/fixtures";
import { staffSummary } from "../../_test/fixtures-people";
import { assessment, assessmentType, revision, SETTINGS, STUDENTS, uuid } from "../_test/fixtures";
import { AssessmentCreate } from "./AssessmentCreate";
import { AssessmentDetail } from "./AssessmentDetail";
import { AssessmentsScreen } from "./AssessmentsScreen";
import { RevisionsScreen } from "./RevisionsScreen";
import { TypesScreen } from "./TypesScreen";

vi.mock("@/platform/api/default-client", async () => (await import("@/platform/test/api-mock")).defaultClientModule);

const A = (path = "") => `/api/v1/assess/assessments/${uuid(800)}${path}`;

function detailRoutes(status: string, permissions: string[], extra: Record<string, unknown> = {}) {
  return {
    ...accessRoutes(permissions),
    [`GET ${A()}`]: assessment({ status }),
    [`GET ${A("/transitions")}`]: { items: [{ id: uuid(1), from: "DRAFT", to: "SUBMITTED", actorId: uuid(9), actorName: "M. Koné", comment: null, fourEyesWaived: false, at: "2026-10-01T09:00:00.000Z" }] },
    "GET /api/v1/assess/assessment-types": { items: [assessmentType()] },
    [`GET /api/v1/academic/classrooms/${uuid(500)}`]: classroom(),
    [`GET /api/v1/academic/classrooms/${uuid(500)}/offerings`]: { items: [] },
    [`GET /api/v1/academic/years/${uuid(100)}/periods`]: { items: [period()] },
    "GET /api/v1/people/students": STUDENTS,
    "GET /api/v1/assess/revisions": { items: [], nextCursor: null },
    ...extra,
  };
}

describe("AssessmentDetail — circuit de validation", () => {
  it("propose l'étape suivante selon l'état ET la permission, et envoie la transition avec la version de ligne", async () => {
    const api = setTestApi(
      detailRoutes("DRAFT", ["assessment.read", "grade.enter"], {
        [`POST ${A("/transitions")}`]: () => json({ assessment: assessment({ status: "SUBMITTED", rowVersion: 4 }), autoPublished: false }),
      }),
    );
    renderWithProviders(<AssessmentDetail id={uuid(800)} />);
    const button = await screen.findByRole("button", { name: "Soumettre la feuille" });
    expect(screen.queryByRole("button", { name: "Publier les notes" })).toBeNull();
    fireEvent.click(button);
    await screen.findByText("La feuille de notes est soumise.");
    expect(api.calls.find((c) => c.method === "POST")!.body).toEqual({ to: "SUBMITTED", rowVersion: 3 });
    // historique du circuit
    expect(await screen.findByText(/Par M\. Koné/)).toBeTruthy();
  });

  it("un relecteur voit « Marquer comme relue » et « Renvoyer en brouillon » mais pas « Publier »", async () => {
    setTestApi(detailRoutes("SUBMITTED", ["assessment.read", "grade.review"]));
    renderWithProviders(<AssessmentDetail id={uuid(800)} />);
    await screen.findByRole("button", { name: "Marquer comme relue" });
    expect(screen.getByRole("button", { name: "Renvoyer en brouillon" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Approuver" })).toBeNull();
  });

  it("le refus de l'API (séparation des tâches) est affiché tel quel", async () => {
    setTestApi(
      detailRoutes("REVIEWED", ["assessment.read", "grade.validate"], {
        [`POST ${A("/transitions")}`]: () => json({ code: "assess.four_eyes_required", message: "L'approbateur doit être différent du relecteur." }, { status: 403 }),
      }),
    );
    renderWithProviders(<AssessmentDetail id={uuid(800)} />);
    fireEvent.click(await screen.findByRole("button", { name: "Approuver" }));
    fireEvent.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Approuver la feuille" }));
    expect((await screen.findByRole("alert")).textContent).toContain("L'approbateur doit être différent du relecteur.");
  });

  it("le retour en brouillon exige un commentaire d'au moins 5 caractères", async () => {
    const api = setTestApi(
      detailRoutes("APPROVED", ["assessment.read", "grade.publish"], {
        [`POST ${A("/transitions")}`]: () => json({ assessment: assessment({ status: "DRAFT" }), autoPublished: false }),
      }),
    );
    renderWithProviders(<AssessmentDetail id={uuid(800)} />);
    fireEvent.click(await screen.findByRole("button", { name: "Renvoyer en brouillon" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText(/Commentaire/), { target: { value: "no" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Renvoyer en brouillon" }));
    expect(api.calls.filter((c) => c.method === "POST")).toHaveLength(0);
    fireEvent.change(within(dialog).getByLabelText(/Commentaire/), { target: { value: "Notes de la 3e ligne à revoir" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Renvoyer en brouillon" }));
    await screen.findByText("La feuille est renvoyée en brouillon.");
    expect(api.calls.find((c) => c.method === "POST")!.body).toEqual({ to: "DRAFT", comment: "Notes de la 3e ligne à revoir", rowVersion: 3 });
  });

  it("annulation d'une évaluation publiée : devient une demande à approuver (202)", async () => {
    setTestApi(
      detailRoutes("PUBLISHED", ["assessment.read", "grade.revise.request"], {
        [`POST ${A("/cancel")}`]: () => json({ assessment: null, revisions: [revision({ kind: "REMOVAL" })] }, { status: 202 }),
      }),
    );
    renderWithProviders(<AssessmentDetail id={uuid(800)} />);
    fireEvent.click(await screen.findByRole("button", { name: "Annuler l'évaluation" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText(/Motif/), { target: { value: "Copies perdues, évaluation à refaire" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Annuler l'évaluation" }));
    await screen.findByText("La demande d'annulation est enregistrée ; elle doit être approuvée.");
  });
});

describe("RevisionsScreen", () => {
  const routes = (extra: Record<string, unknown> = {}) => ({
    ...accessRoutes(["grade.revise.approve"]),
    "GET /api/v1/assess/revisions": { items: [revision()], nextCursor: null },
    [`GET ${A()}`]: assessment({ status: "PUBLISHED" }),
    "GET /api/v1/people/students": STUDENTS,
    ...extra,
  });

  it("affiche la correction (ancienne -> nouvelle valeur, motif, demandeur) et la filtre par état", async () => {
    const api = setTestApi(routes());
    renderWithProviders(<RevisionsScreen />);
    const card = await screen.findByRole("article", { name: "Correction pour Aka Marie" });
    expect(within(card).getByText("12 → 14")).toBeTruthy();
    expect(within(card).getByText("Erreur de report de la note sur la copie.")).toBeTruthy();
    expect(within(card).getByText(/Demandée par M\. Koné/)).toBeTruthy();
    expect(api.calls.find((c) => c.path === "/api/v1/assess/revisions")!.query.status).toBe("REQUESTED");
  });

  it("approuver envoie le commentaire facultatif ; rejeter exige un motif", async () => {
    const api = setTestApi(
      routes({
        [`POST /api/v1/assess/revisions/${uuid(1500)}/approve`]: () => json({ revisions: [revision({ status: "APPLIED" })], applied: true, cancelled: null }),
        [`POST /api/v1/assess/revisions/${uuid(1500)}/reject`]: () => json({ revisions: [revision({ status: "REJECTED" })] }),
      }),
    );
    renderWithProviders(<RevisionsScreen />);
    fireEvent.click(await screen.findByRole("button", { name: "Approuver la correction de Aka Marie" }));
    let dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText(/Commentaire/), { target: { value: "Copie vérifiée" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Approuver" }));
    await screen.findByText("Correction approuvée et appliquée.");
    expect(api.calls.find((c) => c.path.endsWith("/approve"))!.body).toEqual({ comment: "Copie vérifiée" });

    fireEvent.click(await screen.findByRole("button", { name: "Rejeter la correction de Aka Marie" }));
    dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Rejeter" }));
    expect(api.calls.filter((c) => c.path.endsWith("/reject"))).toHaveLength(0);
    fireEvent.change(within(dialog).getByLabelText(/Motif du rejet/), { target: { value: "Note correcte sur la copie" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Rejeter" }));
    await screen.findByText("La demande de correction est rejetée.");
    expect(api.calls.find((c) => c.path.endsWith("/reject"))!.body).toEqual({ comment: "Note correcte sur la copie" });
  });

  it("l'approbation par le demandeur est refusée par l'API : le message du serveur s'affiche", async () => {
    setTestApi(routes({ [`POST /api/v1/assess/revisions/${uuid(1500)}/approve`]: () => json({ code: "assess.four_eyes_required", message: "Vous ne pouvez pas approuver votre propre demande." }, { status: 403 }) }));
    renderWithProviders(<RevisionsScreen />);
    fireEvent.click(await screen.findByRole("button", { name: "Approuver la correction de Aka Marie" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Approuver" }));
    await within(dialog).findByText("Vous ne pouvez pas approuver votre propre demande.");
  });

  it("sans permission d'approuver, aucune action de décision", async () => {
    setTestApi(routes({ ...accessRoutes(["grade.revise.request"]) }));
    renderWithProviders(<RevisionsScreen />);
    await screen.findByRole("article", { name: "Correction pour Aka Marie" });
    expect(screen.queryByRole("button", { name: /Approuver la correction/ })).toBeNull();
  });

  it("état vide et erreur de chargement", async () => {
    setTestApi(routes({ "GET /api/v1/assess/revisions": { items: [], nextCursor: null } }));
    const { unmount } = renderWithProviders(<RevisionsScreen />);
    expect(await screen.findByText("Aucune demande de correction.")).toBeTruthy();
    unmount();
    setTestApi(routes({ "GET /api/v1/assess/revisions": () => json({ code: "FORBIDDEN", message: "Accès refusé." }, { status: 403 }) }));
    renderWithProviders(<RevisionsScreen />);
    expect((await screen.findByRole("alert")).textContent).toContain("Accès refusé.");
  });
});

describe("TypesScreen", () => {
  it("liste les types, crée un type validé par le contrat puis envoie le corps exact", async () => {
    const api = setTestApi({
      ...accessRoutes(["assessment.type.read", "assessment.type.manage"]),
      "GET /api/v1/assess/assessment-types": { items: [assessmentType(), assessmentType({ id: uuid(701), code: "EXAMEN", label: "Examen", aggregationGroup: "EXAM", active: false })] },
      "GET /api/v1/assess/settings": SETTINGS,
      "POST /api/v1/assess/assessment-types": ({ body }) => json(assessmentType({ id: uuid(702), ...(body as object) }), { status: 201 }),
    });
    renderWithProviders(<TypesScreen />);
    const table = await screen.findByRole("table", { name: "Types d'évaluation" });
    expect(await within(table).findByText("Devoir")).toBeTruthy();
    expect(within(table).getByText("Inactif")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Nouveau type" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Créer le type" }));
    await waitFor(() => expect(within(dialog).getAllByRole("alert").length).toBeGreaterThan(0));
    expect(api.calls.filter((c) => c.method === "POST")).toHaveLength(0);
    fireEvent.change(within(dialog).getByLabelText(/^Code/), { target: { value: "TP" } });
    fireEvent.change(within(dialog).getByLabelText(/^Libellé/), { target: { value: "Travaux pratiques" } });
    fireEvent.change(within(dialog).getByLabelText(/Groupe d'agrégation/), { target: { value: "CONTINUOUS" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Créer le type" }));
    await screen.findByText("Le type Travaux pratiques est enregistré.");
    expect(api.calls.find((c) => c.method === "POST")!.body).toEqual({
      code: "TP",
      label: "Travaux pratiques",
      aggregationGroup: "CONTINUOUS",
      defaultScaleMax: "20",
      defaultWeight: "1",
      publicationMode: "MANUAL",
      visibleToStudents: true,
      allowsSession2: false,
    });
  });

  it("sans droit de gestion : consultation seule, réglages non modifiables", async () => {
    setTestApi({
      ...accessRoutes(["assessment.type.read"]),
      "GET /api/v1/assess/assessment-types": { items: [assessmentType()] },
      "GET /api/v1/assess/settings": SETTINGS,
    });
    renderWithProviders(<TypesScreen />);
    await screen.findByRole("table", { name: "Types d'évaluation" });
    expect(screen.queryByRole("button", { name: "Nouveau type" })).toBeNull();
    await screen.findByText("Vous pouvez consulter ces réglages mais pas les modifier.");
  });
});

describe("AssessmentsScreen", () => {
  it("liste les évaluations avec classe, type et état, et propose la saisie", async () => {
    const api = setTestApi({
      ...accessRoutes(["assessment.read", "assessment.create", "grade.enter"]),
      "GET /api/v1/assess/assessments": { items: [assessment({ status: "DRAFT" }), assessment({ id: uuid(801), title: "Composition 1", status: "PUBLISHED" })], nextCursor: null },
      "GET /api/v1/assess/assessment-types": { items: [assessmentType()] },
      "GET /api/v1/academic/classrooms": { items: [classroom()], total: 1, page: 1, pageSize: 200 },
    });
    renderWithProviders(<AssessmentsScreen initialStatus="DRAFT" />);
    const table = await screen.findByRole("table", { name: "Évaluations" });
    expect(await within(table).findByText("Devoir 1 de mathématiques")).toBeTruthy();
    expect(within(table).getByText("Publiée")).toBeTruthy();
    expect(within(table).getByRole("link", { name: "Notes de l'évaluation Devoir 1 de mathématiques" }).getAttribute("href")).toBe(`/v2/assessments/${uuid(800)}/grades`);
    expect(api.calls.find((c) => c.path === "/api/v1/assess/assessments")!.query.status).toBe("DRAFT");
    expect(screen.getByRole("link", { name: "Nouvelle évaluation" })).toBeTruthy();
  });

  it("état vide", async () => {
    setTestApi({ ...accessRoutes(["assessment.read"]), "GET /api/v1/assess/assessments": { items: [], nextCursor: null }, "GET /api/v1/assess/assessment-types": { items: [] } });
    renderWithProviders(<AssessmentsScreen />);
    expect(await screen.findByText("Aucune évaluation.")).toBeTruthy();
    expect(screen.queryByRole("link", { name: "Nouvelle évaluation" })).toBeNull();
  });
});

describe("AssessmentCreate", () => {
  it("valide avec le contrat (sans appel) puis envoie le corps exact et propose la saisie", async () => {
    const api = setTestApi({
      ...accessRoutes(["assessment.create"]),
      "GET /api/v1/assess/assessment-types": { items: [assessmentType()] },
      "GET /api/v1/academic/classrooms": { items: [classroom()], total: 1, page: 1, pageSize: 200 },
      [`GET /api/v1/academic/classrooms/${uuid(500)}`]: classroom(),
      [`GET /api/v1/academic/classrooms/${uuid(500)}/offerings`]: {
        items: [{ id: uuid(60), classroomId: uuid(500), curriculumNodeId: uuid(510), label: "Mathématiques", startsOn: "2026-09-01", endsOn: "2027-06-30", registrationOpensAt: null, registrationClosesAt: null, capacity: null, status: "OPEN", heldPlaces: 0 }],
      },
      [`GET /api/v1/academic/years/${uuid(100)}/periods`]: { items: [period()] },
      "POST /api/v1/assess/assessments": () => json(assessment({ title: "Devoir 2" }), { status: 201 }),
    });
    renderWithProviders(<AssessmentCreate initialClassroomId={uuid(500)} />);
    await screen.findByRole("option", { name: "Devoir" });
    fireEvent.click(screen.getByRole("button", { name: "Créer l'évaluation" }));
    await waitFor(() => expect(screen.getAllByRole("alert").length).toBeGreaterThan(0));
    expect(api.calls.filter((c) => c.method === "POST")).toHaveLength(0);

    fireEvent.change(screen.getByLabelText(/Type d'évaluation/), { target: { value: uuid(700) } });
    fireEvent.change(screen.getByLabelText(/Intitulé/), { target: { value: "Devoir 2" } });
    fireEvent.change(screen.getByLabelText(/Date de l'évaluation/), { target: { value: "2026-10-15" } });
    await screen.findByRole("option", { name: "Mathématiques" });
    fireEvent.change(screen.getByLabelText(/^Cours/), { target: { value: uuid(510) } });
    await screen.findByRole("option", { name: "Semestre 1" });
    fireEvent.change(screen.getByLabelText(/^Période/), { target: { value: uuid(200) } });
    fireEvent.click(screen.getByRole("button", { name: "Créer l'évaluation" }));
    await screen.findByText("1 évaluation créée.");
    expect(api.calls.find((c) => c.method === "POST")!.body).toEqual({
      typeId: uuid(700),
      academicPeriodId: uuid(200),
      title: "Devoir 2",
      assessedOn: "2026-10-15",
      classroomId: uuid(500),
      curriculumNodeId: uuid(510),
    });
    expect(screen.getByRole("link", { name: "Saisir les notes" }).getAttribute("href")).toBe(`/v2/assessments/${uuid(800)}/grades`);
  });

  it("création en lot par la direction : l'enseignant de chaque ligne est choisi et envoyé (sans lui l'API refuse)", async () => {
    const api = setTestApi({
      ...accessRoutes(["assessment.create", "assessment.manage"]),
      "GET /api/v1/assess/assessment-types": { items: [assessmentType()] },
      "GET /api/v1/academic/classrooms": { items: [classroom()], total: 1, page: 1, pageSize: 200 },
      [`GET /api/v1/academic/classrooms/${uuid(500)}`]: classroom(),
      [`GET /api/v1/academic/classrooms/${uuid(500)}/offerings`]: {
        items: [{ id: uuid(60), classroomId: uuid(500), curriculumNodeId: uuid(510), label: "Mathématiques", startsOn: "2026-09-01", endsOn: "2027-06-30", registrationOpensAt: null, registrationClosesAt: null, capacity: null, status: "OPEN", heldPlaces: 0 }],
      },
      [`GET /api/v1/academic/years/${uuid(100)}/periods`]: { items: [period()] },
      "GET /api/v1/people/staff": { items: [staffSummary({ id: uuid(900), displayName: "KOUASSI Marc" })], total: 1, limit: 20, offset: 0 },
      "POST /api/v1/assess/assessments/bulk": () => json({ items: [assessment({ title: "Devoir lot" })] }, { status: 201 }),
    });
    renderWithProviders(<AssessmentCreate />);
    await screen.findByRole("option", { name: "Devoir" });
    fireEvent.change(screen.getByLabelText(/Type d'évaluation/), { target: { value: uuid(700) } });
    fireEvent.change(screen.getByLabelText(/Intitulé/), { target: { value: "Devoir lot" } });
    fireEvent.change(screen.getByLabelText(/Date de l'évaluation/), { target: { value: "2026-10-15" } });
    fireEvent.click(screen.getByRole("checkbox", { name: /Créer pour plusieurs/ }));

    const pick = async (name: RegExp, optionName: string) => {
      const box = await screen.findByRole("combobox", { name });
      fireEvent.focus(box);
      fireEvent.click(await screen.findByRole("option", { name: new RegExp(optionName) }));
    };
    await pick(/Classe 1/, "Licence 1 A");
    await screen.findByRole("option", { name: "Mathématiques" });
    fireEvent.change(screen.getByLabelText(/Cours 1/), { target: { value: uuid(510) } });
    await pick(/Enseignant du cours 1/, "KOUASSI Marc");
    await screen.findByRole("option", { name: "Semestre 1" });
    fireEvent.change(screen.getByLabelText(/^Période/), { target: { value: uuid(200) } });
    fireEvent.click(screen.getByRole("button", { name: "Créer l'évaluation" }));
    await screen.findByText("1 évaluation créée.");
    const call = api.calls.find((c) => c.method === "POST" && c.path.endsWith("/bulk"));
    expect(call!.body).toMatchObject({ targets: [{ classroomId: uuid(500), curriculumNodeId: uuid(510), teacherId: uuid(900) }] });
  });
});
