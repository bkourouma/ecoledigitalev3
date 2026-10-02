/**
 * documents -> stateassign : `DocumentRefPort` — le document référencé existe ET est lisible par l'appelant.
 *
 * La GED applique ses propres droits (niveau de la catégorie, propriétaire, tuteur lié, partage) : un document que l'appelant ne peut
 * pas lire répond « introuvable », comme un document inexistant. Les droits de lecture (`documents.read`, `.read.restricted`,
 * `.manage`) sont ceux que le plugin a SONDÉS pour l'utilisateur, jamais présumés. La lecture est tracée par `documents`
 * (historique de consultation) : rattacher une pièce, c'est la consulter.
 */
import { getDocument, type DocumentsDeps } from "../../modules/documents";
import type { DocumentRefPort } from "../../modules/stateassign";

export function createStateassignDocumentRefs(documents: DocumentsDeps): DocumentRefPort {
  return {
    async exists(ctx, documentRef, caps) {
      const r = await getDocument(documents, ctx, {
        documentId: documentRef,
        caps: { ...(caps.read ? { read: true } : {}), ...(caps.readRestricted ? { readRestricted: true } : {}), ...(caps.manage ? { manage: true } : {}) },
      });
      return r.ok;
    },
  };
}
