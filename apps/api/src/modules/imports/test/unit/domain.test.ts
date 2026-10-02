/**
 * Tests unitaires du domaine pur : coercions, normalisation, mapping automatique, modèles, validation de ligne,
 * doublons dans le fichier, neutralisation des formules.
 */
import { describe, expect, it } from "vitest";
import { parseBoolean, parseCode, parseDate, parseDecimal, parseEmail, parseInteger, parsePhone, excelSerialToIso } from "../../domain/coerce";
import { cellsFor, detectMapping, matchTemplate, scoreHeader, validateMapping } from "../../domain/mapping";
import { isFormulaLike, keyPart, neutralizeCell, normalizeHeader } from "../../domain/text";
import { duplicateInFileIssue, findDuplicateRows, validateRow } from "../../domain/validation";
import { IMPORTERS, getImporter } from "../../importers/registry";

const ENV = { today: "2026-10-02" };

describe("coercions", () => {
  it("dates : formats français, ISO et numéro de série Excel ; jamais d'année à deux chiffres ni de date impossible", () => {
    expect(parseDate("31/12/2012")).toEqual({ ok: true, value: "2012-12-31" });
    expect(parseDate("2012-12-31")).toEqual({ ok: true, value: "2012-12-31" });
    expect(parseDate("1.2.2015")).toEqual({ ok: true, value: "2015-02-01" });
    expect(parseDate("45123")).toEqual({ ok: true, value: "2023-07-16" });
    expect(parseDate("31/02/2012").ok).toBe(false);
    expect(parseDate("12/05/12").ok).toBe(false);
    expect(parseDate("hier").ok).toBe(false);
    expect(excelSerialToIso(60)).toBeNull;
    expect(excelSerialToIso(61)).toBe("1900-03-01");
  });

  it("montants entiers XOF : séparateurs de milliers admis, décimales refusées", () => {
    expect(parseInteger("150 000", { amount: true })).toEqual({ ok: true, value: 150000 });
    expect(parseInteger("150000,00", { amount: true })).toEqual({ ok: true, value: 150000 });
    expect(parseInteger("1'500", { amount: true })).toEqual({ ok: true, value: 1500 });
    const dec = parseInteger("1500,5", { amount: true });
    expect(dec.ok).toBe(false);
    expect(!dec.ok && dec.code).toBe("imports.amount_not_integer");
    // Ambiguïté « 1.500 » : refusée plutôt que lue 1,5 ou 1 500.
    const dot = parseInteger("1.500", { amount: true });
    expect(!dot.ok && dot.code).toBe("imports.amount_not_integer");
    expect(parseInteger("-500", { amount: true }).ok).toBe(false);
    expect(parseInteger("-500", { amount: true, allowNegative: true })).toEqual({ ok: true, value: -500 });
    expect(parseInteger("abc", { amount: true }).ok).toBe(false);
  });

  it("décimaux : chaîne canonique, virgule ou point, jamais de flottant", () => {
    expect(parseDecimal("12,5")).toEqual({ ok: true, value: "12.5" });
    expect(parseDecimal("007.250")).toEqual({ ok: true, value: "7.25" });
    expect(parseDecimal("0,1")).toEqual({ ok: true, value: "0.1" });
    expect(parseDecimal("1e3").ok).toBe(false);
    expect(parseDecimal("12,34567").ok).toBe(false);
  });

  it("booléens, e-mails, téléphones, codes", () => {
    expect(parseBoolean("Oui")).toEqual({ ok: true, value: true });
    expect(parseBoolean("non")).toEqual({ ok: true, value: false });
    expect(parseBoolean("peut-être").ok).toBe(false);
    expect(parseEmail(" Jean.Dupont@Exemple.CI ")).toEqual({ ok: true, value: "jean.dupont@exemple.ci" });
    expect(parseEmail("pas un mail").ok).toBe(false);
    expect(parsePhone("07 01 02 03 04")).toEqual({ ok: true, value: "0701020304" });
    expect(parsePhone("+225 07 01 02 03 04")).toEqual({ ok: true, value: "+2250701020304" });
    expect(parsePhone("12").ok).toBe(false);
    expect(parseCode("ces 6 a")).toEqual({ ok: true, value: "CES_6_A" });
    expect(parseCode("é!").ok).toBe(false);
  });
});

