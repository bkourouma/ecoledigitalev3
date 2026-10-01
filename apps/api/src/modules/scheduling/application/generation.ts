/**
 * Génération des occurrences datées à partir des patrons d'un emploi du temps PUBLIÉ (spec 017 US2).
 *
 *  - IDEMPOTENTE : une occurrence par (patron, date de patron) ; rejouer ne crée rien (AC2.6).
 *  - Fuseau de l'établissement, jours bloquants du calendrier, alternance A/B (`week_a_anchor`).
 *  - Les conflits sont ÉVITÉS : un créneau qui chevauche une réservation exclusive existante (ou une
 *    autre occurrence du même lot) est sauté et compté (`skippedConflict`), la génération n'échoue pas.
 *  - Plafond d'heures optionnel par (classe × nœud) = volume horaire du nœud (AC2.3).
 *  - Un lot = une semaine ISO, une transaction, sous le verrou EXCLUSIF du tenant : aucun autre écrivain
 *    de planning ne tient de réservation non validée pendant le lot ; la base reste l'arbitre final et un
 *    refus tardif (course avec une écriture hors verrou) fait rejouer le lot.
 *  - Publie UN événement de synthèse `scheduling.generation.completed` (pas un par occurrence).
 */
import { err, ok, type AppError, type RequestContext, type Result } from "@ecoledigitale/kernel";
import { ResourceBook, defaultLabels, describeSpan } from "../domain/conflicts";
import { SchedulingCodes, academicUnavailable, invalidWindow, notFound } from "../domain/errors";
import { SchedulingEvents } from "../domain/events";
import { defaultPaidRole } from "../domain/occurrence-rules";
import { HourCapLedger, expandEntry, type Candidate } from "../domain/recurrence";
import { addDays, daysBetween, localDateOf, maxDate, minDate, mondayOf } from "../domain/time";
import type { CalendarEvent, ClaimResourceKind, ConflictPolicies, SchedulingSettings, Timetable, TimetableEntry } from "../domain/types";
import { insertGeneratedBatch, insertEquipment, insertStaff, listExclusiveClaims, type NewOccurrence, type NewStaff } from "../infrastructure/occurrence-repo";
import { plannedMinutesByNode } from "../infrastructure/read-queries";
import { getPolicies, getRoomsByIds, listCalendarEvents } from "../infrastructure/reference-repo";
import * as tt from "../infrastructure/timetable-repo";
import { EventBuffer, inTx, lockTenantExclusive, type SchedulingDeps } from "./deps";
import { SCHEDULABLE_OFFERING_STATUSES, type ClassroomInfo, type CurriculumNodeInfo, type OfferingInfo } from "./ports/academic";
import { PLANNABLE_STAFF_STATUSES, type StaffInfo } from "./ports/people";
import { loadSettings } from "./support";

export interface GenerateInput {
  timetableId: string;
  from: string;
  to: string;
  /** Plafonne le cumul généré par (classe × nœud) au volume horaire du nœud. */
  capByNodeHours?: boolean | undefined;
}

export interface GenerationWarning {
  code:
    | "ENTRY_SKIPPED_STAFF"
    | "ENTRY_SKIPPED_ROOM"
    | "ENTRY_SKIPPED_OFFERING"
    | "ENTRY_SKIPPED_ANCHOR"
    | "OFFERING_WINDOW"
    | "INVALID_LOCAL_TIME"
    | "NODE_HOURS_UNKNOWN"
    | "WINDOW_CLIPPED";
  message: string;
  entryId?: string;
  date?: string;
  count?: number;
}

export interface ConflictSample {
  entryId: string;
  date: string;
  resourceKind: ClaimResourceKind;
  resourceId: string;
  message: string;
}

export interface GenerationReport {
  runId: string;
  timetableId: string;
  from: string;
  to: string;
  created: number;
  skippedExisting: number;
  skippedBlocked: number;
  skippedConflict: number;
  skippedCapped: number;
  warnings: GenerationWarning[];
  /** Au plus 50 exemples ; les compteurs sont exacts. */
  conflicts: ConflictSample[];
  batches: number;
}

const MAX_SAMPLES = 50;
const MAX_BATCH_RETRIES = 3;

