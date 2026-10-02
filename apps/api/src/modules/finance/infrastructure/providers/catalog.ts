/**
 * Catalogue des fournisseurs réels : champs de configuration (secrets ou non), contraintes de saisie, capacités.
 *
 * Source UNIQUE pour : la validation des écritures d'administration, la liste `GET /providers` (l'écran n'a aucun
 * champ codé en dur) et `requiredSettings` des définitions du registre.
 *
 * Règle : aucun point d'accès (URL) n'est un champ configurable par un tenant (SSRF) ; les URL de base sont celles du
 * code ou de l'environnement de la plateforme.
 */
export type ProviderFieldKind = "text" | "select";

export interface ProviderField {
  readonly key: string;
  readonly label: string;
  /** Secret : chiffré au repos, jamais renvoyé. */
  readonly secret: boolean;
  readonly required: boolean;
  readonly help?: string;
  readonly kind: ProviderFieldKind;
  readonly options?: readonly string[];
  /** Valeur par défaut proposée par l'écran (non secrète). */
  readonly defaultValue?: string;
  /** Généré par le serveur (jamais saisi) : régénérable à la demande. */
  readonly generated?: boolean;
  /** Motif de validation (valeurs non secrètes uniquement). */
  readonly pattern?: RegExp;
}

export interface ProviderCatalogEntry {
  readonly name: string;
  readonly label: string;
  readonly description: string;
  readonly fields: readonly ProviderField[];
  readonly supportsRefund: boolean;
  /** `signature` : HMAC du fournisseur ; `signed_url` : URL porteuse d'un jeton + vérification active. */
  readonly webhookAuth: "signature" | "signed_url";
  /** `tenant_token` : l'URL à enregistrer chez le fournisseur porte un jeton (MTN) ; `plain` sinon. */
  readonly webhookUrlStyle: "plain" | "tenant_token";
  readonly currencies: readonly string[];
}

const text = (key: string, label: string, o: Partial<ProviderField> = {}): ProviderField => ({
  key,
  label,
  secret: false,
  required: true,
  kind: "text",
  ...o,
});
const secret = (key: string, label: string, o: Partial<ProviderField> = {}): ProviderField => ({
  key,
  label,
  secret: true,
  required: true,
  kind: "text",
  ...o,
});

export const ORANGE_MONEY_ENTRY: ProviderCatalogEntry = {
  name: "orange_money",
  label: "Orange Money",
  description: "Orange Money Web Payment (Côte d'Ivoire) : page de paiement hébergée par Orange.",
  fields: [
    text("country", "Pays (code ISO, pour les chemins Orange)", { required: false, defaultValue: "ci", pattern: /^[a-z]{2}$/ }),
    text("client_id", "Client ID (portail Orange Developer)", { pattern: /^[A-Za-z0-9._-]{4,128}$/ }),
    secret("client_secret", "Client secret"),
    secret("merchant_key", "Clé marchand (merchant key)"),
    secret("webhook_secret", "Secret de notification (généré)", { generated: true, help: "Généré par la plateforme ; n'est jamais affiché." }),
  ],
  supportsRefund: false,
  webhookAuth: "signed_url",
  webhookUrlStyle: "plain",
  currencies: ["XOF"],
};

export const MTN_MOMO_ENTRY: ProviderCatalogEntry = {
  name: "mtn_momo",
  label: "MTN MoMo",
  description: "MTN Mobile Money — Collection API (Request to Pay) : le payeur valide sur son téléphone.",
  fields: [
    text("target_environment", "Environnement cible MTN (production)", { required: false, defaultValue: "mtnivorycoast", pattern: /^[a-z0-9]{3,32}$/ }),
    secret("api_user", "API user (UUID)"),
    secret("api_key", "API key"),
    secret("subscription_key", "Clé d'abonnement (Ocp-Apim-Subscription-Key)"),
    secret("webhook_secret", "Secret de rappel (généré)", { generated: true, help: "Généré ; l'URL de rappel à enregistrer chez MTN en dérive." }),
  ],
  supportsRefund: true,
  webhookAuth: "signed_url",
  webhookUrlStyle: "tenant_token",
  currencies: ["XOF"],
};

