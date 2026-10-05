/**
 * Moteur du générateur d'emploi du temps : construction gloutonne (les besoins les plus contraints d'abord) puis
 * amélioration locale par recuit simulé (déplacements, échanges, insertion avec éjection d'une séance bloquante).
 *
 * DÉTERMINISME. Toute l'aléa vient de `createRng(seed)` ; l'ordre de parcours est fixé par les indices ; aucune
 * itération sur un ensemble non ordonné. Mêmes entrées + même graine + même budget d'itérations ⇒ même sortie.
 * La limite de temps est un filet de sécurité : si elle coupe l'amélioration avant la fin du budget d'itérations,
 * la sortie dépend de la vitesse de la machine (le rapport l'indique : `stoppedBy = TIME_LIMIT`).
 *
 * CONTRAINTES DURES (jamais violées) : une classe, un enseignant ou une salle ne sont jamais à deux endroits au même
 * moment ; case fermée (établissement, classe, salle), indisponibilité de l'enseignant, plafonds de périodes de
 * l'enseignant, plafond de séances d'un besoin par jour, séance sur périodes consécutives, salle du type, de
 * l'équipement et de la capacité demandés. Ce qui ne peut pas être placé reste « non placé » avec ses causes.
 */
import { compareRoomFit } from "../suggest";
import { createRng, type Rng } from "./prng";
import {
  GenProblemError,
  UNPLACED_PENALTY,
  type GenFixedPlacement,
  type GenPlacement,
  type GenProblem,
  type GenResult,
  type GenScoreBreakdown,
  type GenUnplaced,
  type SlotRef,
  type UnplacedReason,
} from "./types";

export interface GenOptions {
  /** Horloge injectable (millisecondes) pour la limite de temps ; défaut `Date.now`. */
  readonly now?: () => number;
}

const REASON_ORDER: readonly UnplacedReason[] = [
  "NO_CONTIGUOUS_PERIODS",
  "SLOT_CLOSED",
  "CLASS_BUSY",
  "REQUIREMENT_DAY_CAP",
  "TEACHER_UNAVAILABLE",
  "TEACHER_BUSY",
  "TEACHER_LIMIT",
  "NO_ROOM_CANDIDATE",
  "ROOM_BUSY",
  "CLASS_OVERLOADED",
];
const R = {
  NONE: -1,
  NO_CONTIGUOUS_PERIODS: 0,
  SLOT_CLOSED: 1,
  CLASS_BUSY: 2,
  REQUIREMENT_DAY_CAP: 3,
  TEACHER_UNAVAILABLE: 4,
  TEACHER_BUSY: 5,
  TEACHER_LIMIT: 6,
  NO_ROOM_CANDIDATE: 7,
  ROOM_BUSY: 8,
} as const;

const FIXED = -1;
const MAX_EJECT_PER_ROUND = 25;

// ---------------------------------------------------------------------------
// Validation du problème
// ---------------------------------------------------------------------------

function fail(message: string, code: string, path?: string): never {
  throw new GenProblemError(message, code, path);
}

export function validateProblem(p: GenProblem): void {
  if (p.weekdays.length === 0) fail("Aucun jour ouvré.", "weekdays_required", "weekdays");
  if (new Set(p.weekdays).size !== p.weekdays.length || p.weekdays.some((d) => !Number.isInteger(d) || d < 1 || d > 7)) fail("Jours ouvrés invalides (ISO 1..7, sans doublon).", "weekdays_invalid", "weekdays");
  if (p.periods.length === 0) fail("Aucune période d'enseignement.", "periods_required", "periods");
  let prevEnd = -1;
  for (const [i, per] of p.periods.entries()) {
    if (!Number.isInteger(per.startMinute) || !Number.isInteger(per.endMinute) || per.startMinute < 0 || per.endMinute > 1440 || per.endMinute <= per.startMinute) fail(`Période ${i + 1} invalide.`, "period_invalid", `periods.${i}`);
    if (per.startMinute < prevEnd) fail(`Les périodes se chevauchent ou ne sont pas ordonnées (période ${i + 1}).`, "periods_overlap", `periods.${i}`);
    prevEnd = per.endMinute;
  }
  const checkRef = (ref: SlotRef, path: string): void => {
    if (!p.weekdays.includes(ref.weekday)) return; // jour hors semaine type : sans objet
    if (!Number.isInteger(ref.period) || ref.period < 0 || ref.period >= p.periods.length) fail("Référence de période hors de la grille.", "slot_invalid", path);
  };
  for (const [i, s] of p.closed.entries()) checkRef(s, `closed.${i}`);
  const unique = (ids: readonly string[], what: string): void => {
    if (new Set(ids).size !== ids.length) fail(`Identifiants ${what} en double.`, "duplicate_id", what);
  };
  unique(p.classes.map((c) => c.id), "classes");
  unique(p.teachers.map((t) => t.id), "teachers");
  unique(p.rooms.map((r) => r.id), "rooms");
  unique(p.requirements.map((r) => r.id), "requirements");
  for (const c of p.classes) c.closed.forEach((s, i) => checkRef(s, `classes.${c.id}.closed.${i}`));
  for (const t of p.teachers) {
    for (const [key, list] of [["unavailable", t.unavailable], ["avoid", t.avoid], ["prefer", t.prefer]] as const) list.forEach((s, i) => checkRef(s, `teachers.${t.id}.${key}.${i}`));
    for (const lim of [t.maxPeriodsPerDay, t.maxPeriodsPerWeek]) if (lim !== null && (!Number.isInteger(lim) || lim < 0)) fail("Plafond de périodes invalide.", "limit_invalid", `teachers.${t.id}`);
  }
  for (const r of p.rooms) r.closed.forEach((s, i) => checkRef(s, `rooms.${r.id}.closed.${i}`));
  const classIds = new Set(p.classes.map((c) => c.id));
  const teacherIds = new Set(p.teachers.map((t) => t.id));
  const roomIds = new Set(p.rooms.map((r) => r.id));
  for (const r of p.requirements) {
    if (!classIds.has(r.classroomId)) fail(`Classe inconnue pour le besoin « ${r.label} ».`, "class_unknown", `requirements.${r.id}`);
    if (!Number.isInteger(r.sessionsPerWeek) || r.sessionsPerWeek < 1 || r.sessionsPerWeek > 100) fail(`Le nombre de séances par semaine de « ${r.label} » va de 1 à 100.`, "sessions_invalid", `requirements.${r.id}`);
    if (!Number.isInteger(r.sessionPeriods) || r.sessionPeriods < 1 || r.sessionPeriods > p.periods.length) fail(`La durée de « ${r.label} » (en périodes) doit tenir dans une journée.`, "session_periods_invalid", `requirements.${r.id}`);
    if (new Set(r.teacherIds).size !== r.teacherIds.length) fail(`Enseignant en double pour « ${r.label} ».`, "teacher_duplicate", `requirements.${r.id}`);
    for (const t of r.teacherIds) if (!teacherIds.has(t)) fail(`Enseignant inconnu pour le besoin « ${r.label} ».`, "teacher_unknown", `requirements.${r.id}`);
    if (r.roomId && !roomIds.has(r.roomId)) fail(`Salle inconnue pour le besoin « ${r.label} ».`, "room_unknown", `requirements.${r.id}`);
    if (r.maxPerDay !== null && (!Number.isInteger(r.maxPerDay) || r.maxPerDay < 1)) fail("Le plafond de séances par jour doit être ≥ 1.", "max_per_day_invalid", `requirements.${r.id}`);
    for (const per of r.preferredPeriods) if (!Number.isInteger(per) || per < 0 || per >= p.periods.length) fail("Période préférée hors de la grille.", "slot_invalid", `requirements.${r.id}`);
  }
  for (const [i, f] of p.fixed.entries()) {
    if (!p.weekdays.includes(f.weekday)) continue;
    if (f.startPeriod < 0 || f.periods < 1 || f.startPeriod + f.periods > p.periods.length) fail("Occupation fixe hors de la grille.", "fixed_invalid", `fixed.${i}`);
  }
  for (const [k, v] of Object.entries(p.weights)) if (!Number.isInteger(v) || v < 0) fail(`Pondération « ${k} » invalide (entier ≥ 0).`, "weight_invalid", `weights.${k}`);
  if (!Number.isInteger(p.maxIterations) || p.maxIterations < 0) fail("Budget d'itérations invalide.", "iterations_invalid", "maxIterations");
  if (!Number.isFinite(p.timeLimitMs) || p.timeLimitMs < 0) fail("Limite de temps invalide.", "time_limit_invalid", "timeLimitMs");
}

