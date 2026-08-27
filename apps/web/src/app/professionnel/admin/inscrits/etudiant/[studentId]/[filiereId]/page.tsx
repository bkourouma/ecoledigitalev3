"use client";

import { useMemo } from "react";
import { useParams, useRouter } from "next/navigation";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
  Button,
} from "@ecoledigitale/ui";
import {
  ArrowLeft,
  Loader2,
  AlertCircle,
  Users,
  Layers,
  Calendar,
  Mail,
  Phone,
  Receipt,
  BookOpen,
  Wallet,
} from "lucide-react";
import { useAllAdminEnrollments } from "@/lib/hooks/use-professional-suivi";
import { useStudent } from "@/lib/hooks/use-students";

/**
 * Inscriptions d'un étudiant dans une filière — Module Professionnel (admin).
 *
 * Page de détail complète du binôme étudiant + filière : identité de l'étudiant,
 * récapitulatif financier de la classe ouverte. Remplace l'ancienne modale
 * « Détails » de la liste.
 */

const LIST_URL = "/professionnel/admin/inscrits";

function fmtDate(v?: string | null): string {
  if (!v) return "—";
  const d = new Date(v);
  return isNaN(d.getTime()) ? String(v) : d.toLocaleDateString("fr-FR");
}
function fmtPrice(v?: number | null): string {
  if (v == null) return "—";
  return `${Math.round(v).toLocaleString("fr-FR")} FCFA`;
}
function genderLabel(g?: string | null): string {
  if (g === "feminin") return "Féminin";
  if (g === "masculin") return "Masculin";
  return "—";
}

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

