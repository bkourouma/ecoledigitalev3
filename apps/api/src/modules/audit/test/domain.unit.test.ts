import { describe, expect, it } from "vitest";
import { canonicalize, jsonEquals, toJsonValue } from "../domain/canonical";
import { describeDevice } from "../domain/device";
import { computeDiff } from "../domain/diff";
import { GENESIS_HASH, computeEntryHash, recomputeEntryHash, type HashableEntry } from "../domain/hash";
import { MASK, createMasker, luhnValid } from "../domain/masking";

const masker = createMasker();

describe("toJsonValue / canonicalize", () => {
  it("produit du JSON pur : bigint, Date, undefined, NaN, NUL", () => {
    const v = toJsonValue({
      big: 10n,
      when: new Date("2026-01-02T03:04:05.678Z"),
      nothing: undefined,
      nan: Number.NaN,
      text: "a\u0000b",
      fn: () => 1,
      set: new Set([1, 2]),
      map: new Map([["k", 1]]),
    });
    expect(canonicalize(v as never)).toBe(
      '{"big":"10","map":{"k":1},"nan":null,"set":[1,2],"text":"ab","when":"2026-01-02T03:04:05.678Z"}',
    );
  });

  it("conserve __proto__ comme une simple donnée (pas de pollution de prototype)", () => {
    const v = toJsonValue(JSON.parse('{"__proto__":{"admin":true},"a":1}'));
    expect(Object.keys(v as object).sort()).toEqual(["__proto__", "a"]);
    expect(({} as Record<string, unknown>).admin).toBeUndefined();
  });

  it("gère les cycles et la profondeur", () => {
    const a: Record<string, unknown> = { name: "a" };
    a.self = a;
    expect(toJsonValue(a)).toEqual({ name: "a", self: "[Circular]" });
    let deep: unknown = "x";
    for (let i = 0; i < 40; i++) deep = { d: deep };
    expect(canonicalize(toJsonValue(deep) as never)).toContain("[MaxDepth]");
  });

  it("clés triées : l'ordre d'insertion n'influe pas sur la forme canonique", () => {
    expect(canonicalize({ b: 1, a: { d: 1, c: 2 } })).toBe(canonicalize({ a: { c: 2, d: 1 }, b: 1 }));
    expect(jsonEquals({ a: [1, 2] }, { a: [1, 2] })).toBe(true);
    expect(jsonEquals({ a: [1, 2] }, { a: [2, 1] })).toBe(false);
  });

  it("-0 devient 0 et les nombres survivent à un aller-retour JSON", () => {
    expect(toJsonValue(-0)).toBe(0);
    for (const n of [0.1, 1e21, 123456789.123456789, 5e-324]) {
      expect(JSON.parse(canonicalize(n as never))).toBe(n);
    }
  });
});

describe("masquage", () => {
  it("masque par nom de clé (exact, suffixe, casse et séparateurs ignorés)", () => {
    const out = masker.maskValue(
      toJsonValue({
        password: "p",
        new_password: "p2",
        accessToken: "t",
        "refresh-token": "t",
        totpSecret: "JBSWY3DPEHPK3PXP",
        backupCodes: ["1", "2"],
        cardNumber: "4111 1111 1111 1111",
        cvv: "123",
        apiKey: "k",
        motDePasse: "x",
        email: "a@b.ci",
        tokenCount: 3,
        nested: { clientSecret: "s", keep: "ok" },
      }) as never,
    ) as Record<string, unknown>;
    for (const k of ["password", "new_password", "accessToken", "refresh-token", "totpSecret", "backupCodes", "cardNumber", "cvv", "apiKey", "motDePasse"]) {
      expect(out[k]).toBe(MASK);
    }
    expect(out.email).toBe("a@b.ci");
    expect(out.tokenCount).toBe(3);
    expect(out.nested).toEqual({ clientSecret: MASK, keep: "ok" });
  });

  it("garde null tel quel (ne révèle rien)", () => {
    expect(masker.maskValue({ password: null } as never)).toEqual({ password: null });
  });

  it("masque un numéro de carte valide (Luhn) dans un texte libre, pas un numéro quelconque", () => {
    expect(luhnValid("4111111111111111")).toBe(true);
    expect(masker.maskString("paiement carte 4111 1111 1111 1111 ok")).toBe(`paiement carte ${MASK} ok`);
    expect(masker.maskString("matricule 1234567890123456")).toBe("matricule 1234567890123456");
  });

  it("masque JWT, Bearer et clés privées dans les valeurs", () => {
    const jwt = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abcdEFGH";
    expect(masker.maskString(`jeton ${jwt} fin`)).toBe(`jeton ${MASK} fin`);
    expect(masker.maskString("Authorization: Bearer abcdefghijklmnopqrstuvwxyz012345")).toBe(`Authorization: ${MASK}`);
    expect(masker.maskString("-----BEGIN PRIVATE KEY-----\nMIIE\n-----END PRIVATE KEY-----")).toBe(MASK); // secret-scan:allow (valeur factice de test)
  });

  it("la liste est configurable", () => {
    const custom = createMasker({ keys: ["matricule"], keySuffixes: [], detectCardNumbers: false, valuePatterns: [] });
    expect(custom.maskValue({ matricule: "M1", password: "visible" } as never)).toEqual({ matricule: MASK, password: "visible" });
  });
});

