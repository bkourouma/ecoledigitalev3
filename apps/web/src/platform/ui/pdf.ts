import { ApiError, ClientErrorCode } from "@/platform/api/errors";
import { platformApi } from "@/platform/api/default-client";

/**
 * Téléchargement d'un PDF servi directement par l'API (reçu, bulletin de paie…) : la requête porte le jeton (jamais un lien
 * public), la réponse est lue en `blob` et ouverte localement. L'API répond `202` (JSON `{ status, retryAfterSeconds }`) tant que
 * le document est en cours de rendu : on réessaie quelques fois puis on le signale (`pending`) plutôt que d'attendre sans fin.
 */
export type PdfOutcome = { state: "done" } | { state: "pending"; retryAfterSeconds: number };

export interface PdfOptions {
  /** Nombre de nouvelles interrogations tant que le document est en cours de rendu (défaut : 4). */
  attempts?: number;
  /** Attente entre deux interrogations, en ms (défaut : `retryAfterSeconds` de l'API, 2 s au plus). */
  sleep?: (ms: number) => Promise<void>;
  /** Enregistrement du fichier (par défaut : lien `download` du navigateur). Injectable pour les tests. */
  save?: (blob: Blob, fileName: string) => void;
}

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export function saveBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.rel = "noopener";
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function isPdf(blob: Blob): boolean {
  return blob.type.toLowerCase().includes("pdf");
}

/** `Blob.text()` quand il existe, sinon `FileReader` (environnements anciens ou simulés). */
function readBlobText(blob: Blob): Promise<string> {
  if (typeof blob.text === "function") return blob.text();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(reader.error);
    reader.readAsText(blob);
  });
}

async function pendingSeconds(blob: Blob): Promise<number> {
  try {
    const text = await readBlobText(blob);
    const parsed = JSON.parse(text) as { retryAfterSeconds?: unknown };
    return typeof parsed.retryAfterSeconds === "number" && parsed.retryAfterSeconds > 0 ? parsed.retryAfterSeconds : 2;
  } catch {
    return 2;
  }
}

export async function downloadPdf(path: string, fileName: string, options: PdfOptions = {}): Promise<PdfOutcome> {
  const attempts = options.attempts ?? 4;
  const sleep = options.sleep ?? wait;
  const save = options.save ?? saveBlob;
  let retryAfter = 2;
  for (let i = 0; i <= attempts; i += 1) {
    const blob = await platformApi.request<Blob, undefined>("GET", path, { responseType: "blob" });
    if (blob instanceof Blob && isPdf(blob)) {
      save(blob, fileName);
      return { state: "done" };
    }
    if (!(blob instanceof Blob)) throw new ApiError({ code: ClientErrorCode.RESPONSE_INVALID, message: "Réponse inattendue du serveur." });
    retryAfter = await pendingSeconds(blob);
    if (i < attempts) await sleep(Math.min(retryAfter, 2) * 1000);
  }
  return { state: "pending", retryAfterSeconds: retryAfter };
}
