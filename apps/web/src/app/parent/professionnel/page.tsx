"use client";

import { useMemo, useState } from "react";
import {
  Card,
  CardContent,
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
  Users,
  GraduationCap,
  CreditCard,
  Wallet,
  CheckCircle2,
  Loader2,
  AlertCircle,
} from "lucide-react";
import {
  useProfessionalChildren,
  useChildProfessionalEnrollments,
  useChildProfessionalPayments,
} from "@/lib/hooks/use-professional-parent";

/**
 * Espace parent — Module Professionnel (feature 028, US5).
 * Consultation en lecture seule des inscriptions et paiements d'un enfant.
 * Affichage aligné sur les pages admin : header dégradé, statistiques, tableaux stylés.
 */

const STATUT_LABEL: Record<string, string> = {
  en_attente_paiement: "En attente de paiement",
  confirmee: "Confirmée",
  terminee: "Terminée",
  annulee: "Annulée",
};

const STATUT_BADGE: Record<string, string> = {
  confirmee: "bg-green-500/15 text-green-400",
  terminee: "bg-blue-500/15 text-blue-400",
  en_attente_paiement: "bg-amber-500/15 text-amber-400",
  annulee: "bg-slate-500/20 text-slate-400",
  valide: "bg-green-500/15 text-green-400",
  confirme: "bg-green-500/15 text-green-400",
  en_attente: "bg-amber-500/15 text-amber-400",
  rembourse: "bg-slate-500/20 text-slate-400",
};

