/**
 * ProviderRegistry : fabrique PARTAGÉE des fournisseurs de paiement.
 *
 * RÈGLE DE SÉCURITÉ (plan §3.12, constat « repli silencieux en simulation ») :
 *   - hors développement/test (`staging`, `production`…), un fournisseur NON CONFIGURÉ
 *     est REFUSÉ (`finance.provider_not_configured`) ; il n'existe aucun repli vers une
 *     simulation ;
 *   - le fournisseur `sandbox` est refusé hors développement/test, sauf autorisation
 *     EXPLICITE du tenant (paramètre `allowSandbox = "true"`) — cas d'un tenant de démo ;
 *   - en développement, le repli vers la sandbox existe seulement si on l'a demandé
 *     (`devSandboxFallback: true`), il est journalisé, et les paiements concernés sont
 *     marqués `simulated`.
 *
 * Les adaptateurs réels (Orange Money, MTN MoMo, Wave, CinetPay, TresorPay) s'enregistrent par
 * `register({ name, requiredSettings, modeAware, create })` : voir `definitions.ts`
 * (`registerPaymentProviders`). Un adaptateur `modeAware` exige `settings.mode` (`sandbox` | `production`,
 * sans défaut) ; `sandbox` est refusé en environnement `production`. Un fournisseur désactivé par le
 * tenant (`settings.enabled = "false"`) répond `finance.provider_disabled`.
 */
import { createHash, randomBytes } from "node:crypto";
import { err, noopLogger, ok, type AppError, type Logger, type Result } from "@ecoledigitale/kernel";
import { FinanceCode, conflict } from "../../domain/errors";
import type { ProviderAccount } from "../../domain/types";
import type { PaymentProvider } from "../../application/ports/payment-provider";
import { SANDBOX_PROVIDER_NAME, SandboxProvider } from "./sandbox-provider";

export type AppEnvironment = "development" | "test" | "staging" | "production";

export const isDevLikeEnvironment = (env: AppEnvironment): boolean => env === "development" || env === "test";

/** Paramètres d'un fournisseur pour un tenant (clés API, secrets, URLs). Jamais journalisés. */
export type ProviderSettings = Readonly<Record<string, string | undefined>>;

/**
 * Compte fournisseur utilisé pour un paiement (Q-PAY-30) :
 *   - `TENANT`   : le compte marchand PROPRE de l'établissement (`finance.provider_configs`, secrets scellés) ;
 *   - `PLATFORM` : le compte marchand de la PLATEFORME (configuration d'environnement, partagée), utilisé seulement
 *                  quand l'établissement n'a aucune configuration propre pour ce fournisseur.
 * Le compte est ENREGISTRÉ sur le paiement à l'initiation : la vérification, le webhook, le rapprochement et le
 * remboursement interrogent TOUJOURS ce compte-là, même si l'établissement configure le sien ensuite.
 */
export type { ProviderAccount };

export interface AccountedSettings {
  readonly account: ProviderAccount;
  readonly settings: ProviderSettings;
}

export interface ProviderConfigSource {
  get(tenantId: string, provider: string): Promise<ProviderSettings | null>;
  /**
   * Même lecture, avec le compte d'origine. `wanted` fige le compte (paiement déjà initié) ; sans lui : compte propre
   * s'il existe, sinon repli sur le compte plateforme (si autorisé). Source sans cette méthode : tout est `TENANT`.
   */
  getAccount?(tenantId: string, provider: string, wanted?: ProviderAccount): Promise<AccountedSettings | null>;
  /** Réglages du compte PLATEFORME de ce fournisseur (indépendants de tout établissement), ou `null`. */
  platformSettings?(provider: string): Promise<ProviderSettings | null>;
}

/** Configuration statique en mémoire (tests, développement). */
export class StaticProviderConfigSource implements ProviderConfigSource {
  private readonly map = new Map<string, ProviderSettings>();
  set(tenantId: string, provider: string, settings: ProviderSettings): this {
    this.map.set(`${tenantId}:${provider}`, settings);
    return this;
  }
  async get(tenantId: string, provider: string): Promise<ProviderSettings | null> {
    return this.map.get(`${tenantId}:${provider}`) ?? null;
  }
}

/**
 * Lit la configuration dans l'environnement du processus :
 * `FINANCE_PROVIDER_<NOM>_<CLÉ>` (ex. `FINANCE_PROVIDER_WAVE_API_KEY`), identique pour
 * tous les tenants. Les configurations par tenant passent par une source dédiée.
 */
export class EnvProviderConfigSource implements ProviderConfigSource {
  constructor(private readonly env: Readonly<Record<string, string | undefined>> = process.env) {}
  async get(_tenantId: string, provider: string): Promise<ProviderSettings | null> {
    const prefix = `FINANCE_PROVIDER_${provider.toUpperCase().replace(/[^A-Z0-9]/g, "_")}_`;
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(this.env)) {
      if (k.startsWith(prefix) && typeof v === "string" && v !== "") out[k.slice(prefix.length).toLowerCase()] = v;
    }
    return Object.keys(out).length > 0 ? out : null;
  }
}

