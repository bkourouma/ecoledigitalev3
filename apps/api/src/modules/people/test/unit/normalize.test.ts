import { describe, expect, it } from "vitest";
import { addDays, cleanText, displayName, foldText, isPlausibleBirthDate, isValidDate, nameTokens, normalizeEmail, normalizePhone, searchKey } from "../../domain/normalize";
import { formatNumber, validatePattern } from "../../domain/number-pattern";
import { csvCell, toCsv } from "../../domain/csv";
import { sniffImage, studentPhotoKey } from "../../domain/files";
import { boundedLevenshtein, matchPerson } from "../../domain/duplicates";

describe("normalisation des noms", () => {
  it("replie accents, casse, ligatures et apostrophes typographiques", () => {
    expect(foldText("Kouamé N’Guessan")).toBe("kouame n'guessan");
    expect(foldText("Œuvre Æther Straße")).toBe("oeuvre aether strasse");
    expect(foldText(null)).toBe("");
  });
  it("searchKey reproduit la colonne générée (nom prénom autres prénoms, espaces compactés)", () => {
    expect(searchKey("Traoré", "Aminata", "  Fatou ")).toBe("traore aminata fatou");
    expect(searchKey("DIALLO", "Moussa")).toBe("diallo moussa");
  });
  it("displayName = NOM Prénom, particules et tirets conservés", () => {
    expect(displayName("de la Fontaine", "Jean-Marc")).toBe("DE LA FONTAINE Jean-Marc");
    expect(displayName("Kouamé", "Éloïse")).toBe("KOUAMÉ Éloïse");
  });
  it("nameTokens ignore ponctuation et ordre d'écriture", () => {
    expect(nameTokens("Jean-Marc", "KOUAMÉ")).toEqual(["jean", "marc", "kouame"]);
  });
  it("cleanText compacte les espaces", () => {
    expect(cleanText("  a   b \n c ")).toBe("a b c");
  });
});

describe("téléphones E.164 (R9)", () => {
  it("convertit un numéro national quand le pays est connu", () => {
    expect(normalizePhone("07 07 07 07 07", "CI")).toBe("+2250707070707");
    expect(normalizePhone("06 12 34 56 78", "FR")).toBe("+33612345678"); // zéro d'accès retiré
  });
  it("00 devient +, un numéro international est conservé", () => {
    expect(normalizePhone("00225 07 07 07 07 07", null)).toBe("+2250707070707");
    expect(normalizePhone("+225 (07) 07-07-07-07", "FR")).toBe("+2250707070707");
  });
  it("pays inconnu : numéro nettoyé tel quel ; sans chiffre : null", () => {
    expect(normalizePhone("07.07.07.07.07", null)).toBe("0707070707");
    expect(normalizePhone("abc", "CI")).toBeNull();
    expect(normalizePhone("0707070707", "ZZ")).toBe("0707070707");
  });
  it("longueur ≤ 40 (le legacy plantait à 20)", () => {
    expect(normalizePhone("+".concat("1".repeat(14)), null)?.length).toBeLessThanOrEqual(40);
  });
  it("normalise l'e-mail", () => {
    expect(normalizeEmail("  Parent@Example.TEST ")).toBe("parent@example.test");
  });
});

describe("dates", () => {
  it("validité calendaire", () => {
    expect(isValidDate("2024-02-29")).toBe(true);
    expect(isValidDate("2023-02-29")).toBe(false);
    expect(isValidDate("2024-13-01")).toBe(false);
    expect(isValidDate("24-01-01")).toBe(false);
  });
  it("date de naissance vraisemblable : ni futur, ni avant 1900 — aucun seuil d'âge", () => {
    expect(isPlausibleBirthDate("2010-04-02", "2025-09-01")).toBe(true);
    expect(isPlausibleBirthDate("2025-09-02", "2025-09-01")).toBe(false);
    expect(isPlausibleBirthDate("1899-12-31", "2025-09-01")).toBe(false);
    expect(isPlausibleBirthDate("2025-09-01", "2025-09-01")).toBe(true);
  });
  it("addDays traverse mois et années", () => {
    expect(addDays("2025-12-31", 1)).toBe("2026-01-01");
    expect(addDays("2025-03-01", -1)).toBe("2025-02-28");
  });
});

