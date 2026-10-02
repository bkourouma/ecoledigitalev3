/**
 * Types du domaine notifications. Aucun import d'infrastructure.
 */
import type {
  NotifAlertMetric,
  NotifAudience,
  NotifCategory,
  NotifChannel,
  NotifConsentModel,
  NotifDeliveryStatus,
  NotifRuleConditions,
  NotifRuleKind,
  NotifSkipReason,
  NotifSourceKind,
  NotifStrategy,
  NotifTemplateCode,
  NotifVariableDef,
} from "@ecoledigitale/contracts/src/v2/notifications";

export type Uuid = string;

export type {
  NotifAlertMetric as AlertMetric,
  NotifAudience as Audience,
  NotifCategory as Category,
  NotifChannel as Channel,
  NotifConsentModel as ConsentModel,
  NotifDeliveryStatus as DeliveryStatus,
  NotifRuleConditions as RuleConditions,
  NotifRuleKind as RuleKind,
  NotifSkipReason as SkipReason,
  NotifSourceKind as SourceKind,
  NotifStrategy as Strategy,
  NotifTemplateCode as TemplateCode,
  NotifVariableDef as VariableDef,
};

/** Canaux effectivement externes (le port `NotificationChannel` de messaging ne connaît pas `IN_APP`). */
export type ExternalChannel = Exclude<NotifChannel, "IN_APP">;

/** Canaux qui exigent une adresse (e-mail, numéro) ; les autres s'adressent à un compte. */
export const ADDRESS_CHANNELS = ["EMAIL", "SMS", "WHATSAPP"] as const;
export type AddressChannel = (typeof ADDRESS_CHANNELS)[number];
export const isAddressChannel = (c: NotifChannel): c is AddressChannel => (ADDRESS_CHANNELS as readonly string[]).includes(c);

/** Canaux intrusifs : soumis aux heures calmes (un e-mail ou une notification in-app n'est pas une sonnerie). */
export const QUIET_HOURS_CHANNELS: readonly NotifChannel[] = Object.freeze(["SMS", "WHATSAPP", "PUSH"]);

/** Canaux qui exigent un COMPTE utilisateur (la remise vise `userId`). */
export const ACCOUNT_CHANNELS: readonly NotifChannel[] = Object.freeze(["IN_APP", "PUSH"]);

/** Destinataire résolu par le port d'annuaire. L'adresse n'est jamais journalisée ni restituée. */
export interface Recipient {
  /** Clé de personne : `user:<id>` si la personne a un compte, sinon `person:<id>` (consentement stable). */
  readonly subjectKey: string;
  /** Autres clés de la même personne (consentement exprimé avant la création d'un compte) : un refus sur l'une vaut pour toutes. */
  readonly aliasKeys: readonly string[];
  readonly userId: Uuid | null;
  readonly displayName: string;
  readonly email: string | null;
  readonly phone: string | null;
  readonly kind: "GUARDIAN" | "STUDENT" | "STAFF" | "USER";
  readonly flags?: { readonly primary?: boolean; readonly financial?: boolean; readonly emergency?: boolean };
  readonly language?: string | null;
}

/** Valeurs de variables d'un gabarit (validées par `templating.ts`). */
export type TemplateValues = Readonly<Record<string, unknown>>;

export interface MoneyValue {
  readonly amount: number;
  readonly currency: string;
}

/** Définition d'une règle (livrée ou surchargée). */
export interface RuleDef {
  readonly key: string;
  readonly label: string;
  readonly kind: NotifRuleKind;
  /** Type d'événement, indicateur d'alerte ou `dunning`. */
  readonly trigger: string;
  readonly enabled: boolean;
  readonly templateCode: NotifTemplateCode;
  readonly audience: NotifAudience;
  readonly channels: readonly NotifChannel[];
  readonly strategy: NotifStrategy;
  readonly urgent: boolean;
  readonly conditions: NotifRuleConditions;
  readonly custom: boolean;
}

export interface TenantSettings {
  readonly enabledChannels: readonly NotifChannel[];
  readonly senderName: string | null;
  readonly replyTo: string | null;
  readonly timezone: string;
  readonly defaultDialCode: string;
  readonly quietHoursEnabled: boolean;
  readonly quietStart: string;
  readonly quietEnd: string;
  readonly dailyCaps: Readonly<Partial<Record<NotifChannel, number>>>;
  readonly perRecipientDailyCap: number;
  readonly consentModels: Readonly<Partial<Record<NotifChannel, NotifConsentModel>>>;
  readonly urgentBypassesRevocations: boolean;
  readonly maxAttempts: number;
  readonly journalRetentionDays: number;
  readonly legalFooter: string | null;
  readonly updatedAt: Date | null;
}

/** Plafonds journaliers de la plateforme (valeurs d'exploitation, surchargées par `settings.dailyCaps`). */
export const PLATFORM_DAILY_CAPS: Readonly<Record<NotifChannel, number>> = Object.freeze({
  IN_APP: 20_000,
  EMAIL: 3_000,
  SMS: 500,
  WHATSAPP: 1_500,
  PUSH: 10_000,
});

/** File d'attente maximale (remises PENDING) par établissement : au-delà, les nouvelles remises sont ignorées (anti-emballement). */
export const MAX_PENDING_PER_TENANT = 20_000;

export const DEFAULT_TENANT_SETTINGS: TenantSettings = Object.freeze({
  enabledChannels: Object.freeze(["IN_APP", "EMAIL", "SMS", "WHATSAPP", "PUSH"] as NotifChannel[]),
  senderName: null,
  replyTo: null,
  timezone: "Africa/Abidjan",
  defaultDialCode: "225",
  quietHoursEnabled: true,
  quietStart: "20:00",
  quietEnd: "07:00",
  dailyCaps: Object.freeze({}),
  perRecipientDailyCap: 10,
  consentModels: Object.freeze({}),
  urgentBypassesRevocations: false,
  maxAttempts: 5,
  journalRetentionDays: 365,
  legalFooter: null,
  updatedAt: null,
});

/** Statuts terminaux : l'adresse complète et le contenu n'ont plus d'utilité. */
export const TERMINAL_STATUSES: readonly NotifDeliveryStatus[] = Object.freeze(["SENT", "DELIVERED", "FAILED", "BOUNCED", "SKIPPED", "CANCELLED", "SIMULATED"]);

export type { NotifSkipReason as DeliverySkipReason };
