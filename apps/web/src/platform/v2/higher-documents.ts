"use client";

/**
 * PDF des diplômes et attestations (`/api/v1/higher/documents/:id/pdf` et `/render`) et documents de l'étudiant / du tuteur
 * (`/me/documents`, `/children/:studentId/documents`). Schémas Zod de `packages/contracts/src/v2/higher.ts` ; la réponse du
 * téléchargement n'a pas encore de schéma dans les contrats : elle est décrite ici d'après la route.
 *
 * Le PDF est produit par le worker (scellement puis rendu) :
 *  - 200 `READY` : URL SIGNÉE à durée courte (émission auditée côté serveur), ouverte aussitôt, jamais conservée ni affichée ;
 *  - 202 `PENDING` / `RENDERING` / `FAILED` : état du rendu ;
 *  - 409 `higher.document_revoked` : document révoqué, plus servi.
 */

import { z } from "zod";
import { platformHooks as hooks } from "@/platform/api/default-client";
import { higherDocumentDtoSchema } from "@ecoledigitale/contracts/v2/higher";
import { useQueryClient } from "@tanstack/react-query";
import { useApiAction } from "./actions";
import { HIGHER_BASE } from "./higher";

export const higherPdfResponseSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("READY"), url: z.string(), expiresInSec: z.number().int().positive(), fileName: z.string(), contentType: z.literal("application/pdf"), pdfHash: z.string() }),
  z.object({ status: z.enum(["PENDING", "RENDERING", "FAILED"]) }),
]);
export type HigherPdfResponse = z.infer<typeof higherPdfResponseSchema>;

/** Intervalle de relecture d'un PDF en préparation (ms) et nombre maximal de relectures (1 minute) avant d'inviter à revenir plus tard. */
export const PDF_POLL_MS = 3000;
export const PDF_POLL_MAX = 20;

/** Demande l'état du PDF (ou son URL signée) : appelé au clic puis par la relecture. */
export function requestDocumentPdf(documentId: string): Promise<HigherPdfResponse> {
  return hooks.client.request("GET", `${HIGHER_BASE}/documents/${documentId}/pdf`, { schema: higherPdfResponseSchema });
}

const DOCUMENTS_KEY = ["higher", "documents"] as const;

/** Demande ou reprend le rendu d'un PDF jamais produit ou en échec (permission `higher.document.issue`) ; 202. */
export function useRenderDocument() {
  return useApiAction({
    path: (v: { id: string }) => `${HIGHER_BASE}/documents/${v.id}/render`,
    schema: higherDocumentDtoSchema,
    invalidate: [DOCUMENTS_KEY],
  });
}

/** Relit les listes de documents (l'état « PDF » d'une ligne vient de `renderStatus`). */
export function useRefreshHigherDocuments() {
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: hooks.queryKey(...DOCUMENTS_KEY) });
}

const listSchema = z.object({ items: z.array(higherDocumentDtoSchema) });

/** Mes documents (étudiant) : publiés seulement, filtrés par le serveur. */
export function useMyHigherDocuments(enabled = true) {
  return hooks.useApiQuery(["higher", "documents", "mine"], `${HIGHER_BASE}/me/documents`, { schema: listSchema, select: (d) => d.items, enabled, retry: false });
}

/** Documents d'un enfant (tuteur lié) : publiés seulement. */
export function useChildHigherDocuments(studentId: string | null) {
  return hooks.useApiQuery(["higher", "documents", "child", studentId], `${HIGHER_BASE}/children/${studentId}/documents`, { schema: listSchema, select: (d) => d.items, enabled: studentId !== null, retry: false });
}
