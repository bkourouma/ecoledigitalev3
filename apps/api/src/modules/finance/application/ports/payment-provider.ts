/**
 * Port `PaymentProvider` : contrat d'un fournisseur de paiement (Orange Money, MTN MoMo,
 * Wave, CinetPay, TresorPay, sandbox…).
 *
 * C'est le contrat de l'interface historique (`payment-provider.interface.ts` :
 * `initiatePayment`, `verifyPayment`, `handleWebhook`, `verifySignature`,
 * `getProviderName`) en version TYPÉE :
 *   - montants en `Money` (entiers) ; plus de `number` flottant ;
 *   - échecs attendus par `Result<…, AppError>` ; plus d'exception pour un refus ;
 *   - statuts normalisés `PENDING | SUCCEEDED | FAILED | CANCELLED` ;
 *   - webhook : le corps BRUT (chaîne) et les en-têtes arrivent à l'adaptateur, qui
 *     vérifie la signature sur les octets reçus puis analyse le JSON — la signature ne
 *     doit jamais être calculée sur un objet re-sérialisé.
 *
 * Correspondance avec le legacy (utile au portage des adaptateurs en Phase 3) :
 *
 *   legacy                                     | port
 *   -------------------------------------------|---------------------------------------------
 *   initiatePayment(request)                   | initiate(request)
 *   verifyPayment({transactionId, externalRef})| verify({ paymentId, providerRef })
 *   handleWebhook(payload, signature)          | handleWebhook(rawBody, headers)
 *   verifySignature(payload, signature)        | verifySignature(rawBody, headers)
 *   getProviderName()                          | getProviderName()
 *   status 'pending' | 'initiated'             | 'PENDING'
 *   status 'validated'                         | 'SUCCEEDED'
 *   status 'failed' | 'cancelled'              | 'FAILED' | 'CANCELLED'
 *   enrollmentId (utilisé comme order_id)      | paymentId (notre identifiant de transaction)
 *
 * RÈGLES POUR LES ADAPTATEURS RÉELS (Phase 3) :
 *   - jamais de succès « moqué » quand la configuration manque (le registre refuse déjà) ;
 *   - `verifySignature` renvoie `false` si le secret est absent ou la signature illisible
 *     (le legacy renvoyait `true` — c'est la faille à ne pas porter) ;
 *   - comparer les signatures en temps constant ;
 *   - ne jamais journaliser de secret ni de jeton.
 */
import type { AppError, Money, Result } from "@ecoledigitale/kernel";

export type ProviderPaymentStatus = "PENDING" | "SUCCEEDED" | "FAILED" | "CANCELLED";

export type ProviderMetadata = Readonly<Record<string, string | number | boolean>>;

/** En-têtes HTTP en minuscules (Fastify normalise les noms). */
export type ProviderHeaders = Readonly<Record<string, string | string[] | undefined>>;

export interface ProviderPayer {
  readonly phoneNumber?: string;
  readonly name?: string;
  readonly email?: string;
}

export interface ProviderInitiateRequest {
  readonly tenantId: string;
  /** Notre identifiant de transaction (id du paiement) : la référence marchande. */
  readonly paymentId: string;
  readonly amount: Money;
  readonly payer?: ProviderPayer;
  readonly description?: string;
  readonly returnUrl?: string;
  /** URL de notification (webhook) à communiquer au fournisseur. */
  readonly notifyUrl?: string;
  readonly metadata?: ProviderMetadata;
}

export interface ProviderInitiation {
  readonly providerRef: string | null;
  readonly status: "PENDING" | "SUCCEEDED" | "FAILED";
  readonly ussdCode?: string;
  readonly instructions?: string;
  readonly qrCode?: string;
  readonly redirectUrl?: string;
  readonly expiresAt?: Date;
  readonly failureReason?: string;
}

export interface ProviderVerifyRequest {
  readonly paymentId: string;
  readonly providerRef: string | null;
}

export interface ProviderVerification {
  readonly status: ProviderPaymentStatus;
  readonly providerRef: string | null;
  /** Montant confirmé par le fournisseur (comparé au montant attendu avant toute confirmation). */
  readonly amount: Money | null;
  readonly paidAt: Date | null;
  readonly failureReason?: string;
}

export interface ProviderWebhookEvent {
  /** Identifiant unique de l'événement chez le fournisseur : clé d'idempotence. */
  readonly eventId: string;
  readonly type: string;
  /** Notre identifiant de transaction, si le fournisseur le renvoie. */
  readonly paymentId: string | null;
  readonly providerRef: string | null;
  readonly status: ProviderPaymentStatus;
  readonly amount: Money | null;
  readonly occurredAt: Date | null;
}

export interface PaymentProvider {
  getProviderName(): string;
  /** Vrai pour un fournisseur simulé (sandbox) : les paiements sont marqués `simulated`. */
  readonly simulated: boolean;
  initiate(request: ProviderInitiateRequest): Promise<Result<ProviderInitiation, AppError>>;
  verify(request: ProviderVerifyRequest): Promise<Result<ProviderVerification, AppError>>;
  /** Authenticité du webhook. Doit renvoyer `false` (jamais `true`) si le secret manque. */
  verifySignature(rawBody: string, headers: ProviderHeaders): boolean;
  /** Analyse un webhook DÉJÀ authentifié. */
  handleWebhook(rawBody: string, headers: ProviderHeaders): Promise<Result<ProviderWebhookEvent, AppError>>;
}
