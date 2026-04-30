"use client";

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@ecoledigitale/ui";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@ecoledigitale/ui";
import { Checkbox } from "@/components/ui/checkbox";
import { Search, X, Filter } from "lucide-react";
import { useFormations } from "@/lib/hooks/use-formations-pro";
import { Loader2 } from "lucide-react";
import DatePickerFr from "@/components/DatePickerFr";
import { SessionListQuerySchema } from "@ecoledigitale/contracts/src/formateurs";
import { z } from "zod";

type SessionListQuery = z.infer<typeof SessionListQuerySchema>;

interface FormateurSessionsFiltersProps {
  filters: SessionListQuery;
  onFiltersChange: (filters: Partial<SessionListQuery>) => void;
}

const statutOptions = [
  { value: "planifiee", label: "Planifiée" },
  { value: "ouverte", label: "Ouverte" },
  { value: "complete", label: "Complète" },
  { value: "en_cours", label: "En cours" },
  { value: "terminee", label: "Terminée" },
  { value: "annulee", label: "Annulée" },
];

export function FormateurSessionsFilters({
  filters,
  onFiltersChange,
}: FormateurSessionsFiltersProps) {
  const [isExpanded, setIsExpanded] = useState(false);
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

  const handleStatutToggle = (statut: string, checked: boolean) => {
    const currentStatuts = Array.isArray(filters.statuts) ? filters.statuts : [];
    const newStatuts = checked
      ? [...currentStatuts, statut]
      : currentStatuts.filter((s) => s !== statut);
    onFiltersChange({
      statuts: newStatuts.length > 0 ? newStatuts : undefined,
    });
  };

  const handleDateDebutChange = (date: Date | undefined) => {
    onFiltersChange({
      date_debut: date ? date.toISOString().split('T')[0] : undefined,
    });
  };

  const handleDateFinChange = (date: Date | undefined) => {
    onFiltersChange({
      date_fin: date ? date.toISOString().split('T')[0] : undefined,
    });
  };

  const clearFilters = () => {
    onFiltersChange({
      search: undefined,
      formation_id: undefined,
      statuts: undefined,
      date_debut: undefined,
      date_fin: undefined,
    });
  };

  const hasActiveFilters =
    filters.search ||
    filters.formation_id ||
    (Array.isArray(filters.statuts) && filters.statuts.length > 0) ||
    filters.date_debut ||
    filters.date_fin;

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
      <CardContent className="space-y-4">
        {/* Search */}
        <div className="space-y-2">
          <Label htmlFor="search">Recherche</Label>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              id="search"
              placeholder="Code session ou formation..."
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

        {/* Expandable filters */}
        <div className="space-y-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setIsExpanded(!isExpanded)}
            className="w-full justify-between"
          >
            <span>Filtres avancés</span>
            <Filter className={`h-4 w-4 transition-transform ${isExpanded ? "rotate-180" : ""}`} />
          </Button>

          {isExpanded && (
            <div className="space-y-4 pt-2 border-t">
              {/* Status filters */}
              <div className="space-y-2">
                <Label>Statut</Label>
                <div className="space-y-2">
                  {statutOptions.map((option) => {
                    const isChecked = Array.isArray(filters.statuts) && filters.statuts.includes(option.value);
                    return (
                      <div key={option.value} className="flex items-center space-x-2">
                        <Checkbox
                          id={`statut-${option.value}`}
                          checked={isChecked}
                          onCheckedChange={(checked) =>
                            handleStatutToggle(option.value, checked === true)
                          }
                        />
                        <Label
                          htmlFor={`statut-${option.value}`}
                          className="text-sm font-normal cursor-pointer"
                        >
                          {option.label}
                        </Label>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Date range */}
              <div className="space-y-2">
                <Label>Date de début</Label>
                <DatePickerFr
                  date={filters.date_debut ? new Date(filters.date_debut) : undefined}
                  onDateChange={handleDateDebutChange}
                />
              </div>

              <div className="space-y-2">
                <Label>Date de fin</Label>
                <DatePickerFr
                  date={filters.date_fin ? new Date(filters.date_fin) : undefined}
                  onDateChange={handleDateFinChange}
                />
              </div>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

