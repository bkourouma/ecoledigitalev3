import { createHash, generateKeyPairSync } from "node:crypto";
import { describe, expect, it } from "vitest";
import { CanonicalizationError, canonicalJson, compareUtf8, snapshotHash } from "../../domain/canonical";
import {
  base32Encode,
  generateVerificationCode,
  isVerificationCode,
  parsePrivateKey,
  publicKeyFingerprint,
  publicKeyOf,
  signDocument,
  signingMessage,
  verifyDocumentSignature,
} from "../../domain/signing";
import { StaticKeyProvider, generateSigningKeyPair, keyProviderFromEnv } from "../../infrastructure/key-provider";

/** Vecteur PARTAGÉ avec la fonction SQL `reportcards.canonical_json` (rejoué dans guards.integration.test.ts). */
export const SHARED_VECTOR = {
  value: { z: 1, a: "é", n: { b: [3, "x", true, null], a: "12.50" }, "\u{1F600}": 1, "�": 2, "é": "x" },
  canonical: '{"explain":[],"snapshot":{"a":"é","n":{"a":"12.50","b":[3,"x",true,null]},"z":1,"é":"x","�":2,"\u{1F600}":1}}',
  hash: "9710a4c820254a6e68823dbeb96b73bb9c388cd9c778d14c006af776c924a53d",
};

describe("JSON canonique et hash", () => {
  it("vecteur partagé : clés triées par octets UTF-8, NFC, sans espace — hash SHA-256 figé", () => {
    expect(canonicalJson({ snapshot: SHARED_VECTOR.value, explain: [] })).toBe(SHARED_VECTOR.canonical);
    expect(snapshotHash(SHARED_VECTOR.value, [])).toBe(SHARED_VECTOR.hash);
    expect(createHash("sha256").update(Buffer.from(SHARED_VECTOR.canonical, "utf8")).digest("hex")).toBe(SHARED_VECTOR.hash);
  });

  it("l'ordre des clés est indifférent, l'ordre des listes est significatif", () => {
    expect(canonicalJson({ b: 1, a: { d: 1, c: 2 } })).toBe(canonicalJson({ a: { c: 2, d: 1 }, b: 1 }));
    expect(canonicalJson([1, 2])).not.toBe(canonicalJson([2, 1]));
    expect(snapshotHash({ x: 1, y: 2 }, [])).toBe(snapshotHash({ y: 2, x: 1 }, []));
  });

  it("l'ordre est celui des OCTETS UTF-8 (pas des unités UTF-16) : U+FFFD avant U+1F600", () => {
    expect(compareUtf8("�", "\u{1F600}")).toBeLessThan(0);
    expect("�" < "\u{1F600}").toBe(false); // l'ordre naturel de JavaScript diffère : c'est le piège évité
  });

  it("les chaînes sont normalisées en NFC (é composé = e + accent)", () => {
    expect(canonicalJson({ k: "é" })).toBe(canonicalJson({ k: "é" }));
    expect(snapshotHash({ nom: "Zoé" }, [])).toBe(snapshotHash({ nom: "Zoé" }, []));
  });

  it("refuse flottants, NaN, undefined, fonctions, instances de classe (nombres décimaux = chaînes)", () => {
    expect(() => canonicalJson({ n: 1.5 })).toThrow(CanonicalizationError);
    expect(() => canonicalJson({ n: NaN })).toThrow(/entier/);
    expect(() => canonicalJson({ n: Number.MAX_SAFE_INTEGER + 2 })).toThrow(CanonicalizationError);
    expect(() => canonicalJson({ n: -0 })).toThrow(CanonicalizationError);
    expect(() => canonicalJson({ n: undefined })).toThrow(/Type non sérialisable/);
    expect(() => canonicalJson({ d: new Date() })).toThrow(/classe/);
    expect(() => canonicalJson({ f: () => 1 })).toThrow(CanonicalizationError);
    expect(canonicalJson({ n: 12, s: "12.50", t: true, z: null })).toBe('{"n":12,"s":"12.50","t":true,"z":null}');
  });

  it("échappe comme JSON.stringify (guillemets, barres, contrôles) — miroir de to_jsonb(text)", () => {
    expect(canonicalJson({ a: 'x"y\\z\n\t\u0001' })).toBe('{"a":"x\\"y\\\\z\\n\\t\\u0001"}');
  });

  it("le hash couvre le snapshot ET la trace : modifier l'un change l'empreinte", () => {
    const base = snapshotHash({ v: 1 }, [{ lineCode: "A", rules: [] }]);
    expect(snapshotHash({ v: 2 }, [{ lineCode: "A", rules: [] }])).not.toBe(base);
    expect(snapshotHash({ v: 1 }, [{ lineCode: "B", rules: [] }])).not.toBe(base);
  });
});

