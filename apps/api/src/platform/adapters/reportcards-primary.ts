/**
 * reportcards -> primary_school : `DocumentsPort` — PV du conseil des maîtres (nature `COUNCIL_MINUTES`), PDF du bilan annuel
 * (nature `ANNUAL_REVIEW`) et périodes dont le bulletin est PUBLIÉ aux familles.
 *
 * primary_school fournit le CONTENU figé (immuable, empreinte) ; reportcards le scelle (hash, code, signature Ed25519), le fait
 * rendre par le worker et l'inscrit dans la vérification publique. Les natures `COUNCIL_MINUTES` et `ANNUAL_REVIEW` (et leurs
 * gabarits « procès-verbal », « bilan annuel », filigrane `placeholder`) sont une demande de changement à `reportcards` (013) :
 * tant qu'elles ne figurent pas dans `OFFICIAL_DOCUMENT_KINDS`, l'adaptateur ÉCHOUE FERMÉ (`primary_school.port_unavailable`) —
 * jamais un document sans nature ni gabarit, jamais un faux PDF.
 *
 * Mention des règles de démonstration : le contexte d'impression porte `placeholderNotice` quand `ruleSourceKind = placeholder`
 * (le gabarit l'imprime en filigrane).
 */
import { InternalError, type AppError, type RequestContext, type Result } from "@ecoledigitale/kernel";
import { OFFICIAL_DOCUMENT_KINDS, listReportCards, requestOfficialDocument, type ReportcardsDeps } from "../../modules/reportcards";
import type { PrimaryDocumentsPort as DocumentsPort, MinutesRequest, ReviewDocumentRequest } from "../../modules/primary_school";
import { warmOfficialDocuments } from "./official-documents";

const PLACEHOLDER_NOTICE = "Règles de démonstration — document sans valeur officielle";

function must<T>(r: Result<T, AppError>): T {
  if (!r.ok) throw r.error;
  return r.value;
}

const unavailable = (kind: string): InternalError =>
  new InternalError(`Le service « documents officiels (${kind}) » n'est pas disponible : opération refusée.`, {
    code: "primary_school.port_unavailable",
    details: { port: `documents officiels (${kind})`, reason: "document_kind_not_delivered" },
  });

const supports = (kind: string): boolean => (OFFICIAL_DOCUMENT_KINDS as readonly string[]).includes(kind);

export function createPrimaryDocumentsPort(reportcards: ReportcardsDeps): DocumentsPort {
  async function request(ctx: RequestContext, kind: "COUNCIL_MINUTES" | "ANNUAL_REVIEW", sourceId: string, title: string, issuedAt: Date, content: Record<string, unknown>, ruleSourceKind: string | null): Promise<string> {
    if (!supports(kind)) throw unavailable(kind);
    // Clé de signature et gabarits : préparés au démarrage, HORS transaction (voir `warmOfficialDocuments`).
    await warmOfficialDocuments(reportcards).catch(() => undefined);
    const context: Record<string, unknown> = { title, ...(ruleSourceKind === "placeholder" ? { placeholderNotice: PLACEHOLDER_NOTICE } : {}) };
    const r = must(
      await requestOfficialDocument(reportcards, ctx, {
        kind: kind as never,
        sourceId,
        title,
        issuedAt,
        content: { ...content, ruleSourceKind },
        context,
        // Provenance SCELLÉE avec le document : `placeholder` impose le filigrane « DÉMONSTRATION » au rendu et à la vérification publique.
        ...(ruleSourceKind ? { ruleSourceKind: ruleSourceKind as never } : {}),
      }),
    );
    return r.record.id;
  }

  return {
    async publishedPeriodIds(ctx, { studentId, enrollmentId }) {
      const page = must(await listReportCards(reportcards, ctx, { studentId, status: "PUBLISHED", live: true, limit: 200 }));
      return [...new Set(page.items.map((v) => v.card).filter((c) => c.enrollmentId === enrollmentId && c.academicPeriodId !== null).map((c) => c.academicPeriodId as string))];
    },
    async requestCouncilMinutes(ctx, input: MinutesRequest) {
      // La source du document est la VERSION du procès-verbal : idempotent (par nature et par source), une nouvelle version = un nouveau document.
      const documentId = await request(ctx, "COUNCIL_MINUTES", input.minutesId, input.title, input.issuedAt, input.content, input.ruleSourceKind);
      return { documentId };
    },
    async requestAnnualReview(ctx, input: ReviewDocumentRequest) {
      const documentId = await request(ctx, "ANNUAL_REVIEW", input.reviewId, input.title, input.issuedAt, input.content, input.ruleSourceKind);
      return { documentId };
    },
  };
}
