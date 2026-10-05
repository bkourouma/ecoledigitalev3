/**
 * Vérificateur INDÉPENDANT du moteur : recalcule, à partir des seules séances placées, les violations des contraintes
 * DURES et le coût souple. Sert (1) de garde-fou avant d'enregistrer une proposition, (2) d'oracle aux tests de
 * propriété (« aucun conflit dur »), (3) à contrôler le coût annoncé par le moteur. Aucun état partagé avec `engine.ts`.
 */
import type { GenPlacement, GenProblem, GenScoreBreakdown } from "./types";

export interface HardViolation {
  readonly code:
    | "CLASS_CONFLICT"
    | "TEACHER_CONFLICT"
    | "ROOM_CONFLICT"
    | "SLOT_CLOSED"
    | "TEACHER_UNAVAILABLE"
    | "TEACHER_LIMIT"
    | "REQUIREMENT_DAY_CAP"
    | "NOT_CONTIGUOUS"
    | "ROOM_UNSUITABLE"
    | "TEACHER_NOT_CANDIDATE"
    | "TOO_MANY_SESSIONS"
    | "OUT_OF_GRID"
    | "FIXED_CONFLICT";
  readonly message: string;
  readonly requirementId?: string;
}

const key = (weekday: number, period: number): string => `${weekday}:${period}`;