describe("texte et neutralisation des formules (INV-S7)", () => {
  it("normalise les en-têtes", () => {
    expect(normalizeHeader("  Date de Naissance (JJ/MM/AAAA) ")).toBe("date de naissance jj mm aaaa");
    expect(normalizeHeader("N° Matricule")).toBe("n matricule");
    expect(keyPart("Kouassi-Éloïse  ")).toBe("KOUASSI ELOISE");
  });

  it("neutralise toute valeur interprétable comme formule, sans abîmer les nombres", () => {
    for (const bad of ["=1+1", "+cmd|' /C calc'!A0", "-2+3", "@SUM(A1:A2)", "\t=1", "\r=1", "=HYPERLINK(\"http://x\")"]) {
      expect(neutralizeCell(bad).startsWith("'"), bad).toBe(true);
      expect(isFormulaLike(neutralizeCell(bad))).toBe(false);
    }
    expect(neutralizeCell("-12")).toBe("-12");
    expect(neutralizeCell("+3,5")).toBe("+3,5");
    expect(neutralizeCell("Kouassi")).toBe("Kouassi");
    expect(neutralizeCell("")).toBe("");
  });
});

describe("mapping automatique", () => {
  const students = getImporter("students");

  it("reconnaît les en-têtes français usuels, avec accents, majuscules et fautes légères", () => {
    const headers = ["Matricule", "NOM", "Prénoms", "Sexe", "Date de naissance", "Lieu de naissance", "Téléphone", "Adresse e-mail", "Commentaire libre"];
    const d = detectMapping(students.columns, headers);
    expect(d.mapping.externalRef).toBe("Matricule");
    expect(d.mapping.lastName).toBe("NOM");
    expect(d.mapping.firstName).toBe("Prénoms");
    expect(d.mapping.sex).toBe("Sexe");
    expect(d.mapping.birthDate).toBe("Date de naissance");
    expect(d.mapping.birthPlace).toBe("Lieu de naissance");
    expect(d.mapping.phone).toBe("Téléphone");
    expect(d.mapping.email).toBe("Adresse e-mail");
    expect(d.unmappedHeaders).toEqual(["Commentaire libre"]);
    expect(d.missingRequired).toEqual([]);
  });

  it("n'affecte jamais un en-tête à deux champs et signale les champs obligatoires manquants", () => {
    const d = detectMapping(students.columns, ["Nom et prénoms", "Naissance"]);
    const used = Object.values(d.mapping).filter((v): v is string => v !== null);
    expect(new Set(used).size).toBe(used.length);
    expect(d.missingRequired.length).toBeGreaterThan(0);
  });

  it("score : exact > inclusion > faute de frappe", () => {
    expect(scoreHeader("Nom", "nom")).toBe(100);
    expect(scoreHeader("Date de naissance de l'élève", "date naissance")).toBeGreaterThan(70);
    expect(scoreHeader("Naisance", "naissance")).toBeGreaterThanOrEqual(70);
    expect(scoreHeader("Classe", "sexe")).toBe(0);
  });

  it("valide un mapping : champ inconnu, en-tête absent, en-tête dupliqué, obligatoire manquant", () => {
    const headers = ["Nom", "Prénom", "Sexe"];
    expect(validateMapping(students.columns, headers, { lastName: "Nom", firstName: "Prénom", sex: "Sexe" })).toEqual([]);
    const problems = validateMapping(students.columns, headers, { lastName: "Nom", firstName: "Nom", sex: "Absent", bogus: "Sexe" });
    expect(problems.map((p) => p.code)).toEqual(["imports.mapping_invalid", "imports.mapping_invalid", "imports.mapping_invalid"]);
    expect(validateMapping(students.columns, headers, { lastName: "Nom" }).map((p) => p.code)).toContain("imports.mapping_incomplete");
  });

  it("propose un modèle enregistré si au moins 80 % de ses en-têtes sont présents", () => {
    const tpl = { id: "t1", mapping: { lastName: "NOM", firstName: "PRENOM", sex: "SEXE" }, headers: ["NOM", "PRENOM", "SEXE", "CLASSE", "DATE"], updatedAt: "2026-01-01" };
    expect(matchTemplate([tpl], ["nom", "prenom", "sexe", "classe", "date", "autre"], students.columns)?.template.id).toBe("t1");
    expect(matchTemplate([tpl], ["nom", "prenom", "x"], students.columns)).toBeNull();
    const applied = matchTemplate([tpl], ["Nom", "Prenom", "Sexe", "Classe", "Date"], students.columns);
    expect(applied?.mapping.lastName).toBe("Nom");
  });

  it("extrait les cellules mappées d'une ligne (vides omises)", () => {
    expect(cellsFor({ lastName: "Nom", firstName: "Prénom", sex: null }, ["Nom", "Prénom", "Sexe"], [" Koné ", "", "F"])).toEqual({ lastName: "Koné" });
  });
});

