import fs from "node:fs";
import path from "node:path";
import { createTranslator } from "next-intl";
import { describe, expect, it } from "vitest";
import catalog from "../../../../messages/fr-CI.json";
import {
  PRIMARY_ARCHIVE_STATUSES,
  PRIMARY_ASSESSMENT_STATUSES,
  PRIMARY_CASE_STATUSES,
  PRIMARY_COUNCIL_ROLES,
  PRIMARY_ERROR_CODES,
  PRIMARY_FRAMEWORK_STATUSES,
  PRIMARY_PHRASE_SCOPES,
  PRIMARY_REASON_CODES,
  PRIMARY_REPORT_KEYS,
  PRIMARY_REVIEW_STATUSES,
  PRIMARY_RULE_PROPOSALS,
  PRIMARY_SOURCE_KINDS,
} from "@ecoledigitale/contracts/v2/primary_school";
import { lightOf } from "./_components/direction-model";

/**
 * Filet de sécurité i18n du pack Primary : toute clé statique passée à `t("…")` existe dans `messages/fr-CI.json`, les libellés de
 * TOUS les statuts et codes des contrats sont traduits, aucune valeur n'est vide et chaque message est un ICU valide.
 */
const ROOT = path.resolve(__dirname, "../../..");
const SOURCES = [path.join(ROOT, "app/v2/primary"), path.join(ROOT, "platform/v2/primary.ts")];

function walk(target: string): string[] {
  if (!fs.existsSync(target)) return [];
  if (fs.statSync(target).isFile()) return [target];
  return fs.readdirSync(target, { withFileTypes: true }).flatMap((e) => {
    const full = path.join(target, e.name);
    if (e.isDirectory()) return walk(full);
    return /\.(tsx|ts)$/.test(e.name) && !/\.test\./.test(e.name) ? [full] : [];
  });
}

function lookup(ns: string, key: string): unknown {
  return `${ns}.${key}`.split(".").reduce<unknown>((acc, part) => (acc && typeof acc === "object" ? (acc as Record<string, unknown>)[part] : undefined), catalog);
}

const NAMESPACES = Object.keys(catalog).filter((k) => k.startsWith("v2Primary"));