interface Prepared {
  timetable: Timetable;
  settings: SchedulingSettings;
  policies: ConflictPolicies;
  events: CalendarEvent[];
  entries: TimetableEntry[];
  window: { from: string; to: string };
  plannedMinutes: Map<string, number>;
}

export async function generateOccurrences(deps: SchedulingDeps, ctx: RequestContext, input: GenerateInput): Promise<Result<GenerationReport, AppError>> {
  // Phase A : lecture (une transaction courte, lecture seule).
  const prepared = await inTx<Prepared>(
    deps,
    ctx,
    async (tx) => {
      const t = await tt.getTimetable(tx, input.timetableId);
      if (!t) return err(notFound("Emploi du temps", input.timetableId));
      if (t.status !== "PUBLISHED") {
        return err(invalidWindow("Seul un emploi du temps publié génère des occurrences.", { status: t.status, code: SchedulingCodes.timetableNotPublished }));
      }
      const settings = await loadSettings(tx, t.institutionId);
      const from = maxDate(input.from, t.validFrom);
      const to = minDate(input.to, t.validTo);
      if (input.to < input.from) return err(invalidWindow("La fin de la fenêtre précède son début."));
      if (from > to) return err(invalidWindow("La fenêtre est hors de la validité de l'emploi du temps.", { validFrom: t.validFrom, validTo: t.validTo }));
      if (Math.ceil((daysBetween(from, to) + 1) / 7) > settings.maxGenerationWeeks) {
        return err(invalidWindow(`La fenêtre dépasse le garde-fou de ${settings.maxGenerationWeeks} semaines (paramètre de l'établissement).`, { maxGenerationWeeks: settings.maxGenerationWeeks }));
      }
      const entries = await tt.listEntries(tx, t.id);
      const policies = await getPolicies(tx, t.institutionId);
      const events = await listCalendarEvents(tx, { institutionId: t.institutionId, from, to, blocksTeachingOnly: true });
      const classroomIds = [...new Set(entries.flatMap((e) => (e.kind === "LESSON" && e.classroomId ? [e.classroomId] : [])))];
      const plannedMinutes = input.capByNodeHours ? await plannedMinutesByNode(tx, classroomIds, t.academicYearId) : new Map<string, number>();
      return ok({ timetable: t, settings, policies, events, entries, window: { from, to }, plannedMinutes });
    },
    { readOnly: true },
  );
  if (!prepared.ok) return prepared;
  const p = prepared.value;
  const warnings: GenerationWarning[] = [];
  if (p.window.from !== input.from || p.window.to !== input.to) {
    warnings.push({ code: "WINDOW_CLIPPED", message: `Fenêtre ramenée à la validité de l'emploi du temps : ${p.window.from} → ${p.window.to}.` });
  }

  // Phase A2 : ports (hors transaction).
  const needsAcademic = p.entries.some((e) => e.classroomId || e.offeringId || e.curriculumNodeId);
  if (needsAcademic && !deps.ports.academic) return err(academicUnavailable());
  const academic = deps.ports.academic;
  const offerings = new Map<string, OfferingInfo | null>();
  const classrooms = new Map<string, ClassroomInfo | null>();
  const nodes = new Map<string, CurriculumNodeInfo | null>();
  if (academic) {
    for (const e of p.entries) {
      if (e.offeringId && !offerings.has(e.offeringId)) offerings.set(e.offeringId, await academic.getOffering(ctx, e.offeringId));
      if (e.classroomId && !classrooms.has(e.classroomId)) classrooms.set(e.classroomId, await academic.getClassroom(ctx, e.classroomId));
      if (input.capByNodeHours && e.curriculumNodeId && !nodes.has(e.curriculumNodeId)) nodes.set(e.curriculumNodeId, await academic.getCurriculumNode(ctx, e.curriculumNodeId));
    }
  }
  const staffInfo = new Map<string, StaffInfo>();
  if (deps.ports.people) {
    const ids = [...new Set(p.entries.flatMap((e) => e.staff.map((s) => s.staffId)))];
    for (const s of await deps.ports.people.getStaffByIds(ctx, ids)) staffInfo.set(s.id, s);
  }
  const rooms = new Map((await deps.db.run(ctx, (tx) => getRoomsByIds(tx, [...new Set(p.entries.flatMap((e) => (e.roomId ? [e.roomId] : [])))]), { readOnly: true })).map((r) => [r.id, r]));

  // Expansion pure des patrons en candidats datés.
  const tz = p.settings.timezone;
  const ptt = { validFrom: p.timetable.validFrom, validTo: p.timetable.validTo, weekAAnchor: p.timetable.weekAAnchor, campusId: p.timetable.campusId };
  const entryById = new Map<string, TimetableEntry>();
  let skippedBlocked = 0;
  const candidates: Candidate[] = [];
  for (const e of p.entries) {
    entryById.set(e.id, e);
    const reason = skipReason(e, { offerings, rooms, staffInfo, hasPeople: deps.ports.people !== null });
    if (reason) {
      warnings.push({ code: reason.code, message: reason.message, entryId: e.id });
      continue;
    }
    try {
      const x = expandEntry(e, ptt, p.window, tz, p.events);
      skippedBlocked += x.blocked.length;
      for (const date of x.invalid) warnings.push({ code: "INVALID_LOCAL_TIME", message: "Horaire local impossible ce jour-là (changement d'heure).", entryId: e.id, date });
      const offering = e.offeringId ? offerings.get(e.offeringId) ?? null : null;
      let outOfWindow = 0;
      for (const c of x.candidates) {
        if (offering && ((offering.startsOn && c.occursOn < offering.startsOn) || (offering.endsOn && c.occursOn > offering.endsOn))) {
          outOfWindow += 1;
          continue;
        }
        candidates.push(c);
      }
      if (outOfWindow > 0) warnings.push({ code: "OFFERING_WINDOW", message: `${outOfWindow} date(s) hors de la fenêtre de l'offre.`, entryId: e.id, count: outOfWindow });
    } catch (ex) {
      if (ex instanceof RangeError) warnings.push({ code: "ENTRY_SKIPPED_ANCHOR", message: ex.message, entryId: e.id });
      else throw ex;
    }
  }
  candidates.sort((a, b) => a.generatedFor.localeCompare(b.generatedFor) || a.startsAt.getTime() - b.startsAt.getTime() || a.entryId.localeCompare(b.entryId));

  // Plafond d'heures : volume du nœud et minutes déjà planifiées.
  const capMinutes = new Map<string, number | null>();
  const running = new Map(p.plannedMinutes);
  if (input.capByNodeHours) {
    for (const e of p.entries) {
      if (e.kind !== "LESSON" || !e.classroomId || !e.curriculumNodeId) continue;
      const key = `${e.classroomId}|${e.curriculumNodeId}`;
      if (capMinutes.has(key)) continue;
      const node = nodes.get(e.curriculumNodeId) ?? null;
      capMinutes.set(key, node?.hoursTotalMinutes ?? null);
      if (node && node.hoursTotalMinutes === null) warnings.push({ code: "NODE_HOURS_UNKNOWN", message: `Le nœud ${node.label} n'a pas de volume horaire : aucun plafond appliqué.`, entryId: e.id });
    }
  }

  // Phase B : un lot par semaine ISO.
  const batches = new Map<string, Candidate[]>();
  for (const c of candidates) {
    const k = mondayOf(c.generatedFor);
    const list = batches.get(k);
    if (list) list.push(c);
    else batches.set(k, [c]);
  }
  const report: GenerationReport = {
    runId: deps.newId(),
    timetableId: p.timetable.id,
    from: p.window.from,
    to: p.window.to,
    created: 0,
    skippedExisting: 0,
    skippedBlocked,
    skippedConflict: 0,
    skippedCapped: 0,
    warnings,
    conflicts: [],
    batches: 0,
  };
  const labelOf = (kind: ClaimResourceKind, id: string): string => (kind === "STAFF" ? staffInfo.get(id)?.displayName ?? defaultLabels.staff(id) : kind === "ROOM" ? `la salle ${rooms.get(id)?.name ?? id.slice(0, 8)}` : defaultLabels.classroom(id));

  for (const weekStart of [...batches.keys()].sort()) {
    const batch = batches.get(weekStart) as Candidate[];
    let outcome: Result<BatchOutcome, AppError> | null = null;
    for (let attempt = 1; attempt <= MAX_BATCH_RETRIES; attempt += 1) {
      outcome = await runBatch(deps, ctx, p, entryById, classrooms, batch, running, capMinutes, labelOf, tz);
      const retryable = !outcome.ok && (outcome.error.code === SchedulingCodes.conflictDetected || outcome.error.code === SchedulingCodes.concurrentUpdate);
      if (!retryable) break;
    }
    if (!outcome) throw new Error("Lot de génération non exécuté.");
    if (!outcome.ok) {
      // Les lots précédents sont déjà validés (idempotent) : on indique où la génération s'est arrêtée.
      const failure = outcome.error;
      Object.defineProperty(failure, "details", {
        value: { ...(failure.details ?? {}), progress: { created: report.created, week: weekStart } },
        enumerable: true,
        configurable: true,
      });
      return err(failure);
    }
    const o = outcome.value;
    report.batches += 1;
    report.created += o.created;
    report.skippedExisting += o.skippedExisting;
    report.skippedConflict += o.skippedConflict;
    report.skippedCapped += o.skippedCapped;
    for (const s of o.samples) if (report.conflicts.length < MAX_SAMPLES) report.conflicts.push(s);
    for (const [k, v] of o.ledger.snapshot()) running.set(k, v);
  }

  // Journal (immuable) + événement de synthèse.
  const logged = await inTx(deps, ctx, async (tx) => {
    const buf = new EventBuffer(deps, ctx);
    await tt.insertGenerationRun(
      tx,
      ctx.tenantId,
      {
        id: report.runId,
        timetableId: report.timetableId,
        fromDate: report.from,
        toDate: report.to,
        createdCount: report.created,
        skippedExisting: report.skippedExisting,
        skippedBlocked: report.skippedBlocked,
        skippedConflict: report.skippedConflict,
        skippedCapped: report.skippedCapped,
        warnings: [...report.warnings, ...report.conflicts.map((c) => ({ code: "CONFLICT", ...c }))],
        requestedBy: ctx.userId,
      },
      deps.clock.now(),
    );
    buf.add(
      SchedulingEvents.generationCompleted,
      { v: 1, runId: report.runId, timetableId: report.timetableId, from: report.from, to: report.to, created: report.created, skippedExisting: report.skippedExisting, skippedBlocked: report.skippedBlocked, skippedConflict: report.skippedConflict, skippedCapped: report.skippedCapped },
      { type: "timetable", id: report.timetableId },
    );
    await buf.flush(tx);
    return ok(undefined);
  });
  if (!logged.ok) return logged;
  return ok(report);
}

