// @vitest-environment jsdom
import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { accessRoutes, setTestApi } from "@/platform/test/api-mock";
import { json, renderWithProviders } from "@/platform/test/render";
import { apiErrorBody, assessment, bulkResult, competency, enrollment, framework, ID, level, myClassroom, P, sheet, summary } from "../_test/fixtures";
import { CompetenciesScreen } from "./CompetenciesScreen";

vi.mock("@/platform/api/default-client", async () => (await import("@/platform/test/api-mock")).defaultClientModule);

const SHEET = `GET ${P}/classrooms/${ID.classroom}/competency-sheet`;
const BULK = `PUT ${P}/competency-assessments/bulk`;
const FEATURES = ["primary.competencies"];
const RECORD = ["primary.competency.read", "primary.competency.record"];
const BTN = (code: string, label: string, competencyLabel: string) => `${code} — ${label}, pour ${competencyLabel}`;
const N3_C11 = BTN("N3", "Attendu atteint", "Compétence 1.1 (fictive)");
const N2_C11 = BTN("N2", "En cours d'acquisition", "Compétence 1.1 (fictive)");

function routes(over: Record<string, unknown> = {}, permissions: string[] = RECORD) {
  return {
    ...accessRoutes(permissions, FEATURES),
    [`GET ${P}/my-classrooms`]: { items: [myClassroom()] },
    [`GET ${P}/rule-banner`]: { ruleSourceKind: "placeholder", isPlaceholder: true },
    [SHEET]: sheet(),
    ...over,
  };
}

async function open(ready: string | null = "Enregistrer") {
  renderWithProviders(<CompetenciesScreen />);
  const period = await screen.findByLabelText("Période");
  await within(period).findByRole("option", { name: "Trimestre 1" });
  fireEvent.change(period, { target: { value: ID.p1 } });
  await screen.findByRole("region", { name: "Fiche de l'élève" });
  // Les droits arrivent de façon asynchrone (fail-closed) : on attend qu'ils soient connus avant d'agir.
  if (ready) await screen.findByRole("button", { name: ready });
}

const counters = () => screen.getByTestId("completeness").textContent ?? "";
const lastPut = (api: ReturnType<typeof setTestApi>) => api.calls.filter((c) => c.method === "PUT").at(-1)!;

