/**
 * Harnais commun aux tests de CONTRAT du port `PaymentProvider` : un descripteur par adaptateur (serveur simulé,
 * réglages, requête d'initiation valide, « règle la transaction en succès »), pour exécuter la MÊME batterie sur les cinq.
 */
import { Money } from "@ecoledigitale/kernel";
import type { PaymentProvider, ProviderInitiateRequest } from "../../application/ports/payment-provider";
import { createPaymentProviderDefinitions } from "../../infrastructure/providers/definitions";
import { encodePaymentReference } from "../../infrastructure/providers/common";
import type { ProviderSettings } from "../../infrastructure/providers/registry";
import { CinetPayMock, MtnMock, OrangeMock, TresorPayMock, WaveMock, type MockHttp } from "./mock-providers";
import { PHONE, SECRETS, TEST_TENANT, testRuntime, type TestRuntime } from "./adapters";

export const xof = (n: number): Money => Money.of(n, "XOF");

export interface ProviderHarness {
  readonly name: string;
  readonly mock: MockHttp;
  readonly settings: ProviderSettings;
  /** Réglages vidés des secrets de webhook / d'authentification (pour les tests « secret absent »). */
  readonly secretKeys: readonly string[];
  readonly webhookSecretKeys: readonly string[];
  build(overrides?: Record<string, string | undefined>, runtime?: Partial<TestRuntime>): { provider: PaymentProvider; runtime: TestRuntime };
  request(paymentId: string, amount?: number): ProviderInitiateRequest;
  /** Règle la transaction côté fournisseur : succès. */
  settleSuccess(paymentId: string, providerRef: string | null): void;
  stop(): Promise<void>;
}

const NOTIFY = (name: string) => `https://api.example.test/api/v1/finance/webhooks/${name}/${TEST_TENANT}`;

function definitionBuilder(name: string, endpointUrl: string, settings: ProviderSettings) {
  return (overrides: Record<string, string | undefined> = {}, runtimeOverrides: Partial<TestRuntime> = {}) => {
    const runtime = testRuntime({ [name]: { production: endpointUrl, sandbox: endpointUrl } }, runtimeOverrides);
    const def = createPaymentProviderDefinitions(runtime).find((d) => d.name === name)!;
    const merged: Record<string, string | undefined> = { ...settings, ...overrides };
    for (const [k, v] of Object.entries(merged)) if (v === undefined) delete merged[k];
    return { provider: def.create({ tenantId: TEST_TENANT, settings: merged as ProviderSettings, environment: "test" }), runtime };
  };
}

export async function createHarnesses(): Promise<ProviderHarness[]> {
  const orange = await new OrangeMock({ clientId: "om-client", clientSecret: SECRETS.orangeClientSecret, merchantKey: SECRETS.orangeMerchantKey, segment: "ci", currency: "XOF" }).start();
  const mtn = await new MtnMock({
    apiUser: "11111111-2222-4333-8444-555555555555",
    apiKey: SECRETS.mtnApiKey,
    subscriptionKey: SECRETS.mtnSubscriptionKey,
    targetEnvironment: "mtnivorycoast",
    currency: "XOF",
    callbacksAllowed: true,
  }).start();
  const wave = await new WaveMock(SECRETS.waveApiKey).start();
  const cinetpay = await new CinetPayMock({ apiKey: SECRETS.cinetApiKey, siteId: "105899", secretKey: SECRETS.cinetSecretKey }).start();
  const tresor = await new TresorPayMock({ apiKey: SECRETS.tresorApiKey, secretKey: SECRETS.tresorSecretKey, merchantId: "MERCH-1" }).start();

  const orangeSettings = { mode: "production", country: "ci", client_id: "om-client", client_secret: SECRETS.orangeClientSecret, merchant_key: SECRETS.orangeMerchantKey, webhook_secret: SECRETS.webhookSecret };
  const mtnSettings = { mode: "production", api_user: "11111111-2222-4333-8444-555555555555", api_key: SECRETS.mtnApiKey, subscription_key: SECRETS.mtnSubscriptionKey, webhook_secret: SECRETS.webhookSecret };
  const waveSettings = { mode: "production", api_key: SECRETS.waveApiKey, webhook_secret: SECRETS.waveWebhookSecret };
  const cinetSettings = { mode: "production", site_id: "105899", api_key: SECRETS.cinetApiKey, secret_key: SECRETS.cinetSecretKey, channels: "MOBILE_MONEY" };
  const tresorSettings = { mode: "production", merchant_id: "MERCH-1", api_key: SECRETS.tresorApiKey, secret_key: SECRETS.tresorSecretKey, webhook_secret: SECRETS.tresorWebhookSecret };

  const base = (name: string, id: string, amount: number): ProviderInitiateRequest => ({
    tenantId: TEST_TENANT,
    paymentId: id,
    amount: xof(amount),
    payer: { name: "Awa Koné", email: "awa@example.test", phoneNumber: PHONE },
    returnUrl: "https://app.example.test/retour",
    notifyUrl: NOTIFY(name),
    description: "Scolarite",
  });

  return [
    {
      name: "orange_money",
      mock: orange,
      settings: orangeSettings,
      secretKeys: ["client_secret", "merchant_key", "webhook_secret"],
      webhookSecretKeys: ["webhook_secret"],
      build: definitionBuilder("orange_money", orange.url, orangeSettings),
      request: (id, amount = 25_000) => base("orange_money", id, amount),
      settleSuccess: (_id, ref) => void orange.settle(ref!, "SUCCESS"),
      stop: () => orange.stop(),
    },
    {
      name: "mtn_momo",
      mock: mtn,
      settings: mtnSettings,
      secretKeys: ["api_key", "subscription_key", "webhook_secret"],
      webhookSecretKeys: ["webhook_secret"],
      build: definitionBuilder("mtn_momo", mtn.url, mtnSettings),
      request: (id, amount = 25_000) => base("mtn_momo", id, amount),
      settleSuccess: (_id, ref) => void mtn.settle(ref!, "SUCCESSFUL"),
      stop: () => mtn.stop(),
    },
    {
      name: "wave",
      mock: wave,
      settings: waveSettings,
      secretKeys: ["api_key", "webhook_secret"],
      webhookSecretKeys: ["webhook_secret"],
      build: definitionBuilder("wave", wave.url, waveSettings),
      request: (id, amount = 25_000) => base("wave", id, amount),
      settleSuccess: (_id, ref) => void wave.complete(ref!),
      stop: () => wave.stop(),
    },
    {
      name: "cinetpay",
      mock: cinetpay,
      settings: cinetSettings,
      secretKeys: ["api_key", "secret_key"],
      webhookSecretKeys: ["secret_key"],
      build: definitionBuilder("cinetpay", cinetpay.url, cinetSettings),
      request: (id, amount = 25_000) => base("cinetpay", id, amount),
      settleSuccess: (id) => cinetpay.settle(encodePaymentReference(id), "ACCEPTED"),
      stop: () => cinetpay.stop(),
    },
    {
      name: "tresorpay",
      mock: tresor,
      settings: tresorSettings,
      secretKeys: ["api_key", "secret_key", "webhook_secret"],
      webhookSecretKeys: ["webhook_secret"],
      build: definitionBuilder("tresorpay", `${tresor.url}/v1`, tresorSettings),
      request: (id, amount = 25_000) => base("tresorpay", id, amount),
      settleSuccess: (_id, ref) => {
        tresor.payments.get(ref!)!.status = "completed";
      },
      stop: () => tresor.stop(),
    },
  ];
}
