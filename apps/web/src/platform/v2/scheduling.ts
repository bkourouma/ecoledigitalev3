"use client";

/**
 * Hooks typés du module `scheduling` (`/api/v1/scheduling/*`). Schémas Zod de `packages/contracts/src/v2/scheduling.ts`
 * (complétés ci-dessous pour les quelques réponses que le contrat ne décrit pas encore). AUCUNE règle de planification
 * côté client : conflits, validité d'un créneau, génération, publication sont calculés et imposés par l'API ; l'écran
 * affiche ses messages tels quels.
 */

import { z } from "zod";
import { platformApi, platformHooks as hooks } from "@/platform/api/default-client";
import {
  schedulingAutogenAppliedDtoSchema,
  schedulingAutogenDefaultsDtoSchema,
  schedulingAutogenRunDetailDtoSchema,
  schedulingAutogenRunDtoSchema,
  schedulingAutogenStartedDtoSchema,
  schedulingCalendarEventDtoSchema,
  schedulingConflictViewDtoSchema,
  schedulingEntryDtoSchema,
  schedulingEquipmentDtoSchema,
  schedulingGenerationReportDtoSchema,
  schedulingOccurrenceDtoSchema,
  schedulingOccurrencePageDtoSchema,
  schedulingOccurrenceResultDtoSchema,
  schedulingPreviewResultDtoSchema,
  schedulingRoomDtoSchema,
  schedulingSettingsDtoSchema,
  schedulingTimeSlotDtoSchema,
  schedulingTimetableDtoSchema,
  type schedulingAutogenApplyBodySchema,
  type schedulingAutogenRunBodySchema,
  type schedulingEntryBodySchema,
  type schedulingPreviewBodySchema,
  type schedulingSuggestSlotsBodySchema,
} from "@ecoledigitale/contracts/v2/scheduling";
import { useApiAction } from "./actions";
import { omit } from "./omit";

export const SCHEDULING_BASE = "/api/v1/scheduling";
const KEY = ["scheduling"] as const;

type Query = Record<string, string | number | boolean | undefined>;
const itemsOf = <T extends z.ZodTypeAny>(item: T) => z.object({ items: z.array(item) });
const pickItems = <T>(d: { items: T[] }) => d.items;

// ---------------------------------------------------------------------------
// Réponses non décrites par le contrat
// ---------------------------------------------------------------------------

export const todayDtoSchema = z.object({ date: z.string(), staffId: z.string(), items: z.array(schedulingOccurrenceDtoSchema) });
export const myTimetableDtoSchema = schedulingOccurrencePageDtoSchema.extend({ subject: z.enum(["STAFF", "STUDENT"]), subjectId: z.string() });
export const slotSuggestionDtoSchema = z.object({
  date: z.string(),
  startMinute: z.number().int(),
  endMinute: z.number().int(),
  startsAt: z.string(),
  endsAt: z.string(),
  roomId: z.string().nullable(),
  roomCode: z.string().nullable(),
  preferred: z.boolean(),
  warnings: z.array(schedulingConflictViewDtoSchema),
});
export type SlotSuggestionDto = z.infer<typeof slotSuggestionDtoSchema>;
export const substituteSuggestionDtoSchema = z.object({
  staffId: z.string(),
  displayName: z.string().nullable(),
  eligible: z.boolean(),
  reasons: z.array(z.string()),
  busy: z.boolean(),
  availability: z.string(),
  competent: z.boolean().nullable(),
  assignedToClassroom: z.boolean().nullable(),
  weeklyLoadMinutes: z.number().int(),
});
export type SubstituteSuggestionDto = z.infer<typeof substituteSuggestionDtoSchema>;
export const icsTokenDtoSchema = z.object({
  id: z.string(),
  scope: z.enum(["CLASSROOM", "STAFF", "STUDENT", "ROOM"]),
  subjectId: z.string(),
  label: z.string().nullable(),
  createdAt: z.string(),
  expiresAt: z.string().nullable(),
  revokedAt: z.string().nullable(),
  lastUsedAt: z.string().nullable(),
});
export type IcsTokenDto = z.infer<typeof icsTokenDtoSchema>;
const icsTokenCreatedSchema = z.object({ tokenId: z.string(), token: z.string(), expiresAt: z.string().nullable(), path: z.string() });
export const roomOccupancyDtoSchema = z.object({
  rooms: z.array(z.object({ roomId: z.string(), code: z.string(), name: z.string(), occupiedMinutes: z.number().int(), availableMinutes: z.number().int().nullable(), rateBp: z.number().int().nullable() })),
  totalOccupiedMinutes: z.number().int(),
  totalAvailableMinutes: z.number().int().nullable(),
  rateBp: z.number().int().nullable(),
});
export const staffLoadDtoSchema = z.object({ weekStart: z.string(), weekEnd: z.string(), days: z.array(z.object({ date: z.string(), minutes: z.number().int() })), totalMinutes: z.number().int() });
export const entryResultDtoSchema = z.object({
  entry: schedulingEntryDtoSchema,
  conflicts: z.array(schedulingConflictViewDtoSchema),
  warnings: z.array(schedulingConflictViewDtoSchema),
  propagation: z.unknown().optional(),
});
export const changeDtoSchema = z.object({ id: z.string(), kind: z.string(), from: z.unknown().nullable(), to: z.unknown().nullable(), reason: z.string().nullable(), actorId: z.string().nullable(), changedAt: z.string() });
export const generationRunDtoSchema = z.object({ id: z.string(), timetableId: z.string() }).passthrough();

