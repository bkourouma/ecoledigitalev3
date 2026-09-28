"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
  Button,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@ecoledigitale/ui";
import { ArrowLeft, Loader2 } from "lucide-react";
import {
  useProfessionalUe,
  useUpdateProfessionalUe,
} from "@/lib/hooks/use-professional-catalog-admin";

/**
 * Édition d'une UE — Module Professionnel (feature 030).
 * La filière est figée après création (cohérence prérequis/diplôme).
 */
export default function EditProfessionalUePage() {
  const router = useRouter();
  const params = useParams();
  const id = (params?.id as string) ?? "";

  const ueQuery = useProfessionalUe(id);
  const updateMut = useUpdateProfessionalUe();

  const [code, setCode] = useState("");
  const [libelle, setLibelle] = useState("");
  const [description, setDescription] = useState("");
  const [prix, setPrix] = useState<number>(0);
  const [devise, setDevise] = useState("XOF");
  const [nbUv, setNbUv] = useState<number>(0);
  const [statut, setStatut] = useState<"actif" | "inactif">("actif");
  const [categorie, setCategorie] = useState<string>("");
  const [error, setError] = useState<string | null>(null);

  const ue: any = ueQuery.data;
  useEffect(() => {
    if (ue) {
      setCode(ue.code ?? "");
      setLibelle(ue.libelle ?? "");
      setDescription(ue.description ?? "");
      setPrix(Number(ue.prix ?? 0));
      setDevise(ue.devise ?? "XOF");
      setNbUv(Number(ue.nb_uv ?? 0));
      setStatut((ue.statut as "actif" | "inactif") ?? "actif");
      setCategorie(ue.categorie ?? "");
    }
  }, [ue]);

  const detailUrl = `/professionnel/admin/ue/${id}`;
  const saving = updateMut.isPending;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!code.trim() || !libelle.trim()) {
      setError("Le code et le libellé sont requis.");
      return;
    }
    try {
      await updateMut.mutateAsync({
        id,
        data: {
          code: code.trim(),
          libelle: libelle.trim(),
          description: description || undefined,
          categorie: (categorie || null) as any,
          prix: Number(prix),
          devise: devise || "XOF",
          nb_uv: Number(nbUv),
          statut,
        },
      });
      router.push(detailUrl);
    } catch (err: any) {
      setError(err?.message ?? "Erreur lors de l'enregistrement.");
    }
  }

  return (
    <div className="space-y-8 max-w-7xl mx-auto p-6">
      <div className="mb-6 flex max-w-full flex-col items-start gap-2 overflow-x-auto md:mb-8 md:gap-3">
        <Button variant="outline" size="sm" onClick={() => router.push(detailUrl)}>
          <ArrowLeft className="h-4 w-4 mr-2" />
          Retour
        </Button>
        <div>
          <h1 className="whitespace-nowrap font-bold bg-gradient-to-r from-indigo-600 to-blue-600 bg-clip-text text-transparent text-2xl leading-tight md:text-3xl">
            Modifier l'UE
          </h1>
          <p className="whitespace-nowrap text-muted-foreground text-sm md:text-base">{ue?.libelle}</p>
        </div>
      </div>

      {error && (
        <div className="rounded-md border border-red-300 bg-red-50 px-4 py-2 text-sm text-red-700">
          {error}
        </div>
      )}

      {ueQuery.isLoading ? (
        <Card className="shadow-lg">
          <CardContent className="flex items-center justify-center py-16">
            <Loader2 className="h-8 w-8 animate-spin text-indigo-600" />
          </CardContent>
        </Card>
      ) : (
        <div className="max-w-3xl mx-auto w-full">
          <Card className="shadow-lg">
            <CardHeader>
              <CardTitle>Informations de l'UE</CardTitle>
              <CardDescription>La classe n'est pas modifiable après création.</CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleSubmit} className="space-y-5">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <label className="text-sm font-medium">Code</label>
                    <Input value={code} onChange={(e) => setCode(e.target.value)} />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-sm font-medium">Libellé</label>
                    <Input value={libelle} onChange={(e) => setLibelle(e.target.value)} />
                  </div>
                </div>

                <div className="space-y-1.5">
                  <label className="text-sm font-medium">Description</label>
                  <textarea
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    rows={2}
                    className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                  />
                </div>

                <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
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
                  <div className="space-y-1.5">
                    <label className="text-sm font-medium">Devise</label>
                    <Input value={devise} onChange={(e) => setDevise(e.target.value)} />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-sm font-medium">Nombre d'UV</label>
                    <Input
                      type="number"
                      min={0}
                      value={nbUv}
                      onChange={(e) => setNbUv(Number(e.target.value))}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-sm font-medium">Statut</label>
                    <Select value={statut} onValueChange={(v) => setStatut(v as "actif" | "inactif")}>
                      <SelectTrigger>
                        <SelectValue placeholder="Statut" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="actif">Actif</SelectItem>
                        <SelectItem value="inactif">Inactif</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-sm font-medium">Catégorie (bulletin)</label>
                    <Select
                      value={categorie || "none"}
                      onValueChange={(v) => setCategorie(v === "none" ? "" : v)}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="—" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">— Aucune —</SelectItem>
                        <SelectItem value="fondamentale">Unité Fondamentale</SelectItem>
                        <SelectItem value="specialite">Unité de Spécialité</SelectItem>
                        <SelectItem value="culture_generale">Unité de Culture Générale</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <div className="flex gap-3 pt-2">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => router.push(detailUrl)}
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
                      "Enregistrer"
                    )}
                  </Button>
                </div>
              </form>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
