"use client";

import { useMemo, useState } from "react";
import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Input,
  Label,
} from "@ecoledigitale/ui";
import { Loader2, Save, X } from "lucide-react";
import { useFilieres, type Filiere } from "@/lib/hooks/use-filieres";

interface FiliereFormProps {
  filiere?: Filiere;
  onSubmit: (data: { name: string; domaine: string | null }) => Promise<void>;
  onCancel: () => void;
  isLoading?: boolean;
}

/**
 * Formulaire d'une filière : nom et domaine. Le cycle et le code appartiennent
 * à la classe, pas à la filière.
 */
export function FiliereForm({
  filiere,
  onSubmit,
  onCancel,
  isLoading = false,
}: FiliereFormProps) {
  const [name, setName] = useState(filiere?.name ?? "");
  const [domaine, setDomaine] = useState(filiere?.domaine ?? "");
  const [error, setError] = useState<string | null>(null);

  const { data: filieres = [] } = useFilieres();

  // Les domaines déjà saisis servent de suggestions ; le champ reste libre.
  const domaines = useMemo(() => {
    const set = new Set<string>();
    filieres.forEach((f) => {
      if (f.domaine) set.add(f.domaine);
    });
    return Array.from(set).sort((a, b) => a.localeCompare(b, "fr"));
  }, [filieres]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    const trimmedName = name.trim();
    if (!trimmedName) {
      setError("Le nom de la filière est requis.");
      return;
    }

    try {
      await onSubmit({ name: trimmedName, domaine: domaine.trim() || null });
    } catch (err: any) {
      setError(err?.message ?? "Erreur lors de l'enregistrement de la filière.");
    }
  }

  return (
    <Card className="shadow-lg max-w-2xl mx-auto">
      <CardHeader>
        <CardTitle>
          {filiere ? "Modifier la filière" : "Informations de la filière"}
        </CardTitle>
        <CardDescription>
          Le domaine d&apos;étude, indépendant du cycle. Les classes qui la
          déclinent se créent depuis le menu Classes.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-5">
          <div className="space-y-1.5">
            <Label htmlFor="filiere-name">Nom de la filière *</Label>
            <Input
              id="filiere-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Ex. : AUDIT ET CONTROLE DE GESTION"
              required
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="filiere-domaine">Domaine (optionnel)</Label>
            <Input
              id="filiere-domaine"
              list="domaines-existants"
              value={domaine}
              onChange={(e) => setDomaine(e.target.value)}
              placeholder="Ex. : Sciences de Gestion des entreprises"
            />
            <datalist id="domaines-existants">
              {domaines.map((d) => (
                <option key={d} value={d} />
              ))}
            </datalist>
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
