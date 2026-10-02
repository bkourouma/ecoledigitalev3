/**
 * Ports du module messaging. Utilisateurs (identités IAM), élèves, classes, niveaux, campus, rôles sont des UUID SANS clé
 * étrangère : leur existence et leurs liens (tutelle, affectation, inscription) sont vérifiés par ces ports, fournis à
 * l'assemblage par `apps/api/src/platform/adapters/*-messaging.ts` (people, academic, rbac, stockage).
 *
 * Tant qu'un port n'est pas branché, le module ÉCHOUE FERMÉ : `messaging.port_unavailable` (aucun envoi sans la source
 * de vérité des liens). Les implémentations en mémoire de `infrastructure/in-memory-ports.ts` servent aux tests.
 *
 * Un port appartient à un AUTRE module, qui ouvre sa propre lecture : aucune fonction de port ne prend de `Tx`. Les appels
 * sont SÉQUENTIELS (les ports partagent la connexion de la transaction : pas de `Promise.all`).
 */
import type { RequestContext } from "@ecoledigitale/kernel";
import type { Tx } from "@ecoledigitale/database";
import type { ActorProfile, DirectoryContact, MessagingAudience, MessagingClassInclude, MessagingTarget, Uuid } from "../domain/types";

// ---------------------------------------------------------------------------
// Annuaire des personnes (people + academic + rbac)
// ---------------------------------------------------------------------------

export interface ClassroomContacts {
  readonly classroom: { readonly id: Uuid; readonly name: string } | null;
  readonly contacts: readonly DirectoryContact[];
}

export interface PeopleDirectory {
  /**
   * Profils des utilisateurs demandés (≤ 200) : seuls les comptes ACTIFS connus de l'établissement sont restitués
   * (un identifiant inconnu, d'un autre tenant ou suspendu est ABSENT du résultat).
   */
  getProfiles(ctx: RequestContext, userIds: readonly Uuid[]): Promise<ReadonlyMap<Uuid, ActorProfile>>;
  /** Personnes joignables d'une classe : élèves, tuteurs (avec leur enfant), enseignants affectés aujourd'hui. */
  listClassroomContacts(ctx: RequestContext, classroomId: Uuid, include: readonly MessagingClassInclude[]): Promise<ClassroomContacts>;
  /** Recherche par nom parmi les comptes actifs (administration : sélecteur global). */
  searchUsers(ctx: RequestContext, query: string, limit: number): Promise<readonly DirectoryContact[]>;
  /** Titulaires (actifs, aujourd'hui) de ces rôles : contacts de l'administration, cibles `ROLE`. */
  listUsersWithRoles(ctx: RequestContext, roleKeys: readonly string[]): Promise<readonly DirectoryContact[]>;
  /** Tuteurs joignables d'un élève (messages système). `null` : élève inconnu. */
  getGuardianContactsOfStudent(ctx: RequestContext, studentId: Uuid): Promise<{ readonly studentName: string; readonly contacts: readonly DirectoryContact[] } | null>;
  /** Noms d'affichage des comptes (reçus d'annonce, supervision) ; les inconnus sont absents. */
  getDisplayNames(ctx: RequestContext, userIds: readonly Uuid[]): Promise<ReadonlyMap<Uuid, string>>;
  /** Classes (id, nom) qui existent pour ces identifiants. */
  getClassroomNames(ctx: RequestContext, classroomIds: readonly Uuid[]): Promise<ReadonlyMap<Uuid, string>>;
}

// ---------------------------------------------------------------------------
// Audiences d'annonce (academic + people + rbac)
// ---------------------------------------------------------------------------

export interface AudienceResolution {
  readonly userIds: readonly Uuid[];
  /** Vrai si la limite a été atteinte (l'audience réelle est plus grande). */
  readonly truncated: boolean;
}

export interface AudienceDirectory {
  /** Chaque cible existe-t-elle dans le tenant ? Retourne la première qui n'existe pas. */
  firstUnknownTarget(ctx: RequestContext, targets: readonly MessagingTarget[]): Promise<MessagingTarget | null>;
  /** Utilisateurs visés (dédoublonnés, comptes actifs), plafonnés à `limit`. */
  resolveAudience(ctx: RequestContext, input: { targets: readonly MessagingTarget[]; audiences: readonly MessagingAudience[]; limit: number }): Promise<AudienceResolution>;
}

// ---------------------------------------------------------------------------
// Stockage objet des pièces (jamais le disque local)
// ---------------------------------------------------------------------------

export interface StoragePort {
  put(key: string, data: Uint8Array, options: { contentType: string }): Promise<void>;
  delete(key: string): Promise<void>;
  signedUrl(key: string, ttlSeconds: number): Promise<{ url: string; expiresAt: Date }>;
}

// ---------------------------------------------------------------------------
// Canaux externes (e-mail, SMS, WhatsApp, push) — CONTRAT SEUL, implémenté par un autre chantier
// ---------------------------------------------------------------------------

export type ExternalChannel = "EMAIL" | "SMS" | "WHATSAPP" | "PUSH";

/** Notification sortante : ce qu'un canal externe reçoit (jamais le texte d'un message : titre et lien interne). */
export interface OutboundNotification {
  readonly tenantId: Uuid;
  readonly userId: Uuid;
  readonly category: "MESSAGE" | "ANNOUNCEMENT" | "SYSTEM" | "MODERATION";
  readonly title: string;
  readonly body: string | null;
  /** Chemin INTERNE (`/v2/messages/<id>`) : le canal en fait un lien absolu selon son contexte. */
  readonly link: string | null;
  /** Une notification non lue par clé : le canal peut regrouper. */
  readonly dedupeKey: string | null;
}

export type ChannelDelivery = { readonly status: "SENT" | "SKIPPED" | "FAILED"; readonly detail?: string };

/**
 * Port `NotificationChannel` : un canal externe de remise. Le module `messaging` ne l'appelle PAS (le chantier
 * « canaux externes » consomme les événements `messaging.*` et lit `notification_preferences.external_channels`).
 */
export interface NotificationChannel {
  readonly channel: ExternalChannel;
  deliver(notification: OutboundNotification): Promise<ChannelDelivery>;
}

// ---------------------------------------------------------------------------
// Audit (même transaction que l'opération sensible)
// ---------------------------------------------------------------------------

export interface AuditEntry {
  /** `messaging.<entité>.<action>`. */
  readonly action: string;
  readonly resourceType: string;
  readonly resourceId: string;
  /** Opération sensible (modération, supervision, lecture d'un contenu d'autrui). */
  readonly sensitive?: boolean;
  readonly before?: unknown;
  readonly after?: unknown;
  readonly reason?: string | null;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface AuditPort {
  record(tx: Tx, ctx: RequestContext, entry: AuditEntry): Promise<void>;
}

export const noopAudit: AuditPort = Object.freeze({
  async record(): Promise<void> {
    /* le module audit est branché par l'adaptateur de http/plugin.ts */
  },
});

/** Collecteur en mémoire, pour les tests. */
export class RecordingAudit implements AuditPort {
  readonly entries: Array<{ ctx: RequestContext; entry: AuditEntry }> = [];
  async record(_tx: Tx, ctx: RequestContext, entry: AuditEntry): Promise<void> {
    this.entries.push({ ctx, entry });
  }
  actions(): string[] {
    return this.entries.map((e) => e.entry.action);
  }
}

export interface MessagingPorts {
  readonly directory: PeopleDirectory;
  readonly audience: AudienceDirectory;
  readonly storage: StoragePort;
}
