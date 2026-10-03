// @vitest-environment jsdom
import { configure, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { COUNCIL_CONSENT_STATES } from "@ecoledigitale/contracts/v2/councils";
import catalog from "../../../../../messages/fr-CI.json";
import { accessRoutes, setTestApi } from "@/platform/test/api-mock";
import { expectNoBlockingViolations } from "@/platform/test/axe";
import { json, renderWithProviders } from "@/platform/test/render";
import { IDS, uuid } from "../_test/fixtures";
import { FamilyOrientation } from "./FamilyOrientation";
import { PortalScreen } from "./PortalScreen";

vi.setConfig({ testTimeout: 30_000 });
configure({ asyncUtilTimeout: 5000 });
vi.mock("@/platform/api/default-client", async () => (await import("@/platform/test/api-mock")).defaultClientModule);
vi.mock("next/link", () => ({ default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a> }));

const C = "/api/v1/councils";
const FILE = uuid(7001);
const PROGRAM = uuid(9001);
const GRADE = uuid(9002);
const AT = "2026-10-02T09:00:00.000Z";

const option = (over: Record<string, unknown> = {}) => ({ pathId: uuid(9100), label: "Parcours de démonstration", kind: "ORIENTATION", toProgramId: PROGRAM, toGradeLevelId: GRADE, requiresGuardianConsent: false, ...over });
const wish = (over: Record<string, unknown> = {}) => ({ id: uuid(9200), rank: 1, toProgramId: PROGRAM, toGradeLevelId: GRADE, targetLabel: "Parcours de démonstration", optionIds: [], source: "GUARDIAN", expressedAt: AT, comment: "Souhait de la famille", ...over });
const file = (over: Record<string, unknown> = {}) => ({ id: FILE, academicYearId: IDS.year, stage: "WISHES_COLLECTED", guardianConsent: "NOT_REQUIRED", consentRecordedAt: null, wishesOpen: true, consentOpen: false, wishes: [wish()], ...over });
const dto = (over: Record<string, unknown> = {}) => ({ studentId: IDS.student, studentName: "KOUASSI Awa", file: file(), options: [option()], ...over });

const childUrl = `GET ${C}/children/${IDS.student}/orientation`;
const posts = (api: ReturnType<typeof setTestApi>, suffix: string) => api.calls.filter((c) => c.method === "POST" && c.path.endsWith(suffix));

describe("FamilyOrientation : famille", () => {
  it("affiche l'état, les vœux de la famille et les destinations proposées ; jamais de note interne ni d'avis du personnel", async () => {
    setTestApi({ ...accessRoutes(["council.child.read"]), [childUrl]: dto() });
    renderWithProviders(<FamilyOrientation mode="guardian" studentId={IDS.student} />);
    expect(await screen.findByRole("heading", { name: "Orientation" })).toBeTruthy();
    expect(await screen.findByText("Vœux recueillis", { selector: "span, p" })).toBeTruthy();
    expect(screen.getByText(/Vœu n° 1/)).toBeTruthy();
    expect(screen.getByText("Exprimé par la famille")).toBeTruthy();
    expect(screen.getByText("Souhait de la famille")).toBeTruthy();
    const text = document.body.textContent ?? "";
    expect(text).not.toMatch(/Personnel|conseiller|notes? interne/i);
    // le champ « destination » ne propose que les parcours renvoyés par l'API
    const select = screen.getByLabelText(/Destination souhaitée/) as HTMLSelectElement;
    expect([...select.options].map((o) => o.textContent)).toEqual(["Choisir une destination", "Parcours de démonstration"]);
  });

  it("formulaire de vœux : rang, destination, commentaire ; corps exact (source tuteur imposée), message de confirmation", async () => {
    const api = setTestApi({
      ...accessRoutes(["council.child.read"]),
      [childUrl]: dto(),
      [`POST ${C}/orientation-files/${FILE}/wishes`]: () => json({ id: FILE, institutionId: uuid(1), academicYearId: IDS.year, enrollmentId: uuid(3), studentId: IDS.student, studentName: null, currentProgramId: uuid(4), currentGradeLevelId: uuid(5), status: "WISHES_COLLECTED", guardianConsent: "NOT_REQUIRED", consentRecordedAt: null, decisionId: null, notes: null, wishes: [], createdAt: AT }),
    });
    renderWithProviders(<FamilyOrientation mode="guardian" studentId={IDS.student} />);
    await screen.findByText(/Vœu n° 1/);
    // sans destination : refusé côté client, aucun appel
    fireEvent.click(screen.getByRole("button", { name: "Enregistrer le vœu" }));
    expect(await screen.findByText("Choisissez une destination.")).toBeTruthy();
    expect(posts(api, "/wishes")).toHaveLength(0);
    // rang 1 déjà pris : l'écran prévient du remplacement
    fireEvent.change(screen.getByLabelText(/Rang du vœu/), { target: { value: "1" } });
    expect(screen.getByText(/remplacera le précédent/)).toBeTruthy();
    fireEvent.change(screen.getByLabelText(/Rang du vœu/), { target: { value: "2" } });
    fireEvent.change(screen.getByLabelText(/Destination souhaitée/), { target: { value: uuid(9100) } });
    fireEvent.change(screen.getByLabelText(/Commentaire \(facultatif\)/), { target: { value: "  Deuxième choix  " } });
    fireEvent.click(screen.getByRole("button", { name: "Enregistrer le vœu" }));
    expect(await screen.findByText("Votre vœu n° 2 est enregistré.")).toBeTruthy();
    expect(posts(api, "/wishes")[0]!.body).toEqual({ rank: 2, toProgramId: PROGRAM, toGradeLevelId: GRADE, optionIds: [], source: "GUARDIAN", comment: "Deuxième choix" });
  });

  it("refus de l'API : message affiché, aucune confirmation", async () => {
    setTestApi({
      ...accessRoutes(["council.child.read"]),
      [childUrl]: dto(),
      [`POST ${C}/orientation-files/${FILE}/wishes`]: () => json({ status: 409, code: "councils.invalid_state", kind: "CONFLICT", message: "Le dossier est clos : les vœux ne changent plus." }, { status: 409 }),
    });
    renderWithProviders(<FamilyOrientation mode="guardian" studentId={IDS.student} />);
    await screen.findByText(/Vœu n° 1/);
    fireEvent.change(screen.getByLabelText(/Destination souhaitée/), { target: { value: uuid(9100) } });
    fireEvent.click(screen.getByRole("button", { name: "Enregistrer le vœu" }));
    expect(await screen.findByText("Le dossier est clos : les vœux ne changent plus.")).toBeTruthy();
    expect(screen.queryByText(/est enregistré\./)).toBeNull();
  });

  it("accord de la famille : en attente -> confirmation dans une fenêtre -> envoi de l'état choisi", async () => {
    const api = setTestApi({
      ...accessRoutes(["council.child.read"]),
      [childUrl]: dto({ file: file({ guardianConsent: "PENDING", consentOpen: true }) }),
      [`POST ${C}/orientation-files/${FILE}/consent`]: () => json({ id: FILE, institutionId: uuid(1), academicYearId: IDS.year, enrollmentId: uuid(3), studentId: IDS.student, studentName: null, currentProgramId: uuid(4), currentGradeLevelId: uuid(5), status: "WISHES_COLLECTED", guardianConsent: "GIVEN", consentRecordedAt: AT, decisionId: null, notes: null, wishes: [], createdAt: AT }),
    });
    renderWithProviders(<FamilyOrientation mode="guardian" studentId={IDS.student} />);
    expect(await screen.findByText(/exige l'accord de la famille/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Donner mon accord" }));
    const dialog = await screen.findByRole("dialog", { name: "Accord de la famille" });
    expect(posts(api, "/consent")).toHaveLength(0); // rien n'est envoyé avant la confirmation
    fireEvent.click(within(dialog).getByRole("button", { name: "Donner mon accord" }));
    await waitFor(() => expect(posts(api, "/consent")).toHaveLength(1));
    expect(posts(api, "/consent")[0]!.body).toEqual({ state: "GIVEN" });
    expect(await screen.findByText("Votre réponse est enregistrée.")).toBeTruthy();
  });

  it("accord déjà donné : daté, pas de bouton si l'API ne l'ouvre plus ; dossier clos : vœux fermés", async () => {
    setTestApi({ ...accessRoutes(["council.child.read"]), [childUrl]: dto({ file: file({ stage: "APPLIED", guardianConsent: "GIVEN", consentRecordedAt: AT, consentOpen: false, wishesOpen: false }) }) });
    renderWithProviders(<FamilyOrientation mode="guardian" studentId={IDS.student} />);
    expect(await screen.findByText(/Accord enregistré le/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Refuser" })).toBeNull();
    expect(screen.getByText("Les vœux ne peuvent plus être modifiés pour ce dossier.")).toBeTruthy();
    expect(screen.getByText("Décision appliquée", { selector: "span" })).toBeTruthy();
  });

  it("aucune destination configurée : explication, pas de formulaire", async () => {
    setTestApi({ ...accessRoutes(["council.child.read"]), [childUrl]: dto({ options: [] }) });
    renderWithProviders(<FamilyOrientation mode="guardian" studentId={IDS.student} />);
    expect(await screen.findByText(/pas encore indiqué de destinations/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Enregistrer le vœu" })).toBeNull();
  });

  it("aucun dossier : état vide ; hors lien (404) ou fonction non incluse (403) : la rubrique disparaît", async () => {
    setTestApi({ ...accessRoutes(["council.child.read"]), [childUrl]: dto({ file: null, options: [] }) });
    const first = renderWithProviders(<FamilyOrientation mode="guardian" studentId={IDS.student} />);
    expect(await screen.findByText("Aucun dossier d'orientation")).toBeTruthy();
    first.unmount();

    setTestApi({ ...accessRoutes(["council.child.read"]), [childUrl]: () => json({ status: 404, code: "councils.not_found", kind: "NOT_FOUND", message: "Introuvable." }, { status: 404 }) });
    const second = renderWithProviders(<FamilyOrientation mode="guardian" studentId={IDS.student} />);
    await waitFor(() => expect(screen.queryByRole("heading", { name: "Orientation" })).toBeNull());
    second.unmount();

    setTestApi({ ...accessRoutes(["council.child.read"]), [childUrl]: () => json({ status: 403, code: "FEATURE_DISABLED", kind: "FORBIDDEN", message: "Fonction non incluse." }, { status: 403 }) });
    renderWithProviders(<FamilyOrientation mode="guardian" studentId={IDS.student} />);
    await waitFor(() => expect(screen.queryByRole("heading", { name: "Orientation" })).toBeNull());
  });
});

describe("FamilyOrientation : élève (lecture seule)", () => {
  it("affiche l'état et les vœux, sans formulaire ni bouton d'accord, avec la mention de lecture seule", async () => {
    setTestApi({ ...accessRoutes(["council.self.read"]), [`GET ${C}/me/orientation`]: dto({ options: [], file: file({ wishesOpen: false, consentOpen: false, guardianConsent: "PENDING", wishes: [wish({ source: "STUDENT", comment: "Mon vœu" })] }) }) });
    renderWithProviders(<FamilyOrientation mode="student" studentId={null} />);
    expect(await screen.findByText(/Vœu n° 1/)).toBeTruthy();
    expect(screen.getByText("Exprimé par l'élève")).toBeTruthy();
    expect(screen.getByText(/Lecture seule/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Enregistrer le vœu" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Donner mon accord" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Refuser" })).toBeNull();
  });
});

describe("PortalScreen : l'orientation s'ajoute sous les décisions", () => {
  it("famille : section Orientation sous les décisions de l'enfant sélectionné", async () => {
    setTestApi({
      ...accessRoutes(["council.child.read"]),
      "GET /api/v1/schoollife/me/children": { items: [{ studentId: IDS.student, studentName: "KOUASSI Awa" }] },
      [`GET ${C}/children/${IDS.student}/decisions`]: { studentId: IDS.student, studentName: "KOUASSI Awa", items: [] },
      [childUrl]: dto(),
    });
    renderWithProviders(<PortalScreen mode="guardian" />);
    expect(await screen.findByText("Aucune décision à afficher")).toBeTruthy();
    expect(await screen.findByRole("heading", { name: "Orientation" })).toBeTruthy();
    expect(await screen.findByText(/Vœu n° 1/)).toBeTruthy();
  });
});

describe("FamilyOrientation : accessibilité et libellés", () => {
  it("aucune violation axe : formulaire de vœux, accord en attente, liste des vœux", async () => {
    setTestApi({ ...accessRoutes(["council.child.read"]), [childUrl]: dto({ file: file({ guardianConsent: "PENDING", consentOpen: true }) }) });
    const { container } = renderWithProviders(<FamilyOrientation mode="guardian" studentId={IDS.student} />);
    await screen.findByText(/Vœu n° 1/);
    await expectNoBlockingViolations(container);
  });

  it("aucune violation axe : fenêtre de confirmation de l'accord", async () => {
    setTestApi({ ...accessRoutes(["council.child.read"]), [childUrl]: dto({ file: file({ guardianConsent: "PENDING", consentOpen: true }) }) });
    renderWithProviders(<FamilyOrientation mode="guardian" studentId={IDS.student} />);
    fireEvent.click(await screen.findByRole("button", { name: "Refuser" }));
    await screen.findByRole("dialog", { name: "Accord de la famille" });
    await expectNoBlockingViolations(document.body);
  });

  it("chaque état, accord et origine de vœu affichables a son libellé français", () => {
    const ns = (catalog as unknown as { v2CouncilsFamily: Record<string, Record<string, string>> }).v2CouncilsFamily;
    for (const stage of ["OPEN", "WISHES_COLLECTED", "DECIDED", "APPLIED", "CLOSED", "CANCELLED"]) {
      expect(ns.stage![stage], stage).toBeTruthy();
      expect(ns.stageHint![stage], stage).toBeTruthy();
    }
    for (const state of COUNCIL_CONSENT_STATES) {
      expect(ns.consent![state], state).toBeTruthy();
      expect(ns.consentHint![state], state).toBeTruthy();
    }
    expect(ns.source!.GUARDIAN).toBeTruthy();
    expect(ns.source!.STUDENT).toBeTruthy();
  });
});
