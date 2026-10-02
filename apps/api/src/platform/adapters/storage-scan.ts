/**
 * Analyse antivirus des dépôts qui ne passent PAS par le module `documents` : pièces jointes de `messaging`, photos d'élèves de
 * `people`, justificatifs de `attendance`. Un adaptateur enveloppe la vue de stockage de ces modules : chaque `put` est analysé
 * par le `MalwareScanner` de la plateforme (même politique que `documents`, fail-closed selon `DOCUMENTS_SCAN_FAIL_CLOSED`)
 * AVANT l'écriture. Aucun de ces modules n'est modifié.
 *
 *  - fichier infecté : refus (`documents.malware_detected`, erreur de validation du kernel : les cas d'usage de ces modules la
 *    transforment en réponse 400 ordinaire) ; pas de quarantaine (ces dépôts n'ont pas de document à libérer) ;
 *  - scanner injoignable : refus si fail-closed (`documents.scan_unavailable`), sinon écriture sans analyse ;
 *  - aucun scanner configuré : comportement inchangé.
 */
import { ValidationError } from "@ecoledigitale/kernel";
import type { ScanPolicy } from "../../modules/documents";

export interface PutLike {
  put(key: string, data: Uint8Array, options: { contentType: string }): Promise<unknown>;
}

const baseName = (key: string): string => key.split("/").pop() ?? key;

export function withMalwareScan<S extends PutLike>(storage: S, policy: () => ScanPolicy, warn?: (message: string) => void): S {
  return {
    ...storage,
    async put(key: string, data: Uint8Array, options: { contentType: string }): Promise<unknown> {
      const { scanner, failClosed } = policy();
      if (scanner) {
        const verdict = await scanner.scan(data, { fileName: baseName(key), mime: options.contentType });
        if (verdict.status === "INFECTED") {
          throw new ValidationError("Le fichier a été détecté comme malveillant : il n'a pas été enregistré.", [{ path: ["file"], message: "Fichier malveillant.", code: "documents.malware_detected" }], { code: "documents.malware_detected" });
        }
        if (verdict.status === "ERROR") {
          warn?.(`stockage : analyse antivirus indisponible (${verdict.reason})`);
          if (failClosed) {
            throw new ValidationError("L'analyse antivirus est momentanément indisponible : le fichier n'a pas été enregistré. Réessayez dans un instant.", [{ path: ["file"], message: "Analyse indisponible.", code: "documents.scan_unavailable" }], { code: "documents.scan_unavailable" });
          }
        }
      }
      return storage.put(key, data, options);
    },
  };
}
