/**
 * Utility functions for downloading and viewing files with authentication
 * 
 * These functions use fetch (which goes through the fetch interceptor)
 * to ensure authentication headers are properly included.
 */

/**
 * Download a file using fetch with authentication and open it in a new tab
 * 
 * @param fileUrl - The URL of the file to download (relative or absolute)
 * @param options - Optional configuration
 * @returns Promise that resolves when the file is opened
 */
export async function downloadFileWithAuth(
  fileUrl: string,
  options: {
    onError?: (error: Error) => void;
    onSuccess?: () => void;
    fileName?: string;
  } = {}
): Promise<void> {
  const { onError, onSuccess, fileName } = options;

  try {
    console.log('📥 Downloading file with authentication:', fileUrl);

    // Ensure URL is relative to use Next.js proxy and fetch interceptor
    const normalizedUrl = fileUrl.startsWith('http') 
      ? fileUrl.replace(/^https?:\/\/[^/]+/, '')
      : fileUrl;

    // Use fetch (which goes through fetch interceptor for authentication)
    const response = await fetch(normalizedUrl, {
      method: 'GET',
      // Headers will be automatically added by fetch interceptor
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => '');
      let errorMessage = `Erreur ${response.status}: ${response.statusText}`;
      
      try {
        const errorData = JSON.parse(errorText);
        errorMessage = errorData.error || errorData.message || errorMessage;
      } catch {
        if (errorText) {
          errorMessage = errorText;
        }
      }

      // Provide more user-friendly error messages
      if (response.status === 404) {
        errorMessage = `Fichier introuvable (404). L'URL "${normalizedUrl}" n'existe pas ou le fichier a été supprimé.`;
      } else if (response.status === 403) {
        errorMessage = `Accès refusé (403). Vous n'avez pas l'autorisation d'accéder à ce fichier.`;
      } else if (response.status === 401) {
        errorMessage = `Non autorisé (401). Vous devez être connecté pour accéder à ce fichier.`;
      } else if (response.status === 500) {
        errorMessage = `Erreur serveur (500). Le serveur a rencontré une erreur lors du traitement de votre demande.`;
      }

      throw new Error(errorMessage);
    }

    // Get file content as blob
    const blob = await response.blob();
    
    // Create blob URL
    const blobUrl = URL.createObjectURL(blob);
    
    console.log('✅ File downloaded successfully, opening file');

    // Try to open in new tab first
    let newWindow: Window | null = null;
    try {
      newWindow = window.open(blobUrl, '_blank', 'noopener,noreferrer');
    } catch (error) {
      console.warn('⚠️ window.open failed, trying direct download:', error);
    }
    
    // If popup is blocked, fallback to direct download
    if (!newWindow || newWindow.closed || typeof newWindow.closed === 'undefined') {
      console.log('📥 Popup blocked, using direct download instead');
      
      // Extract filename from URL or use default
      const urlParts = normalizedUrl.split('/');
      const filename = urlParts[urlParts.length - 1] || 'document.pdf';
      
      // Create temporary anchor element to trigger download
      const link = document.createElement('a');
      link.href = blobUrl;
      link.download = filename;
      link.style.display = 'none';
      document.body.appendChild(link);
      
      // Trigger download
      link.click();
      
      // Clean up
      setTimeout(() => {
        document.body.removeChild(link);
        URL.revokeObjectURL(blobUrl);
        console.log('🧹 Blob URL revoked');
      }, 100);
    } else {
      // Popup opened successfully, clean up blob URL after a delay
      setTimeout(() => {
        URL.revokeObjectURL(blobUrl);
        console.log('🧹 Blob URL revoked');
      }, 60000); // 60 seconds
    }

    onSuccess?.();

  } catch (error) {
    console.error('❌ Error downloading file:', error);
    const errorMessage = error instanceof Error ? error.message : 'Erreur lors du téléchargement du fichier';
    onError?.(new Error(errorMessage));
    throw error;
  }
}

function normalizeApiFileUrl(fileUrl: string): string {
  return fileUrl.startsWith("http")
    ? fileUrl.replace(/^https?:\/\/[^/]+/, "")
    : fileUrl;
}

