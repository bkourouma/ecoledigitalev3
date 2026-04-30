"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@ecoledigitale/ui";
import { Input } from "@ecoledigitale/ui";
import { Label } from "@ecoledigitale/ui";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@ecoledigitale/ui/select";
import { Button } from "@ecoledigitale/ui";
import { EnrollmentHistoryQuerySchema } from "@ecoledigitale/contracts/src/inscriptions-pro";
import { z } from "zod";
import { useState, useEffect } from "react";
import { Search, X } from "lucide-react";

interface InscriptionFiltersProps {
  filters: z.infer<typeof EnrollmentHistoryQuerySchema>;
  onFiltersChange: (filters: Partial<z.infer<typeof EnrollmentHistoryQuerySchema>>) => void;
}

export function InscriptionFilters({ filters, onFiltersChange }: InscriptionFiltersProps) {
  const [localFilters, setLocalFilters] = useState({
    statut: filters.statut || "toutes",
    search: filters.search || "",
    date_debut: filters.date_debut || "",
    date_fin: filters.date_fin || "",
  });

  useEffect(() => {
    setLocalFilters({
      statut: filters.statut || "toutes",
      search: filters.search || "",
      date_debut: filters.date_debut || "",
      date_fin: filters.date_fin || "",
    });
  }, [filters]);

  const handleFilterChange = (key: string, value: string) => {
    const newFilters = { ...localFilters, [key]: value };
    setLocalFilters(newFilters);
    onFiltersChange({
      ...newFilters,
      statut: newFilters.statut === "toutes" ? undefined : (newFilters.statut as any),
      search: newFilters.search || undefined,
      date_debut: newFilters.date_debut || undefined,
      date_fin: newFilters.date_fin || undefined,
    });
  };

  const handleClearFilters = () => {
    const clearedFilters = {
      statut: "toutes",
      search: "",
      date_debut: "",
      date_fin: "",
    };
    setLocalFilters(clearedFilters);
    onFiltersChange({
      statut: undefined,
      search: undefined,
      date_debut: undefined,
      date_fin: undefined,
    });
  };

  const hasActiveFilters =
    localFilters.statut !== "toutes" ||
    localFilters.search !== "" ||
    localFilters.date_debut !== "" ||
    localFilters.date_fin !== "";

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle>Filtres</CardTitle>
          {hasActiveFilters && (
            <Button variant="ghost" size="sm" onClick={handleClearFilters}>
              <X className="h-4 w-4 mr-1" />
              Réinitialiser
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Status filter */}
        <div>
          <Label htmlFor="statut">Statut</Label>
          <Select
            value={localFilters.statut}
            onValueChange={(value) => handleFilterChange("statut", value)}
          >
            <SelectTrigger id="statut">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="toutes">Toutes</SelectItem>
              <SelectItem value="en_attente">En attente</SelectItem>
              <SelectItem value="confirmee">Confirmée</SelectItem>
              <SelectItem value="annulee">Annulée</SelectItem>
              <SelectItem value="terminee">Terminée</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* Search filter */}
        <div>
          <Label htmlFor="search">Rechercher</Label>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              id="search"
              placeholder="Formation ou session..."
              value={localFilters.search}
              onChange={(e) => handleFilterChange("search", e.target.value)}
              className="pl-9"
            />
          </div>
        </div>

        {/* Date range filters */}
        <div>
          <Label htmlFor="date_debut">Date de début</Label>
          <Input
            id="date_debut"
            type="date"
            value={localFilters.date_debut ? localFilters.date_debut.split("T")[0] : ""}
            onChange={(e) =>
              handleFilterChange("date_debut", e.target.value ? `${e.target.value}T00:00:00Z` : "")
            }
          />
        </div>

        <div>
          <Label htmlFor="date_fin">Date de fin</Label>
          <Input
            id="date_fin"
            type="date"
            value={localFilters.date_fin ? localFilters.date_fin.split("T")[0] : ""}
            onChange={(e) =>
              handleFilterChange("date_fin", e.target.value ? `${e.target.value}T23:59:59Z` : "")
            }
          />
        </div>
      </CardContent>
    </Card>
  );
}