// ---------------------------------------------------------------------------
// Moteur
// ---------------------------------------------------------------------------

class Engine {
  readonly D: number;
  readonly P: number;
  readonly S: number;
  readonly nC: number;
  readonly nT: number;
  readonly nR: number;
  readonly nReq: number;
  readonly nS: number;

  readonly classIdx = new Map<string, number>();
  readonly teacherIdx = new Map<string, number>();
  readonly roomIdx = new Map<string, number>();
  readonly dayIdx = new Map<number, number>();

  // statique
  readonly closedAll: Uint8Array;
  readonly classClosed: Uint8Array;
  readonly teacherUnavail: Uint8Array;
  readonly teacherAvoid: Uint8Array;
  readonly teacherPrefer: Uint8Array;
  readonly teacherHasPrefer: Uint8Array;
  readonly teacherMaxDay: Int32Array;
  readonly teacherMaxWeek: Int32Array;
  readonly roomClosed: Uint8Array;
  readonly runOk: boolean[][]; // runOk[len][start]
  readonly reqClass: Int32Array;
  readonly reqLen: Int32Array;
  readonly reqCap: Int32Array;
  readonly reqTeachers: number[][];
  readonly reqRooms: number[][]; // salles candidates (triées)
  readonly reqRoomMode: Uint8Array; // 0 : aucune salle requise ; 1 : requise
  readonly reqPref: Array<Uint8Array | null>;
  readonly reqSessions: number[][];
  readonly sReq: Int32Array;
  readonly sIdx: Int32Array;

  // dynamique
  readonly classBusy: Int32Array;
  readonly teacherBusy: Int32Array;
  readonly roomBusy: Int32Array;
  readonly reqDay: Int32Array;
  readonly tDayLoad: Int32Array;
  readonly tWeekLoad: Int32Array;
  readonly pDay: Int32Array;
  readonly pStart: Int32Array;
  readonly pTeacher: Int32Array;
  readonly pRoom: Int32Array;

  readonly rng: Rng;
  lastRoom = -1;
  noRooms = false;
  readonly warnings: Array<{ code: string; requirementId?: string; message: string }> = [];

