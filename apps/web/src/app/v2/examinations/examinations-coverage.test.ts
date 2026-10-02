import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import catalog from "../../../../messages/fr-CI.json";
import {
  EXAM_BATCH_KINDS,
  EXAM_COUNT_GROUPS,
  EXAM_DOCUMENT_KINDS,
  EXAM_ELIGIBILITY_STATUSES,
  EXAM_OUTCOMES,
  EXAM_PIECE_STATUSES,
  EXAM_REGISTRATION_STATUSES,
  EXAM_RESULT_CODES,
  EXAM_SCORE_STATUSES,
  EXAM_SESSION_KINDS,
  EXAM_SESSION_STATUSES,
  EXAM_SOURCE_KINDS,
} from "@ecoledigitale/contracts/v2/examinations";

/**
 * Filet de sécurité i18n des écrans d'examens : toute clé statique passée à `t("…")` existe dans `messages/fr-CI.json`, et les
 * libellés CALCULÉS (`t(\`x.${valeur}\`)`) couvrent chaque valeur des énumérations du contrat.
 */
const ROOT = __dirname;

function walk(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) return walk(full);
    return /\.(tsx|ts)$/.test(e.name) && !/\.test\./.test(e.name) ? [full] : [];
  });
}

function lookup(ns: string, key: string): unknown {
  return `${ns}.${key}`.split(".").reduce<unknown>((acc, part) => (acc && typeof acc === "object" ? (acc as Record<string, unknown>)[part] : undefined), catalog);
}

describe("messages fr-CI des écrans d'examens", () => {
  it("toutes les clés statiques existent", () => {
    const missing: string[] = [];
    for (const file of walk(ROOT)) {
      const source = fs.readFileSync(file, "utf8");
      const decls = [...source.matchAll(/const (\w+) = useTranslations\("([^"]+)"\)/g)].map((m) => ({ name: m[1]!, ns: m[2]!, start: m.index! }));
      decls.forEach((d, i) => {
        const next = decls.slice(i + 1).find((x) => x.name === d.name);
        const region = source.slice(d.start, next ? next.start : source.length);
        for (const m of region.matchAll(new RegExp(String.raw`(?<![\w.])${d.name}\(\s*"([^"]+)"`, "g"))) {
          if (typeof lookup(d.ns, m[1]!) !== "string") missing.push(`${path.relative(ROOT, file)} -> ${d.ns}.${m[1]}`);
        }
      });
    }
    expect(missing).toEqual([]);
  });

  it("chaque valeur d'énumération du contrat a son libellé", () => {
    const expectations: Array<[string, readonly string[]]> = [
      ["v2Examinations.enums.sessionStatus", EXAM_SESSION_STATUSES],
      ["v2Examinations.enums.sessionKind", EXAM_SESSION_KINDS],
      ["v2Examinations.enums.registration", EXAM_REGISTRATION_STATUSES],
      ["v2Examinations.enums.eligibility", EXAM_ELIGIBILITY_STATUSES],
      ["v2Examinations.enums.outcome", EXAM_OUTCOMES],
      ["v2Examinations.enums.resultCode", EXAM_RESULT_CODES],
      ["v2Examinations.enums.scoreStatus", EXAM_SCORE_STATUSES],
      ["v2Examinations.enums.docKind", EXAM_DOCUMENT_KINDS],
      ["v2Examinations.enums.batchKind", EXAM_BATCH_KINDS],
      ["v2Examinations.enums.batchStatus", ["UPLOADED", "VALIDATED", "APPLIED", "REJECTED"]],
      ["v2Examinations.enums.piece", EXAM_PIECE_STATUSES],
      ["v2Examinations.enums.source", [...EXAM_SOURCE_KINDS, "score_MANUAL", "score_IMPORT", "score_ASSESS", "result_IMPORTED", "result_ENTERED", "result_COMPUTED"]],
      ["v2Examinations.enums.countGroup", EXAM_COUNT_GROUPS],
      ["v2Examinations.enums.revisionStatus", ["PENDING", "APPROVED", "REJECTED"]],
      ["v2Examinations.enums.docStatus", ["REQUESTED", "ISSUED", "REVOKED"]],
      ["v2Examinations.types.status", ["ACTIVE", "ARCHIVED"]],
      ["v2Examinations.exports.runs.status", ["RUNNING", "DONE", "FAILED"]],
      ["v2Examinations.statistics.sex", ["F", "M"]],
      ["v2Examinations.sessionDetail.counts", ["label", "candidates", "registered", "withdrawn", "eligible", "assigned", "withResult", "published"]],
      ["v2Examinations.sessionDetail.date", ["registrationOpensOn", "registrationClosesOn", "startsOn", "endsOn"]],
      ["v2Examinations.sessionDetail.links", ["candidates", "assignments", "results", "imports", "mock", "statistics", "corrections", "exports"]],
      ["v2Examinations.assignments.summaryItem", ["registered", "unassigned", "capacity", "assigned"]],
      ["v2Examinations.results.tabs", ["results", "scores"]],
      ["v2Examinations.corrections.field", ["resultCode", "average", "status", "score"]],
      ["v2Examinations.candidateDetail.identity", ["lastName", "firstName", "birthDate", "birthPlace", "sex", "track", "gradeLevel", "officialNumber"]],
    ];
    const missing = expectations.flatMap(([ns, values]) => values.filter((v) => typeof lookup(ns, v) !== "string").map((v) => `${ns}.${v}`));
    expect(missing).toEqual([]);
  });

  it("les motifs d'erreur d'import connus de l'API sont traduits", () => {
    const codes = ["FILE_EMPTY", "FILE_TOO_LARGE", "FILE_UNREADABLE", "KEY_MISSING", "KEY_DUPLICATE", "COLUMN_COUNT", "RESULT_CODE_UNKNOWN", "RESULT_CODE_MISSING", "AVERAGE_INVALID", "TOTAL_INVALID", "RANK_INVALID", "MENTION_INVALID", "SCORE_INVALID", "SCORE_STATUS_UNKNOWN", "OFFICIAL_NUMBER_INVALID", "VALUE_WITHOUT_RESULT_FORBIDDEN", "CANDIDATE_UNKNOWN", "CANDIDATE_NOT_REGISTERED", "PAPER_UNKNOWN", "PAPER_NOT_FOR_TRACK", "SCORE_ABOVE_SCALE", "RESULT_ALREADY_PUBLISHED", "OFFICIAL_NUMBER_TAKEN"];
    expect(codes.filter((c) => typeof lookup("v2Examinations.enums.importError", c) !== "string")).toEqual([]);
  });

  it("aucun écran ne code une règle d'examen (seuil, coefficient, taux)", () => {
    const offenders: string[] = [];
    for (const file of walk(ROOT)) {
      const source = fs.readFileSync(file, "utf8");
      // Le web n'affiche que ce que l'API décide : pas de comparaison à un seuil, pas de calcul de moyenne ni de taux.
      if (/>=\s*10\b|\bthreshold\b|seuil\s*=|reduce\(\s*\([^)]*\)\s*=>\s*[^,]*\*\s*[^,]*coefficient/i.test(source)) offenders.push(path.relative(ROOT, file));
    }
    expect(offenders).toEqual([]);
  });
});
