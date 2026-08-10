"use client";

import React, { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Card,
  CardContent,
  Button,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@ecoledigitale/ui";
import {
  AlertCircle,
  ArrowLeft,
  BookOpen,
  Brain,
  CheckCircle2,
  ClipboardList,
  Edit2,
  Eye,
  FileText,
  Layers,
  ListChecks,
  Loader2,
  Plus,
  Search,
  Send,
  X,
} from "lucide-react";
import { useTeacherAssignments } from "@/lib/hooks/use-professional-teacher";
import { useTeacherEcue, type TeacherEcue } from "@/lib/hooks/use-teacher-professional";
import {
  AssignmentForm,
  GradingModal,
  DeleteAssignmentBtn,
  EVALUATION_TYPE_LABEL,
} from "@/components/professional/ProfessionalAssignmentsPanel";
import { AssignmentQuestionsManager } from "@/components/professional/AssignmentQuestionsManager";

/**
 * Mes évaluations — Espace enseignant (Module Professionnel, feature 030).
 *
 * Vue globale, transverse à toutes les matières (ECUE) affectées à
 * l'enseignant : voir, filtrer, créer, corriger, éditer et supprimer ses
 * évaluations. Réutilise le wizard de création/édition (`AssignmentForm`), la
 * correction (`GradingModal`) et le gestionnaire de questions déjà employés
 * dans l'onglet « Évaluations » d'une session.
 */

const TYPE_FILTERS = [
  { value: "all", label: "Tous les types" },
  { value: "online", label: "En ligne" },
  { value: "pdf", label: "Sujet PDF" },
  { value: "ai_generated", label: "IA" },
];

const STATUT_FILTERS = [
  { value: "all", label: "Tous les statuts" },
  { value: "brouillon", label: "Brouillon" },
  { value: "publie", label: "Publié" },
  { value: "cloture", label: "Clôturé" },
];

function fmtDateTime(value?: string | null): string {
  if (!value) return "—";
  const d = new Date(value);
  return isNaN(d.getTime()) ? "—" : d.toLocaleString("fr-FR");
}

function TypeBadge({ type }: { type: string }) {
  const Icon = type === "online" ? BookOpen : type === "ai_generated" ? Brain : FileText;
  return (
    <span
      className={`inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full whitespace-nowrap border ${
        type === "online"
          ? "bg-green-500/15 text-green-600 border-green-500/40"
          : type === "ai_generated"
            ? "bg-purple-500/15 text-purple-600 border-purple-500/40"
            : "bg-blue-500/15 text-blue-600 border-blue-500/40"
      }`}
    >
      <Icon className="h-3 w-3" />
      {EVALUATION_TYPE_LABEL[type] ?? "—"}
    </span>
  );
}

function StatutBadge({ statut }: { statut: string }) {
  return (
    <span
      className={`text-xs px-2 py-0.5 rounded-full whitespace-nowrap ${
        statut === "publie"
          ? "bg-green-100 text-green-700"
          : statut === "brouillon"
            ? "bg-gray-100 text-gray-700"
            : "bg-amber-100 text-amber-700"
      }`}
    >
      {statut}
    </span>
  );
}

export default function TeacherEvaluationsPage() {
  const router = useRouter();
  const listQuery = useTeacherAssignments();
  const items: any[] = (listQuery.data as any[]) ?? [];

  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState("all");
  const [statutFilter, setStatutFilter] = useState("all");
  const [sessionFilter, setSessionFilter] = useState("all");

  const [error, setError] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);
  const [creatingFor, setCreatingFor] = useState<{ subjectId: string; sessionId?: string } | null>(
    null
  );
  const [editing, setEditing] = useState<any | null>(null);
  const [gradingFor, setGradingFor] = useState<any | null>(null);
  const [managingQuestionsFor, setManagingQuestionsFor] = useState<any | null>(null);

  // Cohortes distinctes présentes dans les évaluations (pour le filtre).
  const sessionOptions = useMemo(() => {
    const map = new Map<string, string>();
    for (const a of items) {
      if (a.ue_session_id && !map.has(a.ue_session_id)) {
        const label = [a.session_libelle, a.filiere_code].filter(Boolean).join(" · ");
        map.set(a.ue_session_id, label || a.session_libelle || "Cohorte");
      }
    }
    return Array.from(map, ([id, label]) => ({ id, label }));
  }, [items]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return items.filter((a) => {
      const matchSearch =
        !q ||
        `${a.titre ?? ""} ${a.ecue_code ?? ""} ${a.ecue_libelle ?? ""} ${a.ue_code ?? ""} ${
          a.ue_libelle ?? ""
        } ${a.session_libelle ?? ""} ${a.filiere_nom ?? ""}`
          .toLowerCase()
          .includes(q);
      const matchType = typeFilter === "all" || a.evaluation_type === typeFilter;
      const matchStatut = statutFilter === "all" || a.statut === statutFilter;
      const matchSession = sessionFilter === "all" || a.ue_session_id === sessionFilter;
      return matchSearch && matchType && matchStatut && matchSession;
    });
  }, [items, search, typeFilter, statutFilter, sessionFilter]);

  const stats = useMemo(() => {
    return {
      total: items.length,
      publiees: items.filter((a) => a.statut === "publie").length,
      brouillons: items.filter((a) => a.statut === "brouillon").length,
      aCorriger: items.reduce(
        (acc, a) => acc + Math.max(0, (a.nb_soumis ?? 0) - (a.nb_notes ?? 0)),
        0
      ),
    };
  }, [items]);

  return (
    <div className="max-w-7xl mx-auto p-6 space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-center gap-4">
          <Button variant="outline" size="sm" onClick={() => router.back()}>
            <ArrowLeft className="h-4 w-4 mr-2" />
            Retour
          </Button>
          <div>
            <h1 className="text-3xl font-bold bg-gradient-to-r from-indigo-600 to-purple-600 bg-clip-text text-transparent">
              Mes évaluations
            </h1>
            <p className="text-muted-foreground mt-1 text-sm">
              Créez, suivez et corrigez les évaluations de toutes vos matières.
            </p>
          </div>
        </div>
        <Button
          className="bg-gradient-to-r from-indigo-500 to-purple-600 hover:from-indigo-600 hover:to-purple-700 text-white"
          onClick={() => {
            setError(null);
            setPicking(true);
          }}
        >
          <Plus className="h-4 w-4 mr-2" />
          Nouvelle évaluation
        </Button>
      </div>

      {error && (
        <div className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700 flex items-start gap-2">
          <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
          <span className="flex-1">{error}</span>
          <button type="button" onClick={() => setError(null)} className="text-red-500">
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {/* Statistiques */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard icon={ClipboardList} label="Total évaluations" value={stats.total} color="indigo" />
        <StatCard icon={CheckCircle2} label="Publiées" value={stats.publiees} color="green" />
        <StatCard icon={FileText} label="Brouillons" value={stats.brouillons} color="purple" />
        <StatCard icon={Edit2} label="Copies à corriger" value={stats.aCorriger} color="blue" />
      </div>

      {/* Filtres */}
      <Card className="shadow-sm">
        <CardContent className="p-4 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Rechercher un titre, une matière…"
              className="pl-9"
            />
          </div>
          <Select value={typeFilter} onValueChange={setTypeFilter}>
            <SelectTrigger>
              <SelectValue placeholder="Type" />
            </SelectTrigger>
            <SelectContent>
              {TYPE_FILTERS.map((o) => (
                <SelectItem key={o.value} value={o.value}>
                  {o.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={statutFilter} onValueChange={setStatutFilter}>
            <SelectTrigger>
              <SelectValue placeholder="Statut" />
            </SelectTrigger>
            <SelectContent>
              {STATUT_FILTERS.map((o) => (
                <SelectItem key={o.value} value={o.value}>
                  {o.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={sessionFilter} onValueChange={setSessionFilter}>
            <SelectTrigger>
              <SelectValue placeholder="Cohorte" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Toutes les cohortes</SelectItem>
              {sessionOptions.map((o) => (
                <SelectItem key={o.id} value={o.id}>
                  {o.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </CardContent>
      </Card>

      {/* Liste */}
      <Card className="shadow-sm">
        <CardContent className="p-0">
          {listQuery.isLoading ? (
            <div className="flex items-center justify-center py-16">
              <Loader2 className="h-8 w-8 animate-spin text-indigo-500" />
            </div>
          ) : listQuery.isError ? (
            <div className="flex flex-col items-center justify-center text-center py-16 gap-3">
              <AlertCircle className="h-8 w-8 text-red-500" />
              <p className="text-muted-foreground">
                {(listQuery.error as Error)?.message ?? "Impossible de charger vos évaluations."}
              </p>
            </div>
          ) : filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center text-center py-16 gap-3">
              <div className="rounded-full bg-indigo-50 p-4">
                <ClipboardList className="h-8 w-8 text-indigo-500" />
              </div>
              <h3 className="text-lg font-semibold">
                {items.length === 0 ? "Aucune évaluation" : "Aucune évaluation ne correspond"}
              </h3>
              <p className="text-muted-foreground max-w-md">
                {items.length === 0
                  ? "Vous n'avez encore créé aucune évaluation. Cliquez sur « Nouvelle évaluation » pour commencer."
                  : "Essayez d'ajuster votre recherche ou vos filtres."}
              </p>
              {items.length === 0 && (
                <Button
                  className="mt-2 bg-gradient-to-r from-indigo-500 to-purple-600 hover:from-indigo-600 hover:to-purple-700 text-white"
                  onClick={() => setPicking(true)}
                >
                  <Plus className="h-4 w-4 mr-2" />
                  Nouvelle évaluation
                </Button>
              )}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-left text-xs uppercase text-muted-foreground border-b bg-muted/30">
                  <tr>
                    <th className="py-2.5 px-3">Titre</th>
                    <th className="py-2.5 px-3">Matière</th>
                    <th className="py-2.5 px-3">Cohorte</th>
                    <th className="py-2.5 px-3">Type</th>
                    <th className="py-2.5 px-3 text-right">/Note</th>
                    <th className="py-2.5 px-3 text-right">Coef.</th>
                    <th className="py-2.5 px-3">Échéance</th>
                    <th className="py-2.5 px-3">Statut</th>
                    <th className="py-2.5 px-3 text-right">Soumis</th>
                    <th className="py-2.5 px-3 text-right">Notés</th>
                    <th className="py-2.5 px-3"></th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((a) => (
                    <tr key={a.id} className="border-b last:border-0 hover:bg-muted/30">
                      <td className="py-2.5 px-3 font-medium max-w-[220px]">
                        <button
                          type="button"
                          onClick={() => setGradingFor(a)}
                          className="text-blue-600 hover:underline text-left truncate block max-w-full"
                          title={a.titre}
                        >
                          {a.titre}
                        </button>
                        {a.type === "examen" && (
                          <span className="text-[10px] uppercase tracking-wide text-amber-600 font-semibold">
                            Examen
                          </span>
                        )}
                      </td>
                      <td className="py-2.5 px-3">
                        <span className="font-mono text-xs text-indigo-600">{a.ecue_code}</span>
                        <p className="text-xs text-muted-foreground truncate max-w-[160px]" title={a.ecue_libelle}>
                          {a.ecue_libelle}
                        </p>
                      </td>
                      <td className="py-2.5 px-3">
                        <p className="text-xs truncate max-w-[150px]" title={a.session_libelle ?? ""}>
                          {a.session_libelle ?? "—"}
                        </p>
                        {a.filiere_code && (
                          <span className="text-[11px] text-muted-foreground">{a.filiere_code}</span>
                        )}
                      </td>
                      <td className="py-2.5 px-3">
                        <TypeBadge type={a.evaluation_type} />
                      </td>
                      <td className="py-2.5 px-3 text-right font-mono">{a.note_max}</td>
                      <td className="py-2.5 px-3 text-right font-mono">{a.coefficient}</td>
                      <td className="py-2.5 px-3 text-xs whitespace-nowrap">{fmtDateTime(a.due_at)}</td>
                      <td className="py-2.5 px-3">
                        <StatutBadge statut={a.statut} />
                      </td>
                      <td className="py-2.5 px-3 text-right font-mono">{a.nb_soumis ?? 0}</td>
                      <td className="py-2.5 px-3 text-right font-mono">{a.nb_notes ?? 0}</td>
                      <td className="py-2.5 px-3 text-right whitespace-nowrap">
                        {(a.evaluation_type === "online" || a.evaluation_type === "ai_generated") && (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => setManagingQuestionsFor(a)}
                            title="Gérer les questions"
                            className="mr-1"
                          >
                            <ListChecks className="h-4 w-4" />
                          </Button>
                        )}
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => setGradingFor(a)}
                          title="Corriger"
                        >
                          <ClipboardList className="h-4 w-4" />
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          className="ml-1"
                          onClick={() =>
                            router.push(`/academic/assignments/assign?source=${a.id}`)
                          }
                          title="Assigner à d'autres filières"
                        >
                          <Send className="h-4 w-4" />
                        </Button>
                        {a.ue_session_id && (
                          <Button
                            size="sm"
                            variant="outline"
                            className="ml-1"
                            onClick={() => router.push(`/teacher/courses/${a.ue_session_id}`)}
                            title="Ouvrir la session"
                          >
                            <Eye className="h-4 w-4" />
                          </Button>
                        )}
                        <Button
                          size="sm"
                          variant="outline"
                          className="ml-1"
                          onClick={() => setEditing(a)}
                          title="Modifier"
                        >
                          <Edit2 className="h-4 w-4" />
                        </Button>
                        <DeleteAssignmentBtn id={a.id} onError={setError} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Sélecteur de matière (étape 0 de la création) */}
      {picking && (
        <EcuePickerModal
          onClose={() => setPicking(false)}
          onPick={(ecue) => {
            setPicking(false);
            setCreatingFor({ subjectId: ecue.ecue_id, sessionId: ecue.ue_session_id });
          }}
        />
      )}

      {/* Création */}
      {creatingFor && (
        <AssignmentForm
          subjectId={creatingFor.subjectId}
          sessionId={creatingFor.sessionId}
          initial={null}
          onClose={() => setCreatingFor(null)}
          onError={setError}
        />
      )}

      {/* Édition */}
      {editing && (
        <AssignmentForm
          subjectId={editing.ecue_id}
          sessionId={editing.ue_session_id ?? undefined}
          initial={editing}
          onClose={() => setEditing(null)}
          onError={setError}
        />
      )}

      {/* Correction */}
      {gradingFor && (
        <GradingModal assignment={gradingFor} canManage onClose={() => setGradingFor(null)} />
      )}

      {/* Questions interactives */}
      {managingQuestionsFor && (
        <AssignmentQuestionsManager
          assignment={managingQuestionsFor}
          onClose={() => setManagingQuestionsFor(null)}
        />
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */

function StatCard({
  icon: Icon,
  label,
  value,
  color,
}: {
  icon: React.ElementType;
  label: string;
  value: number;
  color: "indigo" | "purple" | "blue" | "green";
}) {
  const colors: Record<string, string> = {
    indigo: "from-indigo-500 to-indigo-600",
    purple: "from-purple-500 to-purple-600",
    blue: "from-blue-500 to-blue-600",
    green: "from-green-500 to-green-600",
  };
  return (
    <Card className="shadow-sm">
      <CardContent className="p-4 flex items-center gap-3">
        <div className={`rounded-xl p-2.5 bg-gradient-to-br ${colors[color]} text-white`}>
          <Icon className="h-5 w-5" />
        </div>
        <div>
          <p className="text-2xl font-bold leading-none">{value}</p>
          <p className="text-xs text-muted-foreground mt-1">{label}</p>
        </div>
      </CardContent>
    </Card>
  );
}

/* -------------------------------------------------------------------------- */
/* Étape 0 : choix de la matière (ECUE) pour laquelle créer l'évaluation.     */
/* -------------------------------------------------------------------------- */

function EcuePickerModal({
  onClose,
  onPick,
}: {
  onClose: () => void;
  onPick: (ecue: TeacherEcue) => void;
}) {
  const ecueQuery = useTeacherEcue();
  const ecues: TeacherEcue[] = ecueQuery.data ?? [];
  const [search, setSearch] = useState("");

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return ecues;
    return ecues.filter((e) =>
      `${e.ecue_code} ${e.ecue_libelle} ${e.ue_code} ${e.ue_libelle} ${e.session_libelle ?? ""} ${
        e.filiere_nom ?? ""
      }`
        .toLowerCase()
        .includes(q)
    );
  }, [ecues, search]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="bg-background text-foreground border border-border rounded-lg shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 border-b">
          <div>
            <h3 className="font-semibold">Nouvelle évaluation</h3>
            <p className="text-xs text-muted-foreground">
              Choisissez d'abord la matière (ECUE) concernée
            </p>
          </div>
          <Button type="button" size="sm" variant="outline" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        </div>

        <div className="p-4 border-b">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Rechercher une matière, une cohorte…"
              className="pl-9"
              autoFocus
            />
          </div>
        </div>

        <div className="flex-1 overflow-auto p-4">
          {ecueQuery.isLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : filtered.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8">
              {ecues.length === 0
                ? "Aucune matière ne vous est affectée. Contactez l'administration."
                : "Aucune matière ne correspond à votre recherche."}
            </p>
          ) : (
            <div className="space-y-2">
              {filtered.map((e) => (
                <button
                  key={`${e.ue_session_id}-${e.ecue_id}`}
                  type="button"
                  onClick={() => onPick(e)}
                  className="w-full text-left p-3 border border-border rounded-lg hover:border-indigo-400 hover:bg-indigo-50/50 dark:hover:bg-indigo-950/20 transition-colors flex items-start justify-between gap-3"
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-[11px] text-indigo-600 bg-indigo-50 rounded px-1.5 py-0.5">
                        {e.ecue_code}
                      </span>
                      <span className="font-medium truncate">{e.ecue_libelle}</span>
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
                      <span className="inline-flex items-center gap-1">
                        <BookOpen className="h-3 w-3" />
                        {e.ue_code} — {e.ue_libelle}
                      </span>
                      <span className="inline-flex items-center gap-1">
                        <Layers className="h-3 w-3" />
                        {e.session_libelle ?? e.filiere_nom ?? "—"}
                      </span>
                    </div>
                  </div>
                  <Plus className="h-4 w-4 text-indigo-500 shrink-0 mt-1 rotate-45" />
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
