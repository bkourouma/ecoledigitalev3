/**
 * Unitaires purs (sans base) : règle de visibilité (miroir), machines à états en parité avec le SQL, barème, types
 * d'événements, traduction des refus de la base, manifeste, contrats, garde-fou « aucune règle réglementaire en code ».
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { PERMISSION_KEY_RE, ValidationError } from "@ecoledigitale/kernel";
import * as C from "@ecoledigitale/contracts/src/v2/schoollife";
import * as contractsIndex from "@ecoledigitale/contracts/src/v2";
import manifest from "../../manifest";
import { ALL_EVENT_TYPES, SchoolLifeEvents } from "../../domain/events";
import { audienceMaySee, clearanceOf, confidentialityRank, staffAudience } from "../../domain/confidentiality";
import { canTransition, CONVOCATION_TRANSITIONS, EFFECT_TRANSITIONS, INCIDENT_TRANSITIONS, MEASURE_TRANSITIONS, SCALE_TRANSITIONS, type Transition } from "../../domain/machines";
import { conductBalance, narrowestPeriod, pickScale, type ScaleFacts } from "../../domain/conduct";
import { validateTypeFlags } from "../../domain/event-type";
import { translateViolation } from "../../domain/errors";
import { unavailablePorts } from "../../infrastructure/in-memory-ports";
import { PERMISSIONS } from "../../http/guards";

const here = dirname(fileURLToPath(import.meta.url));
const moduleDir = resolve(here, "../..");
const read = (rel: string): string => readFileSync(join(moduleDir, rel), "utf8");

describe("règle de visibilité : miroir pur de `schoollife.audience_may_see`", () => {
  const may = (audience: string, kind: string, confidentiality: string, shareable: boolean, status: string, noteVisibility: string | null = null) =>
    audienceMaySee({ audience, kind, confidentiality, shareable, status, noteVisibility });

  it("table de vérité des familles (les 19 cas de la spec)", () => {
    expect(may("GUARDIAN", "MEASURE", "STANDARD", true, "PROPOSED")).toBe(false);
    expect(may("GUARDIAN", "MEASURE", "STANDARD", true, "VALIDATED")).toBe(false);
    expect(may("GUARDIAN", "MEASURE", "STANDARD", true, "NOTIFIED")).toBe(true);
    expect(may("GUARDIAN", "MEASURE", "STANDARD", true, "EXECUTED")).toBe(true);
    expect(may("GUARDIAN", "MEASURE", "RESTRICTED", true, "NOTIFIED")).toBe(true);
    expect(may("GUARDIAN", "MEASURE", "CONFIDENTIAL", true, "NOTIFIED")).toBe(false);
    expect(may("GUARDIAN", "MEASURE", "STANDARD", false, "NOTIFIED")).toBe(false);
    expect(may("GUARDIAN", "MEASURE", "STANDARD", true, "REVOKED")).toBe(false);
    expect(may("STUDENT", "MEASURE", "STANDARD", true, "NOTIFIED")).toBe(true);
    expect(may("GUARDIAN", "INCIDENT", "STANDARD", true, "CONFIRMED")).toBe(false);
    expect(may("GUARDIAN", "NOTE", "STANDARD", true, "ACTIVE", "STAFF_ONLY")).toBe(false);
    expect(may("GUARDIAN", "NOTE", "STANDARD", true, "ACTIVE", "GUARDIANS")).toBe(true);
    expect(may("STUDENT", "NOTE", "STANDARD", true, "ACTIVE", "GUARDIANS")).toBe(false);
    expect(may("STUDENT", "NOTE", "STANDARD", true, "ACTIVE", "STUDENT_AND_GUARDIANS")).toBe(true);
    expect(may("GUARDIAN", "NOTE", "STANDARD", true, "WITHDRAWN", "GUARDIANS")).toBe(false);
    expect(may("GUARDIAN", "CONVOCATION", "STANDARD", true, "DRAFT")).toBe(false);
    expect(may("GUARDIAN", "CONVOCATION", "STANDARD", true, "SENT")).toBe(true);
    expect(may("STUDENT", "CONVOCATION", "STANDARD", true, "SENT")).toBe(false);
    expect(may("TEACHER", "MEASURE", "STANDARD", true, "NOTIFIED")).toBe(false); // audience inconnue : refus
  });

  it("habilitation du personnel : le niveau demandé ne dépasse jamais l'habilitation", () => {
    for (const [clearance, expected] of [
      ["STANDARD", { STANDARD: true, RESTRICTED: false, CONFIDENTIAL: false }],
      ["RESTRICTED", { STANDARD: true, RESTRICTED: true, CONFIDENTIAL: false }],
      ["CONFIDENTIAL", { STANDARD: true, RESTRICTED: true, CONFIDENTIAL: true }],
    ] as const) {
      for (const level of ["STANDARD", "RESTRICTED", "CONFIDENTIAL"] as const) {
        expect(may(staffAudience(clearance), "INCIDENT", level, false, "X"), `${clearance} -> ${level}`).toBe(expected[level]);
      }
    }
    expect(clearanceOf({ restricted: false, confidential: false })).toBe("STANDARD");
    expect(clearanceOf({ restricted: true, confidential: false })).toBe("RESTRICTED");
    expect(clearanceOf({ restricted: false, confidential: true })).toBe("CONFIDENTIAL");
    expect(confidentialityRank("STANDARD")).toBeLessThan(confidentialityRank("RESTRICTED"));
    expect(confidentialityRank("RESTRICTED")).toBeLessThan(confidentialityRank("CONFIDENTIAL"));
    expect(confidentialityRank("inconnu")).toBeGreaterThan(confidentialityRank("CONFIDENTIAL")); // niveau inconnu : refusé à tous
  });
});

describe("machines à états : parité avec les déclencheurs SQL (lues dans les migrations)", () => {
  const sql2202 = read("migrations/2202_schoollife_guards.sql");
  const sql2203 = read("migrations/2203_schoollife_effects.sql");

  /** Paires `('A', 'B')` du bloc `IN ( … )` qui suit `(OLD.status, NEW.status)` dans la fonction `fn`. */
  function pairsOf(sql: string, fn: string): Array<[string, string]> {
    const start = sql.indexOf(`CREATE FUNCTION schoollife.${fn}()`);
    expect(start, `fonction ${fn} introuvable`).toBeGreaterThan(-1);
    const end = sql.indexOf("$$;", sql.indexOf("$$", start) + 2);
    const body = sql.slice(start, end);
    const at = body.indexOf("(OLD.status, NEW.status) IN (");
    expect(at, `${fn} : liste de transitions introuvable`).toBeGreaterThan(-1);
    let depth = 0;
    let i = at + "(OLD.status, NEW.status) IN ".length;
    const open = i;
    for (; i < body.length; i += 1) {
      if (body[i] === "(") depth += 1;
      if (body[i] === ")") {
        depth -= 1;
        if (depth === 0) break;
      }
    }
    const list = body.slice(open, i + 1);
    return [...list.matchAll(/\('([A-Z_]+)',\s*'([A-Z_]+)'\)/g)].map((m) => [m[1]!, m[2]!]);
  }
  const norm = (pairs: ReadonlyArray<Transition<string> | [string, string]>): string[] => pairs.map(([a, b]) => `${a}>${b}`).sort();

  it.each([
    ["incidents_guard", sql2202, INCIDENT_TRANSITIONS],
    ["measures_guard", sql2202, MEASURE_TRANSITIONS],
    ["convocations_guard", sql2202, CONVOCATION_TRANSITIONS],
    ["conduct_scales_guard", sql2202, SCALE_TRANSITIONS],
    ["measure_effects_guard", sql2203, EFFECT_TRANSITIONS],
  ] as const)("%s", (fn, sql, table) => {
    expect(norm(pairsOf(sql, fn))).toEqual(norm(table));
  });

  it("canTransition : exemples métier (une mesure rejetée ne se valide plus ; une mesure validée ne se révoque qu'après notification)", () => {
    expect(canTransition(MEASURE_TRANSITIONS, "PROPOSED", "VALIDATED")).toBe(true);
    expect(canTransition(MEASURE_TRANSITIONS, "REJECTED", "VALIDATED")).toBe(false);
    expect(canTransition(MEASURE_TRANSITIONS, "VALIDATED", "REVOKED")).toBe(false);
    expect(canTransition(MEASURE_TRANSITIONS, "NOTIFIED", "REVOKED")).toBe(true);
    expect(canTransition(EFFECT_TRANSITIONS, "AWAITING_HUMAN", "APPLIED")).toBe(true);
    expect(canTransition(EFFECT_TRANSITIONS, "APPLIED", "AWAITING_HUMAN")).toBe(false);
  });
});

