"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Button,
} from "@ecoledigitale/ui";
import { Layers, CalendarRange, Calendar, FileDown, Info, Pencil } from "lucide-react";
import { SearchableSelect } from "@/components/SearchableSelect";
import { EmploiTempsGrid } from "@/components/professional/EmploiTempsGrid";
import {
  useEmploiTemps,
  useFilieresWithEmploiTemps,
  useSemestresWithEmploiTemps,
} from "@/lib/hooks/use-professional-emploi-temps";
import { downloadEmploiTempsDocx } from "@/lib/emploi-temps-docx";
import { openEmploiTempsPdf } from "@/lib/emploi-temps-pdf";
import { ouvrirOngletPdf, POPUP_BLOQUEE } from "@/lib/utils/report-pdf";

/**
 * Consultation des emplois du temps — Module Professionnel.
 * L'utilisateur sélectionne filière → année scolaire → semestre ; dès qu'un
 * semestre est choisi, sa grille s'affiche directement. Lecture seule + export Word.
 */

function fmtDate(value?: string | null): string {
  if (!value) return "—";
  const d = new Date(value);
  return isNaN(d.getTime()) ? String(value) : d.toLocaleDateString("fr-FR");
}

/**
 * Année scolaire (pivot septembre) dérivée de la date de début du semestre,
 * alignée sur le calcul côté API (professional-bulletin.service.ts) et les autres
 * pages : un semestre démarrant en septembre ou après appartient à
 * « AAAA-AAAA+1 », sinon « AAAA-1-AAAA ».
 */
function anneeScolaireOf(v?: string | null): string | null {
  if (!v) return null;
  const d = new Date(v);
  if (isNaN(d.getTime())) return null;
  const y = d.getFullYear();
  return d.getMonth() + 1 >= 9 ? `${y}-${y + 1}` : `${y - 1}-${y}`;
}

