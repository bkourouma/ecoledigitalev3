"use client";

import { Suspense, lazy } from 'react';
import { Spin } from 'antd';

// Chargement dynamique des composants Ant Design
const AntdCycleForm = lazy(() => import('../academic/AntdCycleForm').then(module => ({ default: module.AntdCycleForm })));
const AntdProgrammeForm = lazy(() => import('../academic/AntdProgrammeForm').then(module => ({ default: module.AntdProgrammeForm })));

// Composant de chargement
const LoadingFallback = () => (
  <div className="flex items-center justify-center p-8">
    <Spin size="large" />
  </div>
);

// Wrapper pour les composants Ant Design avec Suspense
export function AntdWrapper({ children }: { children: React.ReactNode }) {
  return (
    <Suspense fallback={<LoadingFallback />}>
      {children}
    </Suspense>
  );
}

// Export des composants avec lazy loading
export { AntdCycleForm, AntdProgrammeForm };
