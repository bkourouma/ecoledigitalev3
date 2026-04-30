"use client";

import { useState } from "react";
import {
  Card,
  CardContent,
  Button,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Checkbox,
} from "@ecoledigitale/ui";
import { Search, X, Filter } from "lucide-react";
import { useFormations } from "@/lib/hooks/use-formations-pro";
import { Loader2 } from "lucide-react";
import DatePickerFr from "@/components/DatePickerFr";
import { cn } from "@/lib/utils";

interface AdminSessionsFiltersProps {
  filters: {
    search?: string;
    formation_id?: string;
    statut?: string[];
    mode?: string[];
    date_debut?: string;
    date_fin?: string;
  };
  onFiltersChange: (filters: {
    search?: string;
    formation_id?: string;
    statut?: string[];
    mode?: string[];
    date_debut?: string;
    date_fin?: string;
  }) => void;
  className?: string;
}

const statutOptions = [
  { value: "planifiee", label: "Planifiée" },
  { value: "ouverte", label: "Ouverte" },
  { value: "complete", label: "Complète" },
  { value: "en_cours", label: "En cours" },
  { value: "terminee", label: "Terminée" },
  { value: "annulee", label: "Annulée" },
];

const modeOptions = [
  { value: "presentiel", label: "Présentiel" },
  { value: "distanciel", label: "Distanciel" },
  { value: "hybride", label: "Hybride" },
];

export function AdminSessionsFilters({
  filters,
  onFiltersChange,
  className,
}: AdminSessionsFiltersProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const { data: formationsData, isLoading: isLoadingFormations } = useFormations({ limit: 100 });
  const formations = formationsData?.data?.formations || [];

  const handleSearchChange = (value: string) => {
    onFiltersChange({
      ...filters,
      search: value || undefined,
    });
  };

  const handleFormationChange = (value: string) => {
    onFiltersChange({
      ...filters,
      formation_id: value === "all" ? undefined : value,
    });
  };

  const handleStatutToggle = (statut: string, checked: boolean) => {
    const currentStatuts = filters.statut || [];
    const newStatuts = checked
      ? [...currentStatuts, statut]
      : currentStatuts.filter((s) => s !== statut);
    onFiltersChange({
      ...filters,
      statut: newStatuts.length > 0 ? newStatuts : undefined,
    });
  };

  const handleModeToggle = (mode: string, checked: boolean) => {
    const currentModes = filters.mode || [];
    const newModes = checked
      ? [...currentModes, mode]
      : currentModes.filter((m) => m !== mode);
    onFiltersChange({
      ...filters,
      mode: newModes.length > 0 ? newModes : undefined,
    });
  };

  const handleDateDebutChange = (date: string) => {
    onFiltersChange({
      ...filters,
      date_debut: date || undefined,
    });
  };

  const handleDateFinChange = (date: string) => {
    onFiltersChange({
      ...filters,
      date_fin: date || undefined,
    });
  };

  const handleReset = () => {
    onFiltersChange({});
  };

  const hasActiveFilters =
    filters.search ||
    filters.formation_id ||
    (filters.statut && filters.statut.length > 0) ||
    (filters.mode && filters.mode.length > 0) ||
    filters.date_debut ||
    filters.date_fin;

  return (
    <Card className={cn("w-full min-w-0", className)}>
      <CardContent className="pt-4 sm:pt-6 p-4 sm:p-6 min-w-0">
        <div className="space-y-4 min-w-0">
          {/* Search and basic filters */}
          <div className="flex flex-col sm:flex-row gap-3 sm:gap-4 min-w-0">
            {/* Search */}
            <div className="flex-1 relative">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                type="text"
                placeholder="Rechercher par code session ou formation..."
                value={filters.search || ""}
                onChange={(e) => handleSearchChange(e.target.value)}
                className="pl-10"
              />
            </div>

            {/* Formation filter */}
            <Select
              value={filters.formation_id || "all"}
              onValueChange={handleFormationChange}
            >
              <SelectTrigger className="w-full sm:w-[200px] md:w-[250px]">
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

            {/* Expand/Collapse button */}
            <Button
              variant="outline"
              onClick={() => setIsExpanded(!isExpanded)}
              className="flex items-center justify-center gap-2 w-full sm:w-auto"
              size="sm"
            >
              <Filter className="w-4 h-4" />
              <span className="hidden sm:inline">{isExpanded ? "Moins de filtres" : "Plus de filtres"}</span>
              <span className="sm:hidden">{isExpanded ? "Moins" : "Filtres"}</span>
            </Button>

            {/* Reset button */}
            {hasActiveFilters && (
              <Button
                variant="outline"
                onClick={handleReset}
                className="flex items-center justify-center gap-2 w-full sm:w-auto"
                size="sm"
              >
                <X className="w-4 h-4" />
                <span className="hidden sm:inline">Réinitialiser</span>
                <span className="sm:hidden">Reset</span>
              </Button>
            )}
          </div>

          {/* Expanded filters */}
          {isExpanded && (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 pt-4 border-t">
              {/* Status filters */}
              <div className="space-y-2">
                <label className="text-sm font-medium text-foreground">Statut</label>
                <div className="space-y-2">
                  {statutOptions.map((option) => (
                    <div key={option.value} className="flex items-center space-x-2">
                      <Checkbox
                        id={`statut-${option.value}`}
                        checked={filters.statut?.includes(option.value) || false}
                        onCheckedChange={(checked) =>
                          handleStatutToggle(option.value, checked as boolean)
                        }
                      />
                      <label
                        htmlFor={`statut-${option.value}`}
                        className="text-sm text-foreground/80 cursor-pointer"
                      >
                        {option.label}
                      </label>
                    </div>
                  ))}
                </div>
              </div>

              {/* Mode filters */}
              <div className="space-y-2">
                <label className="text-sm font-medium text-foreground">Mode</label>
                <div className="space-y-2">
                  {modeOptions.map((option) => (
                    <div key={option.value} className="flex items-center space-x-2">
                      <Checkbox
                        id={`mode-${option.value}`}
                        checked={filters.mode?.includes(option.value) || false}
                        onCheckedChange={(checked) =>
                          handleModeToggle(option.value, checked as boolean)
                        }
                      />
                      <label
                        htmlFor={`mode-${option.value}`}
                        className="text-sm text-foreground/80 cursor-pointer"
                      >
                        {option.label}
                      </label>
                    </div>
                  ))}
                </div>
              </div>

              {/* Date range */}
              <div className="space-y-2">
                <label className="text-sm font-medium text-foreground">Date de début</label>
                <DatePickerFr
                  value={filters.date_debut}
                  onChange={handleDateDebutChange}
                  placeholder="Sélectionner une date"
                />
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium text-foreground">Date de fin</label>
                <DatePickerFr
                  value={filters.date_fin}
                  onChange={handleDateFinChange}
                  placeholder="Sélectionner une date"
                  min={filters.date_debut}
                />
              </div>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

