/**
 * Définitions des adaptateurs réels pour le `ProviderRegistry` + points d'accès de la plateforme.
 *
 *   registerPaymentProviders(registry, { clock, logger, endpoints: endpointsFromEnv(env) });
 *
 * Chaque définition est `modeAware` : le mode `sandbox` d'un fournisseur est refusé en `production`.
 * Aucun adaptateur n'a de repli simulé : une configuration incomplète est un refus (`provider_not_configured`).
 */
import type { PaymentProvider } from "../../application/ports/payment-provider";
import type { AdapterRuntime, ProviderEndpoints } from "./adapter-kit";
import { CINETPAY_ENTRY, MTN_MOMO_ENTRY, ORANGE_MONEY_ENTRY, TRESORPAY_ENTRY, WAVE_ENTRY, requiredSettingsOf, type ProviderCatalogEntry } from "./catalog";
import { CinetPayProvider } from "./cinetpay";
import { MtnMomoProvider } from "./mtn-momo";
import { OrangeMoneyProvider } from "./orange-money";
import type { ProviderDefinition, ProviderFactoryContext, ProviderRegistry, ProviderSettings } from "./registry";
import { TresorPayProvider } from "./tresorpay";
import { WaveProvider } from "./wave";

type Constructor = new (tenantId: string, settings: ProviderSettings, runtime: AdapterRuntime) => PaymentProvider;

const definitionOf = (entry: ProviderCatalogEntry, ctor: Constructor, runtime: AdapterRuntime): ProviderDefinition =>
  Object.freeze({
    name: entry.name,
    requiredSettings: requiredSettingsOf(entry),
    modeAware: true,
    create: ({ tenantId, settings }: ProviderFactoryContext): PaymentProvider => new ctor(tenantId, settings, runtime),
  });

export function createPaymentProviderDefinitions(runtime: AdapterRuntime): ProviderDefinition[] {
  return [
    definitionOf(ORANGE_MONEY_ENTRY, OrangeMoneyProvider, runtime),
    definitionOf(MTN_MOMO_ENTRY, MtnMomoProvider, runtime),
    definitionOf(WAVE_ENTRY, WaveProvider, runtime),
    definitionOf(CINETPAY_ENTRY, CinetPayProvider, runtime),
    definitionOf(TRESORPAY_ENTRY, TresorPayProvider, runtime),
  ];
}

export function registerPaymentProviders(registry: ProviderRegistry, runtime: AdapterRuntime): ProviderRegistry {
  for (const def of createPaymentProviderDefinitions(runtime)) registry.register(def);
  return registry;
}

/**
 * Points d'accès de la plateforme : `FINANCE_PROVIDER_<NOM>_BASE_URL` (production) et
 * `FINANCE_PROVIDER_<NOM>_SANDBOX_BASE_URL` (sandbox). Réservé à l'exploitation : jamais configurable par un tenant.
 */
export function endpointsFromEnv(env: Readonly<Record<string, string | undefined>>): ProviderEndpoints {
  const out: Record<string, { production?: string; sandbox?: string }> = {};
  for (const entry of [ORANGE_MONEY_ENTRY, MTN_MOMO_ENTRY, WAVE_ENTRY, CINETPAY_ENTRY, TRESORPAY_ENTRY]) {
    const prefix = `FINANCE_PROVIDER_${entry.name.toUpperCase()}_`;
    const production = env[`${prefix}BASE_URL`]?.trim();
    const sandbox = env[`${prefix}SANDBOX_BASE_URL`]?.trim();
    if (production || sandbox) {
      out[entry.name] = { ...(production ? { production } : {}), ...(sandbox ? { sandbox } : {}) };
    }
  }
  return out;
}