export type OccurrenceDto = z.infer<typeof schedulingOccurrenceDtoSchema>;
export type TimetableEntryBody = z.input<typeof schedulingEntryBodySchema>;

// ---------------------------------------------------------------------------
// Vues (lecture)
// ---------------------------------------------------------------------------

export type ViewKind = "classroom" | "staff" | "room" | "student";
export interface WindowQuery {
  from: string;
  to: string;
  includeCancelled?: boolean;
}

export function useViewOccurrences(kind: ViewKind, id: string | null, window: WindowQuery, enabled = true) {
  return hooks.useApiQuery([...KEY, "view", kind, id], `${SCHEDULING_BASE}/views/${kind}/${id}`, {
    schema: schedulingOccurrencePageDtoSchema,
    query: { from: window.from, to: window.to, includeCancelled: window.includeCancelled ? "true" : undefined, limit: 500 },
    enabled: enabled && id !== null,
    keepPreviousData: true,
    retry: false,
  });
}

export function useMyToday(enabled = true) {
  return hooks.useApiQuery([...KEY, "me", "today"], `${SCHEDULING_BASE}/me/today`, { schema: todayDtoSchema, enabled, retry: false });
}

export function useMyTimetable(window: WindowQuery, enabled = true) {
  return hooks.useApiQuery([...KEY, "me", "timetable"], `${SCHEDULING_BASE}/me/timetable`, {
    schema: myTimetableDtoSchema,
    query: { from: window.from, to: window.to, includeCancelled: window.includeCancelled ? "true" : undefined, limit: 500 },
    enabled,
    keepPreviousData: true,
    retry: false,
  });
}

/** Lecture directe (hors cache de requêtes) de l'emploi du temps personnel d'une fenêtre : sert au préchargement hors ligne. Une seule tentative. */
export function fetchMyTimetablePage(window: { from: string; to: string; includeCancelled?: boolean }) {
  return platformApi.get(`${SCHEDULING_BASE}/me/timetable`, {
    schema: myTimetableDtoSchema,
    query: { from: window.from, to: window.to, includeCancelled: window.includeCancelled ? "true" : undefined, limit: 500 },
    retries: 0,
  });
}

export function useChildTimetable(studentId: string | null, window: WindowQuery) {
  return hooks.useApiQuery([...KEY, "child", studentId], `${SCHEDULING_BASE}/children/${studentId}/timetable`, {
    schema: schedulingOccurrencePageDtoSchema,
    query: { from: window.from, to: window.to, includeCancelled: window.includeCancelled ? "true" : undefined, limit: 500 },
    enabled: studentId !== null,
    keepPreviousData: true,
    retry: false,
  });
}

