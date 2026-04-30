"use client";

import { useState, useEffect, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle, Button, Checkbox, Label } from "@ecoledigitale/ui";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Filter, X, RotateCcw } from "lucide-react";
import { useThemes, useFormationStats } from "@/lib/hooks/use-formations-pro";
import { FormationListQuery, Niveau } from "@ecoledigitale/contracts";
import { cn } from "@/lib/utils";
import { Slider } from "@/components/ui/slider";
import { Input } from "@ecoledigitale/ui";

interface FiltersSidebarProps {
  filters: FormationListQuery;
  onFiltersChange: (filters: FormationListQuery) => void;
  className?: string;
}

const NIVEAU_OPTIONS: { value: Niveau; label: string }[] = [
  { value: "Débutant", label: "Débutant" },
  { value: "Intermédiaire", label: "Intermédiaire" },
  { value: "Avancé", label: "Avancé" },
];

const MODE_OPTIONS: { value: "presentiel" | "distanciel" | "hybride"; label: string }[] = [
  { value: "presentiel", label: "Présentiel" },
  { value: "distanciel", label: "Distanciel" },
  { value: "hybride", label: "Hybride" },
];

export function FiltersSidebar({ filters, onFiltersChange, className }: FiltersSidebarProps) {
  const { data: themesData, isLoading: themesLoading } = useThemes();
  const { data: statsData, isLoading: statsLoading } = useFormationStats();

  const themes = themesData?.data?.themes || [];
  const stats = statsData?.data;

  // Local state for filters
  const [localFilters, setLocalFilters] = useState<FormationListQuery>(filters);

  // Sync local filters when props change
  useEffect(() => {
    setLocalFilters(filters);
  }, [filters]);

  // Calculate active filter count
  const activeFilterCount = useMemo(() => {
    let count = 0;
    if (localFilters.themes && localFilters.themes.length > 0) count++;
    if (localFilters.duree_min !== undefined) count++;
    if (localFilters.duree_max !== undefined) count++;
    if (localFilters.prix_min !== undefined) count++;
    if (localFilters.prix_max !== undefined) count++;
    if (localFilters.niveau) count++;
    if (localFilters.mode && localFilters.mode.length > 0) count++;
    if (localFilters.certification !== undefined) count++;
    return count;
  }, [localFilters]);

  const handleThemeToggle = (theme: string) => {
    const currentThemes = localFilters.themes || [];
    const newThemes = currentThemes.includes(theme)
      ? currentThemes.filter((t) => t !== theme)
      : [...currentThemes, theme];
    
    const updated = { ...localFilters, themes: newThemes.length > 0 ? newThemes : undefined };
    setLocalFilters(updated);
    onFiltersChange(updated);
  };

  const handleDurationChange = (type: "min" | "max", value: number | undefined) => {
    const updated = {
      ...localFilters,
      [type === "min" ? "duree_min" : "duree_max"]: value,
    };
    setLocalFilters(updated);
    onFiltersChange(updated);
  };

  const handlePriceChange = (type: "min" | "max", value: number | undefined) => {
    const updated = {
      ...localFilters,
      [type === "min" ? "prix_min" : "prix_max"]: value,
    };
    setLocalFilters(updated);
    onFiltersChange(updated);
  };

  const handleNiveauChange = (niveau: Niveau | undefined) => {
    const updated = { ...localFilters, niveau };
    setLocalFilters(updated);
    onFiltersChange(updated);
  };

  const handleModeToggle = (mode: "presentiel" | "distanciel" | "hybride") => {
    const currentModes = localFilters.mode || [];
    const newModes = currentModes.includes(mode)
      ? currentModes.filter((m) => m !== mode)
      : [...currentModes, mode];
    
    const updated = { ...localFilters, mode: newModes.length > 0 ? newModes : undefined };
    setLocalFilters(updated);
    onFiltersChange(updated);
  };

  const handleCertificationToggle = (value: boolean | undefined) => {
    const updated = { ...localFilters, certification: value };
    setLocalFilters(updated);
    onFiltersChange(updated);
  };

  const handleReset = () => {
    const resetFilters: FormationListQuery = {
      page: 1,
      limit: filters.limit,
      sort: filters.sort,
    };
    setLocalFilters(resetFilters);
    onFiltersChange(resetFilters);
  };

  const prixMin = stats?.prix?.min || 0;
  const prixMax = stats?.prix?.max || 1000000;
  const dureeMin = stats?.duree?.min || 0;
  const dureeMax = stats?.duree?.max || 30;

  return (
    <Card className={cn("", className)}>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-lg flex items-center gap-2">
            <Filter className="h-5 w-5" />
            Filtres
            {activeFilterCount > 0 && (
              <span className="ml-2 px-2 py-0.5 text-xs bg-primary text-primary-foreground rounded-full">
                {activeFilterCount}
              </span>
            )}
          </CardTitle>
          {activeFilterCount > 0 && (
            <Button
              variant="ghost"
              size="sm"
              onClick={handleReset}
              className="h-8 px-2 text-xs"
              title="Réinitialiser les filtres"
            >
              <RotateCcw className="h-4 w-4" />
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-6">
          {/* Themes */}
          <div className="space-y-3">
            <Label className="text-sm font-semibold">Thèmes</Label>
            {themesLoading ? (
              <div className="text-sm text-muted-foreground">Chargement...</div>
            ) : themes.length > 0 ? (
              <div className="space-y-2 max-h-48 overflow-y-auto">
                {themes.map((theme) => (
                  <div key={theme.value} className="flex items-center space-x-2">
                    <Checkbox
                      id={`theme-${theme.value}`}
                      checked={localFilters.themes?.includes(theme.value) || false}
                      onCheckedChange={() => handleThemeToggle(theme.value)}
                    />
                    <Label
                      htmlFor={`theme-${theme.value}`}
                      className="text-sm font-normal cursor-pointer flex-1 flex items-center justify-between"
                    >
                      <span>{theme.label}</span>
                      <span className="text-xs text-muted-foreground ml-2">({theme.count})</span>
                    </Label>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-sm text-muted-foreground">Aucun thème disponible</div>
            )}
          </div>

          {/* Duration Range */}
          <div className="space-y-3">
            <Label className="text-sm font-semibold">Durée (jours)</Label>
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1">
                  <Label htmlFor="duree-min" className="text-xs text-muted-foreground">
                    Min
                  </Label>
                  <Input
                    id="duree-min"
                    type="number"
                    min={dureeMin}
                    max={dureeMax}
                    value={localFilters.duree_min ?? ""}
                    onChange={(e) => {
                      const value = e.target.value ? parseInt(e.target.value, 10) : undefined;
                      handleDurationChange("min", value);
                    }}
                    placeholder={dureeMin.toString()}
                    className="h-8"
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="duree-max" className="text-xs text-muted-foreground">
                    Max
                  </Label>
                  <Input
                    id="duree-max"
                    type="number"
                    min={dureeMin}
                    max={dureeMax}
                    value={localFilters.duree_max ?? ""}
                    onChange={(e) => {
                      const value = e.target.value ? parseInt(e.target.value, 10) : undefined;
                      handleDurationChange("max", value);
                    }}
                    placeholder={dureeMax.toString()}
                    className="h-8"
                  />
                </div>
              </div>
              {!statsLoading && (
                <Slider
                  value={[
                    localFilters.duree_min ?? dureeMin,
                    localFilters.duree_max ?? dureeMax,
                  ]}
                  min={dureeMin}
                  max={dureeMax}
                  step={1}
                  onValueChange={([min, max]) => {
                    handleDurationChange("min", min);
                    handleDurationChange("max", max);
                  }}
                  className="w-full"
                />
              )}
            </div>
          </div>

          {/* Price Range */}
          <div className="space-y-3">
            <Label className="text-sm font-semibold">Prix (FCFA)</Label>
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1">
                  <Label htmlFor="prix-min" className="text-xs text-muted-foreground">
                    Min
                  </Label>
                  <Input
                    id="prix-min"
                    type="number"
                    min={prixMin}
                    max={prixMax}
                    value={localFilters.prix_min ?? ""}
                    onChange={(e) => {
                      const value = e.target.value ? parseFloat(e.target.value) : undefined;
                      handlePriceChange("min", value);
                    }}
                    placeholder={prixMin.toLocaleString()}
                    className="h-8"
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="prix-max" className="text-xs text-muted-foreground">
                    Max
                  </Label>
                  <Input
                    id="prix-max"
                    type="number"
                    min={prixMin}
                    max={prixMax}
                    value={localFilters.prix_max ?? ""}
                    onChange={(e) => {
                      const value = e.target.value ? parseFloat(e.target.value) : undefined;
                      handlePriceChange("max", value);
                    }}
                    placeholder={prixMax.toLocaleString()}
                    className="h-8"
                  />
                </div>
              </div>
              {!statsLoading && (
                <Slider
                  value={[
                    localFilters.prix_min ?? prixMin,
                    localFilters.prix_max ?? prixMax,
                  ]}
                  min={prixMin}
                  max={prixMax}
                  step={1000}
                  onValueChange={([min, max]) => {
                    handlePriceChange("min", min);
                    handlePriceChange("max", max);
                  }}
                  className="w-full"
                />
              )}
            </div>
          </div>

          {/* Level */}
          <div className="space-y-3">
            <Label className="text-sm font-semibold">Niveau</Label>
            <RadioGroup
              value={localFilters.niveau || "all"}
              onValueChange={(value) => handleNiveauChange(value === "all" ? undefined : (value as Niveau))}
            >
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="all" id="niveau-all" />
                <Label htmlFor="niveau-all" className="text-sm font-normal cursor-pointer">
                  Tous les niveaux
                </Label>
              </div>
              {NIVEAU_OPTIONS.map((option) => (
                <div key={option.value} className="flex items-center space-x-2">
                  <RadioGroupItem value={option.value} id={`niveau-${option.value}`} />
                  <Label htmlFor={`niveau-${option.value}`} className="text-sm font-normal cursor-pointer">
                    {option.label}
                  </Label>
                </div>
              ))}
            </RadioGroup>
          </div>

          {/* Mode */}
          <div className="space-y-3">
            <Label className="text-sm font-semibold">Mode de formation</Label>
            <div className="space-y-2">
              {MODE_OPTIONS.map((option) => (
                <div key={option.value} className="flex items-center space-x-2">
                  <Checkbox
                    id={`mode-${option.value}`}
                    checked={localFilters.mode?.includes(option.value) || false}
                    onCheckedChange={() => handleModeToggle(option.value)}
                  />
                  <Label
                    htmlFor={`mode-${option.value}`}
                    className="text-sm font-normal cursor-pointer"
                  >
                    {option.label}
                  </Label>
                </div>
              ))}
            </div>
          </div>

          {/* Certification */}
          <div className="space-y-3">
            <Label className="text-sm font-semibold">Certification</Label>
            <div className="space-y-2">
              <div className="flex items-center space-x-2">
                <Checkbox
                  id="certification-all"
                  checked={localFilters.certification === undefined}
                  onCheckedChange={(checked) => handleCertificationToggle(checked ? undefined : false)}
                />
                <Label htmlFor="certification-all" className="text-sm font-normal cursor-pointer">
                  Toutes les formations
                </Label>
              </div>
              <div className="flex items-center space-x-2">
                <Checkbox
                  id="certification-yes"
                  checked={localFilters.certification === true}
                  onCheckedChange={(checked) => handleCertificationToggle(checked ? true : undefined)}
                />
                <Label htmlFor="certification-yes" className="text-sm font-normal cursor-pointer">
                  Avec certification uniquement
                </Label>
              </div>
            </div>
          </div>
        </div>
        
        {/* Reset Button - Full Width */}
        {activeFilterCount > 0 && (
          <div className="col-span-full pt-2">
            <Button
              variant="outline"
              onClick={handleReset}
              className="w-full"
            >
              <X className="h-4 w-4 mr-2" />
              Réinitialiser les filtres
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

