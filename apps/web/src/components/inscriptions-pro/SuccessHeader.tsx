"use client";

import { CheckCircle2 } from "lucide-react";
import { Card, CardContent } from "@ecoledigitale/ui";

interface SuccessHeaderProps {
  enrollmentNumber: string;
}

export function SuccessHeader({ enrollmentNumber }: SuccessHeaderProps) {
  return (
    <Card className="border-green-200 bg-green-50 dark:bg-green-900/20 dark:border-green-800">
      <CardContent className="py-8">
        <div className="flex flex-col items-center justify-center text-center space-y-4">
          <div className="relative">
            <CheckCircle2 className="w-16 h-16 text-green-600 dark:text-green-400 animate-in fade-in zoom-in duration-500" />
            <div className="absolute inset-0 bg-green-400/20 rounded-full animate-ping" />
          </div>
          <div>
            <h1 className="text-3xl font-bold text-green-600 dark:text-green-400 mb-2">
              Inscription confirmée !
            </h1>
            <p className="text-lg text-muted-foreground">
              Votre inscription a été confirmée avec succès
            </p>
            <p className="text-sm text-muted-foreground mt-2">
              Numéro d'inscription : <span className="font-semibold">{enrollmentNumber}</span>
            </p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