export interface OccurrencesQuery {
  from?: string;
  to?: string;
  classroomId?: string;
  staffId?: string;
  roomId?: string;
  status?: "PLANNED" | "HELD" | "CANCELLED";
  kind?: string;
  limit?: number;
  offset?: number;
}

export function useOccurrences(query: OccurrencesQuery, enabled = true) {
  return hooks.useApiQuery([...KEY, "occurrences", "list"], `${SCHEDULING_BASE}/occurrences`, { schema: schedulingOccurrencePageDtoSchema, query: query as Query, enabled, retry: false });
}

export function useOccurrence(id: string | null) {
  return hooks.useApiQuery([...KEY, "occurrences", "one", id], `${SCHEDULING_BASE}/occurrences/${id}`, { schema: schedulingOccurrenceDtoSchema, enabled: id !== null, retry: false });
}

export function useOccurrenceHistory(id: string | null) {
  return hooks.useApiQuery([...KEY, "occurrences", "history", id], `${SCHEDULING_BASE}/occurrences/${id}/history`, { schema: itemsOf(changeDtoSchema), select: pickItems, enabled: id !== null, retry: false });
}

export function usePendingReplacements(query: { from?: string; to?: string; classroomId?: string }, enabled = true) {
  return hooks.useApiQuery([...KEY, "occurrences", "replacements"], `${SCHEDULING_BASE}/occurrences/pending-replacements`, { schema: schedulingOccurrencePageDtoSchema, query: { ...query, limit: 200 } as Query, enabled, retry: false });
}

export function useUnrealizedOccurrences(query: { from?: string; to?: string; classroomId?: string; staffId?: string }, enabled = true) {
  return hooks.useApiQuery([...KEY, "occurrences", "unrealized"], `${SCHEDULING_BASE}/occurrences/unrealized`, { schema: schedulingOccurrencePageDtoSchema, query: { ...query, limit: 200 } as Query, enabled, retry: false });
}

// ---------------------------------------------------------------------------
// Séances : écriture
// ---------------------------------------------------------------------------

const OCC_KEYS = [[...KEY, "occurrences"], [...KEY, "view"], [...KEY, "me"], [...KEY, "child"]] as const;

type Override = { override?: { reason: string } };

export interface CreateOccurrenceInput extends Override {
  kind: "LESSON" | "EXAM" | "MEETING" | "EVENT" | "RESERVATION" | "COUNCIL" | "OTHER";
  title?: string | null;
  classroomId?: string | null;
  curriculumNodeId?: string | null;
  offeringId?: string | null;
  roomId?: string | null;
  date: string;
  startTime: string;
  endTime: string;
  staff?: Array<{ staffId: string; role?: "LEAD" | "CO_TEACHER" | "SUBSTITUTE" | "SUPERVISOR" }>;
  notes?: string | null;
  status?: "PLANNED" | "HELD";
}

export function useCreateOccurrence() {
  return useApiAction({ path: `${SCHEDULING_BASE}/occurrences`, body: (v: CreateOccurrenceInput) => v, schema: schedulingOccurrenceResultDtoSchema, invalidate: OCC_KEYS });
}

export function useRescheduleOccurrence() {
  return useApiAction({
    path: (v: { id: string; date: string; startTime: string; endTime: string; reason?: string } & Override) => `${SCHEDULING_BASE}/occurrences/${v.id}/reschedule`,
    body: (v) => omit(v, "id"),
    schema: schedulingOccurrenceResultDtoSchema,
    invalidate: OCC_KEYS,
  });
}

export function useChangeOccurrenceRoom() {
  return useApiAction({
    path: (v: { id: string; roomId: string | null; reason?: string } & Override) => `${SCHEDULING_BASE}/occurrences/${v.id}/room`,
    body: (v) => omit(v, "id"),
    schema: schedulingOccurrenceResultDtoSchema,
    invalidate: OCC_KEYS,
  });
}

