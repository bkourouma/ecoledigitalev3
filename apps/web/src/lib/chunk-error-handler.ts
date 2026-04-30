"use client";

/**
 * Gestionnaire d'erreurs de chunk pour Next.js
 * Gère automatiquement les erreurs ChunkLoadError et tente une récupération
 */

let retryCount = 0;
const MAX_RETRIES = 3;
const RETRY_DELAY = 1000; // 1 seconde
let isInitialized = false;

declare global {
  interface Window {
    __ED_CHUNK_HANDLER_INITIALIZED__?: boolean;
  }
}

/**
 * Fonction utilitaire pour le logging sécurisé qui ne peut pas échouer
 */
function safeLog(level: 'log' | 'error' | 'warn', ...args: any[]): void {
  try {
    if (typeof console !== 'undefined' && console[level]) {
      console[level](...args);
    }
  } catch {
    // Ignorer silencieusement les erreurs de logging
  }
}

/** Évite new Error("undefined") quand event.error / reason est absent (affichage « Error: undefined »). */
function normalizeDerivedErrorMessage(raw: string): string {
  const s = String(raw ?? "").trim();
  if (!s || s === "undefined" || s === "null" || s === "[object Object]") {
    return "Erreur inconnue";
  }
  // React / libs génériques — ne pas propager tel quel (confusion avec vraies ChunkLoadError)
  if (s === "Unknown error" || s.startsWith("Unknown error")) {
    return "Erreur inconnue";
  }
  return s;
}

interface ChunkError extends Error {
  type?: string;
  target?: HTMLScriptElement | HTMLLinkElement;
}

/**
 * Vérifie si une erreur est une ChunkLoadError
 */
function isChunkLoadError(error: Error | ChunkError): boolean {
  try {
    const errorMessage = String(error?.message || "");
    const errorName = String(error?.name || "");
    const errorStack = String(error?.stack || "");

    // Indices « vrais » chargements de chunks (évite de traiter toute erreur React en dev :
    // presque toute stack contient webpack-internal).
    const webpackChunkSignal =
      errorStack.includes("__webpack_require__.f.j") ||
      errorStack.includes("__webpack_require__.e") ||
      errorStack.includes("ChunkLoadError") ||
      errorMessage.includes("Loading chunk") ||
      errorMessage.includes("Loading CSS chunk") ||
      errorMessage.includes("Loading module") ||
      errorMessage.includes("ChunkLoadError");

    return (
      errorName === "ChunkLoadError" ||
      errorMessage.includes("Loading chunk") ||
      errorMessage.includes("Loading CSS chunk") ||
      errorMessage.includes("ChunkLoadError") ||
      errorMessage.includes("Loading module") ||
      errorMessage.includes("Importing a module script failed") ||
      (errorMessage.includes("Failed to fetch") && webpackChunkSignal) ||
      errorMessage.includes("network error") ||
      errorMessage.includes("NetworkError") ||
      (errorMessage.includes("Failed to fetch") &&
        errorStack.includes("react-server-dom-webpack") &&
        (errorStack.includes("loadChunk") || errorStack.includes("preloadModule"))) ||
      (error as ChunkError)?.type === "error"
    );
  } catch {
    // Si une erreur se produit lors de la vérification, retourner false
    return false;
  }
}

/**
 * Vide le cache du navigateur
 */
async function clearBrowserCache(): Promise<void> {
  if ('caches' in window) {
    try {
      const cacheNames = await caches.keys();
      await Promise.all(
        cacheNames.map(cacheName => caches.delete(cacheName))
      );
      safeLog('log', 'Cache du navigateur vidé');
    } catch (error) {
      safeLog('warn', 'Impossible de vider le cache:', error);
    }
  }
}

/**
 * Recharge la page avec un délai
 */
function reloadWithDelay(delay: number = 0): void {
  try {
    if (typeof window === 'undefined' || !window.location) {
      safeLog('warn', 'Impossible de recharger la page: window ou location non disponible');
      return;
    }
    
    setTimeout(() => {
      try {
        window.location.reload();
      } catch (reloadError) {
        safeLog('error', 'Erreur lors du rechargement de la page:', reloadError);
        // Dernière tentative : utiliser href
        try {
          window.location.href = window.location.href;
        } catch (hrefError) {
          safeLog('error', 'Impossible de recharger la page:', hrefError);
        }
      }
    }, delay);
  } catch (error) {
    safeLog('error', 'Erreur dans reloadWithDelay:', error);
    // Dernière tentative : rechargement immédiat sans délai
    try {
      if (typeof window !== 'undefined' && window.location) {
        window.location.reload();
      }
    } catch {
      // Ignorer silencieusement si même ça échoue
    }
  }
}

