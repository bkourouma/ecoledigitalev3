/**
 * Pont de présence EXTERNE (classe virtuelle, import) : `bulkMarkFromExternal`.
 *
 * Le seuil de présence (le legacy codait « connecté au moins 50 % du temps ») est la CONFIGURATION du module visio
 * (022/023) : ce pont reçoit un résultat déjà décidé. Il n'écrase JAMAIS un pointage saisi par un humain (enseignant,
 * direction, synchronisation hors-ligne, justificatif) : ces entrées sont ignorées et rapportées `SKIPPED_MANUAL`.
 */
import { err, ok, type AppError, type RequestContext, type Result } from "@ecoledigitale/kernel";
import { AttendanceCode, forbidden, notFound } from "../domain/errors";
import { checkEditable } from "../domain/session";
import type { AttendanceSession, RecordSource, Uuid } from "../domain/types";
import { getRecordsByEnrollments, getSession } from "../infrastructure/sessions-repository";
import { EventBuffer, inTx, type AttendanceDeps, type CallerCaps } from "./deps";
import { applyMarks, isSystem, loadSessionContext } from "./session-support";

export interface ExternalEntry {
  readonly studentId: Uuid;
  readonly statusCode: string;
  readonly evidence?: { readonly note?: string | undefined } | undefined;
}

export type ExternalOutcome = "APPLIED" | "UNCHANGED" | "SKIPPED_MANUAL";

export interface ExternalResult {
  readonly session: AttendanceSession;
  readonly results: Array<{ studentId: Uuid; outcome: ExternalOutcome; recordId: Uuid | null }>;
}

const EXTERNAL_SOURCES: readonly (RecordSource | null)[] = ["LIVE_CLASS", "IMPORT"];

export async function bulkMarkFromExternal(
  deps: AttendanceDeps,
  ctx: RequestContext,
  input: { sessionId: Uuid; entries: readonly ExternalEntry[]; caps?: CallerCaps },
): Promise<Result<ExternalResult, AppError>> {
  if (!input.caps?.manage && !isSystem(ctx)) {
    return err(forbidden(AttendanceCode.FORBIDDEN, "Le pont de présence externe est réservé au compte de service (gestion des appels)."));
  }
  return inTx(deps, ctx, async (tx) => {
    const events = new EventBuffer(deps, ctx);
    const session = await getSession(tx, input.sessionId, "SHARE");
    if (!session) return err(notFound(AttendanceCode.SESSION_NOT_FOUND, "Appel", input.sessionId));
    const context = await loadSessionContext(deps, ctx, tx, session);
    const editable = checkEditable(session, context.policy, { now: deps.clock.now(), canManage: true });
    if (!editable.ok) return editable;

    const enrollmentOf = new Map(context.roster.map((r) => [r.studentId, r.enrollmentId]));
    const existing = new Map(
      (await getRecordsByEnrollments(tx, session.id, input.entries.map((e) => enrollmentOf.get(e.studentId)).filter((x): x is Uuid => x !== undefined))).map((r) => [r.studentId, r]),
    );

    const results: ExternalResult["results"] = [];
    const toApply: ExternalEntry[] = [];
    for (const e of input.entries) {
      const rec = existing.get(e.studentId);
      if (rec && !EXTERNAL_SOURCES.includes(rec.sourceDetail)) results.push({ studentId: e.studentId, outcome: "SKIPPED_MANUAL", recordId: rec.id });
      else toApply.push(e);
    }

    if (toApply.length > 0) {
      const applied = await applyMarks(deps, ctx, tx, events, {
        session, context, source: "LIVE_CLASS",
        entries: toApply.map((e) => ({ studentId: e.studentId, statusCode: e.statusCode, note: e.evidence?.note })),
      });
      if (!applied.ok) return applied;
      const touched = new Set([...applied.value.outcome.created, ...applied.value.outcome.updated].map((r) => r.enrollmentId));
      const byStudent = new Map(applied.value.records.map((r) => [r.studentId, r]));
      for (const e of toApply) {
        const rec = byStudent.get(e.studentId);
        results.push({ studentId: e.studentId, outcome: touched.has(enrollmentOf.get(e.studentId) as Uuid) ? "APPLIED" : "UNCHANGED", recordId: rec?.id ?? null });
      }
    }
    await events.flush(tx);
    return ok({ session, results });
  });
}
