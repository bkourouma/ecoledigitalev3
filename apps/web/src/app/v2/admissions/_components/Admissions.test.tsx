// @vitest-environment jsdom
import { configure, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  admissionsApplicationDetailDtoSchema,
  admissionsApplicationSummaryDtoSchema,
  admissionsBoardDtoSchema,
  admissionsCampaignDtoSchema,
  admissionsPublicFormDtoSchema,
  admissionsPublicTrackDtoSchema,
  admissionsSettingsDtoSchema,
  admissionsWorkflowViewDtoSchema,
} from "@ecoledigitale/contracts/v2/admissions";
import { accessRoutes, setTestApi } from "@/platform/test/api-mock";
import { json, renderWithProviders } from "@/platform/test/render";
import { allowed, acceptedStage, board, campaign, detail, document as doc, IDS, lookups, offer, publicForm, rejectedStage, reviewStage, settings, SLUG, stage, summary, track, transition, uuid, workflow } from "../_test/fixtures";
import { AdmissionsNav } from "./AdmissionsShell";
import { ApplicationDetailScreen } from "./ApplicationDetailScreen";
import { ApplicationsListScreen } from "./ApplicationsListScreen";
import { CampaignsScreen } from "./CampaignsScreen";
import { NewApplicationScreen } from "./NewApplicationScreen";
import { PipelineScreen } from "./PipelineScreen";
import { SettingsScreen } from "./SettingsScreen";
import { WaitlistScreen } from "./WaitlistScreen";
import { WorkflowScreen } from "./WorkflowScreen";

vi.setConfig({ testTimeout: 30_000 });
// Machine chargée (plusieurs agents, intégration en parallèle) : les chaînes de requêtes successives dépassent parfois 1 s.
configure({ asyncUtilTimeout: 5000 });

const nav = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn() }));
vi.mock("@/platform/api/default-client", async () => (await import("@/platform/test/api-mock")).defaultClientModule);
vi.mock("next/navigation", () => ({ usePathname: () => "/v2/admissions", useRouter: () => ({ push: nav.push, replace: vi.fn(), refresh: nav.refresh }), useSearchParams: () => new URLSearchParams("") }));
vi.mock("next/link", () => ({ default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a> }));

const A = "/api/v1/admissions";
const base = (perms: string[], extra: Record<string, unknown> = {}, features: string[] = []) => ({
  ...accessRoutes(perms, features),
  [`GET ${A}/campaigns`]: { items: [campaign()] },
  [`GET ${A}/lookups`]: lookups,
  [`GET ${A}/settings`]: settings(),
  [`GET ${A}/decision-reasons`]: { items: [{ id: uuid(90), code: "NO_SEAT", kind: "REJECT", label: "Plus de place", active: true }] },
  ...extra,
});

beforeEach(() => {
  nav.push.mockClear();
  nav.refresh.mockClear();
});
afterEach(() => vi.restoreAllMocks());

describe("fabriques de test conformes aux contrats courants", () => {
  it("les données simulées passent les schémas de réponse (aucune dérive silencieuse)", () => {
    expect(admissionsApplicationSummaryDtoSchema.safeParse(summary()).success).toBe(true);
    expect(admissionsApplicationDetailDtoSchema.safeParse(detail({ offers: [offer()], documents: [doc({ status: "SUBMITTED" })] })).success).toBe(true);
    expect(admissionsBoardDtoSchema.safeParse(board()).success).toBe(true);
    expect(admissionsCampaignDtoSchema.safeParse(campaign()).success).toBe(true);
    expect(admissionsWorkflowViewDtoSchema.safeParse(workflow()).success).toBe(true);
    expect(admissionsSettingsDtoSchema.safeParse(settings()).success).toBe(true);
    expect(admissionsPublicFormDtoSchema.safeParse(publicForm()).success).toBe(true);
    expect(admissionsPublicTrackDtoSchema.safeParse(track()).success).toBe(true);
  });
});

