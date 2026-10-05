/**
 * Administration des fournisseurs de paiement d'un établissement (spec 015-payments) :
 * lister, enregistrer les identifiants marchands, activer / désactiver, tester la connexion, effacer, faire tourner
 * les clés de chiffrement.
 *
 * Règles de sécurité :
 *  - AUCUN secret ne sort de ce module : les vues disent seulement « enregistré ou non » ;
 *  - les secrets sont scellés par le `SecretStorePort` AVANT d'atteindre la base (contrainte SQL en second rempart) ;
 *  - le coffre indisponible (aucune clé maître) refuse toute saisie : jamais de repli en clair ;
 *  - chaque écriture est auditée (sensible) avec les NOMS des champs, jamais une valeur ; chaque ouverture d'un secret
 *    pour un usage de l'administration est auditée (`finance.provider_secret.accessed`) ;
 *  - un fournisseur dont la configuration devient incomplète est désactivé d'office ;
 *  - un test de connexion ne crée JAMAIS de paiement et est espacé (3 s par tenant et fournisseur).
 */
import { randomBytes } from "node:crypto";
import { err, ok, type AppError, type RequestContext, type Result } from "@ecoledigitale/kernel";
import { FinanceCode, conflict, notFound, validation } from "../domain/errors";
import type { ProviderAccount } from "../domain/types";
import {
  getProviderConfig,
  listProviderConfigs,
  recordProviderTest,
  upsertProviderConfig,
  type ProviderConfigRecord,
  type ProviderMode,
} from "../infrastructure/provider-config-repository";
import { PROVIDER_CATALOG, catalogEntry, requiredSettingsOf, validateFieldValue, type ProviderCatalogEntry } from "../infrastructure/providers/catalog";
import { webhookUrlToken } from "../infrastructure/providers/common";
import type { AppEnvironment } from "../infrastructure/providers/registry";
import { EventBuffer, inTx, type FinanceDeps } from "./deps";
import { SecretStoreError } from "./ports/secret-store";

export const PROVIDER_TEST_MIN_INTERVAL_MS = 3_000;

export interface ProviderFieldView {
  readonly key: string;
  readonly label: string;
  readonly secret: boolean;
  readonly required: boolean;
  readonly kind: "text" | "select";
  readonly options?: readonly string[];
  readonly defaultValue?: string;
  readonly generated: boolean;
  readonly help?: string;
  readonly isSet: boolean;
  /** Valeur d'un champ NON secret ; toujours `null` pour un secret. */
  readonly value: string | null;
}

export interface ProviderView {
  readonly provider: string;
  readonly label: string;
  readonly description: string;
  readonly enabled: boolean;
  readonly configured: boolean;
  readonly complete: boolean;
  readonly missing: readonly string[];
  readonly mode: ProviderMode | null;
  readonly sandboxAllowed: boolean;
  readonly supportsRefund: boolean;
  readonly webhookAuth: "signature" | "signed_url";
  readonly webhookUrl: string | null;
  readonly fields: readonly ProviderFieldView[];
  readonly lastTest: { at: Date; ok: boolean; code: string } | null;
  readonly updatedAt: Date | null;
  /** Q-PAY-30 : compte qui recevrait un paiement aujourd'hui (`TENANT` : configuration de l'école ; `PLATFORM` : repli ; `null` : aucun). */
  readonly activeAccount: ProviderAccount | null;
  /** Le compte de la plateforme est complet pour ce fournisseur (repli possible si l'école n'a pas le sien). */
  readonly platformFallbackReady: boolean;
}

export interface ProviderListView {
  readonly items: readonly ProviderView[];
  readonly secretsAvailable: boolean;
  readonly environment: AppEnvironment;
}

const sandboxAllowedIn = (env: AppEnvironment): boolean => env !== "production";

export const webhookEndpoint = (baseUrl: string, provider: string, tenantId: string): string =>
  `${baseUrl.replace(/\/+$/, "")}/api/v1/finance/webhooks/${encodeURIComponent(provider)}/${tenantId}`;

