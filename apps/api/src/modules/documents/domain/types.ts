/**
 * Types du domaine (purs). Les énumérations viennent des contrats pour que le client et l'API partagent le vocabulaire.
 */
import type {
  DocumentConfidentiality,
  DocumentKind,
  DocumentOwnerType,
  DocumentShareLevel,
  DocumentStatus,
  DocumentVisibility,
} from "@ecoledigitale/contracts/src/v2/documents";

export type Uuid = string;
export type { DocumentConfidentiality, DocumentKind, DocumentOwnerType, DocumentShareLevel, DocumentStatus, DocumentVisibility };

/** Capacités RBAC de l'appelant (une permission = un booléen), lues par `http/guards.ts`. Sans capacité : tout est faux. */
export interface ActorCaps {
  read?: boolean;
  readRestricted?: boolean;
  readConfidential?: boolean;
  upload?: boolean;
  share?: boolean;
  archive?: boolean;
  manage?: boolean;
  historyRead?: boolean;
  categoryManage?: boolean;
  settingsManage?: boolean;
  quarantineManage?: boolean;
  childRead?: boolean;
  childUpload?: boolean;
  selfRead?: boolean;
  selfUpload?: boolean;
  ownRead?: boolean;
  ownUpload?: boolean;
}

/** Liens de l'appelant, résolus par le port `OwnerDirectory` à CHAQUE appel (jamais d'un jeton ni du client). */
export interface ActorLinks {
  readonly studentId: Uuid | null;
  readonly childStudentIds: readonly Uuid[];
  readonly staffId: Uuid | null;
}

export const NO_LINKS: ActorLinks = Object.freeze({ studentId: null, childStudentIds: Object.freeze([]) as readonly Uuid[], staffId: null });

export interface Actor {
  readonly userId: Uuid;
  readonly caps: ActorCaps;
  readonly links: ActorLinks;
}

/** Faits d'une catégorie utiles à la décision d'accès. */
export interface CategoryFacts {
  readonly id: Uuid;
  readonly kind: DocumentKind;
  readonly confidentiality: DocumentConfidentiality;
  readonly audienceOwner: boolean;
  readonly audienceGuardians: boolean;
  readonly ownerUpload: boolean;
  readonly status: "ACTIVE" | "ARCHIVED";
}

/** Faits d'un document utiles à la décision d'accès (partage et droit de catégorie de l'appelant déjà résolus par la requête). */
export interface DocumentFacts {
  readonly id: Uuid;
  readonly status: DocumentStatus;
  readonly visibility: DocumentVisibility;
  readonly createdBy: Uuid;
  readonly ownerType: DocumentOwnerType;
  readonly ownerId: Uuid | null;
  readonly category: CategoryFacts;
  /** Niveau du partage ACTIF de l'appelant (non révoqué, non expiré), sinon `null`. */
  readonly shareLevel: DocumentShareLevel | null;
  /** Niveau du droit de catégorie ACTIF de l'appelant, sinon `null`. */
  readonly grantLevel: DocumentShareLevel | null;
}
