import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { noopLogger } from "@ecoledigitale/kernel";
import {
  MigrationFileError,
  UnsafeDatabaseError,
  isSafeDatabaseName,
  loadMigrations,
  migrate,
  type MigrationClient,
} from "../src";
import { main, redactUrl } from "../src/cli";

const dirs: string[] = [];
function tmp(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "ed-mig-"));
  dirs.push(dir);
  for (const [name, content] of Object.entries(files)) writeFileSync(join(dir, name), content);
  return dir;
}
afterEach(() => {
  while (dirs.length) rmSync(dirs.pop() as string, { recursive: true, force: true });
});

describe("loadMigrations", () => {
  it("trie numériquement et lit les métadonnées", () => {
    const d = tmp({
      "0100_late.sql": "SELECT 1;",
      "0002_second.sql": "SELECT 2;",
      "0001_first.sql": "-- no-transaction\nSELECT 3;",
      "notes.txt": "ignoré",
    });
    const files = loadMigrations([d]);
    expect(files.map((f) => f.filename)).toEqual(["0001_first.sql", "0002_second.sql", "0100_late.sql"]);
    expect(files[0]).toMatchObject({ version: "0001", name: "first", transactional: false });
    expect(files[1]).toMatchObject({ transactional: true });
    expect(files[0]?.checksum).toMatch(/^[0-9a-f]{64}$/);
  });

  it("fusionne plusieurs dossiers et refuse les doublons de version", () => {
    const a = tmp({ "0001_a.sql": "SELECT 1;" });
    const b = tmp({ "0002_b.sql": "SELECT 2;" });
    expect(loadMigrations([a, b]).map((f) => f.version)).toEqual(["0001", "0002"]);
    const c = tmp({ "0001_autre.sql": "SELECT 3;" });
    expect(() => loadMigrations([a, c])).toThrowError(/en double/);
  });

  it("refuse les noms invalides, les fichiers vides et les dossiers absents", () => {
    expect(() => loadMigrations([tmp({ "1_x.sql": "SELECT 1;" })])).toThrowError(MigrationFileError);
    expect(() => loadMigrations([tmp({ "0001_Maj.sql": "SELECT 1;" })])).toThrowError(/invalide/);
    expect(() => loadMigrations([tmp({ "0001_vide.sql": "  \n" })])).toThrowError(/vide/);
    expect(() => loadMigrations([join(tmpdir(), "ed-dossier-inexistant-xyz")])).toThrowError(/illisible/);
    expect(() => loadMigrations([])).toThrowError(MigrationFileError);
  });

  it("le checksum est stable entre CRLF/LF", () => {
    const lf = loadMigrations([tmp({ "0001_a.sql": "SELECT 1;\nSELECT 2;\n" })])[0]?.checksum;
    const crlf = loadMigrations([tmp({ "0001_a.sql": "﻿SELECT 1;\r\nSELECT 2;\r\n" })])[0]?.checksum;
    expect(crlf).toBe(lf);
  });
});

describe("garde-fou sur le nom de base", () => {
  it.each([
    ["ecole_test", true],
    ["ecole_dev", true],
    ["ecole_local", true],
    ["ecole", false],
    ["ecoledigitale_prod", false],
    ["test_ecole", false],
    ["ecole_testing", false],
  ])("%s → %s", (name, safe) => {
    expect(isSafeDatabaseName(name)).toBe(safe);
  });

  function fakeClient(db: string): { client: MigrationClient; calls: string[] } {
    const calls: string[] = [];
    const client: MigrationClient = {
      async query(text) {
        calls.push(text.trim().split(/\s+/).slice(0, 3).join(" "));
        if (/current_database/.test(text)) return { rows: [{ db }] };
        return { rows: [] };
      },
    };
    return { client, calls };
  }

  it("refuse une base non _test/_dev/_local sans yes, AVANT toute écriture ou verrou", async () => {
    const d = tmp({ "0001_a.sql": "SELECT 1;" });
    const { client, calls } = fakeClient("ecoledigitale");
    await expect(migrate({ client, dirs: [d], logger: noopLogger })).rejects.toBeInstanceOf(UnsafeDatabaseError);
    expect(calls).toEqual(["SELECT current_database() AS"]);
  });

  it("le dry-run ne demande pas yes et n'écrit rien", async () => {
    const d = tmp({ "0001_a.sql": "SELECT 1;" });
    const { client, calls } = fakeClient("ecoledigitale");
    const res = await migrate({ client, dirs: [d], dryRun: true, logger: noopLogger });
    expect(res.pending).toEqual(["0001_a.sql"]);
    expect(calls.some((c) => /CREATE|INSERT|advisory/i.test(c))).toBe(false);
  });

  it("valide les options avant de toucher la base", async () => {
    const d = tmp({ "0001_a.sql": "SELECT 1;" });
    const { client, calls } = fakeClient("x_test");
    await expect(migrate({ client, dirs: [d], table: "a;drop", logger: noopLogger })).rejects.toThrow(/invalide/);
    await expect(migrate({ client, dirs: [d], role: "mig rator", logger: noopLogger })).rejects.toThrow(/invalide/);
    expect(calls).toEqual([]);
  });
});

describe("CLI", () => {
  it("redactUrl masque le mot de passe", () => {
    const out = redactUrl("postgres://user:s3cr3t@localhost:5432/db_test");
    expect(out).not.toContain("s3cr3t");
    expect(out).toContain("***");
    expect(redactUrl("pas une url")).toBe("<url illisible>");
  });

  it("sans URL → code 2 ; option inconnue → code 2 ; --help → 0", async () => {
    const err = console.error;
    const log = console.log;
    console.error = () => undefined;
    console.log = () => undefined;
    try {
      expect(await main([], {})).toBe(2);
      expect(await main(["--bogus"], { DATABASE_URL: "postgres://x/y" })).toBe(2);
      expect(await main(["--", "--help"], {})).toBe(0);
      expect(await main(["--lock-timeout", "abc", "--url", "postgres://x/y"], {})).toBe(2);
    } finally {
      console.error = err;
      console.log = log;
    }
  });

  it("tolère le « -- » inséré par pnpm", async () => {
    const log = console.log;
    const lines: string[] = [];
    console.log = (m: string) => void lines.push(String(m));
    try {
      expect(await main(["--", "--help"], {})).toBe(0);
    } finally {
      console.log = log;
    }
    expect(lines.join("\n")).toMatch(/Usage/);
  });
});
