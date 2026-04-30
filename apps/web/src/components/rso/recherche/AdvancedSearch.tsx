"use client";

import { useState, useEffect } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Button,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Label,
} from "@ecoledigitale/ui";
import { Search, X, Calendar } from "lucide-react";
import { useActivityTypes } from "@/lib/rso/activites";
import type { ActivitySearchRequest } from "@ecoledigitale/contracts/rso/recherche/recherche.contracts";
import { format } from "date-fns";

interface AdvancedSearchProps {
  onSearch: (request: ActivitySearchRequest) => void;
  loading?: boolean;
  initialFilters?: Partial<ActivitySearchRequest>;
}

export function AdvancedSearch({
  onSearch,
  loading = false,
  initialFilters,
}: AdvancedSearchProps) {
  const [searchTerm, setSearchTerm] = useState(initialFilters?.q || "");
  const [anneeId, setAnneeId] = useState<number | undefined>(initialFilters?.anneeId);
  const [installationId, setInstallationId] = useState<number | undefined>(
    initialFilters?.installationId
  );
  const [typeActivite, setTypeActivite] = useState<string | undefined>(
    initialFilters?.typeActivite
  );
  const [statut, setStatut] = useState<string | undefined>(initialFilters?.statut);
  const [dateDebut, setDateDebut] = useState<string | undefined>(initialFilters?.dateDebut);
  const [dateFin, setDateFin] = useState<string | undefined>(initialFilters?.dateFin);
  const [tri, setTri] = useState<"pertinence" | "date_desc" | "date_asc" | "titre_asc">(
    initialFilters?.tri || "pertinence"
  );

  const { data: activityTypes } = useActivityTypes();

  const handleSearch = () => {
    if (!searchTerm.trim()) {
      return;
    }

    onSearch({
      q: searchTerm.trim(),
      anneeId,
      installationId,
      typeActivite: typeActivite as any,
      statut: statut as any,
      dateDebut,
      dateFin,
      tri,
      page: 1,
      limit: 20,
    });
  };

  const handleReset = () => {
    setSearchTerm("");
    setAnneeId(undefined);
    setInstallationId(undefined);
    setTypeActivite(undefined);
    setStatut(undefined);
    setDateDebut(undefined);
    setDateFin(undefined);
    setTri("pertinence");
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      handleSearch();
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Recherche Avancée</CardTitle>
        <CardDescription>
          Recherchez dans les activités par mots-clés, filtres et critères
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          {/* Search Input */}
          <div>
            <Label htmlFor="search">Recherche</Label>
            <div className="flex gap-2 mt-1">
              <Input
                id="search"
                placeholder="Entrez vos mots-clés..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                onKeyDown={handleKeyDown}
                className="flex-1"
              />
              <Button onClick={handleSearch} disabled={loading || !searchTerm.trim()}>
                <Search className="h-4 w-4 mr-2" />
                Rechercher
              </Button>
            </div>
          </div>

          {/* Filters Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {/* Year Filter */}
            <div>
              <Label htmlFor="annee">Année</Label>
              <Input
                id="annee"
                type="number"
                placeholder="Ex: 2024"
                value={anneeId || ""}
                onChange={(e) =>
                  setAnneeId(e.target.value ? parseInt(e.target.value, 10) : undefined)
                }
                min="2020"
                max="2030"
              />
            </div>

            {/* Type Filter */}
            <div>
              <Label htmlFor="type">Type d'Activité</Label>
              <Select value={typeActivite || "all"} onValueChange={(value) => setTypeActivite(value === "all" ? undefined : value)}>
                <SelectTrigger id="type">
                  <SelectValue placeholder="Tous les types" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Tous les types</SelectItem>
                  {activityTypes?.types?.map((type) => (
                    <SelectItem key={type.code} value={type.code}>
                      {type.libelle}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Status Filter */}
            <div>
              <Label htmlFor="statut">Statut</Label>
              <Select value={statut || "all"} onValueChange={(value) => setStatut(value === "all" ? undefined : value)}>
                <SelectTrigger id="statut">
                  <SelectValue placeholder="Tous les statuts" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Tous les statuts</SelectItem>
                  <SelectItem value="brouillon">Brouillon</SelectItem>
                  <SelectItem value="en_cours">En cours</SelectItem>
                  <SelectItem value="termine">Terminé</SelectItem>
                  <SelectItem value="valide">Validé</SelectItem>
                  <SelectItem value="archive">Archivé</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Date Range */}
            <div>
              <Label htmlFor="dateDebut">Date de début</Label>
              <Input
                id="dateDebut"
                type="date"
                value={dateDebut || ""}
                onChange={(e) => setDateDebut(e.target.value || undefined)}
              />
            </div>

            <div>
              <Label htmlFor="dateFin">Date de fin</Label>
              <Input
                id="dateFin"
                type="date"
                value={dateFin || ""}
                onChange={(e) => setDateFin(e.target.value || undefined)}
              />
            </div>

            {/* Sort */}
            <div>
              <Label htmlFor="tri">Trier par</Label>
              <Select value={tri} onValueChange={(value) => setTri(value as any)}>
                <SelectTrigger id="tri">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="pertinence">Pertinence</SelectItem>
                  <SelectItem value="date_desc">Date (récent)</SelectItem>
                  <SelectItem value="date_asc">Date (ancien)</SelectItem>
                  <SelectItem value="titre_asc">Titre (A-Z)</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Actions */}
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={handleReset}>
              <X className="h-4 w-4 mr-2" />
              Réinitialiser
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