/** Champs obligatoires encore absents (mode compris). */
function missingOf(entry: ProviderCatalogEntry, row: ProviderConfigRecord | null): string[] {
  if (!row) return requiredSettingsOf(entry);
  return requiredSettingsOf(entry).filter((k) => (k === "mode" ? false : !(k in row.settings) && !(k in row.secrets)));
}

async function viewOf(
  deps: FinanceDeps,
  ctx: RequestContext,
  events: EventBuffer,
  entry: ProviderCatalogEntry,
  row: ProviderConfigRecord | null,
): Promise<ProviderView> {
  const missing = missingOf(entry, row);
  const platformFallbackReady = await deps.providers.platformAccountReady(entry.name);
  let webhookUrl: string | null = null;
  const base = deps.config.webhookBaseUrl;
  if (base) {
    webhookUrl = webhookEndpoint(base, entry.name, ctx.tenantId);
    if (entry.webhookUrlStyle === "tenant_token" && row?.secrets.webhook_secret) {
      try {
        const secret = await deps.secrets.open({ tenantId: ctx.tenantId, provider: entry.name, field: "webhook_secret" }, row.secrets.webhook_secret);
        webhookUrl = `${webhookUrl}?t=${webhookUrlToken(secret, ctx.tenantId, entry.name)}`;
        events.audit({
          action: "finance.provider_secret.accessed",
          resourceType: "provider_config",
          resourceId: row.id,
          sensitive: true,
          metadata: { provider: entry.name, fields: ["webhook_secret"], purpose: "webhook_url" },
        });
      } catch {
        webhookUrl = null; // secret illisible : pas d'URL plutôt qu'une URL fausse
      }
    }
  }
  return {
    provider: entry.name,
    label: entry.label,
    description: entry.description,
    enabled: row?.enabled ?? false,
    configured: row !== null,
    complete: row !== null && missing.length === 0,
    missing,
    mode: row?.mode ?? null,
    sandboxAllowed: sandboxAllowedIn(deps.config.environment),
    supportsRefund: entry.supportsRefund,
    webhookAuth: entry.webhookAuth,
    webhookUrl,
    fields: entry.fields.map((f) => ({
      key: f.key,
      label: f.label,
      secret: f.secret,
      required: f.required,
      kind: f.kind,
      ...(f.options ? { options: f.options } : {}),
      ...(f.defaultValue ? { defaultValue: f.defaultValue } : {}),
      generated: f.generated ?? false,
      ...(f.help ? { help: f.help } : {}),
      isSet: f.secret ? Boolean(row?.secrets[f.key]) : row?.settings[f.key] !== undefined,
      value: f.secret ? null : (row?.settings[f.key] ?? null),
    })),
    lastTest: row && row.lastTestAt && row.lastTestOk !== null && row.lastTestCode ? { at: row.lastTestAt, ok: row.lastTestOk, code: row.lastTestCode } : null,
    updatedAt: row?.updatedAt ?? null,
    activeAccount: row ? "TENANT" : platformFallbackReady ? "PLATFORM" : null,
    platformFallbackReady,
  };
}

// ---------------------------------------------------------------------------
// Lecture
// ---------------------------------------------------------------------------

export async function listProviders(deps: FinanceDeps, ctx: RequestContext): Promise<Result<ProviderListView, AppError>> {
  return inTx(deps, ctx, async (tx) => {
    const events = new EventBuffer(deps, ctx);
    const rows = new Map((await listProviderConfigs(tx)).map((r) => [r.provider, r]));
    const items: ProviderView[] = [];
    for (const entry of PROVIDER_CATALOG) items.push(await viewOf(deps, ctx, events, entry, rows.get(entry.name) ?? null));
    await events.flush(tx);
    return ok({ items, secretsAvailable: deps.secrets.available, environment: deps.config.environment });
  });
}