describe("Grille de compétences : saisie", () => {
  it("une compétence non saisie reste « non évaluée » ; un geste choisit le niveau, le lot est idempotent et fusionné", async () => {
    const api = setTestApi(routes({ [BULK]: () => json(bulkResult([assessment(1, 1, 3)])) }));
    await open();
    // Aucune valeur inventée : 0 renseignée sur 12, toutes « Non évaluée ».
    expect(counters()).toContain("0 sur 12 compétences renseignées");
    expect(screen.getAllByText("Non évaluée")).toHaveLength(4);
    expect(screen.getByRole("heading", { level: 2, name: "Aka Marie" })).toBeTruthy();

    const button = screen.getByRole("button", { name: N3_C11 });
    expect(button.getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(button);
    expect(button.getAttribute("aria-pressed")).toBe("true");
    expect(counters()).toContain("1 saisie en attente");
    expect(screen.getByText("À enregistrer")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Enregistrer" }));
    await waitFor(() => expect(counters()).toContain("aucune saisie en attente"));
    const put = lastPut(api);
    expect(put.body).toEqual({ classroomId: ID.classroom, periodId: ID.p1, frameworkId: ID.framework, lines: [{ enrollmentId: enrollment(1), competencyId: competency(1), ratingLevelId: level(3) }] });
    expect(put.headers["idempotency-key"]).toMatch(/^comp-/);
    expect(screen.getByText("Enregistrée")).toBeTruthy();
    expect(screen.getByTestId("save-status").textContent).toContain("Enregistré le");
  });

  it("échec réseau : rien ne s'efface et le MÊME lot est rejoué avec la MÊME clé d'idempotence", async () => {
    let calls = 0;
    const api = setTestApi(
      routes({
        [BULK]: () => {
          calls += 1;
          if (calls === 1) throw new TypeError("Failed to fetch");
          return json(bulkResult([assessment(1, 1, 3)]));
        },
      }),
    );
    await open();
    fireEvent.click(screen.getByRole("button", { name: N3_C11 }));
    fireEvent.click(screen.getByRole("button", { name: "Enregistrer" }));
    await screen.findByText(/L'envoi a échoué \(réseau ou serveur\)/);
    // La saisie est toujours là.
    expect(screen.getByRole("button", { name: N3_C11 }).getAttribute("aria-pressed")).toBe("true");
    expect(counters()).toContain("1 saisie en attente");
    fireEvent.click(screen.getByRole("button", { name: "Réessayer maintenant" }));
    await waitFor(() => expect(counters()).toContain("aucune saisie en attente"));
    const puts = api.calls.filter((c) => c.method === "PUT");
    expect(puts).toHaveLength(2);
    expect(puts[0]!.headers["idempotency-key"]).toBeTruthy();
    expect(puts[1]!.headers["idempotency-key"]).toBe(puts[0]!.headers["idempotency-key"]);
    expect(puts[1]!.body).toEqual(puts[0]!.body);
  });

  it("409 row_version_conflict : message de l'API, erreur sur la bonne cellule, rechargement SANS écraser la saisie puis rowVersion à jour", async () => {
    let reads = 0;
    const api = setTestApi(
      routes({
        [SHEET]: () => {
          reads += 1;
          return json(sheet({ assessments: [assessment(1, 1, 2, { rowVersion: reads === 1 ? 1 : 2 })] }));
        },
        [BULK]: ({ body }) => {
          const line = (body as { lines: Array<{ rowVersion?: number }> }).lines[0]!;
          if (line.rowVersion === 1)
            return json(apiErrorBody("primary_school.row_version_conflict", "La ligne a changé depuis votre lecture (version différente).", { details: { issues: [{ path: ["lines", 0, "rowVersion"], message: "La ligne a changé depuis votre lecture (version différente).", code: "primary_school.row_version_conflict" }] } }), { status: 409 });
          return json(bulkResult([assessment(1, 1, 3, { rowVersion: 3 })], { created: 0, updated: 1 }));
        },
      }),
    );
    await open();
    fireEvent.click(screen.getByRole("button", { name: N3_C11 }));
    fireEvent.click(screen.getByRole("button", { name: "Enregistrer" }));
    const alerts = await screen.findAllByRole("alert");
    expect(alerts.some((a) => a.textContent?.includes("La ligne a changé depuis votre lecture"))).toBe(true);
    // L'erreur est rattachée à la cellule « Compétence 1.1 ».
    const group = screen.getByRole("group", { name: /Compétence 1\.1/ });
    expect(within(group).getByRole("alert").textContent).toContain("La ligne a changé");
    // Rechargement sans écraser : la saisie N3 est conservée.
    fireEvent.click(screen.getByRole("button", { name: "Recharger sans écraser mes saisies" }));
    await waitFor(() => expect(reads).toBe(2));
    await waitFor(() => expect(screen.queryByRole("button", { name: "Recharger sans écraser mes saisies" })).toBeNull());
    expect(screen.getByRole("button", { name: N3_C11 }).getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: "Enregistrer" }));
    await waitFor(() => expect(counters()).toContain("aucune saisie en attente"));
    expect(lastPut(api).body).toMatchObject({ lines: [{ ratingLevelId: level(3), rowVersion: 2 }] });
  });

  it("409 validated_frozen : la ligne validée entre-temps est annoncée au rechargement, jamais perdue en silence", async () => {
    let reads = 0;
    setTestApi(
      routes({
        [SHEET]: () => {
          reads += 1;
          return json(reads === 1 ? sheet() : sheet({ assessments: [assessment(1, 1, 2, { status: "VALIDATED", validatedAt: "2026-10-01T09:00:00.000Z" })] }));
        },
        [BULK]: () => json(apiErrorBody("primary_school.validated_frozen", "Appréciation validée : seule une révision motivée la corrige.", { details: { issues: [{ path: ["lines", 0], message: "Appréciation validée : seule une révision motivée la corrige.", code: "primary_school.validated_frozen" }] } }), { status: 409 }),
      }),
    );
    await open();
    fireEvent.click(screen.getByRole("button", { name: N3_C11 }));
    fireEvent.click(screen.getByRole("button", { name: "Enregistrer" }));
    await screen.findByRole("button", { name: "Recharger sans écraser mes saisies" });
    fireEvent.click(screen.getByRole("button", { name: "Recharger sans écraser mes saisies" }));
    await screen.findByText(/1 saisie a été abandonnée car la compétence a été validée entre-temps/);
    expect(counters()).toContain("aucune saisie en attente");
    // La ligne est maintenant figée.
    expect(screen.getByRole("button", { name: N3_C11 }).hasAttribute("disabled")).toBe(true);
  });

  it("400 : l'erreur de ligne est rattachée à la bonne cellule et rien n'est enregistré (tout ou rien)", async () => {
    setTestApi(
      routes({
        [BULK]: () =>
          json(apiErrorBody("primary_school.invalid_input", "Lot refusé : aucune ligne n'a été enregistrée.", { issues: [{ path: ["lines", 1, "ratingLevelId"], message: "Niveau hors échelle.", code: "primary_school.scale_mismatch" }] }), { status: 400 }),
      }),
    );
    await open();
    fireEvent.click(screen.getByRole("button", { name: N3_C11 }));
    fireEvent.click(screen.getByRole("button", { name: BTN("N2", "En cours d'acquisition", "Compétence 1.2 (fictive)") }));
    fireEvent.click(screen.getByRole("button", { name: "Enregistrer" }));
    await screen.findByText(/Aucune ligne n'a été enregistrée \(tout ou rien\)/);
    const second = screen.getByRole("group", { name: /Compétence 1\.2/ });
    expect(within(second).getByRole("alert").textContent).toBe("Niveau hors échelle.");
    expect(within(screen.getByRole("group", { name: /Compétence 1\.1/ })).queryByRole("alert")).toBeNull();
    // Les saisies restent en attente.
    expect(counters()).toContain("2 saisies en attente");
  });
});

describe("Grille de compétences : saisie rapide", () => {
  it("« tous au niveau X sauf… » applique le niveau aux non saisies, puis les exceptions se corrigent", async () => {
    const api = setTestApi(routes({ [BULK]: () => json(bulkResult([])) }));
    await open();
    fireEvent.change(screen.getByLabelText("Niveau à appliquer"), { target: { value: level(3) } });
    fireEvent.click(screen.getByRole("button", { name: "Appliquer aux compétences non saisies" }));
    expect(counters()).toContain("12 sur 12 compétences renseignées");
    expect(counters()).toContain("12 saisies en attente");
    fireEvent.click(screen.getByRole("button", { name: N2_C11 }));
    fireEvent.click(screen.getByRole("button", { name: "Enregistrer" }));
    await waitFor(() => expect(api.calls.some((c) => c.method === "PUT")).toBe(true));
    const lines = (lastPut(api).body as { lines: Array<{ enrollmentId: string; competencyId: string; ratingLevelId: string }> }).lines;
    expect(lines).toHaveLength(12);
    expect(lines.find((l) => l.enrollmentId === enrollment(1) && l.competencyId === competency(1))!.ratingLevelId).toBe(level(2));
    expect(lines.filter((l) => l.ratingLevelId === level(3))).toHaveLength(11);
  });

  it("portée « l'élève affiché » : seules ses compétences sont remplies", async () => {
    setTestApi(routes());
    await open();
    fireEvent.change(screen.getByLabelText("Niveau à appliquer"), { target: { value: level(4) } });
    fireEvent.change(screen.getByLabelText("Portée"), { target: { value: "student" } });
    fireEvent.click(screen.getByRole("button", { name: "Appliquer aux compétences non saisies" }));
    expect(counters()).toContain("4 saisies en attente");
  });

  it("vue tableau : une liste déroulante par cellule, « Non évaluée » par défaut", async () => {
    const api = setTestApi(routes({ [BULK]: () => json(bulkResult([assessment(2, 3, 4)])) }));
    await open();
    fireEvent.click(screen.getByRole("button", { name: "Tableau" }));
    const cell = screen.getByLabelText("Bamba Yao, Compétence 2.1 (fictive)") as HTMLSelectElement;
    expect(cell.value).toBe("");
    expect(within(cell).getByRole("option", { name: "Non évaluée" })).toBeTruthy();
    fireEvent.change(cell, { target: { value: level(4) } });
    expect(counters()).toContain("1 saisie en attente");
    fireEvent.click(screen.getByRole("button", { name: "Enregistrer" }));
    await waitFor(() => expect(counters()).toContain("aucune saisie en attente"));
    expect(lastPut(api).body).toMatchObject({ lines: [{ enrollmentId: enrollment(2), competencyId: competency(3), ratingLevelId: level(4) }] });
  });
});

describe("Grille de compétences : verrou, droits, enregistrement différé", () => {
  it("période verrouillée : grille en lecture seule, aucun bouton d'enregistrement", async () => {
    setTestApi(routes({ [SHEET]: sheet({ locked: true }) }, [...RECORD, "primary.competency.validate"]));
    await open("Valider la grille");
    expect(screen.getByText(/La saisie est arrêtée pour cette classe et cette période/)).toBeTruthy();
    for (const b of screen.getAllByRole("button", { name: /^N\d — / })) expect(b.hasAttribute("disabled")).toBe(true);
    expect(screen.queryByRole("button", { name: "Enregistrer" })).toBeNull();
    expect(screen.queryByText("Tous au niveau… sauf")).toBeNull();
    const validate = screen.getByRole("button", { name: "Valider la grille" });
    expect(validate.hasAttribute("disabled")).toBe(true);
  });

  it("sans le droit de saisie : consultation seulement ; la saisie rapide est masquée", async () => {
    setTestApi(routes({}, ["primary.competency.read"]));
    await open(null);
    expect(await screen.findByText("Vous pouvez consulter la grille, mais pas la modifier.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Enregistrer" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Appliquer aux compétences non saisies" })).toBeNull();
  });

  it("fonctionnalité de l'offre absente : l'écran est masqué", async () => {
    setTestApi({ ...routes(), ...accessRoutes(RECORD, []) });
    renderWithProviders(<CompetenciesScreen />);
    expect(await screen.findByText("Cette fonctionnalité n'est pas incluse dans l'offre de votre établissement.")).toBeTruthy();
    expect(screen.queryByLabelText("Période")).toBeNull();
  });

  it("avertit avant de quitter avec des saisies en attente", async () => {
    setTestApi(routes());
    await open();
    const quiet = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(quiet);
    expect(quiet.defaultPrevented).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: N3_C11 }));
    const event = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    // Les sélecteurs de classe et de période sont verrouillés tant que des saisies attendent.
    expect((screen.getByLabelText("Classe") as HTMLSelectElement).closest("fieldset")!.hasAttribute("disabled")).toBe(true);
  });

  it("enregistrement différé : le lot part après une pause de saisie", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"], shouldAdvanceTime: true });
    try {
      const api = setTestApi(routes({ [BULK]: () => json(bulkResult([assessment(1, 1, 3)])) }));
      await open();
      fireEvent.click(screen.getByRole("button", { name: N3_C11 }));
      expect(api.calls.some((c) => c.method === "PUT")).toBe(false);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(5100);
      });
      await waitFor(() => expect(api.calls.some((c) => c.method === "PUT")).toBe(true));
      await waitFor(() => expect(counters()).toContain("aucune saisie en attente"));
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("Grille de compétences : validation, révision, synthèse", () => {
  it("valide la grille après confirmation et annonce validées / non évaluées restantes", async () => {
    const api = setTestApi(
      routes(
        {
          [SHEET]: sheet({ assessments: [assessment(1, 1, 3), assessment(1, 2, 2)] }),
          [`POST ${P}/classrooms/${ID.classroom}/periods/${ID.p1}/competencies/validate`]: () => json({ validated: 2, alreadyValidated: 0, expected: 12, missing: 10 }),
        },
        [...RECORD, "primary.competency.validate"],
      ),
    );
    await open("Valider la grille");
    fireEvent.click(screen.getByRole("button", { name: "Valider la grille" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("10 compétences restent non évaluées : elles le resteront.")).toBeTruthy();
    fireEvent.click(within(dialog).getByRole("button", { name: "Valider la grille" }));
    await screen.findByText("Grille validée : 2 compétences validées, 10 restées non évaluées.");
    expect(api.calls.find((c) => c.method === "POST")!.body).toEqual({ frameworkId: ID.framework });
  });

  it("la validation exige d'abord l'enregistrement des saisies", async () => {
    setTestApi(routes({ [SHEET]: sheet({ assessments: [assessment(1, 1, 3)] }) }, [...RECORD, "primary.competency.validate"]));
    await open();
    fireEvent.click(screen.getByRole("button", { name: N2_C11 }));
    expect(screen.getByRole("button", { name: "Valider la grille" }).hasAttribute("disabled")).toBe(true);
  });

  it("révision d'une ligne validée : motif de 10 caractères, droit sensible, historique", async () => {
    const api = setTestApi(
      routes(
        {
          [SHEET]: sheet({ assessments: [assessment(1, 1, 3, { status: "VALIDATED", validatedAt: "2026-10-01T09:00:00.000Z" })] }),
          [`GET ${P}/competency-assessments/${assessment(1, 1, 3).id}/revisions`]: { items: [{ id: ID.deliberation, assessmentId: assessment(1, 1, 3).id, fromLevelId: level(2), toLevelId: level(3), reason: "Erreur de saisie initiale", requestedBy: ID.staffChair, createdAt: "2026-10-01T09:30:00.000Z" }] },
          [`POST ${P}/competency-assessments/${assessment(1, 1, 3).id}/revisions`]: () => json({ assessment: assessment(1, 1, 4, { status: "VALIDATED", rowVersion: 2, validatedAt: "2026-10-01T09:00:00.000Z" }), revision: { id: ID.deliberation, assessmentId: assessment(1, 1, 3).id, fromLevelId: level(3), toLevelId: level(4), reason: "Nouvelle observation du maître", requestedBy: ID.staffChair, createdAt: "2026-10-02T09:30:00.000Z" } }, { status: 201 }),
        },
        [...RECORD, "primary.competency.revise"],
      ),
    );
    await open("Réviser");
    expect(screen.getByRole("button", { name: N3_C11 }).hasAttribute("disabled")).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Réviser" }));
    const dialog = await screen.findByRole("dialog");
    expect(await within(dialog).findByText(/N2 vers N3 le .* : Erreur de saisie initiale/)).toBeTruthy();
    fireEvent.change(within(dialog).getByLabelText(/Nouveau niveau/), { target: { value: level(4) } });
    fireEvent.change(within(dialog).getByLabelText(/Motif de la révision/), { target: { value: "court" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Réviser" }));
    await waitFor(() => expect(within(dialog).getAllByRole("alert").length).toBeGreaterThan(0));
    expect(api.calls.filter((c) => c.method === "POST")).toHaveLength(0);
    fireEvent.change(within(dialog).getByLabelText(/Motif de la révision/), { target: { value: "Nouvelle observation du maître" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Réviser" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(api.calls.find((c) => c.method === "POST")!.body).toEqual({ toRatingLevelId: level(4), reason: "Nouvelle observation du maître" });
  });

  it("sans la permission sensible de révision : le bouton n'existe pas", async () => {
    setTestApi(routes({ [SHEET]: sheet({ assessments: [assessment(1, 1, 3, { status: "VALIDATED" })] }) }));
    await open();
    expect(screen.getByText("Validée")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Réviser" })).toBeNull();
  });

  it("synthèse d'un élève : compteurs par domaine et niveau, jamais de pourcentage ni de moyenne", async () => {
    setTestApi(routes({ [`GET ${P}/enrollments/${enrollment(1)}/competency-summary`]: summary() }));
    await open();
    fireEvent.change(screen.getByLabelText("Élève à synthétiser"), { target: { value: enrollment(1) } });
    const table = await screen.findByRole("table", { name: "Nombre de compétences validées par domaine et par niveau de maîtrise" });
    const rows = within(table).getAllByRole("row");
    expect(rows).toHaveLength(3);
    expect(within(rows[1]!).getAllByRole("cell").map((c) => c.textContent)).toEqual(["0", "1", "1", "0"]);
    expect(table.textContent).not.toMatch(/%|moyenne/i);
  });
});

describe("Choix du référentiel", () => {
  it("plusieurs référentiels : le choix est proposé et transmis à l'API", async () => {
    const otherId = ID.domainB;
    const api = setTestApi(routes({ [SHEET]: sheet({ frameworks: [framework(), framework({ id: otherId, label: "Autre référentiel (fictif)" })] }) }));
    await open();
    const select = await screen.findByLabelText("Référentiel");
    fireEvent.change(select, { target: { value: otherId } });
    await waitFor(() => expect(api.calls.some((c) => c.query.frameworkId === otherId)).toBe(true));
  });
});
