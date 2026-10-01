import { describe, expect, it } from "vitest";
import {
  checksumOf,
  hasNoTransactionDirective,
  headerDirectives,
  normalizeSql,
  splitStatements,
} from "../src/migrations/sql";

describe("checksum", () => {
  it("ignore le BOM et les fins de ligne CRLF", () => {
    const lf = "CREATE TABLE a (id int);\nSELECT 1;\n";
    expect(checksumOf(`﻿${lf.replace(/\n/g, "\r\n")}`)).toBe(checksumOf(lf));
  });
  it("change dès que le contenu change", () => {
    expect(checksumOf("SELECT 1;")).not.toBe(checksumOf("SELECT 2;"));
    expect(checksumOf("SELECT 1;")).toMatch(/^[0-9a-f]{64}$/);
  });
  it("normalizeSql", () => {
    expect(normalizeSql("﻿a\r\nb\rc")).toBe("a\nb\nc");
  });
});

describe("directive -- no-transaction", () => {
  it("est reconnue dans l'en-tête de commentaires", () => {
    expect(hasNoTransactionDirective("-- no-transaction\nCREATE INDEX CONCURRENTLY i ON t(a);")).toBe(true);
    expect(hasNoTransactionDirective("-- Titre\n\n--   No-Transaction  \nSELECT 1;")).toBe(true);
    expect(hasNoTransactionDirective("﻿-- no-transaction\r\nSELECT 1;")).toBe(true);
  });
  it("n'est pas reconnue après la première instruction ni dans un texte", () => {
    expect(hasNoTransactionDirective("SELECT 1;\n-- no-transaction\n")).toBe(false);
    expect(hasNoTransactionDirective("-- ce fichier n'est pas no-transaction du tout\nSELECT 1;")).toBe(false);
    expect(hasNoTransactionDirective("SELECT 'no-transaction';")).toBe(false);
  });
});

describe("directives d'en-tête", () => {
  it("lit no-transaction et no-role, cumulables, dans l'en-tête seulement", () => {
    expect([...headerDirectives("-- no-role\n-- Titre\n-- no-transaction\nSELECT 1;")].sort()).toEqual([
      "no-role",
      "no-transaction",
    ]);
    expect([...headerDirectives("SELECT 1;\n-- no-role\n")]).toEqual([]);
    expect([...headerDirectives("-- no-roles\nSELECT 1;")]).toEqual([]);
  });
});

describe("splitStatements", () => {
  const sqls = (s: string) => splitStatements(s).map((x) => x.sql);

  it("découpe sur les ; de premier niveau", () => {
    expect(sqls("SELECT 1; SELECT 2;\nSELECT 3")).toEqual(["SELECT 1", "SELECT 2", "SELECT 3"]);
  });
  it("ne coupe pas dans les chaînes, même avec '' et E'\\''", () => {
    expect(sqls("INSERT INTO t VALUES ('a;b', 'it''s; ok'); SELECT 1;")).toEqual([
      "INSERT INTO t VALUES ('a;b', 'it''s; ok')",
      "SELECT 1",
    ]);
    expect(sqls("SELECT E'a\\';b'; SELECT 2;")).toEqual(["SELECT E'a\\';b'", "SELECT 2"]);
  });
  it("ne coupe pas dans les identifiants entre guillemets", () => {
    expect(sqls('CREATE TABLE "a;b" (id int); SELECT 1;')).toEqual(['CREATE TABLE "a;b" (id int)', "SELECT 1"]);
  });
  it("gère le dollar-quoting, étiqueté ou non, et imbriqué", () => {
    const fn = "CREATE FUNCTION f() RETURNS void LANGUAGE plpgsql AS $$ BEGIN PERFORM 1; END $$";
    expect(sqls(`${fn}; SELECT 1;`)).toEqual([fn, "SELECT 1"]);
    const tagged = "DO $body$ BEGIN EXECUTE $inner$ SELECT 1; $inner$; END $body$";
    expect(sqls(`${tagged}; SELECT 2;`)).toEqual([tagged, "SELECT 2"]);
  });
  it("ne confond pas $1 (paramètre) avec un dollar-quote", () => {
    expect(sqls("SELECT $1; SELECT $2;")).toEqual(["SELECT $1", "SELECT $2"]);
  });
  it("ignore les ; dans les commentaires, y compris imbriqués", () => {
    expect(sqls("-- a; b\nSELECT 1; /* x; /* y; */ z; */ SELECT 2;")).toEqual([
      "-- a; b\nSELECT 1",
      "/* x; /* y; */ z; */ SELECT 2",
    ]);
  });
  it("supprime les instructions vides ou composées de commentaires seuls", () => {
    expect(sqls(";;; SELECT 1;\n-- fin\n")).toEqual(["SELECT 1"]);
    expect(sqls("   \n-- rien\n")).toEqual([]);
  });
  it("détecte le premier mot-clé hors commentaires (contrôle de transaction)", () => {
    const kinds = splitStatements("-- c\nBEGIN;\n/* x */ commit;\nDO $$ BEGIN END $$;\nSTART TRANSACTION;");
    expect(kinds.map((k) => k.keyword)).toEqual(["BEGIN", "COMMIT", "DO", "START"]);
  });
  it("conserve CREATE INDEX CONCURRENTLY comme instruction autonome", () => {
    expect(sqls("CREATE INDEX CONCURRENTLY i ON t (a);\nCREATE INDEX CONCURRENTLY j ON t (b);")).toHaveLength(2);
  });
});
