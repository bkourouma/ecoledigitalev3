/**
 * Port « document officiel » : le PDF d'un reçu est rendu par le module `reportcards` (gabarit de plateforme, identité de
 * l'établissement, signature Ed25519, QR de vérification publique, rendu dans le worker, stockage objet) ; finance fournit le
 * CONTENU figé du reçu et n'en connaît rien d'autre. Branché par l'adaptateur `platform/adapters/finance-reportcards.ts`.
 *
 * Échec FERMÉ : tant que le port n'est pas branché, le téléchargement d'un PDF est indisponible (`finance.port_unavailable`).
 */
import { err, InternalError, type AppError, type RequestContext, type Result } from "@ecoledigitale/kernel";

export interface OfficialDocumentInput {
  /** Objet source (identifiant du reçu). */
  readonly sourceId: string;
  /** Intitulé scellé ET publié par la vérification publique : aucune donnée personnelle. */
  readonly title: string;
  readonly issuedAt: Date;
  /** Contenu figé (JSON canonique : chaînes, entiers, booléens, null). */
  readonly content: Record<string, unknown>;
  /** Contexte d'impression (chaînes déjà mises en forme), dérivé du contenu. */
  readonly context: Record<string, unknown>;
}

export type OfficialDocumentStatus = "PENDING" | "RENDERING" | "RENDERED" | "FAILED";

export interface OfficialDocumentState {
  readonly status: OfficialDocumentStatus;
  readonly fileName: string;
  /** Octets du PDF si `status === 'RENDERED'`. */
  readonly bytes: Uint8Array | null;
  readonly verificationCode: string;
  readonly pdfHash: string | null;
  readonly lastError: string | null;
}

export interface ReceiptDocumentPort {
  /**
   * Renvoie l'état du document du reçu ; le scelle (idempotent) et demande son rendu s'il n'existe pas ; redemande le rendu
   * d'un document dont le rendu a définitivement échoué. Ne contrôle PAS l'accès : l'appelant (finance) l'a déjà fait.
   */
  fetchOrRequest(ctx: RequestContext, input: OfficialDocumentInput): Promise<Result<OfficialDocumentState, AppError>>;
}

export const unavailableReceiptDocuments: ReceiptDocumentPort = Object.freeze({
  async fetchOrRequest(): Promise<Result<OfficialDocumentState, AppError>> {
    return err(new InternalError("Le rendu PDF des reçus n'est pas disponible (service de documents non branché).", { code: "finance.port_unavailable", details: { port: "documents" } }));
  },
});
