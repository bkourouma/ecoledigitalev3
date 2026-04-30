import React from 'react';
import { Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

interface LoadingSpinnerProps {
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

export function LoadingSpinner({ size = 'md', className }: LoadingSpinnerProps) {
  const sizeClasses = {
    sm: 'h-4 w-4',
    md: 'h-6 w-6',
    lg: 'h-8 w-8'
  };

  return (
    <Loader2 
      className={cn(
        'animate-spin text-purple-600',
        sizeClasses[size],
        className
      )} 
    />
  );
}

interface LoadingStateProps {
  message?: string;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

export function LoadingState({ 
  message = 'Chargement...', 
  size = 'md',
  className 
}: LoadingStateProps) {
  return (
    <div className={cn('flex items-center justify-center py-8', className)}>
      <div className="flex flex-col items-center gap-3">
        <LoadingSpinner size={size} />
        <p className="text-sm text-gray-600">{message}</p>
      </div>
    </div>
  );
}

interface PageLoadingProps {
  message?: string;
}

export function PageLoading({ message = 'Chargement de la page...' }: PageLoadingProps) {
  return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="flex flex-col items-center gap-4">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-purple-500"></div>
        <p className="text-lg text-gray-600">{message}</p>
      </div>
    </div>
  );
}

interface ButtonLoadingProps {
  loading?: boolean;
  children: React.ReactNode;
  className?: string;
}

export function ButtonLoading({ loading, children, className }: ButtonLoadingProps) {
  return (
    <div className={cn('flex items-center gap-2', className)}>
      {loading && <LoadingSpinner size="sm" />}
      {children}
    </div>
  );
}