describe("points de conduite : miroir de `schoollife.conduct_balance` et choix du barème", () => {
  const scale = (over: Partial<ScaleFacts> = {}): ScaleFacts => ({
    id: "s1",
    institutionId: "i1",
    gradeLevelId: null,
    initialPoints: 20,
    minPoints: 0,
    maxPoints: 22,
    resetScope: "YEAR",
    effectiveFrom: "2026-09-01",
    effectiveTo: null,
    status: "ACTIVE",
    ...over,
  });
  const mv = (delta: number, period: string | null, year = "y1") => ({ delta, academicYearId: year, academicPeriodId: period });

  it("remise à zéro par période, par année ou jamais ; borné par le barème", () => {
    expect(conductBalance(scale({ resetScope: "PERIOD" }), [mv(-7, "p1"), mv(-2, "p2")], { academicYearId: "y1", periodId: "p1" })).toBe(13);
    expect(conductBalance(scale({ resetScope: "PERIOD" }), [mv(-7, "p1"), mv(-2, "p2")], { academicYearId: "y1", periodId: "p2" })).toBe(18);
    expect(conductBalance(scale({ resetScope: "YEAR" }), [mv(-7, "p1"), mv(-2, "p2")], { academicYearId: "y1" })).toBe(11);
    expect(conductBalance(scale({ resetScope: "NEVER" }), [mv(-7, "p1"), mv(-2, "p2", "autre")], { academicYearId: "y1" })).toBe(11);
    expect(conductBalance(scale(), [mv(-50, "p1")], { academicYearId: "y1" })).toBe(0);
    expect(conductBalance(scale(), [mv(9, "p1")], { academicYearId: "y1" })).toBe(22);
    expect(conductBalance(scale({ minPoints: null, maxPoints: null }), [mv(-50, null)], { academicYearId: "y1" })).toBe(-30);
  });

  it("barème applicable : actif, de l'établissement, couvrant la date ; le barème du niveau l'emporte ; aucun barème actif = aucun mouvement", () => {
    const all = scale({ id: "all" });
    const level = scale({ id: "lvl", gradeLevelId: "g6" });
    const retired = scale({ id: "old", status: "RETIRED" });
    const future = scale({ id: "fut", effectiveFrom: "2027-09-01" });
    const other = scale({ id: "oth", institutionId: "i2" });
    expect(pickScale([retired, future, other], { institutionId: "i1", gradeLevelId: "g6", on: "2026-11-02" })).toBeNull();
    expect(pickScale([all, level], { institutionId: "i1", gradeLevelId: "g6", on: "2026-11-02" })?.id).toBe("lvl");
    expect(pickScale([all, level], { institutionId: "i1", gradeLevelId: "g5", on: "2026-11-02" })?.id).toBe("all");
    expect(pickScale([scale({ id: "ended", effectiveTo: "2026-10-31" })], { institutionId: "i1", gradeLevelId: null, on: "2026-11-02" })).toBeNull();
  });

  it("période la plus étroite : le trimestre plutôt que le semestre", () => {
    const periods = [
      { periodId: "sem", startsOn: "2026-09-01", endsOn: "2027-01-31" },
      { periodId: "tri", startsOn: "2026-09-01", endsOn: "2026-12-20" },
      { periodId: "tri2", startsOn: "2027-01-05", endsOn: "2027-03-31" },
    ];
    expect(narrowestPeriod(periods, "2026-11-02")?.periodId).toBe("tri");
    expect(narrowestPeriod(periods, "2027-01-10")?.periodId).toBe("tri2");
    expect(narrowestPeriod(periods, "2028-01-01")).toBeNull();
  });
});

