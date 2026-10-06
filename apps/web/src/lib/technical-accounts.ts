/**
 * Technical accounts helper (web side, client-safe part).
 *
 * The account list itself — emails AND passwords — lives in
 * `technical-accounts.server.ts` and only reaches the browser through
 * `/api/technical-accounts`, which refuses to answer unless the panel is
 * explicitly enabled. Nothing sensitive may be added to this file: it is part
 * of the client bundle, so anything declared here is readable by any visitor
 * of the login page.
 */

/** localStorage key written by the super-admin "Selectionner" button. */
export const SELECTED_TENANT_STORAGE_KEY = "superAdminSelectedTenant";

/**
 * localStorage key holding the list of known tenants, cached by the super-admin
 * tenants page so the login page can populate its tenant selector without a
 * dedicated endpoint.
 */
export const KNOWN_TENANTS_STORAGE_KEY = "knownTenants";

export type TechnicalAccount = {
  email: string;
  password: string;
  role: string;
  name: string;
  /** Slug de l'établissement (comptes issus de `DEV_CREDENTIALS_FILE`). */
  tenant?: string;
  /** Libellé lisible du rôle, en français. */
  label?: string;
  /** Le compte exige un code MFA : voir `GET /api/technical-accounts/totp`. Le secret TOTP, lui, ne quitte jamais le serveur. */
  mfa?: boolean;
};

/** Shape returned by `GET /api/technical-accounts/totp?email=…`. */
export type TechnicalAccountTotpResponse = {
  /** Code à 6 chiffres valable pour la fenêtre de 30 s en cours. */
  code: string;
  /** Secondes restantes avant le changement de code. */
  expiresIn: number;
};

/** Shape returned by `GET /api/technical-accounts`. */
export type TechnicalAccountsResponse = {
  enabled: boolean;
  accounts: TechnicalAccount[];
};