// ---------------------------------------------------------------------------
// Écriture
// ---------------------------------------------------------------------------

export interface SaveProviderInput {
  provider: string;
  mode?: ProviderMode;
  settings?: Readonly<Record<string, string>>;
  secrets?: Readonly<Record<string, string>>;
  clearSecrets?: readonly string[];
  regenerateWebhookSecret?: boolean;
}

function entryOf(deps: FinanceDeps, provider: string): Result<ProviderCatalogEntry, AppError> {
  const entry = catalogEntry(provider);
  if (!entry || !deps.providers.has(provider)) {
    return err(conflict(FinanceCode.PROVIDER_UNKNOWN, `Fournisseur de paiement inconnu : "${provider}".`, { provider }));
  }
  return ok(entry);
}

const secretsUnavailable = (): AppError =>
  conflict(FinanceCode.SECRETS_UNAVAILABLE, "Le coffre des secrets n'est pas configuré : les identifiants ne peuvent pas être enregistrés.");

const sandboxForbidden = (env: AppEnvironment): AppError =>
  conflict(FinanceCode.PROVIDER_SANDBOX_FORBIDDEN, "Le mode sandbox d'un fournisseur est interdit en environnement de production.", { environment: env });

function validateInput(entry: ProviderCatalogEntry, input: SaveProviderInput): AppError | null {
  const byKey = new Map(entry.fields.map((f) => [f.key, f]));
  for (const [key, value] of Object.entries(input.settings ?? {})) {
    const f = byKey.get(key);
    if (!f || f.secret) return validation(FinanceCode.INVALID_INPUT, `Réglage inconnu : "${key}".`, ["settings", key]);
    const problem = validateFieldValue(f, value);
    if (problem) return validation(FinanceCode.INVALID_INPUT, problem, ["settings", key]);
  }
  for (const [key, value] of Object.entries(input.secrets ?? {})) {
    const f = byKey.get(key);
    if (!f || !f.secret || f.generated) return validation(FinanceCode.INVALID_INPUT, `Secret inconnu ou généré par la plateforme : "${key}".`, ["secrets", key]);
    const problem = validateFieldValue(f, value);
    if (problem) return validation(FinanceCode.INVALID_INPUT, problem, ["secrets", key]);
  }
  for (const key of input.clearSecrets ?? []) {
    const f = byKey.get(key);
    if (!f || !f.secret) return validation(FinanceCode.INVALID_INPUT, `Secret inconnu : "${key}".`, ["clearSecrets"]);
  }
  return null;
}

