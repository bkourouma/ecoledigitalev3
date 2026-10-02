/**
 * Seuils de LECTURE des tableaux de bord (feux tricolores), valeurs par défaut quand l'établissement n'a rien réglé
 * (`analytics.settings`). Ce ne sont NI des règles de calcul NI des seuils académiques : ils ne changent aucun chiffre,
 * seulement la couleur et le libellé qui l'accompagne. Reprise du legacy (`owner-pulse.service.ts` : présence 85 / 70 %,
 * recouvrement 80 / 60 %), réglable par établissement (`PUT /api/v1/analytics/settings`).
 */
export interface DisplayThresholds {
  collectionGoodBps: number;
  collectionWarningBps: number;
  attendanceGoodBps: number;
  attendanceWarningBps: number;
  /** Au-delà, une réponse est signalée `stale` (les données sont plus anciennes que cela). */
  staleAfterSeconds: number;
}

export const DEFAULT_DISPLAY_THRESHOLDS: Readonly<DisplayThresholds> = Object.freeze({
  collectionGoodBps: 8_000,
  collectionWarningBps: 6_000,
  attendanceGoodBps: 8_500,
  attendanceWarningBps: 7_000,
  staleAfterSeconds: 86_400,
});
