"use client";

import { useEffect, useMemo, useState } from "react";
import { Card, CardContent } from "@ecoledigitale/ui";
import {
  CalendarCheck,
  Clock,
  CheckCircle2,
  Loader2,
  AlertCircle,
  Info,
  Wallet,
} from "lucide-react";
import { createApiHeaders } from "@/lib/api-utils";

/**
 * Mes séances professionnelles — espace enseignant (feature 031, US5).
 *
 * L'enseignant voit ce qui a été validé pour lui et ce qu'il perçoit. Les
 * endpoints `/my/*` dérivent son identité du jeton : cette page ne peut, par
 * construction, afficher les données de personne d'autre.
 *
 * Un paiement au statut « calculé » est affiché comme PROVISOIRE : tant qu'il
 * n'est pas approuvé, le montant peut encore changer, et laisser croire le
 * contraire créerait des réclamations plutôt que d'en éviter.
 */

const BASE = "/api/v1/professional/remuneration";

interface MySeance {
  id: string;
  date: string;
  heure_debut: string | null;
  heure_fin: string | null;
  duree_heures: number | null;
  statut: string;
  validated_at: string | null;
  payable: boolean;
  ecue_code: string | null;
  ecue_libelle: string | null;
  cohorte_libelle: string | null;
  paiement_statut: string | null;
}

interface MyPayment {
  id: string;
  payment_type: string;
  status: string;
  total_amount: number;
  currency: string;
  period_name: string | null;
  period_start: string | null;
  period_end: string | null;
  heures_professionnelles: number;
  heures_academiques: number;
}

const PAYMENT_STATUS_LABELS: Record<string, { label: string; className: string; provisoire: boolean }> = {
  calculated: { label: "Provisoire (calculé)", className: "bg-blue-100 text-blue-800", provisoire: true },
  approved: { label: "Approuvé", className: "bg-emerald-100 text-emerald-800", provisoire: false },
  paid: { label: "Payé", className: "bg-gray-200 text-gray-800", provisoire: false },
  disputed: { label: "Contesté", className: "bg-amber-100 text-amber-800", provisoire: true },
  cancelled: { label: "Annulé", className: "bg-red-100 text-red-800", provisoire: false },
};

function fmtHeures(h: number | null | undefined): string {
  if (h == null) return "—";
  const heures = Math.floor(h);
  const minutes = Math.round((h - heures) * 60);
  return minutes > 0 ? `${heures}h${String(minutes).padStart(2, "0")}` : `${heures}h`;
}

function fmtDate(d: string | null): string {
  if (!d) return "—";
  const parsed = new Date(d.length === 10 ? `${d}T00:00:00` : d);
  return isNaN(parsed.getTime()) ? d : parsed.toLocaleDateString("fr-FR");
}

function fmtMontant(v: number, devise = "XOF"): string {
  return `${Math.round(v).toLocaleString("fr-FR")} ${devise}`;
}

