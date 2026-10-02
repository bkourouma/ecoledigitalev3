// @vitest-environment jsdom
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { accessRoutes, setTestApi } from "@/platform/test/api-mock";
import { json, renderWithProviders } from "@/platform/test/render";
import { educationLevels, gradeLevels, institution, uuid, year } from "../../../_test/fixtures";
import { SettingsScreen } from "./SettingsScreen";
import { parsePattern, PEOPLE_TOKENS, REGISTRATION_TOKENS, hasProblem, hasToken } from "./numbering-utils";

vi.mock("@/platform/api/default-client", async () => (await import("@/platform/test/api-mock")).defaultClientModule);
vi.mock("next/link", () => ({ default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a> }));

const R = "/api/v1/academic/reference";
const MANAGE = accessRoutes(["academic.read", "academic.settings.manage", "people.settings.manage"]);
const READ = accessRoutes(["academic.read"]);

const periodTypes = [
  { id: uuid(950), code: "SEMESTER", label: "Semestre", kind: "TEACHING_PERIOD", active: true },
  { id: uuid(951), code: "EXAM", label: "Session d'examen", kind: "EXAM_SESSION", active: false },
];
const periodPlans = [
  {
    id: uuid(960),
    code: "TWO_SEMESTERS",
    label: "Deux semestres",
    slots: [
      { type: "SEMESTER", ordinal: 1, label: "Semestre 1" },
      { type: "SEMESTER", ordinal: 2, label: "Semestre 2" },
    ],
    active: true,
  },
];
const fundingTypes = [
  { id: uuid(970), code: "PRIVATE", label: "Famille", requiresReference: false, requiresFunder: false, sortOrder: 1, active: true },
  { id: uuid(971), code: "STATE_ASSIGNED", label: "Affecté par l'État", requiresReference: true, requiresFunder: false, sortOrder: 2, active: true },
];
const outcomes = [
  { id: uuid(980), code: "ADMIS", label: "Admis", kind: "ADVANCE", active: true },
  { id: uuid(981), code: "REDOUBLE", label: "Redoublant", kind: "REPEAT", active: true },
];
const settingsDto = {
  institutionId: institution.id,
  enrollmentConfirmationPolicy: "AUTO",
  courseConfirmationPolicy: "AUTO",
  pendingHoldMinutes: null,
  registrationNumberPrefix: "EDU",
  registrationNumberPattern: "{PREFIX}-{YEAR}-{STUDENT_SEQ:5}",
};
const peopleSettings = { studentNumberPattern: "{YYYY}-{SEQ:4}", staffNumberPattern: "{PREFIX}-{SEQ:4}", numberPrefix: "EDU", duplicateCheckEnabled: true, expiryAlertDays: 30, studentRetentionDays: null };

const base = {
  "GET /api/v1/tenancy/institutions": { items: [institution] },
  "GET /api/v1/academic/years": { items: [year({ isCurrent: true })] },
  [`GET ${R}/period-types`]: { items: periodTypes },
  [`GET ${R}/period-plans`]: { items: periodPlans },
  [`GET ${R}/education-levels`]: { items: educationLevels },
  [`GET ${R}/grade-levels`]: { items: gradeLevels },
  [`GET ${R}/funding-types`]: { items: fundingTypes },
  [`GET ${R}/enrollment-outcomes`]: { items: outcomes },
  [`GET /api/v1/academic/institutions/${institution.id}/settings`]: settingsDto,
  "GET /api/v1/people/settings": peopleSettings,
};

const put = (items: unknown[]) => () => json({ items, created: 1, updated: 0 });
const openTab = async (name: string) => fireEvent.click(await screen.findByRole("tab", { name }));

describe("numbering-utils", () => {
  it("découpe un motif en texte fixe et jetons, repère les jetons inconnus et l'accolade isolée", () => {
    const parts = parsePattern("{PREFIX}-{YEAR}-{STUDENT_SEQ:5}", REGISTRATION_TOKENS);
    expect(parts.map((p) => (p.kind === "token" ? p.name : p.text))).toEqual(["PREFIX", "-", "YEAR", "-", "STUDENT_SEQ"]);
    expect(parts.find((p) => p.kind === "token" && p.name === "STUDENT_SEQ")).toMatchObject({ digits: 5, known: true });
    expect(hasProblem(parts)).toBe(false);
    expect(hasToken(parts, "STUDENT_SEQ")).toBe(true);
    expect(hasProblem(parsePattern("{FOO}-{SEQ:4}", PEOPLE_TOKENS))).toBe(true);
    expect(hasProblem(parsePattern("{SEQ:4}-{", PEOPLE_TOKENS))).toBe(true);
    expect(hasToken(parsePattern("{YYYY}", PEOPLE_TOKENS), "SEQ")).toBe(false);
    // `{SEQ:0}` n'est pas un jeton valide (1 à 9 chiffres).
    expect(hasProblem(parsePattern("{SEQ:0}", PEOPLE_TOKENS))).toBe(true);
  });
});

