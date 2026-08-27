"use client";

import { useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle, CardDescription, Button } from "@ecoledigitale/ui";
import {
  ArrowLeft,
  Loader2,
  AlertCircle,
  GraduationCap,
  CheckCircle2,
  BookOpen,
  Trash2,
  Mail,
  Phone,
  Calendar,
  MapPin,
  Layers,
  Receipt,
} from "lucide-react";
import {
  useEnrollment,
  useUpdateEnrollment,
  useDeleteEnrollment,
} from "@/lib/hooks/use-professional-suivi";
import { useStudent } from "@/lib/hooks/use-students";

/**
 * Détail d'une inscription — Module Professionnel (admin).
 * Informations structurées par onglets : Étudiant · Inscription · Session.
 */

const LIST_URL = "/professionnel/admin/inscrits";

const STATUT: Record<string, { label: string; cls: string }> = {
  en_attente_paiement: { label: "En attente paiement", cls: "bg-amber-100 text-amber-700" },
  confirmee: { label: "Confirmée", cls: "bg-green-100 text-green-700" },
  terminee: { label: "Terminée", cls: "bg-blue-100 text-blue-700" },
  annulee: { label: "Annulée", cls: "bg-gray-100 text-gray-600" },
};
const STATUT_OPTIONS = ["en_attente_paiement", "confirmee", "terminee", "annulee"];

function fmtDate(v?: string | null): string {
  if (!v) return "—";
  const d = new Date(v);
  return isNaN(d.getTime()) ? String(v) : d.toLocaleDateString("fr-FR");
}
function fmtPrice(v?: number | null, devise = "FCFA"): string {
  if (v == null) return "—";
  return `${Math.round(v).toLocaleString("fr-FR")} ${devise === "XOF" ? "FCFA" : devise}`;
}

type Tab = "etudiant" | "inscription" | "session";

function Info({ icon: Icon, label, value }: { icon?: any; label: string; value: React.ReactNode }) {
  return (
    <div>
      <p className="text-xs font-medium text-muted-foreground flex items-center gap-1">
        {Icon && <Icon className="h-3.5 w-3.5" />} {label}
      </p>
      <p className="text-sm mt-0.5">{value ?? "—"}</p>
    </div>
  );
}

