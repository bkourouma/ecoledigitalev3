import { describe, expect, it } from "vitest";
import { base32Decode, base32Encode, generateTotpSecret, hotp, otpauthUri, totp, totpStep, verifyTotp } from "../domain/totp";

// Secrets de test de la RFC 6238, Annexe B (ASCII répété jusqu'à la taille de la fonction de hachage).
const S1 = Buffer.from("12345678901234567890", "ascii");
const S256 = Buffer.from("12345678901234567890123456789012", "ascii");
const S512 = Buffer.from("1234567890123456789012345678901234567890123456789012345678901234", "ascii");

// [temps Unix en s, SHA1, SHA256, SHA512] — codes à 8 chiffres, RFC 6238 Annexe B.
const RFC6238: Array<[number, string, string, string]> = [
  [59, "94287082", "46119246", "90693936"],
  [1111111109, "07081804", "68084774", "25091201"],
  [1111111111, "14050471", "67062674", "99943326"],
  [1234567890, "89005924", "91819424", "93441116"],
  [2000000000, "69279037", "90698825", "38618901"],
  [20000000000, "65353130", "77737706", "47863826"],
];

// Vecteurs de la RFC 4226, Annexe D (compteurs 0 à 9, 6 chiffres).
const RFC4226 = ["755224", "287082", "359152", "969429", "338314", "254676", "287922", "162583", "399871", "520489"];

describe("HOTP — RFC 4226 Annexe D", () => {
  it.each(RFC4226.map((code, counter) => [counter, code] as const))("compteur %i → %s", (counter, expected) => {
    expect(hotp(S1, counter, 6, "SHA1")).toBe(expected);
  });
});

describe("TOTP — RFC 6238 Annexe B", () => {
  it.each(RFC6238)("T=%i (SHA1, SHA256, SHA512, 8 chiffres)", (t, sha1, sha256, sha512) => {
    expect(totp(S1, t * 1000, { digits: 8, algorithm: "SHA1" })).toBe(sha1);
    expect(totp(S256, t * 1000, { digits: 8, algorithm: "SHA256" })).toBe(sha256);
    expect(totp(S512, t * 1000, { digits: 8, algorithm: "SHA512" })).toBe(sha512);
  });

  it("6 chiffres = les 6 derniers chiffres du code à 8 chiffres (troncature dynamique)", () => {
    expect(totp(S1, 59_000)).toBe("287082"); // 94287082 → 287082
  });

  it("calcule le pas : floor((T - T0) / période)", () => {
    expect(totpStep(59_000)).toBe(1);
    expect(totpStep(60_000)).toBe(2);
    expect(totpStep(29_999)).toBe(0);
    expect(totpStep(100_000, { period: 60, t0: 40 })).toBe(1);
  });
});

describe("verifyTotp", () => {
  const now = 1_700_000_000_000;
  const step = totpStep(now);

  it("accepte le code courant et renvoie son pas", () => {
    expect(verifyTotp(S1, totp(S1, now), now)).toBe(step);
  });

  it("tolère ±1 pas (dérive d'horloge) mais pas ±2", () => {
    expect(verifyTotp(S1, totp(S1, now - 30_000), now)).toBe(step - 1);
    expect(verifyTotp(S1, totp(S1, now + 30_000), now)).toBe(step + 1);
    expect(verifyTotp(S1, totp(S1, now - 60_000), now)).toBeNull();
    expect(verifyTotp(S1, totp(S1, now + 60_000), now)).toBeNull();
  });

  it("refuse le rejeu : un pas déjà consommé (minStepExclusive) est rejeté", () => {
    const code = totp(S1, now);
    expect(verifyTotp(S1, code, now, { minStepExclusive: step })).toBeNull();
    expect(verifyTotp(S1, code, now, { minStepExclusive: step - 1 })).toBe(step);
  });

  it("refuse les formats invalides sans lever", () => {
    for (const bad of ["", "12345", "1234567", "abcdef", "12 456", "١٢٣٤٥٦"]) expect(verifyTotp(S1, bad, now)).toBeNull();
    // @ts-expect-error entrée non conforme volontaire
    expect(verifyTotp(S1, 123456, now)).toBeNull();
  });

  it("un mauvais secret ne valide pas", () => {
    expect(verifyTotp(S256, totp(S1, now), now)).toBeNull();
  });
});

describe("base32 (RFC 4648)", () => {
  it("vecteurs de la RFC 4648 §10", () => {
    const cases: Array<[string, string]> = [["", ""], ["f", "MY"], ["fo", "MZXQ"], ["foo", "MZXW6"], ["foob", "MZXW6YQ"], ["fooba", "MZXW6YTB"], ["foobar", "MZXW6YTBOI"]];
    for (const [plain, b32] of cases) {
      expect(base32Encode(Buffer.from(plain))).toBe(b32);
      expect(base32Decode(b32).toString()).toBe(plain);
    }
  });

  it("décode sans tenir compte de la casse, des espaces, des tirets et du remplissage", () => {
    expect(base32Decode("mzxw 6ytb-oi======").toString()).toBe("foobar");
  });

  it("aller-retour sur des octets aléatoires et rejet des caractères invalides", () => {
    const secret = generateTotpSecret(20);
    expect(secret).toHaveLength(20);
    expect(base32Decode(base32Encode(secret)).equals(secret)).toBe(true);
    expect(() => base32Decode("MZXW1")).toThrow(RangeError); // « 1 » n'est pas dans l'alphabet
  });
});

describe("otpauth://", () => {
  it("construit un URI Key Uri Format conforme", () => {
    const uri = otpauthUri({ issuer: "EcoleDigitale", accountName: "parent@exemple.ci", secret: S1 });
    const u = new URL(uri);
    expect(u.protocol).toBe("otpauth:");
    expect(u.host).toBe("totp");
    expect(decodeURIComponent(u.pathname)).toBe("/EcoleDigitale:parent@exemple.ci");
    expect(u.searchParams.get("secret")).toBe(base32Encode(S1));
    expect(u.searchParams.get("issuer")).toBe("EcoleDigitale");
    expect(u.searchParams.get("algorithm")).toBe("SHA1");
    expect(u.searchParams.get("digits")).toBe("6");
    expect(u.searchParams.get("period")).toBe("30");
  });

  it("neutralise le séparateur « : » de l'émetteur", () => {
    expect(otpauthUri({ issuer: "A:B", accountName: "x@y.zz", secret: S1 })).toContain("A%20B:x%40y.zz");
  });
});