  constructor(readonly p: GenProblem) {
    this.D = p.weekdays.length;
    this.P = p.periods.length;
    this.S = this.D * this.P;
    this.nC = p.classes.length;
    this.nT = p.teachers.length;
    this.nR = p.rooms.length;
    this.nReq = p.requirements.length;
    p.weekdays.forEach((d, i) => this.dayIdx.set(d, i));
    p.classes.forEach((c, i) => this.classIdx.set(c.id, i));
    p.teachers.forEach((t, i) => this.teacherIdx.set(t.id, i));
    p.rooms.forEach((r, i) => this.roomIdx.set(r.id, i));
    this.rng = createRng(p.seed);
    const { S, D, P } = this;

    this.closedAll = new Uint8Array(S);
    for (const s of p.closed) this.mark(this.closedAll, 0, s);
    this.classClosed = new Uint8Array(this.nC * S);
    p.classes.forEach((c, i) => c.closed.forEach((s) => this.mark(this.classClosed, i * S, s)));
    this.teacherUnavail = new Uint8Array(this.nT * S);
    this.teacherAvoid = new Uint8Array(this.nT * S);
    this.teacherPrefer = new Uint8Array(this.nT * S);
    this.teacherHasPrefer = new Uint8Array(this.nT);
    this.teacherMaxDay = new Int32Array(this.nT).fill(-1);
    this.teacherMaxWeek = new Int32Array(this.nT).fill(-1);
    p.teachers.forEach((t, i) => {
      t.unavailable.forEach((s) => this.mark(this.teacherUnavail, i * S, s));
      t.avoid.forEach((s) => this.mark(this.teacherAvoid, i * S, s));
      t.prefer.forEach((s) => this.mark(this.teacherPrefer, i * S, s));
      this.teacherHasPrefer[i] = t.prefer.length > 0 ? 1 : 0;
      if (t.maxPeriodsPerDay !== null) this.teacherMaxDay[i] = t.maxPeriodsPerDay;
      if (t.maxPeriodsPerWeek !== null) this.teacherMaxWeek[i] = t.maxPeriodsPerWeek;
    });
    this.roomClosed = new Uint8Array(this.nR * S);
    p.rooms.forEach((r, i) => r.closed.forEach((s) => this.mark(this.roomClosed, i * S, s)));

    // Périodes consécutives : deux périodes voisines sont contiguës si l'une finit quand l'autre commence (pas de pause).
    const contiguous = (i: number): boolean => p.periods[i]!.endMinute === p.periods[i + 1]!.startMinute;
    this.runOk = [];
    for (let len = 0; len <= P; len++) {
      const row: boolean[] = new Array<boolean>(P).fill(false);
      for (let st = 0; st + len <= P && len >= 1; st++) {
        let ok = true;
        for (let k = 0; k < len - 1; k++) if (!contiguous(st + k)) ok = false;
        row[st] = ok;
      }
      this.runOk.push(row);
    }

    this.reqClass = new Int32Array(this.nReq);
    this.reqLen = new Int32Array(this.nReq);
    this.reqCap = new Int32Array(this.nReq);
    this.reqTeachers = [];
    this.reqRooms = [];
    this.reqRoomMode = new Uint8Array(this.nReq);
    this.reqPref = [];
    this.reqSessions = [];
    this.noRooms = this.nR === 0;
    if (this.noRooms && p.requirements.some((r) => r.needsRoom)) this.warnings.push({ code: "NO_ROOMS_DEFINED", message: "Aucune salle n'est définie : les séances sont placées sans salle." });
    const sReq: number[] = [];
    const sIdx: number[] = [];
    p.requirements.forEach((r, ri) => {
      this.reqClass[ri] = this.classIdx.get(r.classroomId)!;
      this.reqLen[ri] = r.sessionPeriods;
      this.reqCap[ri] = r.maxPerDay ?? Math.max(1, Math.ceil(r.sessionsPerWeek / D));
      this.reqTeachers.push(r.teacherIds.map((t) => this.teacherIdx.get(t)!));
      if (r.teacherIds.length === 0) this.warnings.push({ code: "NO_TEACHER", requirementId: r.id, message: `Aucun enseignant candidat pour « ${r.label} » : les séances sont placées sans enseignant.` });
      const needs = r.needsRoom && !this.noRooms;
      this.reqRoomMode[ri] = needs ? 1 : 0;
      this.reqRooms.push(needs ? this.candidateRooms(ri) : []);
      this.reqPref.push(r.preferredPeriods.length > 0 ? this.prefMask(r.preferredPeriods) : null);
      this.reqSessions.push([]);
      for (let k = 0; k < r.sessionsPerWeek; k++) {
        this.reqSessions[ri]!.push(sReq.length);
        sReq.push(ri);
        sIdx.push(k);
      }
    });
    this.nS = sReq.length;
    this.sReq = Int32Array.from(sReq);
    this.sIdx = Int32Array.from(sIdx);

    this.classBusy = new Int32Array(this.nC * S);
    this.teacherBusy = new Int32Array(this.nT * S);
    this.roomBusy = new Int32Array(this.nR * S);
    this.reqDay = new Int32Array(this.nReq * D);
    this.tDayLoad = new Int32Array(this.nT * D);
    this.tWeekLoad = new Int32Array(this.nT);
    this.pDay = new Int32Array(this.nS).fill(-1);
    this.pStart = new Int32Array(this.nS);
    this.pTeacher = new Int32Array(this.nS).fill(-1);
    this.pRoom = new Int32Array(this.nS).fill(-1);
    this.applyFixed(p.fixed);
  }

  private mark(arr: Uint8Array, base: number, ref: SlotRef): void {
    const d = this.dayIdx.get(ref.weekday);
    if (d === undefined) return;
    arr[base + d * this.P + ref.period] = 1;
  }

  private prefMask(periods: readonly number[]): Uint8Array {
    const m = new Uint8Array(this.P);
    for (const x of periods) m[x] = 1;
    return m;
  }

  private candidateRooms(ri: number): number[] {
    const r = this.p.requirements[ri]!;
    if (r.roomId) return [this.roomIdx.get(r.roomId)!];
    const headcount = this.p.classes[this.reqClass[ri]!]!.headcount;
    const list: number[] = [];
    this.p.rooms.forEach((room, i) => {
      if (r.roomTypeCode && room.roomTypeCode !== r.roomTypeCode) return;
      if (!r.requiredFeatures.every((f) => room.features.includes(f))) return;
      if (headcount !== null && room.capacity !== null && room.capacity < headcount) return;
      list.push(i);
    });
    // La plus petite salle suffisante d'abord (comme l'aide au placement `suggestSlots`), puis le code.
    list.sort((a, b) => {
      const ra = this.p.rooms[a]!;
      const rb = this.p.rooms[b]!;
      return compareRoomFit(ra, rb) || a - b;
    });
    return list;
  }

  private applyFixed(fixed: readonly GenFixedPlacement[]): void {
    const { P, S } = this;
    for (const f of fixed) {
      const d = this.dayIdx.get(f.weekday);
      if (d === undefined) continue;
      const c = f.classroomId ? this.classIdx.get(f.classroomId) : undefined;
      const t = f.teacherId ? this.teacherIdx.get(f.teacherId) : undefined;
      const rm = f.roomId ? this.roomIdx.get(f.roomId) : undefined;
      for (let i = 0; i < f.periods; i++) {
        const slot = d * P + f.startPeriod + i;
        if (c !== undefined) this.classBusy[c * S + slot] = FIXED;
        if (t !== undefined) {
          this.teacherBusy[t * S + slot] = FIXED;
          this.tDayLoad[t * this.D + d] = (this.tDayLoad[t * this.D + d] ?? 0) + 1;
          this.tWeekLoad[t] = (this.tWeekLoad[t] ?? 0) + 1;
        }
        if (rm !== undefined) this.roomBusy[rm * S + slot] = FIXED;
      }
    }
  }