function skipReason(
  e: TimetableEntry,
  c: { offerings: ReadonlyMap<string, OfferingInfo | null>; rooms: ReadonlyMap<string, { status: string; name: string }>; staffInfo: ReadonlyMap<string, StaffInfo>; hasPeople: boolean },
): { code: GenerationWarning["code"]; message: string } | null {
  if (e.offeringId) {
    const o = c.offerings.get(e.offeringId);
    if (!o) return { code: "ENTRY_SKIPPED_OFFERING", message: "Offre introuvable : le patron est ignoré." };
    if (!SCHEDULABLE_OFFERING_STATUSES.includes(o.status)) return { code: "ENTRY_SKIPPED_OFFERING", message: `L'offre « ${o.label} » n'est pas planifiable (statut ${o.status}) : le patron est ignoré.` };
  }
  if (e.roomId) {
    const r = c.rooms.get(e.roomId);
    if (!r || r.status !== "AVAILABLE") return { code: "ENTRY_SKIPPED_ROOM", message: `La salle ${r?.name ?? "inconnue"} n'est pas disponible : le patron est ignoré.` };
  }
  if (c.hasPeople) {
    for (const s of e.staff) {
      const info = c.staffInfo.get(s.staffId);
      if (!info || !PLANNABLE_STAFF_STATUSES.includes(info.status)) return { code: "ENTRY_SKIPPED_STAFF", message: `L'intervenant ${info?.displayName ?? s.staffId.slice(0, 8)} n'est plus planifiable (${info?.status ?? "inconnu"}) : le patron est ignoré.` };
    }
  }
  return null;
}

