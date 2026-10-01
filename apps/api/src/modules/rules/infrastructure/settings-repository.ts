import type { Tx } from "@ecoledigitale/database";

export interface PlatformSettings {
  /** Seuil (en %) de décisions modifiées au-delà duquel la proposition exige une confirmation explicite (AC2.5). */
  readonly decisionImpactConfirmPercent: number;
  /** Séparation des tâches du catalogue national (AC3.4). */
  readonly nationalFourEyes: boolean;
  /** Part (en %) des résultats FINAL rejoués chaque nuit (AC4.3). */
  readonly replaySamplePercent: number;
}

export const DEFAULT_PLATFORM_SETTINGS: PlatformSettings = Object.freeze({
  decisionImpactConfirmPercent: 5,
  nationalFourEyes: true,
  replaySamplePercent: 1,
});

const KEYS = {
  decisionImpactConfirmPercent: "decision_impact_confirm_percent",
  nationalFourEyes: "national_four_eyes",
  replaySamplePercent: "replay_sample_percent",
} as const;

export async function readSettings(tx: Tx): Promise<PlatformSettings> {
  const rows = await tx.many<{ key: string; value: unknown }>("SELECT key, value FROM rules.platform_settings");
  const byKey = new Map(rows.map((r) => [r.key, r.value]));
  const num = (key: string, fallback: number): number => {
    const v = byKey.get(key);
    return typeof v === "number" && Number.isFinite(v) ? v : fallback;
  };
  const bool = (key: string, fallback: boolean): boolean => {
    const v = byKey.get(key);
    return typeof v === "boolean" ? v : fallback;
  };
  return {
    decisionImpactConfirmPercent: num(KEYS.decisionImpactConfirmPercent, DEFAULT_PLATFORM_SETTINGS.decisionImpactConfirmPercent),
    nationalFourEyes: bool(KEYS.nationalFourEyes, DEFAULT_PLATFORM_SETTINGS.nationalFourEyes),
    replaySamplePercent: num(KEYS.replaySamplePercent, DEFAULT_PLATFORM_SETTINGS.replaySamplePercent),
  };
}

/** Écrit les réglages fournis (transaction `system` : la RLS réserve l'écriture à cet acteur). */
export async function writeSettings(tx: Tx, patch: Partial<PlatformSettings>, updatedBy: string | null): Promise<void> {
  for (const [field, key] of Object.entries(KEYS) as Array<[keyof PlatformSettings, string]>) {
    const value = patch[field];
    if (value === undefined) continue;
    await tx.query(
      `INSERT INTO rules.platform_settings (key, value, updated_by) VALUES ($1, $2::jsonb, $3)
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_by = EXCLUDED.updated_by, updated_at = now()`,
      [key, JSON.stringify(value), updatedBy],
    );
  }
}
