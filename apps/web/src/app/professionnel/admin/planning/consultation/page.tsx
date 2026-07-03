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
import { Layers, CalendarRange, CalendarClock, FileDown, Info, Pencil } from "lucide-react";
import { SearchableSelect } from "@/components/SearchableSelect";
import { EmploiTempsGrid } from "@/components/professional/EmploiTempsGrid";
import {
  useEmploiTemps,
  useEmploisDuTempsList,
  useFilieresWithEmploiTemps,
  useSemestresWithEmploiTemps,
} from "@/lib/hooks/use-professional-emploi-temps";
import { downloadEmploiTempsDocx } from "@/lib/emploi-temps-docx";

/**
 * Consultation des emplois du temps — Module Professionnel.
 * L'utilisateur sélectionne filière → semestre → emploi du temps (période),
 * puis le détail (grille) s'affiche. Lecture seule + export Word.
 */

function fmtDate(value?: string | null): string {
  if (!value) return "—";
  const d = new Date(value);
  return isNaN(d.getTime()) ? String(value) : d.toLocaleDateString("fr-FR");
}

export default function ConsultationEmploiTempsPage() {
  const router = useRouter();
  const [filiereId, setFiliereId] = useState("");
  const [semestreId, setSemestreId] = useState("");
  const [periodKey, setPeriodKey] = useState(""); // `${date_debut}|${date_fin}`

  const programmesQuery = useFilieresWithEmploiTemps();
  const semestresQuery = useSemestresWithEmploiTemps(filiereId || null);
  const listQuery = useEmploisDuTempsList(semestreId || null);

  const period = useMemo(() => {
    if (!periodKey) return null;
    const [date_debut, date_fin] = periodKey.split("|");
    return { date_debut, date_fin };
  }, [periodKey]);

  const etQuery = useEmploiTemps(semestreId && period ? semestreId : null, period);
  const et: any = etQuery.data ?? null;
  const slots: any[] = et?.slots ?? [];

  const filieres: any[] = (programmesQuery.data as any[]) ?? [];
  const semestres: any[] = useMemo(() => {
    const list = (semestresQuery.data as any[]) ?? [];
    return filiereId
      ? [...list].sort((a, b) => String(a.libelle).localeCompare(String(b.libelle)))
      : [];
  }, [semestresQuery.data, filiereId]);
  const emplois: any[] = (listQuery.data as any[]) ?? [];

  // Réinitialise la sélection d'emploi du temps quand le semestre change.
  useEffect(() => {
    setPeriodKey("");
  }, [semestreId]);

  return (
    <div className="space-y-6 max-w-7xl mx-auto p-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-3xl font-bold bg-gradient-to-r from-indigo-600 to-blue-600 bg-clip-text text-transparent">
            Consultation des emplois du temps
          </h1>
          <p className="text-muted-foreground mt-2">
            Sélectionnez la filière, le semestre puis l'emploi du temps pour afficher son détail.
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
        <CardContent className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="space-y-1.5">
            <label className="text-sm font-medium">Filière</label>
            <SearchableSelect
              value={filiereId}
              onChange={(id) => {
                setFiliereId(id);
                setSemestreId("");
                setPeriodKey("");
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
                  : semestres.length === 0
                  ? "Aucun semestre"
                  : "Sélectionner un semestre"
              }
              options={semestres.map((s) => ({ value: s.id, label: s.libelle }))}
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-sm font-medium">Emploi du temps</label>
            <SearchableSelect
              value={periodKey}
              onChange={(v) => setPeriodKey(v)}
              icon={<CalendarClock className="h-4 w-4 text-gray-400" />}
              placeholder={
                !semestreId
                  ? "Choisir d'abord un semestre"
                  : listQuery.isLoading
                  ? "Chargement…"
                  : emplois.length === 0
                  ? "Aucun emploi du temps"
                  : "Sélectionner un emploi du temps"
              }
              options={emplois.map((e) => ({
                value: `${e.date_debut}|${e.date_fin}`,
                label: `Du ${fmtDate(e.date_debut)} au ${fmtDate(e.date_fin)} — ${e.nb_creneaux} créneau${
                  e.nb_creneaux > 1 ? "x" : ""
                }`,
              }))}
            />
          </div>
        </CardContent>
      </Card>

      {/* Détail */}
      {semestreId && period && et && (
        <>
          <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
            <Info className="h-4 w-4" />
            <span className="font-medium text-foreground">{et.filiere_nom}</span>
            <span>· {et.libelle}</span>
            <span>
              · Du {fmtDate(et.date_debut)} au {fmtDate(et.date_fin)}
            </span>
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

      {semestreId && !period && (
        <p className="text-center text-muted-foreground py-10">
          Sélectionnez un emploi du temps pour afficher son détail.
        </p>
      )}
    </div>
  );
}