describe("type d'événement : miroir des contraintes de la base", () => {
  const flags = (over: Partial<Parameters<typeof validateTypeFlags>[0]>) => ({ kind: "SANCTION" as const, requiresValidation: false, requiresFourEyes: false, requiresDates: false, appealable: false, ...over });
  it("exclusion = validation obligatoire + dates ; quatre yeux => validation ; incident sans circuit ; recours réservé", () => {
    expect(validateTypeFlags(flags({}))).toEqual([]);
    expect(validateTypeFlags(flags({ kind: "TEMP_EXCLUSION", requiresDates: true, requiresValidation: true, requiresFourEyes: true, appealable: true }))).toEqual([]);
    expect(validateTypeFlags(flags({ kind: "TEMP_EXCLUSION", requiresDates: true })).map((i) => i.field)).toContain("requiresValidation");
    expect(validateTypeFlags(flags({ kind: "TEMP_EXCLUSION", requiresValidation: true })).map((i) => i.field)).toContain("requiresDates");
    expect(validateTypeFlags(flags({ requiresDates: true })).map((i) => i.field)).toContain("requiresDates");
    expect(validateTypeFlags(flags({ requiresFourEyes: true })).map((i) => i.field)).toContain("requiresFourEyes");
    expect(validateTypeFlags(flags({ kind: "INCIDENT", requiresValidation: true })).length).toBeGreaterThan(0);
    expect(validateTypeFlags(flags({ kind: "WARNING", appealable: true })).map((i) => i.field)).toContain("appealable");
  });
});

