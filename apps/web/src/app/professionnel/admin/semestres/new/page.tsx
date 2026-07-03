"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Button,
  Input,
} from "@ecoledigitale/ui";
import { ArrowLeft, Loader2, Layers, AlertCircle, Plus, Trash2 } from "lucide-react";
import { SearchableSelect } from "@/components/SearchableSelect";
import { useProgrammes } from "@/lib/hooks/use-programmes";
import {
  useEligibleUeForSemestre,
  useCreateProfessionalSemestresBatch,
} from "@/lib/hooks/use-professional-semestres";

/**
 * Création de semestres — Module Professionnel.
 * Flux : choisir une filière → la liste de ses UE s'affiche → pour chaque
 * semestre on saisit un libellé et on coche les UE à y rattacher. On peut
 * créer plusieurs semestres d'un coup (une filière a 3 semestres par défaut).
 */

const LIST_URL = "/professionnel/admin/semestres";

interface SemestreBlock {
  libelle: string;
  selected: Record<string, boolean>;
}

const newBlock = (n: number): SemestreBlock => ({
  libelle: `Semestre ${n}`,
  selected: {},
});

export default function NewProfessionalSemestrePage() {
  const router = useRouter();
  const [filiereId, setFiliereId] = useState<string>("");
  const [blocks, setBlocks] = useState<SemestreBlock[]>([newBlock(1)]);
  const [error, setError] = useState<string | null>(null);

  const programmesQuery = useProgrammes();
  const ueQuery = useEligibleUeForSemestre(filiereId || null);
  const createMut = useCreateProfessionalSemestresBatch();

  const filieres: any[] = programmesQuery.data?.data ?? [];
  const ues: any[] = (ueQuery.data as any[]) ?? [];

  function selectFiliere(id: string) {
    setFiliereId(id);
    setBlocks([newBlock(1)]); // changer de filière réinitialise les sélections
  }

  function updateBlock(index: number, patch: Partial<SemestreBlock>) {
    setBlocks((prev) => prev.map((b, i) => (i === index ? { ...b, ...patch } : b)));
  }

  function toggleUe(index: number, ueId: string) {
    setBlocks((prev) =>
      prev.map((b, i) =>
        i === index ? { ...b, selected: { ...b.selected, [ueId]: !b.selected[ueId] } } : b
      )
    );
  }

  function toggleAll(index: number) {
    setBlocks((prev) =>
      prev.map((b, i) => {
        if (i !== index) return b;
        const all = ues.length > 0 && ues.every((u) => b.selected[u.id]);
        const next: Record<string, boolean> = {};
        if (!all) for (const u of ues) next[u.id] = true;
        return { ...b, selected: next };
      })
    );
  }

  function addBlock() {
    setBlocks((prev) => [...prev, newBlock(prev.length + 1)]);
  }

  function removeBlock(index: number) {
    setBlocks((prev) => (prev.length <= 1 ? prev : prev.filter((_, i) => i !== index)));
  }

  const selectedIdsOf = (b: SemestreBlock) =>
    Object.entries(b.selected).filter(([, v]) => v).map(([id]) => id);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!filiereId) return setError("Veuillez sélectionner une filière.");

    const payloadSemestres = blocks
      .map((b) => ({ libelle: b.libelle.trim(), ue_ids: selectedIdsOf(b) }))
      .filter((s) => s.libelle.length > 0 && s.ue_ids.length > 0);

    if (payloadSemestres.length === 0) {
      return setError(
        "Chaque semestre doit avoir un libellé et au moins une UE sélectionnée."
      );
    }
    if (payloadSemestres.length < blocks.length) {
      return setError(
        "Un ou plusieurs semestres sont incomplets (libellé ou UE manquant). Complétez-les ou retirez-les."
      );
    }
    // Doublons de libellé dans le lot.
    const labels = payloadSemestres.map((s) => s.libelle.toLowerCase());
    if (new Set(labels).size !== labels.length) {
      return setError("Deux semestres portent le même libellé.");
    }

    try {
      await createMut.mutateAsync({ filiere_id: filiereId, semestres: payloadSemestres });
      router.push(LIST_URL);
    } catch (err: any) {
      setError(err?.message ?? "Erreur lors de la création des semestres.");
    }
  }

  const saving = createMut.isPending;

  return (
    <div className="space-y-8 max-w-7xl mx-auto p-6">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Button variant="outline" size="sm" onClick={() => router.push(LIST_URL)}>
          <ArrowLeft className="h-4 w-4 mr-2" />
          Retour
        </Button>
        <div>
          <h1 className="text-3xl font-bold bg-gradient-to-r from-indigo-600 to-purple-600 bg-clip-text text-transparent">
            Nouveaux semestres
          </h1>
          <p className="text-muted-foreground mt-2">
            Choisissez une filière, puis composez chaque semestre avec ses UE. Vous pouvez en
            créer plusieurs à la fois.
          </p>
        </div>
      </div>

      {error && (
        <div className="rounded-md border border-red-300 bg-red-50 px-4 py-2 text-sm text-red-700">
          {error}
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-6 max-w-4xl mx-auto w-full">
        {/* Filière */}
        <Card className="shadow-lg">
          <CardHeader>
            <CardTitle>Filière</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Filière</label>
              <SearchableSelect
                value={filiereId}
                onChange={selectFiliere}
                icon={<Layers className="h-4 w-4 text-gray-400" />}
                placeholder={
                  programmesQuery.isLoading ? "Chargement…" : "Sélectionner une filière"
                }
                options={filieres.map((f) => ({
                  value: f.id,
                  label: `${f.name}${f.code ? ` (${f.code})` : ""}`,
                }))}
              />
            </div>
          </CardContent>
        </Card>

        {/* UE de la filière + blocs semestres */}
        {filiereId && (
          <>
            {ueQuery.isLoading ? (
              <Card className="shadow-lg">
                <CardContent className="flex items-center gap-2 text-sm text-muted-foreground py-6">
                  <Loader2 className="h-4 w-4 animate-spin" /> Chargement des UE…
                </CardContent>
              </Card>
            ) : ueQuery.isError ? (
              <Card className="shadow-lg">
                <CardContent className="flex items-center gap-2 text-sm text-red-600 py-6">
                  <AlertCircle className="h-4 w-4" />
                  {(ueQuery.error as Error)?.message ?? "Impossible de charger les UE."}
                </CardContent>
              </Card>
            ) : ues.length === 0 ? (
              <Card className="shadow-lg">
                <CardContent className="text-sm text-muted-foreground py-6">
                  Aucune UE pour cette filière. Créez d'abord des UE (menu UE) avant de composer
                  un semestre.
                </CardContent>
              </Card>
            ) : (
              blocks.map((block, index) => {
                const selectedIds = selectedIdsOf(block);
                const allChecked = ues.length > 0 && selectedIds.length === ues.length;
                const totalUv = ues
                  .filter((u) => block.selected[u.id])
                  .reduce((a, u) => a + (u.nb_uv ?? 0), 0);
                return (
                  <Card key={index} className="shadow-lg">
                    <CardHeader>
                      <div className="flex items-center justify-between gap-3">
                        <CardTitle className="text-base">Semestre {index + 1}</CardTitle>
                        <div className="flex items-center gap-3">
                          <span className="text-sm text-muted-foreground">
                            {selectedIds.length} UE · {totalUv} crédit{totalUv > 1 ? "s" : ""}
                          </span>
                          {blocks.length > 1 && (
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              onClick={() => removeBlock(index)}
                              disabled={saving}
                            >
                              <Trash2 className="h-4 w-4 mr-1" /> Retirer
                            </Button>
                          )}
                        </div>
                      </div>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      <div className="space-y-1.5 md:max-w-sm">
                        <label className="text-sm font-medium">Libellé</label>
                        <Input
                          value={block.libelle}
                          onChange={(e) => updateBlock(index, { libelle: e.target.value })}
                          placeholder="Ex. : Semestre 1"
                        />
                      </div>

                      <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                          <thead className="text-left text-xs uppercase text-muted-foreground border-b">
                            <tr>
                              <th className="py-2 pr-3 w-10">
                                <input
                                  type="checkbox"
                                  className="h-4 w-4 accent-indigo-600 cursor-pointer"
                                  checked={allChecked}
                                  onChange={() => toggleAll(index)}
                                  aria-label="Tout sélectionner"
                                />
                              </th>
                              <th className="py-2 pr-3">Code</th>
                              <th className="py-2 pr-3">UE</th>
                              <th className="py-2 pr-3">Crédits</th>
                              <th className="py-2 pr-3">ECUE</th>
                            </tr>
                          </thead>
                          <tbody>
                            {ues.map((u) => (
                              <tr
                                key={u.id}
                                className="border-b last:border-0 hover:bg-muted/50 cursor-pointer"
                                onClick={() => toggleUe(index, u.id)}
                              >
                                <td className="py-2 pr-3">
                                  <input
                                    type="checkbox"
                                    className="h-4 w-4 accent-indigo-600 cursor-pointer"
                                    checked={!!block.selected[u.id]}
                                    onChange={() => toggleUe(index, u.id)}
                                    onClick={(e) => e.stopPropagation()}
                                    aria-label={`Sélectionner ${u.libelle}`}
                                  />
                                </td>
                                <td className="py-2 pr-3 font-mono text-xs">{u.code}</td>
                                <td className="py-2 pr-3 font-medium">{u.libelle}</td>
                                <td className="py-2 pr-3">{u.nb_uv ?? 0}</td>
                                <td className="py-2 pr-3">{u.nb_ecue ?? 0}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </CardContent>
                  </Card>
                );
              })
            )}

            {ues.length > 0 && (
              <div>
                <Button type="button" variant="outline" onClick={addBlock} disabled={saving}>
                  <Plus className="h-4 w-4 mr-2" /> Ajouter un semestre
                </Button>
              </div>
            )}
          </>
        )}

        <div className="flex gap-3">
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
            ) : blocks.length > 1 ? (
              `Créer les ${blocks.length} semestres`
            ) : (
              "Créer le semestre"
            )}
          </Button>
        </div>
      </form>
    </div>
  );
}
