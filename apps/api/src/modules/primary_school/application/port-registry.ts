/**
 * Registre des ports de `primary_school` branchés APRÈS la construction des dépendances (adaptateurs de plateforme
 * `apps/api/src/platform/adapters/*-primary.ts`). Résolution PARESSEUSE (ordre de chargement des modules indifférent) ; un port
 * absent fait échouer FERMÉ (`primary_school.port_unavailable`).
 *
 * API : un registre par application Fastify (`app.primarySchoolPorts`, posé par `setup`) ; abonnés et jobs du worker :
 * `setPrimarySchoolWorkerPorts` (par processus).
 */
import type { PrimarySchoolPorts } from "./ports";

export interface PrimarySchoolPortRegistry {
  register(ports: Partial<PrimarySchoolPorts>): void;
  readonly current: Partial<PrimarySchoolPorts>;
}

function definedOnly<T extends object>(value: T): Partial<T> {
  return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined)) as Partial<T>;
}

export function createPrimarySchoolPortRegistry(initial: Partial<PrimarySchoolPorts> = {}): PrimarySchoolPortRegistry {
  let current: Partial<PrimarySchoolPorts> = { ...definedOnly(initial) };
  return {
    register(ports) {
      current = { ...current, ...definedOnly(ports) };
    },
    get current() {
      return current;
    },
  };
}

let workerPorts: Partial<PrimarySchoolPorts> = {};

/** Ports du processus du worker (verrous de période, issues d'inscription, rendu des bilans). */
export function setPrimarySchoolWorkerPorts(ports: Partial<PrimarySchoolPorts>): void {
  workerPorts = { ...workerPorts, ...definedOnly(ports) };
}

export function primarySchoolWorkerPorts(): Partial<PrimarySchoolPorts> {
  return workerPorts;
}

export function resetPrimarySchoolWorkerPorts(): void {
  workerPorts = {};
}