describe("refus de la base -> erreurs applicatives stables", () => {
  const t = (message: string, sqlstate = "P0001", constraint?: string) => translateViolation({ sqlstate, message, constraint });
  it("classement par catégorie", () => {
    expect(t("schoollife.human_actor_required: x")).toMatchObject({ kind: "forbidden", code: "schoollife.human_actor_required" });
    expect(t("schoollife.four_eyes_required: x")).toMatchObject({ kind: "forbidden" });
    expect(t("schoollife.proposer_mismatch: x")).toMatchObject({ kind: "forbidden" });
    expect(t("schoollife.measure_transition: A -> B interdit")).toMatchObject({ kind: "conflict", code: "schoollife.measure_transition" });
    expect(t("schoollife.confidentiality_lowered: x")).toMatchObject({ kind: "conflict" });
    expect(t("schoollife.confidentiality_floor: x")).toMatchObject({ kind: "validation" });
    expect(t("schoollife.reversal_mismatch: x")).toMatchObject({ kind: "validation" });
    expect(t("schoollife.scale_not_found", "P0002")).toMatchObject({ kind: "not_found" });
    expect(t("conflicting key value violates exclusion constraint \"measures_tenant_id_enrollment_id_daterange_excl\"", "23P01")).toMatchObject({ kind: "conflict", code: "schoollife.exclusion_overlap" });
    expect(t("conflicting key value violates exclusion constraint \"conduct_scales_x\" conduct_scales", "23P01")).toMatchObject({ code: "schoollife.scale_overlap" });
    expect(t("duplicate key", "23505")).toMatchObject({ kind: "conflict", code: "schoollife.duplicate" });
    expect(t("violates foreign key", "23503")).toMatchObject({ kind: "validation", code: "schoollife.invalid_reference" });
    expect(t("check", "23514", "measures_check")).toMatchObject({ kind: "validation", code: "schoollife.invalid_input" });
    expect(t("canceling statement", "57014")).toBeNull();
    expect(t("new row violates row-level security policy", "42501")).toBeNull(); // fuite RLS : jamais traduite en simple 403
  });
});