function inferVideoMimeType(fileUrl: string): string {
  const lower = fileUrl.toLowerCase();
  if (lower.endsWith(".mp4")) return "video/mp4";
  if (lower.endsWith(".webm")) return "video/webm";
  if (lower.endsWith(".ogg") || lower.endsWith(".ogv")) return "video/ogg";
  if (lower.endsWith(".mov")) return "video/quicktime";
  if (lower.endsWith(".avi")) return "video/x-msvideo";
  return "video/mp4";
}

/**
 * Open a video support using authenticated fetch + in-browser player.
 * This avoids forced download behaviors for protected video files.
 */
export async function openVideoWithAuth(
  fileUrl: string,
  options: {
    title?: string;
    onError?: (error: Error) => void;
    onSuccess?: () => void;
  } = {}
): Promise<void> {
  const { title = "Lecture vidéo", onError, onSuccess } = options;

  try {
    // Vimeo links can be opened directly without proxying through blob fetch.
    if (fileUrl.startsWith("http") && fileUrl.includes("vimeo.com")) {
      const vimeoWindow = window.open(fileUrl, "_blank");
      if (!vimeoWindow) {
        throw new Error("Le navigateur a bloqué l'ouverture de la fenêtre vidéo.");
      }
      onSuccess?.();
      return;
    }

    const normalizedUrl = normalizeApiFileUrl(fileUrl);
    const response = await fetch(normalizedUrl, { method: "GET" });
    if (!response.ok) {
      throw new Error(`Erreur ${response.status}: impossible de charger la vidéo`);
    }

    const sourceBlob = await response.blob();
    const mimeType =
      sourceBlob.type && sourceBlob.type.startsWith("video/")
        ? sourceBlob.type
        : inferVideoMimeType(normalizedUrl);
    const videoBlob = new Blob([sourceBlob], { type: mimeType });
    const blobUrl = URL.createObjectURL(videoBlob);

    const playerWindow = window.open("", "_blank");
    if (!playerWindow) {
      URL.revokeObjectURL(blobUrl);
      throw new Error("Le navigateur a bloqué l'ouverture de la fenêtre vidéo.");
    }

    const safeTitle = (title || "video")
      .replace(/[<>:"/\\|?*\u0000-\u001F]/g, "_")
      .trim();

    playerWindow.document.write(`<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>${title}</title>
    <style>
      html, body { margin: 0; padding: 0; background: #0b1020; height: 100%; }
      .wrap { display: flex; flex-direction: column; height: 100%; }
      .bar { padding: 10px 12px; background: #111827; border-bottom: 1px solid #1f2937; text-align: right; }
      .dl { color: #fff; text-decoration: none; font: 600 13px/1 sans-serif; border: 1px solid #334155; border-radius: 6px; padding: 7px 10px; display: inline-block; }
      .player { flex: 1; display: flex; align-items: center; justify-content: center; }
      video { width: 100%; height: 100%; max-width: 100vw; max-height: calc(100vh - 48px); background: #000; }
    </style>
  </head>
  <body>
    <div class="wrap">
      <div class="bar">
        <a class="dl" href="${blobUrl}" download="${safeTitle}.mp4">Télécharger</a>
      </div>
      <div class="player">
        <video controls autoplay playsinline src="${blobUrl}"></video>
      </div>
    </div>
  </body>
</html>`);
    playerWindow.document.close();

    const cleanup = () => URL.revokeObjectURL(blobUrl);
    playerWindow.addEventListener("beforeunload", cleanup, { once: true });
    setTimeout(cleanup, 30 * 60 * 1000);

    onSuccess?.();
  } catch (error) {
    const err =
      error instanceof Error ? error : new Error("Impossible d'ouvrir la vidéo");
    onError?.(err);
    throw err;
  }
}

/**
 * Open a PDF support in a dedicated authenticated preview window.
 * This avoids browser auto-download behavior seen with attachment headers.
 */
export async function openPdfWithAuth(
  fileUrl: string,
  options: {
    title?: string;
    onError?: (error: Error) => void;
    onSuccess?: () => void;
  } = {}
): Promise<void> {
  const { title = "Lecture PDF", onError, onSuccess } = options;
  try {
    const normalizedUrl = normalizeApiFileUrl(fileUrl);
    const response = await fetch(normalizedUrl, { method: "GET" });
    if (!response.ok) {
      throw new Error(`Erreur ${response.status}: impossible d'ouvrir le PDF`);
    }

    const sourceBlob = await response.blob();
    const pdfBlob =
      sourceBlob.type === "application/pdf"
        ? sourceBlob
        : new Blob([sourceBlob], { type: "application/pdf" });
    const blobUrl = URL.createObjectURL(pdfBlob);
    const safeTitle = (title || "document")
      .replace(/[<>:"/\\|?*\u0000-\u001F]/g, "_")
      .trim();

    const previewWindow = window.open("", "_blank");
    if (!previewWindow) {
      URL.revokeObjectURL(blobUrl);
      throw new Error("Le navigateur a bloqué l'ouverture de la fenêtre PDF.");
    }

    previewWindow.document.write(`<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>${title}</title>
    <style>
      html, body { margin: 0; padding: 0; height: 100%; background: #0b1020; }
      .wrap { height: 100%; display: flex; flex-direction: column; }
      .bar { padding: 10px 12px; background: #111827; border-bottom: 1px solid #1f2937; text-align: right; }
      .dl { color: #fff; text-decoration: none; font: 600 13px/1 sans-serif; border: 1px solid #334155; border-radius: 6px; padding: 7px 10px; display: inline-block; }
      iframe { flex: 1; width: 100%; border: 0; background: #fff; }
    </style>
  </head>
  <body>
    <div class="wrap">
      <div class="bar">
        <a class="dl" href="${blobUrl}" download="${safeTitle}.pdf">Télécharger</a>
      </div>
      <iframe src="${blobUrl}"></iframe>
    </div>
  </body>
</html>`);
    previewWindow.document.close();

    const cleanup = () => URL.revokeObjectURL(blobUrl);
    previewWindow.addEventListener("beforeunload", cleanup, { once: true });
    setTimeout(cleanup, 30 * 60 * 1000);

    onSuccess?.();
  } catch (error) {
    const err =
      error instanceof Error ? error : new Error("Impossible d'ouvrir le PDF");
    onError?.(err);
    throw err;
  }
}

/**
 * Download a file as a blob and trigger browser download
 * 
 * @param fileUrl - The URL of the file to download
 * @param fileName - The name to use for the downloaded file
 * @param options - Optional configuration
 * @returns Promise that resolves when the file is downloaded
 */
export async function downloadFileAsBlob(
  fileUrl: string,
  fileName: string,
  options: {
    onError?: (error: Error) => void;
    onSuccess?: () => void;
  } = {}
): Promise<void> {
  const { onError, onSuccess } = options;

  try {
    console.log('📥 Downloading file as blob:', fileUrl);

    // Ensure URL is relative to use Next.js proxy and fetch interceptor
    const normalizedUrl = fileUrl.startsWith('http') 
      ? fileUrl.replace(/^https?:\/\/[^/]+/, '')
      : fileUrl;

    // Use fetch (which goes through fetch interceptor for authentication)
    const response = await fetch(normalizedUrl, {
      method: 'GET',
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => '');
      let errorMessage = `Erreur ${response.status}: ${response.statusText}`;
      
      try {
        const errorData = JSON.parse(errorText);
        errorMessage = errorData.error || errorData.message || errorMessage;
      } catch {
        if (errorText) {
          errorMessage = errorText;
        }
      }

      throw new Error(errorMessage);
    }

    // Get file content as blob
    const blob = await response.blob();
    
    // Create blob URL
    const blobUrl = URL.createObjectURL(blob);
    
    // Create temporary anchor element to trigger download
    const link = document.createElement('a');
    link.href = blobUrl;
    link.download = fileName;
    link.style.display = 'none';
    document.body.appendChild(link);
    
    // Trigger download
    link.click();
    
    // Clean up
    document.body.removeChild(link);
    URL.revokeObjectURL(blobUrl);
    
    console.log('✅ File downloaded successfully');
    onSuccess?.();

  } catch (error) {
    console.error('❌ Error downloading file:', error);
    const errorMessage = error instanceof Error ? error.message : 'Erreur lors du téléchargement du fichier';
    onError?.(new Error(errorMessage));
    throw error;
  }
}
