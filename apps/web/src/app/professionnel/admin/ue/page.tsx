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
  Layers,
  GraduationCap,
  X,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import { SearchableSelect } from "@/components/SearchableSelect";
import { useProgrammes } from "@/lib/hooks/use-programmes";
import {
  useAllProfessionalUeList,
  useDeleteProfessionalUe,
} from "@/lib/hooks/use-professional-catalog-admin";

const PAGE_SIZE = 20;

/** Formate un prix en FCFA (XOF → FCFA, séparateur de milliers). 0 = Gratuit. */
function fmtPrice(prix: any, devise?: string): string {
  const n = Number(prix ?? 0);
  if (!Number.isFinite(n) || n === 0) return "Gratuit";
  const unit = !devise || devise === "XOF" ? "FCFA" : devise;
  return `${n.toLocaleString("fr-FR")} ${unit}`;
}

/**
 * Liste des UE (Unités d'Enseignement) — Module Professionnel (feature 030).
 *
 * L'UE est le pôle ADMINISTRATIF : rattachée à une Filière, elle porte le prix,
 * les UV et le statut. Elle compose des ECUE et héberge des sessions.
 */
export default function ProfessionalUeListPage() {
  const router = useRouter();
  const [filiereFilter, setFiliereFilter] = useState<string>("all");
  const [page, setPage] = useState(1);
  const [error, setError] = useState<string | null>(null);

  const programmesQuery = useProgrammes();
  const ueQuery = useAllProfessionalUeList();
  const deleteMut = useDeleteProfessionalUe();

  const filieres: any[] = programmesQuery.data?.data ?? [];
  const items: any[] = ueQuery.data?.items ?? [];

  const filiereNameOf = (id: string) => {
    const p = filieres.find((x) => x.id === id);
    return p ? `${p.name}${p.code ? ` (${p.code})` : ""}` : id;
  };

  const filteredItems = useMemo(
    () =>
      filiereFilter === "all" ? items : items.filter((u) => u.filiere_id === filiereFilter),
    [items, filiereFilter]
  );

  const distinctFilieres = useMemo(
    () => new Set(items.map((u) => u.filiere_id)).size,
    [items]
  );

  // Pagination d'affichage (côté client) sur la liste filtrée.
  const pageCount = Math.max(1, Math.ceil(filteredItems.length / PAGE_SIZE));
  const currentPage = Math.min(page, pageCount);
  const pagedItems = useMemo(
    () => filteredItems.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE),
    [filteredItems, currentPage]
  );

  // Revenir à la page 1 quand le filtre change.
  useEffect(() => {
    setPage(1);
  }, [filiereFilter]);

  async function handleDelete(id: string) {
    setError(null);
    if (
      typeof window !== "undefined" &&
      !window.confirm(
        "Supprimer définitivement cette UE ?\n\nRefusé si des inscriptions existent. Cette action est irréversible."
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
          <h1 className="text-3xl font-bold bg-gradient-to-r from-indigo-600 to-blue-600 bg-clip-text text-transparent">
            Unités d'Enseignement (UE)
          </h1>
          <p className="text-muted-foreground mt-2">
            Pôle administratif — prix, UV, sessions et composition en ECUE, par filière.
          </p>
        </div>
        <Button
          onClick={() => router.push("/professionnel/admin/ue/new")}
          className="bg-gradient-to-r from-indigo-500 to-blue-600 hover:from-indigo-600 hover:to-blue-700 text-white shadow-lg hover:shadow-xl transition-all duration-300"
        >
          <Plus className="h-4 w-4 mr-2" />
          Nouvelle UE
        </Button>
      </div>

      {error && (
        <div className="rounded-md border border-red-300 bg-red-50 px-4 py-2 text-sm text-red-700">
          {error}
        </div>
      )}

      {/* Statistiques rapides */}
      {!ueQuery.isLoading && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="bg-gradient-to-br from-indigo-500 to-blue-600 p-6 rounded-xl text-white shadow-lg">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-white/80 text-sm font-medium">Total UE</p>
                <p className="text-3xl font-bold mt-1">{items.length}</p>
              </div>
              <div className="bg-white/20 p-3 rounded-lg">
                <Layers className="h-6 w-6" />
              </div>
            </div>
          </div>
          <div className="bg-gradient-to-br from-purple-500 to-pink-600 p-6 rounded-xl text-white shadow-lg">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-white/80 text-sm font-medium">Filières couvertes</p>
                <p className="text-3xl font-bold mt-1">{distinctFilieres}</p>
              </div>
              <div className="bg-white/20 p-3 rounded-lg">
                <GraduationCap className="h-6 w-6" />
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Filtre */}
      <Card className="shadow-lg border-0 bg-gradient-to-br from-gray-50 to-white">
        <CardContent className="p-6">
          <div className="flex flex-col lg:flex-row gap-4 items-center justify-between">
            <div className="w-full lg:w-[32rem]">
              <SearchableSelect
                value={filiereFilter}
                onChange={setFiliereFilter}
                icon={<GraduationCap className="h-4 w-4 text-gray-400" />}
                placeholder="Filtrer par filière"
                options={[
                  { value: "all", label: "Toutes les filières" },
                  ...filieres.map((p) => ({ value: p.id, label: p.name })),
                ]}
              />
            </div>
            <div className="flex items-center text-sm text-gray-600 whitespace-nowrap">
              <span className="font-medium">{filteredItems.length}</span>
              <span className="ml-1">{filteredItems.length === 1 ? "UE affichée" : "UE affichées"}</span>
            </div>
          </div>
        </CardContent>
      </Card>

      {ueQuery.isLoading && (
        <Card className="shadow-lg">
          <CardContent className="flex flex-col items-center justify-center py-16">
            <Loader2 className="h-8 w-8 animate-spin text-indigo-600" />
            <p className="text-gray-600 text-lg mt-4">Chargement des UE…</p>
          </CardContent>
        </Card>
      )}

      {ueQuery.isError && (
        <Card className="shadow-lg">
          <CardContent className="flex flex-col items-center justify-center py-12">
            <AlertCircle className="h-8 w-8 text-red-600" />
            <p className="text-muted-foreground mt-4">
              {(ueQuery.error as Error)?.message ?? "Impossible de charger les UE."}
            </p>
          </CardContent>
        </Card>
      )}

      {!ueQuery.isLoading && filteredItems.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {pagedItems.map((u) => {
            const actif = u.statut === "actif";
            const gradient = actif
              ? "from-indigo-500 via-blue-500 to-cyan-500"
              : "from-gray-400 via-gray-500 to-gray-600";
            return (
              <div
                key={u.id}
                className={`bg-gradient-to-br ${gradient} p-6 rounded-xl shadow-lg hover:shadow-xl transition-all duration-300 text-white relative overflow-hidden group`}
              >
                <div>
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="font-semibold text-lg">{u.libelle}</h3>
                  </div>

                  <div className="grid grid-cols-2 gap-2 mb-4 text-sm">
                    <p className="text-white/90 col-span-2 font-mono text-xs">{u.code}</p>
                    <p className="text-white/90 col-span-2">
                      <span className="font-medium">Filière :</span> {filiereNameOf(u.filiere_id)}
                    </p>
                    <p className="text-white/90">
                      <span className="font-medium">Crédit(s) :</span> {u.nb_uv}
                    </p>
                    <p className="text-white/90">
                      <span className="font-medium">Prix :</span> {fmtPrice(u.prix, u.devise)}
                    </p>
                  </div>

                  {u.description && (
                    <p className="text-white/80 text-sm mb-4 line-clamp-2">{u.description}</p>
                  )}

                  <div className="flex gap-2">
                    <Button
                      variant="secondary"
                      size="sm"
                      className="bg-white/20 hover:bg-white/30 text-white border-white/20 p-2"
                      onClick={() => router.push(`/professionnel/admin/ue/${u.id}`)}
                      title="Composition, prérequis & sessions"
                    >
                      <Eye className="w-4 h-4" />
                    </Button>
                    <Button
                      variant="secondary"
                      size="sm"
                      className="bg-white/20 hover:bg-white/30 text-white border-white/20 p-2"
                      onClick={() => router.push(`/professionnel/admin/ue/${u.id}/edit`)}
                      title="Modifier"
                    >
                      <Edit className="w-4 h-4" />
                    </Button>
                    <Button
                      variant="secondary"
                      size="sm"
                      className="bg-red-50 hover:bg-red-100 text-red-600 border-red-100 p-2"
                      onClick={() => handleDelete(u.id)}
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
              </div>
            );
          })}
        </div>
      )}

      {/* Pagination */}
      {!ueQuery.isLoading && filteredItems.length > PAGE_SIZE && (
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
            <span className="ml-2 text-gray-400">({filteredItems.length} UE)</span>
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

      {!ueQuery.isLoading && !ueQuery.isError && items.length === 0 && (
        <Card className="shadow-lg">
          <CardContent className="flex flex-col items-center justify-center py-16 text-center space-y-6">
            <div className="bg-gradient-to-br from-indigo-100 to-blue-100 rounded-full w-20 h-20 flex items-center justify-center">
              <Layers className="h-10 w-10 text-indigo-600" />
            </div>
            <div>
              <h3 className="text-xl font-semibold text-gray-900 mb-2">Aucune UE</h3>
              <p className="text-gray-600 text-lg">
                Créez une UE, puis composez-la avec des ECUE et ouvrez des sessions.
              </p>
            </div>
            <Button
              onClick={() => router.push("/professionnel/admin/ue/new")}
              className="bg-gradient-to-r from-indigo-500 to-blue-600 text-white"
            >
              <Plus className="h-4 w-4 mr-2" />
              Créer une UE
            </Button>
          </CardContent>
        </Card>
      )}

      {!ueQuery.isLoading && items.length > 0 && filteredItems.length === 0 && (
        <Card className="shadow-lg">
          <CardContent className="flex flex-col items-center justify-center py-16 text-center space-y-6">
            <Layers className="h-10 w-10 text-gray-500" />
            <p className="text-gray-600 text-lg">Aucune UE pour cette filière.</p>
            <Button variant="outline" onClick={() => setFiliereFilter("all")}>
              <X className="h-4 w-4 mr-2" />
              Effacer le filtre
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
