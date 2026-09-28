"use client";

import { Fragment, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSession } from "next-auth/react";
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
import { ExportButtons } from "@/components/ExportButtons";
import { openNotesReportPdf } from "@/lib/utils/notes-report";
import {
  useNotesNoms,
  useSemestreSessions,
  useSessionGrids,
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
 * Le semestre est la maille d'affichage : dès qu'il est choisi, TOUTES ses UE
 * terminées sont rendues dans UNE SEULE grille, côte à côte — une section de
 * colonnes par UE, la conduite fermant la marche à droite. Il n'y a donc pas de
 * sélecteur d'UE. La grille étant large, elle défile horizontalement, la colonne
 * « Étudiant » restant collée à gauche.
 *
 * Page STRICTEMENT en lecture seule : aucune note n'est modifiable ici, pas même
 * l'examen de Session 2 (rattrapage). La conduite est également affichée en
 * lecture, sa saisie restant sur la page dédiée
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

/** Séparateur vertical entre deux sections d'UE. */
const UE_SEP = "border-l-2 border-border";

export default function NotesHistoriquePage() {
  // L'année commande la liste des noms, qui commande celle des semestres.
  const [annee, setAnnee] = useState("");
  const [nomKey, setNomKey] = useState("");
  const [semestreId, setSemestreId] = useState("");
  const [exportErreur, setExportErreur] = useState<string | null>(null);

  const { data: session } = useSession();
  const roles = ((session as any)?.roles ?? []) as string[];
  const isAdmin =
    Array.isArray(roles) && roles.some((r) => ["admin", "super_admin", "Administrateur"].includes(r));

  // Portée « terminees » : seules les classes ayant au moins une cohorte
  // terminée ou annulée remontent ici.
  const nomsQuery = useNotesNoms("terminees");
  const filiereId = nomKey ? nomKey.split("|")[0] : "";
  const sessionsQuery = useSemestreSessions(semestreId || null);
  // Conduite du semestre : saisie sur la page dédiée, affichée ici en lecture.
  // Réservée aux administrateurs — la route la refuse aux enseignants, on ne
  // la demande donc pas pour eux.
  const conduiteQuery = useSemestreConduite(isAdmin && semestreId ? semestreId : null);

  const options = useMemo(() => nomsQuery.data ?? [], [nomsQuery.data]);

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
    return Array.from(map.entries()).map(([value, label]) => ({ value, label }));
  }, [options, annee]);

  // Semestres du couple (année, nom).
  const visibleSemestres = useMemo(() => {
    const map = new Map<string, any>();
    for (const o of options) {
      if (!o.semestre_id) continue;
      if (annee && o.annee_scolaire !== annee) continue;
      if (nomKey && `${o.classe_id}|${o.nom}` !== nomKey) continue;
      map.set(o.semestre_id, {
        id: o.semestre_id,
        libelle: o.semestre_libelle,
        annee_scolaire: o.annee_scolaire,
      });
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

  // Si le semestre sélectionné n'est plus visible (filtre année), on le désélectionne.
  useEffect(() => {
    if (semestreId && !visibleSemestres.some((s) => s.id === semestreId)) setSemestreId("");
  }, [visibleSemestres, semestreId]);

  // UE du semestre : hors « Conduite » (colonne à part, tout à droite), sans
  // inscrit, et UNIQUEMENT les cohortes terminées ou annulées — c'est la
  // contrepartie exacte de la page de saisie.
  const sessions: any[] = useMemo(
    () =>
      ((sessionsQuery.data as any[]) ?? [])
        .filter((s) => !String(s.ue_libelle ?? "").toLowerCase().startsWith("conduite"))
        .filter((s) => Number(s.nb_inscrits ?? 0) > 0)
        .filter((s) => ["termine", "annule"].includes(String(s.statut ?? ""))),
    [sessionsQuery.data]
  );

  // Une grille par UE, chargées en parallèle (clés de cache partagées avec la
  // page de saisie). L'ordre suit exactement celui de `sessions`.
  const gridQueries = useSessionGrids(sessions.map((s) => s.id));
  const gridsLoading = gridQueries.some((q) => q.isLoading);

  // Conduite du semestre : ECUE dédiée + note par étudiant.
  const conduite: any = (conduiteQuery.data as any) ?? null;
  const conduiteStudents: any[] = conduite?.students ?? [];
  const hasConduite = isAdmin && Boolean(conduite?.conduite) && conduiteStudents.length > 0;
  const conduiteNotes = useMemo(() => {
    const m = new Map<string, number | null>();
    for (const s of conduiteStudents) m.set(String(s.student_id), s.note ?? null);
    return m;
  }, [conduiteStudents]);

  /**
   * Un bloc de colonnes par UE : ses ECUE et ses notes indexées par couple
   * (ECUE, étudiant), pour que le rendu d'une cellule reste en O(1) malgré le
   * nombre d'UE affichées d'un coup.
   */
  const blocks = sessions
    .map((session, i) => {
      const grid: any = gridQueries[i]?.data ?? null;
      const ecues: any[] = grid?.ecues ?? [];

      const results = new Map<string, any>();
      for (const r of grid?.results ?? []) results.set(`${r.ecue_id}|${r.student_id}`, r);

      const devoirs = new Map<string, any[]>();
      const examens = new Map<string, any>();
      for (const n of grid?.notes ?? []) {
        const key = `${n.ecue_id}|${n.student_id}`;
        if (n.nature === "devoir") {
          const list = devoirs.get(key);
          if (list) list.push(n);
          else devoirs.set(key, [n]);
        } else if (n.nature === "examen") {
          // La note de Session 2 prime sur celle de la Session 1.
          const prev = examens.get(key);
          if (!prev || (n.session ?? 1) > (prev.session ?? 1)) examens.set(key, n);
        }
      }

      // Inscrits de CETTE cohorte : un étudiant absent de la liste n'a pas
      // suivi l'UE, ses cellules restent vides plutôt que de valoir zéro.
      const enrolled = new Set<string>(
        (grid?.students ?? []).map((s: any) => String(s.student_id))
      );

      return {
        id: session.id,
        libelle: grid?.session?.ue_libelle ?? session.ue_libelle ?? "UE",
        code: grid?.session?.ue_code ?? session.ue_code ?? null,
        ecues,
        results,
        devoirs,
        examens,
        enrolled,
        students: (grid?.students ?? []) as any[],
      };
    })
    .filter((b) => b.ecues.length > 0);

  /**
   * Cohorte affichée : union des inscrits de toutes les UE du semestre, plus
   * les étudiants n'ayant qu'une conduite. Une ligne par étudiant, quelle que
   * soit la ou les UE qu'il a suivies.
   */
  const students = (() => {
    const m = new Map<string, any>();
    for (const b of blocks) {
      for (const s of b.students) if (!m.has(String(s.student_id))) m.set(String(s.student_id), s);
    }
    for (const s of conduiteStudents) {
      if (!m.has(String(s.student_id))) m.set(String(s.student_id), s);
    }
    return Array.from(m.values()).sort((a, b) =>
      `${a.last_name ?? ""} ${a.first_name ?? ""}`.localeCompare(
        `${b.last_name ?? ""} ${b.first_name ?? ""}`,
        "fr"
      )
    );
  })();

  const semestreLabel = visibleSemestres.find((s) => s.id === semestreId)?.libelle ?? "Semestre";

  /**
   * Périmètre exporté : toutes les UE terminées du semestre choisi — c'est
   * exactement ce que la page affiche, il n'y a pas de sélecteur d'UE ici. Les
   * grilles déjà chargées sont transmises telles quelles : inutile de les
   * redemander à l'API.
   */
  const exportContexte = useMemo(
    () => ({
      filiere: nomOptions.find((o) => o.value === nomKey)?.label ?? "—",
      semestre: semestreLabel,
      annee:
        annee ||
        (visibleSemestres.find((s) => s.id === semestreId)?.annee_scolaire ?? "—"),
      sessions,
      grilles: gridQueries.map((q) => q.data ?? null),
      conduite: conduiteStudents,
    }),
    [
      nomOptions,
      nomKey,
      filiereId,
      semestreLabel,
      annee,
      visibleSemestres,
      semestreId,
      sessions,
      gridQueries,
      conduiteStudents,
    ]
  );

  /**
   * Le document est complet : toutes les UE terminées du semestre, toutes les
   * colonnes de notes et le tableau de conduite.
   */
  async function exporterPdf(win: Window) {
    setExportErreur(null);
    await openNotesReportPdf(exportContexte, win);
  }

  return (
    <div className="space-y-6 max-w-[1600px] mx-auto p-6">
      {/* En-tête */}
      <div className="mb-6 flex max-w-full flex-col items-start gap-2 overflow-x-auto md:mb-8 md:gap-3">
        <div>
          <h1 className="whitespace-nowrap font-bold bg-gradient-to-r from-indigo-600 to-blue-600 bg-clip-text text-transparent flex items-center gap-2 text-2xl leading-tight md:text-3xl">
            <History className="h-7 w-7 text-indigo-500" />
            Historique des notes
          </h1>
          <p className="whitespace-nowrap text-muted-foreground text-sm md:text-base">
            Toutes les UE terminées du semestre dans une seule grille — consultation seule.
          </p>
        </div>
        <div className="flex gap-2">
          <ExportButtons
            formats={["pdf"]}
            disabled={!semestreId || gridsLoading || students.length === 0}
            onExportPdf={exporterPdf}
            onError={setExportErreur}
          />
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

      {exportErreur && (
        <div className="rounded-md border border-red-300 bg-red-50 px-4 py-2 text-sm text-red-700">
          {exportErreur}
        </div>
      )}

      {/* Sélecteurs — filière, année scolaire, semestre (l'UE n'en est plus un) */}
      <Card className="shadow-sm">
        <CardContent className="p-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <SearchableSelect
              className="md:col-span-2"
              value={annee}
              onChange={(v) => {
                setAnnee(v);
                setNomKey("");
                setSemestreId("");
              }}
              icon={<Calendar className="h-4 w-4 text-gray-400" />}
              placeholder={nomsQuery.isLoading ? "Chargement…" : "Année scolaire"}
              searchPlaceholder="Rechercher une année…"
              options={anneeOptions}
            />
            <SearchableSelect
              value={nomKey}
              onChange={(v) => {
                setNomKey(v);
                setSemestreId("");
              }}
              icon={<Layers className="h-4 w-4 text-gray-400" />}
              disabled={!annee}
              placeholder="Nom de classe"
              searchPlaceholder="Rechercher un nom de classe…"
              options={nomOptions}
            />
            <SearchableSelect
              value={semestreId}
              onChange={setSemestreId}
              icon={<CalendarRange className="h-4 w-4 text-gray-400" />}
              disabled={!nomKey}
              placeholder="Semestre"
              searchPlaceholder="Rechercher un semestre…"
              options={visibleSemestres.map((sm) => ({ value: sm.id, label: sm.libelle }))}
            />
          </div>
        </CardContent>
      </Card>

      {/* Grille unique en lecture seule : toutes les UE côte à côte */}
      {!semestreId ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center text-center py-16 gap-3">
            <div className="rounded-full bg-indigo-50 p-4">
              <GraduationCap className="h-8 w-8 text-indigo-500" />
            </div>
            <p className="text-muted-foreground max-w-md">
              Choisissez une classe puis un semestre pour consulter les notes de toutes ses UE.
            </p>
          </CardContent>
        </Card>
      ) : sessionsQuery.isLoading || gridsLoading ? (
        <div className="flex justify-center py-16">
          <Loader2 className="h-10 w-10 animate-spin text-indigo-500" />
        </div>
      ) : blocks.length === 0 && !hasConduite ? (
        <Card>
          <CardContent className="py-16 text-center text-muted-foreground">
            Aucune UE terminée sur ce semestre.
          </CardContent>
        </Card>
      ) : students.length === 0 ? (
        <Card>
          <CardContent className="py-16 text-center text-muted-foreground">
            Aucun étudiant inscrit (confirmé) sur ce semestre.
          </CardContent>
        </Card>
      ) : (
        <>
          <Card className="shadow-sm">
            <div className="flex items-center gap-2 border-b border-border bg-muted/40 px-4 py-3">
              <BookOpen className="h-4 w-4 text-indigo-500 shrink-0" />
              <span className="font-semibold">{semestreLabel}</span>
              <span className="text-xs text-muted-foreground whitespace-nowrap">
                · {blocks.length} UE · {students.length} étudiant
                {students.length > 1 ? "s" : ""}
                {hasConduite ? " · conduite incluse" : ""}
              </span>
            </div>
            <CardContent className="p-0 overflow-x-auto">
              <table className="min-w-full text-[15px] border-collapse">
                <thead>
                  {/* Rangée 1 — une section par UE */}
                  <tr className="bg-muted/70 border-b border-border">
                    <th
                      rowSpan={3}
                      className="sticky left-0 z-20 bg-muted/70 px-5 py-3 text-left font-medium border-r-2 border-border whitespace-nowrap"
                    >
                      Étudiant
                    </th>
                    {blocks.map((b) => (
                      <th
                        key={b.id}
                        colSpan={b.ecues.length * 3}
                        className={`px-4 py-3 text-center font-bold text-indigo-700 whitespace-nowrap ${UE_SEP}`}
                        title={b.libelle}
                      >
                        {b.libelle}
                        {b.code ? ` (${b.code})` : ""}
                      </th>
                    ))}
                    {hasConduite && (
                      <th
                        rowSpan={3}
                        className={`px-4 py-3 text-center font-bold text-rose-700 whitespace-nowrap ${UE_SEP}`}
                      >
                        <span className="inline-flex items-center gap-1.5">
                          <Smile className="h-4 w-4 text-rose-500" />
                          Conduite (/20)
                        </span>
                      </th>
                    )}
                  </tr>
                  {/* Rangée 2 — les ECUE de chaque UE */}
                  <tr className="bg-muted/60 border-b border-border">
                    {blocks.map((b) =>
                      b.ecues.map((e: any, i: number) => (
                        <th
                          key={`${b.id}|${e.ecue_id}`}
                          colSpan={3}
                          className={`px-4 py-2.5 text-center font-semibold whitespace-nowrap ${
                            i === 0 ? UE_SEP : "border-l border-border"
                          }`}
                        >
                          {e.libelle ?? e.code}
                        </th>
                      ))
                    )}
                  </tr>
                  {/* Rangée 3 — devoirs / examen / note, par ECUE */}
                  <tr className="bg-muted/40 border-b border-border text-xs text-muted-foreground">
                    {blocks.map((b) =>
                      b.ecues.map((e: any, i: number) => (
                        <Fragment key={`${b.id}|${e.ecue_id}`}>
                          <th
                            className={`px-4 py-2.5 font-medium whitespace-nowrap ${
                              i === 0 ? UE_SEP : "border-l border-border"
                            }`}
                          >
                            Devoirs (/20)
                          </th>
                          <th className="px-4 py-2.5 font-medium whitespace-nowrap">
                            Examen (/20)
                          </th>
                          <th className="px-4 py-2.5 font-medium text-center whitespace-nowrap">
                            Note
                          </th>
                        </Fragment>
                      ))
                    )}
                  </tr>
                </thead>
                <tbody>
                  {students.map((s) => {
                    const sid = String(s.student_id);
                    return (
                      <tr
                        key={sid}
                        className="border-b border-border/60 align-middle hover:bg-muted/20"
                      >
                        <td className="sticky left-0 z-10 bg-background px-5 py-3 border-r-2 border-border whitespace-nowrap">
                          <span className="font-medium">
                            {s.first_name} {s.last_name}
                          </span>
                        </td>
                        {blocks.map((b) => {
                          const inscrit = b.enrolled.has(sid);
                          return b.ecues.map((e: any, i: number) => {
                            const key = `${e.ecue_id}|${sid}`;
                            const devoirs = b.devoirs.get(key) ?? [];
                            const examen = b.examens.get(key) ?? null;
                            const result = b.results.get(key) ?? null;
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
                            const sep = i === 0 ? UE_SEP : "border-l border-border";

                            // Étudiant non inscrit à cette UE : bloc grisé.
                            if (!inscrit) {
                              return (
                                <td
                                  key={key}
                                  colSpan={3}
                                  className={`px-4 py-3 text-center align-middle text-xs text-muted-foreground bg-muted/20 whitespace-nowrap ${sep}`}
                                  title="Étudiant non inscrit à cette UE"
                                >
                                  non inscrit
                                </td>
                              );
                            }

                            return (
                              <Fragment key={key}>
                                <td
                                  className={`px-4 py-3 align-middle whitespace-nowrap ${sep}`}
                                >
                                  {devoirs.length === 0 ? (
                                    <span className="text-muted-foreground">—</span>
                                  ) : (
                                    <span className="font-mono">
                                      {devoirs.map((d: any) => fmt(d.note)).join(" · ")}
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
                                <td className="px-4 py-3 text-center align-middle whitespace-nowrap">
                                  <span
                                    className={`inline-block rounded px-2.5 py-1 text-sm font-mono font-semibold ${statut.cls}`}
                                    title={statut.label}
                                  >
                                    {fmt(result?.moyenne)}
                                  </span>
                                </td>
                              </Fragment>
                            );
                          });
                        })}
                        {hasConduite &&
                          (() => {
                            const note = conduiteNotes.get(sid) ?? null;
                            return (
                              <td
                                className={`px-4 py-3 text-center align-middle whitespace-nowrap ${UE_SEP}`}
                              >
                                {note == null ? (
                                  <span className="text-muted-foreground">—</span>
                                ) : (
                                  <span
                                    className={`inline-block rounded px-2.5 py-1 text-sm font-mono font-semibold ${
                                      Number(note) >= 10
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
                    );
                  })}
                </tbody>
              </table>
            </CardContent>
          </Card>

          <p className="text-xs text-muted-foreground">
            Toutes les UE terminées du semestre sont affichées côte à côte :{" "}
            <strong>faites défiler la grille horizontalement</strong> pour atteindre les dernières
            UE et la conduite, la colonne « Étudiant » restant visible à gauche. Les notes des
            sessions terminées ne sont plus modifiables : cette page est en{" "}
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
                La colonne <strong>Conduite</strong>, en fin de grille, reprend la note du semestre
                saisie sur la page{" "}
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
