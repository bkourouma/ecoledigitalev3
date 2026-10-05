/**
 * Générateur d'emploi du temps (domaine pur) : contraintes dures (propriété sur des problèmes pseudo-aléatoires),
 * déterminisme par graine, rapport des séances non placées, limite de temps, performance (40 classes × 30 séances).
 */
import { describe, expect, it } from "vitest";
import { generateTimetable, validateProblem } from "../../domain/autogen/engine";
import { createRng } from "../../domain/autogen/prng";
import { GenProblemError, type GenProblem } from "../../domain/autogen/types";
import { scoreOf, verifyHard } from "../../domain/autogen/verify";
import { makePeriods, makeProblem } from "../support/autogen-fixtures";

const strip = (r: ReturnType<typeof generateTimetable>) => JSON.stringify({ p: r.placements, u: r.unplaced, s: r.softCost, b: r.breakdown });

describe("PRNG", () => {
  it("même graine, même suite ; graines différentes, suites différentes", () => {
    const a = createRng("graine");
    const b = createRng("graine");
    const c = createRng("autre");
    const sa = Array.from({ length: 8 }, () => a.next());
    expect(Array.from({ length: 8 }, () => b.next())).toEqual(sa);
    expect(Array.from({ length: 8 }, () => c.next())).not.toEqual(sa);
    expect(sa.every((x) => x >= 0 && x < 1)).toBe(true);
    expect(createRng(1).int(1)).toBe(0);
  });
});

describe("générateur : contraintes dures (propriété)", () => {
  it("aucun conflit enseignant / classe / salle ni violation dure sur 60 problèmes pseudo-aléatoires", () => {
    const rng = createRng("property");
    for (let i = 0; i < 60; i++) {
      const problem = makeProblem({
        classes: 2 + rng.int(8),
        requirementsPerClass: 3 + rng.int(6),
        sessionsPerRequirement: 1 + rng.int(4),
        teachers: 3 + rng.int(10),
        rooms: 1 + rng.int(8),
        periods: 5 + rng.int(4),
        weekdays: rng.next() < 0.5 ? [1, 2, 3, 4, 5] : [1, 2, 3, 4, 5, 6],
        unavailabilityRate: rng.next() * 0.4,
        candidates: 1 + rng.int(3),
        sessionPeriods: 1 + rng.int(2),
        seed: i,
        maxIterations: 600,
      });
      const result = generateTimetable(problem);
      const violations = verifyHard(problem, result.placements);
      expect(violations, `problème ${i} : ${JSON.stringify(violations.slice(0, 3))}`).toEqual([]);
      expect(result.stats.placed + result.stats.unplacedSessions).toBe(result.stats.sessions);
      expect(result.placements).toHaveLength(result.stats.placed);
      // Le coût annoncé est celui qu'un calcul indépendant retrouve.
      expect(result.softCost).toBe(scoreOf(problem, result.placements).total);
    }
  });

  it("des occupations fixes (autre emploi du temps) sont respectées", () => {
    const base = makeProblem({ classes: 3, requirementsPerClass: 4, sessionsPerRequirement: 3, teachers: 4, rooms: 3, seed: "fixed", maxIterations: 500 });
    const problem: GenProblem = {
      ...base,
      fixed: [
        { classroomId: null, teacherId: "t0", roomId: "r0", weekday: 1, startPeriod: 0, periods: 3 },
        { classroomId: "c1", teacherId: null, roomId: null, weekday: 2, startPeriod: 1, periods: 2 },
      ],
    };
    const result = generateTimetable(problem);
    expect(verifyHard(problem, result.placements)).toEqual([]);
    expect(result.placements.some((p) => p.teacherId === "t0" && p.weekday === 1 && p.startPeriod < 3)).toBe(false);
    expect(result.placements.some((p) => p.classroomId === "c1" && p.weekday === 2 && p.startPeriod >= 1 && p.startPeriod < 3)).toBe(false);
  });

  it("le vérificateur détecte réellement les conflits (oracle non trivial)", () => {
    const problem = makeProblem({ classes: 2, requirementsPerClass: 1, sessionsPerRequirement: 1, teachers: 1, rooms: 1, seed: "oracle" });
    const result = generateTimetable(problem);
    expect(result.placements).toHaveLength(2);
    const [a, b] = result.placements;
    // On force les deux séances au même créneau, avec le même enseignant et la même salle.
    const forced = [a!, { ...b!, weekday: a!.weekday, startPeriod: a!.startPeriod, teacherId: a!.teacherId, roomId: a!.roomId }];
    const codes = verifyHard(problem, forced).map((v) => v.code);
    expect(codes).toContain("TEACHER_CONFLICT");
    expect(codes).toContain("ROOM_CONFLICT");
  });

  it("plafonds de l'enseignant et séances de deux périodes (jamais à cheval sur la pause)", () => {
    const base = makeProblem({ classes: 4, requirementsPerClass: 3, sessionsPerRequirement: 2, teachers: 3, rooms: 4, sessionPeriods: 2, seed: "limits", maxIterations: 800 });
    const problem: GenProblem = { ...base, teachers: base.teachers.map((t) => ({ ...t, maxPeriodsPerDay: 4, maxPeriodsPerWeek: 16 })) };
    const result = generateTimetable(problem);
    expect(verifyHard(problem, result.placements)).toEqual([]);
    for (const p of result.placements) {
      // La pause est entre les périodes 2 et 3 (index) : une séance de 2 périodes ne peut pas commencer à l'index 2.
      expect(p.startPeriod).not.toBe(2);
    }
    const load = new Map<string, number>();
    for (const p of result.placements) if (p.teacherId) load.set(p.teacherId, (load.get(p.teacherId) ?? 0) + p.periods);
    for (const v of load.values()) expect(v).toBeLessThanOrEqual(16);
  });
});

