/**
 * Registre des ports du module (câblage inter-modules).
 *
 * `scheduling` ne dépend d'aucun module métier : les modules `academic`, `people` et `attendance`
 * enregistrent leur implémentation des ports (`AcademicQuery`, `PeopleQuery`, `AttendanceQuery`) au
 * démarrage, via l'`index.ts` public de `scheduling` :
 *
 *     import { registerSchedulingPorts } from "../scheduling";
 *     registerSchedulingPorts({ academic: createAcademicQuery(...) });
 *
 * La résolution est PARESSEUSE (à l'appel d'un cas d'usage) : l'ordre de chargement des modules n'est pas
 * porteur de sens. Tant qu'un port n'est pas enregistré, le comportement est le repli documenté
 * (spec 017 §7) : sans `academic`, aucune écriture liée à une classe (échec fermé) ; sans `people`, pas
 * d'avertissements de disponibilité ni de contrôle d'affectation.
 */
import type { AcademicQuery } from "./application/ports/academic";
import type { AttendanceQuery } from "./application/ports/attendance";
import type { PeopleQuery } from "./application/ports/people";
import type { SchedulingPorts } from "./application/deps";

interface Registered {
  academic: AcademicQuery | null;
  people: PeopleQuery | null;
  attendance: AttendanceQuery | null;
}

const registered: Registered = { academic: null, people: null, attendance: null };

export function registerSchedulingPorts(ports: Partial<{ academic: AcademicQuery; people: PeopleQuery; attendance: AttendanceQuery }>): void {
  if (ports.academic) registered.academic = ports.academic;
  if (ports.people) registered.people = ports.people;
  if (ports.attendance) registered.attendance = ports.attendance;
}

/** Pour les tests : retire tous les ports enregistrés. */
export function resetSchedulingPorts(): void {
  registered.academic = null;
  registered.people = null;
  registered.attendance = null;
}

/** Ports résolus à l'appel (getters sur le registre). */
export const registryPorts: SchedulingPorts = {
  get academic() {
    return registered.academic;
  },
  get people() {
    return registered.people;
  },
  get attendance() {
    return registered.attendance;
  },
};
