"use client";

import { useState } from "react";
import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Input,
  Label,
} from "@ecoledigitale/ui";
import { SearchableSelect } from "@/components/SearchableSelect";
import { Loader2, Save, X } from "lucide-react";
import { useFilieres } from "@/lib/hooks/use-filieres";
import { useCycles } from "@/lib/hooks/use-cycles";
import type { Programme } from "@/lib/hooks/use-programmes";

export interface ClasseFormValues {
  filiereId: string;
  name: string;
  code: string;
  cycleId: string;
}

interface ClasseFormProps {
  classe?: Programme;
  /** Filière pré-sélectionnée à la création (arrivée depuis une filière). */
  defaultFiliereId?: string;
  onSubmit: (data: ClasseFormValues) => Promise<void>;
  onCancel: () => void;
  isLoading?: boolean;
}

/**
 * Formulaire d'une classe : la filière qu'elle décline, son nom, son code et
 * son cycle.
 */
export function ClasseForm({
  classe,
  defaultFiliereId,
  onSubmit,
  onCancel,
  isLoading = false,
}: ClasseFormProps) {
  const [filiereId, setFiliereId] = useState(classe?.filiereId ?? defaultFiliereId ?? "");
  const [name, setName] = useState(classe?.name ?? "");
  const [code, setCode] = useState(classe?.code ?? "");
  const [cycleId, setCycleId] = useState(classe?.cycleId ?? "");
  const [error, setError] = useState<string | null>(null);

  const { data: filieres = [] } = useFilieres();
  const { data: cyclesData } = useCycles();
  const cycles = cyclesData?.data || [];

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    const trimmedName = name.trim();
    const trimmedCode = code.trim();

    if (!filiereId) {
      setError("La filière est requise.");
      return;
    }
    if (!trimmedName) {
      setError("Le nom de la classe est requis.");
      return;
    }
    if (!trimmedCode) {
      setError("Le code est requis.");
      return;
    }
    if (!cycleId) {
      setError("Le cycle est requis.");
      return;
    }

    try {
      await onSubmit({ filiereId, name: trimmedName, code: trimmedCode, cycleId });
    } catch (err: any) {
      setError(err?.message ?? "Erreur lors de l'enregistrement de la classe.");
    }
  }

  return (
    <Card className="shadow-lg max-w-2xl mx-auto">
      <CardHeader>
        <CardTitle>
          {classe ? "Modifier la classe" : "Informations de la classe"}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-5">
          <div className="space-y-1.5">
            <Label>Cycle *</Label>
            <SearchableSelect
              value={cycleId}
              onChange={setCycleId}
              placeholder="Sélectionner un cycle"
              searchPlaceholder="Rechercher un cycle…"
              options={cycles.map((cycle) => ({ value: cycle.id, label: cycle.name }))}
            />
          </div>

          <div className="space-y-1.5">
            <Label>Filière *</Label>
            <SearchableSelect
              value={filiereId}
              onChange={setFiliereId}
              placeholder="Sélectionner une filière"
              searchPlaceholder="Rechercher une filière…"
              options={filieres.map((f) => ({ value: f.id, label: f.name }))}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="classe-name">Nom de la classe *</Label>
            <Input
              id="classe-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Ex. : MASTER 2 AUDIT ET CONTROLE DE GESTION"
              required
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="classe-code">Code *</Label>
            <Input
              id="classe-code"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="Ex. : M2ACG"
              maxLength={20}
              required
            />
          </div>

          {error && (
            <p className="text-sm text-red-600 whitespace-pre-line">{error}</p>
          )}

          <div className="flex justify-end gap-3 pt-2">
            <Button type="button" variant="outline" onClick={onCancel} disabled={isLoading}>
              <X className="h-4 w-4 mr-2" />
              Annuler
            </Button>
            <Button type="submit" disabled={isLoading}>
              {isLoading ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Save className="h-4 w-4 mr-2" />
              )}
              Enregistrer
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