describe("motif de numérotation", () => {
  it("jetons {SEQ:n} {YYYY} {YY} {PREFIX}", () => {
    expect(formatNumber("{SEQ:5}", { seq: 7, year: 2025, prefix: null })).toBe("00007");
    expect(formatNumber("{PREFIX}-{YYYY}-{SEQ:4}", { seq: 12, year: 2025, prefix: "LPR" })).toBe("LPR-2025-0012");
    expect(formatNumber("{YY}/{SEQ:3}", { seq: 1, year: 2031, prefix: null })).toBe("31/001");
  });
  it("le compteur n'est jamais tronqué", () => {
    expect(formatNumber("{SEQ:2}", { seq: 12345, year: 2025, prefix: null })).toBe("12345");
  });
  it("{PREFIX} sans préfixe configuré est une erreur, jamais une chaîne vide silencieuse", () => {
    expect(() => formatNumber("{PREFIX}{SEQ:3}", { seq: 1, year: 2025, prefix: null })).toThrow();
    expect(() => formatNumber("{SEQ:5}", { seq: 0, year: 2025, prefix: null })).toThrow();
  });
  it("validation du motif", () => {
    expect(validatePattern("{SEQ:5}")).toBeNull();
    expect(validatePattern("P{SEQ:4}")).toBeNull();
    expect(validatePattern("ABC")).not.toBeNull(); // pas de {SEQ}
    expect(validatePattern("{SEQ:5}{SEQ:3}")).not.toBeNull(); // deux compteurs
    expect(validatePattern("{FOO}{SEQ:5}")).not.toBeNull(); // jeton inconnu
    expect(validatePattern("é{SEQ:5}")).not.toBeNull(); // caractère interdit
  });
});

describe("CSV", () => {
  it("protège contre l'injection de formule et échappe séparateurs et guillemets", () => {
    expect(csvCell("=1+1")).toBe("'=1+1");
    expect(csvCell("@SUM(A1)")).toBe("'@SUM(A1)");
    expect(csvCell("-12")).toBe("-12");
    expect(csvCell('a;b')).toBe('"a;b"');
    expect(csvCell('dit "oui"')).toBe('"dit ""oui"""');
    expect(csvCell(null)).toBe("");
  });
  it("en-tête, BOM et fins de ligne CRLF", () => {
    const csv = toCsv(["A", "B"], [["1", "2"]]);
    expect(csv.startsWith("﻿A;B\r\n1;2\r\n")).toBe(true);
  });
});

describe("photo : octets magiques", () => {
  it("reconnaît JPEG, PNG, WebP et refuse le reste (extension et type MIME ne comptent pas)", () => {
    expect(sniffImage(Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0]))).toBe("image/jpeg");
    expect(sniffImage(Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0]))).toBe("image/png");
    expect(sniffImage(Uint8Array.from([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]))).toBe("image/webp");
    expect(sniffImage(new TextEncoder().encode("<svg onload=alert(1)>"))).toBeNull();
    expect(sniffImage(new TextEncoder().encode("%PDF-1.7"))).toBeNull();
    expect(sniffImage(Uint8Array.from([]))).toBeNull();
  });
  it("clé de stockage objet par tenant et par élève (R13)", () => {
    expect(studentPhotoKey("t", "s")).toBe("tenants/t/people/students/s/photo");
  });
});

describe("détection de doublons (R11)", () => {
  const base = { lastName: "Kouamé", firstName: "Jean-Marc", birthDate: "2010-04-02" };
  it("EXACT : permutation nom/prénom, accents et casse ignorés, même date", () => {
    expect(matchPerson(base, { lastName: "jean-marc", firstName: "KOUAME", birthDate: "2010-04-02" })).toBe("EXACT");
    expect(matchPerson(base, { lastName: "Kouamé", firstName: "Jean Marc", otherNames: "Yao", birthDate: "2010-04-02" })).toBe("EXACT");
  });
  it("NEAR : une faute de frappe par mot, même date", () => {
    expect(matchPerson(base, { lastName: "Kouamee", firstName: "Jean-Marc", birthDate: "2010-04-02" })).toBe("NEAR");
    expect(matchPerson(base, { lastName: "Kouamé", firstName: "Jean-Marq", birthDate: "2010-04-02" })).toBe("NEAR");
  });
  it("NAME_ONLY : mêmes mots mais une date inconnue ; jamais deux homonymes de dates différentes", () => {
    expect(matchPerson({ ...base, birthDate: null }, { ...base })).toBe("NAME_ONLY");
    expect(matchPerson(base, { ...base, birthDate: "2012-01-01" })).toBeNull();
    expect(matchPerson(base, { lastName: "Diallo", firstName: "Moussa", birthDate: "2010-04-02" })).toBeNull();
  });
  it("signaux de contact (personnel) : même e-mail, même téléphone", () => {
    const staff = { lastName: "A", firstName: "B", email: "x@example.test", phone: "+2250707070707" };
    expect(matchPerson(staff, { lastName: "Autre", firstName: "Nom", email: "X@Example.test" }, { contactSignals: true })).toBe("EMAIL");
    expect(matchPerson(staff, { lastName: "Autre", firstName: "Nom", phone: "+2250707070707" }, { contactSignals: true })).toBe("PHONE");
    expect(matchPerson(staff, { lastName: "Autre", firstName: "Nom", email: "x@example.test" })).toBeNull();
  });
  it("distance de Levenshtein bornée", () => {
    expect(boundedLevenshtein("kitten", "sitten", 1)).toBe(1);
    expect(boundedLevenshtein("kitten", "sitting", 1)).toBe(2);
    expect(boundedLevenshtein("abc", "abc", 0)).toBe(0);
    expect(boundedLevenshtein("a", "abcdef", 2)).toBe(3);
  });
});
