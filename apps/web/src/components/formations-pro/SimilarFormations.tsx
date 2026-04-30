"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@ecoledigitale/ui";
import { FormationCard } from "./FormationCard";
import { useSimilarFormations } from "@/lib/hooks/use-formations-pro";
import { BookOpen, Loader2 } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

interface SimilarFormationsProps {
  formationId: string | null;
  className?: string;
}

// Skeleton loader for formation cards
function FormationCardSkeleton() {
  return (
    <Card className="h-full">
      <CardContent className="p-6 space-y-4">
        <Skeleton className="h-6 w-3/4" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-2/3" />
        <div className="flex gap-2">
          <Skeleton className="h-6 w-16" />
          <Skeleton className="h-6 w-16" />
        </div>
        <div className="flex gap-4 pt-4">
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-4 w-24" />
        </div>
      </CardContent>
    </Card>
  );
}

export function SimilarFormations({ formationId, className }: SimilarFormationsProps) {
  const { data: response, isLoading, error } = useSimilarFormations(formationId);

  // Don't render if no formation ID
  if (!formationId) {
    return null;
  }

  const formations = response?.data?.formations || [];

  // Don't render if there are no similar formations
  if (!isLoading && !error && formations.length === 0) {
    return null;
  }

  // Don't render on error (fail silently)
  if (error) {
    return null;
  }

  return (
    <div className={cn("space-y-4", className)}>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg sm:text-xl">
            <BookOpen className="h-5 w-5 text-primary" />
            Formations similaires
            {formations.length > 0 && (
              <span className="text-sm font-normal text-muted-foreground">
                ({formations.length})
              </span>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
              {Array.from({ length: 4 }).map((_, index) => (
                <FormationCardSkeleton key={index} />
              ))}
            </div>
          ) : formations.length > 0 ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
              {formations.map((formation) => (
                <FormationCard key={formation.id} formation={formation} />
              ))}
            </div>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}