export function useSubstituteStaff() {
  return useApiAction({
    path: (v: { id: string; originalStaffId: string; substituteStaffId: string; reason: string } & Override) => `${SCHEDULING_BASE}/occurrences/${v.id}/substitute`,
    body: (v) => omit(v, "id"),
    schema: schedulingOccurrenceResultDtoSchema,
    invalidate: OCC_KEYS,
  });
}

export function useCancelOccurrence() {
  return useApiAction({
    path: (v: { id: string; reason: string }) => `${SCHEDULING_BASE}/occurrences/${v.id}/cancel`,
    body: (v) => ({ reason: v.reason }),
    schema: z.object({ occurrence: schedulingOccurrenceDtoSchema, alreadyCancelled: z.boolean() }),
    invalidate: OCC_KEYS,
  });
}

export function useRestoreOccurrence() {
  return useApiAction({
    path: (v: { id: string; reason?: string } & Override) => `${SCHEDULING_BASE}/occurrences/${v.id}/restore`,
    body: (v) => omit(v, "id"),
    schema: schedulingOccurrenceResultDtoSchema,
    invalidate: OCC_KEYS,
  });
}

export function useHoldOccurrence() {
  return useApiAction({
    path: (v: { id: string; reason?: string }) => `${SCHEDULING_BASE}/occurrences/${v.id}/hold`,
    body: (v) => (v.reason ? { reason: v.reason } : {}),
    schema: z.object({ occurrence: schedulingOccurrenceDtoSchema, alreadyHeld: z.boolean(), warnings: z.array(schedulingConflictViewDtoSchema) }),
    invalidate: OCC_KEYS,
  });
}

// ---------------------------------------------------------------------------
// Aides au placement (lecture seule, déclenchées à la demande)
// ---------------------------------------------------------------------------

export function usePreviewConflicts() {
  return useApiAction({
    path: `${SCHEDULING_BASE}/conflicts/preview`,
    body: (v: z.input<typeof schedulingPreviewBodySchema>) => v,
    schema: schedulingPreviewResultDtoSchema,
  });
}

export function useSuggestSlots() {
  return useApiAction({
    path: `${SCHEDULING_BASE}/slots/suggest`,
    body: (v: z.input<typeof schedulingSuggestSlotsBodySchema>) => v,
    schema: itemsOf(slotSuggestionDtoSchema),
  });
}

/** POST (calcul sans effet d'écriture) : les remplaçants possibles d'une séance. */
export function useSuggestSubstitutesAction() {
  return useApiAction({
    path: (v: { id: string; count?: number }) => `${SCHEDULING_BASE}/occurrences/${v.id}/substitutes/suggest`,
    body: (v) => (v.count ? { count: v.count } : {}),
    schema: itemsOf(substituteSuggestionDtoSchema),
  });
}

// ---------------------------------------------------------------------------
// Salles, équipements, grille horaire, calendrier, paramètres
// ---------------------------------------------------------------------------

export function useRooms(query: { campusId?: string; institutionId?: string; status?: string } = {}, enabled = true) {
  return hooks.useApiQuery([...KEY, "rooms"], `${SCHEDULING_BASE}/rooms`, { schema: itemsOf(schedulingRoomDtoSchema), select: pickItems, query: query as Query, enabled, retry: false });
}

export function useCreateRoom() {
  return useApiAction({
    path: `${SCHEDULING_BASE}/rooms`,
    body: (v: { institutionId: string; campusId: string; code: string; name: string; roomTypeCode: string; capacity?: number | null; building?: string | null; features?: string[] }) => v,
    schema: schedulingRoomDtoSchema,
    invalidate: [[...KEY, "rooms"]],
  });
}

export function useUpdateRoom() {
  return useApiAction({
    method: "PATCH",
    path: (v: { id: string; name?: string; roomTypeCode?: string; capacity?: number | null; building?: string | null; features?: string[] }) => `${SCHEDULING_BASE}/rooms/${v.id}`,
    body: (v) => omit(v, "id"),
    schema: schedulingRoomDtoSchema,
    invalidate: [[...KEY, "rooms"]],
  });
}

