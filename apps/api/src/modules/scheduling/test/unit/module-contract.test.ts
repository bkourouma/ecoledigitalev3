/**
 * Contrat du module (conventions de modules, spec 017 §7 « garde-fous CI ») :
 * manifeste, plage de migrations, contrat de plugin, absence de constantes de fuseau, accès réservé à la paie.
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { resolveModuleOrder } from "@ecoledigitale/kernel";
import manifest from "../../manifest";
import { ALL_SCHEDULING_EVENT_TYPES, CONSUMED_EVENT_TYPES, SchedulingEvents } from "../../domain/events";
import * as publicApi from "../../index";
import plugin, { schedulingPlugin } from "../../http/plugin";
import jobs from "../../jobs";
import subscribers from "../../subscribers";

const here = dirname(fileURLToPath(import.meta.url));
const moduleDir = resolve(here, "../..");
const modulesDir = resolve(moduleDir, "..");

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules") continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

const sources = walk(moduleDir).filter((f) => f.endsWith(".ts") && !f.includes(`${join("scheduling", "test")}`));

describe("manifeste", () => {
  it("clé, packs, dépendance rbac, permissions de la spec (dont 3 sensibles), features", () => {
    expect(manifest.key).toBe("scheduling");
    expect(manifest.dependsOn).toEqual(["rbac"]);
    expect(manifest.packs).toEqual(["PRIMARY", "SECONDARY", "HIGHER", "VIRTUAL"]);
    const keys = manifest.permissions.map((p) => p.key);
    expect(keys).toEqual(
      expect.arrayContaining([
        "schedule.read",
        "schedule.manage",
        "schedule.publish",
        "schedule.room.manage",
        "schedule.room.book",
        "schedule.calendar.manage",
        "schedule.occurrence.hold",
        "schedule.occurrence.declare",
        "schedule.occurrence.validate",
        "schedule.accounting.create",
        "schedule.conflict.override",
        "schedule.hours.lock",
        "schedule.self.read",
        "schedule.child.read",
        "schedule.own.read",
      ]),
    );
    expect(manifest.permissions.filter((p) => p.sensitive).map((p) => p.key).sort()).toEqual(["schedule.conflict.override", "schedule.hours.lock", "schedule.occurrence.validate"]);
    expect(manifest.features.map((f) => f.key).sort()).toEqual(["scheduling.equipment", "scheduling.generation", "scheduling.payroll-hours"]);
  });

  it("publie exactement les événements du module et consomme ceux de la spec", () => {
    expect([...manifest.events.publishes].sort()).toEqual([...ALL_SCHEDULING_EVENT_TYPES].sort());
    expect(manifest.events.publishes.every((t) => /^scheduling\.[a-z_]+\.[a-z_]+$/.test(t))).toBe(true);
    expect([...manifest.events.consumes].sort()).toEqual([...CONSUMED_EVENT_TYPES].sort());
    for (const required of [
      SchedulingEvents.occurrenceCreated,
      SchedulingEvents.occurrenceRescheduled,
      SchedulingEvents.occurrenceRoomChanged,
      SchedulingEvents.occurrenceStaffChanged,
      SchedulingEvents.occurrenceHeld,
      SchedulingEvents.occurrenceUnheld,
      SchedulingEvents.occurrenceCancelled,
      SchedulingEvents.occurrenceValidated,
      SchedulingEvents.occurrenceUnvalidated,
      SchedulingEvents.occurrenceReplacementNeeded,
      SchedulingEvents.conflictOverridden,
      SchedulingEvents.timetablePublished,
      SchedulingEvents.timetableArchived,
      SchedulingEvents.calendarEventCreated,
      SchedulingEvents.calendarEventUpdated,
      SchedulingEvents.calendarEventDeleted,
    ]) {
      expect(manifest.events.publishes).toContain(required);
    }
  });

  it("est cohérent avec le registre (ordre topologique avec rbac, pas de doublon)", () => {
    const rbac = { key: "rbac", title: "rbac", packs: ["CORE"] as const, dependsOn: [], permissions: [], features: [], menus: [], events: { publishes: [], consumes: [] } };
    const order = resolveModuleOrder([manifest, rbac as never]);
    expect(order.map((m) => m.key)).toEqual(["rbac", "scheduling"]);
  });
});

describe("migrations : plage 0950-0999 réservée au module", () => {
  const files = readdirSync(join(moduleDir, "migrations")).filter((f) => f.endsWith(".sql")).sort();
  it("tous les fichiers sont dans la plage, numérotés sans trou, en minuscules", () => {
    expect(files.length).toBeGreaterThanOrEqual(4);
    for (const f of files) {
      const m = /^(\d{4})_[a-z0-9_]+\.sql$/.exec(f);
      expect(m, f).not.toBeNull();
      const n = Number(m?.[1]);
      expect(n).toBeGreaterThanOrEqual(950);
      expect(n).toBeLessThanOrEqual(999);
    }
    const numbers = files.map((f) => Number(f.slice(0, 4)));
    expect(numbers).toEqual(numbers.map((_, i) => 950 + i));
  });

  it("chaque table du module est dans le schéma `scheduling` avec tenant_id + RLS, et la liste d'isolation est complète", () => {
    const sql = files.map((f) => readFileSync(join(moduleDir, "migrations", f), "utf8")).join("\n");
    const created = [...sql.matchAll(/CREATE TABLE (scheduling\.[a-z_]+)/g)].map((m) => m[1] as string).sort();
    const rls = [...sql.matchAll(/kernel\.enable_tenant_rls\('(scheduling\.[a-z_]+)'\)/g)].map((m) => m[1] as string).sort();
    expect(created).toEqual(rls);
    expect(created).toHaveLength(19);
    const allowlist = readFileSync(join(modulesDir, "isolation-allowlist.scheduling.ts"), "utf8");
    for (const t of created) expect(allowlist, t).toContain(`"${t}"`);
    expect(sql).not.toMatch(/CREATE TABLE (?!scheduling\.)/);
  });
});

describe("contrat de plugin `(app, runtime)`", () => {
  it("l'export par défaut de http/plugin.ts est une fonction à deux paramètres", () => {
    expect(typeof plugin).toBe("function");
    expect(plugin.length).toBe(2);
    expect(typeof schedulingPlugin).toBe("function");
  });

  it("le module expose abonnés et jobs découvrables par le worker, aux noms uniques", () => {
    const names = [...subscribers.map((s) => s.name), ...jobs.map((j) => j.name)];
    expect(new Set(names).size).toBe(names.length);
    expect(subscribers.map((s) => s.pattern).sort()).toEqual([...CONSUMED_EVENT_TYPES].sort());
    expect(jobs.map((j) => j.name)).toEqual(["scheduling.generate-occurrences"]);
  });

  it("l'index public expose les interfaces consommées par 010 et 032", () => {
    for (const fn of [
      "listPayableHours",
      "lockHours",
      "releaseHoursLock",
      "getOccurrence",
      "listOccurrences",
      "listOccurrencesForStaff",
      "listOccurrencesForClassroom",
      "listOccurrencesForRoom",
      "listOccurrencesForStudent",
      "holdOccurrence",
      "unholdOccurrence",
      "cancelOccurrence",
      "restoreOccurrence",
      "rescheduleOccurrence",
      "changeOccurrenceRoom",
      "setOccurrenceStaff",
      "substituteStaff",
      "setPaidMinutes",
      "validateOccurrence",
      "validateOccurrencesBatch",
      "unvalidateOccurrence",
      "createAccountingOccurrence",
      "overrideConflict",
      "createOccurrence",
      "createTimetable",
      "cloneTimetable",
      "upsertTimetableEntry",
      "endTimetableEntry",
      "removeTimetableEntry",
      "publishTimetable",
      "archiveTimetable",
      "generateOccurrences",
      "previewConflicts",
      "suggestSlots",
      "suggestSubstitutes",
      "findValidatedOverlaps",
      "listPendingValidation",
      "listPendingReplacements",
      "listUnrealizedOccurrences",
      "getRoomOccupancy",
      "getStaffWeeklyLoad",
      "exportTimetableIcs",
      "createRoom",
      "updateRoom",
      "setRoomStatus",
      "createEquipmentItem",
      "updateEquipmentItem",
      "upsertTimeSlot",
      "deactivateTimeSlot",
      "createCalendarEvent",
      "updateCalendarEvent",
      "deleteCalendarEvent",
      "upsertConflictPolicy",
      "updateSchedulingSettings",
      "createScheduleConflictChecker",
      "registerSchedulingPorts",
    ]) {
      expect(typeof (publicApi as Record<string, unknown>)[fn], fn).toBe("function");
    }
  });
});

describe("garde-fous (spec 017 §7)", () => {
  it("aucun fuseau ni créneau codé en dur dans le module (le fuseau vient de l'établissement)", () => {
    const offenders: string[] = [];
    for (const f of sources) {
      const text = readFileSync(f, "utf8");
      if (/Europe\/Paris|America\/|Asia\//.test(text)) offenders.push(relative(moduleDir, f));
    }
    expect(offenders).toEqual([]);
    // « Africa/Abidjan » n'apparaît que comme VALEUR PAR DÉFAUT des paramètres (migration) ou via la constante du kernel.
    const hardcoded = sources.filter((f) => /["']Africa\/Abidjan["']/.test(readFileSync(f, "utf8"))).map((f) => relative(moduleDir, f));
    expect(hardcoded).toEqual([]);
  });

  it("aucune requête SQL n'est construite à partir de clés de l'entrée (colonnes fixes uniquement)", () => {
    // Dans un gabarit SQL, `${…}` n'est admis que pour des listes de colonnes CONSTANTES, des clauses assemblées
    // à partir de morceaux fixes, des numéros de paramètre ($n) ou un suffixe `FOR UPDATE` : jamais une valeur
    // ni un nom de colonne venant d'une entrée (le legacy construisait du SQL depuis le corps de PUT /classrooms).
    const SAFE = [
      /^[A-Z][A-Z_]+$/, // OCC_COLUMNS, ROOM_COLUMNS…
      /^(where|order|n)$/,
      /^(sets|clauses|values)\.join\(/,
      /^INSERT_COLUMNS\.join\(/,
      /^placeholders\(/,
      /^p\(/, // pousse la valeur dans les paramètres et renvoie `$n`
      /^params\.length/,
      /^(options\.)?(forUpdate|includeEnded) \?/,
      /^(cls|off)$/,
    ];
    const offenders: string[] = [];
    const sqlFiles = sources.filter((s) => s.includes(join("scheduling", "infrastructure")) || s.includes(join("scheduling", "application")));
    for (const f of sqlFiles) {
      const text = readFileSync(f, "utf8");
      for (const m of text.matchAll(/`([^`]*)`/g)) {
        const body = m[1] as string;
        if (!/\b(SELECT|INSERT|UPDATE|DELETE)\b/.test(body)) continue;
        for (const e of body.matchAll(/\$\{([^}]+)\}/g)) {
          const expr = (e[1] as string).trim();
          if (!SAFE.some((re) => re.test(expr))) offenders.push(`${relative(moduleDir, f)} : \${${expr}}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it("seule la paie (module payroll) peut appeler lockHours / releaseHoursLock", () => {
    const offenders: string[] = [];
    for (const dir of readdirSync(modulesDir)) {
      if (dir === "scheduling" || dir === "payroll") continue;
      const full = join(modulesDir, dir);
      if (!existsSync(full) || !statSync(full).isDirectory()) continue;
      for (const f of walk(full).filter((p) => p.endsWith(".ts"))) {
        if (/\b(lockHours|releaseHoursLock)\b/.test(readFileSync(f, "utf8"))) offenders.push(relative(modulesDir, f));
      }
    }
    expect(offenders).toEqual([]);
  });

  it("aucun contrôle de rôle codé en dur : les routes passent par requirePermission", () => {
    const text = readFileSync(join(moduleDir, "http", "plugin.ts"), "utf8");
    expect(text).not.toMatch(/ctx\.roles|\.roles\.includes|activeRole/);
    // toute route déclare un preHandler de permission, sauf l'unique route publique d'abonnement par jeton
    const routes = [...text.matchAll(/scope\.(get|post|put|patch|delete)\(\s*"([^"]+)",\s*\{([^}]*)\}/g)];
    expect(routes.length).toBeGreaterThan(60);
    const unguarded = routes.filter((r) => !/preHandler/.test(r[3] as string)).map((r) => `${r[1]} ${r[2]}`);
    expect(unguarded).toEqual(["get /export/timetable.ics"]);
  });
});