/**
 * Tente de recharger un script ou un lien CSS défaillant
 */
function retryResourceLoad(element: HTMLScriptElement | HTMLLinkElement): Promise<void> {
  return new Promise((resolve, reject) => {
    try {
      const currentUrl = element.src || (element as HTMLLinkElement).href;
      if (!currentUrl) {
        reject(new Error('No URL found on element'));
        return;
      }

      const newElement = element.cloneNode(true) as HTMLScriptElement | HTMLLinkElement;
      
      // Ajouter un timestamp pour éviter le cache
      try {
        const url = new URL(currentUrl, window.location.origin);
        url.searchParams.set('retry', Date.now().toString());
        
        if (newElement.tagName === 'SCRIPT') {
          (newElement as HTMLScriptElement).src = url.toString();
        } else {
          (newElement as HTMLLinkElement).href = url.toString();
        }
      } catch (urlError) {
        // Si l'URL est invalide, utiliser l'URL originale avec un timestamp en query string
        const separator = currentUrl.includes('?') ? '&' : '?';
        const urlWithRetry = `${currentUrl}${separator}retry=${Date.now()}`;
        
        if (newElement.tagName === 'SCRIPT') {
          (newElement as HTMLScriptElement).src = urlWithRetry;
        } else {
          (newElement as HTMLLinkElement).href = urlWithRetry;
        }
      }

      const timeout = setTimeout(() => {
        newElement.remove();
        reject(new Error('Retry timeout'));
      }, 10000); // 10 secondes timeout

      newElement.onload = () => {
        clearTimeout(timeout);
        element.remove();
        resolve();
      };

      newElement.onerror = () => {
        clearTimeout(timeout);
        newElement.remove();
        reject(new Error('Retry failed'));
      };

      // Insérer le nouvel élément
      const parentNode = element.parentNode;
      if (!parentNode) {
        reject(new Error('Parent node not found'));
        return;
      }
      
      parentNode.insertBefore(newElement, element);
    } catch (error) {
      const errorMessage = error instanceof Error 
        ? error.message 
        : (typeof error === 'string' ? error : String(error));
      reject(error instanceof Error ? error : new Error(`Erreur lors du rechargement de la ressource: ${errorMessage}`));
    }
  });
}

/**
 * Gestionnaire principal des erreurs de chunk
 */