export default function TeacherProfessionalSeancesPage() {
  const [seances, setSeances] = useState<MySeance[]>([]);
  const [payments, setPayments] = useState<MyPayment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const [seancesRes, paymentsRes] = await Promise.all([
          fetch(`${BASE}/my/seances?limit=200`, { headers: createApiHeaders() }),
          fetch(`${BASE}/my/payments`, { headers: createApiHeaders() }),
        ]);

        if (!seancesRes.ok) {
          const j = await seancesRes.json().catch(() => ({}));
          throw new Error(j?.message ?? `Erreur HTTP ${seancesRes.status}`);
        }
        const seancesJson = await seancesRes.json();
        const paymentsJson = paymentsRes.ok ? await paymentsRes.json() : { data: [] };

        if (cancelled) return;
        setSeances(seancesJson?.data?.items ?? []);
        setPayments(paymentsJson?.data ?? []);
      } catch (e) {
        if (!cancelled) setError((e as Error).message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const stats = useMemo(() => {
    const validees = seances.filter((s) => s.validated_at);
    return {
      total: seances.length,
      validees: validees.length,
      heuresValidees: validees.reduce((sum, s) => sum + (s.duree_heures ?? 0), 0),
    };
  }, [seances]);

  if (loading) {
    return (
      <div className="flex justify-center py-24">
        <Loader2 className="h-10 w-10 animate-spin text-purple-500" />
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-[1300px] mx-auto p-6">
      <div>
        <h1 className="font-bold bg-gradient-to-r from-purple-600 to-indigo-600 bg-clip-text text-transparent flex items-center gap-2 whitespace-nowrap text-2xl leading-tight md:text-3xl">
          <CalendarCheck className="h-7 w-7 text-purple-500" />
          Mes séances professionnelles
        </h1>
        <p className="text-muted-foreground whitespace-nowrap text-sm md:text-base">
          Vos séances d'ECUE et leur prise en compte dans votre rémunération.
        </p>
      </div>

      {error && (
        <Card className="border-red-200">
          <CardContent className="flex items-center gap-3 py-6 text-red-700">
            <AlertCircle className="h-6 w-6 shrink-0" />
            <p>{error}</p>
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <StatCard label="Séances" value={String(stats.total)} icon={<CalendarCheck className="h-5 w-5" />} />
        <StatCard label="Validées pour la paie" value={String(stats.validees)} icon={<CheckCircle2 className="h-5 w-5" />} />
        <StatCard label="Heures validées" value={fmtHeures(stats.heuresValidees)} icon={<Clock className="h-5 w-5" />} />
      </div>

      {/* Paiements */}
      {payments.length > 0 && (
        <Card>
          <CardContent className="p-0">
            <div className="px-4 py-3 border-b font-medium flex items-center gap-2">
              <Wallet className="h-4 w-4 text-purple-500" />
              Mes paiements
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 text-gray-600">
                  <tr>
                    <th className="px-3 py-2 text-left font-medium">Période</th>
                    <th className="px-3 py-2 text-left font-medium">Type</th>
                    <th className="px-3 py-2 text-right font-medium">Heures pro.</th>
                    <th className="px-3 py-2 text-right font-medium">Heures acad.</th>
                    <th className="px-3 py-2 text-right font-medium">Montant</th>
                    <th className="px-3 py-2 text-left font-medium">État</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {payments.map((p) => {
                    const st = PAYMENT_STATUS_LABELS[p.status] ?? {
                      label: p.status,
                      className: "bg-gray-100 text-gray-700",
                      provisoire: false,
                    };
                    return (
                      <tr key={p.id}>
                        <td className="px-3 py-2">
                          {p.period_name ?? "—"}
                          <div className="text-xs text-gray-500">
                            {fmtDate(p.period_start)} → {fmtDate(p.period_end)}
                          </div>
                        </td>
                        <td className="px-3 py-2 capitalize">{p.payment_type}</td>
                        <td className="px-3 py-2 text-right font-mono">{fmtHeures(p.heures_professionnelles)}</td>
                        <td className="px-3 py-2 text-right font-mono">{fmtHeures(p.heures_academiques)}</td>
                        <td className="px-3 py-2 text-right font-mono font-medium">
                          {fmtMontant(p.total_amount, p.currency)}
                        </td>
                        <td className="px-3 py-2">
                          <span className={`inline-block rounded px-2 py-0.5 text-xs font-medium ${st.className}`}>
                            {st.label}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {payments.some((p) => PAYMENT_STATUS_LABELS[p.status]?.provisoire) && (
              <div className="px-4 py-3 border-t bg-blue-50/60 text-sm text-blue-900 flex items-start gap-2">
                <Info className="h-4 w-4 shrink-0 mt-0.5" />
                <p>
                  Un montant « provisoire » n'est pas encore approuvé : il peut évoluer si des
                  séances sont validées ou retirées avant l'approbation.
                </p>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Séances */}
      <Card className="overflow-hidden">
        <div className="px-4 py-3 border-b font-medium">Mes séances</div>
        {seances.length === 0 ? (
          <CardContent className="py-12 text-center text-muted-foreground">
            Aucune séance enregistrée.
          </CardContent>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-gray-600">
                <tr>
                  <th className="px-3 py-2 text-left font-medium">Date</th>
                  <th className="px-3 py-2 text-left font-medium">Horaires</th>
                  <th className="px-3 py-2 text-left font-medium">Durée</th>
                  <th className="px-3 py-2 text-left font-medium">ECUE</th>
                  <th className="px-3 py-2 text-left font-medium">Cohorte</th>
                  <th className="px-3 py-2 text-left font-medium">Prise en compte</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {seances.map((s) => (
                  <tr key={s.id} className={s.payable ? "bg-emerald-50/30" : undefined}>
                    <td className="px-3 py-2 whitespace-nowrap">{fmtDate(s.date)}</td>
                    <td className="px-3 py-2 text-gray-600 whitespace-nowrap">
                      {s.heure_debut && s.heure_fin
                        ? `${s.heure_debut.slice(0, 5)} – ${s.heure_fin.slice(0, 5)}`
                        : "—"}
                    </td>
                    <td className="px-3 py-2 font-medium">{fmtHeures(s.duree_heures)}</td>
                    <td className="px-3 py-2">
                      <span className="font-mono text-xs text-gray-500">{s.ecue_code}</span>{" "}
                      {s.ecue_libelle}
                    </td>
                    <td className="px-3 py-2 text-gray-600">{s.cohorte_libelle ?? "—"}</td>
                    <td className="px-3 py-2">
                      {s.validated_at ? (
                        <span className="inline-flex items-center gap-1 text-xs text-emerald-700 font-medium">
                          <CheckCircle2 className="h-3.5 w-3.5" />
                          Validée
                          {s.paiement_statut && ` · payée`}
                        </span>
                      ) : (
                        // Pas de motif détaillé ici : la validation relève de
                        // l'administration, l'enseignant n'a pas la main dessus.
                        <span className="text-xs text-gray-500">En attente de validation</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}

function StatCard({ label, value, icon }: { label: string; value: string; icon: React.ReactNode }) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-center justify-between">
          <span className="text-sm text-muted-foreground">{label}</span>
          <span className="text-purple-500">{icon}</span>
        </div>
        <div className="text-2xl font-bold mt-1">{value}</div>
      </CardContent>
    </Card>
  );
}
