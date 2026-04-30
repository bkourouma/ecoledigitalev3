"use client";

import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  Progress,
} from "@ecoledigitale/ui";
import { Loader2 } from "lucide-react";

interface ExportProgressProps {
  open: boolean;
  progress?: number;
  message?: string;
}

export function ExportProgress({ open, progress, message }: ExportProgressProps) {
  const [animatedProgress, setAnimatedProgress] = useState(0);

  useEffect(() => {
    if (progress !== undefined) {
      // Animate progress bar
      const timer = setTimeout(() => {
        setAnimatedProgress(progress);
      }, 100);
      return () => clearTimeout(timer);
    }
  }, [progress]);

  return (
    <Dialog open={open} onOpenChange={() => {}}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Génération du PDF en cours</DialogTitle>
          <DialogDescription>
            {message || "Veuillez patienter pendant la génération du document..."}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          <div className="flex items-center justify-center">
            <Loader2 className="h-8 w-8 animate-spin text-blue-600" />
          </div>

          {progress !== undefined && (
            <div className="space-y-2">
              <Progress value={animatedProgress} className="w-full" />
              <p className="text-sm text-center text-gray-600">
                {progress}%
              </p>
            </div>
          )}

          {!progress && (
            <p className="text-sm text-center text-gray-500">
              Préparation du document...
            </p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

