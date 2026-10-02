/**
 * Événements publiés par le module higher (outbox, ADR-004).
 *
 * Nommage `higher.<entité>.<verbe-passé>` ; payload JSON versionné `{ v: 1, … }`. On ajoute des champs, on n'en retire
 * jamais sans nouvelle version. Aucun payload ne contient de donnée d'identité ni de note : identifiants, codes, crédits
 * (schémas Zod : `packages/contracts/src/v2/higher.ts`).
 */
export const HigherEvents = {
  CREDITS_CAPITALIZED: "higher.credits.capitalized",
  CREDITS_REVOKED: "higher.credits.revoked",
  CREDITS_EXPIRED: "higher.credits.expired",
  CREDITS_REVOCATION_BLOCKED: "higher.credits.revocation_blocked",
  UE_DEBT_DETECTED: "higher.ue.debt_detected",
  RESIT_WINDOW_OPENED: "higher.resit.window_opened",
  RESIT_WINDOW_CLOSED: "higher.resit.window_closed",
  RESIT_REGISTERED: "higher.resit.registered",
  DIPLOMA_ELIGIBLE: "higher.diploma.eligible",
  DIPLOMA_AWARDED: "higher.diploma.awarded",
  DIPLOMA_REVOKED: "higher.diploma.revoked",
  DOCUMENT_ISSUED: "higher.document.issued",
  /** Demande (ou reprise) du scellement et du rendu PDF d'un document : traitée dans le worker (Chromium). */
  DOCUMENT_RENDER_REQUESTED: "higher.document.render_requested",
} as const;

export type HigherEventType = (typeof HigherEvents)[keyof typeof HigherEvents];
export const ALL_HIGHER_EVENT_TYPES: ReadonlyArray<HigherEventType> = Object.values(HigherEvents);

/**
 * Événements consommés : `results.period.closed` (d'un AUTRE module — nom de travail à confirmer avec son producteur, voir
 * interfaces-publiees.md) et `higher.credits.capitalized` (le module écoute SON PROPRE événement dans un abonné distinct,
 * pour que l'éligibilité ne soit jamais dans la transaction de la capitalisation).
 */
export const ConsumedEvents = {
  RESULTS_PERIOD_CLOSED: "results.period.closed",
  CREDITS_CAPITALIZED: HigherEvents.CREDITS_CAPITALIZED,
  /** Ses propres événements déclenchent le scellement et le rendu des PDF (abonnés du worker). */
  DOCUMENT_ISSUED: HigherEvents.DOCUMENT_ISSUED,
  DOCUMENT_RENDER_REQUESTED: HigherEvents.DOCUMENT_RENDER_REQUESTED,
} as const;
