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
 * Les adaptateurs réels (Orange Money, MTN MoMo, Wave, CinetPay, TresorPay) se branchent
 * en Phase 3 par `register({ name, requiredSettings, create })` ; aucun n'est écrit ici.
 */
import { err, noopLogger, ok, type AppError, type Logger, type Result } from "@ecoledigitale/kernel";
import { FinanceCode, conflict } from "../../domain/errors";
import type { PaymentProvider } from "../../application/ports/payment-provider";
import { SANDBOX_PROVIDER_NAME, SandboxProvider } from "./sandbox-provider";

export type AppEnvironment = "development" | "test" | "staging" | "production";

export const isDevLikeEnvironment = (env: AppEnvironment): boolean => env === "development" || env === "test";

/** Paramètres d'un fournisseur pour un tenant (clés API, secrets, URLs). Jamais journalisés. */
export type ProviderSettings = Readonly<Record<string, string | undefined>>;

export interface ProviderConfigSource {
  get(tenantId: string, provider: string): Promise<ProviderSettings | null>;
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

  /** Fournisseur prêt à l'emploi pour ce tenant, ou refus explicite. */
  async resolve(tenantId: string, name: string): Promise<Result<PaymentProvider, AppError>> {
    const def = this.definitions.get(name);
    if (!def) {
      return err(conflict(FinanceCode.PROVIDER_UNKNOWN, `Fournisseur de paiement inconnu : "${name}".`, { provider: name }));
    }
    const settings = (await this.configSource.get(tenantId, name)) ?? {};

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
    const fingerprint = Object.keys(settings)
      .sort()
      .map((k) => `${k}=${settings[k] ?? ""}`)
      .join("&");
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
  create: ({ settings }: ProviderFactoryContext): PaymentProvider =>
    new SandboxProvider(settings.secret ? { secret: settings.secret } : {}),
});

/** Registre prêt à l'emploi : sandbox enregistrée (donc refusée hors dev), aucun adaptateur réel. */
export function createProviderRegistry(options: ProviderRegistryOptions): ProviderRegistry {
  return new ProviderRegistry(options).register(sandboxDefinition);
}
