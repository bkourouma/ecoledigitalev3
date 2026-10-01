/**
 * Données de référence par défaut du module (modèle de pack, spec 017 data-model §7), instanciées de façon
 * IDEMPOTENTE à la création du tenant (`tenancy.tenant.provisioned`) et à la demande (`seedReferenceData`).
 *
 * Ce sont des LIBELLÉS modifiables par l'établissement, jamais des règles : les jours fériés officiels et
 * les calendriers scolaires nationaux ne sont PAS codés ici (ils sont saisis par l'établissement, O-10), les
 * politiques de conflit valent `BLOCK` par défaut (absence de ligne) et les paramètres sont ceux du schéma.
 */
export interface DefaultRoomType {
  readonly code: string;
  readonly label: string;
}
export interface DefaultEventKind {
  readonly code: string;
  readonly label: string;
  readonly blocksTeaching: boolean;
}

export const DEFAULT_ROOM_TYPES: readonly DefaultRoomType[] = Object.freeze([
  { code: "CLASSROOM", label: "Salle de classe" },
  { code: "LAB", label: "Laboratoire" },
  { code: "AMPHITHEATER", label: "Amphithéâtre" },
  { code: "WORKSHOP", label: "Atelier" },
  { code: "SPORTS", label: "Salle de sport" },
  { code: "OTHER", label: "Autre" },
]);

export const DEFAULT_EVENT_KINDS: readonly DefaultEventKind[] = Object.freeze([
  { code: "HOLIDAY", label: "Jour férié", blocksTeaching: true },
  { code: "VACATION", label: "Vacances", blocksTeaching: true },
  { code: "CLOSURE", label: "Fermeture", blocksTeaching: true },
  { code: "EXAM_PERIOD", label: "Période d'examens", blocksTeaching: false },
  { code: "MEETING", label: "Réunion", blocksTeaching: false },
  { code: "EVENT", label: "Événement", blocksTeaching: false },
]);
