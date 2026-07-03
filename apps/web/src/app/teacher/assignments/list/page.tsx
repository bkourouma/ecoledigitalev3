"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  FileText,
  BookOpen,
  Layers,
  Search,
  Loader2,
  AlertCircle,
  Calendar,
  Clock,
  CheckCircle2,
  Users,
  ClipboardCheck,
  GraduationCap,
  Eye,
  Hash,
  Award,
} from "lucide-react";
import { Card, CardContent, Input, Badge } from "@ecoledigitale/ui";
import { SearchableSelect } from "@/components/SearchableSelect";
import { useTeacherAssignments } from "@/lib/hooks/use-professional-teacher";

/**
 * Historique des Évaluations — Espace enseignant (Module Professionnel).
 * Récupère TOUTES les évaluations rattachées aux ECUE affectés à l'enseignant,
 * avec le détail complet (ECUE, UE, filière, session, type, barème, dates,
 * soumissions / copies notées). Filtrable par filière, matière, type et statut.
 */

const TYPE_LABELS: Record<string, string> = {
  devoir: "Devoir",
  controle: "Contrôle",
  examen: "Examen",
  projet: "Projet",
  qcm: "QCM",
  autre: "Autre",
};

const EVAL_TYPE_LABELS: Record<string, string> = {
  online: "En ligne",
  pdf: "PDF / Copie",
  ai_generated: "Généré par IA",
};

const STATUT_META: Record<string, { label: string; className: string }> = {
  brouillon: { label: "Brouillon", className: "bg-amber-100 text-amber-700 border-amber-200" },
  publie: { label: "Publié", className: "bg-emerald-100 text-emerald-700 border-emerald-200" },
  cloture: { label: "Clôturé", className: "bg-slate-200 text-slate-600 border-slate-300" },
};