  // ----- pose / retrait ----------------------------------------------------

  place(s: number, d: number, st: number, t: number, room: number): void {
    const { P, S, D } = this;
    const ri = this.sReq[s]!;
    const c = this.reqClass[ri]!;
    const len = this.reqLen[ri]!;
    const base = d * P + st;
    for (let i = 0; i < len; i++) {
      this.classBusy[c * S + base + i] = s + 1;
      if (t >= 0) this.teacherBusy[t * S + base + i] = s + 1;
      if (room >= 0) this.roomBusy[room * S + base + i] = s + 1;
    }
    if (t >= 0) {
      this.tDayLoad[t * D + d] = (this.tDayLoad[t * D + d] ?? 0) + len;
      this.tWeekLoad[t] = (this.tWeekLoad[t] ?? 0) + len;
    }
    this.reqDay[ri * D + d] = (this.reqDay[ri * D + d] ?? 0) + 1;
    this.pDay[s] = d;
    this.pStart[s] = st;
    this.pTeacher[s] = t;
    this.pRoom[s] = room;
  }

  unplace(s: number): void {
    const d = this.pDay[s]!;
    if (d < 0) return;
    const { P, S, D } = this;
    const ri = this.sReq[s]!;
    const c = this.reqClass[ri]!;
    const len = this.reqLen[ri]!;
    const st = this.pStart[s]!;
    const t = this.pTeacher[s]!;
    const room = this.pRoom[s]!;
    const base = d * P + st;
    for (let i = 0; i < len; i++) {
      this.classBusy[c * S + base + i] = 0;
      if (t >= 0) this.teacherBusy[t * S + base + i] = 0;
      if (room >= 0) this.roomBusy[room * S + base + i] = 0;
    }
    if (t >= 0) {
      this.tDayLoad[t * D + d] = (this.tDayLoad[t * D + d] ?? 0) - len;
      this.tWeekLoad[t] = (this.tWeekLoad[t] ?? 0) - len;
    }
    this.reqDay[ri * D + d] = (this.reqDay[ri * D + d] ?? 0) - 1;
    this.pDay[s] = -1;
    this.pTeacher[s] = -1;
    this.pRoom[s] = -1;
  }

  // ----- faisabilité ---------------------------------------------------------

  /** Salle libre pour la séance sur `[st, st+len)` du jour `d` : index, `-1` (aucune requise), `-2` (toutes occupées), `-3` (aucune candidate). */
  roomFor(ri: number, d: number, st: number): number {
    if (this.reqRoomMode[ri] === 0) return -1;
    const cand = this.reqRooms[ri]!;
    if (cand.length === 0) return -3;
    const len = this.reqLen[ri]!;
    const base = d * this.P + st;
    for (const room of cand) {
      let free = true;
      for (let i = 0; i < len; i++) {
        if (this.roomBusy[room * this.S + base + i] !== 0 || this.roomClosed[room * this.S + base + i] !== 0) {
          free = false;
          break;
        }
      }
      if (free) return room;
    }
    return -2;
  }

  /** Cause du refus (index de `R`) ou `-1` si l'option est faisable ; fixe `lastRoom`. */
  reason(s: number, d: number, st: number, t: number): number {
    const ri = this.sReq[s]!;
    const len = this.reqLen[ri]!;
    if (!this.runOk[len]![st]) return R.NO_CONTIGUOUS_PERIODS;
    const { P, S, D } = this;
    const c = this.reqClass[ri]!;
    const base = d * P + st;
    for (let i = 0; i < len; i++) if (this.closedAll[base + i] !== 0 || this.classClosed[c * S + base + i] !== 0) return R.SLOT_CLOSED;
    for (let i = 0; i < len; i++) if (this.classBusy[c * S + base + i] !== 0) return R.CLASS_BUSY;
    if ((this.reqDay[ri * D + d] ?? 0) >= this.reqCap[ri]!) return R.REQUIREMENT_DAY_CAP;
    if (t >= 0) {
      for (let i = 0; i < len; i++) if (this.teacherUnavail[t * S + base + i] !== 0) return R.TEACHER_UNAVAILABLE;
      for (let i = 0; i < len; i++) if (this.teacherBusy[t * S + base + i] !== 0) return R.TEACHER_BUSY;
      const md = this.teacherMaxDay[t]!;
      if (md >= 0 && (this.tDayLoad[t * D + d] ?? 0) + len > md) return R.TEACHER_LIMIT;
      const mw = this.teacherMaxWeek[t]!;
      if (mw >= 0 && (this.tWeekLoad[t] ?? 0) + len > mw) return R.TEACHER_LIMIT;
    }
    const room = this.roomFor(ri, d, st);
    if (room === -3) return R.NO_ROOM_CANDIDATE;
    if (room === -2) return R.ROOM_BUSY;
    this.lastRoom = room;
    return R.NONE;
  }

  // ----- coûts ----------------------------------------------------------------

  private gapOf(arr: Int32Array, base: number): number {
    let first = -1;
    let last = -1;
    let used = 0;
    for (let p = 0; p < this.P; p++) {
      if (arr[base + p] !== 0) {
        if (first < 0) first = p;
        last = p;
        used++;
      }
    }
    return first < 0 ? 0 : last - first + 1 - used;
  }

  private loadOf(arr: Int32Array, base: number): number {
    let used = 0;
    for (let p = 0; p < this.P; p++) if (arr[base + p] !== 0) used++;
    return used;
  }

  classDayParts(c: number, d: number): { gap: number; balance: number } {
    const base = c * this.S + d * this.P;
    const load = this.loadOf(this.classBusy, base);
    return { gap: this.p.weights.gap * this.gapOf(this.classBusy, base), balance: this.p.weights.balance * load * load };
  }

