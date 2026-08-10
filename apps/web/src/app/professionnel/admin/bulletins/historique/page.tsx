"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Card, CardContent, Button, Input } from "@ecoledigitale/ui";
import {
  ArrowLeft,
  Layers,
  CalendarRange,
  History,
  Loader2,
  AlertCircle,
  Search,
  Eye,
  GraduationCap,
  FileSpreadsheet,
} from "lucide-react";
import { SearchableSelect } from "@/components/SearchableSelect";
import { useNotesFilieres, useBulletinHistory } from "@/lib/hooks/use-professional-bulletins";

/**
 * Historique des bulletins — Module Professionnel (LMD).
 * Filière → année scolaire (de la plus ancienne à la plus récente) → tableau :
 * une ligne par étudiant, une colonne par semestre (bulletin généré,
 * consultable en PDF), plus le statut global de la filière (crédits cumulés
 * sur les 3 semestres).
 */

function fmt(x: number | null | undefined): string {
  return x == null ? "—" : Number(x).toFixed(2).replace(".", ",");
}

export default function HistoriqueBulletinsPage() {
  const [filiereId, setFiliereId] = useState("");
  const [periode, setPeriode] = useState("");
  const [search, setSearch] = useState("");

  const filieresQuery = useNotesFilieres();
  const historyQuery = useBulletinHistory(filiereId || null);

  const filieres: any[] = (filieresQuery.data as any[]) ?? [];
  const history: any = historyQuery.data ?? null;
  const semestres: any[] = history?.semestres ?? [];
  const students: any[] = history?.students ?? [];
  const bulletins: any[] = history?.bulletins ?? [];

  // Périodes (années scolaires) disponibles, de la plus ancienne à la plus récente.
  const periodes = useMemo(() => {
    const map = new Map<string, { annee: string; statut: string; date: string }>();
    for (const s of semestres) {
      if (!s.annee_scolaire) continue;
      const cur = map.get(s.annee_scolaire);
      // Une période est « en cours » si au moins un de ses semestres l'est.
      const st = cur?.statut === "en_cours" || s.statut === "en_cours" ? "en_cours" : s.statut;
      map.set(s.annee_scolaire, {
        annee: s.annee_scolaire,
        statut: st,
        date: cur && cur.date < (s.date_debut ?? "") ? cur.date : s.date_debut ?? "",
      });
    }
    return Array.from(map.values()).sort((a, b) => a.annee.localeCompare(b.annee));
  }, [semestres]);

  // Semestres de la période (année scolaire) sélectionnée, chronologiques.
  const shownSemestres = useMemo(
    () =>
      semestres
        .filter((s) => (periode ? s.annee_scolaire === periode : false))
        .sort((a, b) => String(a.libelle).localeCompare(String(b.libelle), "fr", { numeric: true })),
    [semestres, periode]
  );

  // Index bulletin par (student, semestre).
  const bulletinBy = useMemo(() => {
    const m = new Map<string, any>();
    for (const b of bulletins) m.set(`${b.student_id}|${b.semestre_id}`, b);
    return m;
  }, [bulletins]);

  const filteredStudents = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return students;
    return students.filter((s) =>
      `${s.first_name} ${s.last_name} ${s.matricule ?? ""}`.toLowerCase().includes(q)
    );
  }, [students, search]);

  /** Statut global de l'étudiant sur la filière (cumul des semestres affichés). */
  function filiereStatus(studentId: string) {
    const cells = shownSemestres.map((sm) => bulletinBy.get(`${studentId}|${sm.id}`) ?? null);
    const generated = cells.filter(Boolean) as any[];
    if (generated.length === 0) return { kind: "none" as const, label: "—", detail: "" };
    const sumV = generated.reduce((s, b) => s + (Number(b.credits_valides) || 0), 0);
    const sumT = generated.reduce((s, b) => s + (Number(b.credits_total) || 0), 0);
    const allGenerated = generated.length === shownSemestres.length && shownSemestres.length > 0;
    const allDefinitif = allGenerated && generated.every((b) => b.statut === "definitif");
    const allTerminee = shownSemestres.every((sm) => sm.statut === "terminee");
    if (allDefinitif && sumT > 0 && sumV >= sumT) {
      return {
        kind: "validee" as const,
        label: "Filière validée",
        detail: `${sumV}/${sumT} crédits`,
      };
    }
    if (allGenerated && allTerminee && sumV < sumT) {
      return {
        kind: "incomplet" as const,
        label: "Crédits incomplets",
        detail: `${sumV}/${sumT} crédits`,
      };
    }
    return { kind: "en_cours" as const, label: "En cours", detail: `${sumV}/${sumT} crédits` };
  }

  const stats = useMemo(() => {
    let generes = 0;
    let validees = 0;
    for (const st of filteredStudents) {
      for (const sm of shownSemestres) {
        if (bulletinBy.has(`${st.student_id}|${sm.id}`)) generes++;
      }
      if (filiereStatus(st.student_id).kind === "validee") validees++;
    }
    return { etudiants: filteredStudents.length, generes, validees };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filteredStudents, shownSemestres, bulletinBy]);

  const ready = !!filiereId && !!periode && shownSemestres.length > 0;

  return (
    <div className="space-y-6 max-w-[1500px] mx-auto p-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div className="flex items-center gap-4">
          <Link href="/professionnel/admin/bulletins">
            <Button variant="outline" size="sm">
              <ArrowLeft className="h-4 w-4 mr-2" />
              Retour
            </Button>
          </Link>
          <div>
            <h1 className="text-3xl font-bold bg-gradient-to-r from-indigo-600 to-blue-600 bg-clip-text text-transparent flex items-center gap-2">
              <History className="h-7 w-7 text-indigo-500" />
              Historique des bulletins
            </h1>
            <p className="text-muted-foreground mt-2">
              Tous les bulletins générés par filière et par session : les trois semestres de chaque
              étudiant, avec le statut global de la filière.
            </p>
          </div>
        </div>
      </div>

      {/* Filtres — filière puis année scolaire */}
      <Card className="shadow-sm">
        <CardContent className="p-4 grid grid-cols-1 md:grid-cols-2 gap-3">
          <SearchableSelect
            value={filiereId}
            onChange={(v) => {
              setFiliereId(v);
              setPeriode("");
            }}
            icon={<Layers className="h-4 w-4 text-gray-400" />}
            placeholder={filieresQuery.isLoading ? "Chargement…" : "Filière"}
            searchPlaceholder="Rechercher une filière…"
            options={filieres.map((f) => ({
              value: f.id,
              label: `${f.name}${f.code ? ` (${f.code})` : ""}`,
            }))}
          />
          <SearchableSelect
            value={periode}
            onChange={setPeriode}
            icon={<CalendarRange className="h-4 w-4 text-gray-400" />}
            placeholder={
              !filiereId
                ? "Choisir une filière"
                : historyQuery.isLoading
                ? "Chargement…"
                : periodes.length === 0
                ? "Aucune session"
                : "Année scolaire"
            }
            searchPlaceholder="Rechercher une année…"
            options={periodes.map((p) => ({
              value: p.annee,
              label: `${p.annee} · ${p.statut === "en_cours" ? "en cours" : "terminée"}`,
            }))}
          />
        </CardContent>
      </Card>

      {/* Stats */}
      {ready && !historyQuery.isLoading && (
        <div className="grid grid-cols-3 gap-4">
          <StatCard label="Étudiants" value={stats.etudiants} color="from-indigo-500 to-blue-600" />
          <StatCard
            label="Bulletins générés"
            value={stats.generes}
            color="from-emerald-500 to-green-600"
          />
          <StatCard
            label="Filière validée"
            value={stats.validees}
            color="from-amber-500 to-orange-600"
          />
        </div>
      )}

      {/* Contenu */}
      {!filiereId ? (
        <EmptyState text="Choisissez une filière puis une année scolaire pour afficher l'historique." />
      ) : historyQuery.isLoading ? (
        <div className="flex justify-center py-16">
          <Loader2 className="h-10 w-10 animate-spin text-indigo-500" />
        </div>
      ) : historyQuery.isError ? (
        <Card className="border-red-200">
          <CardContent className="flex items-center gap-3 py-8 text-red-700">
            <AlertCircle className="h-6 w-6 shrink-0" />
            <p>{(historyQuery.error as Error)?.message ?? "Impossible de charger l'historique."}</p>
          </CardContent>
        </Card>
      ) : !periode ? (
        <EmptyState
          text={
            periodes.length === 0
              ? "Aucune session pour cette filière."
              : "Sélectionnez une année scolaire pour afficher le tableau."
          }
        />
      ) : !ready ? (
        <EmptyState text="Aucun semestre ne correspond à cette sélection." />
      ) : students.length === 0 ? (
        <EmptyState text="Aucun étudiant inscrit dans cette filière." />
      ) : (
        <Card className="shadow-sm overflow-hidden">
          <div className="flex flex-col sm:flex-row sm:items-center gap-3 border-b border-border bg-muted/40 px-4 py-3">
            <div className="flex items-center gap-2">
              <FileSpreadsheet className="h-4 w-4 text-indigo-500 shrink-0" />
              <span className="font-semibold">{history?.filiere?.name}</span>
              <span className="text-xs text-muted-foreground whitespace-nowrap">
                · {periode} · {shownSemestres.length} semestre{shownSemestres.length > 1 ? "s" : ""}
              </span>
            </div>
            <div className="relative sm:ml-auto sm:w-64">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Rechercher un étudiant…"
                className="pl-9 h-9"
              />
            </div>
          </div>
          <CardContent className="p-0 overflow-auto max-h-[75vh]">
            <table className="min-w-full text-sm border-collapse">
              <thead>
                <tr className="bg-muted/60 border-b border-border">
                  <th className="sticky left-0 top-0 z-30 bg-muted/60 px-5 py-3 text-left font-medium border-r border-border whitespace-nowrap">
                    Étudiant
                  </th>
                  {shownSemestres.map((sm) => (
                    <th
                      key={sm.id}
                      className="sticky top-0 z-20 bg-muted/60 px-4 py-3 text-center font-semibold border-r border-border whitespace-nowrap"
                    >
                      {sm.libelle}
                      <span
                        className={`ml-2 rounded-full px-1.5 py-0.5 text-[10px] font-medium ${
                          sm.statut === "terminee"
                            ? "bg-slate-200 text-slate-600"
                            : "bg-emerald-100 text-emerald-700"
                        }`}
                      >
                        {sm.statut === "terminee" ? "terminé" : "en cours"}
                      </span>
                    </th>
                  ))}
                  <th className="sticky top-0 z-20 bg-muted/60 px-4 py-3 text-center font-semibold whitespace-nowrap">
                    Statut filière
                  </th>
                </tr>
              </thead>
              <tbody>
                {filteredStudents.map((st) => {
                  const fs = filiereStatus(st.student_id);
                  return (
                    <tr
                      key={st.student_id}
                      className="border-b border-border/60 align-middle hover:bg-muted/20"
                    >
                      <td className="sticky left-0 z-10 bg-background px-5 py-4 border-r border-border whitespace-nowrap">
                        <div className="font-medium">
                          {st.first_name} {st.last_name}
                        </div>
                        {st.matricule && (
                          <div className="font-mono text-xs text-muted-foreground mt-0.5">
                            {st.matricule}
                          </div>
                        )}
                      </td>
                      {shownSemestres.map((sm) => {
                        const b = bulletinBy.get(`${st.student_id}|${sm.id}`);
                        return (
                          <td
                            key={sm.id}
                            className="px-4 py-3 text-center border-r border-border whitespace-nowrap"
                          >
                            {b ? (
                              <div className="inline-flex flex-col items-center gap-1">
                                <div className="flex items-center gap-2">
                                  <span className="font-mono font-semibold">
                                    {fmt(b.moyenne_session)}
                                  </span>
                                  <span className="font-mono text-xs text-muted-foreground">
                                    {b.credits_valides}/{b.credits_total} cr.
                                  </span>
                                  <span
                                    className={`rounded-full px-1.5 py-0.5 text-[10px] font-medium ${
                                      b.statut === "definitif"
                                        ? "bg-green-100 text-green-700"
                                        : "bg-amber-100 text-amber-700"
                                    }`}
                                    title={
                                      b.statut === "definitif"
                                        ? "Bulletin définitif"
                                        : "Bulletin provisoire — en attente de Session 2"
                                    }
                                  >
                                    {b.statut === "definitif" ? "Définitif" : "Provisoire"}
                                  </span>
                                </div>
                                <div className="flex items-center gap-2">
                                  <span className="text-[10px] text-muted-foreground">
                                    généré le {new Date(b.generated_at).toLocaleDateString("fr-FR")}
                                  </span>
                                  <Link
                                    href={`/professionnel/admin/bulletins/${st.student_id}?semestre=${sm.id}`}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="inline-flex items-center gap-1 text-[11px] font-medium text-indigo-600 hover:text-indigo-800"
                                  >
                                    <Eye className="h-3 w-3" />
                                    Consulter
                                  </Link>
                                </div>
                              </div>
                            ) : (
                              <span className="text-xs text-muted-foreground">Non généré</span>
                            )}
                          </td>
                        );
                      })}
                      <td className="px-4 py-3 text-center whitespace-nowrap">
                        <div className="inline-flex flex-col items-center gap-0.5">
                          <span
                            className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                              fs.kind === "validee"
                                ? "bg-green-100 text-green-700"
                                : fs.kind === "incomplet"
                                ? "bg-red-100 text-red-700"
                                : fs.kind === "en_cours"
                                ? "bg-amber-100 text-amber-700"
                                : "bg-slate-100 text-slate-500"
                            }`}
                          >
                            {fs.label}
                          </span>
                          {fs.detail && (
                            <span className="font-mono text-[10px] text-muted-foreground">
                              {fs.detail}
                            </span>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}

      {ready && (
        <p className="text-xs text-muted-foreground">
          « Filière validée » = les {shownSemestres.length} bulletins sont définitifs et la totalité
          des crédits est acquise. « En cours » = semestres ou rattrapages encore ouverts. « Crédits
          incomplets » = sessions terminées sans la totalité des crédits.
        </p>
      )}
    </div>
  );
}

function StatCard({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className={`rounded-xl p-4 text-white bg-gradient-to-br ${color} shadow`}>
      <p className="text-white/80 text-sm font-medium">{label}</p>
      <p className="text-3xl font-bold mt-1">{value}</p>
    </div>
  );
}

function EmptyState({ text }: { text: string }) {
  return (
    <Card>
      <CardContent className="flex flex-col items-center justify-center text-center py-16 gap-3">
        <div className="rounded-full bg-indigo-50 p-4">
          <GraduationCap className="h-8 w-8 text-indigo-500" />
        </div>
        <p className="text-muted-foreground max-w-md">{text}</p>
      </CardContent>
    </Card>
  );
}
