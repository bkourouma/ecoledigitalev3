"use client";

import { useState } from "react";
import {
  Card,
  CardContent,
  Button,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@ecoledigitale/ui";
import { X, Filter } from "lucide-react";
import { useFormations } from "@/lib/hooks/use-formations-pro";
import { Loader2 } from "lucide-react";
import DatePickerFr from "@/components/DatePickerFr";
import { cn } from "@/lib/utils";
import { SessionListQuery } from "@ecoledigitale/contracts";

interface SessionsFiltersProps {
  filters: SessionListQuery;
  onFiltersChange: (filters: Partial<SessionListQuery>) => void;
  className?: string;
}

const statutOptions = [
  { value: "planifiee", label: "Planifiée" },
  { value: "ouverte", label: "Ouverte" },
  { value: "complete", label: "Complète" },
  { value: "en_cours", label: "En cours" },
  { value: "terminee", label: "Terminée" },
];

const modeOptions = [
  { value: "presentiel", label: "Présentiel" },
  { value: "distanciel", label: "Distanciel" },
  { value: "hybride", label: "Hybride" },
];

export function SessionsFilters({
  filters,
  onFiltersChange,
  className,
}: SessionsFiltersProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const { data: formationsData, isLoading: isLoadingFormations } = useFormations({ limit: 100 });
  const formations = formationsData?.data?.formations || [];

  const handleFormationChange = (value: string) => {
    onFiltersChange({
      formation_id: value === "all" ? undefined : value,
      page: 1,
    });
  };

  const handleStatutChange = (value: string) => {
    onFiltersChange({
      statut: value === "all" ? undefined : [value],
      page: 1,
    });
  };

  const handleModeChange = (value: string) => {
    onFiltersChange({
      mode: value === "all" ? undefined : [value],
      page: 1,
    });
  };

  const handleDateDebutChange = (date: Date | undefined) => {
    onFiltersChange({
      date_debut: date ? date.toISOString().split('T')[0] : undefined,
      page: 1,
    });
  };

  const handleDateFinChange = (date: Date | undefined) => {
    onFiltersChange({
      date_fin: date ? date.toISOString().split('T')[0] : undefined,
      page: 1,
    });
  };

  const clearFilters = () => {
    onFiltersChange({
      formation_id: undefined,
      statut: undefined,
      mode: undefined,
      date_debut: undefined,
      date_fin: undefined,
      page: 1,
    });
  };

  const hasActiveFilters =
    filters.formation_id ||
    (Array.isArray(filters.statut) && filters.statut.length > 0) ||
    (Array.isArray(filters.mode) && filters.mode.length > 0) ||
    filters.date_debut ||
    filters.date_fin;

  return (
    <Card className={cn("", className)}>
      <CardContent className="pt-6">
        <div className="space-y-4">
          {/* Main Filters Row */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {/* Formation Filter */}
            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground">Formation</label>
              <Select
                value={filters.formation_id || "all"}
                onValueChange={handleFormationChange}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Toutes les formations" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Toutes les formations</SelectItem>
                  {isLoadingFormations ? (
                    <div className="flex items-center justify-center p-4">
                      <Loader2 className="w-4 h-4 animate-spin" />
                    </div>
                  ) : (
                    formations.map((formation) => (
                      <SelectItem key={formation.id} value={formation.id}>
                        {formation.titre}
                      </SelectItem>
                    ))
                  )}
                </SelectContent>
              </Select>
            </div>

            {/* Mode Filter */}
            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground">Mode de formation</label>
              <Select
                value={Array.isArray(filters.mode) && filters.mode.length > 0 ? filters.mode[0] : "all"}
                onValueChange={handleModeChange}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Tous les modes" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Tous les modes</SelectItem>
                  {modeOptions.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Statut Filter */}
            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground">Statut</label>
              <Select
                value={Array.isArray(filters.statut) && filters.statut.length > 0 ? filters.statut[0] : "all"}
                onValueChange={handleStatutChange}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Tous les statuts" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Tous les statuts</SelectItem>
                  {statutOptions.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Expandable Date Filters */}
          <div className="space-y-4">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setIsExpanded(!isExpanded)}
              className="w-full sm:w-auto"
            >
              <Filter className="w-4 h-4 mr-2" />
              {isExpanded ? "Masquer" : "Afficher"} les filtres de date
            </Button>

            {isExpanded && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2 border-t">
                <div className="space-y-2">
                  <label className="text-sm font-medium text-foreground">Date de début</label>
                  <DatePickerFr
                    value={filters.date_debut ? new Date(filters.date_debut) : undefined}
                    onChange={handleDateDebutChange}
                    placeholder="Sélectionner une date"
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium text-foreground">Date de fin</label>
                  <DatePickerFr
                    value={filters.date_fin ? new Date(filters.date_fin) : undefined}
                    onChange={handleDateFinChange}
                    placeholder="Sélectionner une date"
                  />
                </div>
              </div>
            )}
          </div>

          {/* Clear Filters Button */}
          {hasActiveFilters && (
            <div className="pt-2 border-t">
              <Button
                variant="outline"
                size="sm"
                onClick={clearFilters}
                className="w-full sm:w-auto"
              >
                <X className="w-4 h-4 mr-2" />
                Réinitialiser les filtres
              </Button>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