export async function saveProviderConfig(deps: FinanceDeps, ctx: RequestContext, input: SaveProviderInput): Promise<Result<ProviderView, AppError>> {
  const entry = entryOf(deps, input.provider);
  if (!entry.ok) return entry;
  const invalid = validateInput(entry.value, input);
  if (invalid) return err(invalid);
  if (!deps.secrets.available) return err(secretsUnavailable());
  if (input.mode === "sandbox" && !sandboxAllowedIn(deps.config.environment)) return err(sandboxForbidden(deps.config.environment));

  const result = await inTx(deps, ctx, async (tx) => {
    const events = new EventBuffer(deps, ctx);
    const existing = await getProviderConfig(tx, input.provider, true);
    const mode = input.mode ?? existing?.mode;
    if (!mode) return err(validation(FinanceCode.INVALID_INPUT, "Le mode (sandbox ou production) est obligatoire.", "mode"));

    const settings: Record<string, string> = { ...(existing?.settings ?? {}) };
    for (const [k, v] of Object.entries(input.settings ?? {})) settings[k] = v.trim();

    const secrets: Record<string, string> = { ...(existing?.secrets ?? {}) };
    const changed: string[] = [];
    const cleared: string[] = [];
    for (const key of input.clearSecrets ?? []) {
      if (key in secrets) {
        delete secrets[key];
        cleared.push(key);
      }
    }
    try {
      for (const [key, value] of Object.entries(input.secrets ?? {})) {
        secrets[key] = await deps.secrets.seal({ tenantId: ctx.tenantId, provider: input.provider, field: key }, value.trim());
        changed.push(key);
      }
      // Secrets générés par la plateforme (secret de notification Orange / MTN) : créés une fois, régénérables.
      for (const f of entry.value.fields) {
        if (f.secret && f.generated && (!secrets[f.key] || input.regenerateWebhookSecret)) {
          secrets[f.key] = await deps.secrets.seal({ tenantId: ctx.tenantId, provider: input.provider, field: f.key }, randomBytes(32).toString("base64url"));
          changed.push(f.key);
        }
      }
    } catch (e) {
      if (e instanceof SecretStoreError) return err(secretsUnavailable());
      throw e;
    }

    const draft: ProviderConfigRecord = { ...(existing ?? emptyRecord(input.provider, deps.newId())), mode, settings, secrets };
    const complete = missingOf(entry.value, draft).length === 0;
    const enabled = (existing?.enabled ?? false) && complete;

    const saved = await upsertProviderConfig(tx, ctx.tenantId, {
      id: existing?.id ?? deps.newId(),
      provider: input.provider,
      enabled,
      mode,
      settings,
      secrets,
      actorId: ctx.userId,
      at: deps.clock.now(),
    });
    events.audit({
      action: "finance.provider.configured",
      resourceType: "provider_config",
      resourceId: saved.id,
      sensitive: true,
      before: existing ? { mode: existing.mode, enabled: existing.enabled } : null,
      after: { provider: input.provider, mode, enabled },
      // Jamais de valeur : uniquement des NOMS de champs.
      metadata: {
        settingFields: Object.keys(input.settings ?? {}),
        secretFieldsChanged: changed,
        secretFieldsCleared: cleared,
        disabledBecauseIncomplete: Boolean(existing?.enabled) && !enabled,
      },
    });
    const view = await viewOf(deps, ctx, events, entry.value, saved);
    await events.flush(tx);
    return ok(view);
  });
  if (result.ok) deps.providerConfigChanged(ctx.tenantId, input.provider);
  return result;
}

function emptyRecord(provider: string, id: string): ProviderConfigRecord {
  return { id, provider, enabled: false, mode: "sandbox", settings: {}, secrets: {}, lastTestAt: null, lastTestOk: null, lastTestCode: null, updatedAt: new Date(0) };
}

export async function setProviderStatus(
  deps: FinanceDeps,
  ctx: RequestContext,
  input: { provider: string; enabled: boolean },
): Promise<Result<ProviderView, AppError>> {
  const entry = entryOf(deps, input.provider);
  if (!entry.ok) return entry;
  const result = await inTx(deps, ctx, async (tx) => {
    const events = new EventBuffer(deps, ctx);
    const row = await getProviderConfig(tx, input.provider, true);
    if (!row) {
      return err(conflict(FinanceCode.PROVIDER_NOT_CONFIGURED, "Le fournisseur n'est pas configuré.", { provider: input.provider, missing: requiredSettingsOf(entry.value) }));
    }
    if (input.enabled) {
      const missing = missingOf(entry.value, row);
      if (missing.length > 0) {
        return err(conflict(FinanceCode.PROVIDER_NOT_CONFIGURED, "La configuration du fournisseur est incomplète.", { provider: input.provider, missing }));
      }
      if (row.mode === "sandbox" && !sandboxAllowedIn(deps.config.environment)) return err(sandboxForbidden(deps.config.environment));
    }
    const saved = row.enabled === input.enabled
      ? row
      : await upsertProviderConfig(tx, ctx.tenantId, {
          id: row.id,
          provider: row.provider,
          enabled: input.enabled,
          mode: row.mode,
          settings: row.settings,
          secrets: row.secrets,
          actorId: ctx.userId,
          at: deps.clock.now(),
        });
    if (row.enabled !== input.enabled) {
      events.audit({
        action: "finance.provider.status_changed",
        resourceType: "provider_config",
        resourceId: row.id,
        sensitive: true,
        before: { enabled: row.enabled },
        after: { enabled: input.enabled, provider: input.provider, mode: row.mode },
      });
    }
    const view = await viewOf(deps, ctx, events, entry.value, saved);
    await events.flush(tx);
    return ok(view);
  });
  if (result.ok) deps.providerConfigChanged(ctx.tenantId, input.provider);
  return result;
}