function formatDate(value?: string | null): string {
  if (!value) return "—";
  return new Date(value).toLocaleDateString("fr-FR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

export default function TeacherAssignmentsListPage() {
  const router = useRouter();
  const { data, isLoading, isError, error } = useTeacherAssignments();

  const [filiere, setFiliere] = useState("all");
  const [ecue, setEcue] = useState("all");
  const [type, setType] = useState("all");
  const [statut, setStatut] = useState("all");
  const [search, setSearch] = useState("");

  const rows: any[] = (data as any[]) ?? [];

  const filiereOptions = useMemo(() => {
    const map = new Map<string, string>();
    for (const r of rows) {
      if (r.filiere_id) map.set(r.filiere_id, `${r.filiere_nom ?? r.filiere_code} (${r.filiere_code})`);
    }
    return Array.from(map, ([value, label]) => ({ value, label })).sort((a, b) =>
      a.label.localeCompare(b.label, "fr")
    );
  }, [rows]);

  const ecueOptions = useMemo(() => {
    const map = new Map<string, string>();
    for (const r of rows) {
      if (r.ecue_id) map.set(r.ecue_id, `${r.ecue_libelle ?? r.ecue_code} (${r.ecue_code})`);
    }
    return Array.from(map, ([value, label]) => ({ value, label })).sort((a, b) =>
      a.label.localeCompare(b.label, "fr")
    );
  }, [rows]);

  const filtered = useMemo(() => {
    const s = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (filiere !== "all" && r.filiere_id !== filiere) return false;
      if (ecue !== "all" && r.ecue_id !== ecue) return false;
      if (type !== "all" && r.type !== type) return false;
      if (statut !== "all" && r.statut !== statut) return false;
      if (
        s &&
        !`${r.titre ?? ""} ${r.description ?? ""} ${r.ecue_libelle ?? ""} ${r.ecue_code ?? ""} ${r.ue_libelle ?? ""} ${r.session_libelle ?? ""}`
          .toLowerCase()
          .includes(s)
      )
        return false;
      return true;
    });
  }, [rows, filiere, ecue, type, statut, search]);

  const stats = useMemo(() => {
    return {
      total: rows.length,
      publie: rows.filter((r) => r.statut === "publie").length,
      brouillon: rows.filter((r) => r.statut === "brouillon").length,
      cloture: rows.filter((r) => r.statut === "cloture").length,
      soumis: rows.reduce((sum, r) => sum + (Number(r.nb_soumis) || 0), 0),
      notes: rows.reduce((sum, r) => sum + (Number(r.nb_notes) || 0), 0),
    };
  }, [rows]);

  if (isLoading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <Loader2 className="h-10 w-10 animate-spin text-purple-500" />
      </div>
    );
  }

  if (isError) {
    return (
      <div className="max-w-3xl mx-auto p-6">
        <Card className="border-red-200">
          <CardContent className="flex items-center gap-3 py-8 text-red-700">
            <AlertCircle className="h-6 w-6 shrink-0" />
            <p>{(error as Error)?.message ?? "Impossible de charger vos évaluations."}</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto p-6 space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold bg-gradient-to-r from-purple-600 to-indigo-600 bg-clip-text text-transparent flex items-center gap-2">
          <FileText className="h-7 w-7 text-purple-500" />
          Historique des Évaluations
        </h1>
        <p className="text-muted-foreground mt-2">
          Toutes les évaluations rattachées aux ECUE qui vous sont affectées, avec le détail complet.
        </p>
      </div>

      {/* Statistiques */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        <StatCard icon={FileText} label="Total" value={stats.total} color="text-purple-600" />
        <StatCard icon={CheckCircle2} label="Publiées" value={stats.publie} color="text-emerald-600" />
        <StatCard icon={ClipboardCheck} label="Brouillons" value={stats.brouillon} color="text-amber-600" />
        <StatCard icon={Layers} label="Clôturées" value={stats.cloture} color="text-slate-600" />
        <StatCard icon={Users} label="Soumissions" value={stats.soumis} color="text-blue-600" />
        <StatCard icon={Award} label="Copies notées" value={stats.notes} color="text-indigo-600" />
      </div>

      {/* Filtres */}
      <Card className="shadow-sm">
        <CardContent className="p-4 flex flex-col gap-3">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
            <SearchableSelect
              value={filiere}
              onChange={setFiliere}
              icon={<Layers className="h-4 w-4 text-gray-400" />}
              placeholder="Toutes les filières"
              searchPlaceholder="Rechercher une filière…"
              options={[{ value: "all", label: "Toutes les filières" }, ...filiereOptions]}
            />
            <SearchableSelect
              value={ecue}
              onChange={setEcue}
              icon={<BookOpen className="h-4 w-4 text-gray-400" />}
              placeholder="Toutes les matières"
              searchPlaceholder="Rechercher une ECUE…"
              options={[{ value: "all", label: "Toutes les matières" }, ...ecueOptions]}
            />
            <SearchableSelect
              value={type}
              onChange={setType}
              icon={<FileText className="h-4 w-4 text-gray-400" />}
              placeholder="Tous les types"
              options={[
                { value: "all", label: "Tous les types" },
                ...Object.entries(TYPE_LABELS).map(([value, label]) => ({ value, label })),
              ]}
            />
            <SearchableSelect
              value={statut}
              onChange={setStatut}
              icon={<CheckCircle2 className="h-4 w-4 text-gray-400" />}
              placeholder="Tous les statuts"
              options={[
                { value: "all", label: "Tous les statuts" },
                { value: "publie", label: "Publié" },
                { value: "brouillon", label: "Brouillon" },
                { value: "cloture", label: "Clôturé" },
              ]}
            />
          </div>
          <div className="flex flex-col sm:flex-row gap-3 sm:items-center">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Rechercher une évaluation (titre, matière, session…)"
                className="pl-9"
              />
            </div>
            <div className="text-sm text-muted-foreground whitespace-nowrap">
              <span className="font-medium text-foreground">{filtered.length}</span> évaluation
              {filtered.length > 1 ? "s" : ""}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Liste */}
      {filtered.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center text-center py-16 gap-3">
            <div className="rounded-full bg-purple-50 p-4">
              <GraduationCap className="h-8 w-8 text-purple-500" />
            </div>
            <p className="text-muted-foreground max-w-md">
              {rows.length === 0
                ? "Aucune évaluation créée pour l'instant sur vos ECUE. Créez-en depuis la page d'un cours, onglet « Évaluations »."
                : "Aucune évaluation ne correspond à ces filtres."}
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {filtered.map((a) => {
            const statutMeta = STATUT_META[a.statut] ?? {
              label: a.statut,
              className: "bg-slate-100 text-slate-600 border-slate-200",
            };
            return (
              <Card key={a.id} className="hover:shadow-md transition-shadow">
                <CardContent className="p-5">
                  <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-4">
                    {/* Colonne gauche : titre + détails */}
                    <div className="flex items-start gap-4 flex-1 min-w-0">
                      <div className="p-2.5 bg-purple-100 rounded-lg shrink-0">
                        <FileText className="h-6 w-6 text-purple-600" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <h3 className="text-lg font-semibold text-foreground">{a.titre}</h3>
                          <Badge variant="outline" className={statutMeta.className}>
                            {statutMeta.label}
                          </Badge>
                          <Badge variant="secondary">{TYPE_LABELS[a.type] ?? a.type}</Badge>
                          <Badge variant="outline" className="border-purple-200 text-purple-700">
                            {EVAL_TYPE_LABELS[a.evaluation_type] ?? a.evaluation_type}
                          </Badge>
                        </div>

                        {a.description && (
                          <p className="mt-1.5 text-sm text-muted-foreground line-clamp-2">
                            {a.description}
                          </p>
                        )}

                        {/* Contexte : matière / UE / filière / session */}
                        <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1.5 text-sm text-muted-foreground">
                          <span className="flex items-center gap-1.5 truncate">
                            <BookOpen className="h-4 w-4 shrink-0 text-purple-400" />
                            <span className="truncate">
                              {a.ecue_libelle ?? a.ecue_code}
                              {a.ecue_code ? ` · ${a.ecue_code}` : ""}
                            </span>
                          </span>
                          {(a.ue_libelle || a.ue_code) && (
                            <span className="flex items-center gap-1.5 truncate">
                              <Layers className="h-4 w-4 shrink-0 text-purple-400" />
                              <span className="truncate">
                                {a.ue_libelle ?? a.ue_code}
                                {a.filiere_code ? ` · ${a.filiere_code}` : ""}
                              </span>
                            </span>
                          )}
                          {a.session_libelle && (
                            <span className="flex items-center gap-1.5 truncate">
                              <GraduationCap className="h-4 w-4 shrink-0 text-purple-400" />
                              <span className="truncate">{a.session_libelle}</span>
                            </span>
                          )}
                          <span className="flex items-center gap-1.5">
                            <Hash className="h-4 w-4 shrink-0 text-purple-400" />
                            Barème /{Number(a.note_max)} · coeff. {Number(a.coefficient)}
                          </span>
                        </div>

                        {/* Dates */}
                        <div className="mt-2 flex items-center gap-x-6 gap-y-1 flex-wrap text-xs text-muted-foreground">
                          <span className="flex items-center gap-1.5">
                            <Calendar className="h-3.5 w-3.5 shrink-0" />
                            Créée le {formatDate(a.created_at)}
                          </span>
                          {a.starts_at && (
                            <span className="flex items-center gap-1.5">
                              <Clock className="h-3.5 w-3.5 shrink-0" />
                              Début {formatDate(a.starts_at)}
                            </span>
                          )}
                          {a.due_at && (
                            <span className="flex items-center gap-1.5">
                              <Clock className="h-3.5 w-3.5 shrink-0" />
                              Échéance {formatDate(a.due_at)}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>

                    {/* Colonne droite : soumissions + action */}
                    <div className="flex flex-row lg:flex-col items-stretch gap-3 lg:w-52 shrink-0">
                      <div className="flex-1 rounded-lg bg-purple-50 border border-purple-100 p-3 text-center">
                        <div className="flex justify-around">
                          <div>
                            <div className="text-xl font-bold text-blue-600">{a.nb_soumis ?? 0}</div>
                            <div className="text-[11px] text-muted-foreground">Soumises</div>
                          </div>
                          <div>
                            <div className="text-xl font-bold text-indigo-600">{a.nb_notes ?? 0}</div>
                            <div className="text-[11px] text-muted-foreground">Notées</div>
                          </div>
                        </div>
                      </div>
                      <button
                        type="button"
                        disabled={!a.ue_session_id}
                        onClick={() =>
                          a.ue_session_id &&
                          router.push(`/teacher/courses/${a.ue_session_id}?tab=evaluations`)
                        }
                        title={
                          a.ue_session_id
                            ? "Voir les copies et corriger"
                            : "Évaluation non rattachée à une session"
                        }
                        className="inline-flex items-center justify-center gap-2 rounded-lg bg-purple-600 hover:bg-purple-700 disabled:opacity-40 disabled:cursor-not-allowed text-white px-3 py-2 text-sm font-medium transition-colors"
                      >
                        <Eye className="h-4 w-4" />
                        Voir / Corriger
                      </button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}

function StatCard({
  icon: Icon,
  label,
  value,
  color,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: number;
  color: string;
}) {
  return (
    <Card className="shadow-sm">
      <CardContent className="p-4 flex items-center gap-3">
        <Icon className={`h-6 w-6 shrink-0 ${color}`} />
        <div className="min-w-0">
          <div className={`text-2xl font-bold ${color}`}>{value}</div>
          <div className="text-xs text-muted-foreground truncate">{label}</div>
        </div>
      </CardContent>
    </Card>
  );
}
