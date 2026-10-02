// @vitest-environment jsdom
import type { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { setTestApi } from "@/platform/test/api-mock";
import { json } from "@/platform/test/render";
import { assessment, bulkResult, councilOverview, enrollment, HASH, ID, myClassroom, P, report, review, sheet, student, summary, uuid } from "@/app/v2/primary/_test/fixtures";
import {
  PRIMARY_BASE,
  fetchPrimaryReportCsv,
  useBulkRecordCompetencies,
  useChildPrimaryAnnualReviews,
  useDecidePrimaryCouncilCase,
  useFreezePrimaryArchive,
  useMyPrimaryClassrooms,
  usePrimaryCompetencySheet,
  usePrimaryCompetencySummary,
  usePrimaryCouncil,
  usePrimaryReport,
  useReissuePrimaryReview,
  useRevisePrimaryAssessment,
  useSealPrimaryReview,
  useValidatePrimaryCompetencies,
} from "./primary";

vi.mock("@/platform/api/default-client", async () => (await import("@/platform/test/api-mock")).defaultClientModule);

function wrapper() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } } });
  return { client, wrap: ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider> };
}

describe("client typé du pack Primary", () => {
  it("la base d'API est celle du module", () => {
    expect(PRIMARY_BASE).toBe("/api/v1/primary_school");
  });

  it("GET my-classrooms : liste validée par le contrat, clé de cache [primary, classrooms]", async () => {
    const api = setTestApi({ [`GET ${P}/my-classrooms`]: { items: [myClassroom()] } });
    const { wrap, client } = wrapper();
    const { result } = renderHook(() => useMyPrimaryClassrooms(), { wrapper: wrap });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.[0]?.name).toBe("CE1 A");
    expect(api.calls[0]).toMatchObject({ method: "GET", path: `${P}/my-classrooms` });
    expect(client.getQueryCache().getAll().some((q) => q.queryKey.slice(2).join("/") === "primary/classrooms")).toBe(true);
  });

  it("une réponse non conforme au contrat est refusée", async () => {
    setTestApi({ [`GET ${P}/my-classrooms`]: { items: [{ ...myClassroom(), studentCount: -1 }] } });
    const { wrap } = wrapper();
    const { result } = renderHook(() => useMyPrimaryClassrooms(), { wrapper: wrap });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error).toMatchObject({ code: "RESPONSE_INVALID" });
  });

  it("grille : classe, période et référentiel passent en paramètres ; désactivée sans période", async () => {
    const api = setTestApi({ [`GET ${P}/classrooms/${ID.classroom}/competency-sheet`]: sheet() });
    const { wrap } = wrapper();
    const idle = renderHook(() => usePrimaryCompetencySheet(ID.classroom, null, null), { wrapper: wrap });
    expect(idle.result.current.fetchStatus).toBe("idle");
    const { result } = renderHook(() => usePrimaryCompetencySheet(ID.classroom, ID.p1, ID.framework), { wrapper: wrap });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(api.calls[0]!.query).toEqual({ periodId: ID.p1, frameworkId: ID.framework });
  });

  it("saisie en lot : PUT avec en-tête Idempotency-Key, corps du lot, réponse validée", async () => {
    const api = setTestApi({ [`PUT ${P}/competency-assessments/bulk`]: () => json(bulkResult([assessment(1, 1, 3)])) });
    const { wrap } = wrapper();
    const { result } = renderHook(() => useBulkRecordCompetencies(), { wrapper: wrap });
    const body = { classroomId: ID.classroom, periodId: ID.p1, frameworkId: ID.framework, lines: [{ enrollmentId: enrollment(1), competencyId: uuid(9401), ratingLevelId: uuid(9103) }] };
    await act(async () => {
      const r = await result.current.mutateAsync({ body, idempotencyKey: "comp-lot-0001" });
      expect(r.created).toBe(1);
    });
    expect(api.calls[0]).toMatchObject({ method: "PUT", path: `${P}/competency-assessments/bulk`, body });
    expect(api.calls[0]!.headers["idempotency-key"]).toBe("comp-lot-0001");
  });

  it("validation, révision : chemins et corps (l'identifiant du chemin ne part pas dans le corps strict)", async () => {
    const api = setTestApi({
      [`POST ${P}/classrooms/${ID.classroom}/periods/${ID.p1}/competencies/validate`]: () => json({ validated: 4, alreadyValidated: 0, expected: 12, missing: 8 }),
      [`POST ${P}/competency-assessments/${assessment(1, 1, 3).id}/revisions`]: () => json({ assessment: assessment(1, 1, 4, { status: "VALIDATED" }), revision: { id: uuid(1), assessmentId: assessment(1, 1, 3).id, fromLevelId: uuid(9103), toLevelId: uuid(9104), reason: "Nouvelle observation", requestedBy: uuid(2), createdAt: "2026-10-01T08:00:00.000Z" } }, { status: 201 }),
    });
    const { wrap } = wrapper();
    const validate = renderHook(() => useValidatePrimaryCompetencies(), { wrapper: wrap });
    const revise = renderHook(() => useRevisePrimaryAssessment(), { wrapper: wrap });
    await act(async () => {
      expect((await validate.result.current.mutateAsync({ classroomId: ID.classroom, periodId: ID.p1, frameworkId: ID.framework })).missing).toBe(8);
      await revise.result.current.mutateAsync({ assessmentId: assessment(1, 1, 3).id, toRatingLevelId: uuid(9104), reason: "Nouvelle observation" });
    });
    expect(api.calls[0]!.body).toEqual({ frameworkId: ID.framework });
    expect(api.calls[1]!.body).toEqual({ toRatingLevelId: uuid(9104), reason: "Nouvelle observation" });
  });

  it("synthèse : périodes jointes par des virgules, comptages validés", async () => {
    const api = setTestApi({ [`GET ${P}/enrollments/${enrollment(1)}/competency-summary`]: summary() });
    const { wrap } = wrapper();
    const { result } = renderHook(() => usePrimaryCompetencySummary(enrollment(1), [ID.p1, ID.p2]), { wrapper: wrap });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(api.calls[0]!.query).toEqual({ periodIds: `${ID.p1},${ID.p2}` });
    expect(result.current.data?.summary.D1).toEqual({ N2: 1, N3: 1 });
  });

  it("conseil : lecture d'une séance et décision (corps sans identifiants du chemin)", async () => {
    const api = setTestApi({
      [`GET ${P}/councils/${ID.deliberation}`]: councilOverview(),
      [`POST ${P}/councils/${ID.deliberation}/cases/${uuid(9601)}/decide`]: () => json({ caseId: uuid(9601), status: "DECIDED", decisionId: uuid(9750), finalCode: "REPEAT", ruleProposalCode: "PROMOTED", changedFromProposal: true, outcomeRecorded: null }),
    });
    const { wrap } = wrapper();
    const council = renderHook(() => usePrimaryCouncil(ID.deliberation), { wrapper: wrap });
    await waitFor(() => expect(council.result.current.isSuccess).toBe(true));
    expect(council.result.current.data?.quorum).toEqual({ convened: 2, present: 0, met: null, source: "none" });
    const decide = renderHook(() => useDecidePrimaryCouncilCase(), { wrapper: wrap });
    await act(async () => {
      await decide.result.current.mutateAsync({ deliberationId: ID.deliberation, caseId: uuid(9601), finalCode: "REPEAT", justification: "Justification de vingt caractères." });
    });
    expect(api.calls.find((c) => c.method === "POST")!.body).toEqual({ finalCode: "REPEAT", justification: "Justification de vingt caractères." });
  });

  it("bilans : scellement, réémission, gel d'archive (chemins) ; famille par enfant", async () => {
    const api = setTestApi({
      [`POST ${P}/annual-reviews/${uuid(9901)}/seal`]: () => json(review(1, { status: "SEALED", contentHash: HASH, sealedAt: "2026-10-01T08:00:00.000Z" })),
      [`POST ${P}/annual-reviews/${uuid(9901)}/reissue`]: () => json(review(1, { version: 2 }), { status: 201 }),
      [`POST ${P}/year-archives/${uuid(9990)}/freeze`]: () => json({ id: uuid(9990), institutionId: ID.institution, academicYearId: ID.year, status: "FROZEN", reviewsTotal: 1, reviewsSealed: 1, manifestHash: HASH, preparedAt: null, frozenAt: "2026-10-01T08:00:00.000Z", blockers: [] }),
      [`GET ${P}/children/${student(1)}/annual-reviews`]: { items: [review(1, { status: "SEALED", contentHash: HASH, sealedAt: "2026-10-01T08:00:00.000Z" })] },
    });
    const { wrap } = wrapper();
    const seal = renderHook(() => useSealPrimaryReview(), { wrapper: wrap });
    const reissue = renderHook(() => useReissuePrimaryReview(), { wrapper: wrap });
    const freeze = renderHook(() => useFreezePrimaryArchive(), { wrapper: wrap });
    await act(async () => {
      expect((await seal.result.current.mutateAsync({ id: uuid(9901) })).status).toBe("SEALED");
      await reissue.result.current.mutateAsync({ id: uuid(9901), reason: "Erreur de saisie corrigée" });
      expect((await freeze.result.current.mutateAsync({ id: uuid(9990) })).status).toBe("FROZEN");
    });
    expect(api.calls[0]!.body).toBeUndefined();
    expect(api.calls[1]!.body).toEqual({ reason: "Erreur de saisie corrigée" });
    const kids = renderHook(() => useChildPrimaryAnnualReviews(student(1)), { wrapper: wrap });
    await waitFor(() => expect(kids.result.current.isSuccess).toBe(true));
    expect(kids.result.current.data?.[0]?.status).toBe("SEALED");
  });

  it("états : aperçu JSON et export CSV (texte, format=csv)", async () => {
    const api = setTestApi({
      [`GET ${P}/reports/class-list`]: ({ url }) => (url.searchParams.get("format") === "csv" ? new Response("Nom;Effectif\r\nAka;1\r\n", { status: 200, headers: { "content-type": "text/csv" } }) : json(report())),
    });
    const { wrap } = wrapper();
    const preview = renderHook(() => usePrimaryReport("class-list", { classroomId: ID.classroom }), { wrapper: wrap });
    await waitFor(() => expect(preview.result.current.isSuccess).toBe(true));
    expect(api.calls[0]!.query).toEqual({ classroomId: ID.classroom, format: "json" });
    const csv = await fetchPrimaryReportCsv("class-list", { classroomId: ID.classroom });
    expect(csv).toContain("Nom;Effectif");
    expect(api.calls.at(-1)!.query).toEqual({ classroomId: ID.classroom, format: "csv" });
  });
});
