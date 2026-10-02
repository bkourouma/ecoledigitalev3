/**
 * Ports du module notifications. Élèves, tuteurs, personnel, factures, résultats sont des UUID SANS clé étrangère : leur
 * existence, leurs coordonnées et leurs liens sont fournis par des PORTS que branche la plateforme
 * (`apps/api/src/platform/adapters/*-notifications.ts`).
 *
 * Tant qu'un port n'est pas branché, le module ÉCHOUE FERMÉ (`notifications.port_unavailable`) : aucune remise sans la
 * source de vérité des destinataires. Les appels aux ports sont SÉQUENTIELS (une connexion partagée par la transaction).
 *
 * `ChannelAdapter` est la réalisation concrète du port `NotificationChannel` déclaré par `messaging` (spec 016 §11) : il
 * reçoit en plus l'adresse résolue, le contenu rendu et la clé d'idempotence, et renvoie une issue classée (réessayer,
 * échec définitif, rebond) que le journal et la reprise exploitent. `toMessagingChannel` fait le pont vers le contrat.
 */
import type { RequestContext } from "@ecoledigitale/kernel";
import type { Tx } from "@ecoledigitale/database";
import type { NotifCategory, NotifChannel, NotifSkipReason } from "@ecoledigitale/contracts/src/v2/notifications";
import type { MoneyValue, Recipient } from "../domain/types";

// ---------------------------------------------------------------------------
// Annuaire des destinataires (people + academic + rbac + iam)
// ---------------------------------------------------------------------------

export interface StudentContacts {
  readonly studentId: string;
  readonly studentName: string;
  /** Contact de l'élève lui-même (compte et coordonnées), `null` s'il n'en a pas. */
  readonly student: Recipient | null;
  /** Tuteurs : lien vivant et nature « tuteur » (les contacts d'urgence ne reçoivent rien). Avec ou sans compte. */
  readonly guardians: readonly Recipient[];
}

export interface RecipientDirectory {
  /** Élèves et leurs tuteurs (lot). Un élève inconnu est absent du résultat. */
  studentContacts(ctx: RequestContext, studentIds: readonly string[]): Promise<readonly StudentContacts[]>;
  /** Élèves, tuteurs et enseignants (affectés aujourd'hui) d'une classe. */
  classroomContacts(ctx: RequestContext, classroomId: string, include: readonly ("GUARDIANS" | "STUDENTS" | "TEACHERS")[]): Promise<{ readonly classroomName: string | null; readonly recipients: readonly Recipient[] }>;
  /** Membre du personnel : nom et contact. `null` si inconnu. */
  staffContact(ctx: RequestContext, staffId: string): Promise<{ readonly displayName: string; readonly recipient: Recipient | null } | null>;
  /** Titulaires (actifs, aujourd'hui) de ces rôles, avec leurs coordonnées. */
  usersWithRoles(ctx: RequestContext, roleKeys: readonly string[]): Promise<readonly Recipient[]>;
  /** Comptes demandés (inconnus ou suspendus : absents). */
  contactsOfUsers(ctx: RequestContext, userIds: readonly string[]): Promise<readonly Recipient[]>;
}

// ---------------------------------------------------------------------------
// Sources des relances et alertes (finance, results, people)
// ---------------------------------------------------------------------------

export interface OverdueInstallment {
  readonly installmentId: string;
  readonly invoiceId: string;
  readonly invoiceNumber: string;
  /** Élève redevable (apprenant de la facture). */
  readonly learnerId: string;
  readonly dueDate: string;
  readonly daysOverdue: number;
  readonly remaining: MoneyValue;
}

export interface OverdueSource {
  /** Échéances en retard (reste dû > 0, facture émise non annulée, payeur = apprenant), triées par identifiant, paginées. */
  listOverdueInstallments(ctx: RequestContext, input: { asOf: string; minDaysOverdue: number; limit: number; afterInstallmentId?: string | undefined }): Promise<readonly OverdueInstallment[]>;
  /** L'échéance est-elle toujours en retard (reste dû > 0) ? Relue avant l'envoi : arrêt dès paiement. */
  isInstallmentStillOverdue(ctx: RequestContext, installmentId: string): Promise<boolean>;
}

/** Deux résultats FINAL consécutifs d'un élève (déjà calculés par `results` : le module ne recalcule rien). */
export interface GradePair {
  readonly studentId: string;
  readonly studentName: string;
  readonly classroomId: string;
  readonly className: string;
  readonly previousPeriodId: string;
  readonly currentPeriodId: string;
  readonly previous: string | number | null;
  readonly current: string | number | null;
}

export interface GradeSource {
  listConsecutiveFinals(ctx: RequestContext): Promise<readonly GradePair[]>;
}

export interface TeachingLoad {
  readonly staffId: string;
  readonly staffName: string;
  readonly plannedHours: number;
}

export interface TeachingLoadSource {
  listLoads(ctx: RequestContext): Promise<readonly TeachingLoad[]>;
}

/** Annonce publiée, vue par le canal externe : titre, priorité, destinataires figés (comptes). Jamais le corps complet. */
export interface AnnouncementFeed {
  read(ctx: RequestContext, announcementId: string): Promise<{ readonly title: string; readonly summary: string | null; readonly priority: string; readonly recipientUserIds: readonly string[] } | null>;
}