interface BatchOutcome {
  created: number;
  skippedExisting: number;
  skippedConflict: number;
  skippedCapped: number;
  samples: ConflictSample[];
  ledger: HourCapLedger;
}

async function runBatch(
  deps: SchedulingDeps,
  ctx: RequestContext,
  p: Prepared,
  entries: ReadonlyMap<string, TimetableEntry>,
  classrooms: ReadonlyMap<string, ClassroomInfo | null>,
  batch: readonly Candidate[],
  running: ReadonlyMap<string, number>,
  capMinutes: ReadonlyMap<string, number | null>,
  labelOf: (kind: ClaimResourceKind, id: string) => string,
  tz: string,
): Promise<Result<BatchOutcome, AppError>> {
  return inTx(deps, ctx, async (tx) => {
    await lockTenantExclusive(tx, ctx);
    const entryIds = [...new Set(batch.map((c) => c.entryId))];
    const dates = batch.map((c) => c.generatedFor).sort();
    const existingRows = await tx.many<{ timetable_entry_id: string; generated_for: string }>(
      `SELECT timetable_entry_id, generated_for::text AS generated_for FROM scheduling.session_occurrences
        WHERE tenant_id = kernel.current_tenant_id() AND timetable_entry_id = ANY($1::uuid[]) AND generated_for BETWEEN $2::date AND $3::date`,
      [entryIds, dates[0], dates[dates.length - 1]],
    );
    const existing = new Set(existingRows.map((r) => `${r.timetable_entry_id}|${r.generated_for}`));
    const fresh = batch.filter((c) => !existing.has(`${c.entryId}|${c.generatedFor}`));
    const ledger = new HourCapLedger(running, capMinutes);
    const outcome: BatchOutcome = { created: 0, skippedExisting: batch.length - fresh.length, skippedConflict: 0, skippedCapped: 0, samples: [], ledger };
    if (fresh.length === 0) return ok(outcome);

    // Carnet des réservations exclusives qui touchent les ressources du lot.
    const staffIds = new Set<string>();
    const classKeys = new Set<string>();
    const roomIds = new Set<string>();
    const resourcesOf = (c: Candidate): Array<{ kind: ClaimResourceKind; id: string }> => {
      const e = entries.get(c.entryId) as TimetableEntry;
      const out: Array<{ kind: ClaimResourceKind; id: string }> = [];
      if (p.policies.STAFF === "BLOCK") for (const s of e.staff) out.push({ kind: "STAFF", id: s.staffId });
      if (p.policies.CLASSROOM === "BLOCK" && (e.kind === "LESSON" || e.kind === "EXAM")) {
        const key = e.claimsClassroom ? e.classroomId : e.offeringId;
        if (key) out.push({ kind: "CLASSROOM", id: key });
      }
      if (p.policies.ROOM === "BLOCK" && e.roomId) out.push({ kind: "ROOM", id: e.roomId });
      return out;
    };
    for (const c of fresh) {
      for (const r of resourcesOf(c)) (r.kind === "STAFF" ? staffIds : r.kind === "ROOM" ? roomIds : classKeys).add(r.id);
    }
    const minStart = new Date(Math.min(...fresh.map((c) => c.startsAt.getTime())));
    const maxEnd = new Date(Math.max(...fresh.map((c) => c.endsAt.getTime())));
    const book = new ResourceBook();
    for (const claim of await listExclusiveClaims(tx, { start: minStart, end: maxEnd }, { staffIds: [...staffIds], classroomKeys: [...classKeys], roomIds: [...roomIds] })) {
      book.add(ResourceBook.key(claim.resourceKind, claim.resourceId), { start: claim.start, end: claim.end, ref: claim.occurrenceId });
    }

    const rows: NewOccurrence[] = [];
    const staffRows: NewStaff[] = [];
    const equipmentCandidates: Array<{ occ: NewOccurrence; staff: NewStaff[]; entry: TimetableEntry; keys: Array<{ key: string; ref: string }> }> = [];
    for (const c of fresh) {
      const e = entries.get(c.entryId) as TimetableEntry;
      const span = { start: c.startsAt.getTime(), end: c.endsAt.getTime() };
      const res = resourcesOf(c);
      const clash = res.find((r) => book.firstOverlap(ResourceBook.key(r.kind, r.id), span));
      if (clash) {
        outcome.skippedConflict += 1;
        if (outcome.samples.length < MAX_SAMPLES) {
          outcome.samples.push({
            entryId: c.entryId,
            date: c.generatedFor,
            resourceKind: clash.kind,
            resourceId: clash.id,
            message: `${labelOf(clash.kind, clash.id)} est déjà réservé(e) ${describeSpan(c.startsAt, c.endsAt, tz)} : séance non générée.`,
          });
        }
        continue;
      }
      const capKey = e.kind === "LESSON" && e.classroomId && e.curriculumNodeId ? `${e.classroomId}|${e.curriculumNodeId}` : null;
      if (capKey && !ledger.tryConsume(capKey, Math.round((c.endsAt.getTime() - c.startsAt.getTime()) / 60_000))) {
        outcome.skippedCapped += 1;
        continue;
      }
      const keys = res.map((r) => ({ key: ResourceBook.key(r.kind, r.id), ref: `${c.entryId}|${c.generatedFor}` }));
      for (const k of keys) book.add(k.key, { ...span, ref: k.ref });

      const occurrenceId = deps.newId();
      const classroom = e.classroomId ? classrooms.get(e.classroomId) ?? null : null;
      const occ: NewOccurrence = {
        id: occurrenceId,
        tenantId: ctx.tenantId,
        institutionId: p.timetable.institutionId,
        campusId: p.timetable.campusId ?? classroom?.campusId ?? null,
        academicYearId: p.timetable.academicYearId,
        timetableEntryId: e.id,
        generatedFor: c.generatedFor,
        kind: e.kind,
        title: e.title,
        classroomId: e.classroomId,
        curriculumNodeId: e.curriculumNodeId,
        offeringId: e.offeringId,
        claimsClassroom: e.claimsClassroom,
        roomId: e.roomId,
        startsAt: c.startsAt,
        endsAt: c.endsAt,
        occursOn: c.occursOn,
        deliveryMode: e.deliveryMode,
        status: "PLANNED",
        heldAt: null,
        heldSource: null,
        heldBy: null,
        origin: "GENERATED",
        conflictOverride: false,
        conflictOverrideReason: null,
        conflictOverrideBy: null,
        notes: e.notes,
        locationLabel: null,
        attributes: {},
        createdBy: ctx.userId,
      };
      const staff: NewStaff[] = e.staff.map((s) => ({ id: deps.newId(), occurrenceId, staffId: s.staffId, role: s.role, replacesStaffId: null, isPaidRole: defaultPaidRole(s.role, p.settings.supervisorsPaid) }));
      if (e.equipment.length > 0) equipmentCandidates.push({ occ, staff, entry: e, keys });
      else {
        rows.push(occ);
        staffRows.push(...staff);
      }
    }

    if (rows.length > 0) {
      const inserted = await insertGeneratedBatch(tx, rows);
      outcome.created += inserted.size;
      outcome.skippedExisting += rows.length - inserted.size;
      await insertStaff(tx, ctx.tenantId, staffRows.filter((s) => inserted.has(s.occurrenceId)));
    }
    // Séances équipées : chacune dans un SAVEPOINT (le stock est contrôlé par la base, verrou de ligne).
    for (const ec of equipmentCandidates) {
      try {
        await tx.transaction(async (sp) => {
          const inserted = await insertGeneratedBatch(sp, [ec.occ]);
          if (inserted.size === 0) return;
          await insertStaff(sp, ctx.tenantId, ec.staff);
          await insertEquipment(sp, ctx.tenantId, ec.occ.id, ec.entry.equipment);
        });
        outcome.created += 1;
      } catch (e) {
        if (isStockOrClaimError(e)) {
          outcome.skippedConflict += 1;
          if (outcome.samples.length < MAX_SAMPLES) {
            outcome.samples.push({ entryId: ec.entry.id, date: ec.occ.generatedFor as string, resourceKind: "ROOM", resourceId: ec.entry.equipment[0]?.equipmentId ?? "", message: `Stock d'équipement insuffisant ${describeSpan(ec.occ.startsAt, ec.occ.endsAt, tz)} : séance non générée.` });
          }
          continue;
        }
        throw e;
      }
    }
    return ok(outcome);
  });
}