  teacherDayCost(t: number, d: number): number {
    return this.p.weights.teacherGap * this.gapOf(this.teacherBusy, t * this.S + d * this.P);
  }

  reqDayCost(ri: number, d: number): number {
    const n = this.reqDay[ri * this.D + d]!;
    return n > 1 ? this.p.weights.spread * (n - 1) : 0;
  }

  reqTeacherCost(ri: number): number {
    let first = -2;
    let distinct = 0;
    const seen: number[] = [];
    for (const s of this.reqSessions[ri]!) {
      if (this.pDay[s]! < 0) continue;
      const t = this.pTeacher[s]!;
      if (t < 0) continue;
      if (!seen.includes(t)) {
        seen.push(t);
        distinct++;
      }
      if (first === -2) first = t;
    }
    return distinct > 1 ? this.p.weights.teacherChange * (distinct - 1) : 0;
  }

  prefCost(s: number, d: number, st: number, t: number): number {
    const ri = this.sReq[s]!;
    const len = this.reqLen[ri]!;
    const w = this.p.weights.preference;
    if (w === 0) return 0;
    let cost = 0;
    if (t >= 0) {
      const base = t * this.S + d * this.P + st;
      const half = Math.ceil(w / 2);
      for (let i = 0; i < len; i++) {
        if (this.teacherAvoid[base + i] !== 0) cost += w;
        if (this.teacherHasPrefer[t] !== 0 && this.teacherPrefer[base + i] === 0) cost += half;
      }
    }
    const mask = this.reqPref[ri];
    if (mask && mask[st] === 0) cost += w;
    return cost;
  }

  private static kClassDay = 0;
  private static kTeacherDay = 1;
  private static kReqDay = 2;
  private static kReqTeacher = 3;
  private static key(kind: number, a: number, d: number): number {
    return (kind * 1_000_000 + a) * 8 + d;
  }

  keysFor(s: number, d: number, t: number, out: number[]): void {
    const ri = this.sReq[s]!;
    const add = (k: number): void => {
      if (!out.includes(k)) out.push(k);
    };
    add(Engine.key(Engine.kClassDay, this.reqClass[ri]!, d));
    if (t >= 0) add(Engine.key(Engine.kTeacherDay, t, d));
    add(Engine.key(Engine.kReqDay, ri, d));
    add(Engine.key(Engine.kReqTeacher, ri, 0));
  }

  keyCost(k: number): number {
    const d = k % 8;
    const rest = (k - d) / 8;
    const a = rest % 1_000_000;
    const kind = Math.floor(rest / 1_000_000);
    switch (kind) {
      case Engine.kClassDay: {
        const parts = this.classDayParts(a, d);
        return parts.gap + parts.balance;
      }
      case Engine.kTeacherDay:
        return this.teacherDayCost(a, d);
      case Engine.kReqDay:
        return this.reqDayCost(a, d);
      default:
        return this.reqTeacherCost(a);
    }
  }

  sumKeys(keys: readonly number[]): number {
    let total = 0;
    for (const k of keys) total += this.keyCost(k);
    return total;
  }

  /** Coût souple total, recalculé de zéro (état courant). */
  breakdown(): GenScoreBreakdown {
    let gap = 0;
    let teacherGap = 0;
    let spread = 0;
    let balance = 0;
    let preference = 0;
    let teacherChange = 0;
    for (let c = 0; c < this.nC; c++) {
      for (let d = 0; d < this.D; d++) {
        const parts = this.classDayParts(c, d);
        gap += parts.gap;
        balance += parts.balance;
      }
    }
    for (let t = 0; t < this.nT; t++) for (let d = 0; d < this.D; d++) teacherGap += this.teacherDayCost(t, d);
    for (let r = 0; r < this.nReq; r++) {
      for (let d = 0; d < this.D; d++) spread += this.reqDayCost(r, d);
      teacherChange += this.reqTeacherCost(r);
    }
    for (let s = 0; s < this.nS; s++) if (this.pDay[s]! >= 0) preference += this.prefCost(s, this.pDay[s]!, this.pStart[s]!, this.pTeacher[s]!);
    return { gap, teacherGap, spread, balance, preference, teacherChange };
  }

  totalSoft(): number {
    const b = this.breakdown();
    return b.gap + b.teacherGap + b.spread + b.balance + b.preference + b.teacherChange;
  }

  /** Coût marginal de la pose (état sans la séance), sans modifier l'état. */
  marginal(s: number, d: number, st: number, t: number, room: number): number {
    const keys: number[] = [];
    this.keysFor(s, d, t, keys);
    const before = this.sumKeys(keys);
    this.place(s, d, st, t, room);
    const after = this.sumKeys(keys);
    this.unplace(s);
    return after - before + this.prefCost(s, d, st, t);
  }

  // ----- recherche d'une position ----------------------------------------------

  private teacherCandidates(s: number): number[] {
    const list = this.reqTeachers[this.sReq[s]!]!;
    return list.length === 0 ? [-1] : list;
  }

  /** Meilleure option faisable (coût marginal minimal, égalités tirées au sort). */
  findBest(s: number): { d: number; st: number; t: number; room: number; cost: number } | null {
    let best: { d: number; st: number; t: number; room: number; cost: number } | null = null;
    let ties = 0;
    const cands = this.teacherCandidates(s);
    for (let d = 0; d < this.D; d++) {
      for (let st = 0; st < this.P; st++) {
        for (const t of cands) {
          if (this.reason(s, d, st, t) !== R.NONE) continue;
          const room = this.lastRoom;
          const cost = this.marginal(s, d, st, t, room);
          if (best === null || cost < best.cost) {
            best = { d, st, t, room, cost };
            ties = 1;
          } else if (cost === best.cost) {
            ties++;
            if (this.rng.int(ties) === 0) best = { d, st, t, room, cost };
          }
        }
      }
    }
    return best;
  }

