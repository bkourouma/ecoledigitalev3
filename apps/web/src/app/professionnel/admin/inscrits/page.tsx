"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent, Button, Input } from "@ecoledigitale/ui";
import { Users, Search, Layers, Eye, Loader2, Calendar } from "lucide-react";
import { SearchableSelect } from "@/components/SearchableSelect";
import { ExportButtons } from "@/components/ExportButtons";
import { openInscritsPdf } from "@/lib/utils/inscrits-report";
import { useAllAdminEnrollments } from "@/lib/hooks/use-professional-suivi";

/**
 * Étudiants inscrits — Module Professionnel (admin).
 * Liste en cartes (3/ligne) de toutes les inscriptions, filtrables par filière
 * et année scolaire. Le détail d'un binôme étudiant + filière s'ouvre sur sa
 * propre page (`inscrits/etudiant/[studentId]/[filiereId]`).
 */

/** Statut résumé d'un groupe d'inscriptions (cumul des UE). */
function groupStatut(g: any): { label: string; cls: string } {
  const total = g.enrollments.length;
  const confirmed = g.enrollments.filter(
    (e: any) => e.statut === "confirmee" || e.statut === "terminee"
  ).length;
  if (confirmed === 0) return { label: "En attente paiement", cls: "bg-amber-100 text-amber-700" };
  if (confirmed === total) return { label: "Confirmée", cls: "bg-green-100 text-green-700" };
  return { label: `${confirmed}/${total} confirmées`, cls: "bg-blue-100 text-blue-700" };
}
/**
 * Année scolaire (pivot septembre) dérivée de la date de début de la session,
 * alignée sur le calcul côté API (professional-bulletin.service.ts) et sur la page
 * Sessions : une session démarrant en septembre ou après appartient à
 * « AAAA-AAAA+1 », sinon « AAAA-1-AAAA ».
 */
function anneeScolaireOf(v?: string | null): string | null {
  if (!v) return null;
  const d = new Date(v);
  if (isNaN(d.getTime())) return null;
  const y = d.getFullYear();
  return d.getMonth() + 1 >= 9 ? `${y}-${y + 1}` : `${y - 1}-${y}`;
}

/**
 * Nom de la classe porté par une inscription : le libellé de la session,
 * amputé de son suffixe « — CODE UE ». C'est ce nom qu'on filtre, et non la
 * classe : une classe peut en porter plusieurs.
 */
function nomDeClasseOf(e: any): string {
  const lib = String(e.session_libelle ?? "").trim();
  const code = String(e.ue_code ?? "").trim();
  if (code && lib.endsWith(code)) {
    return lib.slice(0, lib.length - code.length).replace(/[\s—–-]+$/u, "").trim() || lib;
  }
  return lib;
}

/** Clé de sélection d'un nom de classe : « classe|nom ». */
function nomKeyOf(e: any): string {
  return `${e.filiere_id}|${nomDeClasseOf(e)}`;
}

