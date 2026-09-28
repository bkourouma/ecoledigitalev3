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
  CalendarRange,
  Layers,
  GraduationCap,
  X,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import { SearchableSelect } from "@/components/SearchableSelect";
import { ExportButtons } from "@/components/ExportButtons";
import { useProgrammes } from "@/lib/hooks/use-programmes";
import {
  downloadSemestreReportDocx,
  openSemestreReportPdf,
} from "@/lib/utils/semestre-report";
import {
  useProfessionalSemestres,
  useDeleteProfessionalSemestre,
} from "@/lib/hooks/use-professional-semestres";

/**
 * Liste des semestres — Module Professionnel.
 * Un semestre est composé d'UE d'une filière.
 */

const PAGE_SIZE = 20;

export default function ProfessionalSemestresListPage() {
  const router = useRouter();
  const [filiereFilter, setFiliereFilter] = useState<string>("all");
  const [page, setPage] = useState(1);
  const [error, setError] = useState<string | null>(null);

  const programmesQuery = useProgrammes();
  const semestresQuery = useProfessionalSemestres(
    filiereFilter === "all" ? {} : { filiere_id: filiereFilter }
  );
  const deleteMut = useDeleteProfessionalSemestre();

  const filieres: any[] = programmesQuery.data?.data ?? [];
  const semestres: any[] = (semestresQuery.data as any[]) ?? [];

  const totalUe = useMemo(
    () => semestres.reduce((acc, s) => acc + (s.nb_ue ?? 0), 0),
    [semestres]
  );

  // Pagination d'affichage (côté client).
  const pageCount = Math.max(1, Math.ceil(semestres.length / PAGE_SIZE));
  const currentPage = Math.min(page, pageCount);
  const pagedSemestres = useMemo(
    () => semestres.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE),
    [semestres, currentPage]
  );

  // Revenir à la page 1 quand le filtre change.
  useEffect(() => {
    setPage(1);
  }, [filiereFilter]);

  /** Le document rappelle en sous-titre le filtre sous lequel il a été édité. */
  const exportOptions = useMemo(() => {
    const filiere = filieres.find((f) => f.id === filiereFilter);
    return {
      filtreLibelle:
        filiereFilter === "all" || !filiere
          ? "Toutes les classes"
          : `Classe : ${filiere.name}${filiere.code ? ` (${filiere.code})` : ""}`,
    };
  }, [filiereFilter, filieres]);

  async function handleDelete(id: string) {
    setError(null);
    if (
      typeof window !== "undefined" &&
      !window.confirm(
        "Supprimer définitivement ce semestre ?\n\nLes UE ne sont pas supprimées, seul le semestre l'est. Cette action est irréversible."
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
      <div className="mb-6 flex max-w-full flex-col items-start gap-2 overflow-x-auto md:gap-3">
        <div>
          <h1 className="font-bold bg-gradient-to-r from-indigo-600 to-purple-600 bg-clip-text text-transparent whitespace-nowrap text-2xl leading-tight md:text-3xl">
            Semestres
          </h1>
          <p className="text-muted-foreground whitespace-nowrap text-sm md:text-base">
            Composez les semestres d'une classe avec ses UE. Les sessions se créent ensuite.
          </p>
        </div>
        <div className="flex gap-2">
          <ExportButtons
            disabled={semestresQuery.isLoading || semestres.length === 0}
            onError={setError}
            onExportPdf={(win) => openSemestreReportPdf(semestres, exportOptions, win)}
            onExportWord={() => downloadSemestreReportDocx(semestres, exportOptions)}
          />
          <Button
            onClick={() => router.push("/professionnel/admin/semestres/new")}
            className="bg-gradient-to-r from-indigo-500 to-purple-600 hover:from-indigo-600 hover:to-purple-700 text-white shadow-lg hover:shadow-xl transition-all duration-300"
          >
            <Plus className="h-4 w-4 mr-2" />
            Nouveau semestre
          </Button>
        </div>
      </div>

      {error && (
        <div className="rounded-md border border-red-300 bg-red-50 px-4 py-2 text-sm text-red-700">
          {error}
        </div>
      )}

      {/* Statistiques rapides */}
      {!semestresQuery.isLoading && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="bg-gradient-to-br from-indigo-500 to-purple-600 p-6 rounded-xl text-white shadow-lg hover:shadow-xl transition-all duration-300 transform hover:scale-105">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-white/80 text-sm font-medium">Total semestres</p>
                <p className="text-3xl font-bold mt-1">{semestres.length}</p>
              </div>
              <div className="bg-white/20 p-3 rounded-lg">
                <CalendarRange className="h-6 w-6" />
              </div>
            </div>
          </div>
          <div className="bg-gradient-to-br from-purple-500 to-pink-600 p-6 rounded-xl text-white shadow-lg hover:shadow-xl transition-all duration-300 transform hover:scale-105">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-white/80 text-sm font-medium">UE regroupées</p>
                <p className="text-3xl font-bold mt-1">{totalUe}</p>
              </div>
              <div className="bg-white/20 p-3 rounded-lg">
                <Layers className="h-6 w-6" />
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Filtre par classe */}
      <Card className="shadow-lg border-0 bg-gradient-to-br from-gray-50 to-white">
        <CardContent className="p-6">
          <div className="flex flex-col lg:flex-row gap-4 items-center justify-between">
            <div className="w-full lg:w-[32rem]">
              <SearchableSelect
                value={filiereFilter}
                onChange={setFiliereFilter}
                icon={<Layers className="h-4 w-4 text-gray-400" />}
                placeholder="Filtrer par classe"
                options={[
                  { value: "all", label: "Toutes les classes" },
                  ...filieres.map((f) => ({
                    value: f.id,
                    label: `${f.name}${f.code ? ` (${f.code})` : ""}`,
                  })),
                ]}
              />
            </div>
            <div className="flex items-center text-sm text-gray-600 whitespace-nowrap">
              <span className="font-medium">{semestres.length}</span>
              <span className="ml-1">
                {semestres.length === 1 ? "semestre affiché" : "semestres affichés"}
              </span>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Chargement */}
      {semestresQuery.isLoading && (
        <Card className="shadow-lg">
          <CardContent className="flex flex-col items-center justify-center py-16">
            <div className="text-center space-y-4">
              <div className="bg-gradient-to-br from-indigo-100 to-purple-100 rounded-full w-16 h-16 flex items-center justify-center mx-auto">
                <Loader2 className="h-8 w-8 animate-spin text-indigo-600" />
              </div>
              <p className="text-gray-600 text-lg">Chargement des semestres…</p>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Erreur */}
      {semestresQuery.isError && (
        <Card className="shadow-lg">
          <CardContent className="flex flex-col items-center justify-center py-12">
            <div className="text-center space-y-4">
              <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mx-auto">
                <AlertCircle className="h-8 w-8 text-red-600" />
              </div>
              <p className="text-muted-foreground">
                {(semestresQuery.error as Error)?.message ??
                  "Impossible de charger les semestres."}
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Grille des semestres */}
      {!semestresQuery.isLoading && semestres.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {pagedSemestres.map((s) => (
            <div
              key={s.id}
              className="bg-gradient-to-br from-indigo-500 via-purple-500 to-pink-500 p-6 rounded-xl shadow-lg hover:shadow-xl transition-all duration-300 text-white relative overflow-hidden group"
            >
              <div>
                <div className="flex items-start justify-between mb-3 gap-2">
                  <h3 className="font-semibold text-lg">{s.libelle}</h3>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <span className="bg-white/20 text-xs font-medium px-2 py-0.5 rounded">
                      {s.nb_ue ?? 0} UE
                    </span>
                    <span className="bg-white/20 text-xs font-medium px-2 py-0.5 rounded inline-flex items-center gap-1">
                      <GraduationCap className="h-3 w-3" />
                      {s.nb_uv ?? 0} crédits
                    </span>
                  </div>
                </div>

                <div className="mb-4 text-sm">
                  <p className="text-white/90 flex items-center gap-1.5">
                    <Layers className="h-3.5 w-3.5 shrink-0" />
                    <span>
                      <span className="font-medium">Classe :</span>{" "}
                      {s.filiere_nom ?? "—"}
                    </span>
                  </p>
                </div>

                <div className="flex gap-2">
                  <Button
                    variant="secondary"
                    size="sm"
                    className="bg-white/20 hover:bg-white/30 text-white border-white/20 hover:border-white/30 transition-all duration-200 p-2"
                    onClick={() => router.push(`/professionnel/admin/semestres/${s.id}`)}
                    title="Voir le détail"
                  >
                    <Eye className="w-4 h-4" />
                  </Button>
                  <Button
                    variant="secondary"
                    size="sm"
                    className="bg-white/20 hover:bg-white/30 text-white border-white/20 hover:border-white/30 transition-all duration-200 p-2"
                    onClick={() => router.push(`/professionnel/admin/semestres/${s.id}/edit`)}
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
          ))}
        </div>
      )}

      {/* Pagination */}
      {!semestresQuery.isLoading && semestres.length > PAGE_SIZE && (
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
            <span className="ml-2 text-gray-400">({semestres.length} semestres)</span>
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

      {/* Vide */}
      {!semestresQuery.isLoading && !semestresQuery.isError && semestres.length === 0 && (
        <Card className="shadow-lg">
          <CardContent className="flex flex-col items-center justify-center py-16">
            <div className="text-center space-y-6">
              <div className="bg-gradient-to-br from-indigo-100 to-purple-100 rounded-full w-20 h-20 flex items-center justify-center mx-auto">
                <CalendarRange className="h-10 w-10 text-indigo-600" />
              </div>
              <div>
                <h3 className="text-xl font-semibold text-gray-900 mb-2">
                  Aucun semestre trouvé
                </h3>
                <p className="text-gray-600 text-lg">
                  {filiereFilter === "all"
                    ? "Commencez par créer votre premier semestre."
                    : "Aucun semestre pour la classe sélectionnée."}
                </p>
              </div>
              <div className="flex gap-3">
                {filiereFilter !== "all" && (
                  <Button variant="outline" onClick={() => setFiliereFilter("all")}>
                    <X className="h-4 w-4 mr-2" />
                    Effacer le filtre
                  </Button>
                )}
                <Button
                  onClick={() => router.push("/professionnel/admin/semestres/new")}
                  className="bg-gradient-to-r from-indigo-500 to-purple-600 hover:from-indigo-600 hover:to-purple-700 text-white"
                >
                  <Plus className="h-4 w-4 mr-2" />
                  Nouveau semestre
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
