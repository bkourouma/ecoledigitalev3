/**
 * Sécurité des adaptateurs : aucun secret ni numéro complet dans les journaux, les erreurs ou le contenu stocké ;
 * comparaisons à temps constant ; aucun flottant ; aucune sortie console ; aucun repli simulé.
 */
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { constantTimeEqual } from "../../infrastructure/providers/common";
import { createHarnesses, xof, type ProviderHarness } from "../support/harness";
import { PHONE, SECRETS, expectNoSecrets, paymentId } from "../support/adapters";

let harnesses: ProviderHarness[] = [];
beforeAll(async () => {
  harnesses = await createHarnesses();
});
afterAll(async () => {
  await Promise.all(harnesses.map((h) => h.stop()));
});

const NAMES = ["orange_money", "mtn_momo", "wave", "cinetpay", "tresorpay"] as const;

describe.each(NAMES)("aucune fuite de secret : %s", (name) => {
  const h = (): ProviderHarness => harnesses.find((x) => x.name === name)!;

  it("parcours nominal, identifiants refusés, 5xx, réponse malformée, délai : ni journaux ni erreurs ne portent un secret ou un numéro complet", async () => {
    const wrong = Object.fromEntries(h().secretKeys.map((k) => [k, `FAUX-${k}-SECRET-9z8y7x`]));
    const wrongValues = Object.values(wrong);
    const logs: string[] = [];
    const errors: string[] = [];
    const note = (r: { ok: boolean; error?: unknown }): void => {
      if (!r.ok) errors.push(JSON.stringify(r.error, Object.getOwnPropertyNames(r.error as object)) + String((r.error as Error).message));
    };

    // 1. nominal
    {
      const { provider, runtime } = h().build();
      const id = paymentId();
      const init = await provider.initiate(h().request(id));
      note(init);
      const ref = init.ok ? init.value.providerRef : null;
      h().settleSuccess(id, ref);
      note(await provider.verify({ paymentId: id, providerRef: ref, amount: xof(25_000) }));
      note((await provider.testConnection!()) as never);
      logs.push(runtime.logs.text());
    }
    // 2. identifiants refusés (chaque secret d'authentification remplacé)
    {
      const { provider, runtime } = h().build(wrong);
      note(await provider.initiate(h().request(paymentId())));
      note(await provider.verify({ paymentId: paymentId(), providerRef: "11111111-2222-4333-8444-555555555555", amount: xof(1000) }));
      note((await provider.testConnection!()) as never);
      logs.push(runtime.logs.text());
    }
    // 3. 5xx, malformé, délai
    for (const reply of [{ status: 503 }, { status: 200, text: "<html>erreur</html>" }, { status: 200, json: { garbage: true } }, { delayMs: 500 }]) {
      const { provider, runtime } = h().build({}, { timeoutMs: 200, retries: 1 });
      h().mock.overrideNext(reply, reply, reply, reply);
      note(await provider.initiate(h().request(paymentId())));
      note(await provider.verify({ paymentId: paymentId(), providerRef: "11111111-2222-4333-8444-555555555555", amount: xof(1000) }));
      h().mock.reset();
      logs.push(runtime.logs.text());
    }

    const haystack = [...logs, ...errors].join("\n");
    expect(haystack.length).toBeGreaterThan(0);
    expect(expectNoSecrets(haystack, wrongValues)).toEqual([]);
    expect(haystack).not.toContain(PHONE);
    expect(haystack).not.toMatch(/Bearer\s+\S{6,}/);
    expect(haystack).not.toMatch(/Basic\s+[A-Za-z0-9+/=]{10,}/);
  });
});

describe("comparaison à temps constant", () => {
  it("constantTimeEqual ne lève pas pour des longueurs différentes (timingSafeEqual brut lèverait)", () => {
    expect(() => constantTimeEqual("court", "beaucoup plus long")).not.toThrow();
    expect(constantTimeEqual("court", "beaucoup plus long")).toBe(false);
  });

  it("le temps de comparaison ne dépend pas de la position de la première différence (ordre de grandeur)", () => {
    const secret = "a".repeat(64);
    const early = "b" + "a".repeat(63);
    const late = "a".repeat(63) + "b";
    const time = (candidate: string): number => {
      const start = process.hrtime.bigint();
      for (let i = 0; i < 20_000; i++) constantTimeEqual(secret, candidate);
      return Number(process.hrtime.bigint() - start);
    };
    time(early); // échauffement
    const e = Math.min(time(early), time(early), time(early));
    const l = Math.min(time(late), time(late), time(late));
    // Tolérance large : on détecte une comparaison court-circuitée (rapport >> 1), pas le bruit de la machine.
    expect(Math.max(e, l) / Math.min(e, l)).toBeLessThan(3);
  });
});

describe("garde-fous statiques du code des adaptateurs", () => {
  const dir = resolve(fileURLToPath(new URL(".", import.meta.url)), "../../infrastructure/providers");
  const files = readdirSync(dir).filter((f) => f.endsWith(".ts"));
  const source = (f: string): string => readFileSync(resolve(dir, f), "utf8");
  const adapters = ["orange-money.ts", "mtn-momo.ts", "wave.ts", "cinetpay.ts", "tresorpay.ts"];

  it.each(adapters)("%s : pas de flottant monétaire, pas de console, pas de secret par défaut, pas de `return true` de signature", (f) => {
    const code = source(f).replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    expect(code).not.toMatch(/parseFloat|toFixed|Math\.round|Math\.floor\(.*amount|\*\s*100\b|\/\s*100\b/);
    expect(code).not.toMatch(/console\./);
    expect(code).not.toMatch(/process\.env/);
    // verifySignature : aucune branche qui renvoie `true` sans calcul.
    const m = /verifySignature\([\s\S]*?\n  \}\n/.exec(code);
    expect(m).not.toBeNull();
    expect(m![0]).not.toMatch(/return true;/);
    expect(code).not.toMatch(/sandbox_fallback|mock_|simulated\s*=\s*true/i);
  });

  it.each(adapters)("%s : la signature n'est jamais comparée avec === / !== sur le secret ou le jeton", (f) => {
    const code = source(f);
    expect(code).not.toMatch(/(signature|given|expected|token)\s*(===|!==)\s*(signature|given|expected|secret|token)/);
    expect(code).toMatch(/constantTimeEqual|verifyWebhookUrlToken/);
  });

  it("aucun fichier du dossier ne contient de clé réelle (formats connus)", () => {
    for (const f of files) expect(source(f)).not.toMatch(/sk_live_|wave_sn_[A-Za-z0-9]{10,}|AKIA[0-9A-Z]{16}|-----BEGIN [A-Z ]*PRIVATE KEY-----/);
  });

  it("aucun adaptateur ne lit un secret dans l'environnement du processus (la configuration passe par le registre)", () => {
    for (const f of adapters) expect(source(f)).not.toMatch(/process\.env/);
  });

  it("aucun champ de configuration ne permet de fixer une URL (SSRF)", () => {
    const catalog = source("catalog.ts");
    expect(catalog).not.toMatch(/key:\s*"(base_)?url"|"base_url"|"endpoint"|"host"/i);
  });
});
