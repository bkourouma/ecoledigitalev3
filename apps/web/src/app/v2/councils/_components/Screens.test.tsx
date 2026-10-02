// @vitest-environment jsdom
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { accessRoutes, setTestApi } from "@/platform/test/api-mock";
import { json, renderWithProviders } from "@/platform/test/render";
import { classroom, year } from "../../_test/fixtures";
import { agendaDto, agendaItemDto, councilDto, decisionDto, detailDto, effectDto, effectsDto, factsDto, familyDto, IDS, itemDetailDto, listDto, minutesDetailDto, minutesDto, proposalDto, referenceDto, unlockDto, uuid } from "../_test/fixtures";
import { CalendarScreen } from "./CalendarScreen";
import { CouncilFileScreen } from "./CouncilFileScreen";
import { DeliberationScreen } from "./DeliberationScreen";
import { EffectsScreen } from "./EffectsScreen";
import { HistoryScreen } from "./HistoryScreen";
import { MinutesScreen } from "./MinutesScreen";
import { OrientationScreen } from "./OrientationScreen";
import { PortalScreen } from "./PortalScreen";
import { SettingsScreen } from "./SettingsScreen";
import { StudentItemScreen } from "./StudentItemScreen";

// Écrans complets rendus avec le vrai catalogue : marge pour les machines chargées (tests lancés en parallèle).
vi.setConfig({ testTimeout: 30_000 });

vi.mock("@/platform/api/default-client", async () => (await import("@/platform/test/api-mock")).defaultClientModule);
vi.mock("next/link", () => ({ default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a> }));

const C = "/api/v1/councils";
const COUNCIL = `${C}/councils/${IDS.council}`;
afterEach(() => vi.restoreAllMocks());

const reasonOf = (api: { calls: Array<{ method: string; path: string; body: unknown }> }, suffix: string) => api.calls.find((c) => c.method === "POST" && c.path.endsWith(suffix));

