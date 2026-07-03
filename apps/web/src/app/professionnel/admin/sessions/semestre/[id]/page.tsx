"use client";

import { useMemo } from "react";
import { useParams, useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle, Button } from "@ecoledigitale/ui";
import {
  ArrowLeft,
  Loader2,
  Eye,
  Edit,
  Layers,
  CalendarRange,
  GraduationCap,
} from "lucide-react";
import { useProfessionalSemestre } from "@/lib/hooks/use-professional-semestres";
import { useProfessionalUeSessionsList } from "@/lib/hooks/use-professional-catalog-admin";

/**
 * Détail des sessions d'un SEMESTRE — Module Professionnel.
 * Affiche, pour un semestre donné, ses sessions regroupées par lot (période),
 * chaque lot listant ses UE avec leurs actions.
 */

const LIST_URL = "/professionnel/admin/sessions";

const STATUT_LABEL: Record<string, string> = {
  brouillon: "Brouillon",
  ouvert: "Ouvert",
  complet: "Complet",
  en_cours: "En cours",
  termine: "Terminé",
  annule: "Annulé",
};

const STATUT_CHIP: Record<string, string> = {
  brouillon: "bg-slate-100 text-slate-700",
  ouvert: "bg-green-100 text-green-700",
  complet: "bg-amber-100 text-amber-700",
  en_cours: "bg-blue-100 text-blue-700",
  termine: "bg-gray-200 text-gray-700",
  annule: "bg-red-100 text-red-700",
};

function fmtDate(value?: string | null): string {
  if (!value) return "—";
  const d = new Date(value);
  return isNaN(d.getTime()) ? String(value) : d.toLocaleDateString("fr-FR");
}

function StatCard({
  label,
  value,
  icon: Icon,
  gradient,
}: {
  label: string;
  value: React.ReactNode;
  icon: React.ElementType;
  gradient: string;
}) {
  return (
    <div className={`bg-gradient-to-br ${gradient} p-5 rounded-xl text-white shadow-lg`}>
      <div className="flex items-center justify-between">
        <div>
          <p className="text-white/80 text-xs font-medium">{label}</p>
          <p className="text-2xl font-bold mt-1">{value}</p>
        </div>
        <div className="bg-white/20 p-2.5 rounded-lg">
          <Icon className="h-5 w-5" />
        </div>
      </div>
    </div>
  );
}