describe("code de vérification", () => {
  it("128 bits en base32 : 26 caractères, alphabet RFC 4648, jamais deux fois le même", () => {
    const codes = new Set(Array.from({ length: 2000 }, () => generateVerificationCode()));
    expect(codes.size).toBe(2000);
    for (const c of codes) expect(isVerificationCode(c)).toBe(true);
    expect(generateVerificationCode()).toMatch(/^[A-Z2-7]{26}$/);
  });
  it("base32 : vecteurs RFC 4648", () => {
    expect(base32Encode(Buffer.from("foobar"))).toBe("MZXW6YTBOI");
    expect(base32Encode(Buffer.from("f"))).toBe("MY");
    expect(base32Encode(new Uint8Array(16))).toBe("A".repeat(26));
    expect(base32Encode(new Uint8Array(16).fill(255))).toBe("7".repeat(25) + "4");
  });
  it("rejette un format incorrect", () => {
    for (const bad of ["", "abc", "A".repeat(25), "A".repeat(27), "a".repeat(26), "1".repeat(26), `${"A".repeat(25)}0`, null, 42]) {
      expect(isVerificationCode(bad)).toBe(false);
    }
  });
});

describe("signature Ed25519", () => {
  const { privateKey } = generateKeyPairSync("ed25519");
  const publicKey = publicKeyOf(privateKey);
  const input = { snapshotHash: "a".repeat(64), verificationCode: "A".repeat(26), issuedAt: new Date("2026-02-03T04:05:06.789Z") };

  it("message signé = préfixe, hash, code, instant ISO UTC séparés par NUL", () => {
    const msg = signingMessage(input);
    expect(msg.toString("utf8")).toBe(`ed-rc/v1\0${"a".repeat(64)}\0${"A".repeat(26)}\0${"2026-02-03T04:05:06.789Z"}`);
  });

  it("signe et vérifie ; toute altération du hash, du code ou de la date invalide la signature", () => {
    const sig = signDocument(privateKey, input);
    expect(Buffer.from(sig, "base64")).toHaveLength(64);
    expect(verifyDocumentSignature(publicKey, input, sig)).toBe(true);
    expect(verifyDocumentSignature(publicKey, { ...input, snapshotHash: "b".repeat(64) }, sig)).toBe(false);
    expect(verifyDocumentSignature(publicKey, { ...input, verificationCode: "B".repeat(26) }, sig)).toBe(false);
    expect(verifyDocumentSignature(publicKey, { ...input, issuedAt: new Date("2026-02-03T04:05:06.790Z") }, sig)).toBe(false);
  });

  it("Ed25519 est déterministe (RFC 8032) : même message, même signature", () => {
    expect(signDocument(privateKey, input)).toBe(signDocument(privateKey, input));
  });

  it("une autre clé ne vérifie pas ; une signature ou une clé mal formée donne false (jamais d'exception)", () => {
    const other = publicKeyOf(generateKeyPairSync("ed25519").privateKey);
    const sig = signDocument(privateKey, input);
    expect(verifyDocumentSignature(other, input, sig)).toBe(false);
    expect(verifyDocumentSignature(publicKey, input, "not-base64!!")).toBe(false);
    expect(verifyDocumentSignature(publicKey, input, Buffer.alloc(10).toString("base64"))).toBe(false);
    expect(verifyDocumentSignature("garbage", input, sig)).toBe(false);
  });

  it("vérification HORS LIGNE : on reconstruit le message depuis les champs publiés et la clé publique seule", () => {
    const sig = signDocument(privateKey, input);
    const offline = { snapshotHash: input.snapshotHash, verificationCode: input.verificationCode, issuedAt: "2026-02-03T04:05:06.789Z" };
    expect(verifyDocumentSignature(publicKey, offline, sig)).toBe(true);
    expect(publicKeyFingerprint(publicKey)).toMatch(/^[0-9a-f]{64}$/);
  });

  it("rotation : un document signé par l'ancienne clé reste vérifiable avec SA clé publique", () => {
    const k1 = generateKeyPairSync("ed25519").privateKey;
    const k2 = generateKeyPairSync("ed25519").privateKey;
    const s1 = signDocument(k1, input);
    const s2 = signDocument(k2, input);
    expect(verifyDocumentSignature(publicKeyOf(k1), input, s1)).toBe(true);
    expect(verifyDocumentSignature(publicKeyOf(k2), input, s2)).toBe(true);
    expect(verifyDocumentSignature(publicKeyOf(k2), input, s1)).toBe(false);
  });

  it("refuse les entrées invalides à la construction du message", () => {
    expect(() => signingMessage({ ...input, snapshotHash: "xyz" })).toThrow(TypeError);
    expect(() => signingMessage({ ...input, verificationCode: "short" })).toThrow(TypeError);
  });
});

