"use client";

import { useState } from "react";
import { Cycle, CycleStatus, CycleType } from "@ecoledigitale/contracts";
import { 
  Card, 
  CardContent, 
  CardDescription, 
  CardHeader, 
  CardTitle, 
  Button,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue 
} from "@ecoledigitale/ui";
import { CycleCard } from "./CycleCard";
import { Plus, Filter, Search } from "lucide-react";

interface CyclesListProps {
  cycles: Cycle[];
  isLoading?: boolean;
  onCreateNew: () => void;
  onEdit: (cycle: Cycle) => void;
  onView: (cycle: Cycle) => void;
}

const statusOptions = [
  { value: "", label: "Tous les statuts" },
  { value: "draft", label: "Brouillon" },
  { value: "active", label: "Actif" },
  { value: "archived", label: "Archivé" },
];

const typeOptions = [
  { value: "", label: "Tous les types" },
  { value: "academic", label: "Académique" },
  { value: "professional", label: "Professionnel" },
  { value: "short", label: "Formation courte" },
  { value: "certification", label: "Certification" },
];

export function CyclesList({ cycles, isLoading, onCreateNew, onEdit, onView }: CyclesListProps) {
  const [filters, setFilters] = useState({
    status: "",
    type: "",
    search: "",
  });

  const filteredCycles = cycles.filter((cycle) => {
    const matchesStatus = !filters.status || cycle.status === filters.status;
    const matchesType = !filters.type || cycle.type === filters.type;
    const matchesSearch = !filters.search || 
      cycle.name.toLowerCase().includes(filters.search.toLowerCase()) ||
      cycle.code.toLowerCase().includes(filters.search.toLowerCase());
    
    return matchesStatus && matchesType && matchesSearch;
  });

  const handleFilterChange = (key: string, value: string) => {
    setFilters(prev => ({ ...prev, [key]: value }));
  };

  if (isLoading) {
    return (
      <div className="space-y-4">
        <div className="flex justify-between items-center">
          <h2 className="text-2xl font-bold">Cycles académiques</h2>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {[...Array(6)].map((_, i) => (
            <Card key={i} className="animate-pulse">
              <CardHeader>
                <div className="h-4 bg-gray-200 rounded w-3/4"></div>
                <div className="h-3 bg-gray-200 rounded w-1/2"></div>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  <div className="h-3 bg-gray-200 rounded"></div>
                  <div className="h-3 bg-gray-200 rounded w-2/3"></div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h2 className="text-2xl font-bold">Cycles académiques</h2>
          <p className="text-muted-foreground">
            Gérez les cycles de formation de votre établissement
          </p>
        </div>
        <Button onClick={onCreateNew}>
          <Plus className="h-4 w-4 mr-2" />
          Nouveau cycle
        </Button>
      </div>

      {/* Filters */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <Filter className="h-5 w-5" />
            Filtres
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">Recherche</label>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <input
                  type="text"
                  placeholder="Nom ou code..."
                  value={filters.search}
                  onChange={(e) => handleFilterChange("search", e.target.value)}
                  className="w-full pl-10 pr-3 py-2 border border-input rounded-md bg-background text-sm"
                />
              </div>
            </div>
            
            <div className="space-y-2">
              <label className="text-sm font-medium">Statut</label>
              <Select value={filters.status} onValueChange={(value) => handleFilterChange("status", value)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {statusOptions.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            
            <div className="space-y-2">
              <label className="text-sm font-medium">Type</label>
              <Select value={filters.type} onValueChange={(value) => handleFilterChange("type", value)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {typeOptions.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Results */}
      <div>
        <div className="flex justify-between items-center mb-4">
          <p className="text-sm text-muted-foreground">
            {filteredCycles.length} cycle(s) trouvé(s)
          </p>
        </div>
        
        {filteredCycles.length === 0 ? (
          <Card>
            <CardContent className="flex flex-col items-center justify-center py-12">
              <div className="text-center space-y-2">
                <h3 className="text-lg font-medium">Aucun cycle trouvé</h3>
                <p className="text-muted-foreground">
                  {cycles.length === 0 
                    ? "Commencez par créer votre premier cycle académique"
                    : "Essayez de modifier vos critères de recherche"
                  }
                </p>
                {cycles.length === 0 && (
                  <Button onClick={onCreateNew} className="mt-4">
                    <Plus className="h-4 w-4 mr-2" />
                    Créer un cycle
                  </Button>
                )}
              </div>
            </CardContent>
          </Card>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {filteredCycles.map((cycle) => (
              <CycleCard
                key={cycle.id}
                cycle={cycle}
                onEdit={onEdit}
                onView={onView}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