export const WAVE_ENTRY: ProviderCatalogEntry = {
  name: "wave",
  label: "Wave",
  description: "Wave Checkout API : le payeur ouvre l'application Wave.",
  fields: [
    secret("api_key", "Clé d'API Wave"),
    secret("webhook_secret", "Secret de webhook (portail Wave)", { help: "« Signing secret » (recommandé) ou « shared secret » selon la stratégie choisie." }),
    text("webhook_strategy", "Stratégie de webhook", { required: false, kind: "select", options: ["signing_secret", "shared_secret"], defaultValue: "signing_secret" }),
  ],
  supportsRefund: true,
  webhookAuth: "signature",
  webhookUrlStyle: "plain",
  currencies: ["XOF"],
};

export const CINETPAY_ENTRY: ProviderCatalogEntry = {
  name: "cinetpay",
  label: "CinetPay",
  description: "CinetPay : cartes bancaires et mobile money (Orange, MTN, Moov, Wave) sur une page unique.",
  fields: [
    text("site_id", "Identifiant du site (site_id)", { pattern: /^[0-9]{3,20}$/ }),
    secret("api_key", "Clé d'API (apikey)"),
    secret("secret_key", "Clé secrète (jeton HMAC des notifications)"),
    text("channels", "Canaux de paiement", { required: false, kind: "select", options: ["ALL", "MOBILE_MONEY", "CREDIT_CARD", "WALLET"], defaultValue: "ALL" }),
  ],
  supportsRefund: false,
  webhookAuth: "signature",
  webhookUrlStyle: "plain",
  currencies: ["XOF"],
};

export const TRESORPAY_ENTRY: ProviderCatalogEntry = {
  name: "tresorpay",
  label: "TresorPay",
  description: "TresorPay (hérité de l'application actuelle). Contrat à valider auprès du fournisseur avant production.",
  fields: [
    text("merchant_id", "Identifiant marchand", { pattern: /^[A-Za-z0-9._-]{2,64}$/ }),
    secret("api_key", "Clé d'API"),
    secret("secret_key", "Clé secrète de signature des appels"),
    secret("webhook_secret", "Secret de webhook"),
  ],
  supportsRefund: true,
  webhookAuth: "signature",
  webhookUrlStyle: "plain",
  currencies: ["XOF"],
};

export const PROVIDER_CATALOG: readonly ProviderCatalogEntry[] = Object.freeze([
  ORANGE_MONEY_ENTRY,
  MTN_MOMO_ENTRY,
  WAVE_ENTRY,
  CINETPAY_ENTRY,
  TRESORPAY_ENTRY,
]);

export const catalogEntry = (name: string): ProviderCatalogEntry | undefined => PROVIDER_CATALOG.find((e) => e.name === name);

/** Clés exigées par le registre : le mode + les champs obligatoires du catalogue. */
export const requiredSettingsOf = (entry: ProviderCatalogEntry): string[] => ["mode", ...entry.fields.filter((f) => f.required).map((f) => f.key)];

export const MAX_FIELD_LENGTH = 512;

/** Valeur de champ valide : chaîne 1..512 sans caractère de contrôle ; motif du champ pour les valeurs non secrètes. */
export function validateFieldValue(field: ProviderField, value: unknown): string | null {
  if (typeof value !== "string") return "Valeur texte attendue.";
  const v = value.trim();
  if (v.length === 0 || v.length > MAX_FIELD_LENGTH) return `Valeur de 1 à ${MAX_FIELD_LENGTH} caractères attendue.`;
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(v)) return "Caractères de contrôle interdits.";
  if (field.options && !field.options.includes(v)) return `Valeur attendue parmi : ${field.options.join(", ")}.`;
  if (!field.secret && field.pattern && !field.pattern.test(v)) return "Format invalide.";
  return null;
}
