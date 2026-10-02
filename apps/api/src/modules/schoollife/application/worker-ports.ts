/**
 * Ports de `schoollife` pour le PROCESSUS DU WORKER (jobs `schoollife.remind-convocations`, `schoollife.exclusion-boundaries`) :
 * `installWorkerAdapters` (platform/adapters) les branche par `setSchoolLifeWorkerPorts`. Un port non branché fait échouer FERMÉ
 * l'envoi concerné (`schoollife.port_unavailable`) : la ligne `job_notifications` passe `FAILED` et sera reprise.
 */
import type { SchoolLifePorts } from "./ports";

let workerPorts: Partial<SchoolLifePorts> = {};

function definedOnly<T extends object>(value: T): Partial<T> {
  return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined)) as Partial<T>;
}

export function setSchoolLifeWorkerPorts(ports: Partial<SchoolLifePorts>): void {
  workerPorts = { ...workerPorts, ...definedOnly(ports) };
}

export function schoolLifeWorkerPorts(): Partial<SchoolLifePorts> {
  return workerPorts;
}

export function resetSchoolLifeWorkerPorts(): void {
  workerPorts = {};
}
