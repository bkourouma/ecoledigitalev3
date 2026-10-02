/**
 * Registre des ports d'`admissions` branchés APRÈS la construction des dépendances (adaptateurs de plateforme
 * `apps/api/src/platform/adapters`) : `people`, `academic`, `finance`, catalogue, stockage de pièces, notifications, captcha.
 * Résolution PARESSEUSE (ordre de chargement des modules indifférent) ; un port absent fait échouer FERMÉ
 * (`admissions.port_unavailable`).
 *
 * API : un registre par application Fastify (`app.admissionsPorts`, posé par `setup`) ; jobs et abonnés du worker :
 * `setAdmissionsWorkerPorts` (par processus).
 */
import type { AdmissionsPorts } from "./ports";

export interface AdmissionsPortRegistry {
  register(ports: Partial<AdmissionsPorts>): void;
  readonly current: Partial<AdmissionsPorts>;
}

function definedOnly<T extends object>(value: T): Partial<T> {
  return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined)) as Partial<T>;
}

export function createAdmissionsPortRegistry(initial: Partial<AdmissionsPorts> = {}): AdmissionsPortRegistry {
  let current: Partial<AdmissionsPorts> = { ...definedOnly(initial) };
  return {
    register(ports) {
      current = { ...current, ...definedOnly(ports) };
    },
    get current() {
      return current;
    },
  };
}

let workerPorts: Partial<AdmissionsPorts> = {};

/** Ports du processus du worker (abonnés `academic.*`, jobs). */
export function setAdmissionsWorkerPorts(ports: Partial<AdmissionsPorts>): void {
  workerPorts = { ...workerPorts, ...definedOnly(ports) };
}

export function admissionsWorkerPorts(): Partial<AdmissionsPorts> {
  return workerPorts;
}

export function resetAdmissionsWorkerPorts(): void {
  workerPorts = {};
}
