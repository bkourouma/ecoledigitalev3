// @vitest-environment jsdom
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { accessRoutes, setTestApi } from "@/platform/test/api-mock";
import { json, renderWithProviders } from "@/platform/test/render";
import { apiErrorBody, caseId, councilAttendance, councilCase, councilOverview, councilSummary, HASH, ID, myClassroom, P, uuid } from "../_test/fixtures";
import { CouncilScreen } from "./CouncilScreen";

vi.mock("@/platform/api/default-client", async () => (await import("@/platform/test/api-mock")).defaultClientModule);

const COUNCIL = `${P}/councils/${ID.deliberation}`;
const MANAGE = ["primary.council.read", "primary.council.prepare", "primary.council.manage"];
const FEATURES = ["primary.council"];
const LIST_TITLE = "CE1 A · Trimestre 1";

function routes(over: Record<string, unknown> = {}, permissions: string[] = MANAGE) {
  return {
    ...accessRoutes(permissions, FEATURES),
    [`GET ${P}/my-classrooms`]: { items: [myClassroom()] },
    [`GET ${P}/rule-banner`]: { ruleSourceKind: "placeholder", isPlaceholder: true },
    [`GET ${P}/councils`]: { items: [councilSummary()] },
    [`GET ${COUNCIL}`]: councilOverview(),
    ...over,
  };
}

async function openSession(waitFor_: string | RegExp = "Confirmer la décision") {
  renderWithProviders(<CouncilScreen />);
  fireEvent.click(await screen.findByRole("button", { name: `Ouvrir le conseil ${LIST_TITLE}` }));
  await screen.findByRole("heading", { name: LIST_TITLE });
  await screen.findByRole("button", { name: waitFor_ });
}

const post = (api: ReturnType<typeof setTestApi>, suffix: string) => api.calls.filter((c) => c.method !== "GET" && c.path.endsWith(suffix));

