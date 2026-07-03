"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
  Button,
  Input,
} from "@ecoledigitale/ui";
import { ArrowLeft, Edit, Loader2, Plus, Layers, GitBranch, CalendarDays } from "lucide-react";
import { useProgrammes } from "@/lib/hooks/use-programmes";
import {
  useProfessionalUe,
  useProfessionalUeList,
  useSetProfessionalUePrerequisites,
  useProfessionalUeSessions,
  useCreateProfessionalUeSession,
} from "@/lib/hooks/use-professional-catalog-admin";

/**
 * Détail d'une UE — composition (ECUE), prérequis et sessions (feature 030).
 */
export default function ProfessionalUeDetailPage() {
  const router = useRouter();
  const params = useParams();
  const id = (params?.id as string) ?? "";
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<"composition" | "prerequis" | "sessions">(
    "composition"
  );

  const ueQuery = useProfessionalUe(id);
  const programmesQuery = useProgrammes();

  const ue: any = ueQuery.data;
  const filieres: any[] = programmesQuery.data?.data ?? [];
  const composedEcue: any[] = ue?.ecue ?? [];
  const prerequisites: any[] = ue?.prerequisites ?? [];

  const filiereName = useMemo(() => {
    const p = filieres.find((x) => x.id === ue?.filiere_id);
    return p ? `${p.name}${p.code ? ` (${p.code})` : ""}` : ue?.filiere_id ?? "";
  }, [filieres, ue]);

  /* Composition (ECUE) gérée à la création de l'ECUE (page Matières) — lecture seule ici. */

  /* ----- Prérequis UE (même filière) ----- */
  const ueSameFiliereQuery = useProfessionalUeList({ filiere_id: ue?.filiere_id });
  const setPrereqMut = useSetProfessionalUePrerequisites();
  const [selectedPrereqs, setSelectedPrereqs] = useState<string[]>([]);
  useEffect(() => {
    setSelectedPrereqs(prerequisites.map((p) => p.id));
  }, [ue?.id, prerequisites.length]); // eslint-disable-line react-hooks/exhaustive-deps

  const prereqOptions: any[] = (ueSameFiliereQuery.data?.items ?? []).filter(
    (u: any) => u.id !== id
  );

  function togglePrereq(ueId: string) {
    setSelectedPrereqs((prev) =>
      prev.includes(ueId) ? prev.filter((x) => x !== ueId) : [...prev, ueId]
    );
  }

  async function savePrereqs() {
    setError(null);
    try {
      await setPrereqMut.mutateAsync({ id, prerequisite_ue_ids: selectedPrereqs });
      ueQuery.refetch();
    } catch (err: any) {
      setError(err?.message ?? "Erreur lors de l'enregistrement des prérequis.");
    }
  }

  /* ----- Sessions ----- */
  const sessionsQuery = useProfessionalUeSessions(id);
  const createSessionMut = useCreateProfessionalUeSession();
  const sessions: any[] = sessionsQuery.data ?? [];
  const [session, setSession] = useState({
    libelle: "",
    date_debut: "",
    date_fin: "",
    inscription_ouverte_le: "",
    inscription_fermee_le: "",
    capacite_max: "",
  });

  async function createSession(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await createSessionMut.mutateAsync({
        ueId: id,
        data: {
          libelle: session.libelle.trim(),
          date_debut: session.date_debut,
          date_fin: session.date_fin,
          inscription_ouverte_le: new Date(session.inscription_ouverte_le).toISOString(),
          inscription_fermee_le: new Date(session.inscription_fermee_le).toISOString(),
          capacite_max: session.capacite_max ? Number(session.capacite_max) : null,
        } as any,
      });
      setSession({
        libelle: "",
        date_debut: "",
        date_fin: "",
        inscription_ouverte_le: "",
        inscription_fermee_le: "",
        capacite_max: "",
      });
      sessionsQuery.refetch();
    } catch (err: any) {
      setError(err?.message ?? "Erreur lors de la création de la session.");
    }
  }

  if (ueQuery.isLoading) {
    return (
      <div className="max-w-7xl mx-auto p-6">
        <Card className="shadow-lg">
          <CardContent className="flex items-center justify-center py-16">
            <Loader2 className="h-8 w-8 animate-spin text-indigo-600" />
          </CardContent>
        </Card>
      </div>
    );
  }

  const TABS: Array<{
    id: "composition" | "prerequis" | "sessions";
    label: string;
    icon: React.ElementType;
  }> = [
    { id: "composition", label: "Composition (ECUE)", icon: Layers },
    { id: "prerequis", label: "Prérequis", icon: GitBranch },
    { id: "sessions", label: "Sessions", icon: CalendarDays },
  ];

  return (
    <div className="space-y-6 max-w-7xl mx-auto p-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div className="flex items-center gap-4">
          <Button
            variant="outline"
            size="sm"
            onClick={() => router.push("/professionnel/admin/ue")}
          >
            <ArrowLeft className="h-4 w-4 mr-2" />
            Retour
          </Button>
          <div>
            <h1 className="text-3xl font-bold bg-gradient-to-r from-indigo-600 to-blue-600 bg-clip-text text-transparent">
              {ue?.libelle}
            </h1>
            <p className="text-muted-foreground mt-1 text-sm">
              <span className="font-mono">{ue?.code}</span> · {filiereName} · {ue?.prix}{" "}
              {ue?.devise ?? "XOF"} · {ue?.nb_uv} UV · {ue?.statut}
            </p>
          </div>
        </div>
        <Button variant="outline" onClick={() => router.push(`/professionnel/admin/ue/${id}/edit`)}>
          <Edit className="h-4 w-4 mr-2" />
          Modifier
        </Button>
      </div>

      {error && (
        <div className="rounded-md border border-red-300 bg-red-50 px-4 py-2 text-sm text-red-700">
          {error}
        </div>
      )}

      {/* Onglets */}
      <div className="border-b border-border">
        <nav className="flex flex-wrap gap-2">
          {TABS.map(({ id: tabId, label, icon: Icon }) => {
            const isActive = activeTab === tabId;
            return (
              <button
                key={tabId}
                type="button"
                onClick={() => setActiveTab(tabId)}
                className={`flex items-center gap-2 px-4 py-2 text-sm font-medium border-b-2 transition-colors -mb-px ${
                  isActive
                    ? "border-blue-600 text-blue-600"
                    : "border-transparent text-muted-foreground hover:text-foreground"
                }`}
              >
                <Icon className="h-4 w-4" />
                {label}
              </button>
            );
          })}
        </nav>
      </div>

      {/* Composition UE↔ECUE — lecture seule (le rattachement se fait à la création de l'ECUE) */}
      {activeTab === "composition" && (
      <Card className="shadow-lg">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Layers className="h-5 w-5 text-indigo-600" /> Composition (ECUE)
          </CardTitle>
          <CardDescription>
            ECUE rattachées à cette UE. Le rattachement se gère à la création de l'ECUE
            (page Matières).
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {composedEcue.length === 0 ? (
            <p className="text-sm text-muted-foreground">Aucune ECUE rattachée pour l'instant.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-muted-foreground border-b">
                    <th className="py-2 pr-4">Code</th>
                    <th className="py-2 pr-4">ECUE</th>
                    <th className="py-2 pr-4">Crédits</th>
                  </tr>
                </thead>
                <tbody>
                  {composedEcue.map((c) => (
                    <tr key={c.ecue_id} className="border-b last:border-0">
                      <td className="py-2 pr-4 font-mono text-xs">{c.ecue_code}</td>
                      <td className="py-2 pr-4">{c.ecue_libelle}</td>
                      <td className="py-2 pr-4">{c.ecue_credits ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
      )}

      {/* Prérequis UE */}
      {activeTab === "prerequis" && (
      <Card className="shadow-lg">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <GitBranch className="h-5 w-5 text-indigo-600" /> Prérequis (UE de la même filière)
          </CardTitle>
          <CardDescription>
            L'étudiant devra avoir validé ces UE avant de s'inscrire. Graphe acyclique garanti.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {prereqOptions.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Aucune autre UE dans cette filière pour servir de prérequis.
            </p>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
              {prereqOptions.map((u) => (
                <label
                  key={u.id}
                  className="flex items-center gap-2 rounded-md border px-3 py-2 text-sm cursor-pointer"
                >
                  <input
                    type="checkbox"
                    checked={selectedPrereqs.includes(u.id)}
                    onChange={() => togglePrereq(u.id)}
                  />
                  <span className="font-mono text-xs">{u.code}</span>
                  <span>{u.libelle}</span>
                </label>
              ))}
            </div>
          )}
          {prereqOptions.length > 0 && (
            <div className="flex justify-end">
              <Button onClick={savePrereqs} disabled={setPrereqMut.isPending}>
                {setPrereqMut.isPending ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : null}
                Enregistrer les prérequis
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
      )}

      {/* Sessions */}
      {activeTab === "sessions" && (
      <Card className="shadow-lg">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <CalendarDays className="h-5 w-5 text-indigo-600" /> Sessions
          </CardTitle>
          <CardDescription>
            Occurrences inscriptibles de l'UE (dates, fenêtre d'inscription, capacité).
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {sessions.length === 0 ? (
            <p className="text-sm text-muted-foreground">Aucune session pour l'instant.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-muted-foreground border-b">
                    <th className="py-2 pr-4">Libellé</th>
                    <th className="py-2 pr-4">Début</th>
                    <th className="py-2 pr-4">Fin</th>
                    <th className="py-2 pr-4">Capacité</th>
                    <th className="py-2 pr-4">Statut</th>
                    <th className="py-2"></th>
                  </tr>
                </thead>
                <tbody>
                  {sessions.map((s) => (
                    <tr key={s.id} className="border-b last:border-0">
                      <td className="py-2 pr-4">{s.libelle}</td>
                      <td className="py-2 pr-4">{s.date_debut}</td>
                      <td className="py-2 pr-4">{s.date_fin}</td>
                      <td className="py-2 pr-4">{s.capacite_max ?? "∞"}</td>
                      <td className="py-2 pr-4">{s.statut}</td>
                      <td className="py-2 text-right">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() =>
                            router.push(`/professionnel/admin/sessions/${s.id}`)
                          }
                        >
                          Ouvrir
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Création de session */}
          <form
            onSubmit={createSession}
            className="rounded-lg border p-4 grid grid-cols-1 md:grid-cols-3 gap-3 items-end"
          >
            <div className="space-y-1.5 md:col-span-3">
              <label className="text-sm font-medium">Libellé</label>
              <Input
                value={session.libelle}
                onChange={(e) => setSession({ ...session, libelle: e.target.value })}
                placeholder="Ex. : Session Janvier 2026"
                required
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Date début</label>
              <Input
                type="date"
                value={session.date_debut}
                onChange={(e) => setSession({ ...session, date_debut: e.target.value })}
                required
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Date fin</label>
              <Input
                type="date"
                value={session.date_fin}
                onChange={(e) => setSession({ ...session, date_fin: e.target.value })}
                required
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Capacité max</label>
              <Input
                type="number"
                min={1}
                value={session.capacite_max}
                onChange={(e) => setSession({ ...session, capacite_max: e.target.value })}
                placeholder="Illimitée si vide"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Inscription ouverte le</label>
              <Input
                type="datetime-local"
                value={session.inscription_ouverte_le}
                onChange={(e) =>
                  setSession({ ...session, inscription_ouverte_le: e.target.value })
                }
                required
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Inscription fermée le</label>
              <Input
                type="datetime-local"
                value={session.inscription_fermee_le}
                onChange={(e) =>
                  setSession({ ...session, inscription_fermee_le: e.target.value })
                }
                required
              />
            </div>
            <div className="md:col-span-3 flex justify-end">
              <Button type="submit" disabled={createSessionMut.isPending}>
                {createSessionMut.isPending ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <Plus className="h-4 w-4 mr-2" />
                )}
                Créer la session
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
      )}
    </div>
  );
}