describe("messages fr-CI du pack Primary", () => {
  it("les espaces de noms attendus existent", () => {
    for (const ns of ["v2PrimaryNav", "v2PrimaryCommon", "v2PrimaryClass", "v2PrimaryCompetencies", "v2PrimaryAppreciations", "v2PrimaryCouncil", "v2PrimaryDirection", "v2PrimaryReviews", "v2PrimaryArchives", "v2PrimaryReports", "v2PrimarySettings", "v2PrimaryParent"]) {
      expect(NAMESPACES).toContain(ns);
    }
  });

  it("toutes les clés statiques utilisées par les écrans existent", () => {
    const missing: string[] = [];
    let checked = 0;
    for (const file of SOURCES.flatMap(walk)) {
      const source = fs.readFileSync(file, "utf8");
      const decls = [...source.matchAll(/const (\w+) = useTranslations\("([^"]+)"\)/g)].map((m) => ({ name: m[1]!, ns: m[2]!, start: m.index! }));
      decls.forEach((d, i) => {
        const next = decls.slice(i + 1).find((x) => x.name === d.name);
        const region = source.slice(d.start, next ? next.start : source.length);
        for (const m of region.matchAll(new RegExp(String.raw`(?<![\w.])${d.name}\(\s*"([^"]+)"`, "g"))) {
          checked += 1;
          if (typeof lookup(d.ns, m[1]!) !== "string") missing.push(`${path.relative(ROOT, file)} -> ${d.ns}.${m[1]}`);
        }
      });
    }
    expect(checked).toBeGreaterThan(300);
    expect(missing).toEqual([]);
  });

  it("les libellés de tous les statuts et codes des contrats sont traduits", () => {
    const row = (ns: string, codes: readonly string[]): Array<[string, readonly string[]]> => [[ns, codes]];
    const expectations: Array<[string, readonly string[]]> = [
      ...row("v2PrimaryCommon.reviewStatus", PRIMARY_REVIEW_STATUSES),
      ...row("v2PrimaryCommon.archiveStatus", PRIMARY_ARCHIVE_STATUSES),
      ...row("v2PrimaryCommon.caseStatus", PRIMARY_CASE_STATUSES),
      ...row("v2PrimaryCommon.councilRole", PRIMARY_COUNCIL_ROLES),
      ...row("v2PrimaryCommon.reasonCode", PRIMARY_REASON_CODES),
      ...row("v2PrimaryCommon.ruleProposal", PRIMARY_RULE_PROPOSALS),
      ...row("v2PrimaryCommon.outcomeCode", PRIMARY_RULE_PROPOSALS),
      ...row("v2PrimaryCommon.phraseScope", PRIMARY_PHRASE_SCOPES),
      ...row("v2PrimaryCommon.sourceKind", PRIMARY_SOURCE_KINDS),
      ...row("v2PrimaryCommon.reportKey", PRIMARY_REPORT_KEYS),
      ...row("v2PrimaryCommon.assessmentStatus", PRIMARY_ASSESSMENT_STATUSES),
      ...row("v2PrimaryCommon.frameworkStatus", PRIMARY_FRAMEWORK_STATUSES),
      // Codes d'erreur : piste d'action pour chaque code stable du contrat (préfixe retiré : les clés n'ont pas de point).
      ...row(
        "v2PrimaryCommon.errorHints",
        [...PRIMARY_ERROR_CODES, "primary_school.row_version_conflict", "primary_school.minutes_not_ready"].map((c) => c.replace("primary_school.", "")),
      ),
      ...row("v2PrimaryDirection.light", ["nothing_entered", "in_progress", "complete", "no_expectation"]),
      ...row("v2PrimaryReports.result.param", ["classroomId", "periodId", "yearId", "month", "deliberationId"]),
    ];
    const missing = expectations.flatMap(([ns, codes]) => codes.filter((c) => typeof lookup(ns, c) !== "string").map((c) => `${ns}.${c}`));
    expect(missing).toEqual([]);
  });

  it("chaque motif de feu produit par le modèle d'avancement a son libellé", () => {
    const reasons = new Set([lightOf({ competencies: { expected: 0, recorded: 0, validated: 0 }, reviews: { total: 0, sealed: 0 } }).reason, lightOf({ competencies: { expected: 4, recorded: 0, validated: 0 }, reviews: { total: 0, sealed: 0 } }).reason, lightOf({ competencies: { expected: 4, recorded: 2, validated: 0 }, reviews: { total: 0, sealed: 0 } }).reason, lightOf({ competencies: { expected: 4, recorded: 4, validated: 4 }, reviews: { total: 0, sealed: 0 } }).reason]);
    for (const r of reasons) expect(typeof lookup("v2PrimaryDirection.light", r)).toBe("string");
  });

  it("aucun libellé du pack n'est vide", () => {
    const empty: string[] = [];
    const walkObj = (o: unknown, trail: string) => {
      if (typeof o === "string") return void (o.trim() === "" && empty.push(trail));
      if (o && typeof o === "object") for (const [k, v] of Object.entries(o)) walkObj(v, `${trail}.${k}`);
    };
    for (const ns of NAMESPACES) walkObj((catalog as Record<string, unknown>)[ns], ns);
    expect(empty).toEqual([]);
  });

  it("chaque message est un ICU valide (formaté avec des valeurs d'essai)", () => {
    const errors: string[] = [];
    const messages = catalog as unknown as Record<string, unknown>;
    const translator = createTranslator({ locale: "fr-CI", messages: messages as never });
    const visit = (o: unknown, trail: string[]) => {
      if (typeof o === "string") {
        const values: Record<string, number> = {};
        for (const m of o.matchAll(/\{\s*(\w+)\s*[,}]/g)) values[m[1]!] = 2;
        try {
          (translator as unknown as (key: string, v: Record<string, number>) => string)(trail.join("."), values);
        } catch (e) {
          errors.push(`${trail.join(".")} : ${(e as Error).message}`);
        }
        return;
      }
      if (o && typeof o === "object") for (const [k, v] of Object.entries(o)) visit(v, [...trail, k]);
    };
    for (const ns of NAMESPACES) visit(messages[ns], [ns]);
    expect(errors).toEqual([]);
  });
});
