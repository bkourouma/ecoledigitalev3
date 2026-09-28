"use client";

import React, { Component, ErrorInfo, ReactNode } from 'react';
import { Button } from '@ecoledigitale/ui';
import { RefreshCw, AlertTriangle } from 'lucide-react';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error?: Error;
  errorInfo?: ErrorInfo;
}

class ChunkErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(error: Error): State {
    // Vérifier si c'est une ChunkLoadError (plus de patterns)
    const errorMessage = error.message || '';
    const errorName = error.name || '';
    const isChunkError = 
      errorName === 'ChunkLoadError' || 
      errorMessage.includes('Loading chunk') ||
      errorMessage.includes('Loading CSS chunk') ||
      errorMessage.includes('ChunkLoadError') ||
      errorMessage.includes('__webpack_require__') ||
      errorMessage.includes('webpack') ||
      errorMessage.includes('chunk') ||
      errorMessage.includes('Failed to fetch');
    
    return { 
      hasError: true, 
      error: isChunkError ? error : error 
    };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('ChunkErrorBoundary caught an error:', error, errorInfo);
    
    // Log spécifique pour les erreurs de chunk
    if (error.name === 'ChunkLoadError' || error.message.includes('Loading chunk')) {
      console.error('ChunkLoadError détectée:', {
        message: error.message,
        stack: error.stack,
        componentStack: errorInfo.componentStack
      });
    }

    this.setState({
      error,
      errorInfo
    });
  }

  handleReload = async () => {
    // Le vidage du cache est asynchrone : l'attendre, sinon le rechargement
    // partait avant que quoi que ce soit ne soit supprime.
    if ('caches' in window) {
      try {
        const names = await caches.keys();
        await Promise.all(names.map((name) => caches.delete(name)));
      } catch {
        // Cache Storage indisponible (navigation privee, permissions) : le
        // parametre anti-cache ci-dessous suffit a s'en sortir.
      }
    }

    // window.location.reload() NE contourne PAS le cache HTTP : c'est la raison
    // pour laquelle ce bouton ne debloquait personne. On recharge donc via une
    // URL porteuse d'un parametre unique, seul moyen fiable d'obtenir des
    // chunks frais quand une version periMee est en cache.
    try {
      const url = new URL(window.location.href);
      url.searchParams.set('cb', String(Date.now()));
      window.location.replace(url.toString());
    } catch {
      window.location.reload();
    }
  };

  handleRetry = () => {
    // Réinitialiser l'état d'erreur
    this.setState({ hasError: false, error: undefined, errorInfo: undefined });
  };

  render() {
    if (this.state.hasError) {
      const isChunkError = this.state.error?.name === 'ChunkLoadError' || 
                          this.state.error?.message.includes('Loading chunk');

      return (
        <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
          <div className="max-w-md w-full bg-white rounded-lg shadow-lg p-6 text-center">
            <div className="mb-4">
              <AlertTriangle className="h-12 w-12 text-yellow-500 mx-auto mb-2" />
              <h2 className="text-xl font-semibold text-gray-900 mb-2">
                {isChunkError ? 'Erreur de Chargement' : 'Une erreur est survenue'}
              </h2>
              <p className="text-gray-600 mb-4">
                {isChunkError 
                  ? 'Une erreur de chargement des ressources s\'est produite. Cela peut être dû à une mise à jour de l\'application.'
                  : 'Une erreur inattendue s\'est produite.'
                }
              </p>
            </div>

            {process.env.NODE_ENV === 'development' && this.state.error && (
              <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded text-left">
                <p className="text-xs text-red-800 font-mono">
                  <strong>Erreur:</strong> {this.state.error.message}
                </p>
                {this.state.error.stack && (
                  <details className="mt-2">
                    <summary className="text-xs text-red-700 cursor-pointer">
                      Stack trace
                    </summary>
                    <pre className="text-xs text-red-600 mt-1 whitespace-pre-wrap">
                      {this.state.error.stack}
                    </pre>
                  </details>
                )}
              </div>
            )}

            <div className="space-y-3">
              <Button 
                onClick={this.handleReload}
                className="w-full bg-blue-600 hover:bg-blue-700"
              >
                <RefreshCw className="h-4 w-4 mr-2" />
                Recharger la page
              </Button>
              
              {!isChunkError && (
                <Button 
                  onClick={this.handleRetry}
                  variant="outline"
                  className="w-full"
                >
                  Réessayer
                </Button>
              )}
            </div>

            <div className="mt-4 text-xs text-gray-500">
              <p>Si le problème persiste, essayez de :</p>
              <ul className="mt-1 text-left list-disc list-inside space-y-1">
                <li>Vider le cache de votre navigateur</li>
                <li>Utiliser un onglet de navigation privée</li>
                <li>Contacter le support technique</li>
              </ul>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

export default ChunkErrorBoundary;