export interface NotificationsPorts {
  readonly directory: RecipientDirectory;
  readonly overdue: OverdueSource;
  readonly grades: GradeSource;
  readonly teachingLoad: TeachingLoadSource;
  readonly announcements: AnnouncementFeed;
}

// ---------------------------------------------------------------------------
// Canaux de remise
// ---------------------------------------------------------------------------

export interface ChannelMessage {
  readonly tenantId: string;
  readonly deliveryId: string;
  readonly channel: NotifChannel;
  /** E-mail ou numéro E.164 ; pour `IN_APP` et `PUSH` : identifiant du compte. */
  readonly address: string;
  readonly userId: string | null;
  readonly subject: string | null;
  /** Corps en texte brut (gabarit rendu). */
  readonly text: string;
  readonly templateCode: string;
  readonly category: NotifCategory;
  readonly urgent: boolean;
  /** Lien absolu vers l'application (notification push, in-app), ou `null`. */
  readonly link: string | null;
  /** Clé d'idempotence fournisseur : l'identifiant de la remise. */
  readonly idempotencyKey: string;
  readonly schoolName: string;
  readonly senderName: string;
  readonly replyTo: string | null;
  readonly legalFooter: string | null;
  /** Lien de désinscription signé (e-mail, WhatsApp), `null` si le secret n'est pas configuré. */
  readonly unsubscribeUrl: string | null;
}

export type ChannelOutcome =
  | { readonly status: "SENT"; readonly providerId?: string | undefined; readonly cost?: MoneyValue | undefined }
  /** Simulation EXPLICITE (hors production, `NOTIFICATIONS_SIMULATE=1`) : consignée comme telle, jamais confondue avec un envoi. */
  | { readonly status: "SIMULATED"; readonly providerId?: string | undefined }
  /** Panne passagère : la reprise réessaie avec backoff. */
  | { readonly status: "RETRY"; readonly code: string; readonly message: string; readonly retryAfterMs?: number | undefined }
  /** Échec définitif (adresse invalide, canal non configuré, contenu refusé). */
  | { readonly status: "FAILED"; readonly code: string; readonly message: string }
  /** Rebond définitif : l'adresse est ajoutée à la liste de suppression. */
  | { readonly status: "BOUNCED"; readonly code: string; readonly message: string }
  | { readonly status: "SKIPPED"; readonly reason: NotifSkipReason };

export interface ChannelConfigStatus {
  readonly configured: boolean;
  /** Variables d'environnement manquantes (jamais leurs valeurs). */
  readonly missing: readonly string[];
}

export interface ChannelAdapter {
  readonly channel: NotifChannel;
  /** Nom du fournisseur branché (`smtp`, `http-sms`, `wasender`, `webpush`, `messaging`). */
  readonly provider: string;
  status(): ChannelConfigStatus;
  deliver(message: ChannelMessage): Promise<ChannelOutcome>;
  /** Libère les connexions (arrêt du processus, fin de test). */
  close?(): Promise<void>;
}

export interface ChannelRegistry {
  /** Adaptateur du canal ; un canal non configuré échoue explicitement (aucune simulation silencieuse). */
  get(channel: NotifChannel): ChannelAdapter;
  all(): readonly ChannelAdapter[];
  /** Mode simulation explicite actif (hors production uniquement). */
  readonly simulation: boolean;
}

/** Abonnements Web Push d'un utilisateur (lecture et nettoyage des expirés), fournis au canal push par l'application. */
export interface PushSubscriptionStore {
  listForUser(tenantId: string, userId: string): Promise<readonly PushSubscriptionRecord[]>;
  remove(tenantId: string, subscriptionId: string): Promise<void>;
  touch(tenantId: string, subscriptionId: string, at: Date): Promise<void>;
  recordFailure(tenantId: string, subscriptionId: string): Promise<void>;
}

export interface PushSubscriptionRecord {
  readonly id: string;
  readonly endpoint: string;
  readonly p256dh: string;
  readonly auth: string;
}

// ---------------------------------------------------------------------------
// Audit (même transaction que l'opération)
// ---------------------------------------------------------------------------

export interface AuditEntry {
  /** `notifications.<entité>.<action>`. */
  action: string;
  entity: string;
  entityId?: string | null;
  before?: unknown;
  after?: unknown;
  reason?: string | null;
  metadata?: Record<string, unknown> | null;
  severity?: "info" | "notice" | "warning" | "critical";
}

export interface AuditPort {
  record(tx: Tx, entry: AuditEntry): Promise<unknown>;
}

export const noopAudit: AuditPort = Object.freeze({
  async record(): Promise<void> {
    /* le module audit est branché par le plugin HTTP et les abonnés du worker */
  },
});

/** Collecteur en mémoire, pour les tests. */
export class RecordingAudit implements AuditPort {
  readonly entries: AuditEntry[] = [];
  async record(_tx: Tx, entry: AuditEntry): Promise<void> {
    this.entries.push(entry);
  }
  actions(): string[] {
    return this.entries.map((e) => e.action);
  }
}