export default function InscritDetailPage() {
  const router = useRouter();
  const params = useParams();
  const id = String(params?.id ?? "");

  const enrollQuery = useEnrollment(id);
  const e: any = enrollQuery.data ?? null;
  const studentQuery = useStudent(e?.student_id ?? "");
  const s: any = (studentQuery.data as any)?.student ?? (studentQuery.data as any) ?? null;
  const u = s?.user ?? {};

  const updateMut = useUpdateEnrollment();
  const deleteMut = useDeleteEnrollment();
  const [tab, setTab] = useState<Tab>("etudiant");
  const [error, setError] = useState<string | null>(null);

  if (enrollQuery.isLoading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <Loader2 className="h-10 w-10 animate-spin text-indigo-500" />
      </div>
    );
  }

  if (enrollQuery.isError || !e) {
    return (
      <div className="max-w-3xl mx-auto p-6 space-y-4">
        <Button variant="outline" size="sm" onClick={() => router.push(LIST_URL)}>
          <ArrowLeft className="h-4 w-4 mr-2" /> Retour
        </Button>
        <Card className="border-red-200">
          <CardContent className="flex items-center gap-3 py-8 text-red-700">
            <AlertCircle className="h-6 w-6 shrink-0" />
            <p>{(enrollQuery.error as Error)?.message ?? "Inscription introuvable."}</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const st = STATUT[e.statut] ?? { label: e.statut, cls: "bg-gray-100 text-gray-600" };

  async function changeStatut(statut: string) {
    setError(null);
    try {
      await updateMut.mutateAsync({ id, statut });
      enrollQuery.refetch();
    } catch (err: any) {
      setError(err?.message ?? "Erreur lors de la mise à jour du statut.");
    }
  }

  async function handleDelete() {
    if (
      typeof window !== "undefined" &&
      !window.confirm(`Supprimer l'inscription de ${e.first_name} ${e.last_name} ?`)
    )
      return;
    setError(null);
    try {
      await deleteMut.mutateAsync(id);
      router.push(LIST_URL);
    } catch (err: any) {
      setError(err?.message ?? "Erreur lors de la suppression.");
    }
  }

  const TABS: Array<{ id: Tab; label: string; icon: any }> = [
    { id: "etudiant", label: "Étudiant", icon: GraduationCap },
    { id: "inscription", label: "Inscription", icon: CheckCircle2 },
    { id: "session", label: "Session", icon: BookOpen },
  ];

  return (
    <div className="max-w-4xl mx-auto p-6 space-y-6">
      {/* En-tête */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-center gap-4">
          <Button variant="outline" size="sm" onClick={() => router.push(LIST_URL)}>
            <ArrowLeft className="h-4 w-4 mr-2" /> Retour
          </Button>
          <div>
            <h1 className="text-2xl font-bold bg-gradient-to-r from-indigo-600 to-blue-600 bg-clip-text text-transparent">
              {e.first_name} {e.last_name}
            </h1>
            <div className="flex items-center gap-2 mt-1">
              {e.matricule && (
                <span className="font-mono text-[11px] text-indigo-600 bg-indigo-50 rounded px-1.5 py-0.5">
                  {e.matricule}
                </span>
              )}
              <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${st.cls}`}>
                {st.label}
              </span>
            </div>
          </div>
        </div>
        <Button
          variant="outline"
          className="text-red-600 hover:bg-red-50"
          onClick={handleDelete}
          disabled={deleteMut.isPending}
        >
          <Trash2 className="h-4 w-4 mr-2" /> Supprimer
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
          {TABS.map(({ id: tid, label, icon: Icon }) => {
            const active = tab === tid;
            return (
              <button
                key={tid}
                type="button"
                onClick={() => setTab(tid)}
                className={`flex items-center gap-2 px-4 py-2 text-sm font-medium border-b-2 transition-colors -mb-px ${
                  active
                    ? "border-indigo-600 text-indigo-600"
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

      {/* Étudiant */}
      {tab === "etudiant" && (
        <Card className="shadow-lg">
          <CardHeader>
            <CardTitle>Informations de l'étudiant</CardTitle>
            <CardDescription>Données personnelles et scolaires.</CardDescription>
          </CardHeader>
          <CardContent>
            {studentQuery.isLoading ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground py-2">
                <Loader2 className="h-4 w-4 animate-spin" /> Chargement…
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <Info label="Prénom" value={u.firstName ?? e.first_name} />
                <Info label="Nom" value={u.lastName ?? e.last_name} />
                <Info icon={Mail} label="E-mail" value={u.email ?? e.email} />
                <Info label="Sexe" value={s?.gender === "feminin" ? "Féminin" : s?.gender === "masculin" ? "Masculin" : "—"} />
                <Info label="Nationalité" value={s?.nationality} />
                <Info icon={Phone} label="Téléphone" value={s?.phone} />
                <Info icon={Calendar} label="Date de naissance" value={fmtDate(s?.dateOfBirth)} />
                <Info label="Matricule" value={s?.studentNumber ?? e.matricule} />
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Inscription */}
      {tab === "inscription" && (
        <Card className="shadow-lg">
          <CardHeader>
            <CardTitle>Détails de l'inscription</CardTitle>
            <CardDescription>Statut, commande et tarification.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Info
                label="Statut de l'inscription"
                value={<span className={`rounded-full px-2 py-0.5 text-xs font-medium ${st.cls}`}>{st.label}</span>}
              />
              <Info icon={Receipt} label="Référence commande" value={<span className="font-mono">{e.order_reference}</span>} />
              <Info label="Prix de l'inscription" value={fmtPrice(e.prix_unitaire, e.order_devise)} />
              <Info label="Statut de la commande" value={e.order_statut} />
              <Info label="Montant total commande" value={fmtPrice(e.order_montant, e.order_devise)} />
              <Info icon={Calendar} label="Inscrit le" value={fmtDate(e.created_at)} />
            </div>

            {/* Changer le statut */}
            <div className="border-t border-border pt-4 space-y-2">
              <p className="text-sm font-medium">Changer le statut</p>
              <div className="flex flex-wrap gap-2">
                {STATUT_OPTIONS.map((opt) => {
                  const active = e.statut === opt;
                  return (
                    <Button
                      key={opt}
                      variant={active ? "default" : "outline"}
                      size="sm"
                      disabled={active || updateMut.isPending}
                      onClick={() => changeStatut(opt)}
                    >
                      {updateMut.isPending && updateMut.variables?.statut === opt ? (
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      ) : null}
                      {STATUT[opt].label}
                    </Button>
                  );
                })}
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Session */}
      {tab === "session" && (
        <Card className="shadow-lg">
          <CardHeader>
            <CardTitle>Session</CardTitle>
            <CardDescription>UE, classe et période.</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Info label="Session" value={e.session_libelle} />
              <Info label="UE" value={`${e.ue_code ?? ""} ${e.ue_libelle ?? ""}`.trim()} />
              <Info icon={Layers} label="Classe" value={`${e.filiere_nom ?? ""}${e.filiere_code ? ` (${e.filiere_code})` : ""}`} />
              <Info icon={Calendar} label="Période" value={`${fmtDate(e.date_debut)} → ${fmtDate(e.date_fin)}`} />
              <Info label="Statut de la session" value={e.session_statut} />
            </div>
            <div className="mt-4">
              <Button
                variant="outline"
                size="sm"
                onClick={() => router.push(`/professionnel/admin/sessions/${e.ue_session_id}`)}
              >
                <BookOpen className="h-4 w-4 mr-2" /> Ouvrir la session
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
