/**
 * Ports d'EXPLOITATION de finance, tous facultatifs (valeurs par défaut sûres) :
 *
 *   - `FinanceAlertPort`   : alerte à un humain quand le rapprochement ne peut plus conclure
 *                            (`finance.payment.reconciliation_needed`). Par défaut : journal d'erreur structuré
 *                            (`alert: true`), repris par la supervision (module d'observabilité, e-mail, chat…).
 *   - `FinanceMetricsPort` : compteurs (rapprochement, remboursements fournisseur). Par défaut : aucun.
 *
 * Ni l'un ni l'autre ne porte de donnée personnelle ni de secret : identifiants techniques et codes courts seulement.
 */
import type { Logger } from "@ecoledigitale/kernel";

export interface FinanceAlert {
  /** Code stable, ex. `finance.payment.reconciliation_needed`. */
  readonly code: string;
  readonly severity: "warning" | "critical";
  readonly tenantId: string;
  readonly subject: { readonly type: "payment" | "refund"; readonly id: string };
  /** Motif court (`unverifiable_no_provider_ref`, `attempts_exhausted`, `late_success`…). */
  readonly reason: string;
  readonly provider: string | null;
  readonly attempts: number;
}

export interface FinanceAlertPort {
  raise(alert: FinanceAlert): void | Promise<void>;
}

export interface FinanceMetricsPort {
  /** Incrémente un compteur (`finance_reconciliation_total`, étiquettes `outcome`, `subject`, `provider`). */
  count(name: string, value?: number, labels?: Readonly<Record<string, string>>): void;
}

export const noopMetrics: FinanceMetricsPort = Object.freeze({ count: () => undefined });

/** Alerte par défaut : une ligne d'erreur structurée que la supervision sait filtrer (`alert: true`). */
export function logAlerts(logger: Logger): FinanceAlertPort {
  return {
    raise(alert) {
      logger.error({ alert: true, ...alert }, `ALERTE finance : ${alert.code} (${alert.reason})`);
    },
  };
}

/** Noms de compteurs publiés (documentés dans le README du module). */
export const FinanceMetricNames = {
  /** Un sujet traité par le job : étiquettes `subject` (payment|refund), `outcome`. */
  RECONCILIATION: "finance_reconciliation_total",
  /** Un passage du job : étiquette `tenants`. */
  RECONCILIATION_RUNS: "finance_reconciliation_runs_total",
  /** Un remboursement envoyé au fournisseur : étiquettes `provider`, `outcome`. */
  PROVIDER_REFUND: "finance_provider_refund_total",
} as const;
