import bcrypt from "bcryptjs";
import { describe, expect, it } from "vitest";
import { PasswordHasher, hashKind, parseScryptHash } from "../domain/password-hash";
import { PasswordPolicy, canonicalize } from "../domain/password-policy";

const FAST = { logN: 10, r: 8, p: 1 };

describe("PasswordHasher — scrypt", () => {
  const hasher = new PasswordHasher({ params: FAST });

  it("produit un hash PHC-like dont les paramètres sont encodés, avec un sel aléatoire", async () => {
    const a = await hasher.hash("une phrase de passe correcte");
    const b = await hasher.hash("une phrase de passe correcte");
    expect(a).toMatch(/^\$scrypt\$ln=10,r=8,p=1\$[A-Za-z0-9_-]+\$[A-Za-z0-9_-]+$/);
    expect(a).not.toBe(b);
    expect(hashKind(a)).toBe("scrypt");
    const parsed = parseScryptHash(a);
    expect(parsed?.params).toEqual(FAST);
    expect(parsed?.salt).toHaveLength(16);
    expect(parsed?.key).toHaveLength(32);
  });

  it("vérifie le bon mot de passe et refuse les mauvais", async () => {
    const h = await hasher.hash("une phrase de passe correcte");
    expect((await hasher.verify(h, "une phrase de passe correcte")).ok).toBe(true);
    expect((await hasher.verify(h, "une phrase de passe correcte ")).ok).toBe(false);
    expect((await hasher.verify(h, "")).ok).toBe(false);
  });

  it("normalise en NFKC : « é » composé et décomposé sont équivalents", async () => {
    const h = await hasher.hash("café-sécurisé-2026");
    expect((await hasher.verify(h, "café-sécurisé-2026")).ok).toBe(true);
  });

  it("ne lève pas et refuse un hash absent, vide, inconnu ou corrompu", async () => {
    for (const bad of [null, undefined, "", "plaintext", "$scrypt$", "$scrypt$ln=99,r=8,p=1$AAAA$BBBB", "$scrypt$ln=10,r=8,p=1$!!$??", "$argon2id$v=19$m=1,t=1,p=1$x$y"]) {
      const r = await hasher.verify(bad as string | null, "n'importe quoi");
      expect(r).toEqual({ ok: false, needsRehash: false });
    }
  });

  it("borne les paramètres lus dans le hash (pas de déni de service mémoire par hash forgé)", () => {
    expect(parseScryptHash("$scrypt$ln=25,r=8,p=1$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA")).toBeNull();
    expect(parseScryptHash("$scrypt$ln=16,r=64,p=1$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA")).toBeNull();
    expect(parseScryptHash("$scrypt$ln=16,r=8,p=1$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA")).not.toBeNull();
  });

  it("signale le re-hachage quand les paramètres du hash sont plus faibles que la config", async () => {
    const weak = new PasswordHasher({ params: { logN: 10, r: 8, p: 1 } });
    const strong = new PasswordHasher({ params: { logN: 11, r: 8, p: 1 } });
    const h = await weak.hash("mot de passe de test 123");
    expect(await strong.verify(h, "mot de passe de test 123")).toEqual({ ok: true, needsRehash: true });
    expect(await weak.verify(h, "mot de passe de test 123")).toEqual({ ok: true, needsRehash: false });
    // jamais de re-hachage sur un mot de passe faux
    expect(await strong.verify(h, "faux")).toEqual({ ok: false, needsRehash: false });
  });

  it("refuse un mot de passe démesuré sans le hacher", async () => {
    await expect(hasher.hash("x".repeat(5000))).rejects.toThrow(RangeError);
    expect((await hasher.verify(await hasher.hash("ok-ok-ok-ok-ok"), "x".repeat(5000))).ok).toBe(false);
  });
});

