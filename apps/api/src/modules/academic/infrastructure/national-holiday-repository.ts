/**
 * Calendrier national des jours fériés (O-10) : référence GLOBALE `academic.national_holidays` (lecture seule pour un
 * tenant) et réglage par établissement `academic.institution_national_holiday_settings` (RLS tenant).
 */
import type { Tx } from "@ecoledigitale/database";
import type { NationalHoliday } from "../domain/national-holidays";

const COLS = "code, country_code, label, recurrence, month, day, source_kind, source_reference, needs_confirmation, note, active";

function map(r: Record<string, unknown>): NationalHoliday {
  return {
    code: r.code as string,
    countryCode: r.country_code as string,
    label: r.label as string,
    recurrence: r.recurrence as NationalHoliday["recurrence"],
    month: r.month === null || r.month === undefined ? null : Number(r.month),
    day: r.day === null || r.day === undefined ? null : Number(r.day),
    sourceKind: r.source_kind as NationalHoliday["sourceKind"],
    sourceReference: (r.source_reference as string | null) ?? null,
    needsConfirmation: Boolean(r.needs_confirmation),
    note: (r.note as string | null) ?? null,
    active: Boolean(r.active),
  };
}

export async function listNationalHolidays(tx: Tx, countryCode: string): Promise<NationalHoliday[]> {
  const rows = await tx.many(`SELECT ${COLS} FROM academic.national_holidays WHERE country_code = $1 AND active ORDER BY recurrence, month NULLS LAST, day NULLS LAST, code`, [countryCode]);
  return rows.map(map);
}

export async function getNationalHoliday(tx: Tx, countryCode: string, code: string): Promise<NationalHoliday | null> {
  const r = await tx.queryOne(`SELECT ${COLS} FROM academic.national_holidays WHERE country_code = $1 AND code = $2`, [countryCode, code]);
  return r ? map(r as Record<string, unknown>) : null;
}

/** Codes explicitement DÉSACTIVÉS par l'établissement (sans ligne = activé). */
export async function listDisabledCodes(tx: Tx, institutionId: string): Promise<Set<string>> {
  const rows = await tx.many<{ national_holiday_code: string }>(
    "SELECT national_holiday_code FROM academic.institution_national_holiday_settings WHERE institution_id = $1 AND NOT enabled",
    [institutionId],
  );
  return new Set(rows.map((r) => r.national_holiday_code));
}

export async function upsertSetting(tx: Tx, v: { id: string; institutionId: string; code: string; enabled: boolean; updatedBy: string | null }): Promise<void> {
  await tx.query(
    `INSERT INTO academic.institution_national_holiday_settings (id, tenant_id, institution_id, national_holiday_code, enabled, updated_by)
     VALUES ($1, kernel.current_tenant_id(), $2, $3, $4, $5)
     ON CONFLICT (tenant_id, institution_id, national_holiday_code) DO UPDATE SET enabled = EXCLUDED.enabled, updated_by = EXCLUDED.updated_by, updated_at = now()`,
    [v.id, v.institutionId, v.code, v.enabled, v.updatedBy],
  );
}
