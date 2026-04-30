"use client";

import { Suspense, lazy, ComponentType, ReactNode } from 'react';
import { Spin } from 'antd';

interface DynamicLoaderProps {
  children: ReactNode;
  fallback?: ReactNode;
}

// Composant de chargement par défaut
const DefaultFallback = () => (
  <div className="flex items-center justify-center p-8">
    <Spin size="large" />
  </div>
);

// Wrapper pour le chargement dynamique avec gestion d'erreurs
export function DynamicLoader({ children, fallback = <DefaultFallback /> }: DynamicLoaderProps) {
  return (
    <Suspense fallback={fallback}>
      {children}
    </Suspense>
  );
}

// Fonction utilitaire pour créer des composants avec chargement dynamique
export function createDynamicComponent<T = {}>(
  importFn: () => Promise<{ default: ComponentType<T> }>,
  fallback?: ReactNode
) {
  const LazyComponent = lazy(importFn);
  
  return function DynamicComponent(props: T) {
    return (
      <DynamicLoader fallback={fallback}>
        <LazyComponent {...props} />
      </DynamicLoader>
    );
  };
}

// Composants dynamiques prédéfinis
export const DynamicAntdCycleForm = createDynamicComponent(
  () => import('../academic/AntdCycleForm').then(module => ({ default: module.AntdCycleForm }))
);

export const DynamicAntdProgrammeForm = createDynamicComponent(
  () => import('../academic/AntdProgrammeForm').then(module => ({ default: module.AntdProgrammeForm }))
);

// Hook pour gérer les erreurs de chargement
export function useChunkErrorHandler() {
  const handleChunkError = (error: Error) => {
    console.error('Erreur de chunk détectée:', error);
    
    // Vider le cache et recharger
    if ('caches' in window) {
      caches.keys().then(names => {
        names.forEach(name => caches.delete(name));
      });
    }
    
    // Recharger après un délai
    setTimeout(() => {
      window.location.reload();
    }, 1000);
  };

  return { handleChunkError };
}