describe("SettingsScreen — accès et navigation", () => {
  it("sans la permission de lecture : accès refusé", async () => {
    setTestApi({ ...accessRoutes([]), ...base });
    renderWithProviders(<SettingsScreen />);
    expect(await screen.findByText("Vous n'avez pas les droits nécessaires pour cette action.")).toBeTruthy();
    expect(screen.queryByRole("tablist")).toBeNull();
  });

  it("lecture seule : aucune action d'écriture n'est proposée et le motif est annoncé", async () => {
    setTestApi({ ...READ, ...base });
    renderWithProviders(<SettingsScreen />);
    expect(await screen.findByText("Lecture seule : vous pouvez consulter ces paramètres mais pas les modifier.")).toBeTruthy();
    await screen.findByText("Semestre");
    expect(screen.queryByRole("button", { name: "Ajouter un type" })).toBeNull();
    expect(screen.queryByRole("button", { name: /Modifier — Semestre/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /Désactiver/ })).toBeNull();
  });

  it("jamais de bouton supprimer pour un référentiel (on désactive)", async () => {
    setTestApi({ ...MANAGE, ...base });
    renderWithProviders(<SettingsScreen />);
    await screen.findByRole("button", { name: "Ajouter un type" });
    for (const tab of ["Périodes", "Niveaux", "Statuts et financements"]) {
      await openTab(tab);
      await waitFor(() => expect(screen.getAllByRole("button", { name: /Modifier — / }).length).toBeGreaterThan(0));
      expect(screen.queryByRole("button", { name: /Supprimer/ })).toBeNull();
    }
  });

  it("onglets : sélection par la souris et au clavier (flèches), onglet initial", async () => {
    setTestApi({ ...MANAGE, ...base });
    renderWithProviders(<SettingsScreen initialTab="funding" />);
    const funding = await screen.findByRole("tab", { name: "Statuts et financements" });
    expect(funding.getAttribute("aria-selected")).toBe("true");
    expect(await screen.findByText("Types de financement")).toBeTruthy();
    fireEvent.keyDown(funding, { key: "ArrowRight" });
    expect(screen.getByRole("tab", { name: "Inscriptions" }).getAttribute("aria-selected")).toBe("true");
    expect(document.activeElement).toBe(screen.getByRole("tab", { name: "Inscriptions" }));
    fireEvent.keyDown(screen.getByRole("tab", { name: "Inscriptions" }), { key: "Home" });
    expect(screen.getByRole("tab", { name: "Périodes" }).getAttribute("aria-selected")).toBe("true");
    expect(screen.getByRole("tabpanel").getAttribute("aria-labelledby")).toBe("settings-tab-periods");
  });
});

