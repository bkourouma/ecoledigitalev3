"use client";

import { useEffect, useState } from 'react';
import { Button } from '@ecoledigitale/ui';
import { RefreshCw, AlertTriangle, Wifi, WifiOff } from 'lucide-react';

interface ChunkErrorRecoveryProps {
  onRetry?: () => void;
  onReload?: () => void;
}

/**
 * Recharge en contournant le cache HTTP.
 *
 * `window.location.reload()` rejoue la navigation SANS ignorer le cache : sur
 * une erreur de chunk periMe, il ramene exactement le fichier fautif. Un
 * parametre unique dans l'URL est le seul moyen fiable d'obtenir des fichiers
 * frais.
 */
function rechargerSansCache(): void {
  try {
    const url = new URL(window.location.href);
    url.searchParams.set('cb', String(Date.now()));
    window.location.replace(url.toString());
  } catch {
    window.location.reload();
  }
}

export function ChunkErrorRecovery({ onRetry, onReload }: ChunkErrorRecoveryProps) {
  const [isOnline, setIsOnline] = useState(true);
  const [retryCount, setRetryCount] = useState(0);
  const [isRetrying, setIsRetrying] = useState(false);

  useEffect(() => {
    // Vérifier la connectivité
    const checkOnline = () => setIsOnline(navigator.onLine);
    
    window.addEventListener('online', checkOnline);
    window.addEventListener('offline', checkOnline);
    
    return () => {
      window.removeEventListener('online', checkOnline);
      window.removeEventListener('offline', checkOnline);
    };
  }, []);

  const handleRetry = async () => {
    setIsRetrying(true);
    setRetryCount(prev => prev + 1);
    
    try {
      // Attendre un peu avant de réessayer
      await new Promise(resolve => setTimeout(resolve, 1000 * retryCount));
      
      // Vider le cache du navigateur
      if ('caches' in window) {
        const cacheNames = await caches.keys();
        await Promise.all(
          cacheNames.map(cacheName => caches.delete(cacheName))
        );
      }
      
      // Réessayer le chargement
      if (onRetry) {
        onRetry();
      } else {
        rechargerSansCache();
      }
    } catch (error) {
      console.error('Erreur lors de la récupération:', error);
    } finally {
      setIsRetrying(false);
    }
  };

  const handleReload = () => {
    if (onReload) {
      onReload();
    } else {
      rechargerSansCache();
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
      <div className="max-w-md w-full bg-white rounded-lg shadow-lg p-6 text-center">
        <div className="mb-4">
          <div className="flex items-center justify-center mb-2">
            {isOnline ? (
              <Wifi className="h-8 w-8 text-green-500" />
            ) : (
              <WifiOff className="h-8 w-8 text-red-500" />
            )}
            <AlertTriangle className="h-8 w-8 text-yellow-500 ml-2" />
          </div>
          
          <h2 className="text-xl font-semibold text-gray-900 mb-2">
            Erreur de Chargement
          </h2>
          
          <p className="text-gray-600 mb-4 whitespace-nowrap text-sm md:text-base">
            {!isOnline 
              ? 'Connexion internet perdue. Vérifiez votre connexion.'
              : 'Une erreur de chargement s\'est produite. Cela peut être dû à une mise à jour de l\'application.'
            }
          </p>
          
          {retryCount > 0 && (
            <p className="text-xs text-gray-500 mb-2">
              Tentative {retryCount}/3
            </p>
          )}
        </div>

        <div className="space-y-3">
          <Button 
            onClick={handleRetry}
            disabled={isRetrying || !isOnline}
            className="w-full bg-blue-600 hover:bg-blue-700 disabled:opacity-50"
          >
            <RefreshCw className={`h-4 w-4 mr-2 ${isRetrying ? 'animate-spin' : ''}`} />
            {isRetrying ? 'Récupération...' : 'Réessayer'}
          </Button>
          
          <Button 
            onClick={handleReload}
            variant="outline"
            className="w-full"
          >
            Recharger la page
          </Button>
        </div>

        <div className="mt-4 text-xs text-gray-500">
          <p>Si le problème persiste :</p>
          <ul className="mt-1 text-left list-disc list-inside space-y-1">
            <li>Videz le cache de votre navigateur (Ctrl+Shift+R)</li>
            <li>Utilisez un onglet de navigation privée</li>
            <li>Vérifiez votre connexion internet</li>
            <li>Contactez le support technique</li>
          </ul>
        </div>
      </div>
    </div>
  );
}
