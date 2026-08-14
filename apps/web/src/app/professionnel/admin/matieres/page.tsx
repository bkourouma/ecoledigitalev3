"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent, Button } from "@ecoledigitale/ui";
import {
  Plus,
  Loader2,
  AlertCircle,
  Edit,
  Eye,
  Trash2,
  BookOpen,
  Layers,
  X,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import { SearchableSelect } from "@/components/SearchableSelect";
import { useBilanTypes } from "@/lib/hooks/use-bilan-types";
import {
  useAllProfessionalEcueList,
  useProfessionalUeList,
  useDeleteProfessionalEcue,
} from "@/lib/hooks/use-professional-catalog-admin";
import { useNotesFilieres } from "@/lib/hooks/use-professional-bulletins";

const PAGE_SIZE = 20;

/**
 * ECUE de « conduite » (ex. « Conduite (S1) », code « EC-CON… ») : note de
 * semestre transversale. Elle reste en base et alimente les moyennes et
 * bulletins, mais n'est pas gérée depuis cet écran — même règle que l'API
 * (`libelle ILIKE 'conduite%' OR code ILIKE '%EC-CON%'`).
 */
function isConduiteEcue(e: any): boolean {
  const libelle = String(e?.libelle ?? "").trim().toLowerCase();
  const code = String(e?.code ?? "").toUpperCase();
  return libelle.startsWith("conduite") || code.includes("EC-CON");
}

/** UE de « conduite » : transversale, masquée de l'administration du catalogue. */
function isConduiteUe(u: any): boolean {
  return String(u?.libelle ?? "").trim().toLowerCase().startsWith("conduite");
}

/**
 * Liste des ECUE (Éléments Constitutifs d'UE) — Module Professionnel (feature 030).
 *
 * L'ECUE est le pôle PÉDAGOGIQUE : code, libellé, type de bilan, statut. Elle ne
 * porte NI prix NI UV (portés par l'UE) et n'est pas rattachée directement à une
 * filière (mutualisation via la composition UE↔ECUE).
 */
export default function ProfessionalEcueListPage() {
  const router = useRouter();
  const [filiereFilter, setFiliereFilter] = useState<string>("all");
  const [ueFilter, setUeFilter] = useState<string>("all");
  const [page, setPage] = useState(1);
  const [error, setError] = useState<string | null>(null);

  const bilanTypesQuery = useBilanTypes({ limit: 100 });
  const filieresQuery = useNotesFilieres();
  const ecueQuery = useAllProfessionalEcueList();
  const ueListQuery = useProfessionalUeList({ pageSize: 1000 } as any);
  const deleteMut = useDeleteProfessionalEcue();

  const bilanTypes: any[] = bilanTypesQuery.data?.data ?? [];
  const filieres: any[] = (filieresQuery.data as any[]) ?? [];
  // La Conduite est transversale : ni la carte ECUE, ni son UE dans les filtres.
  const items: any[] = useMemo(
    () => (ecueQuery.data?.items ?? []).filter((e: any) => !isConduiteEcue(e)),
    [ecueQuery.data]
  );
  const ues: any[] = useMemo(
    () => (ueListQuery.data?.items ?? []).filter((u: any) => !isConduiteUe(u)),
    [ueListQuery.data]
  );

  // UE de la filière sélectionnée (pour le select UE et le filtrage des ECUE).
  const filteredUes = useMemo(
    () => (filiereFilter === "all" ? ues : ues.filter((u) => u.filiere_id === filiereFilter)),
    [ues, filiereFilter]
  );
  const ueIdsOfFiliere = useMemo(
    () => new Set(filteredUes.map((u) => u.id)),
    [filteredUes]
  );

  const bilanTypeNameOf = (id: string | null | undefined) => {
    if (!id) return null;
    const b = bilanTypes.find((x) => x.id === id);
    return b ? b.name : null;
  };

  const filteredItems = useMemo(() => {
    return items.filter((s) => {
      const ueList: any[] = Array.isArray(s.ue) ? s.ue : [];
      // Filtre UE précis (prioritaire).
      if (ueFilter !== "all") {
        return ueList.some((u: any) => u.id === ueFilter);
      }
      // Sinon, filtre par filière : au moins une UE de la filière.
      if (filiereFilter !== "all") {
        return ueList.some((u: any) => ueIdsOfFiliere.has(u.id));
      }
      return true;
    });
  }, [items, ueFilter, filiereFilter, ueIdsOfFiliere]);

  const nbActives = useMemo(() => items.filter((s) => s.statut === "actif").length, [items]);

  // Pagination d'affichage (côté client) sur la liste filtrée.
  const pageCount = Math.max(1, Math.ceil(filteredItems.length / PAGE_SIZE));
  const currentPage = Math.min(page, pageCount);
  const pagedItems = useMemo(
    () => filteredItems.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE),
    [filteredItems, currentPage]
  );

  // Revenir à la page 1 quand un filtre change.
  useEffect(() => {
    setPage(1);
  }, [ueFilter, filiereFilter]);

  async function handleDelete(id: string) {
    setError(null);
    if (
      typeof window !== "undefined" &&
      !window.confirm(
        "Supprimer définitivement cette ECUE ?\n\nRefusé si elle est encore rattachée à une UE. Cette action est irréversible."
      )
    ) {
      return;
    }
    try {
      await deleteMut.mutateAsync(id);
    } catch (err: any) {
      setError(err?.message ?? "Erreur lors de la suppression.");
    }
  }

  return (
    <div className="space-y-8 max-w-7xl mx-auto p-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-3xl font-bold bg-gradient-to-r from-green-600 to-blue-600 bg-clip-text text-transparent">
            ECUE (Éléments Constitutifs d'UE)
          </h1>
          <p className="text-muted-foreground mt-2">
            Objets pédagogiques réutilisables — supports, devoirs, séances. Le prix
            et les UV sont portés par l'UE.
          </p>
        </div>
        <Button
          onClick={() => router.push("/professionnel/admin/matieres/new")}
          className="bg-gradient-to-r from-green-500 to-blue-600 hover:from-green-600 hover:to-blue-700 text-white shadow-lg hover:shadow-xl transition-all duration-300"
        >
          <Plus className="h-4 w-4 mr-2" />
          Nouvelle ECUE
        </Button>
      </div>

      {error && (
        <div className="rounded-md border border-red-300 bg-red-50 px-4 py-2 text-sm text-red-700">
          {error}
        </div>
      )}

      {/* Statistiques rapides */}
      {!ecueQuery.isLoading && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="bg-gradient-to-br from-green-500 to-emerald-600 p-6 rounded-xl text-white shadow-lg hover:shadow-xl transition-all duration-300 transform hover:scale-105">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-white/80 text-sm font-medium">Total ECUE</p>
                <p className="text-3xl font-bold mt-1">{items.length}</p>
              </div>
              <div className="bg-white/20 p-3 rounded-lg">
                <BookOpen className="h-6 w-6" />
              </div>
            </div>
          </div>
          <div className="bg-gradient-to-br from-purple-500 to-pink-600 p-6 rounded-xl text-white shadow-lg hover:shadow-xl transition-all duration-300 transform hover:scale-105">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-white/80 text-sm font-medium">ECUE actives</p>
                <p className="text-3xl font-bold mt-1">{nbActives}</p>
              </div>
              <div className="bg-white/20 p-3 rounded-lg">
                <Layers className="h-6 w-6" />
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Filtre */}
      <Card className="shadow-lg border-0 bg-gradient-to-br from-gray-50 to-white">
        <CardContent className="p-6">
          <div className="flex flex-col lg:flex-row gap-4 items-center justify-between">
            <div className="grid w-full grid-cols-1 gap-4 md:grid-cols-2 lg:w-[44rem]">
              <SearchableSelect
                value={filiereFilter}
                onChange={(v) => {
                  setFiliereFilter(v);
                  setUeFilter("all");
                }}
                icon={<Layers className="h-4 w-4 text-gray-400" />}
                placeholder={filieresQuery.isLoading ? "Chargement…" : "Filtrer par filière"}
                searchPlaceholder="Rechercher une filière…"
                options={[
                  { value: "all", label: "Toutes les filières" },
                  ...filieres.map((f: any) => ({
                    value: f.id,
                    label: `${f.name}${f.code ? ` (${f.code})` : ""}`,
                  })),
                ]}
              />
              <SearchableSelect
                value={ueFilter}
                onChange={setUeFilter}
                icon={<Layers className="h-4 w-4 text-gray-400" />}
                placeholder="Filtrer par UE"
                searchPlaceholder="Rechercher une UE…"
                options={[
                  { value: "all", label: "Toutes les UE" },
                  ...filteredUes.map((u: any) => ({ value: u.id, label: `${u.code} — ${u.libelle}` })),
                ]}
              />
            </div>
            <div className="flex items-center text-sm text-gray-600 whitespace-nowrap">
              <span className="font-medium">{filteredItems.length}</span>
              <span className="ml-1">
                {filteredItems.length === 1 ? "ECUE affichée" : "ECUE affichées"}
              </span>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Chargement */}
      {ecueQuery.isLoading && (
        <Card className="shadow-lg">
          <CardContent className="flex flex-col items-center justify-center py-16">
            <div className="text-center space-y-4">
              <div className="bg-gradient-to-br from-green-100 to-blue-100 rounded-full w-16 h-16 flex items-center justify-center mx-auto">
                <Loader2 className="h-8 w-8 animate-spin text-green-600" />
              </div>
              <p className="text-gray-600 text-lg">Chargement des ECUE…</p>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Erreur */}
      {ecueQuery.isError && (
        <Card className="shadow-lg">
          <CardContent className="flex flex-col items-center justify-center py-12">
            <div className="text-center space-y-4">
              <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mx-auto">
                <AlertCircle className="h-8 w-8 text-red-600" />
              </div>
              <p className="text-muted-foreground">
                {(ecueQuery.error as Error)?.message ?? "Impossible de charger les ECUE."}
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Grille */}
      {!ecueQuery.isLoading && filteredItems.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {pagedItems.map((s) => {
            const actif = s.statut === "actif";
            const gradient = actif
              ? "from-green-500 via-teal-500 to-blue-500"
              : "from-gray-400 via-gray-500 to-gray-600";
            return (
              <div
                key={s.id}
                className={`bg-gradient-to-br ${gradient} p-6 rounded-xl shadow-lg hover:shadow-xl transition-all duration-300 text-white relative overflow-hidden group`}
              >
                <div>
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="font-semibold text-lg">{s.libelle}</h3>
                    <div className="flex items-center gap-2">
                      {s.credits != null && (
                        <span className="bg-white/25 text-xs font-semibold px-2 py-0.5 rounded">
                          {s.credits} crédit{s.credits > 1 ? "s" : ""}
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-2 mb-4 text-sm">
                    <p className="text-white/90 col-span-2 font-mono text-xs">{s.code}</p>
                    {Array.isArray(s.ue) && s.ue.length > 0 && (
                      <p className="text-white/90 col-span-2">
                        <span className="font-medium">UE :</span>{" "}
                        {s.ue.map((u: any) => `${u.code} — ${u.libelle}`).join(" · ")}
                      </p>
                    )}
                    {bilanTypeNameOf(s.bilan_type_id) && (
                      <p className="text-white/90 col-span-2">
                        <span className="font-medium">Type de bilan :</span>{" "}
                        {bilanTypeNameOf(s.bilan_type_id)}
                      </p>
                    )}
                  </div>

                  {s.description && (
                    <p className="text-white/80 text-sm mb-4 line-clamp-2">{s.description}</p>
                  )}

                  <div className="flex gap-2">
                    <Button
                      variant="secondary"
                      size="sm"
                      className="bg-white/20 hover:bg-white/30 text-white border-white/20 hover:border-white/30 transition-all duration-200 p-2"
                      onClick={() => router.push(`/professionnel/admin/matieres/${s.id}`)}
                      title="Voir les détails"
                    >
                      <Eye className="w-4 h-4" />
                    </Button>
                    <Button
                      variant="secondary"
                      size="sm"
                      className="bg-white/20 hover:bg-white/30 text-white border-white/20 hover:border-white/30 transition-all duration-200 p-2"
                      onClick={() => router.push(`/professionnel/admin/matieres/${s.id}/edit`)}
                      title="Modifier"
                    >
                      <Edit className="w-4 h-4" />
                    </Button>
                    <Button
                      variant="secondary"
                      size="sm"
                      className="bg-red-50 hover:bg-red-100 text-red-600 border-red-100 transition-all duration-200 p-2"
                      onClick={() => handleDelete(s.id)}
                      disabled={deleteMut.isPending}
                      title="Supprimer"
                    >
                      {deleteMut.isPending ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        <Trash2 className="w-4 h-4" />
                      )}
                    </Button>
                  </div>
                </div>
                <div className="absolute top-0 right-0 w-32 h-32 bg-white/10 rounded-full transform translate-x-16 -translate-y-16 group-hover:scale-110 transition-transform duration-500"></div>
                <div className="absolute bottom-0 left-0 w-24 h-24 bg-white/5 rounded-full transform -translate-x-12 translate-y-12 group-hover:scale-110 transition-transform duration-500"></div>
              </div>
            );
          })}
        </div>
      )}

      {/* Pagination */}
      {!ecueQuery.isLoading && filteredItems.length > PAGE_SIZE && (
        <div className="flex items-center justify-center gap-4">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={currentPage <= 1}
          >
            <ChevronLeft className="h-4 w-4 mr-1" />
            Précédent
          </Button>
          <span className="text-sm text-gray-600">
            Page <span className="font-medium">{currentPage}</span> / {pageCount}
            <span className="ml-2 text-gray-400">({filteredItems.length} ECUE)</span>
          </span>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setPage((p) => Math.min(pageCount, p + 1))}
            disabled={currentPage >= pageCount}
          >
            Suivant
            <ChevronRight className="h-4 w-4 ml-1" />
          </Button>
        </div>
      )}

      {/* Catalogue vide */}
      {!ecueQuery.isLoading && !ecueQuery.isError && items.length === 0 && (
        <Card className="shadow-lg">
          <CardContent className="flex flex-col items-center justify-center py-16">
            <div className="text-center space-y-6">
              <div className="bg-gradient-to-br from-green-100 to-blue-100 rounded-full w-20 h-20 flex items-center justify-center mx-auto">
                <BookOpen className="h-10 w-10 text-green-600" />
              </div>
              <div>
                <h3 className="text-xl font-semibold text-gray-900 mb-2">Aucune ECUE trouvée</h3>
                <p className="text-gray-600 text-lg">
                  Commencez par créer votre première ECUE, puis composez une UE.
                </p>
              </div>
              <Button
                onClick={() => router.push("/professionnel/admin/matieres/new")}
                className="bg-gradient-to-r from-green-500 to-blue-600 hover:from-green-600 hover:to-blue-700 text-white shadow-lg hover:shadow-xl transition-all duration-300"
              >
                <Plus className="h-4 w-4 mr-2" />
                Créer une ECUE
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Aucun résultat filtré */}
      {!ecueQuery.isLoading && items.length > 0 && filteredItems.length === 0 && (
        <Card className="shadow-lg">
          <CardContent className="flex flex-col items-center justify-center py-16">
            <div className="text-center space-y-6">
              <div className="bg-gradient-to-br from-gray-100 to-gray-200 rounded-full w-20 h-20 flex items-center justify-center mx-auto">
                <BookOpen className="h-10 w-10 text-gray-500" />
              </div>
              <div>
                <h3 className="text-xl font-semibold text-gray-900 mb-2">Aucun résultat trouvé</h3>
                <p className="text-gray-600 text-lg">
                  Aucune ECUE ne correspond aux filtres sélectionnés.
                </p>
              </div>
              <Button
                variant="outline"
                onClick={() => {
                  setFiliereFilter("all");
                  setUeFilter("all");
                }}
              >
                <X className="h-4 w-4 mr-2" />
                Effacer les filtres
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
