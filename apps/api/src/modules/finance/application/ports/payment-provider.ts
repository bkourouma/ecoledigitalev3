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
  /** Montant ATTENDU (notre base) : certains fournisseurs l'exigent pour interroger le statut (Orange Money). */
  readonly amount?: Money;
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
  /**
   * Le webhook n'est qu'un INDICE (aucune signature de contenu : Orange Money, MTN MoMo, CinetPay) : le cas d'usage
   * interroge `verify` AVANT de croire le statut et le montant. Sans cette marque, la signature fait foi.
   */
  readonly requiresActiveVerification?: boolean;
  /** Contenu expurgé (numéros masqués, jetons retirés) conservé dans `webhook_events.payload` ; sinon le corps brut. */
  readonly storedPayload?: unknown;
}

/** Contexte de la requête de webhook hors en-têtes (paramètres d'URL signés). */
export interface ProviderWebhookMeta {
  readonly query?: Readonly<Record<string, string>>;
  /** Tenant de l'URL : certains schémas lient la signature au tenant. */
  readonly tenantId?: string;
}

export interface ProviderRefundRequest {
  readonly paymentId: string;
  readonly providerRef: string | null;
  readonly amount: Money;
  /** Identifiant (stable) du remboursement : référence d'idempotence côté fournisseur. */
  readonly refundId: string;
  readonly reason?: string;
}

export interface ProviderRefundResult {
  readonly status: "PENDING" | "SUCCEEDED" | "FAILED";
  readonly providerRefundRef: string | null;
  readonly failureReason?: string;
}

/**
 * Ce que le remboursement d'un fournisseur sait faire. Sert à décider SANS appel réseau si le remboursement réel est
 * possible (sinon : repli manuel explicite) et comment relancer sans danger après une réponse ambiguë.
 */
export interface ProviderRefundCapabilities {
  /** Vrai si un remboursement PARTIEL est possible (Wave : total uniquement). */
  readonly partial: boolean;
  /**
   * Vrai si renvoyer la MÊME demande (même `refundId`) ne peut jamais rembourser deux fois (clé d'idempotence ou
   * référence stable côté fournisseur). Faux : après une réponse ambiguë on n'envoie JAMAIS une seconde fois.
   */
  readonly idempotent: boolean;
  /** Vrai si `refundStatus` interroge l'état d'un remboursement déjà envoyé. */
  readonly statusQuery: boolean;
}

export interface ProviderRefundStatusRequest {
  readonly paymentId: string;
  readonly providerRef: string | null;
  /** Notre identifiant du remboursement (référence stable envoyée au fournisseur). */
  readonly refundId: string;
  /** Référence du remboursement chez le fournisseur, si on l'a reçue. */
  readonly providerRefundRef: string | null;
  readonly amount: Money;
}

export interface ProviderRefundStatus {
  /** `NOT_FOUND` : le fournisseur n'a aucune trace de ce remboursement (jamais reçu). */
  readonly status: "PENDING" | "SUCCEEDED" | "FAILED" | "NOT_FOUND";
  readonly providerRefundRef: string | null;
  readonly failureReason?: string;
}

export interface ProviderConnectionCheck {
  /** Code court (jamais un message du fournisseur) : `ok`, `credentials_rejected`, `unreachable`… */
  readonly code: string;
  readonly ok: boolean;
}

export interface PaymentProvider {
  getProviderName(): string;
  /** Vrai pour un fournisseur simulé (sandbox) : les paiements sont marqués `simulated`. */
  readonly simulated: boolean;
  initiate(request: ProviderInitiateRequest): Promise<Result<ProviderInitiation, AppError>>;
  verify(request: ProviderVerifyRequest): Promise<Result<ProviderVerification, AppError>>;
  /** Authenticité du webhook. Doit renvoyer `false` (jamais `true`) si le secret manque. */
  verifySignature(rawBody: string, headers: ProviderHeaders, meta?: ProviderWebhookMeta): boolean;
  /** Analyse un webhook DÉJÀ authentifié. */
  handleWebhook(rawBody: string, headers: ProviderHeaders, meta?: ProviderWebhookMeta): Promise<Result<ProviderWebhookEvent, AppError>>;
  /** Remboursement chez le fournisseur (facultatif : absent quand l'API publique n'en offre pas). */
  refund?(request: ProviderRefundRequest): Promise<Result<ProviderRefundResult, AppError>>;
  /** Capacités du remboursement (présentes dès que `refund` l'est). Absentes ⇒ prudence maximale (ni partiel, ni rejeu). */
  readonly refundCapabilities?: ProviderRefundCapabilities;
  /** État d'un remboursement déjà envoyé (rapprochement) ; absent quand le fournisseur n'offre pas de lecture. */
  refundStatus?(request: ProviderRefundStatusRequest): Promise<Result<ProviderRefundStatus, AppError>>;
  /**
   * Vrai quand `verify` n'a AUCUN moyen d'interroger une transaction sans la référence reçue à l'initiation
   * (Orange Money : `pay_token`). Un paiement en attente sans référence est alors « à rapprocher » à la main.
   */
  readonly cannotVerifyWithoutProviderRef?: boolean;
  /** Contrôle des identifiants SANS jamais créer de paiement (écran d'administration). */
  testConnection?(): Promise<Result<ProviderConnectionCheck, AppError>>;
  /** URL de webhook à afficher, éventuellement porteuse d'un jeton (schémas « URL secrète »). */
  webhookUrl?(baseUrl: string, tenantId: string): string;
}
