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
import { ArrowLeft, Plus, Trash2, Loader2, Layers } from "lucide-react";
import { SearchableSelect } from "@/components/SearchableSelect";
import {
  useCreateProfessionalEcue,
  useProfessionalUeList,
  useAddEcueToUe,
} from "@/lib/hooks/use-professional-catalog-admin";
import { useNotesFilieres } from "@/lib/hooks/use-professional-bulletins";

/**
 * Création d'ECUE — Module Professionnel (feature 030).
 * L'ECUE est pédagogique (pas de prix/UV/filière). On peut, dans le même écran,
 * la rattacher à une UE (mutualisation). Création en lot possible.
 */

interface EcueRow {
  code: string;
  libelle: string;
  credits: string;
}

const EMPTY_ROW: EcueRow = { code: "", libelle: "", credits: "" };

const LIST_URL = "/professionnel/admin/matieres";

export default function NewProfessionalEcuePage() {
  const router = useRouter();
  const [rows, setRows] = useState<EcueRow[]>([{ ...EMPTY_ROW }]);
  const [filiereId, setFiliereId] = useState<string>("");
  const [selectedUeId, setSelectedUeId] = useState<string>("");
  const [error, setError] = useState<string | null>(null);

  const filieresQuery = useNotesFilieres();
  const ueListQuery = useProfessionalUeList({
    pageSize: 1000,
    filiere_id: filiereId || undefined,
  } as any);
  const createMut = useCreateProfessionalEcue();
  const addEcueMut = useAddEcueToUe();

  const filieres: any[] = (filieresQuery.data as any[]) ?? [];
  const ues: any[] = ueListQuery.data?.items ?? [];
  const saving = createMut.isPending || addEcueMut.isPending;

  function updateRow(index: number, patch: Partial<EcueRow>) {
    setRows((prev) => prev.map((r, i) => (i === index ? { ...r, ...patch } : r)));
  }
  function addRow() {
    setRows((prev) => [...prev, { ...EMPTY_ROW }]);
  }
  function removeRow(index: number) {
    setRows((prev) => (prev.length <= 1 ? prev : prev.filter((_, i) => i !== index)));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const valid = rows.filter((r) => r.code.trim() && r.libelle.trim());
    if (valid.length === 0) {
      setError("Ajoutez au moins une ECUE (code et libellé requis).");
      return;
    }
    const failed: string[] = [];
    for (const r of valid) {
      let ecueId: string;
      try {
        const ecue: any = await createMut.mutateAsync({
          code: r.code.trim(),
          libelle: r.libelle.trim(),
          credits: r.credits.trim() === "" ? null : Number(r.credits),
        });
        ecueId = ecue.id;
      } catch (err: any) {
        failed.push(`${r.code.trim()} — ${err?.message ?? "erreur"}`);
        continue;
      }
      // Rattachement à l'UE sélectionnée (le cas échéant).
      if (selectedUeId) {
        try {
          await addEcueMut.mutateAsync({
            ueId: selectedUeId,
            data: { ecue_id: ecueId, est_obligatoire: true, coefficient: 1, ordre: 0 },
          });
        } catch (err: any) {
          failed.push(`${r.code.trim()} → UE — ${err?.message ?? "erreur"}`);
        }
      }
    }
    if (failed.length > 0) {
      setError(`${failed.length} opération(s) en échec : ${failed.join(" ; ")}`);
    } else {
      router.push(LIST_URL);
    }
  }

  return (
    <div className="space-y-8 max-w-7xl mx-auto p-6">
      <div className="flex items-center gap-4">
        <Button variant="outline" size="sm" onClick={() => router.push(LIST_URL)}>
          <ArrowLeft className="h-4 w-4 mr-2" />
          Retour
        </Button>
        <div>
          <h1 className="text-3xl font-bold bg-gradient-to-r from-green-600 to-blue-600 bg-clip-text text-transparent">
            Nouvelles ECUE
          </h1>
          <p className="text-muted-foreground mt-2">
            Créez une ou plusieurs ECUE et rattachez-les directement à une ou plusieurs UE.
          </p>
        </div>
      </div>

      {error && (
        <div className="rounded-md border border-red-300 bg-red-50 px-4 py-2 text-sm text-red-700">
          {error}
        </div>
      )}

      <div className="max-w-4xl mx-auto w-full">
        <form onSubmit={handleSubmit} className="space-y-6">
          {/* UE de rattachement (choix unique) */}
          <Card className="shadow-lg">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Layers className="h-5 w-5 text-indigo-600" /> UE de rattachement (optionnel)
              </CardTitle>
              <CardDescription>
                Choisissez d'abord une classe pour filtrer les UE, puis l'UE à laquelle rattacher
                ces ECUE (UV 1, « obligatoire » par défaut — ajustables depuis le détail de l'UE).
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="text-sm font-medium">Classe</label>
                  <SearchableSelect
                    value={filiereId}
                    onChange={(v) => {
                      setFiliereId(v);
                      setSelectedUeId("");
                    }}
                    icon={<Layers className="h-4 w-4 text-gray-400" />}
                    placeholder={filieresQuery.isLoading ? "Chargement…" : "Toutes les classes"}
                    searchPlaceholder="Rechercher une classe…"
                    options={[
                      { value: "", label: "Toutes les classes" },
                      ...filieres.map((f) => ({
                        value: f.id,
                        label: `${f.name}${f.code ? ` (${f.code})` : ""}`,
                      })),
                    ]}
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-sm font-medium">UE</label>
                  {ueListQuery.isLoading ? (
                    <div className="flex h-10 items-center gap-2 text-sm text-muted-foreground">
                      <Loader2 className="h-4 w-4 animate-spin" /> Chargement des UE…
                    </div>
                  ) : (
                    <SearchableSelect
                      value={selectedUeId}
                      onChange={setSelectedUeId}
                      icon={<Layers className="h-4 w-4 text-gray-400" />}
                      placeholder={
                        ues.length === 0 ? "Aucune UE pour cette classe" : "Choisir une UE"
                      }
                      searchPlaceholder="Rechercher une UE…"
                      options={[
                        { value: "", label: "— Aucune (rattacher plus tard) —" },
                        ...ues.map((u) => ({
                          value: u.id,
                          label: `${u.code} — ${u.libelle}`,
                        })),
                      ]}
                    />
                  )}
                </div>
              </div>
              {!ueListQuery.isLoading && filiereId && ues.length === 0 && (
                <p className="text-sm text-muted-foreground">
                  Aucune UE pour cette classe. Vous pourrez rattacher ces ECUE plus tard.
                </p>
              )}
            </CardContent>
          </Card>

          {/* ECUE */}
          <Card className="shadow-lg">
            <CardHeader>
              <CardTitle>Informations des ECUE</CardTitle>
              <CardDescription>
                Le prix et les UV ne sont pas définis ici : ils sont portés par l'UE.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {rows.map((row, index) => (
                  <div key={index} className="rounded-lg border p-4 space-y-4">
                    <div className="flex items-center justify-between">
                      <h4 className="text-sm font-semibold">ECUE {index + 1}</h4>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => removeRow(index)}
                        disabled={rows.length === 1 || saving}
                      >
                        <Trash2 className="h-4 w-4 mr-2" />
                        Retirer
                      </Button>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                      <div className="space-y-1.5">
                        <label className="text-sm font-medium">Code</label>
                        <Input
                          value={row.code}
                          onChange={(e) => updateRow(index, { code: e.target.value })}
                          placeholder="Ex. : ECUE-COMPTA-1"
                        />
                      </div>
                      <div className="space-y-1.5">
                        <label className="text-sm font-medium">Libellé</label>
                        <Input
                          value={row.libelle}
                          onChange={(e) => updateRow(index, { libelle: e.target.value })}
                          placeholder="Ex. : Comptabilité générale"
                        />
                      </div>
                      <div className="space-y-1.5">
                        <label className="text-sm font-medium">Crédits</label>
                        <Input
                          type="number"
                          min={0}
                          step={1}
                          value={row.credits}
                          onChange={(e) => updateRow(index, { credits: e.target.value })}
                          placeholder="Ex. : 4"
                        />
                      </div>
                    </div>
                  </div>
                ))}
                <div className="flex justify-end">
                  <Button type="button" variant="outline" onClick={addRow} disabled={saving}>
                    <Plus className="h-4 w-4 mr-2" />
                    Ajouter une ECUE
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>

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
              ) : (
                `Créer ${rows.length > 1 ? `les ${rows.length} ECUE` : "l'ECUE"}`
              )}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
