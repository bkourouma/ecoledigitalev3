import React from 'react';
import { AlertCircle, RefreshCw, Home } from 'lucide-react';
import { Button } from './button';
import { Card, CardContent } from './card';
import { cn } from '@/lib/utils';

interface ErrorStateProps {
  title?: string;
  message?: string;
  onRetry?: () => void;
  onGoHome?: () => void;
  className?: string;
  showHomeButton?: boolean;
}

export function ErrorState({
  title = 'Une erreur est survenue',
  message = 'Nous rencontrons des difficultés techniques. Veuillez réessayer.',
  onRetry,
  onGoHome,
  className,
  showHomeButton = false
}: ErrorStateProps) {
  return (
    <div className={cn('flex items-center justify-center py-8', className)}>
      <Card className="w-full max-w-md">
        <CardContent className="p-6">
          <div className="text-center">
            <AlertCircle className="h-12 w-12 text-red-500 mx-auto mb-4" />
            <h3 className="text-lg font-semibold text-gray-900 mb-2">{title}</h3>
            <p className="text-gray-600 mb-6">{message}</p>
            <div className="flex flex-col sm:flex-row gap-3 justify-center">
              {onRetry && (
                <Button onClick={onRetry} className="flex items-center gap-2">
                  <RefreshCw className="h-4 w-4" />
                  Réessayer
                </Button>
              )}
              {showHomeButton && onGoHome && (
                <Button variant="outline" onClick={onGoHome} className="flex items-center gap-2">
                  <Home className="h-4 w-4" />
                  Accueil
                </Button>
              )}
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

interface PageErrorProps {
  title?: string;
  message?: string;
  onRetry?: () => void;
  onGoHome?: () => void;
}

export function PageError({
  title = 'Page introuvable',
  message = 'La page que vous recherchez n\'existe pas ou a été déplacée.',
  onRetry,
  onGoHome
}: PageErrorProps) {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="text-center px-4">
        <div className="mb-8">
          <AlertCircle className="h-24 w-24 text-red-500 mx-auto mb-6" />
          <h1 className="text-4xl font-bold text-gray-900 mb-4">{title}</h1>
          <p className="text-xl text-gray-600 mb-8 max-w-md mx-auto">{message}</p>
        </div>
        <div className="flex flex-col sm:flex-row gap-4 justify-center">
          {onRetry && (
            <Button size="lg" onClick={onRetry} className="flex items-center gap-2">
              <RefreshCw className="h-5 w-5" />
              Réessayer
            </Button>
          )}
          {onGoHome && (
            <Button size="lg" variant="outline" onClick={onGoHome} className="flex items-center gap-2">
              <Home className="h-5 w-5" />
              Retour à l'accueil
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

interface InlineErrorProps {
  message: string;
  onRetry?: () => void;
  className?: string;
}

export function InlineError({ message, onRetry, className }: InlineErrorProps) {
  return (
    <div className={cn('flex items-center gap-3 p-3 bg-red-50 border border-red-200 rounded-lg', className)}>
      <AlertCircle className="h-5 w-5 text-red-500 flex-shrink-0" />
      <p className="text-sm text-red-700 flex-1">{message}</p>
      {onRetry && (
        <Button size="sm" variant="outline" onClick={onRetry} className="flex items-center gap-1">
          <RefreshCw className="h-3 w-3" />
          Réessayer
        </Button>
      )}
    </div>
  );
}
