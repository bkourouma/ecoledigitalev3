"use client";

import { useMemo, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { Card, CardContent, Input } from "@ecoledigitale/ui";
import {
  ArrowLeft,
  UserRound,
  Loader2,
  AlertCircle,
  Search,
  Clock,
  MapPin,
  BookOpen,
  Layers,
  Calendar,
  Eye,
  ChevronRight,
  ChevronDown,
} from "lucide-react";
import { useStudentPresences } from "@/lib/hooks/use-professional-bulletins";

/**
 * Détail de présence d'un étudiant — Présences (admin, module professionnel).
 *
 * Toutes les séances des cohortes où l'étudiant est inscrit sur le périmètre
 * choisi dans l'historique (filière, semestre, statut de session), regroupées
 * par matière (ECUE) en accordéon et affichées en cartes : son statut de
 * pointage séance par séance, avec le lien vers la fiche de la séance.
 */

const STATUT_PRESENCE: Record<string, { label: string; className: string }> = {
  present: { label: "Présent", className: "bg-green-100 text-green-700" },
  absent: { label: "Absent", className: "bg-red-100 text-red-700" },
  retard: { label: "Retard", className: "bg-amber-100 text-amber-700" },
  excuse: { label: "Excusé", className: "bg-blue-100 text-blue-700" },
};

const ENSEIGNANT_SOURCE_LABEL: Record<string, string> = {
  seance: "enseignant de la séance",
  ecue: "enseignant affecté à l'ECUE",
  session: "enseignant de la session",
};

function fmtHeures(h: number | null | undefined): string {
  const v = Number(h ?? 0);
  const heures = Math.floor(v);
  const minutes = Math.round((v - heures) * 60);
  return minutes > 0 ? `${heures}h${String(minutes).padStart(2, "0")}` : `${heures}h`;
}

function fmtDuree(min: number | null | undefined): string {
  const v = Number(min ?? 0);
  return v <= 0 ? "—" : fmtHeures(v / 60);
}

function fmtDateFr(d: string | null | undefined): string {
  if (!d) return "—";
  const x = new Date(d);
  return isNaN(x.getTime()) ? String(d) : x.toLocaleDateString("fr-FR");
}

function fmtJourFr(d: string | null | undefined): string {
  if (!d) return "";
  const x = new Date(d);
  return isNaN(x.getTime()) ? "" : x.toLocaleDateString("fr-FR", { weekday: "short" });
}

function fmtDateHeureFr(d: string | null | undefined): string {
  if (!d) return "—";
  const x = new Date(d);
  if (isNaN(x.getTime())) return String(d);
  return `${x.toLocaleDateString("fr-FR")} à ${x.toLocaleTimeString("fr-FR", {
    hour: "2-digit",
    minute: "2-digit",
  })}`;
}

function hm(t: string | null | undefined): string {
  return t ? String(t).slice(0, 5) : "—";
}

export default function StudentPresencesPage() {
  const params = useParams<{ studentId: string }>();
  const searchParams = useSearchParams();
  const router = useRouter();
  const studentId = String(params?.studentId ?? "");
  const filiereId = searchParams.get("filiere_id");
  const semestreId = searchParams.get("semestre_id") ?? undefined;
  const semestreLibelle = searchParams.get("semestre") ?? undefined;
  const statut = searchParams.get("statut") ?? undefined;

  const [search, setSearch] = useState("");
  const [openEcues, setOpenEcues] = useState<Set<string>>(new Set());

  const { data, isLoading, isError, error } = useStudentPresences({
    studentId,
    filiereId,
    semestreId,
    statut,
  });

  const student: any = (data as any)?.student;
  const recap: any = (data as any)?.recap;
  const seances: any[] = (data as any)?.seances ?? [];

  const q = search.trim().toLowerCase();
  const filteredSeances = useMemo(
    () =>
      q
        ? seances.filter((s) =>
            [s.ecue_code, s.ecue_libelle, s.seance_libelle, s.ue_libelle, s.enseignant_nom, s.salle]
              .filter(Boolean)
              .join(" ")
              .toLowerCase()
              .includes(q)
          )
        : seances,
    [seances, q]
  );

  // Séances regroupées par matière (ECUE), avec le décompte de l'étudiant.
  const parEcue = useMemo(() => {
    const groupes = new Map<string, any>();
    for (const s of filteredSeances) {
      const key = s.ecue_id ?? s.ecue_code ?? "—";
      let g = groupes.get(key);
      if (!g) {
        g = {
          key,
          ecue_code: s.ecue_code,
          ecue_libelle: s.ecue_libelle ?? s.ecue_code,
          seances: [] as any[],
          present: 0,
          absent: 0,
          retard: 0,
          excuse: 0,
          heuresAbsence: 0,
        };
        groupes.set(key, g);
      }
      g.seances.push(s);
      if (s.statut_etudiant && s.statut_etudiant in g) g[s.statut_etudiant] += 1;
      if (s.statut_etudiant === "absent") g.heuresAbsence += Number(s.duree_minutes || 0) / 60;
    }
    return Array.from(groupes.values()).sort((a, b) =>
      String(a.ecue_libelle).localeCompare(String(b.ecue_libelle), "fr")
    );
  }, [filteredSeances]);

  const toutDeplie = openEcues.size >= parEcue.length && parEcue.length > 0;

  function toggleEcue(key: string) {
    setOpenEcues((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  const taux =
    recap && Number(recap.nb_appels) > 0
      ? Math.round((Number(recap.nb_present) / Number(recap.nb_appels)) * 100)
      : null;

  return (
    <div className="space-y-6 max-w-[1400px] mx-auto p-6">
      <button
        onClick={() => router.back()}
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" />
        Retour au récapitulatif par étudiant
      </button>

      {!filiereId ? (
        <Card className="border-amber-200">
          <CardContent className="flex items-center gap-3 py-8 text-amber-700">
            <AlertCircle className="h-6 w-6 shrink-0" />
            <p>
              Classe manquante dans l'adresse. Revenez à l'historique des présences et cliquez sur
              « Détails » depuis le récapitulatif par étudiant.
            </p>
          </CardContent>
        </Card>
      ) : isLoading ? (
        <div className="flex justify-center py-16">
          <Loader2 className="h-10 w-10 animate-spin text-indigo-500" />
        </div>
      ) : isError || !student ? (
        <Card className="border-red-200">
          <CardContent className="flex items-center gap-3 py-8 text-red-700">
            <AlertCircle className="h-6 w-6 shrink-0" />
            <p>{(error as Error)?.message ?? "Étudiant introuvable."}</p>
          </CardContent>
        </Card>
      ) : (
        <>
          {/* En-tête : l'étudiant et le périmètre affiché */}
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <UserRound className="h-7 w-7 text-indigo-500" />
              <h1 className="font-bold bg-gradient-to-r from-indigo-600 to-blue-600 bg-clip-text text-transparent whitespace-nowrap text-2xl leading-tight md:text-3xl">
                {student.first_name} {student.last_name}
              </h1>
              {student.matricule && (
                <span className="rounded-full bg-indigo-100 px-2.5 py-0.5 font-mono text-xs font-semibold text-indigo-700">
                  {student.matricule}
                </span>
              )}
            </div>
            <p className="text-muted-foreground mt-2">
              {semestreLibelle ? `${semestreLibelle} · ` : "Tous les semestres · "}
              {recap?.nb_seances ?? seances.length} séance
              {Number(recap?.nb_seances ?? seances.length) > 1 ? "s" : ""} sur{" "}
              {parEcue.length} matière{parEcue.length > 1 ? "s" : ""} (ECUE)
              {Number(recap?.nb_non_pointe) > 0
                ? ` · ${recap.nb_non_pointe} non pointée${Number(recap.nb_non_pointe) > 1 ? "s" : ""}`
                : ""}
            </p>
          </div>

          {/* Récapitulatif */}
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-6">
            <StatCard label="Pointages" value={recap?.nb_appels ?? 0} color="from-indigo-500 to-blue-600" />
            <StatCard label="Présents" value={recap?.nb_present ?? 0} color="from-emerald-500 to-green-600" />
            <StatCard label="Absents" value={recap?.nb_absent ?? 0} color="from-red-500 to-rose-600" />
            <StatCard label="Retards" value={recap?.nb_retard ?? 0} color="from-amber-500 to-orange-600" />
            <StatCard
              label="Heures d'absence"
              value={fmtHeures(recap?.heures_absence)}
              color="from-fuchsia-500 to-pink-600"
            />
            <StatCard
              label="Taux de présence"
              value={taux == null ? "—" : `${taux}%`}
              color="from-sky-500 to-cyan-600"
            />
          </div>

          {/* Recherche */}
          <div className="relative max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Rechercher une matière, une séance, un enseignant…"
              className="pl-9"
            />
          </div>

          {/* Séances par matière */}
          <Card className="shadow-sm overflow-hidden">
            <div className="flex items-center gap-2 border-b border-border bg-muted/40 px-4 py-3">
              <BookOpen className="h-4 w-4 text-indigo-500 shrink-0" />
              <span className="font-semibold">Séances par matière (ECUE)</span>
              <span className="text-xs text-muted-foreground">
                · {filteredSeances.length} séance{filteredSeances.length > 1 ? "s" : ""}
              </span>
              {parEcue.length > 0 && (
                <button
                  onClick={() =>
                    setOpenEcues(toutDeplie ? new Set() : new Set(parEcue.map((g) => g.key)))
                  }
                  className="ml-auto shrink-0 rounded-md border border-border px-2.5 py-1 text-xs font-medium hover:bg-muted"
                >
                  {toutDeplie ? "Tout replier" : "Tout déplier"}
                </button>
              )}
            </div>
            <CardContent className="p-0">
              {parEcue.length === 0 ? (
                <p className="py-10 text-center text-muted-foreground text-sm">
                  Aucune séance pour cet étudiant sur ce périmètre.
                </p>
              ) : (
                <div className="divide-y divide-border/60">
                  {parEcue.map((g) => {
                    const ouvert = openEcues.has(g.key);
                    return (
                      <div key={g.key}>
                        <button
                          onClick={() => toggleEcue(g.key)}
                          className="flex w-full flex-col gap-0.5 bg-muted px-4 py-3 text-left hover:bg-muted/70"
                        >
                          <span className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
                            {ouvert ? (
                              <ChevronDown className="h-4 w-4 shrink-0 text-indigo-500" />
                            ) : (
                              <ChevronRight className="h-4 w-4 shrink-0 text-indigo-500" />
                            )}
                            <BookOpen className="h-4 w-4 shrink-0 text-indigo-500" />
                            {g.ecue_code && (
                              <span className="rounded bg-indigo-100 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-indigo-700">
                                {g.ecue_code}
                              </span>
                            )}
                            <span className="font-semibold text-foreground">{g.ecue_libelle}</span>
                            <span className="rounded-full bg-indigo-100 px-2 py-0.5 text-[11px] font-medium text-indigo-700">
                              {g.seances.length} séance{g.seances.length > 1 ? "s" : ""}
                            </span>
                          </span>
                          <span className="flex flex-wrap items-center gap-x-3 gap-y-1 pl-6 text-xs text-foreground/70">
                            <span className="flex items-center gap-2 font-mono">
                              <span className="text-green-600">{g.present} P</span>
                              <span className="text-red-600">{g.absent} A</span>
                              <span className="text-amber-600">{g.retard} R</span>
                              <span className="text-blue-600">{g.excuse} E</span>
                            </span>
                            {g.heuresAbsence > 0 && (
                              <span className="flex items-center gap-1 text-red-600">
                                <Clock className="h-3 w-3" />
                                {fmtHeures(g.heuresAbsence)} d'absence
                              </span>
                            )}
                          </span>
                        </button>
                        {ouvert && (
                          <div className="grid grid-cols-1 gap-4 bg-muted/10 p-4 xl:grid-cols-2">
                            {g.seances.map((s: any) => (
                              <SeanceEtudiantCard
                                key={s.seance_id}
                                s={s}
                                studentId={studentId}
                              />
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}

/** Carte d'une séance vue depuis l'étudiant : son statut de pointage d'abord. */
function SeanceEtudiantCard({ s, studentId }: { s: any; studentId: string }) {
  const st = s.statut_etudiant ? STATUT_PRESENCE[s.statut_etudiant] : undefined;
  return (
    <div className="flex flex-col overflow-hidden rounded-xl border border-border/70 bg-background shadow-sm transition-shadow hover:shadow-md">
      <div className="flex items-center justify-between gap-2 border-b border-border/60 bg-muted/30 px-4 py-2.5">
        <span className="flex items-center gap-2 text-sm font-semibold">
          <Calendar className="h-4 w-4 text-indigo-500" />
          {fmtDateFr(s.date)}
          <span className="text-xs font-normal capitalize text-muted-foreground">
            {fmtJourFr(s.date)}
          </span>
        </span>
        <span
          className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${
            st?.className ?? "bg-gray-100 text-gray-600"
          }`}
        >
          {st?.label ?? "Non pointé"}
        </span>
      </div>

      <div className="flex-1 space-y-2 px-4 py-3">
        <p className="font-semibold">
          {s.seance_libelle || <span className="text-muted-foreground">Séance sans libellé</span>}
        </p>

        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
          <span className="flex items-center gap-1 font-mono">
            <Clock className="h-3.5 w-3.5" />
            {hm(s.heure_debut)}–{hm(s.heure_fin)} · {fmtDuree(s.duree_minutes)}
          </span>
          {s.salle && (
            <span className="flex items-center gap-1">
              <MapPin className="h-3.5 w-3.5" />
              {s.salle}
            </span>
          )}
        </div>

        <div className="text-xs text-muted-foreground">
          <span className="flex items-center gap-1.5">
            <Layers className="h-3.5 w-3.5 shrink-0 text-indigo-400" />
            {s.ue_code && <span className="font-mono text-[10px]">{s.ue_code}</span>}
            {s.ue_libelle ?? "—"}
          </span>
          <span className="mt-0.5 block pl-5">
            {[s.semestre_libelle, s.session_libelle].filter(Boolean).join(" · ") || "—"}
          </span>
        </div>

        <div className="text-sm">
          <span className="flex items-center gap-1.5">
            <UserRound className="h-3.5 w-3.5 shrink-0 text-indigo-400" />
            {s.enseignant_nom || <span className="text-muted-foreground">—</span>}
            {s.enseignant_nom && s.enseignant_source && (
              <span className="text-[10px] text-muted-foreground">
                ({ENSEIGNANT_SOURCE_LABEL[s.enseignant_source] ?? ""})
              </span>
            )}
          </span>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border/60 bg-muted/20 px-4 py-2.5">
        <span className="text-[11px] text-muted-foreground">
          {s.pointe_le ? (
            <>
              pointé le {fmtDateHeureFr(s.pointe_le)}
              {s.pointe_par ? ` par ${s.pointe_par}` : ""}
            </>
          ) : (
            "appel non enregistré"
          )}
        </span>
        {/* `student_id` : la fiche de séance s'ouvre sur le pointage de CET
            étudiant, pas sur celui de toute la promotion. */}
        <Link
          href={`/professionnel/admin/presences/${s.seance_id}?student_id=${studentId}`}
          className="inline-flex items-center gap-1.5 rounded-md border border-indigo-200 bg-indigo-50 px-2.5 py-1 text-xs font-medium text-indigo-700 hover:bg-indigo-100"
        >
          <Eye className="h-3.5 w-3.5" />
          La séance
        </Link>
      </div>
    </div>
  );
}

function StatCard({
  label,
  value,
  color,
}: {
  label: string;
  value: string | number;
  color: string;
}) {
  return (
    <div className={`rounded-xl p-4 text-white bg-gradient-to-br ${color} shadow`}>
      <p className="text-white/80 text-sm font-medium">{label}</p>
      <p className="text-2xl font-bold mt-1">{value}</p>
    </div>
  );
}
