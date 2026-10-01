/**
 * Registre de ports de `people` branchés APRÈS la construction des dépendances (adaptateurs de plateforme
 * `apps/api/src/platform/adapters`) : `academic` (affectations, garde d'offre), `storage` (photos), `enrollments`,
 * `country`, `accounts`. Résolution PARESSEUSE ; un port absent garde son repli sûr (voir README).
 *
 * API : un registre par application Fastify (`app.peoplePorts`, posé par `setup`) ; abonnés du worker : `setPeopleWorkerPorts`
 * (par processus).
 */
import type { AccountProvisioner, AcademicQuery, CountryProfileProvider, EnrollmentDirectory, StoragePort } from "./ports";

export interface PeoplePortSet {
  accounts: AccountProvisioner;
  storage: StoragePort;
  academic: AcademicQuery;
  enrollments: EnrollmentDirectory;
  country: CountryProfileProvider;
}

export interface PeoplePortRegistry {
  register(ports: Partial<PeoplePortSet>): void;
  readonly current: Partial<PeoplePortSet>;
}

function definedOnly<T extends object>(value: T): Partial<T> {
  return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined)) as Partial<T>;
}

export function createPeoplePortRegistry(initial: Partial<PeoplePortSet> = {}): PeoplePortRegistry {
  let current: Partial<PeoplePortSet> = { ...definedOnly(initial) };
  return {
    register(ports) {
      current = { ...current, ...definedOnly(ports) };
    },
    get current() {
      return current;
    },
  };
}

let workerPorts: Partial<PeoplePortSet> = {};

/** Ports du processus du worker (abonnés et jobs de people). */
export function setPeopleWorkerPorts(ports: Partial<PeoplePortSet>): void {
  workerPorts = { ...workerPorts, ...definedOnly(ports) };
}

export function peopleWorkerPorts(): Partial<PeoplePortSet> {
  return workerPorts;
}

export function resetPeopleWorkerPorts(): void {
  workerPorts = {};
}