export function useSetRoomStatus() {
  return useApiAction({
    path: (v: { id: string; status: "AVAILABLE" | "OUT_OF_SERVICE" | "ARCHIVED"; reason?: string }) => `${SCHEDULING_BASE}/rooms/${v.id}/status`,
    body: (v) => omit(v, "id"),
    invalidate: [[...KEY, "rooms"]],
  });
}

export function useRoomTypes() {
  return hooks.useApiQuery([...KEY, "room-types"], `${SCHEDULING_BASE}/reference/room-types`, {
    schema: itemsOf(z.object({ code: z.string(), label: z.string(), active: z.boolean().optional() }).passthrough()),
    select: pickItems,
    staleTime: 5 * 60_000,
    retry: false,
  });
}

export function useEquipment(query: { campusId?: string } = {}, enabled = true) {
  return hooks.useApiQuery([...KEY, "equipment"], `${SCHEDULING_BASE}/equipment`, { schema: itemsOf(schedulingEquipmentDtoSchema), select: pickItems, query: query as Query, enabled, retry: false });
}

export function useCreateEquipment() {
  return useApiAction({
    path: `${SCHEDULING_BASE}/equipment`,
    body: (v: { institutionId: string; campusId: string; code: string; label: string; quantity: number }) => v,
    schema: schedulingEquipmentDtoSchema,
    invalidate: [[...KEY, "equipment"]],
  });
}

export function useUpdateEquipment() {
  return useApiAction({
    method: "PATCH",
    path: (v: { id: string; label?: string; quantity?: number; status?: "AVAILABLE" | "OUT_OF_SERVICE" | "ARCHIVED" }) => `${SCHEDULING_BASE}/equipment/${v.id}`,
    body: (v) => omit(v, "id"),
    schema: schedulingEquipmentDtoSchema,
    invalidate: [[...KEY, "equipment"]],
  });
}

export function useRoomOccupancy(query: { campusId: string | null; from: string; to: string }) {
  return hooks.useApiQuery([...KEY, "room-occupancy"], `${SCHEDULING_BASE}/reports/room-occupancy`, { schema: roomOccupancyDtoSchema, query: { campusId: query.campusId ?? undefined, from: query.from, to: query.to }, enabled: query.campusId !== null, retry: false });
}

export function useTimeSlots(enabled = true) {
  return hooks.useApiQuery([...KEY, "time-slots"], `${SCHEDULING_BASE}/time-slots`, { schema: itemsOf(schedulingTimeSlotDtoSchema), select: pickItems, enabled, staleTime: 5 * 60_000, retry: false });
}

export function useCalendarEvents(query: { from?: string; to?: string }, enabled = true) {
  return hooks.useApiQuery([...KEY, "calendar"], `${SCHEDULING_BASE}/calendar-events`, { schema: itemsOf(schedulingCalendarEventDtoSchema), select: pickItems, query: query as Query, enabled, retry: false });
}

export function useSchedulingSettings(institutionId: string | null) {
  return hooks.useApiQuery([...KEY, "settings", institutionId], `${SCHEDULING_BASE}/reference/settings`, { schema: schedulingSettingsDtoSchema, query: { institutionId: institutionId ?? undefined }, enabled: institutionId !== null, retry: false, staleTime: 5 * 60_000 });
}

// ---------------------------------------------------------------------------
// Emplois du temps (patrons récurrents)
// ---------------------------------------------------------------------------

export function useTimetables(query: { institutionId?: string; academicYearId?: string; status?: "DRAFT" | "PUBLISHED" | "ARCHIVED" } = {}, enabled = true) {
  return hooks.useApiQuery([...KEY, "timetables", "list"], `${SCHEDULING_BASE}/timetables`, { schema: itemsOf(schedulingTimetableDtoSchema), select: pickItems, query: query as Query, enabled, retry: false });
}