describe("PasswordHasher — bcrypt LEGACY", () => {
  const hasher = new PasswordHasher({ params: FAST });

  it("vérifie un hash bcrypt historique et demande le re-hachage", async () => {
    const legacy = await bcrypt.hash("Ancien-Mot-De-Passe-1", 4);
    expect(hashKind(legacy)).toBe("bcrypt");
    expect(await hasher.verify(legacy, "Ancien-Mot-De-Passe-1")).toEqual({ ok: true, needsRehash: true });
  });

  it("refuse un mauvais mot de passe bcrypt, sans demander de re-hachage", async () => {
    const legacy = await bcrypt.hash("Ancien-Mot-De-Passe-1", 4);
    expect(await hasher.verify(legacy, "autre")).toEqual({ ok: false, needsRehash: false });
  });

  it("accepte les préfixes $2a$, $2b$ et $2y$", async () => {
    const base = await bcrypt.hash("Ancien-Mot-De-Passe-1", 4);
    for (const prefix of ["$2a$", "$2b$", "$2y$"]) {
      expect(hashKind(prefix + base.slice(4))).toBe("bcrypt");
    }
    expect((await hasher.verify("$2y$" + base.slice(4), "Ancien-Mot-De-Passe-1")).ok).toBe(true);
  });

  it("le re-hachage produit un hash scrypt qui vérifie le même mot de passe", async () => {
    const legacy = await bcrypt.hash("Ancien-Mot-De-Passe-1", 4);
    const first = await hasher.verify(legacy, "Ancien-Mot-De-Passe-1");
    expect(first.needsRehash).toBe(true);
    const upgraded = await hasher.hash("Ancien-Mot-De-Passe-1");
    expect(hashKind(upgraded)).toBe("scrypt");
    expect(await hasher.verify(upgraded, "Ancien-Mot-De-Passe-1")).toEqual({ ok: true, needsRehash: false });
  });
});

describe("PasswordPolicy", () => {
  const policy = new PasswordPolicy({ minLength: 12, maxLength: 128, minCharacterClasses: 0, extraBlocklist: ["MonEcole2026"] });
  const codes = (pw: string, email?: string) => policy.evaluate(pw, email ? { email } : {}).map((i) => i.code);

  it("accepte une phrase de passe longue sans règle de composition", () => {
    expect(codes("une phrase de passe tres longue")).toEqual([]);
    expect(codes("Correct-Horse-Battery-9")).toEqual([]);
  });

  it("applique longueur minimale et maximale (en caractères, pas en octets)", () => {
    expect(codes("court")).toContain("too_short");
    expect(codes("é".repeat(11))).toContain("too_short");
    expect(codes("abcdéfghijkl")).not.toContain("too_short");
    expect(codes("a".repeat(129))).toContain("too_long");
  });

  it("refuse les mots de passe courants, y compris avec accents, casse et « leet »", () => {
    for (const pw of ["password123", "Motdepasse123", "P@ssw0rd", "azertyuiop123", "Bienvenue", "cotedivoire225", "MonEcole2026"]) {
      expect(codes(pw)).toContain("common");
    }
    expect(canonicalize("P@ssw0rd")).toBe(canonicalize("password"));
  });

  it("refuse l'e-mail comme mot de passe et la partie locale de l'e-mail", () => {
    expect(codes("Awa.Kone@ecole.ci", "awa.kone@ecole.ci")).toContain("equals_email");
    expect(codes("awa.kone-2026-ok!", "awa.kone@ecole.ci")).toContain("contains_email");
    expect(codes("Correct-Horse-Battery-9", "awa.kone@ecole.ci")).toEqual([]);
    // partie locale trop courte : pas de faux positif
    expect(codes("une phrase de passe tres longue", "ab@ecole.ci")).toEqual([]);
  });

  it("refuse répétitions et suites triviales", () => {
    expect(codes("aaaaaaaaaaaaaaaa")).toContain("repetitive");
    expect(codes("abcabcabcabcabc")).toContain("repetitive");
    expect(codes("abcdefghijklmnop")).toContain("sequence");
    expect(codes("9876543210zyxwvu")).toContain("sequence");
  });

  it("peut exiger des classes de caractères (désactivé par défaut)", () => {
    const strict = new PasswordPolicy({ minLength: 8, maxLength: 128, minCharacterClasses: 3, extraBlocklist: [] });
    expect(strict.evaluate("alllowercase").map((i) => i.code)).toContain("character_classes");
    expect(strict.evaluate("Mixed-Case-9x").map((i) => i.code)).toEqual([]);
  });

  it("refuse des termes personnels (nom de l'établissement)", () => {
    const issues = policy.evaluate("lycee-prigla-2026-ok", { forbiddenTerms: ["Lycée Prigla"] });
    expect(issues.length).toBeGreaterThan(0);
  });

  it("retourne des messages en français", () => {
    expect(policy.evaluate("court")[0]?.message).toMatch(/au moins 12 caractères/);
  });
});
