"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
  Button,
  Input,
} from "@ecoledigitale/ui";
import { ArrowLeft, Loader2 } from "lucide-react";
import { useProgrammes } from "@/lib/hooks/use-programmes";
import { SearchableSelect } from "@/components/SearchableSelect";
import { useCreateProfessionalUe } from "@/lib/hooks/use-professional-catalog-admin";

/**
 * Création d'une UE — Module Professionnel (feature 030).
 * L'UE est rattachée à une Filière et porte prix / UV. La composition en ECUE
 * se fait depuis l'ECUE (choix de la/des UE) ou depuis le détail de l'UE.
 */

const LIST_URL = "/professionnel/admin/ue";

export default function NewProfessionalUePage() {
  const router = useRouter();
  const [filiereId, setFiliereId] = useState("");
  const [code, setCode] = useState("");
  const [libelle, setLibelle] = useState("");
  const [prix, setPrix] = useState<number>(0);
  const [error, setError] = useState<string | null>(null);

  const programmesQuery = useProgrammes();
  const createMut = useCreateProfessionalUe();
  const filieres: any[] = programmesQuery.data?.data ?? [];
  const saving = createMut.isPending;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!filiereId) {
      setError("Veuillez sélectionner une classe.");
      return;
    }
    if (!code.trim() || !libelle.trim()) {
      setError("Le code et le libellé sont requis.");
      return;
    }
    try {
      const ue: any = await createMut.mutateAsync({
        filiere_id: filiereId,
        code: code.trim(),
        libelle: libelle.trim(),
        prix: Number(prix),
        // UV non saisies dans le formulaire → valeur par défaut.
        nb_uv: 0,
      });
      router.push(`${LIST_URL}/${ue.id}`);
    } catch (err: any) {
      setError(err?.message ?? "Erreur lors de la création.");
    }
  }

  return (
    <div className="space-y-8 max-w-7xl mx-auto p-6">
      <div className="mb-6 flex max-w-full flex-col items-start gap-2 overflow-x-auto md:mb-8 md:gap-3">
        <Button variant="outline" size="sm" onClick={() => router.push(LIST_URL)}>
          <ArrowLeft className="h-4 w-4 mr-2" />
          Retour
        </Button>
        <div>
          <h1 className="whitespace-nowrap font-bold bg-gradient-to-r from-indigo-600 to-blue-600 bg-clip-text text-transparent text-2xl leading-tight md:text-3xl">
            Nouvelle UE
          </h1>
          <p className="whitespace-nowrap text-muted-foreground text-sm md:text-base">
            Rattachez l'UE à une classe et définissez son prix.
          </p>
        </div>
      </div>

      {error && (
        <div className="rounded-md border border-red-300 bg-red-50 px-4 py-2 text-sm text-red-700">
          {error}
        </div>
      )}

      <div className="max-w-3xl mx-auto w-full">
        <Card className="shadow-lg">
          <CardHeader>
            <CardTitle>Informations de l'UE</CardTitle>
            <CardDescription>
              La composition en ECUE se gère depuis l'ECUE (choix de l'UE) ou depuis le détail de l'UE.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-5">
              <div className="space-y-1.5">
                <label className="text-sm font-medium">Classe</label>
                <SearchableSelect
                  value={filiereId}
                  onChange={setFiliereId}
                  placeholder={programmesQuery.isLoading ? "Chargement…" : "Sélectionner une classe"}
                  searchPlaceholder="Rechercher une classe…"
                  options={filieres.map((p) => ({
                    value: p.id,
                    label: `${p.name}${p.code ? ` (${p.code})` : ""}`,
                  }))}
                />
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="text-sm font-medium">Code</label>
                  <Input
                    value={code}
                    onChange={(e) => setCode(e.target.value)}
                    placeholder="Ex. : UE-COMPTA-1"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-sm font-medium">Libellé</label>
                  <Input
                    value={libelle}
                    onChange={(e) => setLibelle(e.target.value)}
                    placeholder="Ex. : Comptabilité et gestion"
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="text-sm font-medium">Prix</label>
                <Input
                  type="number"
                  min={0}
                  step="0.01"
                  value={prix}
                  onChange={(e) => setPrix(Number(e.target.value))}
                />
              </div>

              <div className="flex gap-3 pt-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => router.push(LIST_URL)}
                  disabled={saving}
                >
                  Annuler
                </Button>
                <Button type="submit" disabled={saving}>
                  {saving ? (
                    <span className="flex items-center">
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      Enregistrement…
                    </span>
                  ) : (
                    "Créer l'UE"
                  )}
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
