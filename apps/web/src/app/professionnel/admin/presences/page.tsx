"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Card, CardContent, Input, Button } from "@ecoledigitale/ui";
import {
  ClipboardCheck,
  Layers,
  CalendarRange,
  Calendar,
  CheckCircle2,
  Loader2,
  AlertCircle,
  Search,
  GraduationCap,
  Clock,
  UserRound,
  Eye,
  History,
} from "lucide-react";
import { SearchableSelect } from "@/components/SearchableSelect";
import { ExportButtons } from "@/components/ExportButtons";
import { openPresencePdf } from "@/lib/utils/presence-report";
import {
  usePresencesHistory,
  usePresencesOptions,
} from "@/lib/hooks/use-professional-bulletins";

/**
 * Présences — Module Professionnel (admin).
 * Synthèse des appels effectués dans l'application, par filière, statut de
 * session (en cours / terminées) et semestre : récapitulatif par étudiant avec
 * les heures d'absence calculées sur la durée réelle des cours. Le bouton
 * « Détails » d'une ligne ouvre la fiche de l'étudiant
 * (`presences/etudiant/[studentId]`) : toutes ses séances du périmètre,
 * regroupées par matière, avec son statut de pointage séance par séance.
 */


/** 4.5 → « 4h30 » ; 2 → « 2h » ; 0 → « 0h ». */
function fmtHeures(h: number | null | undefined): string {
  const v = Number(h ?? 0);
  const heures = Math.floor(v);
  const minutes = Math.round((v - heures) * 60);
  return minutes > 0 ? `${heures}h${String(minutes).padStart(2, "0")}` : `${heures}h`;
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

export default function AdminPresencesPage() {
  // L'année commande la liste des noms, qui commande celle des semestres.
  const [annee, setAnnee] = useState("");
  const [nomKey, setNomKey] = useState("");
  const [semestreId, setSemestreId] = useState("");
  const [search, setSearch] = useState("");

  const optionsQuery = usePresencesOptions();
  // Cet écran ne montre que les classes encore en cours ; les terminées vivent
  // sur la page Historique.
  const options = useMemo(
    () => (optionsQuery.data ?? []).filter((o) => o.session_statut !== "termine" && o.session_statut !== "annule"),
    [optionsQuery.data]
  );

  const filiereId = nomKey ? nomKey.split("|")[0] : "";
  const nomClasse = nomKey ? nomKey.split("|").slice(1).join("|") : "";

  const historyQuery = usePresencesHistory({
    filiereId: filiereId || null,
    semestreId: semestreId || undefined,
    statut: "en_cours",
    classeNom: nomClasse || undefined,
  });

  const anneeOptions = useMemo(() => {
    const set = new Set<string>();
    for (const o of options) if (o.annee_scolaire) set.add(o.annee_scolaire);
    return Array.from(set)
      .sort((a, b) => b.localeCompare(a))
      .map((value) => ({ value, label: value }));
  }, [options]);

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

  const visibleSemestres = useMemo(() => {
    const map = new Map<string, any>();
    for (const o of options) {
      if (!o.semestre_id) continue;
      if (annee && o.annee_scolaire !== annee) continue;
      if (nomKey && `${o.classe_id}|${o.nom}` !== nomKey) continue;
      map.set(o.semestre_id, { id: o.semestre_id, libelle: o.semestre_libelle });
    }
    return Array.from(map.values()).sort((a, b) =>
      String(a.libelle).localeCompare(String(b.libelle))
    );
  }, [options, annee, nomKey]);

  // Première année proposée par défaut.
  useEffect(() => {
    if (!annee && anneeOptions.length > 0) setAnnee(anneeOptions[0].value);
  }, [anneeOptions, annee]);

  useEffect(() => {
    if (nomKey && !nomOptions.some((o) => o.value === nomKey)) setNomKey("");
  }, [nomOptions, nomKey]);
  useEffect(() => {
    if (semestreId && !visibleSemestres.some((s) => s.id === semestreId)) setSemestreId("");
  }, [visibleSemestres, semestreId]);

  const seances: any[] = (historyQuery.data as any)?.seances ?? [];
  const students: any[] = (historyQuery.data as any)?.students ?? [];

  const q = search.trim().toLowerCase();
  const filteredStudents = useMemo(
    () =>
      q
        ? students.filter((s) =>
            `${s.first_name} ${s.last_name} ${s.matricule ?? ""}`.toLowerCase().includes(q)
          )
        : students,
    [students, q]
  );
  // Périmètre courant, transmis à la fiche d'un étudiant (filtres de la page).
  const semestreLabel = useMemo(
    () => visibleSemestres.find((s) => s.id === semestreId)?.libelle ?? null,
    [visibleSemestres, semestreId]
  );
  const studentDetailQuery = useMemo(() => {
    const qs = new URLSearchParams({ filiere_id: filiereId });
    if (semestreId) qs.set("semestre_id", semestreId);
    if (semestreLabel) qs.set("semestre", semestreLabel);
    if (nomClasse) qs.set("classe_nom", nomClasse);
    qs.set("statut", "en_cours");
    return qs.toString();
  }, [filiereId, semestreId, semestreLabel, nomClasse]);

  const stats = useMemo(() => {
    const appels = seances.filter((s) => Number(s.nb_marques) > 0);
    const heuresPointees = appels.reduce((sum, s) => sum + Number(s.duree_minutes || 0) / 60, 0);
    const heuresAbsence = students.reduce((sum, s) => sum + Number(s.heures_absence || 0), 0);
    const totalMarques = students.reduce((sum, s) => sum + Number(s.nb_appels || 0), 0);
    const totalPresents = students.reduce((sum, s) => sum + Number(s.nb_present || 0), 0);
    const taux = totalMarques > 0 ? Math.round((totalPresents / totalMarques) * 100) : null;
    return {
      appels: appels.length,
      seances: seances.length,
      heuresPointees,
      heuresAbsence,
      taux,
    };
  }, [seances, students]);

  /**
   * Périmètre exporté : exactement ce que le tableau affiche, filtres compris.
   * La colonne « Détails » n'a pas d'équivalent papier, elle n'est pas reprise.
   */
  const exportContexte = useMemo(
    () => ({
      filiere: nomClasse || "Aucun nom de classe sélectionné",
      annee: annee || "Toutes les années",
      statut: "Classes en cours",
      semestre: semestreLabel ?? "Tous les semestres",
      recherche: search.trim() || undefined,
      stats,
    }),
    [nomClasse, annee, semestreLabel, search, stats]
  );

  return (
    <div className="space-y-6 max-w-[1500px] mx-auto p-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-3xl font-bold bg-gradient-to-r from-indigo-600 to-blue-600 bg-clip-text text-transparent flex items-center gap-2">
            <ClipboardCheck className="h-7 w-7 text-indigo-500" />
            Présences
          </h1>
          <p className="text-muted-foreground mt-2">
            Synthèse des appels effectués : heures d'absence par étudiant, calculées sur la durée
            réelle des cours. « Détails » ouvre toutes les séances d'un étudiant.
          </p>
        </div>
        <div className="flex gap-2 shrink-0">
          <Link href="/professionnel/admin/presences/historique">
            <Button variant="outline" title="Consulter les présences des classes terminées">
              <History className="h-4 w-4 mr-2" />
              Historique
            </Button>
          </Link>
          <ExportButtons
            formats={["pdf"]}
            disabled={historyQuery.isLoading || filteredStudents.length === 0}
            onExportPdf={(win) => openPresencePdf(filteredStudents, exportContexte, win)}
          />
        </div>
      </div>

      {/* Filtres : l'année d'abord, puis le nom de classe, puis le semestre. */}
      <Card className="shadow-sm">
        <CardContent className="p-4 space-y-3">
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
                  ? "Aucun appel enregistré"
                  : "Sélectionner une année"
            }
            searchPlaceholder="Rechercher une année…"
            options={anneeOptions}
          />
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
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
            <SearchableSelect
              value={semestreId}
              onChange={setSemestreId}
              icon={<CalendarRange className="h-4 w-4 text-gray-400" />}
              placeholder={!nomKey ? "Choisir un nom de classe" : "Tous les semestres"}
              options={[
                { value: "", label: "Tous les semestres" },
                ...visibleSemestres.map((sm) => ({ value: sm.id, label: sm.libelle })),
              ]}
            />
          </div>
        </CardContent>
      </Card>

      {/* Contenu */}
      {!filiereId ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center text-center py-16 gap-3">
            <div className="rounded-full bg-indigo-50 p-4">
              <GraduationCap className="h-8 w-8 text-indigo-500" />
            </div>
            <p className="text-muted-foreground max-w-md">
              Choisissez une année puis un nom de classe pour afficher les présences.
              Les classes terminées sont sur la page Historique.
            </p>
          </CardContent>
        </Card>
      ) : historyQuery.isLoading ? (
        <div className="flex justify-center py-16">
          <Loader2 className="h-10 w-10 animate-spin text-indigo-500" />
        </div>
      ) : historyQuery.isError ? (
        <Card className="border-red-200">
          <CardContent className="flex items-center gap-3 py-8 text-red-700">
            <AlertCircle className="h-6 w-6 shrink-0" />
            <p>
              {(historyQuery.error as Error)?.message ?? "Impossible de charger les présences."}
            </p>
          </CardContent>
        </Card>
      ) : (
        <>
          {/* Stats */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <StatCard
              label="Appels effectués"
              value={`${stats.appels}/${stats.seances}`}
              hint="séances pointées / planifiées"
              color="from-indigo-500 to-blue-600"
            />
            <StatCard
              label="Heures pointées"
              value={fmtHeures(stats.heuresPointees)}
              hint="volume de cours avec appel"
              color="from-emerald-500 to-green-600"
            />
            <StatCard
              label="Heures d'absence"
              value={fmtHeures(stats.heuresAbsence)}
              hint="cumul de tous les étudiants"
              color="from-red-500 to-rose-600"
            />
            <StatCard
              label="Taux de présence"
              value={stats.taux == null ? "—" : `${stats.taux}%`}
              hint="présents / pointages"
              color="from-amber-500 to-orange-600"
            />
          </div>

          {/* Recherche */}
          <div className="relative max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Rechercher un étudiant, une matière, un enseignant…"
              className="pl-9"
            />
          </div>

          {/* Récapitulatif par étudiant */}
          <Card className="shadow-sm overflow-hidden">
            <div className="flex items-center gap-2 border-b border-border bg-muted/40 px-4 py-3">
              <UserRound className="h-4 w-4 text-indigo-500 shrink-0" />
              <span className="font-semibold">Récapitulatif par étudiant</span>
              <span className="text-xs text-muted-foreground">
                · heures d'absence calculées sur la durée réelle des séances · « Détails » ouvre
                toutes les séances de l'étudiant
                {semestreLabel ? ` pour ${semestreLabel}` : ""}
              </span>
            </div>
            <CardContent className="p-0 overflow-auto max-h-[60vh]">
              {filteredStudents.length === 0 ? (
                <p className="py-10 text-center text-muted-foreground text-sm">
                  Aucun pointage enregistré pour cette sélection.
                </p>
              ) : (
                <table className="min-w-full text-sm border-collapse">
                  <thead>
                    <tr className="bg-muted/50 border-b border-border text-left text-muted-foreground">
                      <th className="sticky top-0 z-10 bg-muted/50 px-4 py-3 font-medium">Étudiant</th>
                      <th className="sticky top-0 z-10 bg-muted/50 px-3 py-3 font-medium text-center">Pointages</th>
                      <th className="sticky top-0 z-10 bg-muted/50 px-3 py-3 font-medium text-center">Présent</th>
                      <th className="sticky top-0 z-10 bg-muted/50 px-3 py-3 font-medium text-center">Absent</th>
                      <th className="sticky top-0 z-10 bg-muted/50 px-3 py-3 font-medium text-center">Retard</th>
                      <th className="sticky top-0 z-10 bg-muted/50 px-3 py-3 font-medium text-center">Excusé</th>
                      <th className="sticky top-0 z-10 bg-muted/50 px-3 py-3 font-medium text-center">
                        Heures d'absence
                      </th>
                      <th className="sticky top-0 z-10 bg-muted/50 px-3 py-3 font-medium text-center">
                        Taux de présence
                      </th>
                      <th className="sticky top-0 z-10 bg-muted/50 px-4 py-3 font-medium text-right">
                        Détails
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredStudents.map((s) => {
                      const taux =
                        Number(s.nb_appels) > 0
                          ? Math.round((Number(s.nb_present) / Number(s.nb_appels)) * 100)
                          : null;
                      return (
                        <tr
                          key={s.student_id}
                          className="border-b border-border/60 last:border-0 hover:bg-muted/20"
                        >
                          <td className="px-4 py-2.5 whitespace-nowrap">
                            <span className="font-medium">
                              {s.first_name} {s.last_name}
                            </span>
                            {s.matricule && (
                              <span className="ml-2 font-mono text-xs text-muted-foreground">
                                {s.matricule}
                              </span>
                            )}
                          </td>
                          <td className="px-3 py-2.5 text-center font-mono">{s.nb_appels}</td>
                          <td className="px-3 py-2.5 text-center font-mono text-green-600">
                            {s.nb_present}
                          </td>
                          <td className="px-3 py-2.5 text-center font-mono text-red-600">
                            {s.nb_absent}
                          </td>
                          <td className="px-3 py-2.5 text-center font-mono text-amber-600">
                            {s.nb_retard}
                          </td>
                          <td className="px-3 py-2.5 text-center font-mono text-blue-600">
                            {s.nb_excuse}
                          </td>
                          <td className="px-3 py-2.5 text-center">
                            <span
                              className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold ${
                                Number(s.heures_absence) > 0
                                  ? "bg-red-100 text-red-700"
                                  : "bg-green-100 text-green-700"
                              }`}
                              title={
                                Number(s.heures_excusees) > 0
                                  ? `+ ${fmtHeures(s.heures_excusees)} excusées`
                                  : undefined
                              }
                            >
                              <Clock className="h-3 w-3" />
                              {fmtHeures(s.heures_absence)}
                            </span>
                          </td>
                          <td className="px-3 py-2.5 text-center">
                            {taux == null ? (
                              <span className="text-muted-foreground">—</span>
                            ) : (
                              <span
                                className={`font-mono font-semibold ${
                                  taux >= 80
                                    ? "text-green-600"
                                    : taux >= 60
                                    ? "text-amber-600"
                                    : "text-red-600"
                                }`}
                              >
                                {taux}%
                              </span>
                            )}
                          </td>
                          <td className="px-4 py-2.5 text-right">
                            <Link
                              href={`/professionnel/admin/presences/etudiant/${s.student_id}?${studentDetailQuery}`}
                              className="inline-flex items-center gap-1.5 rounded-md border border-indigo-200 bg-indigo-50 px-2.5 py-1 text-xs font-medium text-indigo-700 hover:bg-indigo-100"
                            >
                              <Eye className="h-3.5 w-3.5" />
                              Détails
                            </Link>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}

function StatCard({
  label,
  value,
  hint,
  color,
}: {
  label: string;
  value: string | number;
  hint: string;
  color: string;
}) {
  return (
    <div className={`rounded-xl p-4 text-white bg-gradient-to-br ${color} shadow`}>
      <p className="text-white/80 text-sm font-medium">{label}</p>
      <p className="text-3xl font-bold mt-1">{value}</p>
      <p className="text-white/70 text-xs mt-0.5">{hint}</p>
    </div>
  );
}