async function handleChunkError(error: Error | ChunkError, errorEvent?: ErrorEvent): Promise<void> {
  try {
    safeLog('error', 'ChunkLoadError détectée:', error);

    // Vérifier la connectivité
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      safeLog('log', 'Hors ligne détecté, attente de la reconnexion...');
      return;
    }

    // Vérifier si l'erreur provient de __webpack_require__.f.j (erreur critique)
    const errorStack = String(error?.stack || '');
    const errorName = String(error?.name || '');
    const errorMessage = String(error?.message || '');
    const isCriticalError =
      errorStack.includes("__webpack_require__.f.j") ||
      errorName === "ChunkLoadError" ||
      errorMessage.includes("ChunkLoadError") ||
      errorMessage.includes("Loading chunk") ||
      errorMessage.includes("Loading module") ||
      (errorStack.includes("loadChunk") && errorStack.includes("__webpack_require__")) ||
      (errorStack.includes("preloadModule") && errorStack.includes("__webpack_require__")) ||
      (errorStack.includes("react-server-dom-webpack") &&
        (errorStack.includes("loadChunk") ||
          errorStack.includes("preloadModule") ||
          errorMessage.includes("Failed to fetch")));
    
    // Pour les erreurs critiques de __webpack_require__.f.j, recharger immédiatement après 1 tentative
    if (isCriticalError && retryCount >= 1) {
      safeLog('error', 'Erreur critique de chunk détectée (__webpack_require__.f.j), rechargement immédiat');
      try {
        await clearBrowserCache();
      } catch (cacheError) {
        safeLog('warn', 'Erreur lors du vidage du cache:', cacheError);
      }
      reloadWithDelay(500);
      return;
    }
    
    // Pour les erreurs critiques, réduire le nombre de tentatives avant rechargement
    if (isCriticalError && retryCount === 0) {
      safeLog('error', 'Erreur critique de chunk détectée, tentative de récupération immédiate');
      retryCount = 1; // Passer directement à 1 pour déclencher le rechargement au prochain échec
    }

    // Incrémenter le compteur de tentatives
    retryCount++;

    if (retryCount > MAX_RETRIES) {
      safeLog('error', 'Nombre maximum de tentatives atteint, rechargement de la page');
      try {
        await clearBrowserCache();
      } catch (cacheError) {
        safeLog('warn', 'Erreur lors du vidage du cache:', cacheError);
      }
      reloadWithDelay(500);
      return;
    }

    safeLog('log', `Tentative de récupération ${retryCount}/${MAX_RETRIES}`);

    try {
      // Attendre un délai progressif
      const delay = RETRY_DELAY * Math.pow(2, retryCount - 1); // Délai exponentiel
      safeLog('log', `Attente de ${delay}ms avant la tentative...`);
      await new Promise(resolve => setTimeout(resolve, delay));

      // Si nous avons l'élément qui a causé l'erreur, essayer de le recharger
      if (errorEvent && errorEvent.target && 
          (errorEvent.target instanceof HTMLScriptElement || 
           errorEvent.target instanceof HTMLLinkElement)) {
        
        try {
          const resourceUrl = errorEvent.target.src || (errorEvent.target as HTMLLinkElement).href;
          safeLog('log', 'Tentative de rechargement de la ressource:', resourceUrl);
          await retryResourceLoad(errorEvent.target);
          safeLog('log', 'Ressource rechargée avec succès');
          return;
        } catch (retryError) {
          safeLog('error', 'Échec du rechargement de la ressource:', retryError);
          // Continuer avec le rechargement des chunks manquants
        }
      }

      // Sinon, essayer de recharger les chunks manquants
      safeLog('log', 'Tentative de rechargement des chunks manquants...');
      await reloadMissingChunks();

    } catch (retryError) {
      // Extract detailed error information
      let errorInfo = 'Erreur inconnue';
      try {
        if (retryError instanceof Error) {
          errorInfo = retryError.message || retryError.name || 'Erreur sans message';
          if (retryError.stack) {
            safeLog('error', 'Échec de la tentative de récupération:', {
              message: errorInfo,
              stack: retryError.stack,
              name: retryError.name
            });
          } else {
            safeLog('error', 'Échec de la tentative de récupération:', errorInfo);
          }
        } else {
          errorInfo = typeof retryError === 'string' ? retryError : String(retryError);
          safeLog('error', 'Échec de la tentative de récupération:', errorInfo);
        }
      } catch (logError) {
        safeLog('error', 'Échec de la tentative de récupération (impossible d\'extraire les détails)');
      }
      
      // En cas d'échec, recharger la page
      try {
        await clearBrowserCache();
      } catch (cacheError) {
        safeLog('warn', 'Erreur lors du vidage du cache:', cacheError);
      }
      
      try {
        reloadWithDelay(RETRY_DELAY * retryCount);
      } catch (reloadError) {
        safeLog('error', 'Erreur lors du rechargement:', reloadError);
        // Dernière tentative : rechargement immédiat
        if (typeof window !== 'undefined' && window.location) {
          window.location.reload();
        }
      }
    }
  } catch (fatalError) {
    // Erreur fatale dans le gestionnaire d'erreur lui-même
    try {
      let msg = "inconnu";
      let name = "Unknown";
      let stack: string | undefined;
      try {
        msg =
          fatalError instanceof Error
            ? String(fatalError.message || "inconnu")
            : String(fatalError);
      } catch {
        msg = "inconnu";
      }
      try {
        name = fatalError instanceof Error ? String(fatalError.name || "Error") : typeof fatalError;
      } catch {
        name = "Unknown";
      }
      try {
        stack = fatalError instanceof Error ? fatalError.stack : undefined;
      } catch {
        stack = undefined;
      }
      safeLog("error", "Erreur fatale dans le gestionnaire d'erreurs de chunk:", {
        message: msg,
        name,
        stack,
      });
    } catch {
      // Si même le logging échoue, essayer de logger au moins quelque chose
      safeLog('error', 'Erreur fatale dans le gestionnaire d\'erreurs de chunk (détails non disponibles)');
    }
    
    // En dernier recours, recharger la page
    try {
      if (typeof window !== 'undefined' && window.location) {
        window.location.reload();
      }
    } catch (reloadError) {
      // Si même le rechargement échoue, essayer une méthode alternative
      try {
        if (typeof window !== 'undefined' && window.location && window.location.href) {
          window.location.href = window.location.href;
        }
      } catch {
        // Dernière tentative : ignorer silencieusement
      }
    }
  }
}