export async function clearProviderCredentials(deps: FinanceDeps, ctx: RequestContext, input: { provider: string }): Promise<Result<ProviderView, AppError>> {
  const entry = entryOf(deps, input.provider);
  if (!entry.ok) return entry;
  const result = await inTx(deps, ctx, async (tx) => {
    const events = new EventBuffer(deps, ctx);
    const row = await getProviderConfig(tx, input.provider, true);
    if (!row) return err(notFound(FinanceCode.NOT_FOUND, "Configuration du fournisseur", input.provider));
    const saved = await upsertProviderConfig(tx, ctx.tenantId, {
      id: row.id,
      provider: row.provider,
      enabled: false,
      mode: row.mode,
      settings: row.settings,
      secrets: {},
      actorId: ctx.userId,
      at: deps.clock.now(),
    });
    events.audit({
      action: "finance.provider.credentials_cleared",
      resourceType: "provider_config",
      resourceId: row.id,
      sensitive: true,
      before: { enabled: row.enabled },
      after: { enabled: false, provider: input.provider },
      metadata: { secretFieldsCleared: Object.keys(row.secrets) },
    });
    const view = await viewOf(deps, ctx, events, entry.value, saved);
    await events.flush(tx);
    return ok(view);
  });
  if (result.ok) deps.providerConfigChanged(ctx.tenantId, input.provider);
  return result;
}

// ---------------------------------------------------------------------------
// Test de connexion
// ---------------------------------------------------------------------------

const lastTestAt = new Map<string, number>();

export interface ProviderTestResult {
  readonly ok: boolean;
  readonly code: string;
  readonly at: Date;
}

export async function testProviderConnection(deps: FinanceDeps, ctx: RequestContext, input: { provider: string }): Promise<Result<ProviderTestResult, AppError>> {
  const entry = entryOf(deps, input.provider);
  if (!entry.ok) return entry;
  const throttleKey = `${ctx.tenantId}|${input.provider}`;
  const now = deps.clock.now();
  const previous = lastTestAt.get(throttleKey);
  if (previous !== undefined && now.getTime() - previous < PROVIDER_TEST_MIN_INTERVAL_MS) {
    return err(conflict(FinanceCode.PROVIDER_TEST_THROTTLED, "Test de connexion trop fréquent : patientez quelques secondes.", { provider: input.provider }));
  }
  lastTestAt.set(throttleKey, now.getTime());

  // 1. Lire et ouvrir les secrets (auditée).
  const opened = await inTx(deps, ctx, async (tx) => {
    const events = new EventBuffer(deps, ctx);
    const row = await getProviderConfig(tx, input.provider);
    if (!row) {
      return err(conflict(FinanceCode.PROVIDER_NOT_CONFIGURED, "Le fournisseur n'est pas configuré.", { provider: input.provider, missing: requiredSettingsOf(entry.value) }));
    }
    const settings: Record<string, string> = { ...row.settings, mode: row.mode, enabled: "true" };
    const fields: string[] = [];
    for (const [field, envelope] of Object.entries(row.secrets)) {
      try {
        settings[field] = await deps.secrets.open({ tenantId: ctx.tenantId, provider: input.provider, field }, envelope);
        fields.push(field);
      } catch (e) {
        if (e instanceof SecretStoreError) return err(secretsUnavailable());
        throw e;
      }
    }
    if (fields.length > 0) {
      events.audit({
        action: "finance.provider_secret.accessed",
        resourceType: "provider_config",
        resourceId: row.id,
        sensitive: true,
        metadata: { provider: input.provider, fields, purpose: "test" },
      });
    }
    await events.flush(tx);
    return ok(settings);
  });
  if (!opened.ok) return opened;

  // 2. Construire l'adaptateur avec les mêmes règles que le registre (hors statut activé) et tester (appel réseau, hors transaction).
  const resolved = await deps.providers.resolveWith(ctx.tenantId, input.provider, opened.value, { ignoreDisabled: true });
  if (!resolved.ok) return resolved;
  let outcome: { ok: boolean; code: string };
  if (!resolved.value.testConnection) {
    outcome = { ok: false, code: "not_supported" };
  } else {
    const checked = await resolved.value.testConnection();
    outcome = checked.ok ? { ok: checked.value.ok, code: checked.value.code } : { ok: false, code: "unreachable" };
  }

  // 3. Enregistrer le résultat (code court uniquement) + audit.
  const at = deps.clock.now();
  await inTx(deps, ctx, async (tx) => {
    const events = new EventBuffer(deps, ctx);
    const row = await getProviderConfig(tx, input.provider, true);
    if (row) {
      await recordProviderTest(tx, input.provider, { ok: outcome.ok, code: outcome.code, at });
      events.audit({
        action: "finance.provider.tested",
        resourceType: "provider_config",
        resourceId: row.id,
        sensitive: true,
        after: { provider: input.provider, mode: row.mode, ok: outcome.ok, code: outcome.code },
      });
      await events.flush(tx);
    }
    return ok(null);
  });
  return ok({ ok: outcome.ok, code: outcome.code, at });
}