export interface ProviderFactoryContext {
  readonly tenantId: string;
  readonly settings: ProviderSettings;
  readonly environment: AppEnvironment;
}

export interface ProviderDefinition {
  /** Nom stable, stocké sur les paiements (`orange_money`, `wave`, `sandbox`…). */
  readonly name: string;
  /** Clés de configuration obligatoires (sinon `finance.provider_not_configured`). */
  readonly requiredSettings: readonly string[];
  /** Marque un fournisseur simulé : soumis à la règle sandbox. */
  readonly sandbox?: boolean;
  /**
   * Adaptateur RÉEL à deux modes (`settings.mode` = `sandbox` | `production`, explicite, sans défaut) : le mode
   * `sandbox` (serveurs de test du fournisseur) est refusé en environnement `production`.
   */
  readonly modeAware?: boolean;
  create(context: ProviderFactoryContext): PaymentProvider;
}

export interface ProviderRegistryOptions {
  environment: AppEnvironment;
  configSource?: ProviderConfigSource;
  logger?: Logger;
  /** Développement uniquement : repli EXPLICITE vers la sandbox si un fournisseur n'est pas configuré. */
  devSandboxFallback?: boolean;
}

export class ProviderRegistry {
  private readonly definitions = new Map<string, ProviderDefinition>();
  private readonly instances = new Map<string, PaymentProvider>();
  private readonly environment: AppEnvironment;
  private readonly configSource: ProviderConfigSource;
  private readonly logger: Logger;
  private readonly devSandboxFallback: boolean;

  constructor(options: ProviderRegistryOptions) {
    this.environment = options.environment;
    this.configSource = options.configSource ?? new StaticProviderConfigSource();
    this.logger = options.logger ?? noopLogger;
    this.devSandboxFallback = Boolean(options.devSandboxFallback) && isDevLikeEnvironment(options.environment);
  }

  register(definition: ProviderDefinition): this {
    if (!/^[a-z][a-z0-9_]{1,39}$/.test(definition.name)) {
      throw new Error(`Nom de fournisseur invalide : "${definition.name}".`);
    }
    if (this.definitions.has(definition.name)) throw new Error(`Fournisseur déjà enregistré : "${definition.name}".`);
    this.definitions.set(definition.name, definition);
    return this;
  }

  names(): string[] {
    return [...this.definitions.keys()].sort();
  }

  has(name: string): boolean {
    return this.definitions.has(name);
  }

  getEnvironment(): AppEnvironment {
    return this.environment;
  }

  /**
   * Fournisseur prêt à l'emploi pour ce tenant, ou refus explicite. `options.account` fige le compte (paiement déjà
   * initié sur ce compte) ; sans lui : compte de l'établissement, sinon compte plateforme (Q-PAY-30).
   */
  async resolve(tenantId: string, name: string, options: { account?: ProviderAccount | null } = {}): Promise<Result<PaymentProvider, AppError>> {
    const r = await this.resolveAccounted(tenantId, name, options);
    return r.ok ? ok(r.value.provider) : r;
  }

  /** Comme `resolve`, avec le compte réellement utilisé (à enregistrer sur le paiement à l'initiation). */
  async resolveAccounted(
    tenantId: string,
    name: string,
    options: { account?: ProviderAccount | null } = {},
  ): Promise<Result<{ provider: PaymentProvider; account: ProviderAccount }, AppError>> {
    const def = this.definitions.get(name);
    if (!def) {
      return err(conflict(FinanceCode.PROVIDER_UNKNOWN, `Fournisseur de paiement inconnu : "${name}".`, { provider: name }));
    }
    const wanted = options.account ?? undefined;
    let account: ProviderAccount = wanted ?? "TENANT";
    let settings: ProviderSettings = {};
    if (this.configSource.getAccount) {
      const found = await this.configSource.getAccount(tenantId, name, wanted);
      if (found) {
        account = found.account;
        settings = found.settings;
      }
    } else {
      settings = (await this.configSource.get(tenantId, name)) ?? {};
    }
    const resolved = await this.resolveWith(tenantId, name, settings);
    return resolved.ok ? ok({ provider: resolved.value, account }) : resolved;
  }

  /**
   * Le compte PLATEFORME de ce fournisseur est-il complet, donc utilisable par un établissement qui n'a pas le sien ?
   * (écran d'administration). Aucun secret n'est exposé.
   */
  async platformAccountReady(name: string): Promise<boolean> {
    const def = this.definitions.get(name);
    if (!def || def.sandbox || !this.configSource.platformSettings) return false;
    const settings = await this.configSource.platformSettings(name);
    if (!settings || settings.enabled === "false") return false;
    return def.requiredSettings.every((k) => settings[k] !== undefined && String(settings[k]).trim() !== "");
  }

