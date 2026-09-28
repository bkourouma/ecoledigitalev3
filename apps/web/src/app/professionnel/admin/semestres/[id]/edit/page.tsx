"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Button,
  Input,
} from "@ecoledigitale/ui";
import { ArrowLeft, Loader2, AlertCircle } from "lucide-react";
import {
  useProfessionalSemestre,
  useEligibleUeForSemestre,
  useUpdateProfessionalSemestre,
} from "@/lib/hooks/use-professional-semestres";

/**
 * Édition d'un semestre — Module Professionnel.
 * Modifie le libellé et l'ensemble des UE composant le semestre (filière figée).
 */

const LIST_URL = "/professionnel/admin/semestres";

export default function EditProfessionalSemestrePage() {
  const router = useRouter();
  const params = useParams();
  const id = String(params?.id ?? "");

  const semestreQuery = useProfessionalSemestre(id || null);
  const detail: any = semestreQuery.data ?? null;
  const ueQuery = useEligibleUeForSemestre(detail?.filiere_id ?? null);
  const updateMut = useUpdateProfessionalSemestre();

  const [libelle, setLibelle] = useState<string>("");
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [error, setError] = useState<string | null>(null);
  const initialized = useRef(false);

  // Initialise le formulaire une fois le semestre chargé.
  useEffect(() => {
    if (detail && !initialized.current) {
      initialized.current = true;
      setLibelle(detail.libelle ?? "");
      const init: Record<string, boolean> = {};
      for (const u of detail.ues ?? []) init[u.id] = true;
      setSelected(init);
    }
  }, [detail]);

  // UE de la filière + UE déjà rattachées (dédupliquées par id).
  const ues: any[] = useMemo(() => {
    const eligible: any[] = (ueQuery.data as any[]) ?? [];
    const attached: any[] = detail?.ues ?? [];
    const byId = new Map<string, any>();
    for (const u of eligible) byId.set(u.id, u);
    for (const u of attached) if (!byId.has(u.id)) byId.set(u.id, u);
    return Array.from(byId.values()).sort((a, b) => String(a.code).localeCompare(String(b.code)));
  }, [ueQuery.data, detail]);

  const selectedIds = useMemo(
    () => Object.entries(selected).filter(([, v]) => v).map(([uid]) => uid),
    [selected]
  );
  const allChecked = ues.length > 0 && selectedIds.length === ues.length;
  const totalUv = ues.filter((u) => selected[u.id]).reduce((a, u) => a + (u.nb_uv ?? 0), 0);

  function toggle(uid: string) {
    setSelected((prev) => ({ ...prev, [uid]: !prev[uid] }));
  }

  function toggleAll() {
    if (allChecked) {
      setSelected({});
    } else {
      const all: Record<string, boolean> = {};
      for (const u of ues) all[u.id] = true;
      setSelected(all);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!libelle.trim()) return setError("Le libellé est requis.");
    if (selectedIds.length === 0) return setError("Sélectionnez au moins une UE.");

    try {
      await updateMut.mutateAsync({
        id,
        data: { libelle: libelle.trim(), ue_ids: selectedIds },
      });
      router.push(LIST_URL);
    } catch (err: any) {
      setError(err?.message ?? "Erreur lors de la mise à jour du semestre.");
    }
  }

  const saving = updateMut.isPending;

  if (semestreQuery.isLoading) {
    return (
      <div className="max-w-4xl mx-auto p-6">
        <div className="flex items-center gap-2 text-muted-foreground py-16 justify-center">
          <Loader2 className="h-5 w-5 animate-spin" /> Chargement du semestre…
        </div>
      </div>
    );
  }

  if (semestreQuery.isError || !detail) {
    return (
      <div className="max-w-4xl mx-auto p-6 space-y-4">
        <Button variant="outline" size="sm" onClick={() => router.push(LIST_URL)}>
          <ArrowLeft className="h-4 w-4 mr-2" />
          Retour
        </Button>
        <div className="flex items-center gap-2 text-red-600">
          <AlertCircle className="h-5 w-5" />
          {(semestreQuery.error as Error)?.message ?? "Semestre introuvable."}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-8 max-w-7xl mx-auto p-6">
      {/* Header */}
      <div className="mb-6 flex max-w-full flex-col items-start gap-2 overflow-x-auto md:mb-8 md:gap-3">
        <Button variant="outline" size="sm" onClick={() => router.push(LIST_URL)}>
          <ArrowLeft className="h-4 w-4 mr-2" />
          Retour
        </Button>
        <div>
          <h1 className="whitespace-nowrap font-bold bg-gradient-to-r from-indigo-600 to-purple-600 bg-clip-text text-transparent text-2xl leading-tight md:text-3xl">
            Modifier le semestre
          </h1>
          <p className="whitespace-nowrap text-muted-foreground text-sm md:text-base">
            Classe : <span className="font-medium">{detail.filiere_nom ?? "—"}</span> (non
            modifiable)
          </p>
        </div>
      </div>

      {error && (
        <div className="rounded-md border border-red-300 bg-red-50 px-4 py-2 text-sm text-red-700">
          {error}
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-6 max-w-4xl mx-auto w-full">
        <Card className="shadow-lg">
          <CardHeader>
            <CardTitle>Informations du semestre</CardTitle>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="space-y-1.5 md:max-w-sm">
              <label className="text-sm font-medium">Libellé</label>
              <Input
                value={libelle}
                onChange={(e) => setLibelle(e.target.value)}
                placeholder="Ex. : Semestre 1"
              />
            </div>
          </CardContent>
        </Card>

        <Card className="shadow-lg">
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle>UE du semestre</CardTitle>
              {ues.length > 0 && (
                <span className="text-sm text-muted-foreground">
                  {selectedIds.length} / {ues.length} UE · {totalUv} crédit
                  {totalUv > 1 ? "s" : ""}
                </span>
              )}
            </div>
          </CardHeader>
          <CardContent>
            {ueQuery.isLoading ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground py-4">
                <Loader2 className="h-4 w-4 animate-spin" /> Chargement des UE…
              </div>
            ) : ues.length === 0 ? (
              <p className="text-sm text-muted-foreground py-4">
                Aucune UE disponible pour cette classe.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="text-left text-xs uppercase text-muted-foreground border-b">
                    <tr>
                      <th className="py-2 pr-3 w-10">
                        <input
                          type="checkbox"
                          className="h-4 w-4 accent-indigo-600 cursor-pointer"
                          checked={allChecked}
                          onChange={toggleAll}
                          aria-label="Tout sélectionner"
                        />
                      </th>
                      <th className="py-2 pr-3">Code</th>
                      <th className="py-2 pr-3">UE</th>
                      <th className="py-2 pr-3">Crédits</th>
                    </tr>
                  </thead>
                  <tbody>
                    {ues.map((u) => (
                      <tr
                        key={u.id}
                        className="border-b last:border-0 hover:bg-muted/50 cursor-pointer"
                        onClick={() => toggle(u.id)}
                      >
                        <td className="py-2 pr-3">
                          <input
                            type="checkbox"
                            className="h-4 w-4 accent-indigo-600 cursor-pointer"
                            checked={!!selected[u.id]}
                            onChange={() => toggle(u.id)}
                            onClick={(e) => e.stopPropagation()}
                            aria-label={`Sélectionner ${u.libelle}`}
                          />
                        </td>
                        <td className="py-2 pr-3 font-mono text-xs">{u.code}</td>
                        <td className="py-2 pr-3 font-medium">{u.libelle}</td>
                        <td className="py-2 pr-3">{u.nb_uv ?? 0}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
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
              "Enregistrer"
            )}
          </Button>
        </div>
      </form>
    </div>
  );
}