// ---------------------------------------------------------------------------
// Rotation des clés de chiffrement
// ---------------------------------------------------------------------------

/** Rechiffre avec la clé ACTIVE les secrets du tenant scellés par une ancienne clé. */
export async function rotateProviderSecrets(deps: FinanceDeps, ctx: RequestContext): Promise<Result<{ rotated: number; keyId: string }, AppError>> {
  const keyId = deps.secrets.activeKeyId;
  if (!deps.secrets.available || !keyId) return err(secretsUnavailable());
  const result = await inTx(deps, ctx, async (tx) => {
    const events = new EventBuffer(deps, ctx);
    let rotated = 0;
    for (const row of await listProviderConfigs(tx)) {
      const stale = Object.entries(row.secrets).filter(([, env]) => !deps.secrets.isCurrent(env));
      if (stale.length === 0) continue;
      const secrets: Record<string, string> = { ...row.secrets };
      try {
        for (const [field, envelope] of stale) {
          const scope = { tenantId: ctx.tenantId, provider: row.provider, field };
          secrets[field] = await deps.secrets.seal(scope, await deps.secrets.open(scope, envelope));
        }
      } catch (e) {
        if (e instanceof SecretStoreError) {
          return err(conflict(FinanceCode.SECRETS_UNAVAILABLE, "Un secret n'a pas pu être rechiffré (clé de l'ancien chiffrement absente du trousseau).", { provider: row.provider, reason: e.reason }));
        }
        throw e;
      }
      await upsertProviderConfig(tx, ctx.tenantId, {
        id: row.id,
        provider: row.provider,
        enabled: row.enabled,
        mode: row.mode,
        settings: row.settings,
        secrets,
        actorId: ctx.userId,
        at: deps.clock.now(),
      });
      events.audit({
        action: "finance.provider.secrets_rotated",
        resourceType: "provider_config",
        resourceId: row.id,
        sensitive: true,
        metadata: { provider: row.provider, fields: stale.map(([f]) => f), keyId },
      });
      rotated++;
    }
    await events.flush(tx);
    return ok({ rotated, keyId });
  });
  if (result.ok) deps.providerConfigChanged(ctx.tenantId, "");
  return result;
}

