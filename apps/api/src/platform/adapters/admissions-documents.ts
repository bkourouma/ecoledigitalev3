/**
 * admissions -> stockage d'objets / documents : `DocumentStore` des pièces justificatives d'une candidature.
 *
 * Contrôle du TYPE RÉEL par les octets (`detectFileType` du module `documents` : le type déclaré n'est jamais cru), liste blanche
 * de la pièce exigée, taille, empreinte SHA-256, ANTIVIRUS de la plateforme (même politique que `documents`, fail-closed selon
 * `DOCUMENTS_SCAN_FAIL_CLOSED`), puis écriture de l'objet par le stockage de la plateforme (S3 / MinIO, repli disque).
 *
 * Repli `StoragePort` (spec 007 §13) : la pièce est conservée sous `admissions/<tenant>/<candidature>/<pièce>/<empreinte>` et la
 * ligne `application_documents` porte `storage_key` (pas de `document_ref`). `link` ne sait alors que « non rattaché »
 * (`linked: false`). Interface attendue de `documents` (demande 024 de la spec 007 §16) : `DocumentStore.link` — rattacher un objet
 * externe au dossier d'un élève ; elle n'existe pas aujourd'hui, les pièces restent dans le stockage d'admissions (README).
 */
import { createHash } from "node:crypto";
import { ValidationError } from "@ecoledigitale/kernel";
import { AdmissionsCode, portUnavailable, type DocumentStore } from "../../modules/admissions";
import { detectFileType, type ScanPolicy } from "../../modules/documents";
import { asDocumentsStorage, type ObjectStorage } from "./storage";
import { withMalwareScan } from "./storage-scan";

const reject = (message: string): ValidationError => new ValidationError(message, [{ path: ["file"], message, code: AdmissionsCode.FILE_REJECTED }], { code: AdmissionsCode.FILE_REJECTED });

export function createAdmissionsDocumentStore(storage: ObjectStorage | null, scan: () => ScanPolicy): DocumentStore {
  const need = (): ObjectStorage => {
    if (!storage) throw portUnavailable("documents", "stockage d'objets (STORAGE_S3_BUCKET ou STORAGE_DISK_DIR)");
    return storage;
  };
  return {
    async store(ctx, input) {
      const store = need();
      if (input.bytes.byteLength === 0) throw reject("Le fichier est vide.");
      if (input.bytes.byteLength > input.maxSizeBytes) throw reject("Le fichier dépasse la taille maximale autorisée pour cette pièce.");
      const detected = detectFileType(input.bytes);
      if (!detected.ok) throw reject(detected.message);
      const mime = detected.type.mime;
      if (!input.acceptsMime.includes(mime)) throw reject("Ce type de fichier n'est pas accepté pour cette pièce.");
      const sha256 = createHash("sha256").update(input.bytes).digest("hex");
      const storageKey = `admissions/${ctx.tenantId}/${input.applicationId}/${input.requirementId}/${sha256}`;
      await withMalwareScan(asDocumentsStorage(store), scan).put(storageKey, input.bytes, { contentType: mime });
      return { storageKey, documentRef: null, contentType: mime, sizeBytes: input.bytes.byteLength, sha256 };
    },
    async remove(_ctx, piece) {
      if (piece.storageKey && storage) await storage.delete(piece.storageKey);
    },
    async link() {
      return { linked: false };
    },
    async signedUrl(_ctx, piece, options) {
      const store = need();
      if (!piece.storageKey) throw portUnavailable("documents", "pièce sans objet de stockage");
      return store.signedUrl(piece.storageKey, { ttlSeconds: options.ttlSeconds, fileName: options.fileName, contentType: options.contentType });
    },
  };
}
