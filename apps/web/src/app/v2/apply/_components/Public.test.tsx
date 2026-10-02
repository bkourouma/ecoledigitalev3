// @vitest-environment jsdom
import { configure, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { admissionsPublicSubmitBodySchema } from "@ecoledigitale/contracts/v2/admissions";
import { setTestApi } from "@/platform/test/api-mock";
import { json, renderWithProviders } from "@/platform/test/render";
import { IDS, publicForm, SLUG, track } from "../../admissions/_test/fixtures";
import { PublicFormScreen } from "./PublicFormScreen";
import { PublicOfferScreen, readOfferToken } from "./PublicOfferScreen";
import { normalizeTrackingCode, PublicTrackScreen } from "./PublicTrackScreen";

vi.setConfig({ testTimeout: 30_000 });
// Machine chargée (plusieurs agents, intégration en parallèle) : les chaînes de requêtes successives dépassent parfois 1 s.
configure({ asyncUtilTimeout: 5000 });

vi.mock("@/platform/api/default-client", async () => (await import("@/platform/test/api-mock")).defaultClientModule);
vi.mock("next/link", () => ({ default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a> }));

const P = "/api/v1/public/admissions";
const FORM = `GET ${P}/forms/${SLUG}`;
const SUBMIT = `POST ${P}/forms/${SLUG}/applications`;

beforeEach(() => {
  window.location.hash = "";
});
afterEach(() => vi.restoreAllMocks());

/** Aucun appel public ne porte de jeton de session ni d'en-tête d'établissement. */
function expectAnonymous(calls: Array<{ headers: Record<string, string> }>): void {
  for (const c of calls) {
    expect(c.headers["authorization"]).toBeUndefined();
    expect(c.headers["x-tenant"]).toBeUndefined();
  }
}

function fillValidForm(): void {
  const [childFirst, guardianFirst] = screen.getAllByLabelText(/Prénoms/);
  const [childLast, guardianLast] = screen.getAllByLabelText(/^Nom/);
  fireEvent.change(childFirst!, { target: { value: "Awa" } });
  fireEvent.change(childLast!, { target: { value: "KONÉ" } });
  fireEvent.change(screen.getByLabelText(/Date de naissance/), { target: { value: "2020-03-14" } });
  fireEvent.change(screen.getByLabelText(/Niveau demandé/), { target: { value: "CP1" } });
  fireEvent.change(screen.getByLabelText(/Lien de parenté/), { target: { value: "MOTHER" } });
  fireEvent.change(guardianFirst!, { target: { value: "Mariam" } });
  fireEvent.change(guardianLast!, { target: { value: "KONÉ" } });
  fireEvent.change(screen.getByLabelText(/Téléphone/), { target: { value: "+2250700000000" } });
}

describe("PublicFormScreen : formulaire public sans authentification", () => {
  it("affiche le texte de consentement versionné publié par l'établissement ; aucun appel ne porte de session", async () => {
    const api = setTestApi({ [FORM]: publicForm() });
    renderWithProviders(<PublicFormScreen school={SLUG} />);
    expect(await screen.findByRole("heading", { name: "Candidature à École Les Palmiers", level: 1 })).toBeTruthy();
    expect(screen.getByText(/Nous traitons les données de votre enfant/)).toBeTruthy();
    expect(screen.getByText("Version du texte : 1.0")).toBeTruthy();
    expect(screen.getByText(/Ne saisissez aucune donnée de santé/)).toBeTruthy();
    expectAnonymous(api.calls);
  });

  it("le champ leurre est caché aux personnes (hors tabulation, aria-hidden) ; sans consentement rien n'est envoyé", async () => {
    const api = setTestApi({ [FORM]: publicForm(), [SUBMIT]: { trackingCode: "ABCD1234EFGH5678", message: "ok" } });
    renderWithProviders(<PublicFormScreen school={SLUG} />);
    await screen.findByRole("heading", { level: 1 });
    const trap = document.querySelector('input[name="website"]') as HTMLInputElement;
    expect(trap.tabIndex).toBe(-1);
    expect(trap.closest('[aria-hidden="true"]')).not.toBeNull();
    expect(screen.queryByRole("textbox", { name: "website" })).toBeNull(); // absent de l'arbre d'accessibilité
    fillValidForm();
    fireEvent.click(screen.getByRole("button", { name: "Envoyer ma candidature" }));
    expect(await screen.findByText("Le consentement parental est obligatoire pour envoyer la candidature.")).toBeTruthy();
    expect(api.calls.some((c) => c.method === "POST")).toBe(false);
  });

  it("envoi : corps conforme au contrat public (jeton de formulaire, consentement versionné), puis code de suivi à conserver", async () => {
    const api = setTestApi({ [FORM]: publicForm(), [SUBMIT]: { trackingCode: "ABCD1234EFGH5678", message: "Votre candidature est enregistrée." } });
    renderWithProviders(<PublicFormScreen school={SLUG} />);
    await screen.findByRole("heading", { level: 1 });
    fillValidForm();
    fireEvent.click(screen.getByLabelText(/J'ai lu le texte ci-dessus/));
    fireEvent.click(screen.getByRole("button", { name: "Envoyer ma candidature" }));
    expect(await screen.findByText("ABCD1234EFGH5678")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Suivre mon dossier" }).getAttribute("href")).toBe(`/v2/apply/${SLUG}/track`);
    const post = api.calls.find((c) => c.method === "POST")!;
    expect(admissionsPublicSubmitBodySchema.safeParse(post.body).success).toBe(true);
    expect(post.body).toMatchObject({ formToken: "t".repeat(40), applicantFirstName: "Awa", desiredGradeLevelCode: "CP1", consent: { accepted: true, textVersion: "1.0", guardianIndex: 0 } });
    expect((post.body as Record<string, unknown>)["website"]).toBeUndefined(); // leurre vide : absent
    expect(post.query).toEqual({});
    expectAnonymous(api.calls);
  });

  it("un robot qui remplit le leurre : la valeur est transmise telle quelle (le refus neutre est décidé par l'API)", async () => {
    const api = setTestApi({ [FORM]: publicForm(), [SUBMIT]: { trackingCode: "ZZZZ1234ZZZZ5678", message: "ok" } });
    renderWithProviders(<PublicFormScreen school={SLUG} />);
    await screen.findByRole("heading", { level: 1 });
    fillValidForm();
    fireEvent.click(screen.getByLabelText(/J'ai lu le texte ci-dessus/));
    fireEvent.change(document.querySelector('input[name="website"]')!, { target: { value: "http://spam.example" } });
    fireEvent.click(screen.getByRole("button", { name: "Envoyer ma candidature" }));
    await screen.findByText("ZZZZ1234ZZZZ5678");
    expect((api.calls.find((c) => c.method === "POST")!.body as Record<string, unknown>)["website"]).toBe("http://spam.example");
  });

  it("échec : message neutre selon le seul statut ; un NOUVEAU jeton est demandé (usage unique) et la saisie est conservée", async () => {
    let reads = 0;
    const api = setTestApi({
      [FORM]: () => json(publicForm({ formToken: `${++reads}`.repeat(40) })),
      [SUBMIT]: () => json({ status: 400, code: "admissions.public_invalid", message: "Vérifiez." }, { status: 400 }),
    });
    renderWithProviders(<PublicFormScreen school={SLUG} />);
    await screen.findByRole("heading", { level: 1 });
    fillValidForm();
    fireEvent.click(screen.getByLabelText(/J'ai lu le texte ci-dessus/));
    fireEvent.click(screen.getByRole("button", { name: "Envoyer ma candidature" }));
    expect(await screen.findByText("Vérifiez les informations saisies, puis réessayez.")).toBeTruthy();
    await waitFor(() => expect(reads).toBe(2));
    expect((screen.getAllByLabelText(/Prénoms/)[0] as HTMLInputElement).value).toBe("Awa");
    api.calls.length = 0;
    fireEvent.click(screen.getByRole("button", { name: "Envoyer ma candidature" }));
    await waitFor(() => expect(api.calls.some((c) => c.method === "POST")).toBe(true));
    expect((api.calls.find((c) => c.method === "POST")!.body as { formToken: string }).formToken).toBe("2".repeat(40));
  });

  it("formulaire fermé, inconnu ou sans texte publié : même réponse neutre ; limiteur et panne : messages distincts sans détail", async () => {
    setTestApi({ [FORM]: () => json({ status: 404, code: "admissions.public_form_closed", message: "Introuvable." }, { status: 404 }) });
    const a = renderWithProviders(<PublicFormScreen school={SLUG} />);
    expect(await screen.findByText("Ce formulaire n'est pas disponible.")).toBeTruthy();
    a.unmount();
    setTestApi({ [FORM]: () => json({ status: 429, code: "admissions.rate_limited", message: "Trop." }, { status: 429 }) });
    const b = renderWithProviders(<PublicFormScreen school={SLUG} />);
    expect(await screen.findByText(/Trop de demandes depuis votre connexion/)).toBeTruthy();
    b.unmount();
    setTestApi({ [FORM]: () => json({ status: 503, code: "admissions.port_unavailable", message: "x" }, { status: 503 }) });
    renderWithProviders(<PublicFormScreen school={SLUG} />);
    expect(await screen.findByText(/momentanément indisponible/)).toBeTruthy();
  });
});

describe("PublicTrackScreen : suivi par code", () => {
  it("normalise le code et l'envoie dans le CORPS (jamais dans l'URL) ; affiche phase et pièces à fournir", async () => {
    const api = setTestApi({ [`POST ${P}/track`]: track() });
    renderWithProviders(<PublicTrackScreen school={SLUG} />);
    fireEvent.change(screen.getByLabelText(/Code de suivi/), { target: { value: "abcd 1234-efgh 5678" } });
    fireEvent.click(screen.getByRole("button", { name: "Suivre" }));
    expect(await screen.findByText("Pièces à fournir", { selector: "span" })).toBeTruthy();
    const call = api.calls.find((c) => c.method === "POST")!;
    expect(call.body).toEqual({ school: SLUG, trackingCode: "ABCD1234EFGH5678" });
    expect(call.path).toBe(`${P}/track`);
    expect(call.query).toEqual({});
    expectAnonymous(api.calls);
    expect(normalizeTrackingCode(" ab-cd 12 ")).toBe("ABCD12");
  });

  it("code inconnu, expiré ou mal formé : une seule réponse", async () => {
    setTestApi({ [`POST ${P}/track`]: () => json({ status: 404, code: "admissions.public_form_closed", message: "Introuvable." }, { status: 404 }) });
    renderWithProviders(<PublicTrackScreen school={SLUG} />);
    fireEvent.change(screen.getByLabelText(/Code de suivi/), { target: { value: "INCONNU000000" } });
    fireEvent.click(screen.getByRole("button", { name: "Suivre" }));
    expect(await screen.findByText("Aucun dossier ne correspond à ce code.")).toBeTruthy();
    fireEvent.change(screen.getByLabelText(/Code de suivi/), { target: { value: "x" } });
    fireEvent.click(screen.getByRole("button", { name: "Suivre" }));
    expect(await screen.findByText("Aucun dossier ne correspond à ce code.")).toBeTruthy();
  });

  it("dépôt d'une pièce manquante : multipart avec école, code et pièce dans le corps", async () => {
    const api = setTestApi({ [`POST ${P}/track`]: track(), [`POST ${P}/track/documents`]: { received: true } });
    renderWithProviders(<PublicTrackScreen school={SLUG} />);
    fireEvent.change(screen.getByLabelText(/Code de suivi/), { target: { value: "ABCD1234EFGH5678" } });
    fireEvent.click(screen.getByRole("button", { name: "Suivre" }));
    const list = await screen.findByRole("list");
    const input = list.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [new File([new Uint8Array(300)], "acte.pdf", { type: "application/pdf" })] } });
    expect(await screen.findByText("Pièce reçue, merci.")).toBeTruthy();
    const up = api.calls.find((c) => c.path === `${P}/track/documents`)!;
    expect(up.body).toMatchObject({ school: SLUG, trackingCode: "ABCD1234EFGH5678", requirementId: IDS.requirement, file: { fileName: "acte.pdf", type: "application/pdf" } });
    expect(up.query).toEqual({});
    expect(within(list).getByText("Acte de naissance")).toBeTruthy();
  });
});

describe("PublicOfferScreen : réponse à une offre", () => {
  const view = { institutionName: "École Les Palmiers", gradeLabel: "CP1", classroomLabel: "CP1 A", expiresAt: "2026-10-16T09:00:00.000Z", conditions: null, status: "PENDING" as const };

  it("le secret est lu dans le fragment de l'adresse ; il part dans le corps, jamais dans l'URL ; la réponse demande confirmation", async () => {
    const token = "S".repeat(43);
    window.location.hash = `#t=${token}`;
    const api = setTestApi({ [`POST ${P}/offers/view`]: view, [`POST ${P}/offers/respond`]: { status: "ACCEPTED", message: "Merci : votre acceptation est enregistrée." } });
    renderWithProviders(<PublicOfferScreen school={SLUG} />);
    expect(await screen.findByText("CP1 A")).toBeTruthy();
    expect(api.calls[0]!.body).toEqual({ school: SLUG, token });
    expect(api.calls[0]!.path).toBe(`${P}/offers/view`);
    expect(api.calls[0]!.query).toEqual({});
    fireEvent.click(screen.getByRole("button", { name: "Accepter la place" }));
    expect(api.calls.filter((c) => c.path.endsWith("/respond"))).toHaveLength(0); // confirmation d'abord
    const group = screen.getByRole("group", { name: "Confirmation" });
    fireEvent.click(within(group).getByRole("button", { name: "Accepter la place" }));
    expect(await screen.findByRole("heading", { name: "Place acceptée" })).toBeTruthy();
    expect(api.calls.find((c) => c.path.endsWith("/respond"))!.body).toEqual({ school: SLUG, token, accept: true });
    expectAnonymous(api.calls);
  });

  it("sans secret, lien invalide ou expiré : message neutre, aucun détail", async () => {
    const a = renderWithProviders(<PublicOfferScreen school={SLUG} />);
    expect(await screen.findByText(/Ce lien est incomplet/)).toBeTruthy();
    a.unmount();
    window.location.hash = `#t=${"X".repeat(43)}`;
    setTestApi({ [`POST ${P}/offers/view`]: () => json({ status: 404, code: "admissions.public_form_closed", message: "Introuvable." }, { status: 404 }) });
    renderWithProviders(<PublicOfferScreen school={SLUG} />);
    expect(await screen.findByText("Ce lien n'est pas ou plus valide.")).toBeTruthy();
  });

  it("offre déjà close : pas de boutons de réponse", async () => {
    window.location.hash = `#t=${"S".repeat(43)}`;
    setTestApi({ [`POST ${P}/offers/view`]: { ...view, status: "EXPIRED" } });
    renderWithProviders(<PublicOfferScreen school={SLUG} />);
    expect(await screen.findByText(/arrivée à échéance/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Accepter la place" })).toBeNull();
  });

  it("lecture du fragment", () => {
    expect(readOfferToken("#t=abc%2Bdef")).toBe("abc+def");
    expect(readOfferToken("")).toBeNull();
    expect(readOfferToken("#autre=1")).toBeNull();
  });
});
