"use client";

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@ecoledigitale/ui";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@ecoledigitale/ui";
import { Search, X, Filter } from "lucide-react";
import { useFormations } from "@/lib/hooks/use-formations-pro";
import { Loader2 } from "lucide-react";
import { SupportsListQuerySchema } from "@ecoledigitale/contracts/src/formateurs";
import { z } from "zod";

type SupportsListQuery = z.infer<typeof SupportsListQuerySchema>;

interface FormateurSupportsFiltersProps {
  filters: SupportsListQuery;
  onFiltersChange: (filters: Partial<SupportsListQuery>) => void;
}

const typeOptions = [
  { value: "PDF", label: "PDF" },
  { value: "PPT", label: "PowerPoint" },
  { value: "DOC", label: "Word" },
  { value: "ZIP", label: "Archive ZIP" },
  { value: "Video", label: "Vidéo" },
  { value: "Autre", label: "Autre" },
];

export function FormateurSupportsFilters({
  filters,
  onFiltersChange,
}: FormateurSupportsFiltersProps) {
  const { data: formationsData, isLoading: isLoadingFormations } = useFormations({ limit: 100 });
  const formations = formationsData?.data?.formations || [];

  const handleSearchChange = (value: string) => {
    onFiltersChange({
      search: value || undefined,
    });
  };

  const handleFormationChange = (value: string) => {
    onFiltersChange({
      formation_id: value === "all" ? undefined : value,
    });
  };

  const handleTypeChange = (value: string) => {
    onFiltersChange({
      type_fichier: value === "all" ? undefined : value as any,
    });
  };

  const clearFilters = () => {
    onFiltersChange({
      search: undefined,
      formation_id: undefined,
      type_fichier: undefined,
      session_id: undefined,
    });
  };

  const hasActiveFilters =
    filters.search ||
    filters.formation_id ||
    filters.type_fichier ||
    filters.session_id;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="text-lg flex items-center gap-2">
            <Filter className="h-4 w-4" />
            Filtres
          </CardTitle>
          {hasActiveFilters && (
            <Button variant="ghost" size="sm" onClick={clearFilters}>
              <X className="h-4 w-4 mr-1" />
              Réinitialiser
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* Search */}
        <div className="space-y-2">
          <Label htmlFor="search">Recherche</Label>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              id="search"
              placeholder="Titre du support..."
              value={filters.search || ""}
              onChange={(e) => handleSearchChange(e.target.value)}
              className="pl-9"
            />
          </div>
        </div>

        {/* Formation */}
        <div className="space-y-2">
          <Label htmlFor="formation">Formation</Label>
          {isLoadingFormations ? (
            <div className="flex items-center justify-center py-2">
              <Loader2 className="h-4 w-4 animate-spin" />
            </div>
          ) : (
            <select
              id="formation"
              value={filters.formation_id || "all"}
              onChange={(e) => handleFormationChange(e.target.value)}
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
            >
              <option value="all">Toutes les formations</option>
              {formations.map((formation) => (
                <option key={formation.id} value={formation.id}>
                  {formation.titre}
                </option>
              ))}
            </select>
          )}
        </div>

        {/* File Type */}
        <div className="space-y-2">
          <Label htmlFor="type">Type de fichier</Label>
          <select
            id="type"
            value={filters.type_fichier || "all"}
            onChange={(e) => handleTypeChange(e.target.value)}
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
          >
            <option value="all">Tous les types</option>
            {typeOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>
        </div>
      </CardContent>
    </Card>
  );
}