  /** Éjection de profondeur 1 : déloge une séance qui bloque, place `u`, puis replace la séance délogée ailleurs. */
  tryEject(u: number): boolean {
    const ri = this.sReq[u]!;
    const len = this.reqLen[ri]!;
    const c = this.reqClass[ri]!;
    const { P, S } = this;
    for (let d = 0; d < this.D; d++) {
      for (let st = 0; st < P; st++) {
        if (!this.runOk[len]![st]) continue;
        for (const t of this.teacherCandidates(u)) {
          const base = d * P + st;
          let skip = false;
          let blocker = -1;
          let multiple = false;
          for (let i = 0; i < len && !skip; i++) {
            if (this.closedAll[base + i] !== 0 || this.classClosed[c * S + base + i] !== 0) skip = true;
            if (t >= 0 && this.teacherUnavail[t * S + base + i] !== 0) skip = true;
            const vs = [this.classBusy[c * S + base + i]!, t >= 0 ? this.teacherBusy[t * S + base + i]! : 0];
            for (const v of vs) {
              if (v < 0) skip = true;
              else if (v > 0) {
                if (blocker >= 0 && blocker !== v - 1) multiple = true;
                blocker = v - 1;
              }
            }
          }
          if (skip || multiple || blocker < 0) continue;
          const v = blocker;
          const old = { d: this.pDay[v]!, st: this.pStart[v]!, t: this.pTeacher[v]!, room: this.pRoom[v]! };
          this.unplace(v);
          if (this.reason(u, d, st, t) !== R.NONE) {
            this.place(v, old.d, old.st, old.t, old.room);
            continue;
          }
          this.place(u, d, st, t, this.lastRoom);
          const relocated = this.findBest(v);
          if (relocated) {
            this.place(v, relocated.d, relocated.st, relocated.t, relocated.room);
            return true;
          }
          this.unplace(u);
          this.place(v, old.d, old.st, old.t, old.room);
        }
      }
    }
    return false;
  }

  // ----- diagnostic des séances non placées -----------------------------------------

  explain(s: number): Array<{ code: UnplacedReason; count: number; detail?: string }> {
    const ri = this.sReq[s]!;
    const counts = new Array<number>(REASON_ORDER.length).fill(0);
    const cands = this.teacherCandidates(s);
    for (let d = 0; d < this.D; d++) {
      for (let st = 0; st < this.P; st++) {
        let first = -2;
        let ok = false;
        for (const t of cands) {
          const r = this.reason(s, d, st, t);
          if (r === R.NONE) {
            ok = true;
            break;
          }
          if (first === -2) first = r;
          // Un autre enseignant candidat peut ne buter que sur la salle : la cause est alors la salle.
          if (r >= R.NO_ROOM_CANDIDATE) {
            first = r;
            break;
          }
        }
        if (!ok && first >= 0) counts[first] = (counts[first] ?? 0) + 1;
      }
    }
    const out: Array<{ code: UnplacedReason; count: number; detail?: string }> = [];
    REASON_ORDER.forEach((code, i) => {
      if ((counts[i] ?? 0) > 0) out.push({ code, count: counts[i]! });
    });
    // Surcharge structurelle de la classe : plus de périodes demandées que de cases utilisables.
    const c = this.reqClass[ri]!;
    let demanded = 0;
    for (const r2 of this.p.requirements) if (this.classIdx.get(r2.classroomId) === c) demanded += r2.sessionsPerWeek * r2.sessionPeriods;
    let usable = 0;
    for (let slot = 0; slot < this.S; slot++) if (this.closedAll[slot] === 0 && this.classClosed[c * this.S + slot] === 0 && this.classBusy[c * this.S + slot] !== FIXED) usable++;
    if (demanded > usable) out.unshift({ code: "CLASS_OVERLOADED", count: demanded - usable, detail: `${demanded} périodes demandées pour ${usable} utilisables par semaine` });
    out.sort((a, b) => (a.code === "CLASS_OVERLOADED" ? -1 : b.code === "CLASS_OVERLOADED" ? 1 : b.count - a.count || REASON_ORDER.indexOf(a.code) - REASON_ORDER.indexOf(b.code)));
    if (out.length === 0) out.push({ code: "CLASS_BUSY", count: 0 });
    return out;
  }
}

// ---------------------------------------------------------------------------
// Point d'entrée
// ---------------------------------------------------------------------------

