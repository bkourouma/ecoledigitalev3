"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Users, Search, Layers, Loader2, AlertCircle, Mail, GraduationCap, Eye } from "lucide-react";
import { Card, CardContent, Input } from "@ecoledigitale/ui";
import { SearchableSelect } from "@/components/SearchableSelect";
import { useTeacherStudents } from "@/lib/hooks/use-professional-teacher";

/**
 * Mes Étudiants — Espace enseignant (Module Professionnel).
 * Affiche tous les étudiants de l'enseignant (selon ses ECUE affectées),
 * filtrables par filière. Une carte colorée par étudiant, 3 par ligne.
 */

const CARD_GRADIENT = "from-violet-500 via-purple-500 to-purple-600";

export default function TeacherStudentsPage() {
  const router = useRouter();
  const { data, isLoading, isError, error } = useTeacherStudents();
  const [filiere, setFiliere] = useState("all");
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

  // Un étudiant unique par carte (dédoublonné, filières agrégées).
  const students = useMemo(() => {
    const s = search.trim().toLowerCase();
    const map = new Map<string, any>();
    for (const r of rows) {
      if (filiere !== "all" && r.filiere_id !== filiere) continue;
      if (
        s &&
        !`${r.first_name} ${r.last_name} ${r.matricule ?? ""} ${r.email ?? ""}`
          .toLowerCase()
          .includes(s)
      )
        continue;
      let st = map.get(r.student_id);
      if (!st) {
        st = {
          student_id: r.student_id,
          first_name: r.first_name,
          last_name: r.last_name,
          email: r.email,
          phone: r.phone,
          matricule: r.matricule,
          filieres: new Set<string>(),
        };
        map.set(r.student_id, st);
      }
      if (r.filiere_code) st.filieres.add(r.filiere_code);
    }
    return Array.from(map.values()).sort((a, b) =>
      `${a.last_name} ${a.first_name}`.localeCompare(`${b.last_name} ${b.first_name}`, "fr")
    );
  }, [rows, filiere, search]);

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
            <p>{(error as Error)?.message ?? "Impossible de charger vos étudiants."}</p>
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
          <Users className="h-7 w-7 text-purple-500" />
          Mes Étudiants
        </h1>
        <p className="text-muted-foreground mt-2">
          Tous les étudiants de vos sessions actives, selon les ECUE qui vous sont affectées.
        </p>
      </div>

      {/* Filtres : filière + recherche */}
      <Card className="shadow-sm">
        <CardContent className="p-4 flex flex-col lg:flex-row gap-3 lg:items-center">
          <div className="flex-1 min-w-0">
            <SearchableSelect
              value={filiere}
              onChange={setFiliere}
              icon={<Layers className="h-4 w-4 text-gray-400" />}
              placeholder="Toutes les filières"
              searchPlaceholder="Rechercher une filière…"
              options={[{ value: "all", label: "Toutes les filières" }, ...filiereOptions]}
            />
          </div>
          <div className="relative lg:w-72">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Rechercher un étudiant…"
              className="pl-9"
            />
          </div>
          <div className="text-sm text-muted-foreground whitespace-nowrap">
            <span className="font-medium text-foreground">{students.length}</span> étudiant
            {students.length > 1 ? "s" : ""}
          </div>
        </CardContent>
      </Card>

      {/* Cartes étudiants (3 par ligne) */}
      {students.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center text-center py-16 gap-3">
            <div className="rounded-full bg-purple-50 p-4">
              <GraduationCap className="h-8 w-8 text-purple-500" />
            </div>
            <p className="text-muted-foreground max-w-md">
              {rows.length === 0
                ? "Aucun étudiant : aucune session active avec des inscrits sur vos ECUE."
                : "Aucun étudiant ne correspond à ces filtres."}
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {students.map((s) => (
            <div
              key={s.student_id}
              className={`bg-gradient-to-br ${CARD_GRADIENT} p-6 rounded-xl shadow-lg hover:shadow-xl transition-all duration-300 text-white relative overflow-hidden group flex flex-col`}
            >
              <div className="relative z-10 flex flex-col flex-1">
                <h3 className="font-semibold text-lg leading-snug">
                  {s.last_name} {s.first_name}
                </h3>
                {s.matricule && (
                  <span className="font-mono text-[11px] bg-white/20 rounded px-1.5 py-0.5 w-fit mt-1">
                    {s.matricule}
                  </span>
                )}
                <div className="mt-3 space-y-1.5 text-sm text-white/90">
                  {s.email && (
                    <p className="flex items-center gap-2 truncate">
                      <Mail className="h-4 w-4 shrink-0" />
                      {s.email}
                    </p>
                  )}
                  <p className="flex items-center gap-2">
                    <Layers className="h-4 w-4 shrink-0" />
                    {Array.from(s.filieres).join(", ") || "—"}
                  </p>
                </div>

                <button
                  type="button"
                  onClick={() => router.push(`/teacher/students/${s.student_id}`)}
                  className="mt-4 w-full inline-flex items-center justify-center gap-2 bg-white/20 hover:bg-white/30 border border-white/20 transition-colors rounded-lg py-2 text-sm font-medium"
                >
                  <Eye className="h-4 w-4" />
                  Voir les détails
                </button>
              </div>

              {/* Décor de fond */}
              <div className="absolute top-0 right-0 w-28 h-28 bg-white/10 rounded-full transform translate-x-14 -translate-y-14 group-hover:scale-110 transition-transform duration-500" />
              <div className="absolute bottom-0 left-0 w-20 h-20 bg-white/5 rounded-full transform -translate-x-10 translate-y-10 group-hover:scale-110 transition-transform duration-500" />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
