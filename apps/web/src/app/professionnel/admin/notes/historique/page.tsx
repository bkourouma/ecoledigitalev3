"use client";

import { Fragment, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Card, CardContent, Button } from "@ecoledigitale/ui";
import {
  Layers,
  CalendarRange,
  Calendar,
  BookOpen,
  GraduationCap,
  Loader2,
  History,
  ArrowLeft,
  RotateCcw,
  Smile,
} from "lucide-react";
import { SearchableSelect } from "@/components/SearchableSelect";
import {
  useNotesFilieres,
  useNotesSemestres,
  useSemestreSessions,
  useSessionGrid,
  useSemestreConduite,
} from "@/lib/hooks/use-professional-bulletins";

/**
 * Historique des notes — Module Professionnel (admin).
 *
 * Consultation des notes saisies sur les cohortes TERMINÉES. La page de saisie
 * (`/professionnel/admin/notes`) ne montre au contraire que les cohortes encore
 * ouvertes ; c'est ici, et seulement ici, qu'on filtre par année scolaire,
 * puisque l'historique s'étale sur plusieurs années.
 *
 * Page STRICTEMENT en lecture seule : aucune note n'est modifiable ici, pas même
 * l'examen de Session 2 (rattrapage). La colonne Conduite est également affichée
 * en lecture, sa saisie restant sur la page dédiée
 * `/professionnel/admin/conduite`.
 */

const ECUE_STATUT: Record<string, { label: string; cls: string }> = {
  valide: { label: "Validé", cls: "bg-green-100 text-green-700" },
  compense: { label: "Compensé", cls: "bg-blue-100 text-blue-700" },
  insuffisant: { label: "Insuffisant", cls: "bg-amber-100 text-amber-700" },
  eliminatoire: { label: "Éliminatoire", cls: "bg-red-100 text-red-700" },
  en_cours: { label: "En attente", cls: "bg-gray-100 text-gray-600" },
};

function fmt(x: number | null | undefined): string {
  return x == null ? "—" : Number(x).toFixed(2).replace(".", ",");
}

/**
 * Année scolaire (pivot septembre) dérivée de la date de début du semestre,
 * alignée sur le calcul côté API (professional-bulletin.service.ts) et sur les
 * autres pages : un semestre démarrant en septembre ou après appartient à
 * « AAAA-AAAA+1 », sinon « AAAA-1-AAAA ».
 */
function anneeScolaireOf(v?: string | null): string | null {
  if (!v) return null;
  const d = new Date(v);
  if (isNaN(d.getTime())) return null;
  const y = d.getFullYear();
  return d.getMonth() + 1 >= 9 ? `${y}-${y + 1}` : `${y - 1}-${y}`;
}

