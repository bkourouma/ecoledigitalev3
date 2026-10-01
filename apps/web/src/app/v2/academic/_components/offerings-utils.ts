import type { AcademicNodeTypeDto } from "@ecoledigitale/contracts/v2/academic";

/** Un type de nœud est une « période » quand la grammaire (donnée de l'API) lui impose un créneau de période. */
export function academicOpenPeriodOffersTypeGuard(type: AcademicNodeTypeDto): boolean {
  return type.requiresPeriodSlot;
}

export interface OpenPeriodForm {
  periodNodeId: string;
  startsOn: string;
  endsOn: string;
  registrationOpensAt: string;
  registrationClosesAt: string;
  capacity: string;
  open: boolean;
}

/**
 * Corps de `POST /classrooms/:id/offerings/open-period` à partir de la saisie. Les bornes de fenêtre sont des dates
 * (champ `date`) : début de journée pour l'ouverture, fin de journée pour la clôture (instants UTC ISO 8601).
 */
export function buildOpenPeriodBody(form: OpenPeriodForm): Record<string, unknown> {
  const body: Record<string, unknown> = { periodNodeId: form.periodNodeId, startsOn: form.startsOn, endsOn: form.endsOn };
  if (form.registrationOpensAt) body.registrationOpensAt = `${form.registrationOpensAt}T00:00:00.000Z`;
  if (form.registrationClosesAt) body.registrationClosesAt = `${form.registrationClosesAt}T23:59:59.000Z`;
  if (form.capacity.trim()) body.capacity = Number(form.capacity);
  if (form.open) body.open = true;
  return body;
}