export default function ConsultationEmploiTempsPage() {
  const router = useRouter();
  const [filiereId, setFiliereId] = useState("");
  const [annee, setAnnee] = useState("all");
  const [semestreId, setSemestreId] = useState("");

  const programmesQuery = useFilieresWithEmploiTemps();
  const semestresQuery = useSemestresWithEmploiTemps(filiereId || null);

  // Dès qu'un semestre est sélectionné, on charge sa grille complète (toutes
  // périodes confondues) — plus besoin de choisir un emploi du temps précis.
  const etQuery = useEmploiTemps(semestreId || null, null);
  const et: any = etQuery.data ?? null;
  const slots: any[] = et?.slots ?? [];

  const filieres: any[] = (programmesQuery.data as any[]) ?? [];

  // Semestres de la filière, triés, avec leur année scolaire dérivée.
  const semestres: any[] = useMemo(() => {
    const list = (semestresQuery.data as any[]) ?? [];
    if (!filiereId) return [];
    return [...list]
      .map((s) => ({ ...s, annee_scolaire: anneeScolaireOf(s.date_debut) }))
      .sort((a, b) => String(a.libelle).localeCompare(String(b.libelle)));
  }, [semestresQuery.data, filiereId]);

  // Années scolaires disponibles pour la filière (plus récentes en premier).
  const anneeOptions = useMemo(() => {
    const set = new Set<string>();
    for (const s of semestres) if (s.annee_scolaire) set.add(s.annee_scolaire);
    return Array.from(set)
      .sort((a, b) => b.localeCompare(a))
      .map((value) => ({ value, label: value }));
  }, [semestres]);

  // Semestres filtrés par année scolaire sélectionnée.
  const visibleSemestres = useMemo(
    () => semestres.filter((s) => annee === "all" || s.annee_scolaire === annee),
    [semestres, annee]
  );

  // Si l'année sélectionnée n'existe plus (changement de filière), on réinitialise.
  useEffect(() => {
    if (annee !== "all" && !anneeOptions.some((o) => o.value === annee)) setAnnee("all");
  }, [anneeOptions, annee]);

  // Si le semestre sélectionné n'est plus visible (filtre année), on le désélectionne.
  useEffect(() => {
    if (semestreId && !visibleSemestres.some((s) => s.id === semestreId)) setSemestreId("");
  }, [visibleSemestres, semestreId]);

  /** Même grille que l'export Word, ouverte dans la visionneuse PDF. */
  async function exporterPdf() {
    if (!et) return;
    // L'onglet s'ouvre dans le geste de clic, sinon la popup est bloquée.
    const win = ouvrirOngletPdf();
    if (!win) {
      alert(POPUP_BLOQUEE);
      return;
    }
    try {
      await openEmploiTempsPdf(et, win);
    } catch (err: any) {
      alert(err?.message ?? "Erreur lors de l'export PDF.");
    }
  }

  return (
    <div className="space-y-6 max-w-7xl mx-auto p-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-3xl font-bold bg-gradient-to-r from-indigo-600 to-blue-600 bg-clip-text text-transparent">
            Consultation des emplois du temps
          </h1>
          <p className="text-muted-foreground mt-2">
            Sélectionnez la filière, l'année scolaire puis le semestre : la grille s'affiche
            directement.
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            onClick={() => router.push("/professionnel/admin/planning")}
          >
            <Pencil className="h-4 w-4 mr-2" />
            Créer / modifier
          </Button>
          <Button
            onClick={exporterPdf}
            disabled={!et || slots.length === 0}
            className="bg-gradient-to-r from-red-500 to-orange-600 hover:from-red-600 hover:to-orange-700 text-white"
          >
            <FileDown className="h-4 w-4 mr-2" />
            Exporter en PDF
          </Button>
          <Button
            onClick={() => et && downloadEmploiTempsDocx(et)}
            disabled={!et || slots.length === 0}
            className="bg-gradient-to-r from-indigo-500 to-blue-600 hover:from-indigo-600 hover:to-blue-700 text-white"
          >
            <FileDown className="h-4 w-4 mr-2" />
            Exporter en Word
          </Button>
        </div>
      </div>

      {/* Sélecteurs */}
      <Card className="shadow-lg">
        <CardHeader>
          <CardTitle>Sélection</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <label className="text-sm font-medium">Filière</label>
            <SearchableSelect
              value={filiereId}
              onChange={(id) => {
                setFiliereId(id);
                setAnnee("all");
                setSemestreId("");
              }}
              icon={<Layers className="h-4 w-4 text-gray-400" />}
              placeholder={programmesQuery.isLoading ? "Chargement…" : "Sélectionner une filière"}
              options={filieres.map((f) => ({
                value: f.id,
                label: `${f.name}${f.code ? ` (${f.code})` : ""}`,
              }))}
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-sm font-medium">Année scolaire</label>
            <SearchableSelect
              value={annee}
              onChange={(v) => setAnnee(v)}
              icon={<Calendar className="h-4 w-4 text-gray-400" />}
              placeholder={!filiereId ? "Choisir d'abord une filière" : "Toutes les années"}
              searchPlaceholder="Rechercher une année…"
              options={[{ value: "all", label: "Toutes les années" }, ...anneeOptions]}
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-sm font-medium">Semestre</label>
            <SearchableSelect
              value={semestreId}
              onChange={(v) => setSemestreId(v)}
              icon={<CalendarRange className="h-4 w-4 text-gray-400" />}
              placeholder={
                !filiereId
                  ? "Choisir d'abord une filière"
                  : semestresQuery.isLoading
                  ? "Chargement…"
                  : visibleSemestres.length === 0
                  ? "Aucun semestre"
                  : "Sélectionner un semestre"
              }
              options={visibleSemestres.map((s) => ({ value: s.id, label: s.libelle }))}
            />
          </div>
        </CardContent>
      </Card>

      {/* Détail — affiché dès qu'un semestre est sélectionné */}
      {semestreId && etQuery.isLoading && (
        <p className="text-center text-muted-foreground py-10">Chargement de l'emploi du temps…</p>
      )}

      {semestreId && !etQuery.isLoading && et && (
        <>
          <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
            <Info className="h-4 w-4" />
            <span className="font-medium text-foreground">{et.filiere_nom}</span>
            <span>· {et.libelle}</span>
            {et.date_debut && et.date_fin && (
              <span>
                · Du {fmtDate(et.date_debut)} au {fmtDate(et.date_fin)}
              </span>
            )}
          </div>

          <Card className="shadow-lg overflow-hidden">
            <CardContent className="p-0">
              {slots.length === 0 ? (
                <p className="p-6 text-center text-muted-foreground">
                  Aucun créneau pour cet emploi du temps.
                </p>
              ) : (
                <EmploiTempsGrid slots={slots} />
              )}
            </CardContent>
          </Card>
        </>
      )}

      {!semestreId && (
        <p className="text-center text-muted-foreground py-10">
          Sélectionnez un semestre pour afficher son emploi du temps.
        </p>
      )}
    </div>
  );
}