/**
 * Tente de recharger les chunks manquants
 */
async function reloadMissingChunks(): Promise<void> {
  try {
    // Vider le cache des chunks
    if ('caches' in window) {
      const cacheNames = await caches.keys();
      const chunkCaches = cacheNames.filter(name => 
        name.includes('chunks') || name.includes('webpack')
      );
      
      await Promise.all(
        chunkCaches.map(cacheName => caches.delete(cacheName))
      );
    }

    // Forcer le rechargement des modules
    if (typeof window !== 'undefined' && (window as any).__webpack_require__) {
      // Réinitialiser le cache webpack
      const webpackRequire = (window as any).__webpack_require__;
      if (webpackRequire.cache) {
        Object.keys(webpackRequire.cache).forEach(key => {
          if (key.includes('chunks') || key.includes('webpack')) {
            delete webpackRequire.cache[key];
          }
        });
      }
    }

    safeLog('log', 'Chunks manquants rechargés');
  } catch (error) {
    safeLog('error', 'Erreur lors du rechargement des chunks:', error);
    throw error;
  }
}

/**
 * Initialise les gestionnaires d'erreurs
 */
export function initChunkErrorHandler(): void {
  // Éviter la double initialisation
  if (isInitialized || (typeof window !== 'undefined' && window.__ED_CHUNK_HANDLER_INITIALIZED__)) {
    safeLog('warn', 'Le gestionnaire d\'erreurs de chunk est déjà initialisé');
    return;
  }
  
  if (typeof window === 'undefined') {
    safeLog('warn', 'Le gestionnaire d\'erreurs de chunk ne peut être initialisé que côté client');
    return;
  }
  
  isInitialized = true;
  window.__ED_CHUNK_HANDLER_INITIALIZED__ = true;
  // Gestionnaire d'erreurs global pour les erreurs JavaScript
  window.addEventListener('error', (event) => {
    try {
      // Extract error message with better error handling
      let errorMessage = "Unknown error";
      try {
        const fromEvent = event.message?.trim();
        const fromThrown =
          event.error instanceof Error
            ? event.error.message
            : event.error != null && typeof (event.error as { message?: string }).message === "string"
              ? (event.error as { message: string }).message
              : "";
        const fromToString =
          event.error != null && typeof (event.error as { toString?: () => string }).toString === "function"
            ? String((event.error as { toString: () => string }).toString())
            : "";
        errorMessage = normalizeDerivedErrorMessage(
          fromEvent || fromThrown || fromToString || "Unknown error"
        );
      } catch {
        errorMessage = normalizeDerivedErrorMessage(
          "Unknown error (could not extract message)"
        );
      }

      const error =
        event.error instanceof Error ? event.error : new Error(errorMessage);
      const message = String(event.message || '');
      const filename = String(event.filename || '');
      
      // Vérifier si c'est une erreur de chunk webpack
      const errorStack = String(error?.stack || '');
      if (
        isChunkLoadError(error) ||
        filename.includes("/_next/static/chunks/") ||
        (filename.includes("/_next/static/") &&
          (message.includes("Loading chunk") ||
            message.includes("ChunkLoadError") ||
            message.includes("Failed to load"))) ||
        errorStack.includes("__webpack_require__.f.j") ||
        (errorStack.includes("loadChunk") && errorStack.includes("__webpack_require__")) ||
        (errorStack.includes("preloadModule") && errorStack.includes("__webpack_require__")) ||
        filename.includes("webpack.js")
      ) {
        safeLog('error', 'ChunkLoadError détectée dans error handler:', error, event);
        event.preventDefault();
        handleChunkError(error, event).catch((handlerError) => {
          safeLog('error', 'Erreur dans handleChunkError:', handlerError);
        });
        return;
      }
    } catch (listenerError) {
      safeLog('error', 'Erreur dans le gestionnaire d\'erreurs global:', listenerError);
    }
  }, true); // Utiliser la phase de capture pour intercepter tôt

  // Gestionnaire pour les promesses rejetées (important pour les imports dynamiques)
  window.addEventListener('unhandledrejection', (event) => {
    try {
      const error = event.reason;
      
      // Vérifier si c'est une erreur de chunk
      let isChunkError = false;
      
      if (error instanceof Error) {
        isChunkError = isChunkLoadError(error);
        
        // Vérifier aussi la stack trace pour __webpack_require__.f.j
        if (!isChunkError && error.stack) {
          const stack = String(error.stack);
          isChunkError =
            stack.includes("__webpack_require__.f.j") ||
            stack.includes("__webpack_require__.e") ||
            stack.includes("ChunkLoadError") ||
            stack.includes("webpack.js") ||
            ((stack.includes("loadChunk") || stack.includes("preloadModule")) &&
              stack.includes("__webpack_require__"));
        }
      }
      
      // Vérifier aussi les erreurs de type string
      if (!isChunkError && typeof error === "string") {
        isChunkError =
          error.includes("Loading chunk") ||
          error.includes("ChunkLoadError") ||
          error.includes("Loading module");
      }
      
      if (isChunkError) {
        safeLog('error', 'ChunkLoadError détectée dans unhandledrejection:', error);
        event.preventDefault();
        
        const reasonLabel =
          error instanceof Error
            ? error.message
            : error == null
              ? ""
              : typeof error === "string"
                ? error
                : (() => {
                    try {
                      return JSON.stringify(error);
                    } catch {
                      return String(error);
                    }
                  })();
        const chunkError = (error instanceof Error
          ? error
          : new Error(normalizeDerivedErrorMessage(reasonLabel))) as ChunkError;

        handleChunkError(chunkError).catch((handlerError) => {
          safeLog('error', 'Erreur dans handleChunkError:', handlerError);
        });
        return;
      }
    } catch (listenerError) {
      safeLog('error', 'Erreur dans le gestionnaire unhandledrejection:', listenerError);
    }
  });

  // Gestionnaire spécifique pour les erreurs de ressources (scripts, stylesheets)
  window.addEventListener('error', (event) => {
    try {
      if (event.target && 
          (event.target instanceof HTMLScriptElement || 
           event.target instanceof HTMLLinkElement)) {
        
        const url = String((event.target as HTMLScriptElement).src || 
                    (event.target as HTMLLinkElement).href || '');
        
        if (
          url &&
          (url.includes("/_next/static/chunks/") ||
            (url.includes("/_next/static/") &&
              (url.includes(".js") || url.includes(".css"))))
        ) {
          safeLog('error', 'Erreur de chargement de ressource:', url);
          const chunkError = new Error(`Loading chunk failed: ${url}`) as ChunkError;
          chunkError.name = 'ChunkLoadError';
          chunkError.target = event.target as HTMLScriptElement | HTMLLinkElement;
          
          event.preventDefault();
          handleChunkError(chunkError, event).catch((handlerError) => {
            safeLog('error', 'Erreur dans handleChunkError:', handlerError);
          });
          return;
        }
      }
    } catch (listenerError) {
      safeLog('error', 'Erreur dans le gestionnaire d\'erreurs de ressources:', listenerError);
    }
  }, true); // Utiliser la phase de capture

  // Intercepter les erreurs webpack directement si possible
  if (typeof window !== 'undefined' && (window as any).__webpack_require__) {
    try {
      const originalRequire = (window as any).__webpack_require__;
      
      // Wrapper pour intercepter les erreurs de chargement de chunks
      if (originalRequire && typeof originalRequire.e === 'function') {
        const originalE = originalRequire.e;
        let retryAttempts = new Map<string, number>();
        const MAX_WEBPACK_RETRIES = 3;
        
        // Éviter de wrap plusieurs fois lors des hot-reloads
        if ((originalE as any).__edChunkHandlerWrapped) {
          safeLog('warn', '__webpack_require__.e déjà wrapé');
        } else {
        originalRequire.e = function(chunkId: string) {
          const chunkIdStr = String(chunkId || 'unknown');
          return originalE(chunkId).catch((error: Error) => {
            try {
              // Vérifier si c'est une erreur de chunk
              const errorMsg = String(error?.message || '');
              const isChunkError =
                isChunkLoadError(error) ||
                errorMsg.includes("Loading chunk") ||
                errorMsg.includes("ChunkLoadError") ||
                errorMsg.includes("Loading module") ||
                (errorMsg.includes("Failed to fetch") &&
                  String(error?.stack || "").includes("__webpack_require__"));
              
              if (isChunkError) {
                const attempts = (retryAttempts.get(chunkIdStr) || 0) + 1;
                retryAttempts.set(chunkIdStr, attempts);
                
                safeLog('error', `ChunkLoadError dans __webpack_require__.e (tentative ${attempts}/${MAX_WEBPACK_RETRIES}):`, error, chunkId);
                
                // Si on a atteint le maximum de tentatives, appeler le gestionnaire d'erreurs
                if (attempts >= MAX_WEBPACK_RETRIES) {
                  retryAttempts.delete(chunkIdStr);
                  handleChunkError(error).catch((handlerError) => {
                    safeLog('error', 'Erreur dans handleChunkError:', handlerError);
                  });
                  throw error;
                }
                
                // Retry avec délai exponentiel
                const delay = RETRY_DELAY * Math.pow(2, attempts - 1);
                safeLog('log', `Nouvelle tentative de chargement du chunk ${chunkIdStr} dans ${delay}ms...`);
                
                return new Promise((resolve, reject) => {
                  setTimeout(() => {
                    originalE(chunkId)
                      .then((result: any) => {
                        retryAttempts.delete(chunkIdStr);
                        resolve(result);
                      })
                      .catch((retryError: Error) => {
                        // Si c'est toujours une erreur de chunk, réessayer
                        const retryErrorMsg = String(retryError?.message || '');
                        if (
                          isChunkLoadError(retryError) ||
                          retryErrorMsg.includes("Loading chunk")
                        ) {
                          // Réessayer via la fonction originale non wrapée
                          originalE(chunkId).then(resolve).catch(reject);
                        } else {
                          retryAttempts.delete(chunkIdStr);
                          reject(retryError);
                        }
                      });
                  }, delay);
                });
              }
            } catch (interceptError) {
              safeLog('error', 'Erreur lors de l\'interception webpack:', interceptError);
            }
            throw error;
          });
        };
        (originalRequire.e as any).__edChunkHandlerWrapped = true;
        }
        
        // Intercepter aussi __webpack_require__.f.j si disponible (utilisé pour charger les chunks)
        if (originalRequire.f && originalRequire.f.j && typeof originalRequire.f.j === 'function') {
          const originalFj = originalRequire.f.j;
          let fjRetryAttempts = new Map<string, number>();
          const MAX_FJ_RETRIES = 3;
          
          // Éviter de wrap plusieurs fois lors des hot-reloads
          if ((originalFj as any).__edChunkHandlerWrapped) {
            safeLog('warn', '__webpack_require__.f.j déjà wrapé');
          } else {
          originalRequire.f.j = function(chunkId: string, promises: any) {
            const chunkIdStr = String(chunkId || 'unknown');
            try {
              const result = originalFj.call(this, chunkId, promises);
              
              // Si c'est une promesse, intercepter les erreurs
              if (result && typeof result.catch === 'function') {
                return result.catch((error: Error) => {
                  const errorMsg = String(error?.message || '');
                  const errorStack = String(error?.stack || '');
                  const isChunkError =
                    isChunkLoadError(error) ||
                    errorMsg.includes("Loading chunk") ||
                    errorMsg.includes("ChunkLoadError") ||
                    errorStack.includes("__webpack_require__.f.j") ||
                    errorStack.includes("__webpack_require__.e") ||
                    ((errorStack.includes("loadChunk") ||
                      errorStack.includes("preloadModule") ||
                      errorStack.includes("resolveModule")) &&
                      errorStack.includes("__webpack_require__"));
                  
                  if (isChunkError) {
                    const attempts = (fjRetryAttempts.get(chunkIdStr) || 0) + 1;
                    fjRetryAttempts.set(chunkIdStr, attempts);
                    
                    safeLog('error', `ChunkLoadError dans __webpack_require__.f.j (tentative ${attempts}/${MAX_FJ_RETRIES}):`, error, chunkId);
                    
                    if (attempts >= MAX_FJ_RETRIES) {
                      fjRetryAttempts.delete(chunkIdStr);
                      handleChunkError(error).catch((handlerError) => {
                        safeLog('error', 'Erreur dans handleChunkError:', handlerError);
                      });
                      throw error;
                    }
                    
                    // Retry avec délai
                    const delay = RETRY_DELAY * Math.pow(2, attempts - 1);
                    safeLog('log', `Nouvelle tentative de chargement du chunk ${chunkIdStr} via f.j dans ${delay}ms...`);
                    
                    return new Promise((resolve, reject) => {
                      setTimeout(() => {
                        try {
                          const retryResult = originalFj.call(this, chunkId, promises);
                          if (retryResult && typeof retryResult.catch === 'function') {
                            retryResult
                              .then((success: any) => {
                                fjRetryAttempts.delete(chunkIdStr);
                                resolve(success);
                              })
                              .catch((retryError: Error) => {
                                if (attempts < MAX_FJ_RETRIES) {
                                  // Réessayer via la fonction originale non wrapée
                                  originalFj.call(this, chunkId, promises)
                                    .then(resolve)
                                    .catch(reject);
                                } else {
                                  fjRetryAttempts.delete(chunkIdStr);
                                  reject(retryError);
                                }
                              });
                          } else {
                            fjRetryAttempts.delete(chunkIdStr);
                            resolve(retryResult);
                          }
                        } catch (retryError) {
                          if (attempts < MAX_FJ_RETRIES) {
                            Promise.resolve(originalFj.call(this, chunkId, promises))
                              .then(resolve)
                              .catch(reject);
                          } else {
                            fjRetryAttempts.delete(chunkIdStr);
                            reject(retryError);
                          }
                        }
                      }, delay);
                    });
                  }
                  throw error;
                });
              }
              
              return result;
            } catch (error) {
              const errorObj = error as Error;
              const errorMsg = String(errorObj?.message || '');
              const errorStack = String(errorObj?.stack || '');
              const isChunkError =
                isChunkLoadError(errorObj) ||
                errorMsg.includes("Loading chunk") ||
                errorMsg.includes("ChunkLoadError") ||
                errorStack.includes("__webpack_require__.f.j") ||
                errorStack.includes("__webpack_require__.e") ||
                ((errorStack.includes("loadChunk") ||
                  errorStack.includes("preloadModule") ||
                  errorStack.includes("resolveModule")) &&
                  errorStack.includes("__webpack_require__"));
              
              if (isChunkError) {
                safeLog('error', 'ChunkLoadError dans __webpack_require__.f.j (sync):', errorObj, chunkId);
                handleChunkError(errorObj).catch((handlerError) => {
                  safeLog('error', 'Erreur dans handleChunkError:', handlerError);
                });
              }
              throw error;
            }
          };
          (originalRequire.f.j as any).__edChunkHandlerWrapped = true;
          }
        }
      }
    } catch (webpackError) {
      safeLog('warn', 'Impossible d\'intercepter les erreurs webpack:', webpackError);
    }
  }

  safeLog('log', 'Gestionnaire d\'erreurs de chunk initialisé');
}

/**
 * Réinitialise le compteur de tentatives
 */
export function resetRetryCount(): void {
  retryCount = 0;
}

/**
 * Réinitialise le flag d'initialisation (pour les tests ou le rechargement)
 */
export function resetInitialization(): void {
  isInitialized = false;
  retryCount = 0;
  if (typeof window !== 'undefined') {
    window.__ED_CHUNK_HANDLER_INITIALIZED__ = false;
  }
}

/**
 * Obtient le nombre actuel de tentatives
 */
export function getRetryCount(): number {
  return retryCount;
}