describe("générateur : déterminisme", () => {
  const problem = makeProblem({ classes: 8, requirementsPerClass: 6, sessionsPerRequirement: 3, teachers: 14, rooms: 9, unavailabilityRate: 0.15, candidates: 2, seed: "determinisme", maxIterations: 3000 });

  it("même graine ⇒ même emploi du temps, au caractère près", () => {
    const first = generateTimetable(problem);
    const second = generateTimetable(problem);
    expect(strip(second)).toBe(strip(first));
    expect(second.stats.iterations).toBe(first.stats.iterations);
  });

  it("une autre graine donne un autre emploi du temps (toujours valide)", () => {
    const first = generateTimetable(problem);
    const other = generateTimetable({ ...problem, seed: "autre-graine" });
    expect(verifyHard({ ...problem, seed: "autre-graine" }, other.placements)).toEqual([]);
    expect(strip(other)).not.toBe(strip(first));
  });

  it("l'amélioration locale ne dégrade jamais la construction et l'améliore ici", () => {
    const construction = generateTimetable({ ...problem, maxIterations: 0 });
    const improved = generateTimetable(problem);
    expect(improved.stats.unplacedSessions).toBeLessThanOrEqual(construction.stats.unplacedSessions);
    expect(improved.softCost).toBeLessThanOrEqual(construction.softCost);
    expect(improved.stats.initialSoftCost).toBe(construction.softCost);
  });
});

describe("générateur : ce qui ne peut pas être placé, et pourquoi", () => {
  it("une classe surchargée : séances non placées avec la cause CLASS_OVERLOADED", () => {
    const base = makeProblem({ classes: 1, requirementsPerClass: 3, sessionsPerRequirement: 4, teachers: 3, rooms: 2, periods: 4, weekdays: [1, 2, 3], seed: "over" });
    // 3 jours × 4 périodes = 12 cases pour 12 séances : on ajoute des séances en trop.
    const problem: GenProblem = { ...base, requirements: base.requirements.map((r, i) => (i === 0 ? { ...r, sessionsPerWeek: 7, maxPerDay: 3 } : r)) };
    const result = generateTimetable(problem);
    expect(verifyHard(problem, result.placements)).toEqual([]);
    expect(result.stats.unplacedSessions).toBeGreaterThan(0);
    const miss = result.unplaced.reduce((n, u) => n + u.missing, 0);
    expect(miss).toBe(result.stats.unplacedSessions);
    expect(result.unplaced.every((u) => u.reasons[0]?.code === "CLASS_OVERLOADED")).toBe(true);
  });

  it("enseignant indisponible partout : TEACHER_UNAVAILABLE ; aucune salle assez grande : NO_ROOM_CANDIDATE", () => {
    const base = makeProblem({ classes: 2, requirementsPerClass: 1, sessionsPerRequirement: 2, teachers: 2, rooms: 2, weekdays: [1, 2], periods: 3, seed: "why" });
    const everything = base.weekdays.flatMap((weekday) => base.periods.map((_, period) => ({ weekday, period })));
    const problem: GenProblem = {
      ...base,
      teachers: base.teachers.map((t, i) => (i === 0 ? { ...t, unavailable: everything } : t)),
      classes: base.classes.map((c, i) => (i === 1 ? { ...c, headcount: 500 } : c)),
      requirements: base.requirements.map((r, i) => (i === 0 ? { ...r, teacherIds: ["t0"] } : { ...r, teacherIds: ["t1"] })),
    };
    const result = generateTimetable(problem);
    const first = result.unplaced.find((u) => u.requirementId === problem.requirements[0]!.id);
    const second = result.unplaced.find((u) => u.requirementId === problem.requirements[1]!.id);
    expect(first?.missing).toBe(2);
    expect(first?.reasons[0]?.code).toBe("TEACHER_UNAVAILABLE");
    expect(second?.reasons[0]?.code).toBe("NO_ROOM_CANDIDATE");
    expect(verifyHard(problem, result.placements)).toEqual([]);
  });

  it("une séance sans enseignant candidat est placée avec un avertissement ; sans salle définie, aussi", () => {
    const base = makeProblem({ classes: 1, requirementsPerClass: 1, sessionsPerRequirement: 2, teachers: 1, rooms: 0, seed: "w" });
    const problem: GenProblem = { ...base, requirements: base.requirements.map((r) => ({ ...r, teacherIds: [] })) };
    const result = generateTimetable(problem);
    expect(result.stats.placed).toBe(2);
    expect(result.placements.every((p) => p.teacherId === null && p.roomId === null)).toBe(true);
    expect(result.warnings.map((w) => w.code).sort()).toEqual(["NO_ROOMS_DEFINED", "NO_TEACHER"]);
  });

  it("limite de temps : la construction s'arrête et le rapport l'indique", () => {
    const problem = makeProblem({ classes: 6, requirementsPerClass: 5, sessionsPerRequirement: 2, teachers: 8, rooms: 6, seed: "t", maxIterations: 1_000_000, timeLimitMs: 5 });
    let tick = 0;
    // Horloge factice : chaque lecture avance de 10 ms, donc la limite de 5 ms est dépassée tout de suite.
    const result = generateTimetable(problem, { now: () => (tick += 10) });
    expect(result.stats.stoppedBy).toBe("TIME_LIMIT");
    expect(result.warnings.map((w) => w.code)).toContain("TIME_LIMIT_CONSTRUCTION");
    expect(verifyHard(problem, result.placements)).toEqual([]);
  });

  it("limite de temps pendant l'amélioration : la meilleure solution trouvée est rendue, valide", () => {
    const problem = makeProblem({ classes: 6, requirementsPerClass: 5, sessionsPerRequirement: 2, teachers: 8, rooms: 6, seed: "t2", maxIterations: 10_000_000, timeLimitMs: 40 });
    let calls = 0;
    // 1 appel pour t0, 1 par séance construite (60), puis le temps saute au-delà de la limite.
    const result = generateTimetable(problem, { now: () => (++calls < 80 ? 0 : 1_000) });
    expect(result.stats.stoppedBy).toBe("TIME_LIMIT");
    expect(result.stats.placed).toBeGreaterThan(0);
    expect(verifyHard(problem, result.placements)).toEqual([]);
  });
});