describe("événements : liste du module = contrat versionné", () => {
  it("noms publiés, contrat Zod et manifeste identiques ; verbes au participe passé ; aucune charge sans `v: 1`", () => {
    expect([...ALL_EVENT_TYPES].sort()).toEqual(Object.keys(C.schoollifeEventPayloadSchemas).sort());
    expect([...manifest.events.publishes].sort()).toEqual([...ALL_EVENT_TYPES].sort());
    expect(Object.values(SchoolLifeEvents)).toEqual(expect.arrayContaining(["schoollife.measure.validated", "schoollife.convocation.missed", "schoollife.exclusion_effect.requested"]));
    expect(manifest.events.consumes).toEqual([]);
    expect(C.SCHOOLLIFE_EVENT_TYPES).toHaveLength(ALL_EVENT_TYPES.length);
    const sample = { v: 1, measureId: "01960000-0000-7000-8000-000000000001" };
    expect(C.schoollifeEventPayloadSchemas["schoollife.appeal.filed"].safeParse({ ...sample, appealId: sample.measureId, studentId: sample.measureId }).success).toBe(true);
    expect(C.schoollifeEventPayloadSchemas["schoollife.appeal.filed"].safeParse({ appealId: sample.measureId, measureId: sample.measureId, studentId: sample.measureId }).success).toBe(false);
  });
});

describe("manifeste", () => {
  it("clé, packs, aucune dépendance de chargement (ports), permissions bien formées et toutes utilisées par la couche HTTP", () => {
    expect(manifest).toMatchObject({ key: "schoollife", packs: ["SECONDARY"], dependsOn: [] });
    const keys = manifest.permissions.map((p) => p.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const k of keys) expect(k).toMatch(PERMISSION_KEY_RE);
    expect([...Object.values(PERMISSIONS)].sort()).toEqual([...keys].sort());
  });

  it("sensibles : confidentiel, restreint, validations, exclusions, recours, barèmes, réglages — jamais la saisie courante ni la lecture standard", () => {
    const sensitive = manifest.permissions.filter((p) => p.sensitive).map((p) => p.key).sort();
    expect(sensitive).toEqual(
      [
        "schoollife.restricted.read",
        "schoollife.confidential.read",
        "schoollife.confidential.audit",
        "schoollife.measure.validate",
        "schoollife.exclusion.validate",
        "schoollife.exclusion.apply",
        "schoollife.measure.revoke",
        "schoollife.appeal.decide",
        "schoollife.conduct.manage",
        "schoollife.conduct.adjust",
        "schoollife.settings.manage",
      ].sort(),
    );
    for (const k of ["schoollife.read", "schoollife.read.all", "schoollife.incident.write", "schoollife.note.write", "schoollife.child.read", "schoollife.self.read"]) {
      expect(manifest.permissions.find((p) => p.key === k)?.sensitive, k).toBeFalsy();
    }
  });

  it("menus : permission et feature du module ; features rattachées au pack", () => {
    expect(manifest.features.map((f) => f.key).sort()).toEqual(["schoollife.conduct-points", "schoollife.convocations", "schoollife.core"]);
    for (const m of manifest.menus) {
      expect(manifest.permissions.some((p) => p.key === m.permission), m.key).toBe(true);
      if (m.feature) expect(manifest.features.some((f) => f.key === m.feature), m.key).toBe(true);
    }
  });

  it("les contrats sont réexportés par l'index des contrats v2", () => {
    expect(contractsIndex.schoollifeMeasureProposeSchema).toBe(C.schoollifeMeasureProposeSchema);
    expect(Object.keys(contractsIndex).filter((k) => /^schoollife/i.test(k)).length).toBeGreaterThan(60);
  });
});