function StatutBadge({ statut }: { statut: string }) {
  const cls = STATUT_BADGE[statut] ?? "bg-muted text-muted-foreground";
  return (
    <span
      className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-medium ${cls}`}
    >
      {STATUT_LABEL[statut] ?? statut}
    </span>
  );
}

function fmtDate(value?: string | null): string {
  if (!value) return "—";
  const d = new Date(value);
  return isNaN(d.getTime()) ? String(value) : d.toLocaleDateString("fr-FR");
}

function fmtFCFA(value?: number | null): string {
  const n = Number(value ?? 0);
  return `${n.toLocaleString("fr-FR")} FCFA`;
}

export default function ParentProfessionalPage() {
  const [childId, setChildId] = useState("");

  const childrenQuery = useProfessionalChildren();
  const enrollmentsQuery = useChildProfessionalEnrollments(childId || null);
  const paymentsQuery = useChildProfessionalPayments(childId || null);

  const children: any[] = (childrenQuery.data as any[]) ?? [];
  const enrollments: any[] = (enrollmentsQuery.data as any[]) ?? [];
  const payments: any[] = (paymentsQuery.data as any[]) ?? [];

  const nbConfirmees = useMemo(
    () =>
      enrollments.filter(
        (e) => e.statut === "confirmee" || e.statut === "terminee"
      ).length,
    [enrollments]
  );
  const totalPaye = useMemo(
    () => payments.reduce((sum, p) => sum + Number(p.montant ?? 0), 0),
    [payments]
  );

  return (
    <div className="space-y-8 max-w-7xl mx-auto p-6">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold bg-gradient-to-r from-green-500 to-blue-500 bg-clip-text text-transparent">
          Parcours professionnel de mon enfant
        </h1>
        <p className="text-muted-foreground mt-2">
          Consultation en lecture seule des inscriptions et paiements
          professionnels.
        </p>
      </div>

      {/* Sélection de l'enfant */}
      <Card className="shadow-lg">
        <CardContent className="p-6">
          <div className="w-full lg:w-[32rem]">
            <label className="text-sm font-medium text-foreground mb-1.5 block">
              Enfant
            </label>
            <Select value={childId || undefined} onValueChange={setChildId}>
              <SelectTrigger className="h-11">
                <Users className="h-4 w-4 mr-2 text-muted-foreground" />
                <SelectValue placeholder="Choisir un enfant" />
              </SelectTrigger>
              <SelectContent>
                {children.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.first_name} {c.last_name}
                    {c.student_number ? ` (${c.student_number})` : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {!childId && (
        <Card className="shadow-lg">
          <CardContent className="flex flex-col items-center justify-center py-16">
            <div className="text-center space-y-4">
              <div className="bg-gradient-to-br from-green-500/20 to-blue-500/20 rounded-full w-20 h-20 flex items-center justify-center mx-auto">
                <Users className="h-10 w-10 text-green-400" />
              </div>
              <div>
                <h3 className="text-xl font-semibold text-foreground mb-2">
                  Sélectionnez un enfant
                </h3>
                <p className="text-muted-foreground">
                  Choisissez un enfant ci-dessus pour consulter son parcours
                  professionnel.
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {childId && (
        <>
          {/* Statistiques rapides */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div className="bg-gradient-to-br from-green-500 to-emerald-600 p-6 rounded-xl text-white shadow-lg hover:shadow-xl transition-all duration-300 transform hover:scale-105">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-white/80 text-sm font-medium">
                    Total inscriptions
                  </p>
                  <p className="text-3xl font-bold mt-1">
                    {enrollments.length}
                  </p>
                </div>
                <div className="bg-white/20 p-3 rounded-lg">
                  <GraduationCap className="h-6 w-6" />
                </div>
              </div>
            </div>
            <div className="bg-gradient-to-br from-blue-500 to-indigo-600 p-6 rounded-xl text-white shadow-lg hover:shadow-xl transition-all duration-300 transform hover:scale-105">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-white/80 text-sm font-medium">
                    Inscriptions confirmées
                  </p>
                  <p className="text-3xl font-bold mt-1">{nbConfirmees}</p>
                </div>
                <div className="bg-white/20 p-3 rounded-lg">
                  <CheckCircle2 className="h-6 w-6" />
                </div>
              </div>
            </div>
            <div className="bg-gradient-to-br from-purple-500 to-pink-600 p-6 rounded-xl text-white shadow-lg hover:shadow-xl transition-all duration-300 transform hover:scale-105">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-white/80 text-sm font-medium">
                    Total payé
                  </p>
                  <p className="text-2xl font-bold mt-1">
                    {fmtFCFA(totalPaye)}
                  </p>
                </div>
                <div className="bg-white/20 p-3 rounded-lg">
                  <Wallet className="h-6 w-6" />
                </div>
              </div>
            </div>
          </div>

          {/* Inscriptions */}
          <Card className="shadow-lg">
            <CardContent className="p-6 space-y-4">
              <div className="flex items-center gap-2">
                <GraduationCap className="h-5 w-5 text-green-400" />
                <h2 className="font-semibold text-foreground">
                  Inscriptions
                  <span className="ml-2 text-sm font-normal text-muted-foreground">
                    ({enrollments.length})
                  </span>
                </h2>
              </div>

              {enrollmentsQuery.isLoading ? (
                <div className="flex flex-col items-center justify-center py-12">
                  <div className="bg-gradient-to-br from-green-500/20 to-blue-500/20 rounded-full w-14 h-14 flex items-center justify-center">
                    <Loader2 className="h-7 w-7 animate-spin text-green-400" />
                  </div>
                  <p className="text-muted-foreground mt-3">
                    Chargement des inscriptions…
                  </p>
                </div>
              ) : enrollmentsQuery.isError ? (
                <div className="flex flex-col items-center justify-center py-12 text-center">
                  <div className="w-14 h-14 bg-red-500/15 rounded-full flex items-center justify-center">
                    <AlertCircle className="h-7 w-7 text-red-400" />
                  </div>
                  <p className="text-muted-foreground mt-3">
                    {(enrollmentsQuery.error as Error)?.message ??
                      "Erreur de chargement."}
                  </p>
                </div>
              ) : enrollments.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12 text-center">
                  <div className="bg-gradient-to-br from-green-500/20 to-blue-500/20 rounded-full w-14 h-14 flex items-center justify-center">
                    <GraduationCap className="h-7 w-7 text-green-400" />
                  </div>
                  <p className="text-muted-foreground mt-3">
                    Aucune inscription professionnelle.
                  </p>
                </div>
              ) : (
                <div className="rounded-lg border border-border overflow-hidden">
                  <Table>
                    <TableHeader>
                      <TableRow className="bg-muted/40 hover:bg-muted/40">
                        <TableHead>Matière</TableHead>
                        <TableHead>Session</TableHead>
                        <TableHead>Période</TableHead>
                        <TableHead>Commande</TableHead>
                        <TableHead>Statut</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {enrollments.map((e) => (
                        <TableRow key={e.id}>
                          <TableCell>
                            <span className="font-mono text-xs text-muted-foreground">
                              {e.subject_code}
                            </span>{" "}
                            {e.subject_libelle}
                          </TableCell>
                          <TableCell>{e.session_libelle}</TableCell>
                          <TableCell className="whitespace-nowrap">
                            {fmtDate(e.date_debut)} → {fmtDate(e.date_fin)}
                          </TableCell>
                          <TableCell className="font-mono text-xs text-muted-foreground">
                            {e.order_reference}
                          </TableCell>
                          <TableCell>
                            <StatutBadge statut={e.statut} />
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Paiements */}
          <Card className="shadow-lg">
            <CardContent className="p-6 space-y-4">
              <div className="flex items-center gap-2">
                <CreditCard className="h-5 w-5 text-blue-400" />
                <h2 className="font-semibold text-foreground">
                  Paiements
                  <span className="ml-2 text-sm font-normal text-muted-foreground">
                    ({payments.length})
                  </span>
                </h2>
              </div>

              {paymentsQuery.isLoading ? (
                <div className="flex flex-col items-center justify-center py-12">
                  <div className="bg-gradient-to-br from-blue-500/20 to-indigo-500/20 rounded-full w-14 h-14 flex items-center justify-center">
                    <Loader2 className="h-7 w-7 animate-spin text-blue-400" />
                  </div>
                  <p className="text-muted-foreground mt-3">
                    Chargement des paiements…
                  </p>
                </div>
              ) : payments.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12 text-center">
                  <div className="bg-gradient-to-br from-blue-500/20 to-indigo-500/20 rounded-full w-14 h-14 flex items-center justify-center">
                    <CreditCard className="h-7 w-7 text-blue-400" />
                  </div>
                  <p className="text-muted-foreground mt-3">
                    Aucun paiement professionnel.
                  </p>
                </div>
              ) : (
                <div className="rounded-lg border border-border overflow-hidden">
                  <Table>
                    <TableHeader>
                      <TableRow className="bg-muted/40 hover:bg-muted/40">
                        <TableHead>Commande</TableHead>
                        <TableHead>Montant</TableHead>
                        <TableHead>Mode</TableHead>
                        <TableHead>Reçu</TableHead>
                        <TableHead>Statut</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {payments.map((p) => (
                        <TableRow key={p.id}>
                          <TableCell className="font-mono text-xs text-muted-foreground">
                            {p.order_reference}
                          </TableCell>
                          <TableCell className="whitespace-nowrap font-medium text-foreground">
                            {fmtFCFA(p.montant)}
                          </TableCell>
                          <TableCell>{p.mode}</TableCell>
                          <TableCell className="font-mono text-xs text-muted-foreground">
                            {p.receipt_number ?? "—"}
                          </TableCell>
                          <TableCell>
                            <StatutBadge statut={p.statut} />
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
