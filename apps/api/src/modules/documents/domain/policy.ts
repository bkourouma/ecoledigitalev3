/**
 * Politique d'accès aux documents — FONCTIONS PURES (spec 024 §4).
 *
 * Les droits RBAC (`ActorCaps`) disent quel NIVEAU d'action est permis ; cette politique décide SUR QUEL DOCUMENT, avec les
 * liens de l'appelant (`ActorLinks`) résolus à chaque requête. Aucun rôle codé en dur, aucune lecture de la base.
 *
 * ATTENTION : la liste SQL (`infrastructure/documents-repository.ts`, `visibilityPredicate`) applique les MÊMES règles ;
 * un test d'intégration compare les deux sur une matrice acteur x document. Toute modification ici se fait des deux côtés.
 */
import type { Actor, ActorCaps, CategoryFacts, DocumentConfidentiality, DocumentFacts, DocumentOwnerType, DocumentShareLevel, Uuid } from "./types";

export type AccessVia = "MANAGER" | "UPLOADER" | "SHARE" | "CATEGORY_GRANT" | "LEVEL" | "OWNER" | "GUARDIAN";

export interface Access {
  readonly view: boolean;
  readonly write: boolean;
  readonly share: boolean;
  readonly archive: boolean;
  readonly history: boolean;
  readonly via: readonly AccessVia[];
}

const NONE: Access = Object.freeze({ view: false, write: false, share: false, archive: false, history: false, via: Object.freeze([]) as readonly AccessVia[] });

/** `read` < `read.restricted` < `read.confidential` : chaque niveau inclut les précédents. */
export function tierAllows(caps: ActorCaps, confidentiality: DocumentConfidentiality): boolean {
  switch (confidentiality) {
    case "INTERNAL":
      return caps.read === true || caps.readRestricted === true || caps.readConfidential === true;
    case "RESTRICTED":
      return caps.readRestricted === true || caps.readConfidential === true;
    case "CONFIDENTIAL":
      return caps.readConfidential === true;
  }
}

/** Le lien de l'appelant avec le propriétaire du document : lui-même (élève), son propre dossier (personnel), son enfant. */
export type OwnerLink = "SELF" | "OWN" | "CHILD";

export function ownerLink(actor: Actor, ownerType: DocumentOwnerType, ownerId: Uuid | null): OwnerLink | null {
  if (ownerId === null) return null;
  if (ownerType === "STUDENT") {
    if (actor.links.studentId === ownerId) return "SELF";
    if (actor.links.childStudentIds.includes(ownerId)) return "CHILD";
  }
  if (ownerType === "STAFF" && actor.links.staffId === ownerId) return "OWN";
  return null;
}

/** Le propriétaire (ou son tuteur lié) peut-il DÉPOSER dans cette catégorie pour ce propriétaire ? */
export function ownerUploadAllowed(actor: Actor, category: Pick<CategoryFacts, "ownerUpload">, ownerType: DocumentOwnerType, ownerId: Uuid | null): boolean {
  if (!category.ownerUpload) return false;
  const link = ownerLink(actor, ownerType, ownerId);
  if (link === "SELF") return actor.caps.selfUpload === true;
  if (link === "CHILD") return actor.caps.childUpload === true;
  if (link === "OWN") return actor.caps.ownUpload === true;
  return false;
}

/** Le lien donne-t-il le droit de LIRE (selon l'audience de la catégorie) ? */
function audienceAllows(actor: Actor, doc: DocumentFacts): AccessVia | null {
  if (doc.visibility !== "INHERIT") return null;
  const link = ownerLink(actor, doc.ownerType, doc.ownerId);
  if (link === "SELF" && doc.category.audienceOwner && actor.caps.selfRead === true) return "OWNER";
  if (link === "OWN" && doc.category.audienceOwner && actor.caps.ownRead === true) return "OWNER";
  if (link === "CHILD" && doc.category.audienceGuardians && actor.caps.childRead === true) return "GUARDIAN";
  return null;
}

/**
 * Décision d'accès complète sur un document. Un document archivé n'est visible que de la gestion (`documents.manage`).
 * `share` / `archive` / `history` sont des capacités SUR CE DOCUMENT (permission RBAC + droit d'écriture ou vue).
 */
