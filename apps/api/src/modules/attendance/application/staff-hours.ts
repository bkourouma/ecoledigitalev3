/**
 * Heures de présence du personnel, pour la paie (origine `ATTENDANCE` : packs primaire et secondaire) — lecture seule.
 *
 * Une présence est « terminée » quand l'arrivée ET le départ sont pointés et que son statut compte comme présent (drapeau
 * `counts_as_present` du statut, donnée d'établissement : aucun code de statut n'est codé ici). La durée est l'écart exact
 * entre l'arrivée et le départ, arrondi à la minute. Le contrôle de validité de la durée (1 à 1 440 minutes) et le prédicat
 * de payabilité appartiennent à `payroll`.
 *
 * Extension ADDITIVE du module (spec 032 §5.4 : « présences enseignants COMPLETED ») ; pas de nouvelle table.
 */
import type { AppError, RequestContext, Result } from "@ecoledigitale/kernel";
import { ok } from "@ecoledigitale/kernel";
import { indexStatuses } from "../domain/status";
import type { IsoDate, Uuid } from "../domain/types";
import { listStatuses } from "../infrastructure/reference-repository";
import { listStaffRecords } from "../infrastructure/staff-repository";
import { inTx, type AttendanceDeps } from "./deps";

export interface CompletedStaffPresence {
  readonly attendanceId: Uuid;
  readonly staffId: Uuid;
  readonly date: IsoDate;
  readonly occurrenceId: Uuid | null;
  readonly checkInAt: Date;
  readonly checkOutAt: Date;
  readonly durationMinutes: number;
}

const PAGE = 200;
const MAX_PAGES = 500;

export async function listCompletedStaffPresence(
  deps: AttendanceDeps,
  ctx: RequestContext,
  input: { from: IsoDate; to: IsoDate; staffIds?: readonly Uuid[] | undefined },
): Promise<Result<CompletedStaffPresence[], AppError>> {
  const wanted = input.staffIds ? new Set(input.staffIds) : null;
  return inTx(
    deps,
    ctx,
    async (tx) => {
      const statuses = indexStatuses(await listStatuses(tx, "STAFF"), "STAFF");
      const out: CompletedStaffPresence[] = [];
      let cursor: string | undefined;
      for (let page = 0; page < MAX_PAGES; page += 1) {
        const r = await listStaffRecords(tx, { from: input.from, to: input.to, limit: PAGE, ...(cursor ? { cursor } : {}) });
        for (const rec of r.items) {
          if (wanted && !wanted.has(rec.staffId)) continue;
          if (!rec.checkInAt || !rec.checkOutAt) continue;
          if (!statuses.get(rec.statusCode)?.countsAsPresent) continue;
          const minutes = Math.round((rec.checkOutAt.getTime() - rec.checkInAt.getTime()) / 60_000);
          if (minutes <= 0) continue;
          out.push({ attendanceId: rec.id, staffId: rec.staffId, date: rec.workDate, occurrenceId: rec.occurrenceId, checkInAt: rec.checkInAt, checkOutAt: rec.checkOutAt, durationMinutes: minutes });
        }
        if (!r.nextCursor) break;
        cursor = r.nextCursor;
      }
      return ok(out);
    },
    { readOnly: true },
  );
}