export default function SemestreSessionsDetailPage() {
  const router = useRouter();
  const params = useParams();
  const semestreId = String(params?.id ?? "");

  const semestreQuery = useProfessionalSemestre(semestreId || null);
  const sessionsQuery = useProfessionalUeSessionsList(
    semestreId ? { semestre_id: semestreId, pageSize: 500 } : {}
  );

  const semestre: any = semestreQuery.data ?? null;
  const sessions: any[] = sessionsQuery.data?.items ?? [];

  // Regroupe par lot (période + libellé) — un semestre peut avoir plusieurs lots.
  const batches = useMemo(() => {
    const map = new Map<string, any>();
    for (const s of sessions) {
      const suffix = s.ue_code ? ` — ${s.ue_code}` : "";
      const prefix =
        suffix && s.libelle?.endsWith(suffix) ? s.libelle.slice(0, -suffix.length) : s.libelle;
      const key = `${prefix}|${s.date_debut}|${s.date_fin}`;
      let g = map.get(key);
      if (!g) {
        g = { key, title: prefix, date_debut: s.date_debut, date_fin: s.date_fin, statut: s.statut, items: [] as any[] };
        map.set(key, g);
      }
      g.items.push(s);
    }
    return Array.from(map.values());
  }, [sessions]);

  const loading = semestreQuery.isLoading || sessionsQuery.isLoading;
  const totalUv = sessions.reduce((a, s) => a + (s.ue_nb_uv ?? 0), 0);

  if (loading) {
    return (
      <div className="max-w-7xl mx-auto p-6">
        <Card className="shadow-lg">
          <CardContent className="flex flex-col items-center justify-center py-16">
            <Loader2 className="h-8 w-8 animate-spin text-green-600" />
            <p className="text-gray-600 mt-3">Chargement…</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-7xl mx-auto p-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div className="flex items-center gap-4">
          <Button variant="outline" size="sm" onClick={() => router.push(LIST_URL)}>
            <ArrowLeft className="h-4 w-4 mr-2" />
            Retour
          </Button>
          <div>
            <h1 className="text-3xl font-bold bg-gradient-to-r from-green-600 to-blue-600 bg-clip-text text-transparent">
              Sessions — {semestre?.libelle ?? "Semestre"}
            </h1>
            <p className="text-muted-foreground mt-1 text-sm flex items-center gap-1.5">
              <Layers className="h-4 w-4" />
              {semestre?.filiere_nom ?? "—"}
              {semestre?.filiere_code ? (
                <span className="font-mono text-xs">({semestre.filiere_code})</span>
              ) : null}
            </p>
          </div>
        </div>
        <Button
          onClick={() => router.push(`${LIST_URL}/new`)}
          className="bg-gradient-to-r from-green-500 to-blue-600 hover:from-green-600 hover:to-blue-700 text-white"
        >
          Nouvelles sessions
        </Button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
        <StatCard label="Sessions (UE)" value={sessions.length} icon={CalendarRange} gradient="from-green-500 to-emerald-600" />
        <StatCard label="Lots" value={batches.length} icon={Layers} gradient="from-indigo-500 to-purple-600" />
        <StatCard label="Crédits" value={totalUv} icon={GraduationCap} gradient="from-purple-500 to-pink-600" />
      </div>

      {/* Lots de sessions */}
      {sessions.length === 0 ? (
        <Card className="shadow-lg">
          <CardContent className="flex flex-col items-center justify-center py-16 text-center space-y-4">
            <div className="bg-gradient-to-br from-green-100 to-blue-100 rounded-full w-16 h-16 flex items-center justify-center">
              <CalendarRange className="h-8 w-8 text-green-600" />
            </div>
            <p className="text-gray-600">Aucune session pour ce semestre.</p>
            <Button
              onClick={() => router.push(`${LIST_URL}/new`)}
              className="bg-gradient-to-r from-green-500 to-blue-600 text-white"
            >
              Créer des sessions
            </Button>
          </CardContent>
        </Card>
      ) : (
        batches.map((b) => (
          <Card key={b.key} className="shadow-lg">
            <CardHeader>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <CardTitle className="text-base">{b.title}</CardTitle>
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <span>
                    {fmtDate(b.date_debut)} → {fmtDate(b.date_fin)}
                  </span>
                  <span
                    className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${
                      STATUT_CHIP[b.statut] ?? "bg-gray-100 text-gray-700"
                    }`}
                  >
                    {STATUT_LABEL[b.statut] ?? b.statut}
                  </span>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="text-left text-xs uppercase text-muted-foreground border-b">
                    <tr>
                      <th className="py-2 pr-3">Code</th>
                      <th className="py-2 pr-3">UE</th>
                      <th className="py-2 pr-3">Crédits</th>
                      <th className="py-2 pr-3">Inscrits</th>
                      <th className="py-2 pr-3 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {b.items.map((s: any) => (
                      <tr key={s.id} className="border-b last:border-0 hover:bg-muted/50">
                        <td className="py-2 pr-3 font-mono text-xs">{s.ue_code}</td>
                        <td className="py-2 pr-3">{s.ue_libelle}</td>
                        <td className="py-2 pr-3">{s.ue_nb_uv ?? 0}</td>
                        <td className="py-2 pr-3">{s.nb_inscriptions_actives ?? 0}</td>
                        <td className="py-2 pr-3">
                          <div className="flex gap-1 justify-end">
                            <Button
                              variant="outline"
                              size="sm"
                              className="p-2"
                              onClick={() => router.push(`${LIST_URL}/${s.id}`)}
                              title="Voir / affecter les enseignants"
                            >
                              <Eye className="w-4 h-4" />
                            </Button>
                            <Button
                              variant="outline"
                              size="sm"
                              className="p-2"
                              onClick={() => router.push(`${LIST_URL}/${s.id}/edit`)}
                              title="Modifier"
                            >
                              <Edit className="w-4 h-4" />
                            </Button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        ))
      )}
    </div>
  );
}
