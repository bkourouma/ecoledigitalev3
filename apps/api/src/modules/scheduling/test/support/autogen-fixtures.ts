/**
 * Fabrique de problèmes de génération pour les tests (aucune base) : établissement fictif, tailles réglables,
 * pseudo-aléatoire reproductible.
 */
import { createRng } from "../../domain/autogen/prng";
import { DEFAULT_WEIGHTS, type GenClass, type GenPeriod, type GenProblem, type GenRequirement, type GenRoom, type GenTeacher, type SlotRef } from "../../domain/autogen/types";

export interface FixtureOptions {
  classes: number;
  /** Besoins par classe. */
  requirementsPerClass: number;
  /** Séances par semaine et par besoin. */
  sessionsPerRequirement: number;
  teachers: number;
  rooms: number;
  weekdays?: number[];
  /** Périodes par jour. */
  periods?: number;
  /** Probabilité qu'un enseignant soit indisponible sur un créneau donné. */
  unavailabilityRate?: number;
  /** Enseignants candidats par besoin. */
  candidates?: number;
  /** Durée (périodes) des séances, par défaut 1. */
  sessionPeriods?: number;
  seed?: string | number;
  maxIterations?: number;
  timeLimitMs?: number;
  /** Effectif des classes / capacité des salles. */
  headcount?: number;
  roomCapacity?: number;
}

/** Journée de `n` périodes d'une heure à partir de 08:00, avec une pause (créneau manquant) entre la 3e et la 4e. */
export function makePeriods(n: number): GenPeriod[] {
  const out: GenPeriod[] = [];
  let t = 8 * 60;
  for (let i = 0; i < n; i++) {
    if (i === 3) t += 30; // récréation : deux périodes voisines ne sont pas contiguës
    out.push({ startMinute: t, endMinute: t + 60, timeSlotId: null, label: `P${i + 1}` });
    t += 60;
  }
  return out;
}

export function makeProblem(o: FixtureOptions): GenProblem {
  const rng = createRng(`fixture:${o.seed ?? "x"}:${o.classes}:${o.teachers}`);
  const weekdays = o.weekdays ?? [1, 2, 3, 4, 5];
  const periods = makePeriods(o.periods ?? 8);
  const len = o.sessionPeriods ?? 1;
  const classes: GenClass[] = Array.from({ length: o.classes }, (_, i) => ({ id: `c${i}`, label: `Classe ${i}`, headcount: o.headcount ?? 30, closed: [] }));
  const teachers: GenTeacher[] = Array.from({ length: o.teachers }, (_, i) => {
    const unavailable: SlotRef[] = [];
    for (const weekday of weekdays) for (let period = 0; period < periods.length; period++) if (rng.next() < (o.unavailabilityRate ?? 0)) unavailable.push({ weekday, period });
    const avoid: SlotRef[] = rng.next() < 0.3 ? [{ weekday: weekdays[0]!, period: 0 }] : [];
    return { id: `t${i}`, label: `Enseignant ${i}`, unavailable, avoid, prefer: [], maxPeriodsPerDay: null, maxPeriodsPerWeek: null };
  });
  const rooms: GenRoom[] = Array.from({ length: o.rooms }, (_, i) => ({ id: `r${i}`, code: `S${String(i).padStart(3, "0")}`, capacity: o.roomCapacity ?? 35, roomTypeCode: "CLASSROOM", features: [], closed: [] }));
  const requirements: GenRequirement[] = [];
  const cand = o.candidates ?? 1;
  for (let c = 0; c < o.classes; c++) {
    for (let k = 0; k < o.requirementsPerClass; k++) {
      const first = (c * 7 + k * 13 + Math.floor(rng.next() * 3)) % o.teachers;
      const teacherIds = Array.from({ length: Math.min(cand, o.teachers) }, (_, j) => `t${(first + j * 5) % o.teachers}`);
      requirements.push({
        id: `q${c}-${k}`,
        classroomId: `c${c}`,
        curriculumNodeId: `n${k}`,
        offeringId: null,
        label: `Matière ${k} / classe ${c}`,
        sessionsPerWeek: o.sessionsPerRequirement,
        sessionPeriods: len,
        teacherIds: [...new Set(teacherIds)],
        needsRoom: true,
        roomTypeCode: null,
        requiredFeatures: [],
        roomId: null,
        maxPerDay: null,
        preferredPeriods: [],
      });
    }
  }
  return {
    weekdays,
    periods,
    closed: [],
    classes,
    teachers,
    rooms,
    requirements,
    fixed: [],
    weights: DEFAULT_WEIGHTS,
    seed: o.seed ?? 1,
    maxIterations: o.maxIterations ?? 4000,
    timeLimitMs: o.timeLimitMs ?? 20_000,
  };
}