describe("AdmissionsNav : onglets selon les permissions", () => {
  it("le personnel de lecture voit pipeline et candidatures ; les rôles de gestion voient en plus les autres onglets", async () => {
    setTestApi(accessRoutes(["admission.read"]));
    const { unmount } = renderWithProviders(<AdmissionsNav />);
    expect(await screen.findByRole("link", { name: "Pipeline" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Candidatures" })).toBeTruthy();
    expect(screen.queryByRole("link", { name: "Workflow" })).toBeNull();
    expect(screen.queryByRole("link", { name: "Paramètres" })).toBeNull();
    expect(screen.queryByRole("link", { name: "Rapports" })).toBeNull();
    unmount();
    setTestApi(accessRoutes(["admission.read", "admission.workflow.manage", "admission.settings.manage", "admission.report.read", "admission.waitlist.manage", "admission.prospect.manage"]));
    renderWithProviders(<AdmissionsNav />);
    expect(await screen.findByRole("link", { name: "Workflow" })).toBeTruthy();
    for (const name of ["Paramètres", "Rapports", "Listes d'attente", "Prospects"]) expect(screen.getByRole("link", { name })).toBeTruthy();
  });
});

describe("PipelineScreen : kanban accessible au clavier", () => {
  it("une colonne par étape, cartes en liens, retard signalé en texte, bouton « Déplacer » nommé par candidat", async () => {
    setTestApi(base(["admission.read"], { [`GET ${A}/applications/board`]: board() }));
    renderWithProviders(<PipelineScreen />);
    const region = await screen.findByRole("region", { name: "Tableau des étapes de candidature" });
    for (const h of ["Déposée", "À l'étude", "Acceptée", "Refusée"]) expect(within(region).getByRole("heading", { name: h, level: 2 })).toBeTruthy();
    expect(within(region).getByRole("link", { name: "Awa KONÉ" }).getAttribute("href")).toBe(`/v2/admissions/applications/${IDS.app1}`);
    expect(within(region).getByText("Délai dépassé")).toBeTruthy();
    const button = within(region).getByRole("button", { name: "Déplacer le dossier de Awa KONÉ" });
    button.focus();
    expect(document.activeElement).toBe(button);
    expect(within(region).getAllByText("Aucun dossier")).toHaveLength(2);
  });

  it("sans campagne : invitation à en créer une (réservée à la gestion)", async () => {
    setTestApi(base(["admission.read", "admission.campaign.manage"], { [`GET ${A}/campaigns`]: { items: [] } }));
    renderWithProviders(<PipelineScreen />);
    expect(await screen.findByText("Aucune campagne d'admission")).toBeTruthy();
    expect(await screen.findByRole("link", { name: "Créer une campagne" })).toBeTruthy();
  });

  it("déplacement : seules les transitions déclarées sont proposées ; une destination à décision renvoie au dossier ; le déplacement direct appelle l'API", async () => {
    const api = setTestApi(base(["admission.read"], { [`GET ${A}/applications/board`]: board(), [`POST ${A}/applications/${IDS.app1}/transition`]: detail() }));
    renderWithProviders(<PipelineScreen />);
    fireEvent.click(await screen.findByRole("button", { name: "Déplacer le dossier de Awa KONÉ" }));
    const dialog = await screen.findByRole("dialog");
    // « Refusée » exige une décision : pas de déplacement direct, lien vers le dossier
    expect(within(dialog).getByText(/décision formelle/)).toBeTruthy();
    expect(within(dialog).getByRole("link", { name: "Ouvrir le dossier pour décider" }).getAttribute("href")).toBe(`/v2/admissions/applications/${IDS.app1}`);
    const confirm = within(dialog).getByRole("button", { name: "Déplacer le dossier" }) as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);
    fireEvent.click(within(dialog).getByRole("button", { name: /^À l'étude/ }));
    fireEvent.click(confirm);
    await waitFor(() => expect(api.calls.some((c) => c.method === "POST" && c.path === `${A}/applications/${IDS.app1}/transition`)).toBe(true));
    expect(api.calls.find((c) => c.method === "POST")!.body).toEqual({ toStageId: IDS.stageReview });
    expect(await screen.findByText("Dossier déplacé vers « À l'étude ».")).toBeTruthy();
  });

  it("une transition à motif obligatoire n'est pas envoyée sans motif", async () => {
    const withReason = board({
      columns: [
        { stage: stage(), total: 1, cards: [summary()] },
        { stage: rejectedStage({ requiresDecision: false, label: "Retirée" }), total: 0, cards: [] },
      ],
      transitions: [transition({ toStageId: IDS.stageRejected, requiresReason: true })],
    });
    const api = setTestApi(base(["admission.read"], { [`GET ${A}/applications/board`]: withReason, [`POST ${A}/applications/${IDS.app1}/transition`]: detail() }));
    renderWithProviders(<PipelineScreen />);
    fireEvent.click(await screen.findByRole("button", { name: "Déplacer le dossier de Awa KONÉ" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: /^Retirée/ }));
    fireEvent.click(within(dialog).getByRole("button", { name: "Déplacer le dossier" }));
    expect(await within(dialog).findByText("Un motif d'au moins 3 caractères est obligatoire.")).toBeTruthy();
    expect(api.calls.some((c) => c.method === "POST")).toBe(false);
    fireEvent.change(within(dialog).getByLabelText(/Motif du déplacement/), { target: { value: "Famille a retiré" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Déplacer le dossier" }));
    await waitFor(() => expect(api.calls.some((c) => c.method === "POST")).toBe(true));
    expect(api.calls.find((c) => c.method === "POST")!.body).toEqual({ toStageId: IDS.stageRejected, reason: "Famille a retiré" });
  });

  it("l'API refuse (permission de la transition) : le message est affiché et la fenêtre reste ouverte", async () => {
    setTestApi(base(["admission.read"], { [`GET ${A}/applications/board`]: board(), [`POST ${A}/applications/${IDS.app1}/transition`]: () => json({ code: "FORBIDDEN", message: "Action non autorisée." }, { status: 403 }) }));
    renderWithProviders(<PipelineScreen />);
    fireEvent.click(await screen.findByRole("button", { name: "Déplacer le dossier de Awa KONÉ" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: /^À l'étude/ }));
    fireEvent.click(within(dialog).getByRole("button", { name: "Déplacer le dossier" }));
    expect((await within(dialog).findByRole("alert")).textContent).toMatch(/non autoris/i);
  });
});

describe("ApplicationsListScreen : liste filtrée côté API", () => {
  it("transmet statut, niveau, recherche temporisée et retard à l'API ; lien vers le dossier", async () => {
    const api = setTestApi(base(["admission.read", "admission.create"], { [`GET ${A}/applications`]: { items: [summary()], total: 1, page: 1, pageSize: 30 } }));
    renderWithProviders(<ApplicationsListScreen />);
    const table = await screen.findByRole("table", { name: "Liste des candidatures" });
    expect((await within(table).findByRole("link", { name: "2026-00001" })).getAttribute("href")).toBe(`/v2/admissions/applications/${IDS.app1}`);
    expect(await screen.findByRole("link", { name: "Nouvelle candidature" })).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Statut"), { target: { value: "UNDER_REVIEW" } });
    fireEvent.change(screen.getByLabelText("Niveau"), { target: { value: "CP1" } });
    fireEvent.change(screen.getByRole("searchbox", { name: "Recherche" }), { target: { value: "koné" } });
    fireEvent.click(screen.getByLabelText("Délai dépassé seulement"));
    await waitFor(() => {
      const last = api.calls.filter((c) => c.path === `${A}/applications`).at(-1)!;
      expect(last.query).toMatchObject({ status: "UNDER_REVIEW", grade: "CP1", q: "koné", overdue: "true", campaignId: IDS.campaign });
    });
  });
});

describe("NewApplicationScreen : saisie par le secrétariat", () => {
  it("la forme est validée par le contrat avant tout envoi ; puis création et ouverture du dossier", async () => {
    const api = setTestApi(base(["admission.create"], { [`POST ${A}/applications`]: { id: IDS.app1, applicationNumber: "2026-00001", duplicates: 0 } }));
    renderWithProviders(<NewApplicationScreen />);
    await screen.findByLabelText(/^Niveau/);
    fireEvent.click(screen.getByRole("button", { name: "Créer la candidature" }));
    expect((await screen.findAllByRole("alert")).length).toBeGreaterThan(0);
    expect(api.calls.some((c) => c.method === "POST")).toBe(false);

    const [childFirst, guardianFirst] = screen.getAllByLabelText(/Prénoms/);
    const [childLast, guardianLast] = screen.getAllByLabelText(/^Nom/);
    fireEvent.change(childFirst!, { target: { value: "Awa" } });
    fireEvent.change(childLast!, { target: { value: "KONÉ" } });
    fireEvent.change(screen.getByLabelText(/Date de naissance/), { target: { value: "2020-03-14" } });
    fireEvent.change(screen.getByLabelText(/^Niveau/, { selector: "select" }), { target: { value: "CP1" } });
    fireEvent.change(screen.getByLabelText(/Lien de parenté/), { target: { value: "MOTHER" } });
    fireEvent.change(guardianFirst!, { target: { value: "Mariam" } });
    fireEvent.change(guardianLast!, { target: { value: "KONÉ" } });
    fireEvent.change(screen.getByLabelText(/Téléphone/), { target: { value: "+2250700000000" } });
    fireEvent.click(screen.getByRole("button", { name: "Créer la candidature" }));
    await waitFor(() => expect(nav.push).toHaveBeenCalledWith(`/v2/admissions/applications/${IDS.app1}`));
    const body = api.calls.find((c) => c.method === "POST")!.body as Record<string, unknown>;
    expect(body).toMatchObject({ campaignId: IDS.campaign, applicantFirstName: "Awa", desiredGradeLevelCode: "CP1", fundingTypeRequested: "PRIVATE", isRepeating: false });
    expect((body["guardians"] as Array<Record<string, unknown>>)[0]).toMatchObject({ relationshipCode: "MOTHER", firstName: "Mariam", isPrimary: true, canConsent: true });
  });
});

describe("ApplicationDetailScreen : dossier", () => {
  const route = (d = detail(), extra: Record<string, unknown> = {}) => ({ [`GET ${A}/applications/${IDS.app1}`]: d, ...extra });

  it("affiche les seules actions annoncées par l'API et les pièces manquantes ; les actions automatiques sont masquées", async () => {
    setTestApi(base(["admission.read", "admission.update"], route(detail({ allowedTransitions: [allowed(), allowed({ transitionId: uuid(99), toStageLabel: "Automatique", isAutomatic: true })] }))));
    renderWithProviders(<ApplicationDetailScreen applicationId={IDS.app1} />);
    expect(await screen.findByRole("heading", { name: "Awa KONÉ", level: 1 })).toBeTruthy();
    expect(await screen.findByRole("button", { name: "Passer à « À l'étude » (À l'étude)" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Automatique/ })).toBeNull();
    expect(screen.getByText("Pièces manquantes : Acte de naissance.")).toBeTruthy();
    expect(screen.getByText("Consentement manquant")).toBeTruthy();
  });

  it("sans le droit de décider : les décisions formelles (refus, admission) ne sont pas proposées", async () => {
    const reject = allowed({ transitionId: uuid(97), toStageId: IDS.stageRejected, toStageLabel: "Refusée", toStatus: "REJECTED", requiresDecision: true, decisionKind: "REJECT", permissionKey: "admission.decide" });
    setTestApi(base(["admission.read", "admission.update"], route(detail({ allowedTransitions: [allowed(), reject] }))));
    renderWithProviders(<ApplicationDetailScreen applicationId={IDS.app1} />);
    expect(await screen.findByRole("button", { name: "Passer à « À l'étude » (À l'étude)" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Refusée/ })).toBeNull();
  });

  it("refus : le motif codé est exigé par le contrat ; la décision part avec la version lue du dossier", async () => {
    const reject = allowed({ transitionId: uuid(98), toStageId: IDS.stageRejected, toStageLabel: "Refusée", toStatus: "REJECTED", requiresDecision: true, decisionKind: "REJECT", permissionKey: "admission.decide" });
    const api = setTestApi(base(["admission.read", "admission.decide"], route(detail({ allowedTransitions: [reject] }), { [`POST ${A}/applications/${IDS.app1}/decisions`]: detail() })));
    renderWithProviders(<ApplicationDetailScreen applicationId={IDS.app1} />);
    fireEvent.click(await screen.findByRole("button", { name: "Passer à « Refusée » (Refusée)" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).queryByLabelText(/Dépasser la capacité/)).toBeNull(); // pas d'option de dépassement pour un refus
    fireEvent.click(within(dialog).getByRole("button", { name: "Enregistrer : Refus" }));
    expect(await within(dialog).findByText("Un refus ou un retrait cite un motif codé.")).toBeTruthy();
    expect(api.calls.some((c) => c.method === "POST")).toBe(false);
    fireEvent.change(await within(dialog).findByLabelText(/^Motif/), { target: { value: "NO_SEAT" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Enregistrer : Refus" }));
    await waitFor(() => expect(api.calls.some((c) => c.method === "POST")).toBe(true));
    expect(api.calls.find((c) => c.method === "POST")!.body).toEqual({ toStageId: IDS.stageRejected, kind: "REJECT", reasonCode: "NO_SEAT", overrideCapacity: false, rowVersion: 3 });
  });

  it("acceptation sans place : le dépassement n'est proposé qu'avec la permission sensible, et exige un motif de 10 caractères", async () => {
    const accept = allowed({ transitionId: uuid(97), toStageId: IDS.stageAccepted, toStageLabel: "Acceptée", toStatus: "ACCEPTED", requiresDecision: true, decisionKind: "ACCEPT", permissionKey: "admission.decide" });
    const d = detail({ seatsLeft: 0, allowedTransitions: [accept] });
    setTestApi(base(["admission.read", "admission.decide"], route(d)));
    const first = renderWithProviders(<ApplicationDetailScreen applicationId={IDS.app1} />);
    fireEvent.click(await screen.findByRole("button", { name: "Passer à « Acceptée » (Acceptée)" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText(/Aucune place n'est disponible/)).toBeTruthy();
    expect(within(dialog).queryByLabelText(/Dépasser la capacité/)).toBeNull();
    first.unmount();

    const api = setTestApi(base(["admission.read", "admission.decide", "admission.capacity.override"], route(d, { [`POST ${A}/applications/${IDS.app1}/decisions`]: detail() })));
    renderWithProviders(<ApplicationDetailScreen applicationId={IDS.app1} />);
    fireEvent.click(await screen.findByRole("button", { name: "Passer à « Acceptée » (Acceptée)" }));
    const dlg = await screen.findByRole("dialog");
    fireEvent.click(await within(dlg).findByLabelText(/Dépasser la capacité/));
    fireEvent.click(within(dlg).getByRole("button", { name: "Enregistrer : Acceptation" }));
    expect(await within(dlg).findByText("Un dépassement de capacité exige un motif d'au moins 10 caractères.")).toBeTruthy();
    expect(api.calls.some((c) => c.method === "POST")).toBe(false);
  });

  it("pièces : le rejet exige un motif ; le dépôt part en multipart ; la consultation passe par un lien signé", async () => {
    const d = detail({ documents: [doc({ status: "SUBMITTED", attempts: 1, submittedAt: "2026-10-01T10:00:00.000Z" })] });
    const api = setTestApi(
      base(["admission.read", "admission.document.review", "admission.document.upload"], {
        ...route(d),
        [`POST ${A}/applications/${IDS.app1}/documents/${IDS.requirement}/review`]: { items: [doc({ status: "REJECTED" })] },
        [`POST ${A}/applications/${IDS.app1}/documents`]: { items: [doc({ status: "SUBMITTED" })] },
      }),
    );
    renderWithProviders(<ApplicationDetailScreen applicationId={IDS.app1} />);
    fireEvent.click(await screen.findByRole("button", { name: "Rejeter la pièce : Acte de naissance" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText(/Motif du rejet/), { target: { value: "Photo floue" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Rejeter" }));
    await waitFor(() => expect(api.calls.some((c) => c.path.endsWith("/review"))).toBe(true));
    expect(api.calls.find((c) => c.path.endsWith("/review"))!.body).toEqual({ decision: "REJECT", reason: "Photo floue" });

    const input = document.getElementById(`up-${IDS.requirement}`) as HTMLInputElement;
    fireEvent.change(input, { target: { files: [new File([new Uint8Array(400)], "acte.pdf", { type: "application/pdf" })] } });
    await waitFor(() => expect(api.calls.some((c) => c.method === "POST" && c.path === `${A}/applications/${IDS.app1}/documents`)).toBe(true));
    expect(api.calls.find((c) => c.method === "POST" && c.path === `${A}/applications/${IDS.app1}/documents`)!.body).toMatchObject({ requirementId: IDS.requirement, file: { fileName: "acte.pdf", type: "application/pdf" } });
  });

  it("offre : le lien de réponse (secret dans le fragment) n'est montré qu'à l'émission", async () => {
    const token = "R".repeat(43);
    const api = setTestApi(
      base(["admission.read", "admission.offer.manage"], {
        ...route(detail({ status: "ACCEPTED", stageLabel: "Acceptée", allowedTransitions: [] })),
        [`GET ${A}/lookups/classrooms`]: { items: [{ id: IDS.classroom, label: "CP1 A", institutionId: IDS.institution, academicYearId: IDS.year, gradeLevelCode: "CP1", open: true }] },
        [`POST ${A}/applications/${IDS.app1}/offers`]: { offer: offer(), responseToken: token, guardianId: IDS.guardian, notified: "SENT" },
      }),
    );
    renderWithProviders(<ApplicationDetailScreen applicationId={IDS.app1} />);
    fireEvent.click(await screen.findByRole("button", { name: "Émettre une offre" }));
    const dialog = await screen.findByRole("dialog");
    await waitFor(() => expect(within(dialog).getByRole("option", { name: "CP1 A" })).toBeTruthy());
    fireEvent.change(within(dialog).getByLabelText(/Classe/), { target: { value: IDS.classroom } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Émettre une offre" }));
    const link = (await screen.findByLabelText("Lien de réponse de la famille")) as HTMLInputElement;
    expect(link.value).toBe(`${window.location.origin}/v2/apply/${SLUG}/offer#t=${token}`);
    expect(new URL(link.value).search).toBe(""); // jamais dans la chaîne de requête
    expect(screen.getByText(/qu'une seule fois/)).toBeTruthy();
    expect(api.calls.find((c) => c.method === "POST")!.body).toEqual({ classroomId: IDS.classroom });
  });

  it("acceptation au nom de la famille : réservée à la permission d'inscription", async () => {
    const d = detail({ status: "ACCEPTED", offers: [offer()], allowedTransitions: [] });
    setTestApi(base(["admission.read", "admission.offer.manage"], route(d)));
    const first = renderWithProviders(<ApplicationDetailScreen applicationId={IDS.app1} />);
    expect(await screen.findByRole("button", { name: "Retirer l'offre" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Accepter au nom de la famille" })).toBeNull();
    first.unmount();

    const api = setTestApi(base(["admission.read", "admission.offer.manage", "admission.enroll"], route(d, { [`POST ${A}/offers/${IDS.offer}/accept-on-behalf`]: { applicationId: IDS.app1, offerId: IDS.offer, studentId: uuid(5), enrollmentId: uuid(6), invoiceId: uuid(7), stageId: IDS.stageAccepted, status: "ACCEPTED", replayed: false } })));
    renderWithProviders(<ApplicationDetailScreen applicationId={IDS.app1} />);
    fireEvent.click(await screen.findByRole("button", { name: "Accepter au nom de la famille" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Enregistrer l'acceptation" }));
    expect(await within(dialog).findByText("La pièce justificative est obligatoire.")).toBeTruthy();
    expect(api.calls.some((c) => c.method === "POST")).toBe(false);
    fireEvent.change(within(dialog).getByLabelText(/Référence de la pièce justificative/), { target: { value: "REG-2026-14" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Enregistrer l'acceptation" }));
    await waitFor(() => expect(api.calls.some((c) => c.method === "POST")).toBe(true));
    expect(api.calls.find((c) => c.method === "POST")!.body).toEqual({ guardianId: IDS.guardian, evidenceRef: "REG-2026-14" });
    // L-75 : le résultat dit clairement si une facture d'inscription a été créée (ici oui : invoiceId renseigné)
    expect(await screen.findByText(/la facture des frais d'inscription a été créée dans Finance/)).toBeTruthy();
  });

  it("anonymisation : motif d'au moins 10 caractères, permission sensible requise", async () => {
    const api = setTestApi(base(["admission.read", "admission.anonymize"], route(detail(), { [`POST ${A}/applications/${IDS.app1}/anonymize`]: { anonymized: true, applicationId: IDS.app1 } })));
    renderWithProviders(<ApplicationDetailScreen applicationId={IDS.app1} />);
    fireEvent.click(await screen.findByRole("button", { name: "Anonymiser" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText(/Motif de l'anonymisation/), { target: { value: "court" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Anonymiser" }));
    expect(api.calls.some((c) => c.method === "POST")).toBe(false);
    fireEvent.change(within(dialog).getByLabelText(/Motif de l'anonymisation/), { target: { value: "Demande écrite de la famille" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Anonymiser" }));
    await waitFor(() => expect(api.calls.some((c) => c.method === "POST")).toBe(true));
    expect(api.calls.find((c) => c.method === "POST")!.body).toEqual({ reason: "Demande écrite de la famille" });
  });

  it("consentement papier : pièce justificative obligatoire, corps conforme au contrat", async () => {
    const api = setTestApi(base(["admission.read", "admission.update"], route(detail(), { [`POST ${A}/applications/${IDS.app1}/consents`]: detail({ hasValidConsent: true }) })));
    renderWithProviders(<ApplicationDetailScreen applicationId={IDS.app1} />);
    fireEvent.click(await screen.findByRole("button", { name: "Consigner un consentement" }));
    const dialog = await screen.findByRole("dialog");
    await waitFor(() => expect((within(dialog).getByLabelText(/Version du texte accepté/) as HTMLInputElement).value).toBe("1.0"));
    fireEvent.click(within(dialog).getByRole("button", { name: "Enregistrer le consentement" }));
    expect(api.calls.some((c) => c.method === "POST")).toBe(false);
    fireEvent.change(within(dialog).getByLabelText(/Référence de la pièce justificative/), { target: { value: "Fiche papier n°45" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Enregistrer le consentement" }));
    await waitFor(() => expect(api.calls.some((c) => c.method === "POST")).toBe(true));
    expect(api.calls.find((c) => c.method === "POST")!.body).toEqual({ guardianId: IDS.guardian, kind: "DATA_PROCESSING", textVersion: "1.0", givenVia: "PAPER", evidenceRef: "Fiche papier n°45" });
  });
});

describe("WaitlistScreen", () => {
  it("affiche l'ordre et les places libres de l'API ; la promotion montre le lien de réponse une fois", async () => {
    const entries = [{ queuePosition: 1, applicationId: IDS.app1, applicationNumber: "2026-00001", applicantFirstName: "Awa", applicantLastName: "KONÉ", priorityClassCode: "STAFF", priorityLabel: "Enfant de personnel", priorityRank: 1, waitlistEnteredAt: "2026-09-10T08:00:00.000Z", manualRank: 1 }];
    const api = setTestApi(
      base(["admission.read", "admission.waitlist.manage"], {
        [`GET ${A}/waitlist`]: { campaignId: IDS.campaign, grade: "CP1", seatsLeft: 1, waitlistLimit: 10, entries, changes: [] },
        [`POST ${A}/waitlist/promote`]: { promoted: true, applicationId: IDS.app1, reason: null, offerId: IDS.offer, responseToken: "Z".repeat(43) },
      }),
    );
    renderWithProviders(<WaitlistScreen />);
    await screen.findByText("Choisissez un niveau pour afficher sa liste d'attente.");
    fireEvent.change(await screen.findByLabelText("Niveau"), { target: { value: "CP1" } });
    const table = await screen.findByRole("table", { name: "Liste d'attente du niveau" });
    expect(await within(table).findByText("Enfant de personnel")).toBeTruthy();
    expect(await screen.findByText(/1 place libre/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Promouvoir le premier de la liste" }));
    await waitFor(() => expect(api.calls.some((c) => c.method === "POST")).toBe(true));
    expect(api.calls.find((c) => c.method === "POST")!.body).toEqual({ campaignId: IDS.campaign, grade: "CP1" });
    expect(await screen.findByText("Une offre a été émise.")).toBeTruthy();
    expect(((await screen.findByLabelText("Lien de réponse de la famille")) as HTMLInputElement).value).toContain(`#t=${"Z".repeat(43)}`);
  });
});

describe("WaitlistScreen : rang décidé par la direction (Q-A03)", () => {
  const entry = (n: number, applicationId: string, first: string, manualRank: number | null) => ({
    queuePosition: n,
    applicationId,
    applicationNumber: `2026-0000${n}`,
    applicantFirstName: first,
    applicantLastName: "KONÉ",
    priorityClassCode: null,
    priorityLabel: null,
    priorityRank: null,
    waitlistEnteredAt: "2026-09-10T08:00:00.000Z",
    manualRank,
  });
  const listFixture = {
    campaignId: IDS.campaign,
    grade: "CP1",
    seatsLeft: 0,
    waitlistLimit: null,
    entries: [entry(1, IDS.app1, "Awa", 1), entry(2, IDS.app2, "Binta", null)],
    changes: [{ id: uuid(90), applicationId: IDS.app1, kind: "RANKED", fromRank: null, toRank: 1, reason: "Décision du comité", actorId: uuid(91), occurredAt: "2026-10-01T08:00:00.000Z" }],
  };

  it("sans le droit de réordonner : pas de boutons Monter / Descendre ; un dossier « à classer » est signalé ; la trace des changements est lisible", async () => {
    setTestApi(base(["admission.read", "admission.waitlist.manage"], { [`GET ${A}/waitlist`]: listFixture }));
    renderWithProviders(<WaitlistScreen />);
    await screen.findByText("Choisissez un niveau pour afficher sa liste d'attente.");
    fireEvent.change(await screen.findByLabelText("Niveau"), { target: { value: "CP1" } });
    const table = await screen.findByRole("table", { name: "Liste d'attente du niveau" });
    expect(await within(table).findByText("À classer")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Monter/ })).toBeNull();
    expect(await screen.findByText(/Décision du comité/)).toBeTruthy();
    expect(screen.getByText(/Des dossiers n'ont pas encore de rang décidé/)).toBeTruthy();
  });

  it("avec le droit : monter un dossier envoie la LISTE COMPLÈTE dans le nouvel ordre, avec le motif ; rien n'est envoyé avant l'enregistrement", async () => {
    const api = setTestApi(
      base(["admission.read", "admission.waitlist.manage", "admission.waitlist.reorder"], {
        [`GET ${A}/waitlist`]: listFixture,
        [`PUT ${A}/waitlist/order`]: { count: 2, changed: 2 },
      }),
    );
    renderWithProviders(<WaitlistScreen />);
    await screen.findByText("Choisissez un niveau pour afficher sa liste d'attente.");
    fireEvent.change(await screen.findByLabelText("Niveau"), { target: { value: "CP1" } });
    await screen.findByRole("table", { name: "Liste d'attente du niveau" });
    fireEvent.click(await screen.findByRole("button", { name: "Monter Binta KONÉ d'un rang" }));
    expect(api.calls.some((c) => c.method === "PUT")).toBe(false);
    fireEvent.change(await screen.findByLabelText(/Motif/), { target: { value: "Fratrie prioritaire" } });
    fireEvent.click(screen.getByRole("button", { name: "Enregistrer l'ordre" }));
    await waitFor(() => expect(api.calls.some((c) => c.method === "PUT")).toBe(true));
    expect(api.calls.find((c) => c.method === "PUT")!.body).toEqual({ campaignId: IDS.campaign, grade: "CP1", orderedApplicationIds: [IDS.app2, IDS.app1], reason: "Fratrie prioritaire" });
    expect(await screen.findByText("L'ordre de la liste d'attente est enregistré.")).toBeTruthy();
  });

  it("un seul dossier en attente (L-72) : il peut être classé en rang 1, la liste envoyée n'a qu'un élément", async () => {
    const single = { ...listFixture, entries: [entry(1, IDS.app2, "Binta", null)], changes: [] };
    const api = setTestApi(
      base(["admission.read", "admission.waitlist.manage", "admission.waitlist.reorder"], {
        [`GET ${A}/waitlist`]: single,
        [`PUT ${A}/waitlist/order`]: { count: 1, changed: 1 },
      }),
    );
    renderWithProviders(<WaitlistScreen />);
    await screen.findByText("Choisissez un niveau pour afficher sa liste d'attente.");
    fireEvent.change(await screen.findByLabelText("Niveau"), { target: { value: "CP1" } });
    fireEvent.click(await screen.findByRole("button", { name: "Classer ce dossier en rang 1" }));
    fireEvent.click(await screen.findByRole("button", { name: "Enregistrer l'ordre" }));
    await waitFor(() => expect(api.calls.some((c) => c.method === "PUT")).toBe(true));
    expect(api.calls.find((c) => c.method === "PUT")!.body).toEqual({ campaignId: IDS.campaign, grade: "CP1", orderedApplicationIds: [IDS.app2] });
  }, 120_000);
});

describe("CampaignsScreen", () => {
  it("liste les capacités ; l'édition envoie des entiers conformes au contrat, une valeur invalide est refusée avant l'envoi", async () => {
    const api = setTestApi(base(["admission.read", "admission.campaign.manage"], { [`PUT ${A}/campaigns/${IDS.campaign}/capacities`]: campaign() }));
    renderWithProviders(<CampaignsScreen />);
    expect(await screen.findByRole("heading", { name: /Rentrée 2026/ })).toBeTruthy();
    expect(screen.getByRole("table", { name: "Capacités de la campagne Rentrée 2026" })).toBeTruthy();
    fireEvent.click(await screen.findByRole("button", { name: "Modifier les capacités de Rentrée 2026" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText("Places"), { target: { value: "abc" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Enregistrer" }));
    expect(await within(dialog).findByText("Valeurs invalides pour le niveau CP1.")).toBeTruthy();
    expect(api.calls.some((c) => c.method === "PUT")).toBe(false);
    fireEvent.change(within(dialog).getByLabelText("Places"), { target: { value: "35" } });
    fireEvent.change(within(dialog).getByLabelText("Limite de la liste"), { target: { value: "" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Enregistrer" }));
    await waitFor(() => expect(api.calls.some((c) => c.method === "PUT")).toBe(true));
    expect(api.calls.find((c) => c.method === "PUT")!.body).toEqual({ capacities: [{ gradeLevelCode: "CP1", seats: 35, waitlistLimit: null }] });
  });

  it("ouvrir / clôturer : réservé à la gestion des campagnes", async () => {
    setTestApi(base(["admission.read"]));
    renderWithProviders(<CampaignsScreen />);
    await screen.findByRole("heading", { name: /Rentrée 2026/ });
    expect(screen.queryByRole("button", { name: "Clôturer la campagne Rentrée 2026" })).toBeNull();
  });
});

describe("SettingsScreen", () => {
  it("enregistre uniquement des valeurs conformes ; les réglages sont ceux de l'API ; le lien public se régénère", async () => {
    const api = setTestApi(
      base(["admission.settings.manage"], {
        [`PUT ${A}/settings`]: settings({ offerValidityDays: 21 }),
        [`POST ${A}/settings/public-link`]: settings({ publicFormSlug: "n".repeat(26) }),
        [`GET ${A}/consent-texts`]: { items: [{ id: uuid(91), kind: "DATA_PROCESSING", version: "1.0", language: "fr", body: "Texte de consentement valable.", publishedAt: "2026-09-01T00:00:00.000Z", retiredAt: null }] },
        [`GET ${A}/document-requirements`]: { items: [] },
        [`GET ${A}/priority-classes`]: { items: [] },
      }, ["admissions.public-form"]),
    );
    renderWithProviders(<SettingsScreen />);
    const validity = (await screen.findByLabelText(/Validité d'une offre/)) as HTMLInputElement;
    expect(validity.value).toBe("14");
    fireEvent.change(validity, { target: { value: "0" } });
    fireEvent.click(screen.getByRole("button", { name: "Enregistrer" }));
    expect((await screen.findAllByRole("alert")).length).toBeGreaterThan(0);
    expect(api.calls.some((c) => c.method === "PUT")).toBe(false);
    fireEvent.change(validity, { target: { value: "21" } });
    // L'ouverture du formulaire public est réglable depuis l'écran (elle ne l'était que par l'API) : décocher l'envoie à l'API.
    const open = screen.getByRole("checkbox", { name: /Formulaire de candidature public ouvert/ }) as HTMLInputElement;
    expect(open.checked).toBe(true);
    fireEvent.click(open);
    fireEvent.click(screen.getByRole("button", { name: "Enregistrer" }));
    await waitFor(() => expect(api.calls.some((c) => c.method === "PUT")).toBe(true));
    expect(api.calls.find((c) => c.method === "PUT")!.body).toMatchObject({ institutionId: IDS.institution, offerValidityDays: 21, capacityPolicy: "HARD", duplicatePolicy: "WARN", paymentDeadlineDays: null, publicFormEnabled: false });

    expect(((await screen.findByLabelText("Lien du formulaire")) as HTMLInputElement).value).toBe(`${window.location.origin}/v2/apply/${SLUG}`);
    fireEvent.click(screen.getByRole("button", { name: "Régénérer le lien" }));
    await waitFor(() => expect(api.calls.some((c) => c.path === `${A}/settings/public-link`)).toBe(true));
    expect(api.calls.find((c) => c.path === `${A}/settings/public-link`)!.body).toEqual({ institutionId: IDS.institution, rotate: true });
  });

  it("sans fonctionnalité « formulaire public » dans le plan : la section du lien n'est pas montrée", async () => {
    setTestApi(base(["admission.settings.manage"], { [`GET ${A}/consent-texts`]: { items: [] }, [`GET ${A}/document-requirements`]: { items: [] }, [`GET ${A}/priority-classes`]: { items: [] } }));
    renderWithProviders(<SettingsScreen />);
    await screen.findByLabelText(/Validité d'une offre/);
    expect(screen.queryByRole("heading", { name: "Formulaire public" })).toBeNull();
  });
});

describe("WorkflowScreen", () => {
  const list = (status: "DRAFT" | "PUBLISHED") => ({ items: [{ id: IDS.workflow, institutionId: IDS.institution, code: "STANDARD", version: 1, label: "Parcours standard", educationLevelCode: null, status, publishedAt: null, stageCount: 4 }] });

  it("brouillon : défauts de publication affichés ; la publication exige la permission dédiée", async () => {
    const d = workflow({ defects: [{ code: "admissions.no_terminal", message: "Aucune étape finale.", stages: ["ACCEPTED"] }] });
    setTestApi(base(["admission.workflow.manage"], { [`GET ${A}/workflows`]: list("DRAFT"), [`GET ${A}/workflows/${IDS.workflow}`]: d }));
    const first = renderWithProviders(<WorkflowScreen />);
    expect(await screen.findByText("À corriger avant la publication")).toBeTruthy();
    expect(screen.getByText(/Aucune étape finale\./)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Publier" })).toBeNull();
    first.unmount();

    const api = setTestApi(base(["admission.workflow.manage", "admission.workflow.publish"], { [`GET ${A}/workflows`]: list("DRAFT"), [`GET ${A}/workflows/${IDS.workflow}`]: workflow(), [`POST ${A}/workflows/${IDS.workflow}/publish`]: workflow({ status: "PUBLISHED" }) }));
    renderWithProviders(<WorkflowScreen />);
    fireEvent.click(await screen.findByRole("button", { name: "Publier" }));
    await waitFor(() => expect(api.calls.some((c) => c.path.endsWith("/publish"))).toBe(true));
  });

  it("publié : gelé, aucune édition ; seule une nouvelle version est possible", async () => {
    setTestApi(base(["admission.workflow.manage"], { [`GET ${A}/workflows`]: list("PUBLISHED"), [`GET ${A}/workflows/${IDS.workflow}`]: workflow({ status: "PUBLISHED" }) }));
    renderWithProviders(<WorkflowScreen />);
    expect(await screen.findByText(/Ce workflow est gelé/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Nouvelle version" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Enregistrer les étapes" })).toBeNull();
    expect(screen.getByRole("table", { name: "Étapes" })).toBeTruthy();
  });

  it("brouillon : l'éditeur envoie les étapes et transitions au format du contrat (ordre = position)", async () => {
    const api = setTestApi(
      base(["admission.workflow.manage"], {
        [`GET ${A}/workflows`]: list("DRAFT"),
        [`GET ${A}/workflows/${IDS.workflow}`]: workflow({ stages: [stage(), reviewStage(), acceptedStage(), rejectedStage()] }),
        [`PUT ${A}/workflows/${IDS.workflow}/stages`]: workflow(),
        [`PUT ${A}/workflows/${IDS.workflow}/transitions`]: workflow(),
      }),
    );
    renderWithProviders(<WorkflowScreen />);
    const form = await screen.findByRole("form", { name: "Étapes" });
    fireEvent.click(within(form).getByRole("button", { name: "Descendre l'étape Déposée" }));
    fireEvent.click(within(form).getByRole("button", { name: "Enregistrer les étapes" }));
    await waitFor(() => expect(api.calls.some((c) => c.method === "PUT" && c.path.endsWith("/stages"))).toBe(true));
    const body = api.calls.find((c) => c.method === "PUT" && c.path.endsWith("/stages"))!.body as { stages: Array<{ code: string; ordinal: number; slaHours: number | null }> };
    expect(body.stages.map((s) => [s.code, s.ordinal])).toEqual([["UNDER_REVIEW", 1], ["SUBMITTED", 2], ["ACCEPTED", 3], ["REJECTED", 4]]);
    expect(body.stages[1]!.slaHours).toBe(48);

    fireEvent.click(screen.getByRole("button", { name: "Enregistrer les transitions" }));
    await waitFor(() => expect(api.calls.some((c) => c.method === "PUT" && c.path.endsWith("/transitions"))).toBe(true));
    const tr = api.calls.find((c) => c.method === "PUT" && c.path.endsWith("/transitions"))!.body as { transitions: Array<{ fromStage: string; toStage: string; permissionKey: string }> };
    expect(tr.transitions[0]).toMatchObject({ fromStage: "SUBMITTED", toStage: "UNDER_REVIEW", permissionKey: "admission.update" });
  });
});