describe("diff", () => {
  it("diff champ par champ : modifié, ajouté, supprimé, imbriqué", () => {
    const diff = computeDiff(
      { name: "A", gone: 1, nested: { x: 1, y: 2 }, tags: ["a"] },
      { name: "B", added: true, nested: { x: 1, y: 3 }, tags: ["a", "b"] },
      masker,
    );
    expect(diff).toEqual({
      added: { to: true },
      gone: { from: 1 },
      name: { from: "A", to: "B" },
      "nested.y": { from: 2, to: 3 },
      tags: { from: ["a"], to: ["a", "b"] },
    });
  });

  it("aucun changement : objet vide ; rien à comparer : null", () => {
    expect(computeDiff({ a: 1 }, { a: 1 }, masker)).toEqual({});
    expect(computeDiff(null, undefined, masker)).toBeNull();
  });

  it("création et suppression listent les champs", () => {
    expect(computeDiff(null, { a: 1, b: { c: 2 } }, masker)).toEqual({ a: { to: 1 }, "b.c": { to: 2 } });
    expect(computeDiff({ a: 1 }, null, masker)).toEqual({ a: { from: 1 } });
  });

  it("un secret MODIFIÉ apparaît comme changé mais sans valeur ; non modifié : absent", () => {
    const diff = computeDiff({ password: "ancien", secretCode: "z", email: "a@b" }, { password: "nouveau", secretCode: "z", email: "c@d" }, masker);
    expect(diff).toEqual({ password: { from: MASK, to: MASK }, email: { from: "a@b", to: "c@d" } });
    expect(JSON.stringify(diff)).not.toContain("ancien");
    expect(JSON.stringify(diff)).not.toContain("nouveau");
  });

  it("échappe les points dans les clés et gère une racine non-objet", () => {
    expect(computeDiff({ "a.b": 1 }, { "a.b": 2 }, masker)).toEqual({ "a\\.b": { from: 1, to: 2 } });
    expect(computeDiff("x" as never, "y" as never, masker)).toEqual({ $: { from: "x", to: "y" } });
  });
});

const entry = (over: Partial<HashableEntry> = {}): HashableEntry => ({
  scope: "11111111-1111-4111-8111-111111111111",
  seq: 1,
  id: "22222222-2222-4222-8222-222222222222",
  occurredAt: "2026-10-01T10:00:00.000Z",
  actorType: "user",
  actorId: "33333333-3333-4333-8333-333333333333",
  impersonatedBy: null,
  action: "grade.published",
  entity: "grade",
  entityId: "g1",
  before: null,
  after: { value: 12 },
  diff: { value: { to: 12 } },
  metadata: null,
  ip: "10.0.0.1",
  userAgent: null,
  device: null,
  requestId: "req-1",
  reason: null,
  severity: "info",
  prevHash: GENESIS_HASH,
  ...over,
});

describe("hash", () => {
  it("est déterministe et sensible à chaque champ couvert", () => {
    const base = computeEntryHash(entry());
    expect(base.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(computeEntryHash(entry()).hash).toBe(base.hash);
    const variants: Array<Partial<HashableEntry>> = [
      { scope: "99999999-9999-4999-8999-999999999999" },
      { seq: 2 },
      { id: "44444444-4444-4444-8444-444444444444" },
      { occurredAt: "2026-10-01T10:00:00.001Z" },
      { actorType: "system" },
      { actorId: null },
      { impersonatedBy: "55555555-5555-4555-8555-555555555555" },
      { action: "grade.deleted" },
      { entity: "course" },
      { entityId: "g2" },
      { before: { value: 11 } },
      { after: { value: 13 } },
      { diff: null },
      { metadata: { a: 1 } },
      { ip: "10.0.0.2" },
      { userAgent: "x" },
      { device: "y" },
      { requestId: "req-2" },
      { reason: "r" },
      { severity: "critical" },
      { prevHash: "1".repeat(64) },
    ];
    for (const v of variants) expect(computeEntryHash(entry(v)).hash, JSON.stringify(v)).not.toBe(base.hash);
  });

  it("ne dépend pas de l'ordre des clés des objets JSON", () => {
    const a = computeEntryHash(entry({ after: { a: 1, b: { c: 1, d: 2 } } })).hash;
    const b = computeEntryHash(entry({ after: { b: { d: 2, c: 1 }, a: 1 } })).hash;
    expect(a).toBe(b);
  });

  it("HMAC : dépend de la clé, de son identifiant d'algorithme, et se revérifie avec la bonne clé seulement", () => {
    const k1 = { id: "k1", secret: "secret-number-one-16+" };
    const k2 = { id: "k2", secret: "secret-number-two-16+" };
    const e = entry();
    const h1 = computeEntryHash(e, k1);
    expect(h1.alg).toBe("hmac-sha256");
    expect(h1.keyId).toBe("k1");
    expect(h1.hash).not.toBe(computeEntryHash(e).hash);
    expect(h1.hash).not.toBe(computeEntryHash(e, k2).hash);
    const keys = new Map<string, string>([["k1", k1.secret]]);
    expect(recomputeEntryHash(e, "hmac-sha256", "k1", keys)).toBe(h1.hash);
    expect(recomputeEntryHash(e, "hmac-sha256", "k2", keys)).toBeNull();
    // Rétrograder en sha256 simple ne redonne pas le même hash.
    expect(recomputeEntryHash(e, "sha256", null, keys)).not.toBe(h1.hash);
  });
});

describe("describeDevice", () => {
  it("décrit navigateur / OS / type", () => {
    expect(describeDevice("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36")).toBe("Chrome / Windows (poste)");
    expect(describeDevice("Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/124.0 Mobile Safari/537.36")).toBe("Chrome / Android (mobile)");
    expect(describeDevice("curl/8.5.0")).toBe("Script (poste)");
    expect(describeDevice(null)).toBeNull();
  });
});
