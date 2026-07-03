"use client";

import React, { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  AlertCircle,
  BookOpen,
  Users,
  CalendarDays,
  Layers,
  GraduationCap,
  Search,
  Eye,
  Loader2,
  Award,
} from "lucide-react";
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
import { useTeacherEcue, type TeacherEcue } from "@/lib/hooks/use-teacher-professional";

/**
 * Mes matières (ECUE) — Espace enseignant.
 * L'enseignant connecté voit les ECUE du Module Professionnel auxquelles il a
 * été affecté, avec leur contexte (UE, filière, période, statut) et un accès à
 * la gestion des séances de la session.
 */

function fmtDate(value?: string | null): string {
  if (!value) return "—";
  const d = new Date(value);
  return isNaN(d.getTime()) ? String(value) : d.toLocaleDateString("fr-FR");
}

export default function TeacherEcuePage() {
  const router = useRouter();
  const { data, isLoading, isError, error } = useTeacherEcue();
  const [search, setSearch] = useState("");
  const [statut, setStatut] = useState("all");

  const ecues: TeacherEcue[] = data ?? [];

  const stats = useMemo(() => {
    const filieres = new Set(ecues.map((e) => e.filiere_code).filter(Boolean));
    return {
      total: ecues.length,
      filieres: filieres.size,
      etudiants: ecues.reduce((a, e) => a + (e.nb_inscrits ?? 0), 0),
      seances: ecues.reduce((a, e) => a + (e.nb_seances ?? 0), 0),
    };
  }, [ecues]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return ecues.filter((e) => {
      const matchSearch =
        !q ||
        `${e.ecue_code} ${e.ecue_libelle} ${e.ue_code} ${e.ue_libelle} ${e.filiere_nom ?? ""} ${
          e.filiere_code ?? ""
        } ${e.session_libelle ?? ""}`
          .toLowerCase()
          .includes(q);
      const matchStatut = statut === "all" || e.statut === statut;
      return matchSearch && matchStatut;
    });
  }, [ecues, search, statut]);

  if (isLoading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <Loader2 className="h-10 w-10 animate-spin text-indigo-500" />
      </div>
    );
  }

  if (isError) {
    return (
      <div className="max-w-3xl mx-auto p-6">
        <Card className="border-red-200">
          <CardContent className="flex items-center gap-3 py-8 text-red-700">
            <AlertCircle className="h-6 w-6 shrink-0" />
            <p>{(error as Error)?.message ?? "Impossible de charger vos matières."}</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto p-6 space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold bg-gradient-to-r from-indigo-600 to-purple-600 bg-clip-text text-transparent">
          Mes matières (ECUE)
        </h1>
        <p className="text-muted-foreground mt-2">
          Les ECUE du Module Professionnel auxquelles vous avez été affecté.
        </p>
      </div>

      {/* Statistiques */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard icon={BookOpen} label="Matières affectées" value={stats.total} color="indigo" />
        <StatCard icon={Layers} label="Filières" value={stats.filieres} color="purple" />
        <StatCard icon={Users} label="Étudiants" value={stats.etudiants} color="blue" />
        <StatCard icon={CalendarDays} label="Séances" value={stats.seances} color="green" />
      </div>

      {/* Filtres */}
      <Card className="shadow-sm">
        <CardContent className="p-4 flex flex-col md:flex-row gap-3 md:items-center">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Rechercher une ECUE, une UE, une filière…"
              className="pl-9"
            />
          </div>
          <div className="w-full md:w-56">
            <Select value={statut} onValueChange={setStatut}>
              <SelectTrigger>
                <SelectValue placeholder="Statut" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Tous les statuts</SelectItem>
                <SelectItem value="ouvert">Ouverte</SelectItem>
                <SelectItem value="en_cours">En cours</SelectItem>
                <SelectItem value="termine">Terminée</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="text-sm text-muted-foreground whitespace-nowrap">
            <span className="font-medium text-foreground">{filtered.length}</span> matière
            {filtered.length > 1 ? "s" : ""}
          </div>
        </CardContent>
      </Card>

      {/* Liste */}
      {filtered.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center text-center py-16 gap-3">
            <div className="rounded-full bg-indigo-50 p-4">
              <GraduationCap className="h-8 w-8 text-indigo-500" />
            </div>
            <h3 className="text-lg font-semibold">
              {ecues.length === 0
                ? "Aucune matière affectée"
                : "Aucune matière ne correspond"}
            </h3>
            <p className="text-muted-foreground max-w-md">
              {ecues.length === 0
                ? "Vous n'êtes affecté à aucune ECUE pour le moment. Contactez l'administration."
                : "Essayez d'ajuster votre recherche ou le filtre de statut."}
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {filtered.map((e) => {
            return (
              <Card
                key={`${e.ue_session_id}-${e.ecue_id}`}
                className="shadow-sm hover:shadow-md transition-shadow overflow-hidden flex flex-col"
              >
                <div className="h-1.5 bg-gradient-to-r from-indigo-500 to-purple-500" />
                <CardContent className="p-5 flex flex-col gap-3 flex-1">
                  <div className="min-w-0">
                    <span className="font-mono text-[11px] text-indigo-600 bg-indigo-50 rounded px-1.5 py-0.5">
                      {e.ecue_code}
                    </span>
                    <h3 className="font-semibold text-foreground mt-1.5 leading-snug">
                      {e.ecue_libelle}
                    </h3>
                  </div>

                  <div className="space-y-1.5 text-sm text-muted-foreground">
                    <div className="flex items-center gap-2">
                      <BookOpen className="h-4 w-4 text-muted-foreground shrink-0" />
                      <span className="truncate">
                        <span className="font-mono text-xs">{e.ue_code}</span> — {e.ue_libelle}
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <Layers className="h-4 w-4 text-muted-foreground shrink-0" />
                      <span className="truncate">
                        {e.filiere_nom}
                        {e.filiere_code ? ` (${e.filiere_code})` : ""}
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <CalendarDays className="h-4 w-4 text-muted-foreground shrink-0" />
                      <span>
                        {fmtDate(e.date_debut)} → {fmtDate(e.date_fin)}
                      </span>
                    </div>
                  </div>

                  <div className="flex flex-wrap gap-3 text-xs text-muted-foreground mt-auto pt-2 border-t border-border">
                    <span className="inline-flex items-center gap-1">
                      <Award className="h-3.5 w-3.5" />
                      {e.credits ?? "—"} crédit{(e.credits ?? 0) > 1 ? "s" : ""}
                    </span>
                    <span className="inline-flex items-center gap-1">
                      <Users className="h-3.5 w-3.5" />
                      {e.nb_inscrits} étudiant{e.nb_inscrits > 1 ? "s" : ""}
                    </span>
                    <span className="inline-flex items-center gap-1">
                      <CalendarDays className="h-3.5 w-3.5" />
                      {e.nb_seances} séance{e.nb_seances > 1 ? "s" : ""}
                    </span>
                  </div>

                  <Button
                    className="w-full mt-1 bg-gradient-to-r from-indigo-500 to-purple-600 hover:from-indigo-600 hover:to-purple-700 text-white"
                    onClick={() => router.push(`/teacher/courses/${e.ue_session_id}`)}
                  >
                    <Eye className="h-4 w-4 mr-2" />
                    Gérer (séances & présence)
                  </Button>
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