export function useTimetable(id: string | null) {
  return hooks.useApiQuery([...KEY, "timetables", "one", id], `${SCHEDULING_BASE}/timetables/${id}`, { schema: z.object({ timetable: schedulingTimetableDtoSchema, entries: z.array(schedulingEntryDtoSchema) }), enabled: id !== null, retry: false });
}

export function useTimetableConflicts(id: string | null, enabled = true) {
  return hooks.useApiQuery([...KEY, "timetables", "conflicts", id], `${SCHEDULING_BASE}/timetables/${id}/conflicts`, { schema: itemsOf(schedulingConflictViewDtoSchema), select: pickItems, enabled: enabled && id !== null, retry: false });
}

export function useGenerationRuns(id: string | null) {
  return hooks.useApiQuery([...KEY, "timetables", "runs", id], `${SCHEDULING_BASE}/timetables/${id}/generation-runs`, { schema: itemsOf(generationRunDtoSchema), select: pickItems, enabled: id !== null, retry: false });
}

const TT_KEYS = [[...KEY, "timetables"]] as const;

export function useCreateTimetable() {
  return useApiAction({
    path: `${SCHEDULING_BASE}/timetables`,
    body: (v: { institutionId: string; academicYearId: string; name: string; validFrom: string; validTo: string; weekAAnchor?: string | null }) => v,
    schema: schedulingTimetableDtoSchema,
    invalidate: TT_KEYS,
  });
}

export function useCreateTimetableEntry() {
  return useApiAction({
    path: (v: { timetableId: string; entry: TimetableEntryBody }) => `${SCHEDULING_BASE}/timetables/${v.timetableId}/entries`,
    body: (v) => v.entry,
    schema: entryResultDtoSchema,
    invalidate: TT_KEYS,
  });
}

export function useUpdateTimetableEntry() {
  return useApiAction({
    method: "PATCH",
    path: (v: { timetableId: string; entryId: string; entry: TimetableEntryBody }) => `${SCHEDULING_BASE}/timetables/${v.timetableId}/entries/${v.entryId}`,
    body: (v) => v.entry,
    schema: entryResultDtoSchema,
    invalidate: TT_KEYS,
  });
}

export function useRemoveTimetableEntry() {
  return useApiAction({
    method: "DELETE",
    path: (v: { timetableId: string; entryId: string }) => `${SCHEDULING_BASE}/timetables/${v.timetableId}/entries/${v.entryId}`,
    invalidate: TT_KEYS,
  });
}

export function usePublishTimetable(action: "publish" | "archive" = "publish") {
  return useApiAction({ path: (v: { id: string }) => `${SCHEDULING_BASE}/timetables/${v.id}/${action}`, body: () => ({}), schema: schedulingTimetableDtoSchema, invalidate: [...TT_KEYS, [...KEY, "view"], [...KEY, "me"]] });
}

export function useGenerateOccurrences() {
  return useApiAction({
    path: (v: { id: string; from: string; to: string; capByNodeHours?: boolean }) => `${SCHEDULING_BASE}/timetables/${v.id}/generate`,
    body: (v) => omit(v, "id"),
    schema: schedulingGenerationReportDtoSchema,
    invalidate: [...TT_KEYS, ...OCC_KEYS],
  });
}

// ---------------------------------------------------------------------------
// Export iCalendar par jeton révocable
// ---------------------------------------------------------------------------

export function useIcsTokens(scope: "CLASSROOM" | "STAFF" | "STUDENT" | "ROOM", subjectId: string | null) {
  return hooks.useApiQuery([...KEY, "ics", scope, subjectId], `${SCHEDULING_BASE}/export/tokens`, { schema: itemsOf(icsTokenDtoSchema), select: pickItems, query: { scope, subjectId: subjectId ?? undefined }, enabled: subjectId !== null, retry: false });
}

export function useCreateIcsToken() {
  return useApiAction({
    path: `${SCHEDULING_BASE}/export/tokens`,
    body: (v: { scope: "CLASSROOM" | "STAFF" | "STUDENT" | "ROOM"; subjectId: string; label?: string; expiresInDays?: number }) => v,
    schema: icsTokenCreatedSchema,
    invalidate: [[...KEY, "ics"]],
  });
}