describe("validation de ligne et doublons dans le fichier", () => {
  const students = getImporter("students");

  it("valide une ligne élève, coerce les types et calcule la clé naturelle", () => {
    const r = validateRow(students, { externalRef: "A-001", lastName: "Koné", firstName: "Aminata", sex: "F", birthDate: "03/04/2012", phone: "07 01 02 03 04" }, {}, ENV);
    expect(r.issues).toEqual([]);
    expect(r.values).toMatchObject({ externalRef: "A-001", lastName: "Koné", sex: "F", birthDate: "2012-04-03", phone: "0701020304" });
    expect(r.naturalKey).toBe("students|ref|A-001");
  });

  it("rapporte les erreurs par colonne avec des codes stables", () => {
    const r = validateRow(students, { lastName: "Koné", sex: "X", birthDate: "31/02/2012", email: "nope" }, {}, ENV);
    const byColumn = Object.fromEntries(r.issues.map((i) => [i.column, i.code]));
    expect(byColumn.firstName).toBe("imports.required");
    expect(byColumn.birthDate).toBe("imports.invalid_date");
    expect(byColumn.email).toBe("imports.invalid_email");
    expect(r.values).toBeNull();
  });

  it("refuse une date de naissance dans le futur ou invraisemblable", () => {
    const future = validateRow(students, { lastName: "A", firstName: "B", sex: "M", birthDate: "01/01/2090" }, {}, ENV);
    expect(future.issues.some((i) => i.column === "birthDate" && i.severity === "ERROR")).toBe(true);
  });

  it("détecte les doublons : la première ligne reste valide, les suivantes renvoient à elle", () => {
    const dups = findDuplicateRows([
      { rowNo: 2, naturalKey: "k1" },
      { rowNo: 3, naturalKey: "k2" },
      { rowNo: 4, naturalKey: "k1" },
      { rowNo: 5, naturalKey: null },
      { rowNo: 6, naturalKey: "k1" },
    ]);
    expect([...dups.entries()]).toEqual([[4, 2], [6, 2]]);
    expect(duplicateInFileIssue(2)).toMatchObject({ code: "imports.duplicate_in_file", severity: "ERROR" });
  });

  it("le registre expose les sept importeurs, avec un modèle de fichier cohérent avec leurs colonnes", () => {
    expect(Object.keys(IMPORTERS).sort()).toEqual(["classrooms", "curriculum", "grades", "guardians", "opening_balances", "staff", "students"]);
    for (const imp of Object.values(IMPORTERS)) {
      for (const row of imp.sampleRows) expect(row.length, imp.key).toBe(imp.columns.length);
      expect(imp.importPermission).toBe(`imports.import.${imp.key}`);
      for (const c of imp.columns) expect(c.aliases.length, `${imp.key}.${c.key}`).toBeGreaterThan(0);
    }
    expect(IMPORTERS.opening_balances.sensitive).toBe(true);
    expect(IMPORTERS.students.sensitive).toBe(false);
  });
});
