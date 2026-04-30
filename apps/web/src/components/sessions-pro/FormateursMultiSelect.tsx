"use client";

import { useState } from "react";
import { Input } from "@ecoledigitale/ui";
import { Search, User, Loader2 } from "lucide-react";
import { useFormateurs } from "@/lib/hooks/use-sessions-pro";
import { Card, CardContent } from "@ecoledigitale/ui";
import { cn } from "@/lib/utils";

interface Formateur {
  id: string;
  nom: string;
  prenom: string;
  email: string;
  specialites?: string[];
  bio?: string;
  photo_url?: string;
  actif: boolean;
}

interface FormateursMultiSelectProps {
  selectedIds: string[];
  onSelect: (formateurId: string) => void;
  onDeselect: (formateurId: string) => void;
  className?: string;
  disabled?: boolean;
}

export function FormateursMultiSelect({
  selectedIds,
  onSelect,
  onDeselect,
  className,
  disabled = false,
}: FormateursMultiSelectProps) {
  const [search, setSearch] = useState("");
  const { data, isLoading, error } = useFormateurs(search || undefined);

  const formateurs = data?.data || [];
  const filteredFormateurs = formateurs.filter((f) => f.actif);

  return (
    <div className={cn("space-y-4", className)}>
      {/* Search input */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
        <Input
          type="text"
          placeholder="Rechercher un formateur..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="pl-10"
        />
      </div>

      {/* Error message */}
      {error && (
        <div className="text-center py-4 text-red-500 text-sm">
          Erreur lors du chargement des formateurs. Veuillez réessayer.
        </div>
      )}

      {/* Formateurs list */}
      {isLoading ? (
        <div className="flex items-center justify-center py-8">
          <Loader2 className="w-6 h-6 animate-spin text-primary" />
        </div>
      ) : error ? (
        <div className="text-center py-8 text-gray-500">
          Impossible de charger les formateurs
        </div>
      ) : filteredFormateurs.length === 0 ? (
        <div className="text-center py-8 text-gray-500">
          {search ? "Aucun formateur trouvé" : "Aucun formateur disponible"}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 max-h-96 overflow-y-auto">
          {filteredFormateurs.map((formateur) => {
            const isSelected = selectedIds.includes(formateur.id);
            return (
              <Card
                key={formateur.id}
                className={cn(
                  "transition-all",
                  disabled ? "opacity-50 cursor-not-allowed" : "cursor-pointer hover:shadow-md",
                  isSelected && "ring-2 ring-primary"
                )}
                onClick={() => {
                  if (disabled) return;
                  if (isSelected) {
                    onDeselect(formateur.id);
                  } else {
                    onSelect(formateur.id);
                  }
                }}
              >
                <CardContent className="p-4">
                  <div className="flex items-start gap-3">
                    <div className="flex-shrink-0">
                      {formateur.photo_url ? (
                        <img
                          src={formateur.photo_url}
                          alt={`${formateur.prenom} ${formateur.nom}`}
                          className="w-12 h-12 rounded-full object-cover"
                        />
                      ) : (
                        <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center">
                          <User className="w-6 h-6 text-primary" />
                        </div>
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between">
                        <h4 className="font-semibold text-sm">
                          {formateur.prenom} {formateur.nom}
                        </h4>
                        {isSelected && (
                          <div className="w-5 h-5 rounded-full bg-primary flex items-center justify-center">
                            <span className="text-white text-xs">✓</span>
                          </div>
                        )}
                      </div>
                      <p className="text-xs text-gray-500 mt-1">{formateur.email}</p>
                      {formateur.specialites && formateur.specialites.length > 0 && (
                        <div className="flex flex-wrap gap-1 mt-2">
                          {formateur.specialites.slice(0, 2).map((spec, idx) => (
                            <span
                              key={idx}
                              className="text-xs px-2 py-0.5 bg-gray-100 rounded-full text-gray-600"
                            >
                              {spec}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}