  /**
   * Mêmes règles que `resolve`, avec des réglages fournis par l'appelant (test de connexion de l'écran d'administration :
   * un fournisseur désactivé peut être testé, jamais utilisé pour un paiement).
   */
  async resolveWith(
    tenantId: string,
    name: string,
    settings: ProviderSettings,
    options: { ignoreDisabled?: boolean } = {},
  ): Promise<Result<PaymentProvider, AppError>> {
    const def = this.definitions.get(name);
    if (!def) {
      return err(conflict(FinanceCode.PROVIDER_UNKNOWN, `Fournisseur de paiement inconnu : "${name}".`, { provider: name }));
    }
    if (!def.sandbox && settings.enabled === "false" && !options.ignoreDisabled) {
      return err(conflict(FinanceCode.PROVIDER_DISABLED, `Le fournisseur "${name}" est désactivé pour cet établissement.`, { provider: name }));
    }

    if (def.sandbox) {
      // `EnvProviderConfigSource` met les clés en minuscules (`allowsandbox`) : on accepte les deux écritures,
      // sinon l'autorisation d'un tenant de démonstration ne pouvait jamais être exprimée par l'environnement.
      const allowSandbox = settings.allowSandbox === "true" || settings.allowsandbox === "true";
      if (!isDevLikeEnvironment(this.environment) && !allowSandbox) {
        return err(
          conflict(
            FinanceCode.PROVIDER_SANDBOX_FORBIDDEN,
            "Le fournisseur de simulation est interdit hors développement (autorisation explicite du tenant requise).",
            { provider: name, environment: this.environment },
          ),
        );
      }
      return ok(this.instance(tenantId, def, settings));
    }

    const missing = def.requiredSettings.filter((k) => !settings[k] || String(settings[k]).trim() === "");
    if (def.modeAware && missing.length === 0) {
      const mode = settings.mode;
      if (mode !== "sandbox" && mode !== "production") {
        return err(conflict(FinanceCode.PROVIDER_CONFIG_INVALID, `Le mode du fournisseur "${name}" doit être "sandbox" ou "production".`, { provider: name }));
      }
      if (mode === "sandbox" && this.environment === "production") {
        return err(
          conflict(FinanceCode.PROVIDER_SANDBOX_FORBIDDEN, "Le mode sandbox d'un fournisseur est interdit en environnement de production.", {
            provider: name,
            environment: this.environment,
          }),
        );
      }
    }
    if (missing.length > 0) {
      const sandboxDef = this.devSandboxFallback ? this.definitions.get(SANDBOX_PROVIDER_NAME) : undefined;
      if (sandboxDef) {
        this.logger.warn(
          { provider: name, missing },
          "Fournisseur non configuré : repli EXPLICITE vers la sandbox (développement uniquement).",
        );
        return ok(this.instance(tenantId, sandboxDef, (await this.configSource.get(tenantId, SANDBOX_PROVIDER_NAME)) ?? {}));
      }
      // Seuls les NOMS des paramètres manquants sont exposés, jamais de valeur.
      return err(
        conflict(FinanceCode.PROVIDER_NOT_CONFIGURED, `Le fournisseur "${name}" n'est pas configuré pour ce tenant.`, {
          provider: name,
          missing,
        }),
      );
    }
    return ok(this.instance(tenantId, def, settings));
  }

  private instance(tenantId: string, def: ProviderDefinition, settings: ProviderSettings): PaymentProvider {
    // L'instance est mise en cache par (tenant, fournisseur, configuration) : une
    // configuration modifiée produit une nouvelle instance ; la sandbox garde son état.
    // Empreinte HACHÉE : aucun secret ne traîne en clair dans les clés de la table.
    const fingerprint = createHash("sha256")
      .update(
        Object.keys(settings)
          .sort()
          .map((k) => `${k}=${settings[k] ?? ""}`)
          .join("&"),
      )
      .digest("hex");
    const key = `${tenantId}|${def.name}|${fingerprint}`;
    let instance = this.instances.get(key);
    if (!instance) {
      instance = def.create({ tenantId, settings, environment: this.environment });
      this.instances.set(key, instance);
    }
    return instance;
  }
}

/** Définition de la sandbox (secret de webhook : paramètre `secret`). */
export const sandboxDefinition: ProviderDefinition = Object.freeze({
  name: SANDBOX_PROVIDER_NAME,
  requiredSettings: [],
  sandbox: true,
  // Hors dev/test, jamais de secret par défaut public : sans `secret` explicite, un secret aléatoire propre au
  // processus est tiré (un webhook sandbox signé avec la valeur publique est alors rejeté).
  create: ({ settings, environment }: ProviderFactoryContext): PaymentProvider =>
    new SandboxProvider(
      settings.secret
        ? { secret: settings.secret }
        : isDevLikeEnvironment(environment)
          ? {}
          : { secret: randomBytes(32).toString("hex") },
    ),
});

/** Registre prêt à l'emploi : sandbox enregistrée (donc refusée hors dev), aucun adaptateur réel. */
export function createProviderRegistry(options: ProviderRegistryOptions): ProviderRegistry {
  return new ProviderRegistry(options).register(sandboxDefinition);
}
