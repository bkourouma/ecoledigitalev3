/**
 * Références vers le cœur académique (futur module `academic`).
 *
 * Le module finance NE DÉPEND PAS de ce cœur : il ne connaît un apprenant ou une
 * inscription que par leur UUID et par ces deux projections minimales, fournies par
 * des PORTS (`LearnerDirectory`, `EnrollmentDirectory` — voir `application/ports`).
 * Tant que le cœur académique n'existe pas, des adaptateurs « passe-plat » acceptent
 * tout UUID ; plus tard un adaptateur appellera l'API publique du module `academic`.
 */
import type { Uuid } from "./types";

export interface LearnerRef {
  readonly learnerId: Uuid;
  /** Nom d'affichage si connu (reçus, relevés). */
  readonly displayName?: string | null;
  /** Matricule / numéro d'élève si connu. */
  readonly registrationNumber?: string | null;
}

export interface EnrollmentRef {
  readonly enrollmentId: Uuid;
  readonly learnerId: Uuid;
  readonly academicYear: string;
  /**
   * Clé de REGROUPEMENT LIBRE pour « créances par classe » : l'adaptateur y met ce qui
   * a du sens (identifiant de classe, de filière, de promotion…). Le module finance
   * la stocke telle quelle sur la facture (instantané) et ne l'interprète jamais.
   */
  readonly groupKey?: string | null;
  readonly groupLabel?: string | null;
  readonly institutionId?: Uuid | null;
  readonly campusId?: Uuid | null;
  readonly levelKey?: string | null;
  readonly trackKey?: string | null;
  readonly learnerType?: string | null;
}
