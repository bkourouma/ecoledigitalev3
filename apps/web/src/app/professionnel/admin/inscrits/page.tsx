"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent, Button, Input } from "@ecoledigitale/ui";
import {
  Users,
  Search,
  Layers,
  Eye,
  Edit,
  Trash2,
  X,
  Loader2,
  AlertCircle,
  Mail,
  Phone,
  Calendar,
  MapPin,
  GraduationCap,
  Receipt,
} from "lucide-react";
import { SearchableSelect } from "@/components/SearchableSelect";
import {
  useAllAdminEnrollments,
  useUpdateEnrollment,
  useDeleteEnrollment,
} from "@/lib/hooks/use-professional-suivi";
import { useStudent } from "@/lib/hooks/use-students";

/**
 * Étudiants inscrits — Module Professionnel (admin).
 * Liste en cartes (3/ligne) de toutes les inscriptions, filtrables par filière,
 * avec actions voir / modifier le statut / supprimer.
 */

const STATUT: Record<string, { label: string; cls: string }> = {
  en_attente_paiement: { label: "En attente paiement", cls: "bg-amber-100 text-amber-700" },
  confirmee: { label: "Confirmée", cls: "bg-green-100 text-green-700" },
  terminee: { label: "Terminée", cls: "bg-blue-100 text-blue-700" },
  annulee: { label: "Annulée", cls: "bg-gray-100 text-gray-600" },
};
// Dégradé de carte par statut (aligné sur les cartes Sessions).
const STATUT_GRADIENT: Record<string, string> = {
  en_attente_paiement: "from-amber-500 via-orange-500 to-red-500",
  confirmee: "from-green-500 via-teal-500 to-blue-500",
  terminee: "from-blue-500 via-indigo-500 to-purple-500",
  annulee: "from-gray-400 via-gray-500 to-gray-600",
};
const STATUT_OPTIONS = ["en_attente_paiement", "confirmee", "terminee", "annulee"];

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
function fmtDate(v?: string | null): string {
  if (!v) return "—";
  const d = new Date(v);
  return isNaN(d.getTime()) ? String(v) : d.toLocaleDateString("fr-FR");
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
function fmtPrice(v?: number | null): string {
  if (v == null) return "—";
  return `${Math.round(v).toLocaleString("fr-FR")} FCFA`;
}

export default function ProfessionalInscritsPage() {
  const query = useAllAdminEnrollments();
  const updateMut = useUpdateEnrollment();
  const deleteMut = useDeleteEnrollment();

  const router = useRouter();
  const items: any[] = (query.data as any)?.items ?? [];
  const [filiere, setFiliere] = useState("all");
  const [annee, setAnnee] = useState("all");
  const [search, setSearch] = useState("");
  const [editRow, setEditRow] = useState<any | null>(null);
  const [error, setError] = useState<string | null>(null);

  const filiereOptions = useMemo(() => {
    const map = new Map<string, string>();
    for (const e of items) {
      if (e.filiere_id) map.set(e.filiere_id, `${e.filiere_nom ?? e.filiere_code} (${e.filiere_code})`);
    }
    return Array.from(map.entries())
      .map(([value, label]) => ({ value, label }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [items]);

  // Années scolaires disponibles (dérivées de la date de début des sessions),
  // adaptées à la filière sélectionnée. Plus récentes en premier.
  const anneeOptions = useMemo(() => {
    const set = new Set<string>();
    for (const e of items) {
      if (filiere !== "all" && e.filiere_id !== filiere) continue;
      const a = anneeScolaireOf(e.date_debut);
      if (a) set.add(a);
    }
    return Array.from(set)
      .sort((a, b) => b.localeCompare(a))
      .map((value) => ({ value, label: value }));
  }, [items, filiere]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return items.filter((e) => {
      const matchFil = filiere === "all" || e.filiere_id === filiere;
      const matchAnnee = annee === "all" || anneeScolaireOf(e.date_debut) === annee;
      const hay = `${e.first_name ?? ""} ${e.last_name ?? ""} ${e.matricule ?? ""} ${e.email ?? ""}`.toLowerCase();
      return matchFil && matchAnnee && (!q || hay.includes(q));
    });
  }, [items, filiere, annee, search]);

  // Si la filière change et que l'année sélectionnée n'existe plus dans les
  // options, on revient à « Toutes les années ».
  useEffect(() => {
    if (annee !== "all" && !anneeOptions.some((o) => o.value === annee)) setAnnee("all");
  }, [anneeOptions, annee]);

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

  async function handleDelete(e: any) {
    if (
      typeof window !== "undefined" &&
      !window.confirm(
        `Supprimer l'inscription de ${e.first_name} ${e.last_name} à « ${e.session_libelle} » ?`
      )
    )
      return;
    setError(null);
    try {
      await deleteMut.mutateAsync(e.id);
    } catch (err: any) {
      setError(err?.message ?? "Erreur lors de la suppression.");
    }
  }

  /** Supprime toutes les inscriptions cumulées d'un étudiant (une filière). */
  async function handleDeleteGroup(g: any) {
    const n = g.enrollments.length;
    if (
      typeof window !== "undefined" &&
      !window.confirm(
        `Supprimer les ${n} inscription${n > 1 ? "s" : ""} de ${g.first_name} ${g.last_name} en ${
          g.filiere_code ?? g.filiere_nom
        } ?`
      )
    )
      return;
    setError(null);
    try {
      for (const e of g.enrollments) await deleteMut.mutateAsync(e.id);
    } catch (err: any) {
      setError(err?.message ?? "Erreur lors de la suppression.");
    }
  }

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
      <div>
        <h1 className="text-3xl font-bold bg-gradient-to-r from-indigo-600 to-blue-600 bg-clip-text text-transparent flex items-center gap-2">
          <Users className="h-7 w-7 text-indigo-500" />
          Étudiants inscrits
        </h1>
        <p className="text-muted-foreground mt-2">
          Toutes les inscriptions aux sessions du Module Professionnel.
        </p>
      </div>

      {error && (
        <div className="rounded-md border border-red-300 bg-red-50 px-4 py-2 text-sm text-red-700">
          {error}
        </div>
      )}

      {/* Filtres */}
      <Card className="shadow-sm">
        <CardContent className="p-4 space-y-3">
          {/* Rangée du haut : filière + année scolaire */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <SearchableSelect
              value={filiere}
              onChange={setFiliere}
              icon={<Layers className="h-4 w-4 text-gray-400" />}
              placeholder="Filtrer par filière"
              searchPlaceholder="Rechercher une filière…"
              options={[{ value: "all", label: "Toutes les filières" }, ...filiereOptions]}
            />
            <SearchableSelect
              value={annee}
              onChange={setAnnee}
              icon={<Calendar className="h-4 w-4 text-gray-400" />}
              placeholder="Filtrer par année scolaire"
              searchPlaceholder="Rechercher une année…"
              options={[{ value: "all", label: "Toutes les années" }, ...anneeOptions]}
            />
          </div>
          {/* Rangée du bas : recherche étudiant */}
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Étudiant…"
              className="pl-9"
            />
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

                <p className="text-sm text-white/90">
                  {g.enrollments.length} session{g.enrollments.length > 1 ? "s" : ""} inscrite
                  {g.enrollments.length > 1 ? "s" : ""}
                </p>

                <Button
                  variant="secondary"
                  className="w-full mt-auto bg-red-500/20 hover:bg-red-500/40 text-white border-red-300/20 hover:border-red-300/40 transition-all duration-200"
                  onClick={() => handleDeleteGroup(g)}
                  disabled={deleteMut.isPending}
                >
                  {deleteMut.isPending ? (
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  ) : (
                    <Trash2 className="h-4 w-4 mr-2" />
                  )}
                  Supprimer
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

/* ----------------------------- Modale générique ---------------------------- */

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50" onClick={onClose}>
      <div
        className="w-full max-w-2xl max-h-[85vh] overflow-y-auto rounded-xl bg-background shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-border px-5 py-3 sticky top-0 bg-background">
          <h2 className="text-lg font-semibold">{title}</h2>
          <button type="button" onClick={onClose} className="text-muted-foreground hover:text-foreground">
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>
  );
}

function Info({ icon: Icon, label, value }: { icon?: any; label: string; value: React.ReactNode }) {
  return (
    <div>
      <p className="text-xs font-medium text-muted-foreground flex items-center gap-1">
        {Icon && <Icon className="h-3.5 w-3.5" />} {label}
      </p>
      <p className="text-sm">{value ?? "—"}</p>
    </div>
  );
}

/* -------------------------------- Édition ---------------------------------- */

function EditModal({
  row,
  onClose,
  onSave,
  saving,
}: {
  row: any;
  onClose: () => void;
  onSave: (statut: string) => void;
  saving: boolean;
}) {
  const [statut, setStatut] = useState<string>(row.statut);
  return (
    <Modal title="Modifier l'inscription" onClose={onClose}>
      <div className="space-y-4">
        <p className="text-sm text-muted-foreground">
          {row.first_name} {row.last_name} — {row.session_libelle}
        </p>
        <div className="space-y-1.5">
          <label className="text-sm font-medium">Statut de l'inscription</label>
          <div className="grid grid-cols-2 gap-2">
            {STATUT_OPTIONS.map((opt) => {
              const meta = STATUT[opt];
              const active = statut === opt;
              return (
                <button
                  key={opt}
                  type="button"
                  onClick={() => setStatut(opt)}
                  className={`rounded-lg border px-3 py-2 text-sm text-left transition-colors ${
                    active ? "border-indigo-500 bg-primary/10 font-medium" : "border-border hover:bg-accent"
                  }`}
                >
                  {meta.label}
                </button>
              );
            })}
          </div>
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="outline" onClick={onClose} disabled={saving}>
            Annuler
          </Button>
          <Button onClick={() => onSave(statut)} disabled={saving || statut === row.statut}>
            {saving ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
            Enregistrer
          </Button>
        </div>
      </div>
    </Modal>
  );
}
