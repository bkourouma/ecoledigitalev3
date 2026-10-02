import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import catalog from "../../../../messages/fr-CI.json";
import { SCHEDULING_OCCURRENCE_KINDS, SCHEDULING_OCCURRENCE_STATUSES, SCHEDULING_STAFF_ROLES } from "@ecoledigitale/contracts/v2/scheduling";
import { ATTENDANCE_ALERT_METRICS, ATTENDANCE_JUSTIFICATION_STATUSES, ATTENDANCE_LEAVE_STATUSES, ATTENDANCE_SESSION_STATUSES, ATTENDANCE_SUBMITTER_KINDS, ATTENDANCE_SYNC_CONFLICT_KINDS } from "@ecoledigitale/contracts/v2/attendance";

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
      ["v2Attendance.sessions.status", ATTENDANCE_SESSION_STATUSES],
      ["v2Attendance.sessions.scope", ["DAILY", "SESSION"]],
      ["v2Attendance.justifications.status", ATTENDANCE_JUSTIFICATION_STATUSES],
      ["v2Attendance.justifications.submitter", ATTENDANCE_SUBMITTER_KINDS],
      ["v2Attendance.staff.leaveStatus", ATTENDANCE_LEAVE_STATUSES],
      ["v2Attendance.alerts.metrics", ATTENDANCE_ALERT_METRICS],
      ["v2Attendance.conflicts.kind", ATTENDANCE_SYNC_CONFLICT_KINDS],
      ["v2Attendance.conflicts.kindHint", ATTENDANCE_SYNC_CONFLICT_KINDS],
      ["v2Attendance.conflicts.resolution", ["ACCEPT_INCOMING", "KEEP_EXISTING"]],
      ["v2Attendance.reasonFallback", ["ILLNESS", "FAMILY_EVENT", "TRANSPORT", "OFFICIAL_ACTIVITY", "OTHER"]],
      ["v2Attendance.leaveFallback", ["ANNUAL", "SICK", "MATERNITY", "UNPAID", "AUTHORIZED_ABSENCE"]],
      ["v2Schedule.kind", SCHEDULING_OCCURRENCE_KINDS],
      ["v2Schedule.status", SCHEDULING_OCCURRENCE_STATUSES],
      ["v2Schedule.staffRole", SCHEDULING_STAFF_ROLES],
      ["v2Schedule.delivery", ["IN_PERSON", "ONLINE", "HYBRID"]],
      ["v2Schedule.resourceStatus", ["AVAILABLE", "OUT_OF_SERVICE", "ARCHIVED"]],
      ["v2Schedule.weekdayLong", ["1", "2", "3", "4", "5", "6", "7"]],
      ["v2Schedule.weekdayShort", ["1", "2", "3", "4", "5", "6", "7"]],
      ["v2Schedule.timetables.status", ["DRAFT", "PUBLISHED", "ARCHIVED"]],
      ["v2Schedule.editor.status", ["DRAFT", "PUBLISHED", "ARCHIVED"]],
      ["v2Schedule.editor.pattern", ["EVERY", "WEEK_A", "WEEK_B"]],
      ["v2Schedule.entry.patterns", ["EVERY", "WEEK_A", "WEEK_B"]],
      ["v2Schedule.entry.deliveryModes", ["IN_PERSON", "ONLINE", "HYBRID"]],
      ["v2Schedule.entry.propagation", ["NONE", "FUTURE_PLANNED"]],
      ["v2Schedule.rooms.setStatus", ["AVAILABLE", "OUT_OF_SERVICE", "ARCHIVED"]],
      ["v2Schedule.export.sources", ["mine", "children", "classroom", "staff", "student", "room"]],
      ["v2Schedule.viewer.modes", ["mine", "children", "classroom", "staff", "student", "room"]],
      ["v2Schedule.conflicts.resource", ["STAFF", "CLASSROOM", "ROOM", "EQUIPMENT"]],
      ["v2Attendance.outcome.codes", ["attendance_unmarked_students", "attendance_occurrence_cancelled", "attendance_forbidden", "attendance_session_locked", "local_invalid_batch"]],
    ];
    const missing: string[] = [];
    for (const [ns, values] of expectations) {
      for (const v of values) if (typeof lookup(ns, v) !== "string") missing.push(`${ns}.${v}`);
    }
    expect(missing).toEqual([]);
  });
});