export default function ProfessionalInscritsPage() {
  const query = useAllAdminEnrollments();

  const router = useRouter();
  const items: any[] = (query.data as any)?.items ?? [];
  const [nomKey, setNomKey] = useState("all");
  const [annee, setAnnee] = useState("all");
  const [search, setSearch] = useState("");

  // Noms de classe de l'année choisie. L'année commande la liste, et non
  // l'inverse : c'est elle qu'on sélectionne en premier.
  const nomOptions = useMemo(() => {
    const map = new Map<string, string>();
    for (const e of items) {
      if (!e.filiere_id) continue;
      if (annee !== "all" && anneeScolaireOf(e.date_debut) !== annee) continue;
      map.set(nomKeyOf(e), nomDeClasseOf(e));
    }
    return Array.from(map.entries())
      .map(([value, label]) => ({ value, label }))
      .sort((a, b) => a.label.localeCompare(b.label, "fr"));
  }, [items, annee]);

  // Années scolaires disponibles (dérivées de la date de début des sessions),
  // adaptées à la filière sélectionnée. Plus récentes en premier.
  const anneeOptions = useMemo(() => {
    const set = new Set<string>();
    for (const e of items) {
      const a = anneeScolaireOf(e.date_debut);
      if (a) set.add(a);
    }
    return Array.from(set)
      .sort((a, b) => b.localeCompare(a))
      .map((value) => ({ value, label: value }));
  }, [items]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return items.filter((e) => {
      const matchFil = nomKey === "all" || nomKeyOf(e) === nomKey;
      const matchAnnee = annee === "all" || anneeScolaireOf(e.date_debut) === annee;
      const hay = `${e.first_name ?? ""} ${e.last_name ?? ""} ${e.matricule ?? ""} ${e.email ?? ""}`.toLowerCase();
      return matchFil && matchAnnee && (!q || hay.includes(q));
    });
  }, [items, nomKey, annee, search]);

  // Si la filière change et que l'année sélectionnée n'existe plus dans les
  // options, on revient à « Toutes les années ».
  // Changer d'année peut faire disparaître le nom retenu de la liste.
  useEffect(() => {
    if (nomKey !== "all" && !nomOptions.some((o) => o.value === nomKey)) setNomKey("all");
  }, [nomOptions, nomKey]);

  // Regroupe les inscriptions par étudiant + filière (une carte par binôme).
  // Un même étudiant dans deux filières = deux cartes distinctes.
  const groups = useMemo(() => {
    const map = new Map<string, any>();
    for (const e of filtered) {
      const key = `${e.student_id}|${e.filiere_id}`;
      let g = map.get(key);
      if (!g) {
        g = {
          key,
          student_id: e.student_id,
          filiere_id: e.filiere_id,
          first_name: e.first_name,
          last_name: e.last_name,
          matricule: e.matricule,
          filiere_nom: e.filiere_nom,
          filiere_code: e.filiere_code,
          enrollments: [] as any[],
        };
        map.set(key, g);
      }
      g.enrollments.push(e);
    }
    return Array.from(map.values()).sort((a, b) =>
      `${a.last_name} ${a.first_name}`.localeCompare(`${b.last_name} ${b.first_name}`)
    );
  }, [filtered]);

  const [exportErreur, setExportErreur] = useState<string | null>(null);

  /** Périmètre exporté : exactement les cartes affichées, filtres compris. */
  const exportOptions = useMemo(
    () => ({
      annee: annee === "all" ? "Toutes les années" : annee,
      nomClasse:
        nomKey === "all"
          ? "Tous les noms de classe"
          : (nomOptions.find((o) => o.value === nomKey)?.label ?? nomKey),
      recherche: search.trim() || undefined,
      statutOf: (g: any) => groupStatut(g).label,
    }),
    [annee, nomKey, nomOptions, search]
  );

  // La suppression d'une inscription se fait depuis sa fiche détaillée
  // (/professionnel/admin/inscrits/[id]), plus depuis cette liste.

  if (query.isLoading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <Loader2 className="h-10 w-10 animate-spin text-indigo-500" />
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto p-6 space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-3xl font-bold bg-gradient-to-r from-indigo-600 to-blue-600 bg-clip-text text-transparent flex items-center gap-2">
            <Users className="h-7 w-7 text-indigo-500" />
            Étudiants inscrits
          </h1>
          <p className="text-muted-foreground mt-2">
            Toutes les inscriptions aux sessions du Module Professionnel.
          </p>
        </div>
        <div className="flex gap-2 shrink-0">
          <ExportButtons
            formats={["pdf"]}
            disabled={query.isLoading || groups.length === 0}
            onExportPdf={(win) => openInscritsPdf(groups, exportOptions, win)}
            onError={setExportErreur}
          />
        </div>
      </div>

      {exportErreur && (
        <div className="rounded-md border border-red-300 bg-red-50 px-4 py-2 text-sm text-red-700">
          {exportErreur}
        </div>
      )}

      {query.isError && (
        <div className="rounded-md border border-red-300 bg-red-50 px-4 py-2 text-sm text-red-700">
          {(query.error as Error)?.message ?? "Erreur lors du chargement des inscriptions."}
        </div>
      )}

      {/* Filtres */}
      <Card className="shadow-sm">
        <CardContent className="p-4 space-y-3">
          {/* Rangée du haut : filière + année scolaire */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1.5 block">
                Année scolaire
              </label>
              <SearchableSelect
                value={annee}
                onChange={setAnnee}
                icon={<Calendar className="h-4 w-4 text-gray-400" />}
                placeholder="Filtrer par année scolaire"
                searchPlaceholder="Rechercher une année…"
                options={[{ value: "all", label: "Toutes les années" }, ...anneeOptions]}
              />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1.5 block">Nom de classe</label>
              <SearchableSelect
                value={nomKey}
                onChange={setNomKey}
                icon={<Layers className="h-4 w-4 text-gray-400" />}
                placeholder="Filtrer par nom de classe"
                searchPlaceholder="Rechercher un nom de classe…"
                options={[{ value: "all", label: "Tous les noms de classe" }, ...nomOptions]}
              />
            </div>
          </div>

          {/* La recherche occupe sa propre ligne, pleine largeur, sous les deux sélecteurs. */}
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1.5 block">
              Rechercher un étudiant
            </label>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Nom ou matricule…"
                className="pl-9"
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Cartes regroupées par étudiant + filière */}
      {groups.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center text-center py-16 gap-3">
            <div className="rounded-full bg-indigo-50 p-4">
              <Users className="h-8 w-8 text-indigo-500" />
            </div>
            <h3 className="text-lg font-semibold">Aucune inscription</h3>
            <p className="text-muted-foreground max-w-md">
              {items.length === 0
                ? "Aucun étudiant n'est encore inscrit à une session."
                : "Aucune inscription ne correspond à votre recherche."}
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {groups.map((g) => (
            <div
              key={g.key}
              className="bg-gradient-to-br from-blue-500 via-purple-500 to-purple-600 p-6 rounded-xl shadow-lg hover:shadow-xl transition-all duration-300 text-white relative overflow-hidden group flex flex-col"
            >
              <div className="relative z-10 flex flex-col gap-3 flex-1">
                {/* En-tête étudiant */}
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <h3 className="font-semibold text-lg leading-snug">
                      {g.first_name} {g.last_name}
                    </h3>
                    {g.matricule && (
                      <span className="font-mono text-[11px] text-white bg-white/20 rounded px-1.5 py-0.5">
                        {g.matricule}
                      </span>
                    )}
                  </div>
                  <span className="shrink-0 rounded-full px-2 py-0.5 text-xs font-medium bg-white/20 text-white border border-white/20 whitespace-nowrap">
                    {groupStatut(g).label}
                  </span>
                </div>

                <div className="flex items-center gap-2 text-sm text-white/90">
                  <Layers className="h-4 w-4 shrink-0" />
                  <span className="truncate">
                    {g.filiere_nom}
                    {g.filiere_code ? ` (${g.filiere_code})` : ""}
                  </span>
                </div>


                <Button
                  variant="secondary"
                  className="w-full mt-auto bg-white/20 hover:bg-white/30 text-white border-white/20 hover:border-white/30 transition-all duration-200"
                  onClick={() =>
                    router.push(
                      `/professionnel/admin/inscrits/etudiant/${g.student_id}/${g.filiere_id}`
                    )
                  }
                  title="Voir le détail de la classe"
                >
                  <Eye className="h-4 w-4 mr-2" />
                  Détails
                </Button>
              </div>

              {/* Décor de fond */}
              <div className="absolute top-0 right-0 w-32 h-32 bg-white/10 rounded-full transform translate-x-16 -translate-y-16 group-hover:scale-110 transition-transform duration-500" />
              <div className="absolute bottom-0 left-0 w-24 h-24 bg-white/5 rounded-full transform -translate-x-12 translate-y-12 group-hover:scale-110 transition-transform duration-500" />
            </div>
          ))}
        </div>
      )}

    </div>
  );
}