function isStockOrClaimError(e: unknown): boolean {
  const code = (e as { code?: string }).code;
  const message = (e as { message?: string }).message ?? "";
  return code === "23P01" && (message.includes("scheduling.equipment_conflict") || message.includes("resource_claims_no_overlap"));
}

// ---------------------------------------------------------------------------
// Génération glissante (job quotidien)
// ---------------------------------------------------------------------------

export interface RollingReport {
  timetables: number;
  created: number;
  failed: Array<{ timetableId: string; message: string }>;
}

/**
 * Prolonge, pour un tenant, la génération de chaque emploi du temps publié jusqu'à
 * `generation_horizon_weeks` (paramètre de l'établissement) après aujourd'hui. Idempotent : le rejouer ne
 * crée rien ; un emploi du temps en échec n'arrête pas les autres.
 */
export async function generateRolling(deps: SchedulingDeps, ctx: RequestContext): Promise<Result<RollingReport, AppError>> {
  const listed = await inTx(
    deps,
    ctx,
    async (tx) => {
      const published = await tt.listPublishedTimetables(tx);
      const out: Array<{ timetable: Timetable; settings: SchedulingSettings }> = [];
      for (const t of published) out.push({ timetable: t, settings: await loadSettings(tx, t.institutionId) });
      return ok(out);
    },
    { readOnly: true },
  );
  if (!listed.ok) return listed;
  const report: RollingReport = { timetables: 0, created: 0, failed: [] };
  for (const { timetable, settings } of listed.value) {
    const today = localDateOf(deps.clock.now(), settings.timezone);
    const from = maxDate(today, timetable.validFrom);
    const to = minDate(addDays(today, settings.generationHorizonWeeks * 7), timetable.validTo);
    if (from > to) continue;
    report.timetables += 1;
    const r = await generateOccurrences(deps, ctx, { timetableId: timetable.id, from, to });
    if (r.ok) report.created += r.value.created;
    else report.failed.push({ timetableId: timetable.id, message: r.error.message });
  }
  return ok(report);
}

