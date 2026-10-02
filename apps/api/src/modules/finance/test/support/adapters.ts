/**
 * Aides des tests d'adaptateurs : environnement d'exécution simulé (horloge, journaux CAPTURÉS, attentes nulles),
 * identifiants de test (aucune clé réelle), assertions de non-fuite.
 */
import { ManualClock, newId, type Logger } from "@ecoledigitale/kernel";
import type { AdapterRuntime, ProviderEndpoints } from "../../infrastructure/providers/adapter-kit";

export const TEST_TENANT = "0192a3b4-0000-7000-8000-000000000001";
export const OTHER_TENANT = "0192a3b4-0000-7000-8000-000000000002";
export const paymentId = (): string => newId();

export interface CapturedLogs {
  readonly logger: Logger;
  readonly lines: string[];
  text(): string;
}

/** Logger qui conserve TOUT (niveaux, messages, champs) sérialisé : sert à prouver qu'aucun secret n'est journalisé. */
export function captureLogs(): CapturedLogs {
  const lines: string[] = [];
  const push = (level: string) => (obj: Record<string, unknown>, msg?: string): void => {
    lines.push(JSON.stringify({ level, msg, ...obj }));
  };
  return { logger: { debug: push("debug"), info: push("info"), warn: push("warn"), error: push("error") }, lines, text: () => lines.join("\n") };
}

export interface TestRuntime extends AdapterRuntime {
  readonly clock: ManualClock;
  readonly logs: CapturedLogs;
  readonly sleeps: number[];
}

export function testRuntime(endpoints: ProviderEndpoints, extra: Partial<AdapterRuntime> = {}): TestRuntime {
  const logs = captureLogs();
  const sleeps: number[] = [];
  return {
    clock: new ManualClock(new Date()),
    logger: logs.logger,
    endpoints,
    allowInsecureHttp: true,
    timeoutMs: 2_000,
    retries: 2,
    sleep: async (ms: number) => {
      sleeps.push(ms);
    },
    ...extra,
    logs,
    sleeps,
  } as TestRuntime;
}

/** Valeurs de test reconnaissables : les tests vérifient qu'elles ne ressortent JAMAIS dans les journaux ni les erreurs. */
export const SECRETS = {
  orangeClientSecret: "OM-CLIENT-SECRET-zq81",
  orangeMerchantKey: "OM-MERCHANT-KEY-w93k",
  webhookSecret: "WEBHOOK-SECRET-h7d2m1",
  mtnApiKey: "MTN-API-KEY-p0o9i8u7",
  mtnSubscriptionKey: "MTN-SUBSCRIPTION-KEY-a1s2d3",
  waveApiKey: "wave_ci_prod_TESTKEY_l4k3j2",
  waveWebhookSecret: "wave_sn_AKS_TESTSECRET_x9y8",
  cinetApiKey: "CINET-API-KEY-m5n6b7",
  cinetSecretKey: "CINET-SECRET-KEY-v4c3x2",
  tresorApiKey: "TRESOR-API-KEY-q1w2e3",
  tresorSecretKey: "TRESOR-SECRET-KEY-r4t5y6",
  tresorWebhookSecret: "TRESOR-WEBHOOK-SECRET-u7i8o9",
} as const;

export const PHONE = "2250701020304";

/** Aucune valeur secrète (ni numéro complet) dans `haystack`. */
export function expectNoSecrets(haystack: string, extra: string[] = []): string[] {
  const leaks: string[] = [];
  for (const v of [...Object.values(SECRETS), PHONE, "0701020304", ...extra]) if (haystack.includes(v)) leaks.push(v);
  return leaks;
}
