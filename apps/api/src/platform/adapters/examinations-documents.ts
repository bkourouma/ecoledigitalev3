/**
 * documents + reportcards -> examinations :
 *  - `PieceDocumentPort` : une pièce d'un candidat est un document de `documents` dont le PROPRIÉTAIRE est l'élève ; l'adaptateur
 *    répond seulement « existe, actif, appartient à cet élève » (aucun contenu n'est relu ni recopié) ;
 *  - `OfficialDocumentPort` : scellement (QR de vérification, signature Ed25519) et rendu des convocations, attestations de réussite
 *    et relevés de notes par `reportcards.requestOfficialDocument`. Natures ATTENDUES : `EXAM_CONVOCATION`,
 *    `EXAM_SUCCESS_CERTIFICATE`, `EXAM_TRANSCRIPT` (livrées par le propriétaire de `reportcards`) ; tant qu'elles manquent, la demande
 *    est refusée par `reportcards` (`unknown_document_kind`) et l'adaptateur échoue FERMÉ (`examinations.port_unavailable`, interface
 *    attendue citée) — jamais un document « presque officiel ».
 */
import { err, InternalError, ok, type AppError, type RequestContext, type Result } from "@ecoledigitale/kernel";
import { getDocument, type DocumentsDeps } from "../../modules/documents";
import { readOfficialDocument, requestOfficialDocument, type ReportcardsDeps } from "../../modules/reportcards";
import { ExamCode } from "../../modules/examinations";
import type { OfficialDocumentPort, PieceDocumentPort } from "../../modules/examinations";

export function createExaminationsPieceDocuments(documents: DocumentsDeps): PieceDocumentPort {
  return {
    async verify(ctx: RequestContext, { documentId, studentId }) {
      // Lecture au niveau « restreint » (dossiers d'élèves) : la décision porte sur l'appartenance, pas sur le contenu.
      const r = await getDocument(documents, ctx, { documentId, caps: { read: true, readRestricted: true } });
      return r.ok && r.value.status === "ACTIVE" && r.value.ownerType === "STUDENT" && r.value.ownerId === studentId;
    },
  };
}

const EXPECTED_KINDS = "reportcards.requestOfficialDocument : natures EXAM_CONVOCATION, EXAM_SUCCESS_CERTIFICATE, EXAM_TRANSCRIPT (gabarits génériques)";

const unavailable = (detail: string): AppError =>
  new InternalError("Le service « documents officiels d'examen » n'est pas disponible : opération refusée.", {
    code: ExamCode.PORT_UNAVAILABLE,
    details: { port: "officialDocuments", expected: EXPECTED_KINDS, detail },
  });

const KNOWN_KIND_REFUSALS = new Set(["reportcards.unknown_document_kind", "reportcards.template_not_found", "reportcards.invalid_template"]);

export function createExaminationsOfficialDocuments(reportcards: ReportcardsDeps): OfficialDocumentPort {
  return {
    async request(ctx: RequestContext, input): Promise<Result<{ documentId: string }, AppError>> {
      const r = await requestOfficialDocument(reportcards, ctx, {
        kind: input.kind as never,
        sourceId: input.sourceId,
        title: input.title,
        issuedAt: input.issuedAt,
        content: input.content,
        context: input.context,
        institutionId: input.institutionId,
      });
      if (!r.ok) return err(KNOWN_KIND_REFUSALS.has(r.error.code) ? unavailable(r.error.code) : r.error);
      return ok({ documentId: r.value.record.id });
    },

    async read(ctx: RequestContext, input): Promise<Result<{ documentId: string; status: "PENDING" | "RENDERED" | "FAILED"; fileName: string | null; bytes: Uint8Array | null; verificationCode: string | null } | null, AppError>> {
      const r = await readOfficialDocument(reportcards, ctx, { kind: input.kind as never, sourceId: input.sourceId });
      if (!r.ok) return r;
      if (!r.value) return ok(null);
      const status = r.value.record.renderStatus === "RENDERED" ? "RENDERED" : r.value.record.renderStatus === "FAILED" ? "FAILED" : "PENDING";
      return ok({ documentId: r.value.record.id, status, fileName: r.value.fileName, bytes: r.value.bytes, verificationCode: r.value.record.verificationCode });
    },
  };
}