export function verifyHard(problem: GenProblem, placements: readonly GenPlacement[]): HardViolation[] {
  const out: HardViolation[] = [];
  const req = new Map(problem.requirements.map((r) => [r.id, r]));
  const cls = new Map(problem.classes.map((c) => [c.id, c]));
  const teachers = new Map(problem.teachers.map((t) => [t.id, t]));
  const rooms = new Map(problem.rooms.map((r) => [r.id, r]));
  const slotSet = (list: readonly { weekday: number; period: number }[]): Set<string> => new Set(list.map((s) => key(s.weekday, s.period)));
  const closedAll = slotSet(problem.closed);

  const classUse = new Map<string, string>();
  const teacherUse = new Map<string, string>();
  const roomUse = new Map<string, string>();
  for (const f of problem.fixed) {
    for (let i = 0; i < f.periods; i++) {
      const k = key(f.weekday, f.startPeriod + i);
      if (f.classroomId) classUse.set(`${f.classroomId}|${k}`, "fixe");
      if (f.teacherId) teacherUse.set(`${f.teacherId}|${k}`, "fixe");
      if (f.roomId) roomUse.set(`${f.roomId}|${k}`, "fixe");
    }
  }

  const perReqDay = new Map<string, number>();
  const perReqCount = new Map<string, number>();
  const teacherDay = new Map<string, number>();
  const teacherWeek = new Map<string, number>();
  const seen = new Set<string>();

  for (const p of placements) {
    const r = req.get(p.requirementId);
    const tag = `${p.requirementId}#${p.sessionIndex}`;
    if (!r) {
      out.push({ code: "OUT_OF_GRID", message: `Besoin inconnu : ${p.requirementId}.`, requirementId: p.requirementId });
      continue;
    }
    if (seen.has(tag)) out.push({ code: "TOO_MANY_SESSIONS", message: `Séance ${tag} placée deux fois.`, requirementId: r.id });
    seen.add(tag);
    perReqCount.set(r.id, (perReqCount.get(r.id) ?? 0) + 1);
    if (!problem.weekdays.includes(p.weekday) || p.startPeriod < 0 || p.startPeriod + p.periods > problem.periods.length || p.periods !== r.sessionPeriods) {
      out.push({ code: "OUT_OF_GRID", message: `Séance ${tag} hors de la grille.`, requirementId: r.id });
      continue;
    }
    for (let i = 0; i < p.periods - 1; i++) {
      if (problem.periods[p.startPeriod + i]!.endMinute !== problem.periods[p.startPeriod + i + 1]!.startMinute) {
        out.push({ code: "NOT_CONTIGUOUS", message: `Séance ${tag} à cheval sur une pause.`, requirementId: r.id });
        break;
      }
    }
    if (p.teacherId !== null && !r.teacherIds.includes(p.teacherId)) out.push({ code: "TEACHER_NOT_CANDIDATE", message: `Séance ${tag} : enseignant non candidat.`, requirementId: r.id });
    const klass = cls.get(p.classroomId);
    const teacher = p.teacherId ? teachers.get(p.teacherId) : undefined;
    const room = p.roomId ? rooms.get(p.roomId) : undefined;
    const classClosed = klass ? slotSet(klass.closed) : new Set<string>();
    const teacherUnavail = teacher ? slotSet(teacher.unavailable) : new Set<string>();
    const roomClosed = room ? slotSet(room.closed) : new Set<string>();

    if (r.needsRoom && problem.rooms.length > 0) {
      if (!room) out.push({ code: "ROOM_UNSUITABLE", message: `Séance ${tag} sans salle alors qu'une salle est requise.`, requirementId: r.id });
      else {
        const headcount = klass?.headcount ?? null;
        const fits =
          (r.roomId ? room.id === r.roomId : true) &&
          (r.roomTypeCode ? room.roomTypeCode === r.roomTypeCode : true) &&
          r.requiredFeatures.every((f) => room.features.includes(f)) &&
          (headcount === null || room.capacity === null || room.capacity >= headcount);
        if (!fits) out.push({ code: "ROOM_UNSUITABLE", message: `Séance ${tag} : salle ${room.code} inadaptée.`, requirementId: r.id });
      }
    }

    for (let i = 0; i < p.periods; i++) {
      const k = key(p.weekday, p.startPeriod + i);
      if (closedAll.has(k) || classClosed.has(k) || roomClosed.has(k)) out.push({ code: "SLOT_CLOSED", message: `Séance ${tag} sur une case fermée (${k}).`, requirementId: r.id });
      if (teacherUnavail.has(k)) out.push({ code: "TEACHER_UNAVAILABLE", message: `Séance ${tag} : enseignant indisponible (${k}).`, requirementId: r.id });
      const claim = (map: Map<string, string>, id: string | null, code: HardViolation["code"], label: string): void => {
        if (id === null) return;
        const kk = `${id}|${k}`;
        const prev = map.get(kk);
        if (prev !== undefined) out.push({ code: prev === "fixe" && code !== "CLASS_CONFLICT" ? "FIXED_CONFLICT" : code, message: `${label} déjà occupé(e) en ${k} (${prev} / ${tag}).`, requirementId: r.id });
        else map.set(kk, tag);
      };
      claim(classUse, p.classroomId, "CLASS_CONFLICT", "Classe");
      claim(teacherUse, p.teacherId, "TEACHER_CONFLICT", "Enseignant");
      claim(roomUse, p.roomId, "ROOM_CONFLICT", "Salle");
    }
    const dk = `${r.id}|${p.weekday}`;
    perReqDay.set(dk, (perReqDay.get(dk) ?? 0) + 1);
    if (p.teacherId) {
      const td = `${p.teacherId}|${p.weekday}`;
      teacherDay.set(td, (teacherDay.get(td) ?? 0) + p.periods);
      teacherWeek.set(p.teacherId, (teacherWeek.get(p.teacherId) ?? 0) + p.periods);
    }
  }
  for (const f of problem.fixed) {
    if (f.teacherId) {
      teacherDay.set(`${f.teacherId}|${f.weekday}`, (teacherDay.get(`${f.teacherId}|${f.weekday}`) ?? 0) + f.periods);
      teacherWeek.set(f.teacherId, (teacherWeek.get(f.teacherId) ?? 0) + f.periods);
    }
  }
  for (const [dk, n] of perReqDay) {
    const r = req.get(dk.split("|")[0]!)!;
    const cap = r.maxPerDay ?? Math.max(1, Math.ceil(r.sessionsPerWeek / problem.weekdays.length));
    if (n > cap) out.push({ code: "REQUIREMENT_DAY_CAP", message: `Besoin ${r.label} : ${n} séances le même jour (plafond ${cap}).`, requirementId: r.id });
  }
  for (const [id, n] of perReqCount) {
    const r = req.get(id)!;
    if (n > r.sessionsPerWeek) out.push({ code: "TOO_MANY_SESSIONS", message: `Besoin ${r.label} : ${n} séances placées pour ${r.sessionsPerWeek} demandées.`, requirementId: r.id });
  }
  for (const t of problem.teachers) {
    if (t.maxPeriodsPerWeek !== null && (teacherWeek.get(t.id) ?? 0) > t.maxPeriodsPerWeek) out.push({ code: "TEACHER_LIMIT", message: `Enseignant ${t.label ?? t.id} : plafond hebdomadaire dépassé.` });
    if (t.maxPeriodsPerDay !== null) {
      for (const wd of problem.weekdays) if ((teacherDay.get(`${t.id}|${wd}`) ?? 0) > t.maxPeriodsPerDay) out.push({ code: "TEACHER_LIMIT", message: `Enseignant ${t.label ?? t.id} : plafond quotidien dépassé (jour ${wd}).` });
    }
  }
  return out;
}

