/**
 * Port `AttendanceQuery` (facultatif) — état de l'appel d'une séance, implémenté par le module
 * `attendance` (spec 010). Sert uniquement à enrichir le détail d'une séance (`attendanceSubmitted`) ;
 * aucune règle de planification n'en dépend (le constat arrive par l'événement
 * `attendance.session.submitted`).
 */
import type { RequestContext } from "@ecoledigitale/kernel";

export interface AttendanceQuery {
  hasSubmittedAttendance(ctx: RequestContext, occurrenceId: string): Promise<boolean>;
}
