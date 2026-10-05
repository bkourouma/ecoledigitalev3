// @vitest-environment jsdom
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { accessRoutes, setTestApi } from "@/platform/test/api-mock";
import { json, renderWithProviders } from "@/platform/test/render";
import { IDS, candidate, page, session, sessionDetail, uuid } from "../_test/fixtures";
import { CandidateDetailScreen } from "./CandidateDetailScreen";
import { CandidatesScreen } from "./CandidatesScreen";
import { parseExternalCsv } from "./external-csv";

const nav = vi.hoisted(() => ({ search: "", path: "/v2/examinations", push: vi.fn(), replace: vi.fn() }));
vi.mock("next/navigation", () => ({
  usePathname: () => nav.path,
  useRouter: () => ({ push: nav.push, replace: nav.replace }),
  useSearchParams: () => new URLSearchParams(nav.search),
}));
vi.mock("@/platform/api/default-client", async () => (await import("@/platform/test/api-mock")).defaultClientModule);

const E = "/api/v1/examinations";
const S = `${E}/sessions/${IDS.session}`;

beforeEach(() => {
  nav.search = `session=${IDS.session}`;
});
afterEach(() => vi.restoreAllMocks());

const free = (extra: Record<string, unknown> = {}) =>
  candidate(1, { studentId: null, enrollmentId: null, gradeLevelCode: null, candidateKind: "EXTERNAL", anonymized: false, lastName: "LIBRE", firstName: "Premier", displayName: "LIBRE Premier", ...extra });

describe("parseExternalCsv", () => {
  const header = "nom;prenoms;naissance;sexe;telephone;classe_examen;tentatives;piece_type;piece_numero";
  it("accepte un fichier valide (séparateur ; ou ,) et normalise les valeurs", () => {
    const out = parseExternalCsv(`${header}\nLIBRE;Premier;2015-03-04;f;+2250700000001;Oui;1;cni;CNI-1\n`);
    expect(out.missingHeaders).toEqual([]);
    expect(out.rows).toHaveLength(1);
    expect(out.rows[0]?.value).toEqual({
      identity: { lastName: "LIBRE", firstName: "Premier", birthDate: "2015-03-04", birthPlace: null, sex: "F" },
      profile: expect.objectContaining({ contactPhone: "+2250700000001", declaredInExamGrade: true, declaredPriorAttempts: 1, idPieceKind: "CNI", idPieceNumber: "CNI-1" }),
    });
    expect(parseExternalCsv(header.replace(/;/g, ",") + "\nA,B,2015-01-01,M,0700,non,0,,\n").rows[0]?.value?.profile.declaredInExamGrade).toBe(false);
  });
  it("signale ligne par ligne ce qui manque ou est invalide, sans rien inventer", () => {
    const out = parseExternalCsv(`${header}\n;X;2015-03-04;F;1;oui;0;;\nA;B;04/03/2015;F;1;oui;0;;\nA;B;2015-03-04;X;1;oui;0;;\nA;B;2015-03-04;F;;oui;0;;\nA;B;2015-03-04;F;1;peut-etre;0;;\n`);
    expect(out.rows.map((r) => [r.line, r.error, r.field])).toEqual([[2, "MISSING_FIELD", "nom"], [3, "BAD_DATE", "naissance"], [4, "BAD_SEX", "sexe"], [5, "NO_CONTACT", "telephone"], [6, "BAD_BOOLEAN", "classe_examen"]]);
  });
  it("refuse un fichier sans les colonnes obligatoires", () => {
    expect(parseExternalCsv("nom;prenoms\nA;B\n").missingHeaders).toEqual(["naissance", "sexe", "classe_examen"]);
  });
});