describe("CalendarScreen : calendrier des conseils", () => {
  const routes = (extra: Record<string, unknown> = {}) => ({
    ...accessRoutes(["council.read", "council.manage", "academic.classroom.read"]),
    [`GET ${C}/councils`]: listDto([councilDto(), councilDto({ id: uuid(2002), status: "SIGNED", ruleSourceKind: "placeholder", counts: { agendaItems: 30, decided: 30, participants: 5, present: 5 }, resultsStateId: null })]),
    "GET /api/v1/academic/classrooms": { items: [classroom({ id: IDS.classroom, name: "6e A" })], total: 1, page: 1, pageSize: 200 },
    "GET /api/v1/academic/years": { items: [year()] },
    [`GET ${C}/reference`]: referenceDto(),
    [`GET ${C}/classrooms/${IDS.classroom}/council-summary`]: { classroomId: IDS.classroom, councils: [], decisionsByCode: { TYPE_A: 3 }, effects: { pending: 1, failed: 0, awaitingHuman: 2 }, reviewNeeded: [uuid(2002)] },
    ...extra,
  });

  it("liste les séances (statut, avancement, état des résultats) et signale les règles de démonstration", async () => {
    setTestApi(routes());
    renderWithProviders(<CalendarScreen />);
    const table = await screen.findByRole("region", { name: "Tableau : Conseils de classe" });
    expect(within(table).getAllByRole("link", { name: /Conseil de classe \(type test\)/ })).toHaveLength(2);
    expect(within(table).getByText("Planifié")).toBeTruthy();
    expect(within(table).getByText("Signé")).toBeTruthy();
    expect(within(table).getByText("1 décidé(s) sur 2 · 2 présent(s) sur 3")).toBeTruthy();
    expect(within(table).getByText("Résultats liés")).toBeTruthy();
    expect(within(table).getByText("Résultats non liés")).toBeTruthy();
    expect(within(table).getByText("Règles de démonstration")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Planifier un conseil" })).toBeTruthy();
  });

  it("classe choisie : synthèse, effets et alerte « conseil à revoir » ; le filtre part vers l'API", async () => {
    const api = setTestApi(routes());
    renderWithProviders(<CalendarScreen />);
    await screen.findByRole("region", { name: "Tableau : Conseils de classe" });
    fireEvent.change(await screen.findByLabelText("Classe"), { target: { value: IDS.classroom } });
    expect(await screen.findByText(/Conseil à revoir : la période de résultats a été rouverte/)).toBeTruthy();
    expect(screen.getByText("2 à appliquer par un humain")).toBeTruthy();
    expect(screen.getByText("TYPE_A : 3")).toBeTruthy();
    await waitFor(() => expect(api.calls.some((c) => c.path === `${C}/councils` && c.query.classroomId === IDS.classroom)).toBe(true));
    expect(screen.getByText("À revoir")).toBeTruthy();
  });

  it("sans permission de gestion : aucun bouton de planification", async () => {
    setTestApi(routes({ ...accessRoutes(["council.read", "academic.classroom.read"]) }));
    renderWithProviders(<CalendarScreen />);
    await screen.findByRole("region", { name: "Tableau : Conseils de classe" });
    expect(screen.queryByRole("button", { name: "Planifier un conseil" })).toBeNull();
  });
});

describe("CouncilFileScreen : dossier de classe", () => {
  const baseRoutes = (detail: unknown, extra: Record<string, unknown> = {}) => ({
    ...accessRoutes(["council.read", "council.manage", "council.prepare", "council.session.run"]),
    [`GET ${COUNCIL}`]: detail,
    [`GET ${COUNCIL}/agenda`]: agendaDto(),
    [`GET ${COUNCIL}/proposed-participants`]: { items: [{ staffId: uuid(5003), displayName: "M. NOUVEAU", roleCode: "ENSEIGNANT", councilFunction: null, source: "TEACHING" }] },
    [`GET ${C}/reference`]: referenceDto(),
    ...extra,
  });

  it("affiche l'état, le quorum de l'API, les participants, l'ordre du jour avec lien vers la fiche, sans bandeau de démonstration", async () => {
    setTestApi(baseRoutes(detailDto()));
    renderWithProviders(<CouncilFileScreen councilId={IDS.council} />);
    const bar = await screen.findByRole("status", { name: "État de la séance" });
    expect(within(bar).getByText("Quorum atteint")).toBeTruthy();
    expect(within(bar).getByText("2 présent(s) sur 2 requis")).toBeTruthy();
    expect(screen.getByText("Mme DIRECTRICE")).toBeTruthy();
    expect(await screen.findByText("M. NOUVEAU")).toBeTruthy();
    expect(await screen.findByRole("link", { name: "Ouvrir la fiche de KOUASSI Awa" })).toHaveProperty("href", expect.stringContaining(`/v2/councils/${IDS.council}/eleves/${IDS.item}`));
    expect(screen.queryByText("Règles de démonstration — non réglementaires")).toBeNull();
  });

  it("jeu de règles de démonstration : bandeau fourni par l'API", async () => {
    setTestApi(baseRoutes(detailDto({ council: { ruleSourceKind: "placeholder" } })));
    renderWithProviders(<CouncilFileScreen councilId={IDS.council} />);
    expect(await screen.findByText("Règles de démonstration — non réglementaires")).toBeTruthy();
  });

  it("quorum non atteint avec dérogation autorisée : motif exigé (10 caractères) avant l'ouverture", async () => {
    const api = setTestApi(
      baseRoutes(detailDto({ quorum: { met: false, presentCount: 1, requiredMin: 2, missingRoles: ["DIRECTION"], presidentPresent: false, waiverAllowed: true } }), {
        [`POST ${COUNCIL}/open`]: () => json(detailDto({ council: { status: "OPEN", quorumWaived: true } })),
      }),
    );
    renderWithProviders(<CouncilFileScreen councilId={IDS.council} />);
    const bar = await screen.findByRole("status", { name: "État de la séance" });
    expect(within(bar).getByText("Quorum non atteint")).toBeTruthy();
    expect(within(bar).getByText(/Rôles manquants : DIRECTION/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Ouvrir la séance" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText(/Motif de la dérogation au quorum/), { target: { value: "court" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Ouvrir malgré tout" }));
    expect(await within(dialog).findByText(/10 caractères/)).toBeTruthy();
    expect(api.calls.filter((c) => c.method === "POST")).toHaveLength(0);
    fireEvent.change(within(dialog).getByLabelText(/Motif de la dérogation au quorum/), { target: { value: "Absence imprévue du président" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Ouvrir malgré tout" }));
    await waitFor(() => expect(reasonOf(api, "/open")?.body).toEqual({ quorumWaiverReason: "Absence imprévue du président" }));
  });

  it("quorum non atteint sans dérogation possible : ouverture bloquée avec explication", async () => {
    setTestApi(baseRoutes(detailDto({ quorum: { met: false, presentCount: 1, requiredMin: 2, waiverAllowed: false } })));
    renderWithProviders(<CouncilFileScreen councilId={IDS.council} />);
    const open = await screen.findByRole("button", { name: "Ouvrir la séance" });
    expect((open as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(/n'autorise pas de dérogation/)).toBeTruthy();
  });

  it("préparer : rapport de l'API affiché ; annulation : motif exigé", async () => {
    const api = setTestApi(
      baseRoutes(detailDto(), {
        [`POST ${COUNCIL}/prepare`]: () => json({ councilId: IDS.council, created: 2, rebuilt: 0, unchanged: 0, skipped: 1, warnings: [{ code: "councils.attendance_unavailable", message: "Assiduité indisponible pour la période." }] }),
        [`POST ${COUNCIL}/cancel`]: () => json(councilDto({ status: "CANCELLED", cancelReason: "Séance reportée" })),
      }),
    );
    renderWithProviders(<CouncilFileScreen councilId={IDS.council} />);
    fireEvent.click(await screen.findByRole("button", { name: "Préparer la séance" }));
    expect(await screen.findByText("Préparation terminée : 2 créé(s), 0 reconstruit(s), 0 inchangé(s), 1 ignoré(s).")).toBeTruthy();
    expect(screen.getByText("Assiduité indisponible pour la période.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Annuler la séance" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText(/Motif de l'annulation/), { target: { value: "ab" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Annuler la séance" }));
    expect(await within(dialog).findByText(/5 caractères/)).toBeTruthy();
    fireEvent.change(within(dialog).getByLabelText(/Motif de l'annulation/), { target: { value: "Séance reportée" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Annuler la séance" }));
    await waitFor(() => expect(reasonOf(api, "/cancel")?.body).toEqual({ reason: "Séance reportée" }));
  });

  it("présence : changement envoyé à l'API ; un 404 donne l'état « introuvable »", async () => {
    const api = setTestApi(baseRoutes(detailDto(), { [`POST ${COUNCIL}/participants/${IDS.partAbsent}/presence`]: () => json({ ...detailDto().participants[2], presence: "PRESENT" }) }));
    renderWithProviders(<CouncilFileScreen councilId={IDS.council} />);
    fireEvent.change(await screen.findByLabelText("Présence de M. ABSENT"), { target: { value: "PRESENT" } });
    await waitFor(() => expect(reasonOf(api, "/presence")?.body).toEqual({ presence: "PRESENT" }));
  });

  it("hors périmètre (404) : état « introuvable » avec retour au calendrier", async () => {
    setTestApi({ ...accessRoutes(["council.read"]), [`GET ${COUNCIL}`]: () => json({ status: 404, code: "councils.not_found", kind: "NOT_FOUND", message: "Conseil introuvable." }, { status: 404 }) });
    renderWithProviders(<CouncilFileScreen councilId={IDS.council} />);
    expect(await screen.findByText("Élément introuvable")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Retour au calendrier" })).toBeTruthy();
  });
});

describe("StudentItemScreen : fiche élève", () => {
  const routes = (item: unknown, extra: Record<string, unknown> = {}) => ({
    ...accessRoutes(["council.read", "council.decision.record", "council.proposal.write", "council.session.run"]),
    [`GET ${COUNCIL}`]: detailDto({ council: { status: "OPEN" } }),
    [`GET ${C}/agenda/${IDS.item}`]: item,
    [`GET ${C}/reference`]: referenceDto(),
    ...extra,
  });
  const fill = async (typeId: string) => {
    const select = await screen.findByLabelText(/Type de décision/);
    await waitFor(() => expect(within(select).getAllByRole("option").length).toBeGreaterThan(1));
    await waitFor(() => expect(within(screen.getByLabelText(/Décideur présent/)).getAllByRole("option").length).toBeGreaterThan(1));
    fireEvent.change(select, { target: { value: typeId } });
    fireEvent.change(screen.getByLabelText(/Décideur présent/), { target: { value: IDS.partPresident } });
  };

  it("faits figés avec version et empreinte ; suggestion ÉTIQUETÉE, jamais présentée comme une décision", async () => {
    setTestApi(routes(itemDetailDto()));
    renderWithProviders(<StudentItemScreen councilId={IDS.council} itemId={IDS.item} />);
    expect(await screen.findByRole("heading", { name: "KOUASSI Awa" })).toBeTruthy();
    expect(screen.getByText(/Faits figés, version 2/)).toBeTruthy();
    expect(screen.getByText("12,50")).toBeTruthy();
    expect(screen.getByText("3 sur 28")).toBeTruthy();
    const suggestions = screen.getByRole("heading", { name: "Suggestions des règles" }).closest("section")!;
    expect(within(suggestions).getByText("Suggestion")).toBeTruthy();
    expect(within(suggestions).getByText("SUGG_PASS")).toBeTruthy();
    expect(within(suggestions).getByText(/ce ne sont pas des décisions/)).toBeTruthy();
    // La suggestion consignée est étiquetée dans les propositions et aucune décision n'est enregistrée.
    expect(screen.getAllByText("Suggestion").length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText("Aucune décision enregistrée pour cet élève.")).toBeTruthy();
    expect(screen.getByText("Élève sérieuse")).toBeTruthy();
  });

  it("résultats manquants : avertissement et justification exigée pour une décision de passage", async () => {
    const api = setTestApi(routes(itemDetailDto({ facts: factsDto({ results: { status: "ERROR", average: null, averageDisplay: null, rank: null, cohortSize: null, mentionCode: null, missingResults: true, ruleVersionRef: null, suggestions: [], appreciations: [] } }) })));
    renderWithProviders(<StudentItemScreen councilId={IDS.council} itemId={IDS.item} />);
    expect(await screen.findByText(/Aucun résultat exploitable pour cet élève/)).toBeTruthy();
    await fill(IDS.decisionTypeA);
    fireEvent.click(screen.getByRole("button", { name: "Enregistrer la décision" }));
    expect(await screen.findByText("La justification est obligatoire pour cette décision.")).toBeTruthy();
    expect(api.calls.filter((c) => c.method === "POST")).toHaveLength(0);
  });

  it("type exigeant une justification : refus local sans envoi, puis décision enregistrée avec le corps exact", async () => {
    const api = setTestApi(routes(itemDetailDto(), { [`POST ${C}/agenda/${IDS.item}/decisions`]: () => json(decisionDto({ id: uuid(3602), decisionTypeId: IDS.decisionTypeB, decisionTypeCode: "TYPE_B", differsFromSuggestion: true, justification: "Progrès constatés" }), { status: 201 }) }));
    renderWithProviders(<StudentItemScreen councilId={IDS.council} itemId={IDS.item} />);
    await fill(IDS.decisionTypeB);
    expect(screen.getByText("Ce type exige une justification.")).toBeTruthy();
    expect(screen.getByText("Ce type diffère de la suggestion des règles : une justification sera exigée.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Enregistrer la décision" }));
    expect(await screen.findByText("La justification est obligatoire pour cette décision.")).toBeTruthy();
    expect(api.calls.filter((c) => c.method === "POST")).toHaveLength(0);
    fireEvent.change(screen.getByLabelText(/^Justification/), { target: { value: "Progrès constatés" } });
    fireEvent.click(screen.getByRole("button", { name: "Enregistrer la décision" }));
    await waitFor(() => expect(reasonOf(api, "/decisions")?.body).toEqual({ decisionTypeId: IDS.decisionTypeB, deciderParticipantId: IDS.partPresident, mode: "CONSENSUS", justification: "Progrès constatés" }));
    expect(await screen.findByText("Décision enregistrée.")).toBeTruthy();
  });

  it("écart détecté par l'API : le refus (code councils.justification_required) rend la justification obligatoire", async () => {
    const api = setTestApi(
      routes(itemDetailDto(), {
        [`POST ${C}/agenda/${IDS.item}/decisions`]: () => json({ status: 422, code: "councils.justification_required", kind: "VALIDATION", message: "Une décision en écart avec la suggestion exige une justification.", issues: [{ path: ["justification"], message: "Justification obligatoire en cas d'écart." }] }, { status: 422 }),
      }),
    );
    renderWithProviders(<StudentItemScreen councilId={IDS.council} itemId={IDS.item} />);
    await fill(IDS.decisionTypeA);
    fireEvent.click(screen.getByRole("button", { name: "Enregistrer la décision" }));
    expect(await screen.findByText("Justification obligatoire en cas d'écart.")).toBeTruthy();
    expect(reasonOf(api, "/decisions")).toBeTruthy();
    expect(screen.getByText("Obligatoire pour cette décision.")).toBeTruthy();
  });

  it("mode vote : les voix sont saisies et envoyées sans aucun total calculé", async () => {
    const api = setTestApi(routes(itemDetailDto(), { [`POST ${C}/agenda/${IDS.item}/decisions`]: () => json(decisionDto({ mode: "VOTE", votesFor: 5, votesAgainst: 2, votesAbstain: 1 }), { status: 201 }) }));
    renderWithProviders(<StudentItemScreen councilId={IDS.council} itemId={IDS.item} />);
    await fill(IDS.decisionTypeA);
    fireEvent.change(screen.getByLabelText(/Mode de décision/), { target: { value: "VOTE" } });
    fireEvent.click(screen.getByRole("button", { name: "Enregistrer la décision" }));
    expect((await screen.findAllByText("Un vote consigne les voix pour, contre et les abstentions.")).length).toBeGreaterThan(0);
    fireEvent.change(screen.getByLabelText(/Voix pour/), { target: { value: "5" } });
    fireEvent.change(screen.getByLabelText(/Voix contre/), { target: { value: "2" } });
    fireEvent.change(screen.getByLabelText(/Abstentions/), { target: { value: "1" } });
    fireEvent.click(screen.getByRole("button", { name: "Enregistrer la décision" }));
    await waitFor(() => expect(reasonOf(api, "/decisions")?.body).toEqual({ decisionTypeId: IDS.decisionTypeA, deciderParticipantId: IDS.partPresident, mode: "VOTE", votesFor: 5, votesAgainst: 2, votesAbstain: 1 }));
  });

  it("décision du même groupe exclusif déjà enregistrée : remplacement avec motif de retrait", async () => {
    const api = setTestApi(routes(itemDetailDto({ decisions: [decisionDto()], proposals: [] }), { [`POST ${C}/agenda/${IDS.item}/decisions`]: () => json(decisionDto({ id: uuid(3603) }), { status: 201 }) }));
    renderWithProviders(<StudentItemScreen councilId={IDS.council} itemId={IDS.item} />);
    await fill(IDS.decisionTypeA);
    expect(screen.getByText(/Une décision du même groupe est déjà enregistrée/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Enregistrer la décision" }));
    expect(await screen.findByText(/exige un motif de retrait/)).toBeTruthy();
    expect(api.calls.filter((c) => c.method === "POST")).toHaveLength(0);
    fireEvent.change(screen.getByLabelText(/Motif du remplacement/), { target: { value: "Erreur de choix" } });
    fireEvent.click(screen.getByRole("button", { name: "Enregistrer la décision" }));
    await waitFor(() => expect(reasonOf(api, "/decisions")?.body).toEqual({ decisionTypeId: IDS.decisionTypeA, deciderParticipantId: IDS.partPresident, mode: "CONSENSUS", supersedesDecisionId: uuid(3601), supersedeReason: "Erreur de choix" }));
  });

  it("la décision enregistrée montre la suggestion à côté, l'écart, la version des faits ; le retrait exige un motif", async () => {
    const api = setTestApi(routes(itemDetailDto({ proposals: [], decisions: [decisionDto({ differsFromSuggestion: true, justification: "Progrès constatés", suggestedCode: "SUGG_PASS" })] }), { [`POST ${C}/decisions/${uuid(3601)}/withdraw`]: () => json(decisionDto({ status: "WITHDRAWN", withdrawnReason: "Erreur de saisie" })) }));
    renderWithProviders(<StudentItemScreen councilId={IDS.council} itemId={IDS.item} />);
    const panel = (await screen.findByRole("heading", { name: "Décisions" })).closest("section")!;
    expect(within(panel).getByText("Écart avec la suggestion")).toBeTruthy();
    expect(within(panel).getByText("Suggestion : SUGG_PASS")).toBeTruthy();
    expect(within(panel).getByText("Progrès constatés")).toBeTruthy();
    expect(within(panel).getByText(/version 2/)).toBeTruthy();
    fireEvent.click(within(panel).getByRole("button", { name: "Retirer la décision" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText(/Motif du retrait/), { target: { value: "Erreur de saisie" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Retirer" }));
    await waitFor(() => expect(reasonOf(api, "/withdraw")?.body).toEqual({ reason: "Erreur de saisie" }));
  });

  it("propositions : accepter une suggestion de la règle ; ajouter une appréciation humaine", async () => {
    const api = setTestApi(
      routes(itemDetailDto(), {
        [`POST ${C}/proposals/${uuid(3501)}/accept`]: () => json(proposalDto({ status: "ACCEPTED" })),
        [`POST ${C}/agenda/${IDS.item}/proposals`]: () => json(proposalDto({ id: uuid(3502), kind: "APPRECIATION", code: null, body: "Peut mieux faire", origin: "HUMAN", status: "PROPOSED" }), { status: 201 }),
      }),
    );
    renderWithProviders(<StudentItemScreen councilId={IDS.council} itemId={IDS.item} />);
    fireEvent.click(await screen.findByRole("button", { name: "Accepter" }));
    await waitFor(() => expect(reasonOf(api, "/accept")?.body).toEqual({}));
    fireEvent.click(screen.getByRole("button", { name: "Ajouter une proposition" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Ajouter" }));
    expect(await within(dialog).findByText(/Une appréciation ou une remarque porte un texte/)).toBeTruthy();
    fireEvent.change(within(dialog).getByLabelText(/Texte/), { target: { value: "Peut mieux faire" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Ajouter" }));
    await waitFor(() => expect(reasonOf(api, "/proposals")?.body).toEqual({ kind: "APPRECIATION", body: "Peut mieux faire" }));
  });

  it("jeu de règles de démonstration : bandeau sur la fiche (valeur de l'API)", async () => {
    setTestApi(routes(itemDetailDto({ ruleSourceKind: "placeholder" })));
    renderWithProviders(<StudentItemScreen councilId={IDS.council} itemId={IDS.item} />);
    expect(await screen.findByText("Règles de démonstration — non réglementaires")).toBeTruthy();
  });
});

describe("DeliberationScreen : mode séance", () => {
  it("navigue élève par élève, garde le bandeau de quorum et charge la fiche courante", async () => {
    setTestApi({
      ...accessRoutes(["council.read", "council.decision.record", "council.session.run"]),
      [`GET ${COUNCIL}`]: detailDto({ council: { status: "OPEN" } }),
      [`GET ${COUNCIL}/agenda`]: agendaDto(undefined, "OPEN"),
      [`GET ${C}/agenda/${IDS.item}`]: itemDetailDto(),
      [`GET ${C}/agenda/${IDS.item2}`]: itemDetailDto({ item: { id: IDS.item2, studentName: "TRAORE Moussa" }, proposals: [], facts: factsDto({ results: { average: "9.00", averageDisplay: "9,00" } }) }),
      [`GET ${C}/reference`]: referenceDto(),
    });
    renderWithProviders(<DeliberationScreen councilId={IDS.council} />);
    expect(await screen.findByRole("heading", { name: "KOUASSI Awa" })).toBeTruthy();
    expect(screen.getByText("Élève 1 sur 2")).toBeTruthy();
    expect(screen.getByRole("status", { name: "État de la séance" })).toBeTruthy();
    expect((screen.getByRole("button", { name: "Élève précédent" }) as HTMLButtonElement).disabled).toBe(true);
    expect(await screen.findByText("12,50")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Élève suivant" }));
    expect(await screen.findByRole("heading", { name: "TRAORE Moussa" })).toBeTruthy();
    expect(screen.getByText("Élève 2 sur 2")).toBeTruthy();
    expect(await screen.findByText("9,00")).toBeTruthy();
    expect((screen.getByRole("button", { name: "Élève suivant" }) as HTMLButtonElement).disabled).toBe(true);
  });
});

describe("MinutesScreen : procès-verbal", () => {
  const routes = (minutes = minutesDto(), extra: Record<string, unknown> = {}, council = detailDto({ council: { status: "CLOSED", ruleSourceKind: "placeholder" } })) => ({
    ...accessRoutes(["council.read", "council.minutes.read", "council.minutes.generate", "council.minutes.sign", "council.unlock.request", "council.unlock.approve"]),
    [`GET ${COUNCIL}`]: council,
    [`GET ${COUNCIL}/minutes`]: { items: [minutes] },
    [`GET ${C}/minutes/${IDS.minutes}`]: minutesDetailDto(minutes),
    [`GET ${COUNCIL}/unlock-requests`]: { items: [] },
    ...extra,
  });

  it("signataires manquants, bandeau et mention de démonstration, signature papier avec pièce exigée", async () => {
    const api = setTestApi(
      routes(minutesDto({ placeholderNotice: "Jeu de règles de démonstration, non réglementaire" }), {
        [`POST ${C}/minutes/${IDS.minutes}/signatures/paper`]: () => json(minutesDto({ status: "SIGNED" })),
      }),
    );
    renderWithProviders(<MinutesScreen councilId={IDS.council} />);
    expect(await screen.findByText("Règles de démonstration — non réglementaires")).toBeTruthy();
    expect(screen.getByText("Jeu de règles de démonstration, non réglementaire")).toBeTruthy();
    const missing = await screen.findByRole("list", { name: "Signataires manquants" });
    expect(within(missing).getByText(/Mme DIRECTRICE/)).toBeTruthy();
    expect(within(missing).getByText("À signer")).toBeTruthy();
    fireEvent.click(within(missing).getByRole("button", { name: "Enregistrer la signature papier de Mme DIRECTRICE" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Enregistrer" }));
    expect((await within(dialog).findAllByRole("alert")).length).toBeGreaterThan(0);
    expect(api.calls.filter((c) => c.method === "POST")).toHaveLength(0);
    fireEvent.change(within(dialog).getByLabelText(/Référence de la pièce numérisée/), { target: { value: "ged/pv-6e-a.pdf" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Enregistrer" }));
    await waitFor(() => expect(reasonOf(api, "/signatures/paper")?.body).toEqual({ participantId: IDS.partPresident, evidenceObjectKey: "ged/pv-6e-a.pdf" }));
  });

  it("PDF prêt : le lien signé est obtenu à la demande ; rendu en cours : téléchargement impossible", async () => {
    setTestApi(routes(minutesDto(), { [`GET ${C}/minutes/${IDS.minutes}/pdf`]: () => json({ url: "https://files.example.test/pv.pdf?sig=abc", expiresAt: "2026-12-10T15:05:00.000Z", renderHash: "c".repeat(64) }) }));
    const first = renderWithProviders(<MinutesScreen councilId={IDS.council} />);
    fireEvent.click(await screen.findByRole("button", { name: "Préparer le téléchargement" }));
    const link = await screen.findByRole("link", { name: "Télécharger le PDF" });
    expect(link.getAttribute("href")).toBe("https://files.example.test/pv.pdf?sig=abc");
    expect(link.getAttribute("rel")).toContain("noopener");
    first.unmount();
    setTestApi(routes(minutesDto({ renderStatus: "PENDING", renderHash: null })));
    renderWithProviders(<MinutesScreen councilId={IDS.council} />);
    expect(await screen.findByText("Le rendu du PDF est en cours.")).toBeTruthy();
    expect((screen.getByRole("button", { name: "Préparer le téléchargement" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("409 councils.minutes_not_rendered : message de l'API affiché", async () => {
    setTestApi(routes(minutesDto(), { [`GET ${C}/minutes/${IDS.minutes}/pdf`]: () => json({ status: 409, code: "councils.minutes_not_rendered", kind: "CONFLICT", message: "Le rendu du procès-verbal n'est pas terminé." }, { status: 409 }) }));
    renderWithProviders(<MinutesScreen councilId={IDS.council} />);
    fireEvent.click(await screen.findByRole("button", { name: "Préparer le téléchargement" }));
    expect(await screen.findByText("Le rendu du procès-verbal n'est pas terminé.")).toBeTruthy();
  });

  it("déverrouillage motivé : demande (20 caractères), approbation, puis réouverture", async () => {
    const api = setTestApi(
      routes(minutesDto({ status: "SIGNED", signedAt: "2026-12-11T10:00:00.000Z", missingSigners: [] }), {
        [`GET ${COUNCIL}/unlock-requests`]: { items: [unlockDto()] },
        [`POST ${COUNCIL}/unlock-requests`]: () => json(unlockDto({ id: uuid(7002) }), { status: 201 }),
        [`POST ${C}/unlock-requests/${IDS.unlock}/approve`]: () => json(unlockDto({ status: "APPROVED", decidedByName: "M. CENSEUR" })),
      }),
    );
    renderWithProviders(<MinutesScreen councilId={IDS.council} />);
    fireEvent.click(await screen.findByRole("button", { name: "Demander le déverrouillage" }));
    let dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText(/Motif du déverrouillage/), { target: { value: "trop court" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Envoyer la demande" }));
    expect(await within(dialog).findByText(/20 caractères/)).toBeTruthy();
    expect(api.calls.filter((c) => c.method === "POST")).toHaveLength(0);
    fireEvent.change(within(dialog).getByLabelText(/Motif du déverrouillage/), { target: { value: "Erreur de saisie constatée après signature" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Envoyer la demande" }));
    await waitFor(() => expect(api.calls.find((c) => c.method === "POST" && c.path === `${COUNCIL}/unlock-requests`)?.body).toEqual({ reason: "Erreur de saisie constatée après signature" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    fireEvent.click(await screen.findByRole("button", { name: "Approuver" }));
    dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Approuver" }));
    await waitFor(() => expect(reasonOf(api, "/approve")?.body).toEqual({}));
  });

  it("génération d'une nouvelle version", async () => {
    const api = setTestApi(routes(minutesDto(), { [`POST ${COUNCIL}/minutes`]: () => json(minutesDto({ id: uuid(6002), version: 2 }), { status: 201 }) }));
    renderWithProviders(<MinutesScreen councilId={IDS.council} />);
    fireEvent.click(await screen.findByRole("button", { name: "Générer le procès-verbal" }));
    expect(await screen.findByText("Procès-verbal généré (version 2).")).toBeTruthy();
    expect(api.calls.some((c) => c.method === "POST" && c.path === `${COUNCIL}/minutes`)).toBe(true);
  });
});

describe("HistoryScreen : historique", () => {
  it("journal de séance et demandes de déverrouillage", async () => {
    setTestApi({
      ...accessRoutes(["council.read"]),
      [`GET ${COUNCIL}`]: detailDto({ council: { status: "OPEN", reopenCount: 1 } }),
      [`GET ${COUNCIL}/events`]: { items: [{ id: uuid(9101), councilId: IDS.council, kind: "councils.council.opened", actorId: uuid(9), actorKind: "USER", reason: null, occurredAt: "2026-12-10T14:05:00.000Z", data: {} }, { id: uuid(9102), councilId: IDS.council, kind: "councils.council.reopened", actorId: uuid(9), actorKind: "USER", reason: "Correction", occurredAt: "2026-12-12T08:00:00.000Z", data: {} }] },
      [`GET ${COUNCIL}/unlock-requests`]: { items: [unlockDto({ status: "CONSUMED" })] },
    });
    renderWithProviders(<HistoryScreen councilId={IDS.council} />);
    const journal = await screen.findByRole("region", { name: "Tableau : Journal de séance" });
    expect(await within(journal).findByText("Séance ouverte")).toBeTruthy();
    expect(within(journal).getByText("Séance rouverte")).toBeTruthy();
    expect(screen.getByText("Réouvertures : 1")).toBeTruthy();
    expect(screen.getByText("Utilisé")).toBeTruthy();
  });
});

describe("EffectsScreen : file des effets", () => {
  const routes = (items: unknown[], extra: Record<string, unknown> = {}) => ({
    ...accessRoutes(["council.effect.manage", "council.exclusion.apply"]),
    [`GET ${C}/effects`]: effectsDto(items),
    ...extra,
  });

  it("l'application d'une exclusion exige une confirmation explicite avant tout envoi", async () => {
    const api = setTestApi(routes([effectDto()], { [`POST ${C}/effects/${IDS.effect}/apply`]: () => json(effectDto({ status: "APPLIED" })) }));
    renderWithProviders(<EffectsScreen />);
    fireEvent.click(await screen.findByRole("button", { name: "Appliquer" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("KOUASSI Awa")).toBeTruthy();
    fireEvent.click(within(dialog).getByRole("button", { name: "Appliquer l'effet" }));
    expect(await within(dialog).findByText("Cochez la case pour confirmer l'application.")).toBeTruthy();
    expect(api.calls.filter((c) => c.method === "POST")).toHaveLength(0);
    fireEvent.click(within(dialog).getByLabelText(/Je confirme appliquer cet effet à cet élève/));
    fireEvent.click(within(dialog).getByRole("button", { name: "Appliquer l'effet" }));
    await waitFor(() => expect(reasonOf(api, "/apply")?.body).toEqual({}));
    expect(await screen.findByText("Effet appliqué.")).toBeTruthy();
  });

  it("sans la permission d'appliquer une exclusion : aucun bouton « Appliquer »", async () => {
    setTestApi({ ...routes([effectDto()]), ...accessRoutes(["council.effect.manage"]) });
    renderWithProviders(<EffectsScreen />);
    await screen.findByText("KOUASSI Awa");
    expect(screen.queryByRole("button", { name: "Appliquer" })).toBeNull();
  });

  it("effet en échec : relance ; effet appliqué : annulation motivée ; irréversible : aucune annulation", async () => {
    const failed = effectDto({ id: IDS.effect, kind: "RESULTS_DECISION", status: "FAILED", attempts: 3, lastError: "results.locked : période verrouillée" });
    const applied = effectDto({ id: IDS.effect2, kind: "NOTIFY_GUARDIANS", status: "APPLIED", irreversible: false, appliedAt: "2026-12-10T15:00:00.000Z" });
    const done = effectDto({ id: uuid(8003), kind: "ENROLLMENT_OUTCOME", status: "APPLIED", irreversible: true, appliedAt: "2026-12-10T15:00:00.000Z" });
    const api = setTestApi(
      routes([failed, applied, done], {
        [`POST ${C}/effects/${IDS.effect}/retry`]: () => json(effectDto({ status: "PENDING" })),
        [`POST ${C}/effects/${IDS.effect2}/revert`]: () => json(effectDto({ status: "REVERTED" })),
      }),
    );
    renderWithProviders(<EffectsScreen />);
    expect(await screen.findByText("results.locked : période verrouillée")).toBeTruthy();
    expect(screen.getByText("Irréversible")).toBeTruthy();
    expect(await screen.findAllByRole("button", { name: "Annuler l'effet" })).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "Relancer" }));
    await waitFor(() => expect(reasonOf(api, "/retry")?.body).toEqual({}));
    fireEvent.click(screen.getByRole("button", { name: "Annuler l'effet" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText(/Motif de l'annulation/), { target: { value: "Application erronée" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Annuler l'effet" }));
    await waitFor(() => expect(reasonOf(api, "/revert")?.body).toEqual({ reason: "Application erronée" }));
  });

  it("filtre par statut envoyé à l'API", async () => {
    const api = setTestApi(routes([effectDto()]));
    renderWithProviders(<EffectsScreen />);
    await screen.findByText("KOUASSI Awa");
    fireEvent.change(screen.getByLabelText("Statut"), { target: { value: "FAILED" } });
    await waitFor(() => expect(api.calls.some((c) => c.path === `${C}/effects` && c.query.status === "FAILED")).toBe(true));
  });
});

describe("PortalScreen : famille et élève", () => {
  const FORBIDDEN = /suggestion|vote|voix|justification/i;

  it("famille : décisions de l'enfant, jamais de suggestion, de vote ni de justification", async () => {
    setTestApi({
      ...accessRoutes(["council.child.read"]),
      "GET /api/v1/schoollife/me/children": { items: [{ studentId: IDS.student, studentName: "KOUASSI Awa" }] },
      [`GET ${C}/children/${IDS.student}/decisions`]: familyDto(),
    });
    renderWithProviders(<PortalScreen mode="guardian" />);
    expect(await screen.findByText("Décision A (test)")).toBeTruthy();
    expect(screen.getByText("Bon travail")).toBeTruthy();
    expect(screen.getByText("DISTINCTION_TEST")).toBeTruthy();
    expect(screen.getByText("Cible (test)")).toBeTruthy();
    expect(document.body.textContent ?? "").not.toMatch(FORBIDDEN);
  });

  it("élève : ses décisions ; aucune décision visible : état vide", async () => {
    setTestApi({ ...accessRoutes(["council.self.read"]), [`GET ${C}/me/decisions`]: familyDto() });
    const first = renderWithProviders(<PortalScreen mode="student" />);
    expect(await screen.findByText("Décision A (test)")).toBeTruthy();
    expect(document.body.textContent ?? "").not.toMatch(FORBIDDEN);
    first.unmount();
    setTestApi({ ...accessRoutes(["council.self.read"]), [`GET ${C}/me/decisions`]: familyDto({ items: [] }) });
    renderWithProviders(<PortalScreen mode="student" />);
    expect(await screen.findByText("Aucune décision à afficher")).toBeTruthy();
  });

  it("enfant hors lien (404) : état « introuvable »", async () => {
    setTestApi({
      ...accessRoutes(["council.child.read"]),
      "GET /api/v1/schoollife/me/children": { items: [{ studentId: IDS.student, studentName: "KOUASSI Awa" }] },
      [`GET ${C}/children/${IDS.student}/decisions`]: () => json({ status: 404, code: "councils.not_found", kind: "NOT_FOUND", message: "Introuvable." }, { status: 404 }),
    });
    renderWithProviders(<PortalScreen mode="guardian" />);
    expect(await screen.findByText("Élément introuvable")).toBeTruthy();
  });
});

describe("SettingsScreen : paramètres", () => {
  it("liste les données d'établissement et enregistre un rôle modifié (PUT)", async () => {
    const api = setTestApi({
      ...accessRoutes(["council.settings.manage"]),
      [`GET ${C}/reference`]: referenceDto(),
      [`PUT ${C}/participant-roles`]: () => json({ ...referenceDto().roles[1], canDecide: true }),
    });
    renderWithProviders(<SettingsScreen />);
    expect(await screen.findByRole("region", { name: "Rôles des participants" })).toBeTruthy();
    expect(screen.getByRole("region", { name: "Types de conseil" })).toBeTruthy();
    expect(screen.getByRole("region", { name: "Types de décision" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Modifier Enseignant (test)" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByLabelText(/Peut décider/));
    fireEvent.click(within(dialog).getByRole("button", { name: "Enregistrer" }));
    await waitFor(() => expect(api.calls.find((c) => c.method === "PUT")?.body).toEqual({ code: "ENSEIGNANT", label: "Enseignant (test)", isVoting: true, countsForQuorum: true, maySign: true, canDecide: true, isExternal: false, sortOrder: 1, active: true }));
  });

  it("quorum vide = aucun contrôle : jamais de valeur réglementaire par défaut", async () => {
    const ref = referenceDto();
    setTestApi({ ...accessRoutes(["council.settings.manage"]), [`GET ${C}/reference`]: { ...ref, councilTypes: [{ ...ref.councilTypes[0]!, minParticipants: null }] } });
    renderWithProviders(<SettingsScreen />);
    expect(await screen.findByText("Aucun contrôle", { selector: "td" })).toBeTruthy();
  });
});

describe("OrientationScreen : orientation", () => {
  it("parcours, dossiers et transferts : sections et états vides", async () => {
    setTestApi({
      ...accessRoutes(["council.orientation.read", "council.orientation.manage"]),
      [`GET ${C}/orientation-paths`]: { items: [] },
      [`GET ${C}/orientation-files`]: { items: [], total: 0, page: 1, pageSize: 100 },
      [`GET ${C}/series-transfers`]: { items: [] },
      "GET /api/v1/academic/programs": { items: [] },
      "GET /api/v1/academic/reference/grade-levels": { items: [] },
    });
    renderWithProviders(<OrientationScreen />);
    expect(await screen.findByText("Aucun parcours défini")).toBeTruthy();
    expect(await screen.findByText("Aucun dossier")).toBeTruthy();
    expect(await screen.findByText("Aucun transfert")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Ajouter un parcours" })).toBeTruthy();
  });
});

describe("accessibilité de base", () => {
  it("le tableau de l'ordre du jour est un tableau étiqueté dans une région défilante focalisable", async () => {
    setTestApi({
      ...accessRoutes(["council.read"]),
      [`GET ${COUNCIL}`]: detailDto(),
      [`GET ${COUNCIL}/agenda`]: agendaDto([agendaItemDto({ missingResults: true })]),
      [`GET ${COUNCIL}/proposed-participants`]: { items: [] },
    });
    renderWithProviders(<CouncilFileScreen councilId={IDS.council} />);
    const region = await screen.findByRole("region", { name: "Tableau : Ordre du jour" });
    expect(region.getAttribute("tabindex")).toBe("0");
    expect(within(region).getByRole("table")).toBeTruthy();
    expect(within(region).getByText("Résultats manquants")).toBeTruthy();
  });
});