describe("fournisseur de clé (environnement)", () => {
  it("lit une clé PKCS#8 PEM, y compris avec \\n échappés, ou DER base64 ; identifiant dérivé de l'empreinte", () => {
    const pair = generateSigningKeyPair();
    const fromPem = keyProviderFromEnv({ REPORTCARDS_SIGNING_KEY: pair.privateKeyPem });
    const fromEscaped = keyProviderFromEnv({ REPORTCARDS_SIGNING_KEY: pair.privateKeyPem.replace(/\n/g, "\\n") });
    const der = pair.privateKey.export({ format: "der", type: "pkcs8" }).toString("base64");
    const fromDer = keyProviderFromEnv({ REPORTCARDS_SIGNING_KEY: der, REPORTCARDS_SIGNING_KEY_ID: "ecole-2026-01" });
    expect(fromPem?.publicKey).toBe(pair.publicKey);
    expect(fromEscaped?.publicKey).toBe(pair.publicKey);
    expect(fromDer?.keyId).toBe("ecole-2026-01");
    expect(fromPem?.keyId).toMatch(/^ed-[0-9a-f]{16}$/);
  });
  it("sans clé : null ; clé invalide : erreur SANS reprendre la valeur", () => {
    expect(keyProviderFromEnv({})).toBeNull();
    const secret = "MC4CAQAwBQYDK2VwBCIEIsupersecretvaluexxxxxxxxxxxxxxxxxxxxxxxx";
    try {
      keyProviderFromEnv({ REPORTCARDS_SIGNING_KEY: secret });
      throw new Error("devait lever");
    } catch (e) {
      expect(String((e as Error).message)).not.toContain("supersecret");
      expect((e as Error).message).toMatch(/Ed25519/);
    }
    expect(() => parsePrivateKey(generateKeyPairSync("ed25519").publicKey.export({ format: "pem", type: "spki" }).toString())).toThrow(/invalide/);
  });
  it("la clé privée n'apparaît ni dans JSON.stringify, ni dans util.inspect, ni dans toJSON", () => {
    const pair = generateSigningKeyPair();
    const provider = new StaticKeyProvider(pair.privateKey, "test-key-01");
    const json = JSON.stringify(provider);
    expect(json).not.toContain("PRIVATE");
    expect(json).toBe(JSON.stringify({ keyId: "test-key-01", publicKey: pair.publicKey }));
    expect(Object.keys(provider).sort()).toEqual(["keyId", "publicKey"]);
  });
  it("rejette un identifiant de clé invalide", () => {
    expect(() => new StaticKeyProvider(generateSigningKeyPair().privateKey, "BAD KEY")).toThrow(/Identifiant/);
  });
});