/** Coût souple recalculé de zéro à partir des séances placées (mêmes définitions que le moteur). */
export function scoreOf(problem: GenProblem, placements: readonly GenPlacement[]): GenScoreBreakdown & { total: number } {
  const w = problem.weights;
  const used = (rows: Iterable<GenPlacement>, id: (p: GenPlacement) => string | null): Map<string, Set<number>> => {
    const map = new Map<string, Set<number>>();
    const add = (idv: string, wd: number, period: number): void => {
      const k = `${idv}|${wd}`;
      const set = map.get(k) ?? new Set<number>();
      set.add(period);
      map.set(k, set);
    };
    for (const p of rows) {
      const idv = id(p);
      if (idv === null) continue;
      for (let i = 0; i < p.periods; i++) add(idv, p.weekday, p.startPeriod + i);
    }
    return map;
  };
  // Les classes / enseignants uniquement occupés par du fixe comptent aussi (coût de leurs trous).
  const withFixedOnly = (map: Map<string, Set<number>>, field: "classroomId" | "teacherId"): Map<string, Set<number>> => {
    for (const f of problem.fixed) {
      const idv = f[field];
      if (!idv || !problem.weekdays.includes(f.weekday)) continue;
      const k = `${idv}|${f.weekday}`;
      const set = map.get(k) ?? new Set<number>();
      for (let i = 0; i < f.periods; i++) set.add(f.startPeriod + i);
      map.set(k, set);
    }
    return map;
  };
  const classDays = withFixedOnly(used(placements, (p) => p.classroomId), "classroomId");
  const teacherDays = withFixedOnly(used(placements, (p) => p.teacherId), "teacherId");
  const gapOf = (set: Set<number>): number => {
    if (set.size === 0) return 0;
    const lo = Math.min(...set);
    const hi = Math.max(...set);
    return hi - lo + 1 - set.size;
  };
  let gap = 0;
  let balance = 0;
  for (const set of classDays.values()) {
    gap += w.gap * gapOf(set);
    balance += w.balance * set.size * set.size;
  }
  let teacherGap = 0;
  for (const set of teacherDays.values()) teacherGap += w.teacherGap * gapOf(set);

  const perReqDay = new Map<string, number>();
  const reqTeachers = new Map<string, Set<string>>();
  let preference = 0;
  const teacherById = new Map(problem.teachers.map((t) => [t.id, t]));
  const reqById = new Map(problem.requirements.map((r) => [r.id, r]));
  for (const p of placements) {
    const k = `${p.requirementId}|${p.weekday}`;
    perReqDay.set(k, (perReqDay.get(k) ?? 0) + 1);
    if (p.teacherId) {
      const set = reqTeachers.get(p.requirementId) ?? new Set<string>();
      set.add(p.teacherId);
      reqTeachers.set(p.requirementId, set);
      const t = teacherById.get(p.teacherId)!;
      const avoid = new Set(t.avoid.map((s) => key(s.weekday, s.period)));
      const prefer = new Set(t.prefer.map((s) => key(s.weekday, s.period)));
      for (let i = 0; i < p.periods; i++) {
        const kk = key(p.weekday, p.startPeriod + i);
        if (avoid.has(kk)) preference += w.preference;
        if (prefer.size > 0 && !prefer.has(kk)) preference += Math.ceil(w.preference / 2);
      }
    }
    const r = reqById.get(p.requirementId)!;
    if (r.preferredPeriods.length > 0 && !r.preferredPeriods.includes(p.startPeriod)) preference += w.preference;
  }
  let spread = 0;
  for (const n of perReqDay.values()) if (n > 1) spread += w.spread * (n - 1);
  let teacherChange = 0;
  for (const set of reqTeachers.values()) if (set.size > 1) teacherChange += w.teacherChange * (set.size - 1);
  return { gap, teacherGap, spread, balance, preference, teacherChange, total: gap + teacherGap + spread + balance + preference + teacherChange };
}
