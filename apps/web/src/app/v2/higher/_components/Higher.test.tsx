// @vitest-environment jsdom
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { accessRoutes, setTestApi } from "@/platform/test/api-mock";
import { json, renderWithProviders } from "@/platform/test/render";
import { classroom, node, period, program, version, year } from "../../_test/fixtures";
import { STUDENTS } from "../../assessments/_test/fixtures";
import { NOW, award, candidate, diploma, diplomaDetail, document, ledgerEntry, registration, resitWindow, studentDetail, uuid } from "../_test/fixtures";
import { AttestationsScreen } from "./AttestationsScreen";
import { CreditsScreen } from "./CreditsScreen";
import { DiplomaDetail } from "./DiplomaDetail";
import { DiplomasScreen } from "./DiplomasScreen";
import { DocumentsScreen } from "./DocumentsScreen";
import { ResitScreen } from "./ResitScreen";
import { SlotsScreen } from "./SlotsScreen";

vi.mock("@/platform/api/default-client", async () => (await import("@/platform/test/api-mock")).defaultClientModule);

const H = "/api/v1/higher";
const D = uuid(8000);
const C = uuid(500);
const P = uuid(200);

describe("DiplomasScreen", () => {
  it("liste les diplômes et crée un diplôme depuis un cycle du curriculum (corps validé par le contrat)", async () => {
    const api = setTestApi({
      ...accessRoutes(["higher.diploma.read", "higher.diploma.manage"], ["higher.diplomas"]),
      [`GET ${H}/diplomas`]: { items: [diploma()] },
      "GET /api/v1/academic/programs": { items: [program()] },
      "GET /api/v1/academic/years": { items: [year()] },
      "GET /api/v1/academic/curriculum-versions": { items: [version({ id: uuid(700), status: "PUBLISHED" })] },
      [`GET /api/v1/academic/curriculum-versions/${uuid(700)}`]: { version: version({ id: uuid(700), status: "PUBLISHED" }), roots: [node({ id: uuid(8100), nodeTypeCode: "CYCLE", code: "L", label: "Licence", children: [node({ id: uuid(8101), code: "UE1", label: "Unité 1", parentId: uuid(8100) })] })] },
      [`POST ${H}/diplomas/from-curriculum`]: () => json(diplomaDetail(), { status: 201 }),
    });
    renderWithProviders(<DiplomasScreen />);
    const table = await screen.findByRole("table", { name: "Diplômes" });
    expect(await within(table).findByText("Licence Informatique")).toBeTruthy();
    expect(within(table).getByText("180")).toBeTruthy();
    fireEvent.click(await screen.findByRole("button", { name: "Nouveau diplôme" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Créer le diplôme" }));
    await waitFor(() => expect(within(dialog).getAllByRole("alert").length).toBeGreaterThan(0));
    expect(api.calls.filter((c) => c.method === "POST")).toHaveLength(0);
    await within(dialog).findByRole("option", { name: /Licence Informatique/ });
    fireEvent.change(within(dialog).getByLabelText("Programme"), { target: { value: uuid(300) } });
    fireEvent.change(within(dialog).getByLabelText("Année académique"), { target: { value: uuid(100) } });
    await within(dialog).findByRole("option", { name: /L — Licence/ });
    fireEvent.change(within(dialog).getByLabelText(/Nœud du curriculum/), { target: { value: uuid(8100) } });
    fireEvent.change(within(dialog).getByLabelText(/Code du grade/), { target: { value: "licence" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Créer le diplôme" }));
    await screen.findByText("Le diplôme Licence Informatique est créé.");
    expect(api.calls.find((c) => c.method === "POST")!.body).toEqual({ curriculumNodeId: uuid(8100), gradeCode: "LICENCE" });
  });

  it("état vide et erreur de l'API", async () => {
    setTestApi({ ...accessRoutes(["higher.diploma.read"], ["higher.diplomas"]), [`GET ${H}/diplomas`]: { items: [] } });
    const { unmount } = renderWithProviders(<DiplomasScreen />);
    expect(await screen.findByText("Aucun diplôme.")).toBeTruthy();
    unmount();
    setTestApi({ ...accessRoutes(["higher.diploma.read"], []), [`GET ${H}/diplomas`]: () => json({ code: "entitlements.feature_not_available", message: "Cette option n'est pas incluse dans votre abonnement." }, { status: 403 }) });
    renderWithProviders(<DiplomasScreen />);
    expect((await screen.findByRole("alert")).textContent).toContain("Cette option n'est pas incluse dans votre abonnement.");
  });
});

describe("DiplomaDetail — exigences, éligibilité, octroi, révocation", () => {
  const routes = (perms: string[], extra: Record<string, unknown> = {}) => ({
    ...accessRoutes(perms, ["higher.diplomas"]),
    [`GET ${H}/diplomas/${D}`]: diplomaDetail(),
    [`GET ${H}/diplomas/${D}/candidates`]: { items: [candidate(1), candidate(2, { eligible: false, uvValidated: 120, percent: 66, missingMandatory: 2 }), candidate(3, { eligible: false, awardStatus: "REVOKED", awardReference: "DIP-2025-001", revokeReason: "Fraude avérée" })] },
    ...extra,
  });

  it("exigences : UE obligatoires, au choix, retirée du curriculum ; synchronisation avec rapport", async () => {
    const api = setTestApi(routes(["higher.diploma.read", "higher.diploma.manage"], { [`POST ${H}/diplomas/${D}/sync`]: () => json({ added: [], removed: [{ ueNodeId: uuid(8302), code: "UE2", label: "Unité 2" }], updated: 1, unchanged: 0, suggestedUvRequired: 174 }) }));
    renderWithProviders(<DiplomaDetail id={D} />);
    expect(await screen.findByText("Unité 1")).toBeTruthy();
    expect(screen.getByText("Retirée du curriculum")).toBeTruthy();
    expect(screen.getByText("Au choix")).toBeTruthy();
    fireEvent.click(await screen.findByRole("button", { name: "Synchroniser avec le curriculum" }));
    await screen.findByText("Exigences synchronisées : 0 ajoutées, 1 retirées, 1 mises à jour.");
    expect(api.calls.some((c) => c.method === "POST" && c.path.endsWith("/sync"))).toBe(true);
  });

  it("octroi d'un candidat éligible : corps minimal, jamais de seuil côté web", async () => {
    const api = setTestApi(routes(["higher.diploma.read", "higher.award.create"], { [`POST ${H}/diplomas/${D}/awards`]: () => json({ award: award(1) }, { status: 201 }) }));
    renderWithProviders(<DiplomaDetail id={D} />);
    fireEvent.click(await screen.findByRole("tab", { name: "Candidats" }));
    fireEvent.click(await screen.findByRole("button", { name: "Octroyer le diplôme à Aka Marie" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("L'étudiant est éligible : l'octroi sera enregistré.")).toBeTruthy();
    fireEvent.click(within(dialog).getByRole("button", { name: "Octroyer" }));
    await screen.findByText("Diplôme octroyé à Aka Marie (DIP-2026-001).");
    expect(api.calls.find((c) => c.method === "POST")!.body).toEqual({ studentId: uuid(3001) });
    // un candidat non éligible n'offre pas d'octroi sans droit de forcer
    expect(screen.queryByRole("button", { name: "Octroi forcé du diplôme à Bamba Yao" })).toBeNull();
  });

  it("octroi forcé : droit sensible et motif de 20 caractères exigés avant l'envoi", async () => {
    const api = setTestApi(routes(["higher.diploma.read", "higher.award.create", "higher.award.force"], { [`POST ${H}/diplomas/${D}/awards`]: () => json({ award: award(2, { awardedVia: "FORCED", forcedReason: "Décision du conseil scientifique du 30 septembre" }) }, { status: 201 }) }));
    renderWithProviders(<DiplomaDetail id={D} />);
    fireEvent.click(await screen.findByRole("tab", { name: "Candidats" }));
    fireEvent.click(await screen.findByRole("button", { name: "Octroi forcé du diplôme à Bamba Yao" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText(/n'est pas éligible selon la règle/)).toBeTruthy();
    fireEvent.change(within(dialog).getByLabelText(/Motif de l'octroi forcé/), { target: { value: "trop court" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Octroyer de force" }));
    await waitFor(() => expect(within(dialog).getAllByRole("alert").length).toBeGreaterThan(0));
    expect(api.calls.filter((c) => c.method === "POST")).toHaveLength(0);
    fireEvent.change(within(dialog).getByLabelText(/Motif de l'octroi forcé/), { target: { value: "Décision du conseil scientifique du 30 septembre" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Octroyer de force" }));
    await screen.findByText(/Diplôme octroyé à Bamba Yao/);
    expect(api.calls.find((c) => c.method === "POST")!.body).toEqual({ studentId: uuid(3002), force: true, reason: "Décision du conseil scientifique du 30 septembre" });
  });

  it("ré-octroi d'un diplôme révoqué : décision écrite de 20 caractères (en plus du forçage si non éligible)", async () => {
    const api = setTestApi(routes(["higher.diploma.read", "higher.award.create", "higher.award.force"], { [`POST ${H}/diplomas/${D}/awards`]: () => json({ award: award(3) }, { status: 201 }) }));
    renderWithProviders(<DiplomaDetail id={D} />);
    fireEvent.click(await screen.findByRole("tab", { name: "Candidats" }));
    expect(await screen.findByText("Diplôme révoqué : Fraude avérée")).toBeTruthy();
    fireEvent.click(await screen.findByRole("button", { name: "Ré-octroyer le diplôme à Coulibaly Awa" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText(/Motif de l'octroi forcé/), { target: { value: "Réintégration après recours gracieux accepté" } });
    fireEvent.change(within(dialog).getByLabelText(/Décision écrite du directeur général/), { target: { value: "court" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Ré-octroyer" }));
    await within(dialog).findByText("La décision doit faire au moins 20 caractères.");
    expect(api.calls.filter((c) => c.method === "POST")).toHaveLength(0);
    fireEvent.change(within(dialog).getByLabelText(/Décision écrite du directeur général/), { target: { value: "Décision DG n° 2026/114 du 2 octobre 2026" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Ré-octroyer" }));
    await screen.findByText(/Diplôme octroyé à Coulibaly Awa/);
    expect(api.calls.find((c) => c.method === "POST")!.body).toEqual({ studentId: uuid(3003), force: true, reason: "Réintégration après recours gracieux accepté", reawardDecision: "Décision DG n° 2026/114 du 2 octobre 2026" });
  });

  it("progression d'un candidat : crédits, UE manquantes, règle appliquée", async () => {
    setTestApi(
      routes(["higher.diploma.read"], {
        [`GET ${H}/diplomas/${D}/students/${uuid(3002)}/progress`]: {
          diploma: diploma(),
          progress: { uvValidated: 120, uvRequired: 180, percent: 66, validated: [], remaining: [], missingMandatory: [{ ueNodeId: uuid(8301), code: "UE1", label: "Unité 1", credits: 6, mandatory: true, validated: false, ledgerId: null, removedFromCurriculum: false }] },
          eligibility: { eligible: false, rule: { ruleSetCode: "CI-HIGHER-LMD", ruleVersionId: uuid(6100), versionNo: 1, definitionHash: "a".repeat(64) } },
          award: null,
        },
      }),
    );
    renderWithProviders(<DiplomaDetail id={D} />);
    fireEvent.click(await screen.findByRole("tab", { name: "Candidats" }));
    fireEvent.click(await screen.findByRole("button", { name: "Progression de Bamba Yao" }));
    const dialog = await screen.findByRole("dialog");
    expect(await within(dialog).findByText("120 UV validées sur 180 (66 %).")).toBeTruthy();
    expect(within(dialog).getByText("Non éligible.")).toBeTruthy();
    expect(within(dialog).getByText(/Règle CI-HIGHER-LMD, version 1/)).toBeTruthy();
    expect(within(dialog).getByText("UE obligatoires manquantes (1)")).toBeTruthy();
  });

  it("octrois : octroi forcé signalé avec son motif, émission du diplôme et du duplicata, révocation motivée", async () => {
    const api = setTestApi(
      routes(["higher.diploma.read", "higher.award.read", "higher.document.issue", "higher.award.revoke"], {
        [`GET ${H}/diplomas/${D}/awarded`]: { items: [award(1), award(2, { awardedVia: "FORCED", forcedReason: "Décision du conseil scientifique", status: "REVOKED", revokedAt: NOW, revokedByName: "M. Diallo", revokeReason: "Fraude avérée" })], nextCursor: null },
        [`POST ${H}/awards/${uuid(8401)}/documents`]: () => json({ document: { ...document(1), snapshot: {} }, created: true }, { status: 201 }),
        [`POST ${H}/awards/${uuid(8401)}/revoke`]: () => json({ award: award(1, { status: "REVOKED" }) }),
      }),
    );
    renderWithProviders(<DiplomaDetail id={D} />);
    fireEvent.click(await screen.findByRole("tab", { name: "Octrois" }));
    expect(await screen.findByText("DIP-2026-001")).toBeTruthy();
    expect(screen.getByText("Octroi forcé : Décision du conseil scientifique")).toBeTruthy();
    expect(screen.getByText(/Révoqué par M\. Diallo/)).toBeTruthy();
    // valeurs de l'API, telles quelles : moyenne exacte du cycle et code de mention
    expect(screen.getAllByText("13,4999").length).toBeGreaterThan(0);
    fireEvent.click(await screen.findByRole("button", { name: "Émettre le diplôme de Aka Marie" }));
    await screen.findByText("Document émis : DOC-2026-001.");
    fireEvent.click(screen.getByRole("button", { name: "Émettre un duplicata du diplôme de Aka Marie" }));
    await waitFor(() => expect(api.calls.filter((c) => c.path.endsWith("/documents"))).toHaveLength(2));
    expect(api.calls.filter((c) => c.path.endsWith("/documents")).map((c) => c.body)).toEqual([{ kind: "DIPLOMA" }, { kind: "DIPLOMA", duplicate: true }]);
    fireEvent.click(screen.getByRole("button", { name: "Révoquer le diplôme de Aka Marie" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText(/Motif/), { target: { value: "court" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Révoquer" }));
    expect(api.calls.filter((c) => c.path.endsWith("/revoke"))).toHaveLength(0);
    fireEvent.change(within(dialog).getByLabelText(/Motif/), { target: { value: "Diplôme délivré par erreur" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Révoquer" }));
    await screen.findByText("Le diplôme est révoqué.");
    expect(api.calls.find((c) => c.path.endsWith("/revoke"))!.body).toEqual({ reason: "Diplôme délivré par erreur" });
  });

  it("réévaluation des candidats : rapport de la règle", async () => {
    setTestApi(routes(["higher.diploma.read", "higher.award.create"], { [`POST ${H}/diplomas/${D}/recompute`]: () => json({ evaluated: 3, awarded: 1, skipped: { not_eligible: 2 }, failed: 0 }) }));
    renderWithProviders(<DiplomaDetail id={D} />);
    fireEvent.click(await screen.findByRole("tab", { name: "Candidats" }));
    fireEvent.click(await screen.findByRole("button", { name: "Réévaluer les candidats" }));
    await screen.findByText("Recalcul terminé : 3 évalués, 1 octroyés, 0 en échec.");
  });
});

describe("DocumentsScreen", () => {
  it("publie un document émis, le révoque avec motif ; détail avec code de vérification et lien public", async () => {
    const api = setTestApi({
      ...accessRoutes(["higher.document.read", "higher.document.issue", "higher.award.revoke"], ["higher.diplomas"]),
      [`GET ${H}/documents`]: { items: [document(1), document(2, { status: "REVOKED", revokedAt: NOW, revokeReason: "Erreur", sealed: false })], nextCursor: null },
      [`GET /api/v1/people/students/${uuid(3001)}`]: studentDetail(1, "Aka Marie"),
      [`POST ${H}/documents/${uuid(8501)}/publish`]: () => json(document(1, { publishedAt: NOW })),
      [`POST ${H}/documents/${uuid(8501)}/revoke`]: () => json(document(1, { status: "REVOKED" })),
      [`GET ${H}/documents/${uuid(8501)}`]: { ...document(1), snapshot: { title: "Diplôme de Licence" } },
    });
    renderWithProviders(<DocumentsScreen />);
    const table = await screen.findByRole("table", { name: "Documents officiels" });
    expect(await within(table).findAllByText("Aka Marie")).toBeTruthy();
    expect(within(table).getAllByText("Non publié").length).toBe(2); // les deux documents (dont le révoqué) ne sont pas publiés
    fireEvent.click(await screen.findByRole("button", { name: "Publier le document DOC-2026-001" }));
    await screen.findByText("Le document DOC-2026-001 est publié.");
    fireEvent.click(screen.getByRole("button", { name: "Détail du document DOC-2026-001" }));
    const detail = await screen.findByRole("dialog");
    expect(await within(detail).findByText("ABCDEFGHIJKLMNOPQRSTUVWXYZ")).toBeTruthy();
    expect(within(detail).getByRole("link", { name: "Ouvrir la page de vérification" }).getAttribute("href")).toBe("/v2/verify/ABCDEFGHIJKLMNOPQRSTUVWXYZ");
    fireEvent.click(within(detail).getByRole("button", { name: "Fermer" }));
    fireEvent.click(await screen.findByRole("button", { name: "Révoquer le document DOC-2026-001" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText(/Motif/), { target: { value: "Document émis par erreur" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Révoquer" }));
    await screen.findByText("Le document DOC-2026-001 est révoqué.");
    expect(api.calls.find((c) => c.path.endsWith("/revoke"))!.body).toEqual({ reason: "Document émis par erreur" });
  });

  it("sans droit d'émission ni de révocation : consultation seule ; état vide", async () => {
    setTestApi({ ...accessRoutes(["higher.document.read"], ["higher.diplomas"]), [`GET ${H}/documents`]: { items: [document(1)], nextCursor: null }, [`GET /api/v1/people/students/${uuid(3001)}`]: studentDetail(1, "Aka Marie") });
    const { unmount } = renderWithProviders(<DocumentsScreen />);
    await screen.findByRole("button", { name: "Détail du document DOC-2026-001" });
    expect(screen.queryByRole("button", { name: /Publier|Révoquer/ })).toBeNull();
    unmount();
    setTestApi({ ...accessRoutes(["higher.document.read"], ["higher.diplomas"]), [`GET ${H}/documents`]: { items: [], nextCursor: null } });
    renderWithProviders(<DocumentsScreen />);
    expect(await screen.findByText("Aucun document.")).toBeTruthy();
  });
});

describe("AttestationsScreen", () => {
  it("liste l'éligibilité décidée par la règle et émet l'attestation d'un étudiant éligible", async () => {
    const api = setTestApi({
      ...accessRoutes(["higher.diploma.read", "higher.document.issue"], ["higher.attestations"]),
      "GET /api/v1/academic/programs": { items: [program()] },
      "GET /api/v1/academic/years": { items: [year()] },
      "GET /api/v1/academic/curriculum-versions": { items: [version({ id: uuid(700), status: "PUBLISHED" })] },
      [`GET /api/v1/academic/curriculum-versions/${uuid(700)}`]: { version: version({ id: uuid(700), status: "PUBLISHED" }), roots: [node({ id: uuid(8100), nodeTypeCode: "PROGRAM", code: "P", label: "Programme L1" })] },
      [`GET ${H}/attestations/roster`]: {
        items: [
          { studentId: uuid(3001), fullName: "Aka Marie", matricule: "ELV-001", classroomId: C, academicYearId: uuid(100), ueAcquired: 10, ueRequired: 10, creditsAcquired: 60, eligible: true, missingUeNodeIds: [], acquiredDate: "2026-07-01", documentId: null, reference: null },
          { studentId: uuid(3002), fullName: "Bamba Yao", matricule: "ELV-002", classroomId: C, academicYearId: uuid(100), ueAcquired: 7, ueRequired: 10, creditsAcquired: 42, eligible: false, missingUeNodeIds: [uuid(1), uuid(2), uuid(3)], acquiredDate: null, documentId: null, reference: null },
        ],
      },
      [`POST ${H}/attestations`]: () => json({ document: { ...document(1, { documentKind: "ATTESTATION_SUCCESS", reference: "ATT-2026-001" }), snapshot: {} }, created: true }, { status: 201 }),
    });
    renderWithProviders(<AttestationsScreen />);
    expect(screen.getByText("Choisissez le programme concerné.")).toBeTruthy();
    await screen.findByRole("option", { name: /Licence Informatique/ });
    fireEvent.change(screen.getByLabelText("Programme"), { target: { value: uuid(300) } });
    fireEvent.change(screen.getByLabelText("Année académique"), { target: { value: uuid(100) } });
    await screen.findByRole("option", { name: /P — Programme L1/ });
    fireEvent.change(screen.getByLabelText(/Nœud du curriculum/), { target: { value: uuid(8100) } });
    const table = await screen.findByRole("table", { name: "Étudiants et éligibilité aux attestations" });
    const bamba = (await within(table).findByRole("rowheader", { name: /Bamba Yao/ })).closest("tr")!;
    expect(within(bamba).getByText("Non éligible")).toBeTruthy();
    expect(within(bamba).getByText("3 UE manquantes")).toBeTruthy();
    expect(within(bamba).queryByRole("button")).toBeNull();
    fireEvent.click(await screen.findByRole("button", { name: "Émettre l'attestation de Aka Marie" }));
    await screen.findByText("Attestation émise pour Aka Marie (ATT-2026-001).");
    expect(api.calls.find((c) => c.method === "POST")!.body).toEqual({ studentId: uuid(3001), programNodeId: uuid(8100) });
  });
});

describe("CreditsScreen", () => {
  it("registre de crédits, dette d'UE ouverte et rattrapage d'un étudiant ; durée de validité modifiable", async () => {
    const api = setTestApi({
      ...accessRoutes(["higher.credits.read", "higher.settings.manage"]),
      "GET /api/v1/people/students": STUDENTS,
      [`GET ${H}/students/${uuid(3001)}/credits`]: {
        summary: { studentId: uuid(3001), totalCredits: 12, acquiredUeCount: 2, byYear: [], byPeriod: [], openDebtCount: 1 },
        entries: [ledgerEntry(1), ledgerEntry(2, { acquiredVia: "RESIT", sessionObtained: 2, validUntil: "2031-09-30" })],
        debts: [{ id: uuid(8650), studentId: uuid(3001), enrollmentId: uuid(2001), ueNodeId: uuid(8303), academicYearId: uuid(100), academicPeriodId: uuid(200), status: "OPEN", detectedAt: NOW, clearedAt: null }],
        nextCursor: null,
      },
      [`GET ${H}/students/${uuid(3001)}/pathway`]: {
        studentId: uuid(3001),
        summary: { studentId: uuid(3001), totalCredits: 12, acquiredUeCount: 2, byYear: [], byPeriod: [], openDebtCount: 1 },
        acquired: [],
        debts: [],
        resits: [{ ...registration(1), opensOn: "2026-11-01", closesOn: "2026-11-15", windowStatus: "OPEN", phase: "TO_RETAKE" }],
        diplomas: { studentId: uuid(3001), awards: [], progress: [] },
      },
      [`GET ${H}/settings`]: { creditValidityMonths: 60 },
      [`PUT ${H}/settings`]: () => json({ creditValidityMonths: 72 }),
    });
    renderWithProviders(<CreditsScreen />);
    expect(screen.getByText("Choisissez un étudiant.")).toBeTruthy();
    fireEvent.focus(screen.getByRole("combobox", { name: /Étudiant/ }));
    fireEvent.click(await screen.findByRole("option", { name: /Aka Marie/ }));
    expect(await screen.findByText("Crédits acquis")).toBeTruthy();
    const ledger = await screen.findByRole("table", { name: "Registre des crédits" });
    expect(within(ledger).getAllByText("Acquise")).toHaveLength(2);
    expect(within(ledger).getByText(/Rattrapage · session 2/)).toBeTruthy();
    expect(screen.getByText("Ouverte")).toBeTruthy();
    expect(await screen.findByText("À repasser")).toBeTruthy();
    // réglage de validité des crédits
    const field = await screen.findByLabelText("Validité des crédits (mois)");
    await waitFor(() => expect((field as HTMLInputElement).value).toBe("60"));
    fireEvent.change(field, { target: { value: "72" } });
    fireEvent.click(screen.getByRole("button", { name: "Enregistrer" }));
    await screen.findByText("Le réglage est enregistré.");
    expect(api.calls.find((c) => c.method === "PUT")!.body).toEqual({ creditValidityMonths: 72 });
  });

  it("erreur d'accès au registre : message de l'API", async () => {
    setTestApi({ ...accessRoutes(["higher.credits.read"]), "GET /api/v1/people/students": STUDENTS, [`GET ${H}/students/${uuid(3001)}/credits`]: () => json({ code: "FORBIDDEN", message: "Action non autorisée." }, { status: 403 }) });
    renderWithProviders(<CreditsScreen />);
    fireEvent.focus(screen.getByRole("combobox", { name: /Étudiant/ }));
    fireEvent.click(await screen.findByRole("option", { name: /Aka Marie/ }));
    expect((await screen.findByRole("alert")).textContent).toContain("Action non autorisée.");
  });
});

describe("ResitScreen — rattrapages", () => {
  const routes = (perms: string[], features: string[], extra: Record<string, unknown> = {}) => ({
    ...accessRoutes(perms, features),
    [`GET /api/v1/academic/classrooms/${C}`]: classroom(),
    "GET /api/v1/academic/classrooms": { items: [classroom()], total: 1, page: 1, pageSize: 200 },
    [`GET /api/v1/academic/years/${uuid(100)}/periods`]: { items: [period()] },
    "GET /api/v1/people/students": STUDENTS,
    [`GET ${H}/resit-windows`]: { items: [resitWindow()], nextCursor: null },
    [`GET ${H}/resit-candidates`]: { stateId: uuid(6000), candidates: [{ enrollmentId: uuid(2002), studentId: uuid(3002), ecueNodeId: uuid(8902), ueNodeId: uuid(8302), session1Average: "8.75" }] },
    ...extra,
  });

  it("candidats désignés par les résultats, fenêtre ouverte, inscrits ; ouverture avec contrôle des dates", async () => {
    const api = setTestApi(
      routes(["higher.resit.manage"], ["higher.session2"], {
        [`GET ${H}/resit-windows/${uuid(8700)}`]: { window: resitWindow(), registrations: [registration(2, { status: "REGISTERED" })] },
        [`POST ${H}/resit-windows`]: () => json({ window: resitWindow({ id: uuid(8701) }), registrations: [registration(2)], alreadyRegistered: 0 }, { status: 201 }),
        [`POST ${H}/resit-windows/${uuid(8700)}/close`]: () => json(resitWindow({ status: "CLOSED" })),
      }),
    );
    renderWithProviders(<ResitScreen initialClassroomId={C} initialPeriodId={P} />);
    expect(await screen.findByText("Bamba Yao")).toBeTruthy();
    expect(screen.getByText("8,75")).toBeTruthy(); // valeur de l'API, virgule d'affichage seulement
    fireEvent.click(await screen.findByRole("button", { name: "Inscrits" }));
    expect(await screen.findByText(/session 1 : 8,75/)).toBeTruthy();
    // ouverture : dates incohérentes refusées par le contrat
    fireEvent.click(screen.getByRole("button", { name: "Ouvrir une fenêtre" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText(/Ouverture/), { target: { value: "2026-12-10" } });
    fireEvent.change(within(dialog).getByLabelText(/Fermeture/), { target: { value: "2026-12-01" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Ouvrir la fenêtre" }));
    expect(await within(dialog).findByText("La fin de la fenêtre précède son début.")).toBeTruthy();
    expect(api.calls.filter((c) => c.method === "POST")).toHaveLength(0);
    fireEvent.change(within(dialog).getByLabelText(/Fermeture/), { target: { value: "2026-12-20" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Ouvrir la fenêtre" }));
    await screen.findByText("Fenêtre ouverte : 1 inscriptions créées, 0 déjà inscrits.");
    expect(api.calls.find((c) => c.method === "POST")!.body).toEqual({ classroomId: C, academicPeriodId: P, opensOn: "2026-12-10", closesOn: "2026-12-20" });
    // clôture
    fireEvent.click(screen.getByRole("button", { name: "Clôturer la fenêtre" }));
    const closeDialog = await screen.findByRole("dialog");
    fireEvent.click(within(closeDialog).getByRole("button", { name: "Clôturer la fenêtre" }));
    await screen.findByText("La fenêtre de rattrapage est clôturée.");
  });

  it("fonction non incluse dans l'offre : message d'offre ; sans droit de gestion : pas d'ouverture", async () => {
    setTestApi(routes(["higher.resit.manage"], []));
    const { unmount } = renderWithProviders(<ResitScreen initialClassroomId={C} initialPeriodId={P} />);
    expect(await screen.findByText("Cette fonctionnalité n'est pas incluse dans votre offre.")).toBeTruthy();
    unmount();
    setTestApi(routes([], ["higher.session2"]));
    renderWithProviders(<ResitScreen initialClassroomId={C} initialPeriodId={P} />);
    await screen.findByText("Bamba Yao");
    expect(screen.queryByRole("button", { name: "Ouvrir une fenêtre" })).toBeNull();
  });
});

describe("SlotsScreen — signataires datés", () => {
  it("affiche l'historique par emplacement et affecte un signataire avec ses dates", async () => {
    const api = setTestApi({
      ...accessRoutes(["higher.slot.manage", "reportcard.signatory.manage"], ["higher.diplomas"]),
      [`GET ${H}/document-slots`]: { items: [{ id: uuid(9000), slotKey: "DIPLOMA_LEFT", signatoryId: uuid(7300), validFrom: "2020-01-01", validTo: null, createdAt: NOW }] },
      "GET /api/v1/reportcards/signatories": { items: [{ id: uuid(7300), institutionId: null, fullName: "M. Konan", title: "Le Directeur", jobFunction: null, signatureObjectKey: null, staffId: null, active: true, validFrom: null, validTo: null, createdAt: NOW, updatedAt: NOW }] },
      [`PUT ${H}/document-slots`]: () => json({ id: uuid(9001), slotKey: "DIPLOMA_RIGHT", signatoryId: uuid(7300), validFrom: "2026-10-01", validTo: null, createdAt: NOW }),
    });
    renderWithProviders(<SlotsScreen />);
    const left = await screen.findByRole("region", { name: "Diplôme — signature de gauche" });
    expect(await within(left).findByText("M. Konan — Le Directeur")).toBeTruthy();
    expect(within(left).getByText("En vigueur")).toBeTruthy();
    fireEvent.click(await screen.findByRole("button", { name: "Affecter un signataire à l'emplacement Diplôme — signature de droite" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Affecter" }));
    await waitFor(() => expect(within(dialog).getAllByRole("alert").length).toBeGreaterThan(0));
    expect(api.calls.filter((c) => c.method === "PUT")).toHaveLength(0);
    await within(dialog).findByRole("option", { name: /M\. Konan/ });
    fireEvent.change(within(dialog).getByLabelText(/^Signataire/), { target: { value: uuid(7300) } });
    fireEvent.change(within(dialog).getByLabelText(/Valide à partir du/), { target: { value: "2026-10-01" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Affecter" }));
    await screen.findByText("Le signataire est affecté.");
    expect(api.calls.find((c) => c.method === "PUT")!.body).toEqual({ slotKey: "DIPLOMA_RIGHT", signatoryId: uuid(7300), validFrom: "2026-10-01" });
  });

  it("noms indisponibles sans le droit sur les signataires : identifiant court et avis", async () => {
    setTestApi({
      ...accessRoutes(["higher.slot.manage"], ["higher.diplomas"]),
      [`GET ${H}/document-slots`]: { items: [{ id: uuid(9000), slotKey: "AUTHENTICITY", signatoryId: uuid(7300), validFrom: "2020-01-01", validTo: "2021-01-01", createdAt: NOW }] },
      "GET /api/v1/reportcards/signatories": () => json({ code: "FORBIDDEN", message: "Action non autorisée." }, { status: 403 }),
    });
    renderWithProviders(<SlotsScreen />);
    expect(await screen.findByText(/Les noms des signataires ne sont pas accessibles/)).toBeTruthy();
    expect(screen.getByText("Signataire 00000000")).toBeTruthy();
  });
});