describe("Candidats libres : liste et saisie", () => {
  const routes = (permissions: string[], extra: Record<string, unknown> = {}) => ({
    ...accessRoutes(permissions),
    [`GET ${E}/sessions`]: page([session()]),
    [`GET ${S}`]: sessionDetail(),
    [`GET ${S}/candidates`]: page([candidate(1), free({ id: uuid(777), displayName: "LIBRE Premier" })]),
    ...extra,
  });

  it("signale un candidat libre dans la liste ; sans la permission de saisie, aucun formulaire", async () => {
    setTestApi(routes(["exam.session.read", "exam.candidate.read"]));
    renderWithProviders(<CandidatesScreen />);
    expect(await screen.findByText("LIBRE Premier")).toBeTruthy();
    expect(screen.getAllByText("Candidat libre").length).toBeGreaterThan(0);
    expect(screen.queryByRole("button", { name: "Saisir un candidat libre" })).toBeNull();
  });

  it("saisie : validations avant envoi (contact, pièce), puis corps exact conforme au contrat", async () => {
    const api = setTestApi(routes(["exam.session.read", "exam.candidate.read", "exam.external.manage"], { [`POST ${S}/external-candidates`]: () => json(free(), { status: 201 }) }));
    renderWithProviders(<CandidatesScreen />);
    fireEvent.click(await screen.findByRole("button", { name: "Saisir un candidat libre" }));
    fireEvent.click(await screen.findByRole("button", { name: "Enregistrer le candidat" }));
    expect((await screen.findAllByRole("alert")).length).toBeGreaterThan(0);
    expect(api.calls.filter((c) => c.method === "POST")).toHaveLength(0);
    fireEvent.change(screen.getByLabelText(/^Nom\*/), { target: { value: "LIBRE" } });
    fireEvent.change(screen.getByLabelText(/^Prénoms/), { target: { value: "Premier" } });
    fireEvent.change(screen.getByLabelText(/^Date de naissance/), { target: { value: "2015-03-04" } });
    fireEvent.change(screen.getByLabelText(/^Sexe/), { target: { value: "M" } });
    fireEvent.change(screen.getByLabelText(/^Type de pièce/), { target: { value: "cni" } });
    fireEvent.click(screen.getByRole("button", { name: "Enregistrer le candidat" }));
    expect(await screen.findByText("Indiquer au moins un téléphone ou une adresse e-mail (candidat ou tuteur).")).toBeTruthy();
    expect(screen.getByText("Le type et le numéro de la pièce vont ensemble.")).toBeTruthy();
    expect(api.calls.filter((c) => c.method === "POST")).toHaveLength(0);
    fireEvent.change(screen.getByLabelText(/^Téléphone$/), { target: { value: "+2250700000001" } });
    fireEvent.change(screen.getByLabelText(/^Numéro de la pièce/), { target: { value: "CNI-1" } });
    fireEvent.click(screen.getByLabelText("Le candidat est dans la classe de l'examen"));
    fireEvent.click(screen.getByRole("button", { name: "Enregistrer le candidat" }));
    await waitFor(() => expect(api.calls.filter((c) => c.method === "POST")).toHaveLength(1));
    expect(api.calls.find((c) => c.method === "POST")!.body).toEqual({
      identity: { lastName: "LIBRE", firstName: "Premier", birthDate: "2015-03-04", birthPlace: null, sex: "M" },
      profile: {
        contactPhone: "+2250700000001", contactEmail: null, addressLine: null, idPieceKind: "CNI", idPieceNumber: "CNI-1", guardianName: null, guardianRelation: null, guardianPhone: null,
        guardianEmail: null, declaredInExamGrade: true, declaredPriorAttempts: 0,
      },
    });
  });

  it("session blanche : le panneau explique que les libres ne concernent que les sessions officielles", async () => {
    setTestApi(routes(["exam.session.read", "exam.candidate.read", "exam.external.manage"], { [`GET ${S}`]: sessionDetail({ sessionKind: "MOCK" }) }));
    renderWithProviders(<CandidatesScreen />);
    expect(await screen.findByText("Les candidats libres ne concernent que les sessions officielles.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Saisir un candidat libre" })).toBeNull();
  });
});