describe("contrats Zod", () => {
  const id = "01960000-0000-7000-8000-000000000001";
  it("l'élève et le proposant ne sont JAMAIS fournis par le client (entrées strictes)", () => {
    const ok = { enrollmentId: id, typeId: id, reason: "Comportement répété" };
    expect(C.schoollifeMeasureProposeSchema.safeParse(ok).success).toBe(true);
    expect(C.schoollifeMeasureProposeSchema.safeParse({ ...ok, studentId: id }).success).toBe(false);
    expect(C.schoollifeMeasureProposeSchema.safeParse({ ...ok, proposedBy: id }).success).toBe(false);
    expect(C.schoollifeNoteCreateSchema.safeParse({ enrollmentId: id, typeId: id, body: "Bravo", occurredOn: "2026-11-02", authorId: id }).success).toBe(false);
    expect(C.schoollifeConvocationCreateSchema.safeParse({ enrollmentId: id, reasonKind: "OTHER", reason: "Entretien", scheduledAt: "2026-12-01T08:00:00Z", convenedBy: id }).success).toBe(false);
  });
  it("incident : au moins un élève impliqué, ou l'établissement et l'année", () => {
    const base = { typeId: id, occurredAt: "2026-11-02T09:30:00Z", description: "Altercation" };
    expect(C.schoollifeIncidentCreateSchema.safeParse(base).success).toBe(false);
    expect(C.schoollifeIncidentCreateSchema.safeParse({ ...base, involvements: [{ enrollmentId: id, role: "AUTHOR" }] }).success).toBe(true);
    expect(C.schoollifeIncidentCreateSchema.safeParse({ ...base, institutionId: id, academicYearId: id }).success).toBe(true);
  });
  it("motifs minimaux (≥ 5, révocation et recours ≥ 10), dates réelles, booléens de requête (« false » vaut faux)", () => {
    expect(C.schoollifeMeasureRevokeSchema.safeParse({ reason: "trop bref" }).success).toBe(false);
    expect(C.schoollifeMeasureRevokeSchema.safeParse({ reason: "Erreur d'identification" }).success).toBe(true);
    expect(C.schoollifeMeasureCancelSchema.safeParse({ reason: "x" }).success).toBe(false);
    expect(C.schoollifeAppealFileSchema.safeParse({ reason: "court" }).success).toBe(false);
    expect(C.schoollifeNoteCreateSchema.safeParse({ enrollmentId: id, typeId: id, body: "Bravo", occurredOn: "2026-02-30" }).success).toBe(false);
    expect(C.schoollifeMeasureListQuerySchema.parse({ pendingOnly: "false" }).pendingOnly).toBe(false);
    expect(C.schoollifeMeasureListQuerySchema.parse({ pendingOnly: "true" }).pendingOnly).toBe(true);
    expect(C.schoollifeMeasureListQuerySchema.parse({}).pageSize).toBe(50);
    expect(C.schoollifeMeasureListQuerySchema.safeParse({ pageSize: "500" }).success).toBe(false);
  });
  it("paramètres : un type d'événement est une DONNÉE (code libre bien formé), une valeur de barème n'est jamais nulle", () => {
    expect(C.schoollifeEventTypeInputSchema.safeParse({ code: "MON_TYPE", label: "Mon type", kind: "WARNING" }).success).toBe(true);
    expect(C.schoollifeEventTypeInputSchema.safeParse({ code: "mon type", label: "Mon type", kind: "WARNING" }).success).toBe(false);
    expect(C.schoollifeEventTypeInputSchema.safeParse({ code: "MON_TYPE", label: "Mon type", kind: "AUTRE" }).success).toBe(false);
    expect(C.schoollifeScaleItemsSchema.safeParse({ items: [{ eventTypeId: id, pointsDelta: 0 }] }).success).toBe(false);
    expect(C.schoollifeManualAdjustmentSchema.safeParse({ enrollmentId: id, scaleId: id, delta: 0, reason: "Ajustement" }).success).toBe(false);
  });
  it("une erreur Zod est une ValidationError exploitable", () => {
    expect(new ValidationError("x").kind).toBe("validation");
  });
});

describe("ports : échec fermé par défaut", () => {
  it("chaque port non branché lève `schoollife.port_unavailable`", async () => {
    const ports = unavailablePorts();
    const ctx = {} as never;
    await expect(Promise.resolve().then(() => ports.enrollments.getEnrollment(ctx, "x"))).rejects.toMatchObject({ code: "schoollife.port_unavailable" });
    await expect(Promise.resolve().then(() => ports.people.isGuardianOfStudent(ctx, "u", "s"))).rejects.toMatchObject({ code: "schoollife.port_unavailable" });
    await expect(Promise.resolve().then(() => ports.notifications.notifyGuardians(ctx, {} as never))).rejects.toMatchObject({ code: "schoollife.port_unavailable" });
    await expect(Promise.resolve().then(() => ports.studentStatus.changeStudentStatus(ctx, {} as never))).rejects.toMatchObject({ code: "schoollife.port_unavailable" });
    await expect(Promise.resolve().then(() => ports.attendance.listAbsences(ctx, {} as never))).rejects.toMatchObject({ code: "schoollife.port_unavailable" });
  });
});