describe("Périodes", () => {
  it("liste les types et les plans ; désactiver envoie le type complet avec active=false", async () => {
    const api = setTestApi({ ...MANAGE, ...base, [`PUT ${R}/period-types`]: put(periodTypes) });
    renderWithProviders(<SettingsScreen />);
    const types = await screen.findByRole("list", { name: "Types de périodes" });
    expect(within(types).getAllByText("Session d'examen")).toHaveLength(2); // libellé et nature
    expect(within(types).getAllByText("Inactif")).toHaveLength(1);
    const plans = screen.getByRole("list", { name: "Plans de périodes" });
    expect(within(plans).getByText(/2 périodes/)).toBeTruthy();
    expect(within(plans).getByText(/Semestre 1 · Semestre 2/)).toBeTruthy();
    fireEvent.click(within(types).getByRole("button", { name: "Désactiver — Semestre" }));
    await screen.findByText("Le type « Semestre » est désactivé.");
    const call = api.calls.find((c) => c.method === "PUT")!;
    expect(call.path).toBe(`${R}/period-types`);
    expect(call.body).toEqual({ items: [{ code: "SEMESTER", label: "Semestre", kind: "TEACHING_PERIOD", active: false }] });
  });

  it("ajout d'un type : validation du contrat sans appel, puis corps exact ; erreur de champ du serveur affichée", async () => {
    let first = true;
    const api = setTestApi({
      ...MANAGE,
      ...base,
      [`PUT ${R}/period-types`]: () => {
        if (first) {
          first = false;
          return json({ code: "academic.reference_conflict", message: "Ce code existe déjà avec une autre nature.", details: { issues: [{ path: ["items", 0, "code"], message: "Ce code est déjà utilisé par un type d'une autre nature." }] } }, { status: 409 });
        }
        return json({ items: periodTypes });
      },
    });
    renderWithProviders(<SettingsScreen />);
    fireEvent.click(await screen.findByRole("button", { name: "Ajouter un type" }));
    const dialog = await screen.findByRole("dialog", { name: "Ajouter un type de période" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Enregistrer" }));
    await waitFor(() => expect(within(dialog).getAllByRole("alert").length).toBeGreaterThan(0));
    expect(api.calls.filter((c) => c.method === "PUT")).toHaveLength(0);

    fireEvent.change(within(dialog).getByLabelText(/^Code/), { target: { value: "trimestre" } });
    fireEvent.change(within(dialog).getByLabelText(/^Libellé/), { target: { value: "Trimestre" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Enregistrer" }));
    expect(await within(dialog).findByText("Ce code est déjà utilisé par un type d'une autre nature.")).toBeTruthy();
    expect(within(dialog).getByText("Ce code existe déjà avec une autre nature.")).toBeTruthy();
    fireEvent.change(within(dialog).getByLabelText(/^Code/), { target: { value: "trim" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Enregistrer" }));
    await screen.findByText("Le type « Trimestre » est enregistré.");
    const puts = api.calls.filter((c) => c.method === "PUT");
    expect(puts[0]!.body).toEqual({ items: [{ code: "TRIMESTRE", label: "Trimestre", kind: "TEACHING_PERIOD", active: true }] });
    expect(puts[1]!.body).toEqual({ items: [{ code: "TRIM", label: "Trimestre", kind: "TEACHING_PERIOD", active: true }] });
  });

  it("ajout d'un plan : lignes de périodes (type, ordre, libellé, poids) envoyées telles quelles", async () => {
    const api = setTestApi({ ...MANAGE, ...base, [`PUT ${R}/period-plans`]: put(periodPlans) });
    renderWithProviders(<SettingsScreen />);
    fireEvent.click(await screen.findByRole("button", { name: "Ajouter un plan" }));
    const dialog = await screen.findByRole("dialog", { name: "Ajouter un plan de périodes" });
    fireEvent.change(within(dialog).getByLabelText(/^Code/), { target: { value: "TRIMESTERS" } });
    const labels = () => within(dialog).getAllByLabelText(/^Libellé/);
    fireEvent.change(labels()[0]!, { target: { value: "Trois trimestres" } });
    const type0 = within(dialog).getByLabelText(/Type de période/) as HTMLSelectElement;
    await waitFor(() => expect(type0.options.length).toBeGreaterThan(1));
    fireEvent.change(type0, { target: { value: "SEMESTER" } });
    fireEvent.change(labels()[1]!, { target: { value: "Trimestre 1" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Ajouter une période" }));
    fireEvent.change(labels()[2]!, { target: { value: "Trimestre 2" } });
    fireEvent.change(within(dialog).getAllByLabelText(/Poids/)[1]!, { target: { value: "2" } });
    fireEvent.change(within(dialog).getAllByLabelText(/Type de période/)[1]!, { target: { value: "SEMESTER" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Enregistrer" }));
    await screen.findByText("Le plan « Trois trimestres » est enregistré.");
    expect(api.calls.find((c) => c.method === "PUT")!.body).toEqual({
      items: [
        {
          code: "TRIMESTERS",
          label: "Trois trimestres",
          slots: [
            { type: "SEMESTER", ordinal: 1, label: "Trimestre 1" },
            { type: "SEMESTER", ordinal: 2, label: "Trimestre 2", weight: 2 },
          ],
          active: true,
        },
      ],
    });
  });
});

describe("Niveaux", () => {
  const withNext = [
    { ...gradeLevels[0]!, nextGradeLevelId: uuid(601) },
    { ...gradeLevels[1]!, isFinal: true, terminalExamRequired: true },
  ];

  it("affiche le niveau suivant, le niveau final et l'examen terminal ; l'activation renvoie les codes (cycle, niveau suivant)", async () => {
    const api = setTestApi({ ...MANAGE, ...base, [`GET ${R}/grade-levels`]: { items: withNext }, [`PUT ${R}/grade-levels`]: put(withNext) });
    renderWithProviders(<SettingsScreen initialTab="levels" />);
    const grades = await screen.findByRole("list", { name: "Enseignement supérieur" });
    expect(within(grades).getByText("Niveau suivant : Licence 2")).toBeTruthy();
    expect(within(grades).getByText("Niveau final")).toBeTruthy();
    expect(within(grades).getByText("Examen terminal")).toBeTruthy();
    fireEvent.click(within(grades).getByRole("button", { name: "Désactiver — Licence 1" }));
    await screen.findByText("Le niveau « Licence 1 » est désactivé.");
    expect(api.calls.find((c) => c.method === "PUT")!.body).toEqual({
      items: [{ code: "L1", label: "Licence 1", shortLabel: "L1", educationLevelCode: "HIGHER", ordinal: 1, nextGradeLevelCode: "L2", isFinal: false, terminalExamRequired: false, active: false }],
    });
  });

  it("modification d'un niveau : niveau final => aucun niveau suivant envoyé", async () => {
    const api = setTestApi({ ...MANAGE, ...base, [`GET ${R}/grade-levels`]: { items: withNext }, [`PUT ${R}/grade-levels`]: put(withNext) });
    renderWithProviders(<SettingsScreen initialTab="levels" />);
    fireEvent.click(await screen.findByRole("button", { name: "Modifier — Licence 1" }));
    const dialog = await screen.findByRole("dialog", { name: "Modifier le niveau « Licence 1 »" });
    expect((within(dialog).getByLabelText(/^Code/) as HTMLInputElement).disabled).toBe(true);
    fireEvent.click(within(dialog).getByRole("checkbox", { name: /Niveau final du cycle/ }));
    fireEvent.click(within(dialog).getByRole("checkbox", { name: /examen terminal/ }));
    fireEvent.click(within(dialog).getByRole("button", { name: "Enregistrer" }));
    await screen.findByText("Le niveau « Licence 1 » est enregistré.");
    expect(api.calls.find((c) => c.method === "PUT")!.body).toEqual({
      items: [{ code: "L1", label: "Licence 1", shortLabel: "L1", educationLevelCode: "HIGHER", ordinal: 1, nextGradeLevelCode: null, isFinal: true, terminalExamRequired: true, active: true }],
    });
  });

  it("ajout d'un cycle : contrat de calcul vérifié par le contrat Zod, corps exact", async () => {
    const api = setTestApi({ ...MANAGE, ...base, [`PUT ${R}/education-levels`]: put(educationLevels) });
    renderWithProviders(<SettingsScreen initialTab="levels" />);
    fireEvent.click(await screen.findByRole("button", { name: "Ajouter un cycle" }));
    const dialog = await screen.findByRole("dialog", { name: "Ajouter un cycle d'enseignement" });
    fireEvent.change(within(dialog).getByLabelText(/^Code/), { target: { value: "college" } });
    fireEvent.change(within(dialog).getByLabelText(/^Libellé/), { target: { value: "Collège" } });
    fireEvent.change(within(dialog).getByLabelText(/Contrat de calcul/), { target: { value: "n'importe quoi" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Enregistrer" }));
    await waitFor(() => expect(within(dialog).getAllByRole("alert").length).toBeGreaterThan(0));
    expect(api.calls.filter((c) => c.method === "PUT")).toHaveLength(0);
    fireEvent.change(within(dialog).getByLabelText(/Contrat de calcul/), { target: { value: "coef-semester@1" } });
    fireEvent.change(within(dialog).getByLabelText(/Famille d'enseignement/), { target: { value: "SECONDARY" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Enregistrer" }));
    await screen.findByText("Le cycle « Collège » est enregistré.");
    expect(api.calls.find((c) => c.method === "PUT")!.body).toEqual({ items: [{ code: "COLLEGE", label: "Collège", ordinal: 0, pack: "SECONDARY", calculationContract: "coef-semester@1", active: true }] });
  });
});

describe("Statuts et financements", () => {
  it("types de financement : modification (référence exigée) puis issues de fin d'année par nature ; états du serveur en lecture seule", async () => {
    const api = setTestApi({ ...MANAGE, ...base, [`PUT ${R}/funding-types`]: put(fundingTypes), [`PUT ${R}/enrollment-outcomes`]: put(outcomes) });
    renderWithProviders(<SettingsScreen initialTab="funding" />);
    const types = await screen.findByRole("list", { name: "Types de financement" });
    expect(within(types).getByText("Référence exigée")).toBeTruthy();
    fireEvent.click(within(types).getByRole("button", { name: "Modifier — Famille" }));
    const dialog = await screen.findByRole("dialog", { name: "Modifier le financement « Famille »" });
    fireEvent.click(within(dialog).getByRole("checkbox", { name: /référence de dossier est exigée/ }));
    fireEvent.click(within(dialog).getByRole("checkbox", { name: /financeur est exigé/ }));
    fireEvent.click(within(dialog).getByRole("button", { name: "Enregistrer" }));
    await screen.findByText("Le financement « Famille » est enregistré.");
    expect(api.calls.find((c) => c.path.endsWith("/funding-types") && c.method === "PUT")!.body).toEqual({
      items: [{ code: "PRIVATE", label: "Famille", requiresReference: true, requiresFunder: true, sortOrder: 1, active: true }],
    });

    const outcomeList = screen.getByRole("list", { name: "Issues de fin d'année" });
    expect(within(outcomeList).getByText("Passage")).toBeTruthy();
    expect(within(outcomeList).getByText("Redoublement")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Ajouter une issue" }));
    const od = await screen.findByRole("dialog", { name: "Ajouter une issue de fin d'année" });
    fireEvent.change(within(od).getByLabelText(/^Code/), { target: { value: "reoriente" } });
    fireEvent.change(within(od).getByLabelText(/^Libellé/), { target: { value: "Réorienté" } });
    fireEvent.change(within(od).getByLabelText(/^Nature/), { target: { value: "REDIRECT" } });
    fireEvent.click(within(od).getByRole("button", { name: "Enregistrer" }));
    await screen.findByText("L'issue « Réorienté » est enregistrée.");
    expect(api.calls.find((c) => c.path.endsWith("/enrollment-outcomes") && c.method === "PUT")!.body).toEqual({ items: [{ code: "REORIENTE", label: "Réorienté", kind: "REDIRECT", active: true }] });

    // États gérés par le serveur : affichés, aucun bouton.
    const enrollmentStates = screen.getByRole("list", { name: "États d'une inscription" });
    expect(within(enrollmentStates).getByText("Transférée")).toBeTruthy();
    expect(within(enrollmentStates).queryByRole("button")).toBeNull();
    expect(within(screen.getByRole("list", { name: "États d'un élève" })).getByText("Diplômé")).toBeTruthy();
  });
});

describe("Inscriptions", () => {
  it("explique chaque politique ; n'envoie que ce qui change (politique, durée de réservation en nombre)", async () => {
    const api = setTestApi({ ...MANAGE, ...base, [`PUT /api/v1/academic/institutions/${institution.id}/settings`]: () => json({ ...settingsDto, enrollmentConfirmationPolicy: "ON_FULL_PAYMENT", pendingHoldMinutes: 1440 }) });
    renderWithProviders(<SettingsScreen initialTab="enrollments" />);
    const full = await screen.findByRole("radio", { name: /Après paiement intégral/ });
    expect(screen.getByText("L'inscription reste en attente jusqu'au paiement de la totalité des frais.")).toBeTruthy();
    expect(screen.getByText("Le cours reste en attente jusqu'au paiement de sa ligne de facture.")).toBeTruthy();
    expect((screen.getAllByRole("radio", { name: /Automatique/ })[0] as HTMLInputElement).checked).toBe(true);
    // Rien de modifié : message, aucun appel.
    fireEvent.click(screen.getByRole("button", { name: "Enregistrer" }));
    expect(await screen.findByText("Aucune modification à enregistrer.")).toBeTruthy();
    expect(api.calls.filter((c) => c.method === "PUT")).toHaveLength(0);
    fireEvent.click(full);
    fireEvent.change(screen.getByLabelText("Durée de réservation (minutes)"), { target: { value: "1440" } });
    fireEvent.click(screen.getByRole("button", { name: "Enregistrer" }));
    await screen.findByText("Les politiques d'inscription sont enregistrées.");
    expect(api.calls.find((c) => c.method === "PUT")!.body).toEqual({ enrollmentConfirmationPolicy: "ON_FULL_PAYMENT", pendingHoldMinutes: 1440 });
  });

  it("durée invalide : refusée par le contrat sans appel ; sans droit d'écriture le formulaire est en lecture seule", async () => {
    const api = setTestApi({ ...MANAGE, ...base });
    const { unmount } = renderWithProviders(<SettingsScreen initialTab="enrollments" />);
    fireEvent.change(await screen.findByLabelText("Durée de réservation (minutes)"), { target: { value: "0" } });
    fireEvent.click(screen.getByRole("button", { name: "Enregistrer" }));
    await waitFor(() => expect(screen.getAllByRole("alert").length).toBeGreaterThan(0));
    expect(api.calls.filter((c) => c.method === "PUT")).toHaveLength(0);
    unmount();

    setTestApi({ ...READ, ...base });
    renderWithProviders(<SettingsScreen initialTab="enrollments" />);
    const input = (await screen.findByLabelText("Durée de réservation (minutes)")) as HTMLInputElement;
    expect(input.disabled).toBe(true);
    expect(screen.queryByRole("button", { name: "Enregistrer" })).toBeNull();
  });

  it("l'API refuse la politique : le message du serveur est affiché", async () => {
    setTestApi({
      ...MANAGE,
      ...base,
      [`PUT /api/v1/academic/institutions/${institution.id}/settings`]: () => json({ code: "academic.invalid_policy", message: "Cette politique exige la fonction Finance de votre offre." }, { status: 422 }),
    });
    renderWithProviders(<SettingsScreen initialTab="enrollments" />);
    fireEvent.click(await screen.findByRole("radio", { name: /Après paiement des frais d'inscription/ }));
    fireEvent.click(screen.getByRole("button", { name: "Enregistrer" }));
    expect(await screen.findByText("Cette politique exige la fonction Finance de votre offre.")).toBeTruthy();
  });
});

describe("Numérotation", () => {
  it("aperçu de FORME du motif (jetons reconnus, inconnus signalés) ; envoi du préfixe et du motif modifiés", async () => {
    const api = setTestApi({ ...MANAGE, ...base, [`PUT /api/v1/academic/institutions/${institution.id}/settings`]: () => json({ ...settingsDto, registrationNumberPrefix: "ECO" }) });
    renderWithProviders(<SettingsScreen initialTab="numbering" />);
    const pattern = (await screen.findByLabelText("Motif du numéro d'inscription")) as HTMLInputElement;
    await waitFor(() => expect(pattern.value).toBe("{PREFIX}-{YEAR}-{STUDENT_SEQ:5}"));
    expect(screen.getAllByText("numéro d'ordre sur 5 chiffres").length).toBeGreaterThan(0);
    // Accolades littérales de l'aide (échappées en ICU) correctement affichées.
    expect(screen.getByText(/Jetons possibles : {PREFIX}, {PROGRAM}, {LEVEL}, {YEAR} et {STUDENT_SEQ:n}/)).toBeTruthy();
    expect(screen.getAllByText("Cet aperçu ne montre que la forme du motif. Les numéros réels sont attribués par le serveur.").length).toBeGreaterThan(0);
    fireEvent.change(pattern, { target: { value: "{PREFIX}-{FOO}" } });
    expect(await screen.findAllByText("Jeton inconnu")).toHaveLength(1);
    expect(screen.getAllByText(/le serveur le refusera/).length).toBeGreaterThan(0);
    fireEvent.change(pattern, { target: { value: "{PREFIX}-{YEAR}" } });
    expect(await screen.findByText(/Le jeton \{STUDENT_SEQ:n\} manque/)).toBeTruthy();
    fireEvent.change(pattern, { target: { value: "{PREFIX}/{STUDENT_SEQ:6}" } });
    fireEvent.change(screen.getByLabelText("Préfixe"), { target: { value: "eco" } });
    fireEvent.click(screen.getAllByRole("button", { name: "Enregistrer" })[0]!);
    await screen.findByText("La numérotation des inscriptions est enregistrée.");
    expect(api.calls.find((c) => c.method === "PUT" && c.path.includes("/institutions/"))!.body).toEqual({ registrationNumberPattern: "{PREFIX}/{STUDENT_SEQ:6}", registrationNumberPrefix: "ECO" });
  });

  it("paramètres des personnes : motif refusé par le contrat sans appel, puis corps exact (conservation vidée => null)", async () => {
    const api = setTestApi({ ...MANAGE, ...base, "PUT /api/v1/people/settings": () => json({ ...peopleSettings, studentNumberPattern: "{YY}-{SEQ:5}", expiryAlertDays: null }) });
    renderWithProviders(<SettingsScreen initialTab="numbering" />);
    const student = (await screen.findByLabelText("Motif du matricule élève")) as HTMLInputElement;
    await waitFor(() => expect(student.value).toBe("{YYYY}-{SEQ:4}"));
    fireEvent.change(student, { target: { value: "{YY}-" } });
    fireEvent.click(screen.getAllByRole("button", { name: "Enregistrer" })[1]!);
    await waitFor(() => expect(screen.getAllByRole("alert").length).toBeGreaterThan(0));
    expect(api.calls.filter((c) => c.method === "PUT")).toHaveLength(0);
    fireEvent.change(student, { target: { value: "{YY}-{SEQ:5}" } });
    fireEvent.change(screen.getByLabelText(/Alerte avant expiration/), { target: { value: "" } });
    fireEvent.click(screen.getByRole("checkbox", { name: /Rechercher les doublons/ }));
    fireEvent.click(screen.getAllByRole("button", { name: "Enregistrer" })[1]!);
    await screen.findByText("Les paramètres des personnes sont enregistrés.");
    expect(api.calls.find((c) => c.method === "PUT" && c.path === "/api/v1/people/settings")!.body).toEqual({ studentNumberPattern: "{YY}-{SEQ:5}", duplicateCheckEnabled: false, expiryAlertDays: null });
  });

  it("sans la permission des paramètres des personnes : bloc explicatif, aucune requête vers /people/settings", async () => {
    const api = setTestApi({ ...accessRoutes(["academic.read", "academic.settings.manage"]), ...base });
    renderWithProviders(<SettingsScreen initialTab="numbering" />);
    expect(await screen.findByText(/relèvent d'une autre permission/)).toBeTruthy();
    expect(api.calls.some((c) => c.path === "/api/v1/people/settings")).toBe(false);
  });
});

describe("Calendrier", () => {
  const holidays = [
    { id: uuid(990), institutionId: institution.id, label: "Fête du travail", kind: "HOLIDAY", startsOn: "2027-05-01", endsOn: "2027-05-01", recursYearly: true, blocksTeaching: true },
    { id: uuid(991), institutionId: institution.id, label: "Vacances de Noël", kind: "BREAK", startsOn: "2026-12-20", endsOn: "2027-01-03", recursYearly: false, blocksTeaching: true },
  ];

  it("liste l'année courante (requête bornée à l'année), répétition et durée, rappel sur les fêtes mobiles", async () => {
    const api = setTestApi({ ...MANAGE, ...base, "GET /api/v1/academic/holidays": { items: holidays } });
    renderWithProviders(<SettingsScreen initialTab="calendar" />);
    const list = await screen.findByRole("list", { name: "Calendrier de l'année Année 2026-2027" });
    expect(within(list).getByText("Fête du travail")).toBeTruthy();
    expect(within(list).getByText("Se répète chaque année")).toBeTruthy();
    expect(within(list).getByText("Date ponctuelle")).toBeTruthy();
    expect(within(list).getByText(/20 déc\. 2026 → 3 janv\. 2027/)).toBeTruthy();
    expect(screen.getByText(/Les fêtes mobiles/)).toBeTruthy();
    const call = api.calls.find((c) => c.path === "/api/v1/academic/holidays")!;
    expect(call.query).toEqual({ institutionId: institution.id, from: "2026-09-01", to: "2027-08-31" });
  });

  it("ajout sur plusieurs jours : validation, puis corps exact", async () => {
    const api = setTestApi({
      ...MANAGE,
      ...base,
      "GET /api/v1/academic/holidays": { items: [] },
      "POST /api/v1/academic/holidays": () => json({ ...holidays[1]!, id: uuid(992), label: "Vacances de Pâques", startsOn: "2027-04-03", endsOn: "2027-04-18" }, { status: 201 }),
    });
    renderWithProviders(<SettingsScreen initialTab="calendar" />);
    expect(await screen.findByText("Aucune date pour cette année.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Ajouter une date" }));
    const dialog = await screen.findByRole("dialog", { name: "Ajouter une date à l'année Année 2026-2027" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Enregistrer" }));
    await waitFor(() => expect(within(dialog).getAllByRole("alert").length).toBeGreaterThan(0));
    expect(api.calls.filter((c) => c.method === "POST")).toHaveLength(0);
    fireEvent.change(within(dialog).getByLabelText(/^Libellé/), { target: { value: "Vacances de Pâques" } });
    fireEvent.change(within(dialog).getByLabelText(/^Nature/), { target: { value: "BREAK" } });
    fireEvent.change(within(dialog).getByLabelText(/Premier jour/), { target: { value: "2027-04-03" } });
    fireEvent.change(within(dialog).getByLabelText(/Dernier jour/), { target: { value: "2027-04-18" } });
    fireEvent.click(within(dialog).getByRole("checkbox", { name: /Se répète chaque année/ }));
    fireEvent.click(within(dialog).getByRole("button", { name: "Enregistrer" }));
    await screen.findByText("« Vacances de Pâques » est enregistré.");
    expect(api.calls.find((c) => c.method === "POST")!.body).toEqual({
      institutionId: institution.id,
      label: "Vacances de Pâques",
      kind: "BREAK",
      startsOn: "2027-04-03",
      endsOn: "2027-04-18",
      recursYearly: true,
      blocksTeaching: true,
    });
  });

  it("modification : seuls les champs changés partent (PATCH) ; effacer la fin ramène à un jour", async () => {
    const api = setTestApi({
      ...MANAGE,
      ...base,
      "GET /api/v1/academic/holidays": { items: holidays },
      [`PATCH /api/v1/academic/holidays/${uuid(991)}`]: () => json({ ...holidays[1]!, endsOn: "2026-12-20", recursYearly: true }),
    });
    renderWithProviders(<SettingsScreen initialTab="calendar" />);
    fireEvent.click(await screen.findByRole("button", { name: "Modifier — Vacances de Noël" }));
    const dialog = await screen.findByRole("dialog", { name: "Modifier « Vacances de Noël »" });
    fireEvent.change(within(dialog).getByLabelText(/Dernier jour/), { target: { value: "" } });
    fireEvent.click(within(dialog).getByRole("checkbox", { name: /Se répète chaque année/ }));
    fireEvent.click(within(dialog).getByRole("button", { name: "Enregistrer" }));
    await screen.findByText("« Vacances de Noël » est enregistré.");
    expect(api.calls.find((c) => c.method === "PATCH")!.body).toEqual({ endsOn: "2026-12-20", recursYearly: true });
  });

  it("suppression : confirmation explicite puis DELETE ; l'erreur du serveur est affichée", async () => {
    let fail = true;
    const api = setTestApi({
      ...MANAGE,
      ...base,
      "GET /api/v1/academic/holidays": { items: holidays },
      [`DELETE /api/v1/academic/holidays/${uuid(990)}`]: () => {
        if (fail) {
          fail = false;
          return json({ code: "academic.holiday_in_use", message: "Cette date est utilisée par un emploi du temps publié." }, { status: 409 });
        }
        return new Response(null, { status: 204 });
      },
    });
    renderWithProviders(<SettingsScreen initialTab="calendar" />);
    fireEvent.click(await screen.findByRole("button", { name: "Supprimer — Fête du travail" }));
    const dialog = await screen.findByRole("dialog", { name: "Supprimer « Fête du travail » ?" });
    expect(api.calls.filter((c) => c.method === "DELETE")).toHaveLength(0);
    fireEvent.click(within(dialog).getByRole("button", { name: "Supprimer cette date" }));
    expect(await within(dialog).findByText("Cette date est utilisée par un emploi du temps publié.")).toBeTruthy();
    fireEvent.click(within(dialog).getByRole("button", { name: "Supprimer cette date" }));
    await screen.findByText("« Fête du travail » est supprimé.");
    expect(api.calls.filter((c) => c.method === "DELETE")).toHaveLength(2);
  });

  it("lecture seule : ni ajout, ni modification, ni suppression", async () => {
    setTestApi({ ...READ, ...base, "GET /api/v1/academic/holidays": { items: holidays } });
    renderWithProviders(<SettingsScreen initialTab="calendar" />);
    await screen.findByText("Fête du travail");
    expect(screen.queryByRole("button", { name: "Ajouter une date" })).toBeNull();
    expect(screen.queryByRole("button", { name: /Supprimer —/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /Modifier —/ })).toBeNull();
  });
});