export default function InscritsGroupePage() {
  const router = useRouter();
  const params = useParams();
  const studentId = String(params?.studentId ?? "");
  const filiereId = String(params?.filiereId ?? "");

  // Filtrage côté API : on ne charge que les inscriptions de ce binôme.
  const query = useAllAdminEnrollments({ student_id: studentId, filiere_id: filiereId });
  const studentQuery = useStudent(studentId);

  const enrollments: any[] = useMemo(() => {
    const items: any[] = (query.data as any)?.items ?? [];
    return [...items].sort((a, b) =>
      String(a.date_debut ?? "").localeCompare(String(b.date_debut ?? ""))
    );
  }, [query.data]);

  const first = enrollments[0] ?? null;

  // Total dû = somme des prix d'inscription. Le montant payé est porté par la
  // COMMANDE : plusieurs inscriptions partagent souvent la même commande, on
  // dédoublonne donc par order_id pour ne pas compter un paiement deux fois.
  const totaux = useMemo(() => {
    const parCommande = new Map<string, { reference: string; statut: string; montant: number; paye: number }>();
    let du = 0;
    for (const e of enrollments) {
      du += Number(e.prix_unitaire) || 0;
      if (e.order_id && !parCommande.has(e.order_id)) {
        parCommande.set(e.order_id, {
          reference: e.order_reference ?? "—",
          statut: e.order_statut ?? "—",
          montant: Number(e.order_montant) || 0,
          paye: Number(e.montant_paye) || 0,
        });
      }
    }
    const commandes = Array.from(parCommande.values());
    return {
      du,
      commandes,
      paye: commandes.reduce((sum, c) => sum + c.paye, 0),
    };
  }, [enrollments]);

  const resume = useMemo(() => {
    const total = enrollments.length;
    const confirmees = enrollments.filter(
      (e) => e.statut === "confirmee" || e.statut === "terminee"
    ).length;
    if (total === 0) return { label: "—", cls: "bg-gray-100 text-gray-600" };
    if (confirmees === 0) return { label: "En attente paiement", cls: "bg-amber-100 text-amber-700" };
    if (confirmees === total) return { label: "Confirmée", cls: "bg-green-100 text-green-700" };
    return { label: `${confirmees}/${total} confirmées`, cls: "bg-blue-100 text-blue-700" };
  }, [enrollments]);

  if (query.isLoading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <Loader2 className="h-10 w-10 animate-spin text-indigo-500" />
      </div>
    );
  }

  if (query.isError || !first) {
    return (
      <div className="max-w-3xl mx-auto p-6 space-y-4">
        <Button variant="outline" size="sm" onClick={() => router.push(LIST_URL)}>
          <ArrowLeft className="h-4 w-4 mr-2" /> Retour
        </Button>
        <Card className="border-red-200">
          <CardContent className="flex items-center gap-3 py-8 text-red-700">
            <AlertCircle className="h-6 w-6 shrink-0" />
            <p>
              {(query.error as Error)?.message ??
                "Aucune inscription pour cet étudiant dans cette classe."}
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const s: any = (studentQuery.data as any)?.student ?? (studentQuery.data as any) ?? null;
  const u = s?.user ?? {};

  return (
    <div className="max-w-5xl mx-auto p-6 space-y-6">
      {/* En-tête */}
      <div className="flex flex-col sm:flex-row sm:items-center gap-4">
        <Button variant="outline" size="sm" onClick={() => router.push(LIST_URL)}>
          <ArrowLeft className="h-4 w-4 mr-2" /> Retour
        </Button>
        <div className="min-w-0">
          <h1 className="text-2xl font-bold bg-gradient-to-r from-indigo-600 to-blue-600 bg-clip-text text-transparent flex items-center gap-2">
            <Users className="h-6 w-6 text-indigo-500 shrink-0" />
            {first.first_name} {first.last_name}
          </h1>
          <div className="flex flex-wrap items-center gap-2 mt-1">
            {first.matricule && (
              <span className="font-mono text-[11px] text-indigo-600 bg-indigo-50 rounded px-1.5 py-0.5">
                {first.matricule}
              </span>
            )}
            <span className="text-sm text-muted-foreground">
              {first.filiere_nom}
              {first.filiere_code ? ` (${first.filiere_code})` : ""}
            </span>
            <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${resume.cls}`}>
              {resume.label}
            </span>
          </div>
        </div>
      </div>

      {/* Étudiant */}
      <Card className="shadow-lg">
        <CardHeader>
          <CardTitle>Informations de l&apos;étudiant</CardTitle>
          <CardDescription>Données personnelles et scolaires.</CardDescription>
        </CardHeader>
        <CardContent>
          {studentQuery.isLoading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground py-2">
              <Loader2 className="h-4 w-4 animate-spin" /> Chargement…
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              <Info label="Prénom" value={u.firstName ?? first.first_name} />
              <Info label="Nom" value={u.lastName ?? first.last_name} />
              <Info icon={Mail} label="E-mail" value={u.email ?? first.email} />
              <Info icon={Phone} label="Téléphone" value={s?.phone ?? "—"} />
              <Info label="Sexe" value={genderLabel(s?.gender)} />
              <Info label="Nationalité" value={s?.nationality ?? "—"} />
              <Info icon={Calendar} label="Date de naissance" value={fmtDate(s?.dateOfBirth)} />
              <Info label="Matricule" value={first.matricule ?? s?.studentNumber ?? "—"} />
            </div>
          )}
        </CardContent>
      </Card>

      {/* Récapitulatif */}
      <Card className="shadow-lg">
        <CardHeader>
          <CardTitle>Récapitulatif</CardTitle>
          <CardDescription>
            Cumul sur cette classe. Le montant payé est porté par la commande : une même
            commande peut couvrir plusieurs UE.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <Info icon={Layers} label="Classe" value={first.filiere_nom ?? "—"} />
            <Info icon={BookOpen} label="UE inscrites" value={`${enrollments.length}`} />
            <Info label="Total dû" value={fmtPrice(totaux.du)} />
            <Info icon={Wallet} label="Payé (commandes liées)" value={fmtPrice(totaux.paye)} />
          </div>

          {totaux.commandes.length > 0 && (
            <div className="border-t border-border pt-4 space-y-2">
              <p className="text-sm font-medium">
                Commande{totaux.commandes.length > 1 ? "s" : ""} ({totaux.commandes.length})
              </p>
              <div className="divide-y rounded-md border">
                {totaux.commandes.map((c) => (
                  <div
                    key={c.reference}
                    className="flex flex-wrap items-center justify-between gap-3 px-3 py-2 text-sm"
                  >
                    <span className="font-mono flex items-center gap-1.5">
                      <Receipt className="h-3.5 w-3.5 text-muted-foreground" />
                      {c.reference}
                    </span>
                    <span className="text-muted-foreground">{c.statut}</span>
                    <span>
                      {fmtPrice(c.paye)} / {fmtPrice(c.montant)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

    </div>
  );
}
