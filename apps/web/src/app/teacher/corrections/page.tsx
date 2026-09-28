"use client";

import { useMemo, useState } from "react";
import { useSession } from "next-auth/react";
import { redirect } from "next/navigation";
import Link from "next/link";
import {
  Card,
  CardContent,
  Button,
  Badge,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@ecoledigitale/ui";
import {
  ClipboardList,
  Loader2,
  AlertCircle,
  FileText,
  BookOpen,
  Brain,
  Layers,
  GraduationCap,
  ClipboardCheck,
  Hourglass,
  ExternalLink,
  Download,
} from "lucide-react";
import { useTeacherAssignments } from "@/lib/hooks/use-professional-teacher";
import {
  GradingModal,
  EVALUATION_TYPE_LABEL,
} from "@/components/professional/ProfessionalAssignmentsPanel";

/**
 * Corrections — espace enseignant (Module Professionnel, feature 030).
 *
 * Vue transversale des évaluations de l'enseignant connecté : tous ses devoirs
 * et examens (toutes filières / UE / ECUE confondues) avec le nombre de copies
 * soumises, notées et **en attente de correction** (soumises non notées). La
 * correction se fait via le même `GradingModal` que l'onglet « Évaluations »
 * d'une session. Données scopées côté serveur (ECUE affectées à l'enseignant).
 */

const ALL = "all";

/** Copies en attente de correction (soumises mais pas encore notées). */
function pendingOf(a: any): number {
  return Math.max(0, (a?.nb_soumis ?? 0) - (a?.nb_notes ?? 0));
}

function fmtDate(value?: string | null): string {
  if (!value) return "—";
  const d = new Date(value);
  return isNaN(d.getTime())
    ? String(value)
    : d.toLocaleString("fr-FR", {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      });
}

/** Badge du type d'évaluation (en ligne / PDF / IA). */
function EvalTypeBadge({ type }: { type: string }) {
  const cls =
    type === "online"
      ? "border-green-500/40 bg-green-500/15 text-green-400"
      : type === "ai_generated"
      ? "border-purple-500/40 bg-purple-500/15 text-purple-400"
      : "border-blue-500/40 bg-blue-500/15 text-blue-400";
  const Icon = type === "online" ? BookOpen : type === "ai_generated" ? Brain : FileText;
  return (
    <Badge variant="outline" className={cls}>
      <Icon className="h-3 w-3 mr-1" />
      {EVALUATION_TYPE_LABEL[type] ?? "—"}
    </Badge>
  );
}

/** Badge de la nature (Devoir / Examen). */
function NatureBadge({ type }: { type: string }) {
  return type === "examen" ? (
    <Badge variant="outline" className="border-amber-500/40 bg-amber-500/15 text-amber-300">
      Examen
    </Badge>
  ) : (
    <Badge variant="outline" className="border-sky-500/40 bg-sky-500/15 text-sky-300">
      Devoir
    </Badge>
  );
}

export default function TeacherCorrectionsPage() {
  const { data: session, status } = useSession();
  const query = useTeacherAssignments();
  const assignments: any[] = (query.data as any[]) ?? [];

  const [filiereFilter, setFiliereFilter] = useState<string>(ALL);
  const [ecueFilter, setEcueFilter] = useState<string>(ALL);
  // Par défaut : uniquement les évaluations avec des copies à corriger.
  const [correctionFilter, setCorrectionFilter] = useState<string>("pending");
  const [gradingFor, setGradingFor] = useState<any | null>(null);

  // Options filière (distinctes) présentes dans les évaluations.
  const filiereOptions = useMemo(() => {
    const map = new Map<string, string>();
    for (const a of assignments) {
      if (a.filiere_id) map.set(a.filiere_id, a.filiere_nom ?? a.filiere_code ?? a.filiere_id);
    }
    return Array.from(map, ([value, label]) => ({ value, label })).sort((x, y) =>
      x.label.localeCompare(y.label, "fr")
    );
  }, [assignments]);

  // Options ECUE (matières), restreintes à la filière choisie — sans le code.
  const ecueOptions = useMemo(() => {
    const map = new Map<string, string>();
    for (const a of assignments) {
      if (!a.ecue_id) continue;
      if (filiereFilter !== ALL && a.filiere_id !== filiereFilter) continue;
      map.set(a.ecue_id, a.ecue_libelle ?? "ECUE");
    }
    return Array.from(map, ([value, label]) => ({ value, label })).sort((x, y) =>
      x.label.localeCompare(y.label, "fr")
    );
  }, [assignments, filiereFilter]);

  // Statistiques globales (workload de l'enseignant), indépendantes des filtres.
  const stats = useMemo(() => {
    let copies = 0;
    let evals = 0;
    let devoirs = 0;
    let examens = 0;
    for (const a of assignments) {
      const p = pendingOf(a);
      if (p > 0) {
        copies += p;
        evals += 1;
        if (a.type === "examen") examens += 1;
        else devoirs += 1;
      }
    }
    return { copies, evals, devoirs, examens };
  }, [assignments]);

  const filtered = useMemo(() => {
    return assignments
      .filter((a) => {
        const pending = pendingOf(a);
        if (correctionFilter === "pending" && pending <= 0) return false;
        if (correctionFilter === "done" && !(a.nb_soumis > 0 && pending === 0)) return false;
        if (filiereFilter !== ALL && a.filiere_id !== filiereFilter) return false;
        if (ecueFilter !== ALL && a.ecue_id !== ecueFilter) return false;
        return true;
      })
      .sort((a, b) => {
        // À corriger d'abord (décroissant), puis échéance la plus proche.
        const pd = pendingOf(b) - pendingOf(a);
        if (pd !== 0) return pd;
        const da = a.due_at ? new Date(a.due_at).getTime() : Infinity;
        const db = b.due_at ? new Date(b.due_at).getTime() : Infinity;
        return da - db;
      });
  }, [assignments, filiereFilter, ecueFilter, correctionFilter]);

  function handleExport() {
    const BOM = "﻿";
    const headers = [
      "Évaluation",
      "Nature",
      "Type",
      "Filière",
      "UE",
      "ECUE",
      "Échéance",
      "Soumis",
      "Notés",
      "À corriger",
      "Statut",
    ];
    const esc = (v: any) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const lines = filtered.map((a) =>
      [
        a.titre,
        a.type === "examen" ? "Examen" : "Devoir",
        EVALUATION_TYPE_LABEL[a.evaluation_type] ?? a.evaluation_type,
        a.filiere_nom ?? a.filiere_code ?? "",
        `${a.ue_code ?? ""} ${a.ue_libelle ?? ""}`.trim(),
        `${a.ecue_code ?? ""} ${a.ecue_libelle ?? ""}`.trim(),
        a.due_at ? fmtDate(a.due_at) : "",
        a.nb_soumis ?? 0,
        a.nb_notes ?? 0,
        pendingOf(a),
        a.statut ?? "",
      ]
        .map(esc)
        .join(",")
    );
    const csv = BOM + [headers.map(esc).join(","), ...lines].join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `corrections_${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }

  if (status === "loading") {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-32 w-32 border-b-2 border-green-500" />
      </div>
    );
  }
  if (!session) {
    redirect("/login");
  }

  return (
    <div className="space-y-8 max-w-7xl mx-auto p-6">
      {/* Header */}
      <div className="mb-6 flex max-w-full flex-col items-start gap-2 overflow-x-auto md:gap-3">
        <div>
          <h1 className="font-bold bg-gradient-to-r from-green-600 to-blue-600 bg-clip-text text-transparent flex items-center gap-3 whitespace-nowrap text-2xl leading-tight md:text-3xl">
            <ClipboardCheck className="h-8 w-8 text-green-500 shrink-0" />
            Corrections
          </h1>
          <p className="text-muted-foreground whitespace-nowrap text-sm md:text-base">
            Tous vos devoirs et examens en attente de correction, toutes filières
            et unités d'enseignement confondues.
          </p>
        </div>
        <Button
          variant="outline"
          onClick={handleExport}
          disabled={filtered.length === 0}
        >
          <Download className="h-4 w-4 mr-2" />
          Exporter CSV
        </Button>
      </div>

      {/* Statistiques */}
      {!query.isLoading && !query.isError && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-6">
          <StatCard
            icon={<Hourglass className="h-6 w-6 text-amber-400" />}
            iconBg="bg-amber-500/15"
            label="Copies à corriger"
            value={stats.copies}
          />
          <StatCard
            icon={<ClipboardList className="h-6 w-6 text-indigo-400" />}
            iconBg="bg-indigo-500/15"
            label="Évaluations concernées"
            value={stats.evals}
          />
          <StatCard
            icon={<FileText className="h-6 w-6 text-sky-400" />}
            iconBg="bg-sky-500/15"
            label="Devoirs en attente"
            value={stats.devoirs}
          />
          <StatCard
            icon={<GraduationCap className="h-6 w-6 text-purple-400" />}
            iconBg="bg-purple-500/15"
            label="Examens en attente"
            value={stats.examens}
          />
        </div>
      )}

      {/* Filtres */}
      <Card>
        <CardContent className="p-4">
          <div className="flex flex-col gap-4">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <Select
                value={filiereFilter}
                onValueChange={(v) => {
                  setFiliereFilter(v);
                  setEcueFilter(ALL);
                }}
              >
                <SelectTrigger>
                  <Layers className="h-4 w-4 mr-2 text-muted-foreground" />
                  <SelectValue placeholder="Filière" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL}>Toutes les filières</SelectItem>
                  {filiereOptions.map((f) => (
                    <SelectItem key={f.value} value={f.value}>
                      {f.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={ecueFilter} onValueChange={setEcueFilter}>
                <SelectTrigger>
                  <BookOpen className="h-4 w-4 mr-2 text-muted-foreground" />
                  <SelectValue placeholder="ECUE" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL}>Toutes les ECUE</SelectItem>
                  {ecueOptions.map((s) => (
                    <SelectItem key={s.value} value={s.value}>
                      {s.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={correctionFilter} onValueChange={setCorrectionFilter}>
                <SelectTrigger>
                  <SelectValue placeholder="État" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="pending">À corriger</SelectItem>
                  <SelectItem value="done">Corrigées</SelectItem>
                  <SelectItem value={ALL}>Toutes</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Contenu */}
      {query.isLoading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="h-8 w-8 animate-spin text-green-500" />
          <span className="ml-2 text-lg text-muted-foreground">
            Chargement des corrections…
          </span>
        </div>
      ) : query.isError ? (
        <Card>
          <CardContent className="p-6 text-center">
            <AlertCircle className="h-12 w-12 text-red-400 mx-auto mb-4" />
            <h3 className="text-lg font-semibold text-foreground mb-2">Erreur</h3>
            <p className="text-muted-foreground mb-4">
              {(query.error as Error)?.message ??
                "Impossible de charger les évaluations."}
            </p>
            <Button onClick={() => query.refetch()}>Réessayer</Button>
          </CardContent>
        </Card>
      ) : filtered.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-16 text-center gap-3">
            <div className="bg-gradient-to-br from-green-500/20 to-blue-500/20 rounded-full w-20 h-20 flex items-center justify-center">
              <ClipboardCheck className="h-10 w-10 text-green-400" />
            </div>
            <h3 className="text-xl font-semibold text-foreground">
              {correctionFilter === "pending"
                ? "Aucune copie en attente de correction"
                : "Aucune évaluation trouvée"}
            </h3>
            <p className="text-muted-foreground max-w-md">
              {correctionFilter === "pending"
                ? "Toutes les copies soumises ont été corrigées. Les nouvelles soumissions apparaîtront ici."
                : "Aucune évaluation ne correspond aux filtres sélectionnés."}
            </p>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-muted-foreground">Évaluation</TableHead>
                    <TableHead className="text-muted-foreground">Nature</TableHead>
                    <TableHead className="text-muted-foreground">Filière / UE / ECUE</TableHead>
                    <TableHead className="text-muted-foreground whitespace-nowrap">Échéance</TableHead>
                    <TableHead className="text-muted-foreground text-center">Soumis</TableHead>
                    <TableHead className="text-muted-foreground text-center">Notés</TableHead>
                    <TableHead className="text-muted-foreground text-center">À corriger</TableHead>
                    <TableHead className="text-muted-foreground text-right">Action</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map((a) => {
                    const pending = pendingOf(a);
                    return (
                      <TableRow key={a.id}>
                        <TableCell>
                          <button
                            type="button"
                            onClick={() => setGradingFor(a)}
                            className="font-medium text-foreground hover:text-green-500 text-left"
                          >
                            {a.titre}
                          </button>
                          <div className="mt-1">
                            <EvalTypeBadge type={a.evaluation_type} />
                          </div>
                        </TableCell>
                        <TableCell>
                          <NatureBadge type={a.type} />
                        </TableCell>
                        <TableCell>
                          <div className="text-sm text-foreground">
                            {a.ecue_libelle ?? a.ecue_code ?? "—"}
                          </div>
                          <div className="text-xs text-muted-foreground">
                            {[a.filiere_code ?? a.filiere_nom, a.ue_code ?? a.ue_libelle]
                              .filter(Boolean)
                              .join(" · ") || "—"}
                          </div>
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground whitespace-nowrap">
                          {fmtDate(a.due_at)}
                        </TableCell>
                        <TableCell className="text-center font-mono">{a.nb_soumis ?? 0}</TableCell>
                        <TableCell className="text-center font-mono text-emerald-400">
                          {a.nb_notes ?? 0}
                        </TableCell>
                        <TableCell className="text-center">
                          {pending > 0 ? (
                            <Badge
                              variant="outline"
                              className="border-amber-500/40 bg-amber-500/15 text-amber-300 font-mono"
                            >
                              {pending}
                            </Badge>
                          ) : (a.nb_soumis ?? 0) > 0 ? (
                            <Badge
                              variant="outline"
                              className="border-emerald-500/40 bg-emerald-500/15 text-emerald-300"
                            >
                              À jour
                            </Badge>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </TableCell>
                        <TableCell className="text-right whitespace-nowrap">
                          <Button
                            size="sm"
                            onClick={() => setGradingFor(a)}
                            className="bg-gradient-to-r from-green-500 to-blue-600 hover:from-green-600 hover:to-blue-700 text-white"
                          >
                            <ClipboardList className="h-4 w-4 mr-1.5" />
                            Corriger
                          </Button>
                          {a.ue_session_id && (
                            <Button
                              asChild
                              size="sm"
                              variant="outline"
                              className="ml-1"
                              title="Ouvrir la session"
                            >
                              <Link href={`/teacher/courses/${a.ue_session_id}`}>
                                <ExternalLink className="h-4 w-4" />
                              </Link>
                            </Button>
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Modale de correction (réutilisée de l'onglet Évaluations) */}
      {gradingFor && (
        <GradingModal
          assignment={gradingFor}
          canManage
          onClose={() => setGradingFor(null)}
        />
      )}
    </div>
  );
}

/* --------------------------------------------------------------------- */

function StatCard({
  icon,
  iconBg,
  label,
  value,
}: {
  icon: React.ReactNode;
  iconBg: string;
  label: string;
  value: number | string;
}) {
  return (
    <Card>
      <CardContent className="p-6">
        <div className="flex items-center">
          <div className={`p-2 rounded-lg shrink-0 ${iconBg}`}>{icon}</div>
          <div className="ml-4 min-w-0">
            <p className="text-sm font-medium text-muted-foreground">{label}</p>
            <p className="text-2xl font-bold text-foreground">{value}</p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
