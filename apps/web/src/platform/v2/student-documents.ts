"use client";

/**
 * Hooks typés des PIÈCES D'ÉLÈVE (`/api/v1/people/students/:id/documents`). Schémas Zod de `packages/contracts/src/v2/people.ts`.
 *
 * - le fichier est envoyé en CORPS BINAIRE BRUT (`PUT`, `Content-Type` = type du fichier), ni JSON ni multipart ; les métadonnées
 *   voyagent dans la chaîne de requête (même client authentifié que le reste : jeton et tenant) ;
 * - la consultation passe par une URL SIGNÉE demandée à la volée (jamais stockée, jamais affichée) ;
 * - la lecture est une permission sensible (`student.sensitive.read`) AUDITÉE côté serveur ; l'écriture exige `student.update`.
 *
 * Le web ne contrôle que la commodité (types PDF / JPEG / PNG / WebP, 8 Mo, un fichier) : le type réel (octets magiques), les
 * doublons (409 `people.document_exists`) et l'échéance sont décidés par le serveur.
 */

import { z } from "zod";
import { platformHooks as hooks } from "@/platform/api/default-client";
import {
  PEOPLE_DOCUMENT_CONTENT_TYPES,
  peopleStudentDocumentDtoSchema,
  peopleStudentDocumentUrlDtoSchema,
  type PeopleStudentDocumentType,
  type PeopleUpdateStudentDocumentBody,
} from "@ecoledigitale/contracts/v2/people";
import { useApiAction } from "./actions";
import { PEOPLE_BASE } from "./people";

/** Taille maximale proposée côté écran (contrôle de commodité ; le serveur applique sa propre limite). */
export const MAX_DOCUMENT_BYTES = 8 * 1024 * 1024;
export const DOCUMENT_CONTENT_TYPES = PEOPLE_DOCUMENT_CONTENT_TYPES;
/** Délai d'un envoi de fichier (ms) : au-delà des 30 s des appels JSON. */
const UPLOAD_TIMEOUT_MS = 120_000;

export type DocumentExpiryFilter = "" | "EXPIRING" | "EXPIRED";
export interface StudentDocumentsQuery {
  includeHistory?: boolean;
  expiry?: DocumentExpiryFilter;
}

const DOCS_KEY = ["people", "students", "documents"] as const;

export function useStudentDocuments(studentId: string | null, query: StudentDocumentsQuery, enabled = true) {
  return hooks.useApiQuery(["people", "students", "documents", studentId], `${PEOPLE_BASE}/students/${studentId}/documents`, {
    schema: z.object({ items: z.array(peopleStudentDocumentDtoSchema) }),
    select: (d) => d.items,
    query: { ...(query.includeHistory ? { includeHistory: true } : {}), ...(query.expiry ? { expiry: query.expiry } : {}) },
    enabled: studentId !== null && enabled,
    retry: false,
    // Chaque lecture est auditée côté serveur : pas de relecture à chaque retour de fenêtre.
    refetchOnWindowFocus: false,
  });
}

export interface DocumentMetadata {
  title?: string;
  issuedOn?: string;
  expiresOn?: string;
}

const metaQuery = (m: DocumentMetadata) => ({ ...(m.title ? { title: m.title } : {}), ...(m.issuedOn ? { issuedOn: m.issuedOn } : {}), ...(m.expiresOn ? { expiresOn: m.expiresOn } : {}) });

/** Dépôt d'une nouvelle pièce (201). 409 `people.document_exists` : une pièce active de ce type existe déjà (proposer « Remplacer »). */
export function useUploadStudentDocument() {
  return useApiAction({
    method: "PUT",
    path: (v: { studentId: string; file: File; typeCode: PeopleStudentDocumentType } & DocumentMetadata) => `${PEOPLE_BASE}/students/${v.studentId}/documents`,
    query: (v) => ({ typeCode: v.typeCode, fileName: v.file.name, ...metaQuery(v) }),
    body: (v) => v.file,
    headers: (v) => ({ "Content-Type": v.file.type }),
    timeoutMs: UPLOAD_TIMEOUT_MS,
    schema: peopleStudentDocumentDtoSchema,
    invalidate: [DOCS_KEY],
  });
}

/** Remplacement : nouvelle version de la pièce (201), l'ancienne passe en historique. */
export function useReplaceStudentDocument() {
  return useApiAction({
    method: "PUT",
    path: (v: { studentId: string; documentId: string; file: File } & DocumentMetadata) => `${PEOPLE_BASE}/students/${v.studentId}/documents/${v.documentId}`,
    query: (v) => ({ fileName: v.file.name, ...metaQuery(v) }),
    body: (v) => v.file,
    headers: (v) => ({ "Content-Type": v.file.type }),
    timeoutMs: UPLOAD_TIMEOUT_MS,
    schema: peopleStudentDocumentDtoSchema,
    invalidate: [DOCS_KEY],
  });
}

export function useUpdateStudentDocument() {
  return useApiAction({
    method: "PATCH",
    path: (v: { studentId: string; documentId: string; patch: PeopleUpdateStudentDocumentBody }) => `${PEOPLE_BASE}/students/${v.studentId}/documents/${v.documentId}`,
    body: (v) => v.patch,
    schema: peopleStudentDocumentDtoSchema,
    invalidate: [DOCS_KEY],
  });
}

export function useRemoveStudentDocument() {
  return useApiAction({
    path: (v: { studentId: string; documentId: string; reason: string }) => `${PEOPLE_BASE}/students/${v.studentId}/documents/${v.documentId}/remove`,
    body: (v) => ({ reason: v.reason }),
    schema: z.object({ removed: z.boolean() }),
    invalidate: [DOCS_KEY],
  });
}

/**
 * URL signée de consultation, demandée au clic (valable peu de temps, auditée). Le lien n'est ni conservé ni affiché : l'appelant
 * l'ouvre aussitôt.
 */
export function requestStudentDocumentUrl(studentId: string, documentId: string) {
  return hooks.client.request("GET", `${PEOPLE_BASE}/students/${studentId}/documents/${documentId}/url`, { schema: peopleStudentDocumentUrlDtoSchema });
}