describe("Conseil : séance", () => {
  it("affiche le bandeau de démonstration, le quorum sans règle (null) et les dossiers un par un", async () => {
    setTestApi(routes());
    await openSession();
    expect(screen.getAllByText("Règles de démonstration — document sans valeur officielle").length).toBeGreaterThan(0);
    expect(screen.getByTestId("quorum").textContent).toBe("Aucun quorum bloquant : 2 convoqués, 0 présents.");
    expect(screen.getByText("Dossier 1 sur 2")).toBeTruthy();
    // Motifs d'examen traduits par table de codes ; proposition de la règle et décision côte à côte.
    expect(screen.getByText("Cas limite")).toBeTruthy();
    expect(screen.getByTestId("rule-proposal").textContent).toBe("Passage en classe supérieure");
    expect(screen.getByTestId("council-decision").textContent).toBe("Pas encore décidé");
    fireEvent.click(screen.getByRole("button", { name: "Dossier suivant" }));
    expect(screen.getByText("Dossier 2 sur 2")).toBeTruthy();
    expect(screen.getByText("La règle ne tranche pas")).toBeTruthy();
    expect(screen.getByTestId("rule-proposal").textContent).toBe("Le conseil décide");
    // La règle ne tranche pas : on ne peut pas « confirmer » une proposition inexistante.
    expect((screen.getByRole("radio", { name: /Confirmer la proposition de la règle/ }) as HTMLInputElement).disabled).toBe(true);
    expect(screen.getByText("La règle ne tranche pas : choisissez une décision.")).toBeTruthy();
  });

  it("quorum évalué par une règle : atteint ou non, tel que renvoyé", async () => {
    setTestApi(routes({ [`GET ${COUNCIL}`]: councilOverview({ quorum: { convened: 5, present: 2, met: false, source: "rule" } }) }));
    await openSession();
    expect(screen.getByTestId("quorum").textContent).toBe("Quorum non atteint selon la règle : 2 présents sur 5 convoqués.");
  });

  it("décision différente de la règle : justification de 20 caractères exigée dans le formulaire, puis envoi du code retenu", async () => {
    const api = setTestApi(
      routes({
        [`POST ${COUNCIL}/cases/${caseId(1)}/decide`]: () => json({ caseId: caseId(1), status: "DECIDED", decisionId: uuid(9750), finalCode: "REPEAT", ruleProposalCode: "PROMOTED", changedFromProposal: true, outcomeRecorded: null }),
      }),
    );
    await openSession();
    fireEvent.click(screen.getByRole("radio", { name: "Retenir un autre code" }));
    fireEvent.change(screen.getByLabelText(/Décision retenue/), { target: { value: "REPEAT" } });
    fireEvent.change(screen.getByLabelText(/Justification/), { target: { value: "trop court" } });
    fireEvent.click(screen.getByRole("button", { name: "Confirmer la décision" }));
    expect((await screen.findByRole("alert")).textContent).toContain("La justification compte au moins 20 caractères.");
    expect(post(api, "/decide")).toHaveLength(0);
    fireEvent.change(screen.getByLabelText(/Justification/), { target: { value: "Progrès constatés en fin de période mais bases fragiles." } });
    fireEvent.click(screen.getByRole("button", { name: "Confirmer la décision" }));
    await screen.findByText(/Décision enregistrée : Redoublement\./);
    expect(post(api, "/decide")[0]!.body).toEqual({ finalCode: "REPEAT", justification: "Progrès constatés en fin de période mais bases fragiles." });
    expect(screen.getByText(/Elle diffère de la proposition de la règle/)).toBeTruthy();
  });

  it("confirmer la proposition de la règle : aucun code envoyé ; le message de l'API est affiché tel quel", async () => {
    let first = true;
    const api = setTestApi(
      routes({
        [`POST ${COUNCIL}/cases/${caseId(1)}/decide`]: () => {
          if (first) {
            first = false;
            return json(apiErrorBody("primary_school.case_no_decision", "La règle n'a produit aucune proposition pour cet élève : les résultats de la période ne sont pas calculés."), { status: 409 });
          }
          return json({ caseId: caseId(1), status: "DECIDED", decisionId: uuid(9750), finalCode: "PROMOTED", ruleProposalCode: "PROMOTED", changedFromProposal: false, outcomeRecorded: "PROMOTED" });
        },
      }),
    );
    await openSession();
    fireEvent.click(screen.getByRole("button", { name: "Confirmer la décision" }));
    expect((await screen.findByRole("alert")).textContent).toContain("La règle n'a produit aucune proposition pour cet élève");
    fireEvent.click(screen.getByRole("button", { name: "Confirmer la décision" }));
    await screen.findByText(/Issue d'inscription enregistrée : Passage en classe supérieure\./);
    expect(post(api, "/decide")[1]!.body).toEqual({});
  });

  it("un dossier décidé affiche la décision et sa justification, sans formulaire", async () => {
    setTestApi(routes({ [`GET ${COUNCIL}`]: councilOverview({ cases: [councilCase(1, { status: "DECIDED", finalCode: "REPEAT", justification: "Décision du conseil du jour.", decisionRef: uuid(9750) })] }) }));
    renderWithProviders(<CouncilScreen />);
    fireEvent.click(await screen.findByRole("button", { name: `Ouvrir le conseil ${LIST_TITLE}` }));
    await screen.findByText("Justification : Décision du conseil du jour.");
    expect(screen.getByTestId("council-decision").textContent).toBe("Redoublement");
    expect(screen.queryByRole("button", { name: "Confirmer la décision" })).toBeNull();
  });
});

describe("Conseil : permissions", () => {
  it("l'instituteur (préparer seulement) enregistre sa proposition ; décisions, présence et procès-verbal sont masqués", async () => {
    const api = setTestApi(
      routes(
        { [`PATCH ${COUNCIL}/cases/${caseId(1)}`]: () => json({ id: caseId(1), status: "OPEN", proposalCode: "PROMOTED", proposalNote: null, discussionNote: null, reasonCodes: ["BORDERLINE"] }) },
        ["primary.council.read", "primary.council.prepare"],
      ),
    );
    await openSession("Enregistrer ma proposition");
    expect(screen.queryByRole("button", { name: "Confirmer la décision" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Enregistrer la feuille de présence" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Demander le procès-verbal" })).toBeNull();
    expect(screen.getByText("La feuille de présence est tenue par la présidence du conseil.")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Ma proposition", { selector: "select" }), { target: { value: "PROMOTED" } });
    fireEvent.click(screen.getByRole("button", { name: "Enregistrer ma proposition" }));
    await screen.findByText("Proposition enregistrée.");
    expect(api.calls.find((c) => c.method === "PATCH")!.body).toEqual({ proposalCode: "PROMOTED", proposalNote: null });
  });

  it("fonctionnalité de l'offre absente : le conseil est masqué", async () => {
    setTestApi({ ...routes(), ...accessRoutes(MANAGE, []) });
    renderWithProviders(<CouncilScreen />);
    expect(await screen.findByText("Cette fonctionnalité n'est pas incluse dans l'offre de votre établissement.")).toBeTruthy();
  });
});

describe("Conseil : préparation", () => {
  it("prépare le conseil d'une classe et d'une période puis ouvre la séance", async () => {
    const api = setTestApi(routes({ [`GET ${P}/councils`]: { items: [] }, [`POST ${P}/councils/prepare`]: () => json(councilOverview(), { status: 201 }) }));
    renderWithProviders(<CouncilScreen />);
    expect(await screen.findByText("Aucun conseil n'a encore été préparé.")).toBeTruthy();
    const period = await screen.findByLabelText("Période");
    await within(period).findByRole("option", { name: "Trimestre 1" });
    fireEvent.change(period, { target: { value: ID.p1 } });
    fireEvent.click(await screen.findByRole("button", { name: "Préparer le conseil" }));
    await screen.findByRole("heading", { name: LIST_TITLE });
    expect(api.calls.find((c) => c.method === "POST")!.body).toEqual({ classroomId: ID.classroom, periodId: ID.p1 });
  });
});

describe("Conseil : feuille de présence", () => {
  it("coche présence et signature, envoie les lignes non signées ; une présence signée est figée", async () => {
    let saved = false;
    const after = () => councilOverview({ attendance: [councilAttendance(ID.staffChair, "Direction Kouassi", "CHAIR", { present: true, signedAt: "2026-10-01T09:00:00.000Z" }), councilAttendance(ID.staffSecretary, "Secrétaire Traoré", "SECRETARY", { present: true })] });
    const api = setTestApi(
      routes({
        [`GET ${COUNCIL}`]: () => json(saved ? after() : councilOverview()),
        [`PUT ${COUNCIL}/attendance`]: () => {
          saved = true;
          return json(after());
        },
      }),
    );
    await openSession("Enregistrer la feuille de présence");
    // Signature impossible sans présence.
    expect((screen.getByLabelText("Signature de Secrétaire Traoré") as HTMLInputElement).disabled).toBe(true);
    fireEvent.change(screen.getByLabelText("Présence de Secrétaire Traoré"), { target: { value: "yes" } });
    fireEvent.click(screen.getByLabelText("Signature de Secrétaire Traoré"));
    fireEvent.click(screen.getByRole("button", { name: "Enregistrer la feuille de présence" }));
    await screen.findByText("Feuille de présence enregistrée.");
    expect(api.calls.find((c) => c.method === "PUT" && c.path.endsWith("/attendance"))!.body).toEqual({
      participants: [
        { staffId: ID.staffChair, roleCode: "CHAIR", convened: true, present: null },
        { staffId: ID.staffSecretary, roleCode: "SECRETARY", convened: true, present: true },
      ],
      signedStaffIds: [ID.staffSecretary],
    });
    // Après relecture : la présence du président est signée, donc figée.
    await screen.findByText(/Signée le/);
    expect((screen.getByLabelText("Présence de Direction Kouassi") as HTMLSelectElement).disabled).toBe(true);
    expect((screen.getByLabelText("Rôle de Direction Kouassi") as HTMLSelectElement).disabled).toBe(true);
  });

  it("deux présidents : refusé par le formulaire (contrat), rien n'est envoyé", async () => {
    const api = setTestApi(routes());
    await openSession("Enregistrer la feuille de présence");
    fireEvent.change(screen.getByLabelText("Rôle de Secrétaire Traoré"), { target: { value: "CHAIR" } });
    fireEvent.click(screen.getByRole("button", { name: "Enregistrer la feuille de présence" }));
    expect((await screen.findAllByRole("alert")).some((a) => a.textContent?.includes("Un seul président."))).toBe(true);
    expect(api.calls.filter((c) => c.method === "PUT")).toHaveLength(0);
  });
});

describe("Conseil : procès-verbal", () => {
  it("la date réelle de séance est obligatoire ; document indisponible : message explicatif, pas d'erreur brute", async () => {
    const api = setTestApi(
      routes({
        [`POST ${COUNCIL}/minutes`]: () => json(apiErrorBody("primary_school.port_unavailable", "Le service « documents » n'est pas disponible : opération refusée.", { details: { port: "documents" } }), { status: 500 }),
      }),
    );
    await openSession("Demander le procès-verbal");
    fireEvent.click(screen.getByRole("button", { name: "Demander le procès-verbal" }));
    expect((await screen.findAllByRole("alert")).some((a) => a.textContent?.includes("Indiquez la date réelle de la séance."))).toBe(true);
    expect(api.calls.filter((c) => c.method === "POST")).toHaveLength(0);
    fireEvent.change(screen.getByLabelText(/Date réelle de la séance/), { target: { value: "2026-10-01" } });
    fireEvent.click(screen.getByRole("button", { name: "Demander le procès-verbal" }));
    const alert = await screen.findByText(/Ce document ou ce service n'est pas disponible pour le moment/);
    expect(alert.closest("[role=alert]")).toBeTruthy();
    expect(screen.queryByText(/opération refusée/)).toBeNull();
    expect(api.calls.find((c) => c.method === "POST")!.body).toEqual({ heldOn: "2026-10-01" });
  });

  it("demande réussie : le document sera disponible dans les documents officiels", async () => {
    setTestApi(routes({ [`GET ${COUNCIL}`]: councilOverview({ heldOn: "2026-10-01" }), [`POST ${COUNCIL}/minutes`]: () => json({ documentId: uuid(9770), contentHash: HASH, version: 1, alreadyRequested: false }, { status: 201 }) }));
    await openSession("Demander le procès-verbal");
    expect((screen.getByLabelText(/Date réelle de la séance/) as HTMLInputElement).value).toBe("2026-10-01");
    fireEvent.click(screen.getByRole("button", { name: "Demander le procès-verbal" }));
    await screen.findByText("Procès-verbal demandé : il sera disponible dans les documents officiels.");
    await waitFor(() => expect(screen.queryByText(/Indiquez la date réelle/)).toBeNull());
  });
});
