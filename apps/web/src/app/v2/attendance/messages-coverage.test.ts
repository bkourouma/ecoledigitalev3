import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import catalog from "../../../../messages/fr-CI.json";
import { ATTENDANCE_SESSION_STATUSES } from "@ecoledigitale/contracts/v2/attendance";

/**
 * Filet de sécurité i18n des présences et de l'emploi du temps : toute clé statique passée à `t("…")` existe dans
 * `messages/fr-CI.json`, et chaque valeur d'énumération affichée a sa traduction (les clés calculées ne sont pas
 * vues par l'analyse statique, d'où les listes ci-dessous).
 */
const ROOT = path.resolve(__dirname, "../../..");
const SOURCES = ["app/v2/attendance", "app/v2/schedule", "platform/offline"].map((p) => path.join(ROOT, p));

function walk(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) return walk(full);
    return /\.(tsx|ts)$/.test(e.name) && !/\.test\./.test(e.name) && !full.includes("_test") ? [full] : [];
  });
}

function lookup(ns: string, key: string): unknown {
  return `${ns}.${key}`.split(".").reduce<unknown>((acc, part) => (acc && typeof acc === "object" ? (acc as Record<string, unknown>)[part] : undefined), catalog);
}

describe("messages fr-CI : présences et emploi du temps", () => {
  it("toutes les clés statiques existent", () => {
    const missing: string[] = [];
    for (const file of SOURCES.flatMap(walk)) {
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

  it("les libellés d'énumération sont tous traduits", () => {
    const expectations: Array<[string, readonly string[]]> = [
      ["v2Attendance.status", ["PRESENT", "ABSENT", "LATE", "EXCUSED", "EARLY_LEAVE", "ON_LEAVE"]],
      ["v2Attendance.call.session", ATTENDANCE_SESSION_STATUSES],
      ["v2Attendance.callList.outbox.state", ["PENDING", "SYNCING", "DONE", "ATTENTION"]],
      ["v2Attendance.outcome.codes", ["attendance_unmarked_students", "attendance_occurrence_cancelled", "attendance_forbidden", "attendance_session_locked", "local_invalid_batch"]],
    ];
    const missing: string[] = [];
    for (const [ns, values] of expectations) {
      for (const v of values) if (typeof lookup(ns, v) !== "string") missing.push(`${ns}.${v}`);
    }
    expect(missing).toEqual([]);
  });
});
