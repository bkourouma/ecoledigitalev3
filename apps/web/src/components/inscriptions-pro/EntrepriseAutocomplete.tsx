"use client";

import { useState, useEffect, useRef } from "react";
import { Input } from "@ecoledigitale/ui";
import { Search, Building2, Plus } from "lucide-react";
import { useSearchCompanies } from "@/lib/hooks/use-inscriptions-pro";
import { CompanyInfo } from "@ecoledigitale/contracts/src/inscriptions-pro";
import { cn } from "@/lib/utils";
import { Card, CardContent } from "@ecoledigitale/ui";

interface EntrepriseAutocompleteProps {
  value: CompanyInfo | null;
  onChange: (company: CompanyInfo | null) => void;
  onNewCompany: () => void;
  error?: string;
  className?: string;
}

export function EntrepriseAutocomplete({
  value,
  onChange,
  onNewCompany,
  error,
  className,
}: EntrepriseAutocompleteProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const containerRef = useRef<HTMLDivElement>(null);

  // Debounce search query
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedQuery(searchQuery);
    }, 300);

    return () => clearTimeout(timer);
  }, [searchQuery]);

  // Fetch companies when debounced query changes
  const { data, isLoading } = useSearchCompanies(debouncedQuery, {
    enabled: debouncedQuery.length >= 2 && !value,
  });

  // Close suggestions when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setShowSuggestions(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const companies = data?.data?.entreprises || [];

  const handleSelectCompany = (company: CompanyInfo) => {
    onChange(company);
    setSearchQuery(company.raison_sociale);
    setShowSuggestions(false);
  };

  const handleClear = () => {
    onChange(null);
    setSearchQuery("");
    setShowSuggestions(false);
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newQuery = e.target.value;
    setSearchQuery(newQuery);
    if (newQuery.length >= 2) {
      setShowSuggestions(true);
    } else {
      setShowSuggestions(false);
      if (value) {
        onChange(null);
      }
    }
  };

  return (
    <div ref={containerRef} className={cn("relative", className)}>
      <div className="relative">
        <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          type="text"
          placeholder="Rechercher une entreprise par nom ou SIRET..."
          value={value ? value.raison_sociale : searchQuery}
          onChange={handleInputChange}
          onFocus={() => {
            if (searchQuery.length >= 2 || companies.length > 0) {
              setShowSuggestions(true);
            }
          }}
          className={cn("pl-10", error && "border-destructive")}
        />
        {value && (
          <button
            type="button"
            onClick={handleClear}
            className="absolute right-3 top-1/2 transform -translate-y-1/2 text-muted-foreground hover:text-foreground"
          >
            ×
          </button>
        )}
      </div>

      {error && <p className="text-sm text-destructive mt-1">{error}</p>}

      {showSuggestions && (
        <div className="absolute z-50 w-full mt-1 bg-background border rounded-md shadow-lg max-h-60 overflow-auto">
          {isLoading && (
            <div className="p-4 text-center text-sm text-muted-foreground">
              Recherche en cours...
            </div>
          )}

          {!isLoading && companies.length === 0 && debouncedQuery.length >= 2 && (
            <div className="p-4">
              <p className="text-sm text-muted-foreground mb-2">
                Aucune entreprise trouvée pour "{debouncedQuery}"
              </p>
              <button
                type="button"
                onClick={onNewCompany}
                className="w-full flex items-center justify-center gap-2 px-4 py-2 text-sm border rounded-md hover:bg-muted transition-colors"
              >
                <Plus className="h-4 w-4" />
                Créer une nouvelle entreprise
              </button>
            </div>
          )}

          {!isLoading && companies.length > 0 && (
            <>
              {companies.map((company) => (
                <button
                  key={company.id}
                  type="button"
                  onClick={() => handleSelectCompany(company)}
                  className="w-full text-left px-4 py-3 hover:bg-muted transition-colors border-b last:border-b-0"
                >
                  <div className="flex items-start gap-3">
                    <Building2 className="h-5 w-5 text-muted-foreground mt-0.5 flex-shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="font-medium truncate">{company.raison_sociale}</p>
                      {company.siret && (
                        <p className="text-sm text-muted-foreground">SIRET: {company.siret}</p>
                      )}
                      {company.ville && (
                        <p className="text-sm text-muted-foreground">{company.ville}</p>
                      )}
                    </div>
                  </div>
                </button>
              ))}
              <div className="border-t p-2">
                <button
                  type="button"
                  onClick={onNewCompany}
                  className="w-full flex items-center justify-center gap-2 px-4 py-2 text-sm border rounded-md hover:bg-muted transition-colors"
                >
                  <Plus className="h-4 w-4" />
                  Créer une nouvelle entreprise
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

