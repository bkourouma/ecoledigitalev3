/**
 * Registre de ports PROCESS-WIDE pour les abonnés et jobs du worker.
 *
 * L'API enregistre ses ports par application Fastify (`registerHigherPorts(app, ports)`) ; le worker n'a pas d'application
 * Fastify : les modules voisins (`results`, `academic`, `people`, `reportcards`) appellent
 * `registerHigherWorkerPorts({ credits, curriculum, … })` depuis leur propre `subscribers.ts` (chargé par le worker), avec
 * des implémentations qui n'ont besoin que d'un `TenantDb` (aucune dépendance HTTP). Tant qu'un port manque, les abonnés
 * ÉCHOUENT FERMÉ (`higher.port_unavailable`) et l'événement est rejoué — jamais de capitalisation sans la source des résultats.
 *
 * Le port des règles est fourni par défaut par `subscribers.ts` (API du module rules construite sur le `TenantDb` du worker).
 */
import type { HigherPorts } from "./application/ports";

let registered: Partial<HigherPorts> = {};

/** Enregistre (ou remplace) des ports pour le worker. */
export function registerHigherWorkerPorts(ports: Partial<HigherPorts>): void {
  registered = { ...registered, ...ports };
}

/** Ports courants (copie défensive). */
export function workerPorts(): Partial<HigherPorts> {
  return { ...registered };
}

/** Pour les tests : remet le registre à zéro. */
export function resetHigherWorkerPorts(): void {
  registered = {};
}
