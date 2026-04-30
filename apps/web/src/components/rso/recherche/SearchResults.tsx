"use client";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Button,
  Alert,
  AlertDescription,
} from "@ecoledigitale/ui";
import { Loader2, FileText, Calendar, MapPin, TrendingUp } from "lucide-react";
import type { ActivitySearchResponse } from "@ecoledigitale/contracts/rso/recherche/recherche.contracts";
import { format } from "date-fns";
import { fr } from "date-fns/locale";
import Link from "next/link";

interface SearchResultsProps {
  data?: ActivitySearchResponse;
  isLoading?: boolean;
  error?: Error | null;
  onPageChange?: (page: number) => void;
  userRole?: string;
}

export function SearchResults({
  data,
  isLoading,
  error,
  onPageChange,
  userRole = "formateur_rso",
}: SearchResultsProps) {
  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-8 w-8 animate-spin" />
      </div>
    );
  }

  if (error) {
    return (
      <Alert variant="destructive">
        <AlertDescription>
          Erreur lors de la recherche: {error.message}
        </AlertDescription>
      </Alert>
    );
  }

  if (!data || data.resultats.length === 0) {
    return (
      <Card>
        <CardContent className="p-6 text-center text-muted-foreground">
          <FileText className="h-12 w-12 mx-auto mb-4 opacity-50" />
          <p>Aucun résultat trouvé</p>
          <p className="text-sm mt-2">Essayez de modifier vos critères de recherche</p>
        </CardContent>
      </Card>
    );
  }

  const basePath =
    userRole === "agent_pfso" ? "/rso/pfso/activites" : "/rso/formateur/activites";

  return (
    <div className="space-y-4">
      {/* Results Summary */}
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          {data.pagination.total} résultat{data.pagination.total > 1 ? "s" : ""} trouvé
          {data.pagination.total > 1 ? "s" : ""}
        </p>
        {data.pagination.totalPages > 1 && (
          <p className="text-sm text-muted-foreground">
            Page {data.pagination.page} sur {data.pagination.totalPages}
          </p>
        )}
      </div>

      {/* Results List */}
      <div className="space-y-4">
        {data.resultats.map((result) => (
          <Card key={result.id} className="hover:shadow-md transition-shadow">
            <CardHeader>
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <CardTitle className="text-lg mb-2">
                    <Link
                      href={`${basePath}/${result.id}`}
                      className="hover:underline"
                    >
                      {result.titre}
                    </Link>
                  </CardTitle>
                  <div className="flex flex-wrap gap-4 text-sm text-muted-foreground">
                    <div className="flex items-center gap-1">
                      <Calendar className="h-4 w-4" />
                      {format(new Date(result.dateActivite), "dd MMMM yyyy", {
                        locale: fr,
                      })}
                    </div>
                    <div className="flex items-center gap-1">
                      <MapPin className="h-4 w-4" />
                      {result.installation.nomPort}
                    </div>
                    <div className="flex items-center gap-1">
                      <FileText className="h-4 w-4" />
                      {result.typeActivite}
                    </div>
                    {result.pertinence > 0 && (
                      <div className="flex items-center gap-1">
                        <TrendingUp className="h-4 w-4" />
                        {Math.round(result.pertinence * 100)}% de pertinence
                      </div>
                    )}
                  </div>
                </div>
                <Link href={`${basePath}/${result.id}`}>
                  <Button variant="outline" size="sm">
                    Voir
                  </Button>
                </Link>
              </div>
            </CardHeader>
            <CardContent>
              <div
                className="text-sm text-muted-foreground line-clamp-3"
                dangerouslySetInnerHTML={{ __html: result.extrait }}
              />
              <div className="mt-2 text-xs text-muted-foreground">
                Code: {result.codeActivite}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Pagination */}
      {data.pagination.totalPages > 1 && (
        <div className="flex items-center justify-center gap-2 pt-4">
          <Button
            variant="outline"
            size="sm"
            disabled={data.pagination.page === 1}
            onClick={() => onPageChange?.(data.pagination.page - 1)}
          >
            Précédent
          </Button>
          <span className="text-sm text-muted-foreground">
            Page {data.pagination.page} sur {data.pagination.totalPages}
          </span>
          <Button
            variant="outline"
            size="sm"
            disabled={data.pagination.page >= data.pagination.totalPages}
            onClick={() => onPageChange?.(data.pagination.page + 1)}
          >
            Suivant
          </Button>
        </div>
      )}
    </div>
  );
}