describe("validation du problème", () => {
  const ok = makeProblem({ classes: 1, requirementsPerClass: 1, sessionsPerRequirement: 1, teachers: 1, rooms: 1 });
  const bad = (patch: Partial<GenProblem>, code: string): void => {
    try {
      validateProblem({ ...ok, ...patch });
    } catch (e) {
      expect(e).toBeInstanceOf(GenProblemError);
      expect((e as GenProblemError).code).toBe(code);
      return;
    }
    throw new Error(`erreur attendue : ${code}`);
  };
  it("refuse les problèmes mal formés", () => {
    expect(() => validateProblem(ok)).not.toThrow();
    bad({ weekdays: [] }, "weekdays_required");
    bad({ weekdays: [1, 1] }, "weekdays_invalid");
    bad({ periods: [] }, "periods_required");
    bad({ periods: [{ startMinute: 600, endMinute: 540 }] }, "period_invalid");
    bad({ periods: [{ startMinute: 480, endMinute: 540 }, { startMinute: 500, endMinute: 560 }] }, "periods_overlap");
    bad({ requirements: [{ ...ok.requirements[0]!, classroomId: "inconnue" }] }, "class_unknown");
    bad({ requirements: [{ ...ok.requirements[0]!, teacherIds: ["inconnu"] }] }, "teacher_unknown");
    bad({ requirements: [{ ...ok.requirements[0]!, sessionPeriods: makePeriods(8).length + 1 }] }, "session_periods_invalid");
    bad({ requirements: [{ ...ok.requirements[0]!, sessionsPerWeek: 0 }] }, "sessions_invalid");
    bad({ weights: { ...ok.weights, gap: -1 } }, "weight_invalid");
    bad({ maxIterations: -1 }, "iterations_invalid");
  });
});

describe("performance : 40 classes × 30 séances en temps borné", () => {
  it("1 200 séances placées sans conflit dur, dans la limite de temps", () => {
    const problem = makeProblem({
      classes: 40,
      requirementsPerClass: 10,
      sessionsPerRequirement: 3,
      teachers: 62,
      rooms: 40,
      periods: 8,
      unavailabilityRate: 0.25,
      candidates: 2,
      seed: "perf",
      maxIterations: 150_000,
      timeLimitMs: 25_000,
    });
    const started = Date.now();
    const result = generateTimetable(problem);
    const elapsed = Date.now() - started;
    expect(result.stats.sessions).toBe(1200);
    expect(verifyHard(problem, result.placements)).toEqual([]);
    // Limite de temps tenue (marge pour la fin de l'itération et le rapport), quelle que soit la machine.
    expect(elapsed).toBeLessThan(25_000 + 5_000);
    // Quasi-totalité placée : les 30 périodes de chaque classe tiennent dans les 40 cases de la semaine.
    expect(result.stats.placed / result.stats.sessions).toBeGreaterThan(0.99);
    expect(result.softCost).toBeLessThan(result.stats.initialSoftCost);
    expect(result.softCost).toBe(scoreOf(problem, result.placements).total);
  }, 60_000);
});