export function generateTimetable(problem: GenProblem, options: GenOptions = {}): GenResult {
  validateProblem(problem);
  const now = options.now ?? Date.now;
  const t0 = now();
  const e = new Engine(problem);
  const { rng } = e;

  // 1. Construction : besoins les plus contraints d'abord.
  const order = Array.from({ length: e.nS }, (_, i) => i);
  const freedom = new Map<number, number>();
  for (let ri = 0; ri < e.nReq; ri++) {
    const len = e.reqLen[ri]!;
    const c = e.reqClass[ri]!;
    const teachers = e.reqTeachers[ri]!;
    let n = 0;
    for (let d = 0; d < e.D; d++) {
      for (let st = 0; st < e.P; st++) {
        if (!e.runOk[len]![st]) continue;
        let free = true;
        for (let i = 0; i < len; i++) {
          const slot = d * e.P + st + i;
          if (e.closedAll[slot] !== 0 || e.classClosed[c * e.S + slot] !== 0) free = false;
        }
        if (!free) continue;
        if (teachers.length > 0 && !teachers.some((t) => Array.from({ length: len }, (_, i) => e.teacherUnavail[t * e.S + d * e.P + st + i]).every((x) => x === 0))) continue;
        n++;
      }
    }
    freedom.set(ri, n);
  }
  order.sort((a, b) => {
    const ra = e.sReq[a]!;
    const rb = e.sReq[b]!;
    return (
      freedom.get(ra)! - freedom.get(rb)! ||
      e.reqLen[rb]! - e.reqLen[ra]! ||
      e.reqRooms[ra]!.length - e.reqRooms[rb]!.length ||
      ra - rb ||
      a - b
    );
  });
  const unplaced: number[] = [];
  let constructionTimedOut = false;
  for (const s of order) {
    // Filet de sécurité : au-delà de la limite de temps, la construction s'arrête (le reste est signalé non placé).
    if (now() - t0 > problem.timeLimitMs) {
      constructionTimedOut = true;
      unplaced.push(s);
      continue;
    }
    const best = e.findBest(s);
    if (best) e.place(s, best.d, best.st, best.t, best.room);
    else unplaced.push(s);
  }
  if (constructionTimedOut) e.warnings.push({ code: "TIME_LIMIT_CONSTRUCTION", message: "La limite de temps a interrompu la construction : des séances n'ont pas été essayées. Augmentez la limite de temps ou réduisez le périmètre." });

  // 2. Réparation : insertion simple puis éjection de profondeur 1.
  const repair = (limit: number): void => {
    let attempts = 0;
    for (let i = 0; i < unplaced.length && attempts < limit; ) {
      const u = unplaced[i]!;
      const best = e.findBest(u);
      if (best) {
        e.place(u, best.d, best.st, best.t, best.room);
        unplaced.splice(i, 1);
        continue;
      }
      attempts++;
      if (e.tryEject(u)) {
        unplaced.splice(i, 1);
        continue;
      }
      i++;
    }
  };
  repair(MAX_EJECT_PER_ROUND);

  let soft = e.totalSoft();
  const initialSoft = soft;
  let objective = unplaced.length * UNPLACED_PENALTY + soft;
  let bestObjective = objective;
  let snapshot = { d: e.pDay.slice(), st: e.pStart.slice(), t: e.pTeacher.slice(), r: e.pRoom.slice(), unplaced: unplaced.slice() };
  const save = (): void => {
    snapshot = { d: e.pDay.slice(), st: e.pStart.slice(), t: e.pTeacher.slice(), r: e.pRoom.slice(), unplaced: unplaced.slice() };
  };

  // 3. Amélioration locale (recuit simulé).
  let accepted = 0;
  let improvements = 0;
  let iterations = 0;
  let stoppedBy: "ITERATIONS" | "TIME_LIMIT" | "NOTHING_TO_IMPROVE" = "ITERATIONS";
  const placedCount = (): number => e.nS - unplaced.length;
  if (e.nS === 0 || problem.maxIterations === 0) stoppedBy = e.nS === 0 ? "NOTHING_TO_IMPROVE" : "ITERATIONS";
  const T0 = 3;
  const T1 = 0.05;
  const keys: number[] = [];
  for (let it = 0; it < problem.maxIterations && e.nS > 0; it++) {
    if ((it & 255) === 0 && now() - t0 > problem.timeLimitMs) {
      stoppedBy = "TIME_LIMIT";
      break;
    }
    iterations = it + 1;
    const temperature = T0 * Math.pow(T1 / T0, it / Math.max(1, problem.maxIterations));

    if (unplaced.length > 0 && it % 1500 === 1499) {
      const before = unplaced.length;
      repair(MAX_EJECT_PER_ROUND);
      if (unplaced.length !== before) {
        soft = e.totalSoft();
        objective = unplaced.length * UNPLACED_PENALTY + soft;
        if (objective < bestObjective) {
          bestObjective = objective;
          improvements++;
          save();
        }
      }
      continue;
    }
    if (unplaced.length > 0 && it % 97 === 0) {
      const u = unplaced[rng.int(unplaced.length)]!;
      const best = e.findBest(u);
      if (best) {
        e.place(u, best.d, best.st, best.t, best.room);
        unplaced.splice(unplaced.indexOf(u), 1);
        soft += best.cost;
        objective = unplaced.length * UNPLACED_PENALTY + soft;
        if (objective < bestObjective) {
          bestObjective = objective;
          improvements++;
          save();
        }
        continue;
      }
    }
    if (placedCount() === 0) continue;

    const move = rng.next();
    if (move < 0.8) {
      // Déplacement d'une séance.
      const s = rng.int(e.nS);
      if (e.pDay[s]! < 0) continue;
      const cands = e.reqTeachers[e.sReq[s]!]!;
      const d0 = e.pDay[s]!;
      const st0 = e.pStart[s]!;
      const t0_ = e.pTeacher[s]!;
      const r0 = e.pRoom[s]!;
      // Jusqu'à 8 cibles tirées au sort : on retient la première faisable.
      let target: { d: number; st: number; t: number; room: number } | null = null;
      e.unplace(s);
      for (let attempt = 0; attempt < 8 && target === null; attempt++) {
        const d = rng.int(e.D);
        const st = rng.int(e.P);
        const t = cands.length === 0 ? -1 : cands[rng.int(cands.length)]!;
        if (d === d0 && st === st0 && t === t0_) continue;
        if (e.reason(s, d, st, t) === R.NONE) target = { d, st, t, room: e.lastRoom };
      }
      if (target === null) {
        e.place(s, d0, st0, t0_, r0);
        continue;
      }
      const { d, st, t, room } = target;
      e.place(s, d0, st0, t0_, r0);
      keys.length = 0;
      e.keysFor(s, d0, t0_, keys);
      e.keysFor(s, d, t, keys);
      const before = e.sumKeys(keys) + e.prefCost(s, d0, st0, t0_);
      e.unplace(s);
      e.place(s, d, st, t, room);
      const delta = e.sumKeys(keys) + e.prefCost(s, d, st, t) - before;
      if (delta <= 0 || rng.next() < Math.exp(-delta / temperature)) {
        soft += delta;
        accepted++;
      } else {
        e.unplace(s);
        e.place(s, d0, st0, t0_, r0);
        continue;
      }
    } else {
      // Échange de deux séances de même durée.
      const s1 = rng.int(e.nS);
      const s2 = rng.int(e.nS);
      if (s1 === s2 || e.pDay[s1]! < 0 || e.pDay[s2]! < 0 || e.reqLen[e.sReq[s1]!] !== e.reqLen[e.sReq[s2]!]) continue;
      const a = { d: e.pDay[s1]!, st: e.pStart[s1]!, t: e.pTeacher[s1]!, r: e.pRoom[s1]! };
      const b = { d: e.pDay[s2]!, st: e.pStart[s2]!, t: e.pTeacher[s2]!, r: e.pRoom[s2]! };
      if (a.d === b.d && a.st === b.st) continue;
      keys.length = 0;
      e.keysFor(s1, a.d, a.t, keys);
      e.keysFor(s1, b.d, a.t, keys);
      e.keysFor(s2, b.d, b.t, keys);
      e.keysFor(s2, a.d, b.t, keys);
      const before = e.sumKeys(keys) + e.prefCost(s1, a.d, a.st, a.t) + e.prefCost(s2, b.d, b.st, b.t);
      e.unplace(s1);
      e.unplace(s2);
      let ok = e.reason(s1, b.d, b.st, a.t) === R.NONE;
      if (ok) {
        e.place(s1, b.d, b.st, a.t, e.lastRoom);
        ok = e.reason(s2, a.d, a.st, b.t) === R.NONE;
        if (ok) e.place(s2, a.d, a.st, b.t, e.lastRoom);
        else e.unplace(s1);
      }
      if (!ok) {
        e.place(s1, a.d, a.st, a.t, a.r);
        e.place(s2, b.d, b.st, b.t, b.r);
        continue;
      }
      const delta = e.sumKeys(keys) + e.prefCost(s1, b.d, b.st, a.t) + e.prefCost(s2, a.d, a.st, b.t) - before;
      if (delta <= 0 || rng.next() < Math.exp(-delta / temperature)) {
        soft += delta;
        accepted++;
      } else {
        e.unplace(s1);
        e.unplace(s2);
        e.place(s1, a.d, a.st, a.t, a.r);
        e.place(s2, b.d, b.st, b.t, b.r);
        continue;
      }
    }
    objective = unplaced.length * UNPLACED_PENALTY + soft;
    if (objective < bestObjective) {
      bestObjective = objective;
      improvements++;
      save();
    }
  }

  // 4. Retour à la meilleure solution rencontrée.
  for (let s = 0; s < e.nS; s++) e.unplace(s);
  unplaced.length = 0;
  for (let s = 0; s < e.nS; s++) {
    if (snapshot.d[s]! >= 0) e.place(s, snapshot.d[s]!, snapshot.st[s]!, snapshot.t[s]!, snapshot.r[s]!);
    else unplaced.push(s);
  }

  const breakdown = e.breakdown();
  const softCost = breakdown.gap + breakdown.teacherGap + breakdown.spread + breakdown.balance + breakdown.preference + breakdown.teacherChange;

  // 5. Rapport.
  const placements: GenPlacement[] = [];
  for (let s = 0; s < e.nS; s++) {
    if (e.pDay[s]! < 0) continue;
    const ri = e.sReq[s]!;
    const r = problem.requirements[ri]!;
    const st = e.pStart[s]!;
    const len = e.reqLen[ri]!;
    const t = e.pTeacher[s]!;
    const room = e.pRoom[s]!;
    placements.push({
      requirementId: r.id,
      sessionIndex: e.sIdx[s]!,
      classroomId: r.classroomId,
      curriculumNodeId: r.curriculumNodeId,
      offeringId: r.offeringId,
      teacherId: t >= 0 ? problem.teachers[t]!.id : null,
      roomId: room >= 0 ? problem.rooms[room]!.id : null,
      weekday: problem.weekdays[e.pDay[s]!]!,
      startPeriod: st,
      periods: len,
      startMinute: problem.periods[st]!.startMinute,
      endMinute: problem.periods[st + len - 1]!.endMinute,
      timeSlotId: len === 1 ? (problem.periods[st]!.timeSlotId ?? null) : null,
    });
  }
  placements.sort(comparePlacements(problem));

  const byReq = new Map<number, number[]>();
  for (const s of unplaced) {
    const ri = e.sReq[s]!;
    byReq.set(ri, [...(byReq.get(ri) ?? []), s]);
  }
  const unplacedReport: GenUnplaced[] = [];
  for (const ri of [...byReq.keys()].sort((a, b) => a - b)) {
    const sessions = byReq.get(ri)!;
    const r = problem.requirements[ri]!;
    const merged = new Map<UnplacedReason, { count: number; detail?: string }>();
    for (const s of sessions) {
      for (const x of e.explain(s)) {
        const cur = merged.get(x.code);
        merged.set(x.code, { count: (cur?.count ?? 0) + x.count, ...(x.detail ?? cur?.detail ? { detail: (x.detail ?? cur?.detail) as string } : {}) });
      }
    }
    const reasons = [...merged.entries()]
      .map(([code, v]) => ({ code, count: v.count, ...(v.detail ? { detail: v.detail } : {}) }))
      .sort((a, b) => (a.code === "CLASS_OVERLOADED" ? -1 : b.code === "CLASS_OVERLOADED" ? 1 : b.count - a.count || REASON_ORDER.indexOf(a.code) - REASON_ORDER.indexOf(b.code)));
    unplacedReport.push({ requirementId: r.id, classroomId: r.classroomId, curriculumNodeId: r.curriculumNodeId, label: r.label, requested: r.sessionsPerWeek, missing: sessions.length, reasons });
  }

  return {
    placements,
    unplaced: unplacedReport,
    softCost,
    breakdown,
    stats: {
      sessions: e.nS,
      placed: e.nS - unplaced.length,
      unplacedSessions: unplaced.length,
      iterations,
      accepted,
      improvements,
      stoppedBy,
      elapsedMs: Math.max(0, now() - t0),
      seed: problem.seed,
      initialSoftCost: initialSoft,
    },
    warnings: e.warnings,
  };
}

/** Ordre canonique et stable des séances placées (classe, jour, période, besoin, rang). */
export function comparePlacements(problem: GenProblem): (a: GenPlacement, b: GenPlacement) => number {
  const cls = new Map(problem.classes.map((c, i) => [c.id, i]));
  const req = new Map(problem.requirements.map((r, i) => [r.id, i]));
  return (a, b) =>
    (cls.get(a.classroomId) ?? 0) - (cls.get(b.classroomId) ?? 0) ||
    problem.weekdays.indexOf(a.weekday) - problem.weekdays.indexOf(b.weekday) ||
    a.startPeriod - b.startPeriod ||
    (req.get(a.requirementId) ?? 0) - (req.get(b.requirementId) ?? 0) ||
    a.sessionIndex - b.sessionIndex;
}