describe("Dossier d'un candidat libre", () => {
  const profile = (extra: Record<string, unknown> = {}) => ({
    candidateId: IDS.c1, contactPhone: "+2250700000001", contactEmail: null, addressLine: null, idPieceKind: "CNI", idPieceNumber: "******-1", guardianName: "Tuteur Fictif", guardianRelation: "oncle",
    guardianPhone: null, guardianEmail: null, declaredInExamGrade: true, declaredPriorAttempts: 0, dataSource: "ENTERED", anonymizedAt: null, ...extra,
  });
  const detail = (extra: Record<string, unknown> = {}) => ({
    candidate: free(),
    eligibilityChecks: [],
    pieces: [{ requirementId: uuid(600), code: "ACTE_NAISSANCE", label: "Acte de naissance", required: true, status: "MISSING", documentRef: null, presentationKind: "DOCUMENT", sightedNote: null, rejectionReason: null, reviewedAt: null }],
    identifiers: [], assignment: null, history: [], scores: [], result: null, documents: [], ...extra,
  });
  const routes = (permissions: string[], extra: Record<string, unknown> = {}) => ({
    ...accessRoutes(permissions),
    [`GET ${E}/candidates/${IDS.c1}`]: detail(),
    [`GET ${S}`]: sessionDetail(),
    ...extra,
  });

  it("sans permission de lecture restreinte, la fiche n'appelle jamais le profil", async () => {
    const api = setTestApi(routes(["exam.candidate.read"]));
    renderWithProviders(<CandidateDetailScreen id={IDS.c1} />);
    expect(await screen.findByText("LIBRE Premier")).toBeTruthy();
    expect(screen.getAllByText("Candidat libre").length).toBeGreaterThan(0);
    expect(screen.queryByText("Données personnelles restreintes")).toBeNull();
    expect(api.calls.some((c) => c.path.includes("external-profile"))).toBe(false);
  });

  it("avec la permission : profil masqué ; l'affichage complet du numéro est une demande expresse", async () => {
    const api = setTestApi(routes(["exam.candidate.read", "exam.external.read"], { [`GET ${E}/candidates/${IDS.c1}/external-profile`]: () => json(profile()) }));
    renderWithProviders(<CandidateDetailScreen id={IDS.c1} />);
    expect(await screen.findByText("******-1")).toBeTruthy();
    expect(screen.getByText("Tuteur Fictif")).toBeTruthy();
    expect(api.calls.find((c) => c.path.endsWith("/external-profile"))!.query).toMatchObject({ reveal: "false" });
    fireEvent.click(screen.getByRole("button", { name: "Afficher le numéro de pièce en entier" }));
    await waitFor(() => expect(api.calls.some((c) => c.path.endsWith("/external-profile") && c.query?.reveal === "true")).toBe(true));
  });

  it("pièce : « vue sur place » (action SIGHT) à la place du dépôt de document", async () => {
    const api = setTestApi(routes(["exam.candidate.read", "exam.candidate.manage"], { [`PUT ${E}/candidates/${IDS.c1}/documents/${uuid(600)}`]: () => json({ pieces: [], missing: [] }) }));
    renderWithProviders(<CandidateDetailScreen id={IDS.c1} />);
    expect(screen.queryByRole("button", { name: "Joindre un document" })).toBeNull();
    fireEvent.click(await screen.findByRole("button", { name: "Pièce vue sur place" }));
    await waitFor(() => expect(api.calls.some((c) => c.method === "PUT")).toBe(true));
    expect(api.calls.find((c) => c.method === "PUT")!.body).toEqual({ action: "SIGHT" });
  });

  it("anonymisation : motif d'au moins 10 caractères, corps exact ; bouton absent sans la permission sensible", async () => {
    const without = setTestApi(routes(["exam.candidate.read"]));
    const first = renderWithProviders(<CandidateDetailScreen id={IDS.c1} />);
    await screen.findByText("LIBRE Premier");
    expect(screen.queryByRole("button", { name: "Anonymiser le candidat" })).toBeNull();
    expect(without.calls.filter((c) => c.method === "POST")).toHaveLength(0);
    first.unmount();

    const api = setTestApi(routes(["exam.candidate.read", "exam.external.anonymize"], { [`POST ${E}/candidates/${IDS.c1}/anonymize`]: () => json(free({ anonymized: true, lastName: "ANONYME", firstName: "ANONYME", displayName: "ANONYME ANONYME" })) }));
    renderWithProviders(<CandidateDetailScreen id={IDS.c1} />);
    fireEvent.click(await screen.findByRole("button", { name: "Anonymiser le candidat" }));
    fireEvent.change(await screen.findByLabelText(/^Motif/), { target: { value: "court" } });
    fireEvent.click(screen.getByRole("button", { name: "Anonymiser" }));
    expect(api.calls.filter((c) => c.method === "POST")).toHaveLength(0);
    fireEvent.change(screen.getByLabelText(/^Motif/), { target: { value: "Demande écrite de la personne" } });
    fireEvent.click(screen.getByRole("button", { name: "Anonymiser" }));
    await waitFor(() => expect(api.calls.filter((c) => c.method === "POST")).toHaveLength(1));
    expect(api.calls.find((c) => c.method === "POST")!.body).toEqual({ reason: "Demande écrite de la personne" });
  });
});