// ---------------------------------------------------------------------------
// Rapprochement « séances manquantes » (équivalent de findSeancesManquantes du legacy)
// ---------------------------------------------------------------------------

export interface MissingOccurrence {
  entryId: string;
  date: string;
  startsAt: Date;
  endsAt: Date;
}

/**
 * Dates de patron SANS occurrence (génération oubliée) sur une fenêtre : le rejeu de `generateOccurrences`
 * (idempotent) les crée. Lecture seule, pour l'écran de rapprochement de la paie (« séances manquantes »).
 */
export async function listExpectedWithoutOccurrence(
  deps: SchedulingDeps,
  ctx: RequestContext,
  input: { timetableId: string; from: string; to: string },
): Promise<Result<MissingOccurrence[], AppError>> {
  return inTx(
    deps,
    ctx,
    async (tx) => {
      const t = await tt.getTimetable(tx, input.timetableId);
      if (!t) return err(notFound("Emploi du temps", input.timetableId));
      const settings = await loadSettings(tx, t.institutionId);
      const from = maxDate(input.from, t.validFrom);
      const to = minDate(input.to, t.validTo);
      if (from > to) return ok([]);
      const entries = await tt.listEntries(tx, t.id);
      const events = await listCalendarEvents(tx, { institutionId: t.institutionId, from, to, blocksTeachingOnly: true });
      const existing = new Set(
        (
          await tx.many<{ timetable_entry_id: string; generated_for: string }>(
            `SELECT o.timetable_entry_id, o.generated_for::text AS generated_for FROM scheduling.session_occurrences o
               JOIN scheduling.timetable_entries e ON e.tenant_id = o.tenant_id AND e.id = o.timetable_entry_id
              WHERE o.tenant_id = kernel.current_tenant_id() AND e.timetable_id = $1 AND o.generated_for BETWEEN $2::date AND $3::date`,
            [t.id, from, to],
          )
        ).map((r) => `${r.timetable_entry_id}|${r.generated_for}`),
      );
      const out: MissingOccurrence[] = [];
      for (const e of entries) {
        const x = expandEntry(e, { validFrom: t.validFrom, validTo: t.validTo, weekAAnchor: t.weekAAnchor, campusId: t.campusId }, { from, to }, settings.timezone, events);
        for (const c of x.candidates) if (!existing.has(`${c.entryId}|${c.generatedFor}`)) out.push({ entryId: c.entryId, date: c.generatedFor, startsAt: c.startsAt, endsAt: c.endsAt });
      }
      return ok(out.sort((a, b) => a.date.localeCompare(b.date) || a.startsAt.getTime() - b.startsAt.getTime()));
    },
    { readOnly: true },
  );
}