describe("spécification : le DDL de référence est EXACTEMENT celui des migrations", () => {
  it("les blocs `22xx` de specs/v2/006-secondary/data-model.md (extraits par ddl-test/) égalent les fichiers de migration", () => {
    const md = readFileSync(resolve(moduleDir, "../../../../../specs/v2/006-secondary/data-model.md"), "utf8").replace(/\r\n/g, "\n");
    const blocks = new Map([...md.matchAll(/<!--\s*migration:\s*(22\d\d_[A-Za-z0-9_]+\.sql)\s*-->\s*```sql\n([\s\S]*?)\n```/g)].map((m) => [m[1]!, m[2]!]));
    const files = readdirSync(join(moduleDir, "migrations")).filter((f) => f.endsWith(".sql")).sort();
    expect([...blocks.keys()].sort()).toEqual(files.map((f) => f.replace(/\.sql$/, ".sql")));
    for (const f of files) expect(blocks.get(f)?.replace(/\n+$/, ""), f).toBe(read(`migrations/${f}`).replace(/\r\n/g, "\n").replace(/\n+$/, ""));
  });
});

describe("garde-fous de contenu : aucune règle réglementaire, aucun catalogue de fautes en code, aucune donnée livrée", () => {
  const walk = (dir: string, out: string[] = []): string[] => {
    for (const e of readdirSync(dir)) {
      const p = join(dir, e);
      if (statSync(p).isDirectory()) {
        if (!["test", "node_modules", "migrations"].includes(e)) walk(p, out);
      } else if (p.endsWith(".ts")) out.push(p);
    }
    return out;
  };
  const sources = walk(moduleDir);

  it("aucun libellé de faute, de sanction ou de gravité dans le code du module", () => {
    // Les types d'événements, gravités et barèmes sont des données d'établissement : jamais une constante du code.
    const forbidden = /\b(bagarre|insolence|tricherie|harc[eè]lement|vandalisme|retard injustifi|renvoi d[ée]finitif|exclusion de (?:\d+|trois|deux|un) jours?|blâme|avertissement écrit)\b/i;
    const hits = sources.filter((f) => forbidden.test(readFileSync(f, "utf8"))).map((f) => f.replace(moduleDir, ""));
    expect(hits).toEqual([]);
  });

  it("aucun seuil numérique réglementaire : pas de durée d'exclusion, de nombre de points ou de seuil codés (hors bornes techniques de pagination)", () => {
    const pattern = /(maxExclusionDays|exclusionDays\s*[<>]=?\s*\d|points\s*[<>]=?\s*\d|retentionDays\s*[=:]\s*\d)/;
    const hits = sources.filter((f) => pattern.test(readFileSync(f, "utf8"))).map((f) => f.replace(moduleDir, ""));
    expect(hits).toEqual([]);
  });

  it("aucune donnée n'est livrée par les migrations (aucun INSERT : types, gravités, barèmes = vides par défaut)", () => {
    for (const f of readdirSync(join(moduleDir, "migrations"))) {
      // Hors corps de fonctions (`$$ … $$` : l'historique automatique et les effets écrivent des lignes, pas des données de départ).
      expect(read(`migrations/${f}`).replace(/\$\$[\s\S]*?\$\$/g, ""), f).not.toMatch(/^\s*INSERT\s+INTO\s+schoollife\./im);
    }
  });

  it("aucun accès SQL hors infrastructure/, aucun `pool.query`", () => {
    for (const f of sources) {
      const rel = f.replace(moduleDir, "").replace(/\\/g, "/");
      const text = readFileSync(f, "utf8");
      if (!rel.startsWith("/infrastructure/")) expect(text, rel).not.toMatch(/\b(SELECT|INSERT INTO|UPDATE schoollife|DELETE FROM)\b[^\n`'"]*\bFROM\b|INSERT INTO schoollife|UPDATE schoollife\./);
      expect(text, rel).not.toMatch(/pool\.query/);
    }
  });
});