export function useRevokeIcsToken() {
  return useApiAction({ method: "DELETE", path: (v: { id: string }) => `${SCHEDULING_BASE}/export/tokens/${v.id}`, invalidate: [[...KEY, "ics"]] });
}

// ---------------------------------------------------------------------------
// Générateur d'emploi du temps (proposition -> examen -> application par un humain)
// ---------------------------------------------------------------------------
// Aucune règle de planification ici : l'API construit, vérifie et applique la proposition ; l'écran l'affiche.

export type AutogenRunBody = z.input<typeof schedulingAutogenRunBodySchema>;
export type AutogenApplyBody = z.input<typeof schedulingAutogenApplyBodySchema>;
export type AutogenRunDto = z.infer<typeof schedulingAutogenRunDtoSchema>;
export type AutogenRunDetailDto = z.infer<typeof schedulingAutogenRunDetailDtoSchema>;

const AUTOGEN_KEYS = [[...KEY, "autogen"]] as const;
const ACTIVE_STATUSES = new Set(["QUEUED", "RUNNING"]);

export function useAutogenDefaults(institutionId: string | null) {
  return hooks.useApiQuery([...KEY, "autogen", "defaults", institutionId], `${SCHEDULING_BASE}/autogen/defaults`, {
    schema: schedulingAutogenDefaultsDtoSchema,
    query: { institutionId: institutionId ?? undefined },
    enabled: institutionId !== null,
    retry: false,
  });
}

export function useAutogenRuns(query: { status?: string } = {}) {
  return hooks.useApiQuery([...KEY, "autogen", "runs"], `${SCHEDULING_BASE}/autogen/runs`, {
    schema: itemsOf(schedulingAutogenRunDtoSchema),
    select: pickItems,
    query: query as Query,
    // Une demande en file ou en calcul est relue toutes les 3 secondes jusqu'à sa fin.
    refetchInterval: (data) => (data?.items.some((r) => ACTIVE_STATUSES.has(r.status)) ? 3000 : false),
    retry: false,
  });
}

export function useAutogenRun(id: string | null) {
  return hooks.useApiQuery([...KEY, "autogen", "run", id], `${SCHEDULING_BASE}/autogen/runs/${id}`, {
    schema: schedulingAutogenRunDetailDtoSchema,
    enabled: id !== null,
    refetchInterval: (data) => (data && ACTIVE_STATUSES.has(data.run.status) ? 2000 : false),
    retry: false,
  });
}

export function useStartAutogenRun() {
  return useApiAction({ path: `${SCHEDULING_BASE}/autogen/runs`, body: (v: AutogenRunBody) => v, schema: schedulingAutogenStartedDtoSchema, invalidate: AUTOGEN_KEYS });
}

export function useApplyAutogenRun() {
  return useApiAction({
    path: (v: { id: string; body: AutogenApplyBody }) => `${SCHEDULING_BASE}/autogen/runs/${v.id}/apply`,
    body: (v) => v.body,
    schema: schedulingAutogenAppliedDtoSchema,
    invalidate: [...AUTOGEN_KEYS, ...TT_KEYS],
  });
}

export function useDiscardAutogenRun() {
  return useApiAction({
    path: (v: { id: string; reason?: string }) => `${SCHEDULING_BASE}/autogen/runs/${v.id}/discard`,
    body: (v) => (v.reason ? { reason: v.reason } : {}),
    schema: schedulingAutogenRunDtoSchema,
    invalidate: AUTOGEN_KEYS,
  });
}

/** Téléchargement ponctuel du calendrier (iCalendar) : texte du fichier. */
export function fetchIcsDownload(query: { scope: "CLASSROOM" | "STAFF" | "STUDENT" | "ROOM"; subjectId: string; from?: string; to?: string }): Promise<string> {
  return platformApi.get<string>(`${SCHEDULING_BASE}/export/download.ics`, { query, responseType: "text" });
}