export function resolveAccess(actor: Actor, doc: DocumentFacts): Access {
  const { caps } = actor;
  if (caps.manage === true) {
    return { view: true, write: true, share: true, archive: true, history: true, via: ["MANAGER"] };
  }
  if (doc.status === "ARCHIVED") return NONE;

  const via: AccessVia[] = [];
  let write = false;
  const uploader = doc.createdBy === actor.userId;
  const link = ownerLink(actor, doc.ownerType, doc.ownerId);

  // R2 déposant : garde son dépôt tant qu'il a le droit de déposer OU que son lien propriétaire / parent est valide.
  if (uploader && (caps.upload === true || link !== null)) {
    via.push("UPLOADER");
    if (caps.upload === true || ownerUploadAllowed(actor, doc.category, doc.ownerType, doc.ownerId)) write = true;
  }
  // R3 partage explicite.
  if (doc.shareLevel !== null) {
    via.push("SHARE");
    if (doc.shareLevel === "WRITE") write = true;
  }
  // R4 droit de catégorie.
  if (doc.grantLevel !== null) {
    via.push("CATEGORY_GRANT");
    if (doc.grantLevel === "WRITE") write = true;
  }
  // R5 niveau de la catégorie (désactivé pour un document PRIVATE).
  if (doc.visibility !== "PRIVATE" && tierAllows(caps, doc.category.confidentiality)) {
    via.push("LEVEL");
    if (caps.upload === true) write = true;
  }
  // R6 propriétaire, R7 tuteur lié.
  const audience = audienceAllows(actor, doc);
  if (audience) via.push(audience);

  if (via.length === 0) return NONE;
  const uploaderWithRight = via.includes("UPLOADER");
  return {
    view: true,
    write,
    share: write && caps.share === true,
    archive: write && caps.archive === true,
    history: caps.historyRead === true || uploaderWithRight,
    via,
  };
}

export interface CreateDecision {
  readonly allowed: boolean;
  readonly via: AccessVia | null;
}

/**
 * Peut-on CRÉER un document dans cette catégorie pour ce propriétaire ?
 *  - gestion ; droit de catégorie WRITE ; `documents.upload` + niveau de la catégorie ; dépôt par le propriétaire / tuteur lié.
 */
export function resolveCreate(actor: Actor, category: CategoryFacts, owner: { type: DocumentOwnerType; id: Uuid | null }, grantLevel: DocumentShareLevel | null): CreateDecision {
  const { caps } = actor;
  if (caps.manage === true) return { allowed: true, via: "MANAGER" };
  if (grantLevel === "WRITE") return { allowed: true, via: "CATEGORY_GRANT" };
  if (caps.upload === true && tierAllows(caps, category.confidentiality)) return { allowed: true, via: "LEVEL" };
  if (ownerUploadAllowed(actor, category, owner.type, owner.id)) return { allowed: true, via: "OWNER" };
  return { allowed: false, via: null };
}

/**
 * La catégorie est-elle déposable par l'appelant POUR AU MOINS UN propriétaire ? Sert au drapeau `canUpload` des catégories
 * (affichage seulement : `resolveCreate` tranche au dépôt).
 */
export function canUploadSomewhere(actor: Actor, category: CategoryFacts, grantLevel: DocumentShareLevel | null): boolean {
  const { caps } = actor;
  if (category.status !== "ACTIVE") return false;
  if (caps.manage === true || grantLevel === "WRITE") return true;
  if (caps.upload === true && tierAllows(caps, category.confidentiality)) return true;
  if (!category.ownerUpload) return false;
  return (
    (caps.selfUpload === true && actor.links.studentId !== null) ||
    (caps.childUpload === true && actor.links.childStudentIds.length > 0) ||
    (caps.ownUpload === true && actor.links.staffId !== null)
  );
}

/** Niveaux de lecture que détient l'appelant (pour la requête SQL de visibilité). */
export function readableConfidentialities(caps: ActorCaps): DocumentConfidentiality[] {
  const out: DocumentConfidentiality[] = [];
  if (tierAllows(caps, "INTERNAL")) out.push("INTERNAL");
  if (tierAllows(caps, "RESTRICTED")) out.push("RESTRICTED");
  if (tierAllows(caps, "CONFIDENTIAL")) out.push("CONFIDENTIAL");
  return out;
}
