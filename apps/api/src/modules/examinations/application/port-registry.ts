/**
 * Registre des ports de `examinations` branchés APRÈS la construction des dépendances (adaptateurs de plateforme
 * `apps/api/src/platform/adapters/examinations-*.ts`). Résolution PARESSEUSE (ordre de chargement des modules indifférent) ;
 * un port absent fait échouer FERMÉ (`examinations.port_unavailable`).
 *
 * API : un registre par application Fastify (`app.examinationsPorts`, posé par `setup`) ; abonnés et jobs du worker :
 * `setExaminationsWorkerPorts` (par processus).
 */
import type { ExaminationsPorts } from "./ports";

export interface ExaminationsPortRegistry {
  register(ports: Partial<ExaminationsPorts>): void;
  readonly current: Partial<ExaminationsPorts>;
}

function definedOnly<T extends object>(value: T): Partial<T> {
  return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined)) as Partial<T>;
}

export function createExaminationsPortRegistry(initial: Partial<ExaminationsPorts> = {}): ExaminationsPortRegistry {
  let current: Partial<ExaminationsPorts> = { ...definedOnly(initial) };
  return {
    register(ports) {
      current = { ...current, ...definedOnly(ports) };
    },
    get current() {
      return current;
    },
  };
}

let workerPorts: Partial<ExaminationsPorts> = {};

/** Ports du processus du worker. */
export function setExaminationsWorkerPorts(ports: Partial<ExaminationsPorts>): void {
  workerPorts = { ...workerPorts, ...definedOnly(ports) };
}

export function examinationsWorkerPorts(): Partial<ExaminationsPorts> {
  return workerPorts;
}

export function resetExaminationsWorkerPorts(): void {
  workerPorts = {};
}
