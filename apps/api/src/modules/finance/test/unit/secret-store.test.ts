import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { AesGcmSecretStore, ENVELOPE_RE, parseKeyring, secretStoreFromEnv, unavailableSecretStore } from "../../infrastructure/secrets/aes-gcm-secret-store";
import { SecretStoreError, type SecretScope } from "../../application/ports/secret-store";

const key = (): string => randomBytes(32).toString("base64");
const scope: SecretScope = { tenantId: "0192a3b4-0000-7000-8000-000000000001", provider: "wave", field: "api_key" };
const store = (spec: string, active?: string): AesGcmSecretStore => new AesGcmSecretStore(parseKeyring(spec, active)!);
const reason = async (p: Promise<unknown>): Promise<string> => {
  try {
    await p;
    return "no-error";
  } catch (e) {
    return e instanceof SecretStoreError ? e.reason : `other:${String(e)}`;
  }
};

describe("coffre des secrets AES-256-GCM", () => {
  it("aller-retour exact ; enveloppe v1.<kid>.<iv>.<chiffré>.<tag> sans le clair", async () => {
    const s = store(`k1:${key()}`);
    const clear = "wave_ci_prod_UNE-CLE-TRES-SECRETE-é";
    const env = await s.seal(scope, clear);
    expect(env).toMatch(ENVELOPE_RE);
    expect(env.startsWith("v1.k1.")).toBe(true);
    expect(env).not.toContain(clear);
    expect(Buffer.from(env, "utf8").includes(Buffer.from(clear))).toBe(false);
    expect(await s.open(scope, env)).toBe(clear);
  });

  it("deux scellements du même clair donnent deux enveloppes différentes (IV aléatoire)", async () => {
    const s = store(`k1:${key()}`);
    const a = await s.seal(scope, "x");
    const b = await s.seal(scope, "x");
    expect(a).not.toBe(b);
    expect(await s.open(scope, a)).toBe(await s.open(scope, b));
  });

  it("l'enveloppe est LIÉE à son contexte : autre tenant, autre fournisseur, autre champ => illisible", async () => {
    const s = store(`k1:${key()}`);
    const env = await s.seal(scope, "secret");
    expect(await reason(s.open({ ...scope, tenantId: "0192a3b4-0000-7000-8000-000000000002" }, env))).toBe("tampered");
    expect(await reason(s.open({ ...scope, provider: "cinetpay" }, env))).toBe("tampered");
    expect(await reason(s.open({ ...scope, field: "webhook_secret" }, env))).toBe("tampered");
  });

  it("toute altération (IV, chiffré, tag) est détectée ; une enveloppe mal formée est refusée", async () => {
    const s = store(`k1:${key()}`);
    const env = await s.seal(scope, "un secret assez long");
    const [v, kid, iv, ct, tag] = env.split(".") as [string, string, string, string, string];
    const flip = (x: string): string => (x[0] === "A" ? "B" : "A") + x.slice(1);
    expect(await reason(s.open(scope, [v, kid, flip(iv), ct, tag].join(".")))).toBe("tampered");
    expect(await reason(s.open(scope, [v, kid, iv, flip(ct), tag].join(".")))).toBe("tampered");
    expect(await reason(s.open(scope, [v, kid, iv, ct, flip(tag)].join(".")))).toBe("tampered");
    for (const bad of ["", "texte en clair", "v2.k1.a.b.c", `${v}.${kid}.${iv}.${ct}`, "v1.k1.AAAA.BBBB.CCCC"]) expect(await reason(s.open(scope, bad))).toBe("malformed");
  });

  it("rotation : l'ancienne clé reste lisible tant qu'elle est au trousseau ; isCurrent désigne la clé active", async () => {
    const k1 = key();
    const k2 = key();
    const old = store(`k1:${k1}`);
    const envOld = await old.seal(scope, "secret");
    const rotated = store(`k2:${k2},k1:${k1}`);
    expect(rotated.activeKeyId).toBe("k2");
    expect(rotated.isCurrent(envOld)).toBe(false);
    expect(await rotated.open(scope, envOld)).toBe("secret");
    const envNew = await rotated.seal(scope, await rotated.open(scope, envOld));
    expect(rotated.isCurrent(envNew)).toBe(true);
    expect(envNew.startsWith("v1.k2.")).toBe(true);
    // Une fois k1 retiré du trousseau, l'ancienne enveloppe est illisible, la nouvelle reste valide.
    const retired = store(`k2:${k2}`);
    expect(await reason(retired.open(scope, envOld))).toBe("unknown_key");
    expect(await retired.open(scope, envNew)).toBe("secret");
  });

  it("clé active explicite", async () => {
    const s = store(`k1:${key()},k2:${key()}`, "k2");
    expect(s.activeKeyId).toBe("k2");
    expect((await s.seal(scope, "x")).startsWith("v1.k2.")).toBe(true);
  });

  describe("configuration du trousseau", () => {
    it("aucune clé => null ; configuration invalide => erreur SANS matériau de clé", () => {
      expect(parseKeyring(undefined)).toBeNull();
      expect(parseKeyring("  ")).toBeNull();
      const k = key();
      const bad = [`k1:${Buffer.from("trop court").toString("base64")}`, `:${k}`, `k 1:${k}`, `k1:${k},k1:${k}`, "sans-deux-points", `k1:${k}`];
      expect(() => parseKeyring(bad[0])).toThrow();
      expect(() => parseKeyring(bad[1])).toThrow();
      expect(() => parseKeyring(bad[2])).toThrow();
      expect(() => parseKeyring(bad[3])).toThrow();
      expect(() => parseKeyring(bad[4])).toThrow();
      expect(() => parseKeyring(bad[5], "k9")).toThrow();
      for (const spec of bad.slice(0, 5)) {
        try {
          parseKeyring(spec);
        } catch (e) {
          expect(String(e)).not.toContain(k);
        }
      }
    });

    it("sans clé maître (ou configuration invalide) : coffre INDISPONIBLE, jamais de repli en clair", async () => {
      const messages: string[] = [];
      for (const env of [{}, { FINANCE_SECRETS_KEYS: "" }, { FINANCE_SECRETS_KEYS: "k1:court" }, { FINANCE_SECRETS_KEYS: `k1:${key()}`, FINANCE_SECRETS_ACTIVE_KEY: "absente" }]) {
        const s = secretStoreFromEnv(env, (m) => messages.push(m));
        expect(s.available).toBe(false);
        expect(s.activeKeyId).toBeNull();
        expect(await reason(s.seal(scope, "x"))).toBe("unavailable");
        expect(await reason(s.open(scope, "v1.k1.AAAAAAAAAAAAAAAA.BBBB.CCCCCCCCCCCCCCCCCCCCCC"))).toBe("unavailable");
        expect(s.isCurrent("x")).toBe(false);
      }
      expect(messages).toHaveLength(2);
      expect(unavailableSecretStore.available).toBe(false);
    });

    it("clé valide depuis l'environnement => disponible", async () => {
      const s = secretStoreFromEnv({ FINANCE_SECRETS_KEYS: `a1:${key()}` });
      expect(s.available).toBe(true);
      expect(await s.open(scope, await s.seal(scope, "ok"))).toBe("ok");
    });
  });

  it("les erreurs du coffre ne portent jamais le clair ni la clé", async () => {
    const k = key();
    const s = store(`k1:${k}`);
    const env = await s.seal(scope, "TRES-SECRET-9988");
    try {
      await s.open({ ...scope, field: "autre" }, env);
    } catch (e) {
      const text = `${String(e)} ${JSON.stringify(e, Object.getOwnPropertyNames(e as object))}`;
      expect(text).not.toContain("TRES-SECRET-9988");
      expect(text).not.toContain(k);
    }
  });
});
