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
  useConsultationOptions,
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

export default function ConsultationEmploiTempsPage() {
  const router = useRouter();
  // L'année vient en premier : elle commande les noms, qui commandent les
  // semestres.
  const [annee, setAnnee] = useState("");
  const [nomKey, setNomKey] = useState("");
  const [semestreId, setSemestreId] = useState("");

  const optionsQuery = useConsultationOptions();

  // Dès qu'un semestre est sélectionné, on charge sa grille complète (toutes
  // périodes confondues) — plus besoin de choisir un emploi du temps précis.
  const etQuery = useEmploiTemps(semestreId || null, null);
  const et: any = etQuery.data ?? null;

  const options = useMemo(() => optionsQuery.data ?? [], [optionsQuery.data]);

  // Années scolaires disponibles (plus récentes en premier).
  const anneeOptions = useMemo(() => {
    const set = new Set<string>();
    for (const o of options) if (o.annee_scolaire) set.add(o.annee_scolaire);
    return Array.from(set)
      .sort((a, b) => b.localeCompare(a))
      .map((value) => ({ value, label: value }));
  }, [options]);

  // Noms de classe de l'année choisie.
  const nomOptions = useMemo(() => {
    const map = new Map<string, string>();
    for (const o of options) {
      if (annee && o.annee_scolaire !== annee) continue;
      map.set(`${o.classe_id}|${o.nom}`, o.nom);
    }
    return Array.from(map.entries())
      .map(([value, label]) => ({ value, label }))
      .sort((a, b) => a.label.localeCompare(b.label, "fr"));
  }, [options, annee]);

  // Semestres du couple (année, nom) choisi.
  const visibleSemestres = useMemo(() => {
    const map = new Map<string, any>();
    for (const o of options) {
      if (annee && o.annee_scolaire !== annee) continue;
      if (nomKey && `${o.classe_id}|${o.nom}` !== nomKey) continue;
      map.set(o.semestre_id, { id: o.semestre_id, libelle: o.semestre_libelle });
    }
    return Array.from(map.values()).sort((a, b) =>
      String(a.libelle).localeCompare(String(b.libelle))
    );
  }, [options, annee, nomKey]);

  // Le nom retenu sert à filtrer la grille : un semestre peut en porter deux.
  const nomClasse = nomKey ? nomKey.split("|").slice(1).join("|") : "";

  const slots: any[] = useMemo(() => {
    const list: any[] = et?.slots ?? [];
    return nomClasse ? list.filter((sl) => sl.classe_nom === nomClasse) : list;
  }, [et, nomClasse]);

  // Première année proposée par défaut, pour que l'écran ne soit pas vide.
  useEffect(() => {
    if (!annee && anneeOptions.length > 0) setAnnee(anneeOptions[0].value);
  }, [anneeOptions, annee]);

  // Un changement d'année peut invalider le nom, donc le semestre.
  useEffect(() => {
    if (nomKey && !nomOptions.some((o) => o.value === nomKey)) setNomKey("");
  }, [nomOptions, nomKey]);
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
            Sélectionnez la classe, l'année scolaire puis le semestre : la grille s'affiche
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
          {/* L'année commande le reste : seule sur sa ligne, en premier. */}
          <div className="space-y-1.5 md:col-span-2">
            <label className="text-sm font-medium">Année scolaire</label>
            <SearchableSelect
              value={annee}
              onChange={(v) => {
                setAnnee(v);
                setNomKey("");
                setSemestreId("");
              }}
              icon={<Calendar className="h-4 w-4 text-gray-400" />}
              placeholder={
                optionsQuery.isLoading
                  ? "Chargement…"
                  : anneeOptions.length === 0
                    ? "Aucun emploi du temps"
                    : "Sélectionner une année"
              }
              searchPlaceholder="Rechercher une année…"
              options={anneeOptions}
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-sm font-medium">Nom de la classe</label>
            <SearchableSelect
              value={nomKey}
              onChange={(v) => {
                setNomKey(v);
                setSemestreId("");
              }}
              icon={<Layers className="h-4 w-4 text-gray-400" />}
              placeholder={
                !annee
                  ? "Choisir d'abord une année"
                  : nomOptions.length === 0
                    ? "Aucune classe cette année"
                    : "Sélectionner un nom de classe"
              }
              searchPlaceholder="Rechercher un nom de classe…"
              options={nomOptions}
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-sm font-medium">Semestre</label>
            <SearchableSelect
              value={semestreId}
              onChange={(v) => setSemestreId(v)}
              icon={<CalendarRange className="h-4 w-4 text-gray-400" />}
              placeholder={
                !nomKey
                  ? "Choisir d'abord un nom de classe"
                  : visibleSemestres.length === 0
                    ? "Aucun semestre"
                    : "Sélectionner un semestre"
              }
              searchPlaceholder="Rechercher un semestre…"
              options={visibleSemestres.map((sm) => ({ value: sm.id, label: sm.libelle }))}
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