export default function NotesHistoriquePage() {
  const [filiereId, setFiliereId] = useState("");
  const [annee, setAnnee] = useState("all");
  const [semestreId, setSemestreId] = useState("");
  const [sessionId, setSessionId] = useState("");

  // Portée « terminees » : seules les filières et semestres ayant au moins une
  // cohorte terminée ou annulée remontent ici.
  const filieresQuery = useNotesFilieres("terminees");
  const semestresQuery = useNotesSemestres(filiereId || null, "terminees");
  const sessionsQuery = useSemestreSessions(semestreId || null);
  const gridQuery = useSessionGrid(sessionId || null);
  // Conduite du semestre : saisie sur la page dédiée, affichée ici en lecture.
  const conduiteQuery = useSemestreConduite(semestreId || null);

  const filieres: any[] = (filieresQuery.data as any[]) ?? [];

  const semestres: any[] = useMemo(() => {
    const list = (semestresQuery.data as any[]) ?? [];
    return filiereId
      ? list.map((s) => ({ ...s, annee_scolaire: anneeScolaireOf(s.date_debut) }))
      : [];
  }, [semestresQuery.data, filiereId]);

  // Années scolaires disponibles pour la filière (plus récentes en premier).
  const anneeOptions = useMemo(() => {
    const set = new Set<string>();
    for (const s of semestres) if (s.annee_scolaire) set.add(s.annee_scolaire);
    return Array.from(set)
      .sort((a, b) => b.localeCompare(a))
      .map((value) => ({ value, label: value }));
  }, [semestres]);

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
    if (semestreId && !visibleSemestres.some((s) => s.id === semestreId)) {
      setSemestreId("");
      setSessionId("");
    }
  }, [visibleSemestres, semestreId]);

  // UE du semestre : hors « Conduite », sans inscrit, et UNIQUEMENT les cohortes
  // terminées ou annulées — c'est la contrepartie exacte de la page de saisie.
  const sessions: any[] = ((sessionsQuery.data as any[]) ?? [])
    .filter((s) => !String(s.ue_libelle ?? "").toLowerCase().startsWith("conduite"))
    .filter((s) => Number(s.nb_inscrits ?? 0) > 0)
    .filter((s) => ["termine", "annule"].includes(String(s.statut ?? "")));

  const grid: any = gridQuery.data ?? null;
  const ecues: any[] = grid?.ecues ?? [];
  const students: any[] = grid?.students ?? [];

  function resultOf(eid: string, sid: string) {
    return grid?.results?.find((r: any) => r.ecue_id === eid && r.student_id === sid) ?? null;
  }
  function devoirsOf(eid: string, sid: string) {
    return (grid?.notes ?? []).filter(
      (n: any) => n.ecue_id === eid && n.student_id === sid && n.nature === "devoir"
    );
  }
  /** Notes d'examen d'un couple (ECUE, étudiant), toutes sessions confondues. */
  function examensOf(eid: string, sid: string) {
    return (grid?.notes ?? []).filter(
      (n: any) => n.ecue_id === eid && n.student_id === sid && n.nature === "examen"
    );
  }
  /** Note d'examen retenue : celle de la Session 2 prime sur la Session 1. */
  function examenOf(eid: string, sid: string) {
    const exams = examensOf(eid, sid);
    if (exams.length === 0) return null;
    return exams.reduce((a: any, b: any) => ((b.session ?? 1) > (a.session ?? 1) ? b : a));
  }
  // Conduite du semestre : ECUE dédiée + note par étudiant.
  const conduite: any = (conduiteQuery.data as any) ?? null;
  const conduiteNotes = useMemo(() => {
    const m = new Map<string, number | null>();
    for (const s of conduite?.students ?? []) m.set(String(s.student_id), s.note ?? null);
    return m;
  }, [conduite]);
  const hasConduite = Boolean(conduite?.conduite);

  return (
    <div className="space-y-6 max-w-7xl mx-auto p-6">
      {/* En-tête */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-3xl font-bold bg-gradient-to-r from-indigo-600 to-blue-600 bg-clip-text text-transparent flex items-center gap-2">
            <History className="h-7 w-7 text-indigo-500" />
            Historique des notes
          </h1>
          <p className="text-muted-foreground mt-2">
            Notes déjà saisies sur les sessions terminées — consultation seule.
          </p>
        </div>
        <div className="flex gap-2">
          <Link href="/professionnel/admin/notes/rattrapages">
            <Button
              variant="outline"
              title="Saisir les examens de Session 2 des étudiants non validés"
            >
              <RotateCcw className="h-4 w-4 mr-2" />
              Rattrapages
            </Button>
          </Link>
          <Link href="/professionnel/admin/notes">
            <Button variant="outline">
              <ArrowLeft className="h-4 w-4 mr-2" />
              Retour à la saisie
            </Button>
          </Link>
        </div>
      </div>

      {/* Sélecteurs — filière, année scolaire, semestre, UE */}
      <Card className="shadow-sm">
        <CardContent className="p-4">
          {/* Filtres deux par deux : filière + année, puis semestre + UE. */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <SearchableSelect
              value={filiereId}
              onChange={(v) => {
                setFiliereId(v);
                setAnnee("all");
                setSemestreId("");
                setSessionId("");
              }}
              icon={<Layers className="h-4 w-4 text-gray-400" />}
              placeholder={
                filieresQuery.isLoading
                  ? "Chargement…"
                  : filieres.length === 0
                  ? "Aucune session terminée"
                  : "Filière"
              }
              searchPlaceholder="Rechercher une filière…"
              options={filieres.map((f) => ({
                value: f.id,
                label: `${f.name}${f.code ? ` (${f.code})` : ""}`,
              }))}
            />
            <SearchableSelect
              value={annee}
              onChange={setAnnee}
              icon={<Calendar className="h-4 w-4 text-gray-400" />}
              placeholder={!filiereId ? "Choisir une filière" : "Toutes les années"}
              searchPlaceholder="Rechercher une année…"
              options={[{ value: "all", label: "Toutes les années" }, ...anneeOptions]}
            />
            <SearchableSelect
              value={semestreId}
              onChange={(v) => {
                setSemestreId(v);
                setSessionId("");
              }}
              icon={<CalendarRange className="h-4 w-4 text-gray-400" />}
              placeholder={!filiereId ? "Choisir une filière" : "Semestre"}
              searchPlaceholder="Rechercher un semestre…"
              options={visibleSemestres.map((s) => ({ value: s.id, label: s.libelle }))}
            />
            <SearchableSelect
              value={sessionId}
              onChange={setSessionId}
              icon={<BookOpen className="h-4 w-4 text-gray-400" />}
              placeholder={
                !semestreId
                  ? "Choisir un semestre"
                  : sessionsQuery.isLoading
                  ? "Chargement…"
                  : sessions.length === 0
                  ? "Aucune UE terminée"
                  : "UE"
              }
              searchPlaceholder="Rechercher une UE…"
              options={sessions.map((s) => ({
                value: s.id,
                label: `${s.ue_libelle ?? ""}${s.ue_code ? ` (${s.ue_code})` : ""}`.trim(),
              }))}
            />
          </div>
        </CardContent>
      </Card>

      {/* Grille en lecture seule */}
      {!sessionId ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center text-center py-16 gap-3">
            <div className="rounded-full bg-indigo-50 p-4">
              <GraduationCap className="h-8 w-8 text-indigo-500" />
            </div>
            <p className="text-muted-foreground max-w-md">
              Choisissez une filière, un semestre puis une UE pour consulter les notes déjà
              saisies.
            </p>
          </CardContent>
        </Card>
      ) : gridQuery.isLoading ? (
        <div className="flex justify-center py-16">
          <Loader2 className="h-10 w-10 animate-spin text-indigo-500" />
        </div>
      ) : students.length === 0 ? (
        <Card>
          <CardContent className="py-16 text-center text-muted-foreground">
            Aucun étudiant inscrit (confirmé) dans cette UE.
          </CardContent>
        </Card>
      ) : ecues.length === 0 ? (
        <Card>
          <CardContent className="py-16 text-center text-muted-foreground">
            Cette UE n&apos;a pas d&apos;ECUE (hors Conduite).
          </CardContent>
        </Card>
      ) : (
        <>
          <Card className="shadow-sm">
            <div className="flex items-center gap-2 border-b border-border bg-muted/40 px-4 py-3">
              <BookOpen className="h-4 w-4 text-indigo-500 shrink-0" />
              <span className="font-semibold">
                {grid?.session?.ue_libelle ?? "Unité d'enseignement"}
              </span>
              <span className="text-xs text-muted-foreground whitespace-nowrap">
                · {ecues.length} ECUE · {students.length} étudiant
                {students.length > 1 ? "s" : ""} · session terminée
              </span>
            </div>
            <CardContent className="p-0 overflow-x-auto">
              <table className="min-w-full text-[15px] border-collapse">
                <thead>
                  <tr className="bg-muted/60 border-b border-border">
                    <th
                      rowSpan={2}
                      className="sticky left-0 top-0 z-30 bg-muted/60 px-5 py-3 text-left font-medium border-r border-border whitespace-nowrap"
                    >
                      Étudiant
                    </th>
                    {ecues.map((e) => (
                      <th
                        key={e.ecue_id}
                        colSpan={3}
                        className="sticky top-0 z-20 h-14 bg-muted/60 px-4 py-3 text-center font-semibold border-r border-border whitespace-nowrap"
                      >
                        {e.libelle ?? e.code}
                      </th>
                    ))}
                    {hasConduite && (
                      <th
                        rowSpan={2}
                        className="sticky top-0 z-20 bg-muted/60 px-4 py-3 text-center font-semibold whitespace-nowrap"
                      >
                        <span className="inline-flex items-center gap-1.5">
                          <Smile className="h-4 w-4 text-rose-500" />
                          Conduite (/20)
                        </span>
                      </th>
                    )}
                  </tr>
                  <tr className="bg-muted/40 border-b border-border text-xs text-muted-foreground">
                    {ecues.map((e) => (
                      <Fragment key={e.ecue_id}>
                        <th className="sticky top-14 z-20 bg-muted/40 px-4 py-2.5 font-medium whitespace-nowrap">
                          Devoirs (/20)
                        </th>
                        <th className="sticky top-14 z-20 bg-muted/40 px-4 py-2.5 font-medium whitespace-nowrap">
                          Examen (/20)
                        </th>
                        <th className="sticky top-14 z-20 bg-muted/40 px-4 py-2.5 font-medium text-center border-r border-border whitespace-nowrap">
                          Note
                        </th>
                      </Fragment>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {students.map((s) => (
                    <tr
                      key={s.student_id}
                      className="border-b border-border/60 align-middle hover:bg-muted/20"
                    >
                      <td className="sticky left-0 z-10 bg-background px-5 py-3 border-r border-border whitespace-nowrap">
                        <span className="font-medium">
                          {s.first_name} {s.last_name}
                        </span>
                      </td>
                      {ecues.map((e) => {
                        const devoirs = devoirsOf(e.ecue_id, s.student_id);
                        const examen = examenOf(e.ecue_id, s.student_id);
                        const result = resultOf(e.ecue_id, s.student_id);
                        const statutKey = result
                          ? result.eliminee
                            ? "eliminatoire"
                            : result.validee === true
                            ? "valide"
                            : result.validee === false
                            ? "insuffisant"
                            : "en_cours"
                          : "en_cours";
                        const statut = ECUE_STATUT[statutKey] ?? ECUE_STATUT.en_cours;
                        return (
                          <Fragment key={e.ecue_id}>
                            <td className="px-4 py-3 align-middle whitespace-nowrap">
                              {devoirs.length === 0 ? (
                                <span className="text-muted-foreground">—</span>
                              ) : (
                                <span className="font-mono">
                                  {devoirs
                                    .map((d: any) => fmt(d.note))
                                    .join(" · ")}
                                </span>
                              )}
                            </td>
                            <td className="px-4 py-3 align-middle whitespace-nowrap font-mono">
                              {examen ? (
                                <>
                                  {fmt(examen.note)}
                                  {(examen.session ?? 1) === 2 && (
                                    <span className="ml-1.5 rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-700">
                                      S2
                                    </span>
                                  )}
                                </>
                              ) : (
                                <span className="text-muted-foreground">—</span>
                              )}
                            </td>
                            <td className="px-4 py-3 text-center border-r border-border align-middle whitespace-nowrap">
                              <span
                                className={`inline-block rounded px-2.5 py-1 text-sm font-mono font-semibold ${statut.cls}`}
                                title={statut.label}
                              >
                                {fmt(result?.moyenne)}
                              </span>
                            </td>
                          </Fragment>
                        );
                      })}
                      {hasConduite &&
                        (() => {
                          const note = conduiteNotes.get(String(s.student_id)) ?? null;
                          return (
                            <td className="px-4 py-3 text-center align-middle whitespace-nowrap">
                              {note == null ? (
                                <span className="text-muted-foreground">—</span>
                              ) : (
                                <span
                                  className={`inline-block rounded px-2.5 py-1 text-sm font-mono font-semibold ${
                                    note >= 10
                                      ? "bg-green-100 text-green-700"
                                      : "bg-amber-100 text-amber-700"
                                  }`}
                                >
                                  {fmt(note)}
                                </span>
                              )}
                            </td>
                          );
                        })()}
                    </tr>
                  ))}
                </tbody>
              </table>
            </CardContent>
          </Card>

          <p className="text-xs text-muted-foreground">
            Les notes des sessions terminées ne sont plus modifiables : cette page est en{" "}
            <strong>consultation seule</strong>. La saisie se fait sur la page{" "}
            <Link
              href="/professionnel/admin/notes"
              className="font-medium underline underline-offset-2"
            >
              Notes
            </Link>
            , qui ne propose que les sessions encore ouvertes. Le badge{" "}
            <span className="rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-700">
              S2
            </span>{" "}
            signale une note d&apos;examen issue du rattrapage.
            {hasConduite && (
              <>
                {" "}
                La colonne <strong>Conduite</strong> reprend la note du semestre saisie sur la page{" "}
                <Link
                  href="/professionnel/admin/conduite"
                  className="font-medium underline underline-offset-2"
                >
                  Conduite
                </Link>
                .
              </>
            )}
          </p>
        </>
      )}
    </div>
  );
}
