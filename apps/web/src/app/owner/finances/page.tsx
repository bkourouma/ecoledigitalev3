"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useSession } from "next-auth/react";
import { Loader2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useOwnerFinances } from "@/lib/hooks/use-owner-finances";
import { createApiHeaders } from "@/lib/api-utils";
import type { OwnerFinancesPeriod } from "@ecoledigitale/contracts";

const PERIOD_OPTIONS: { value: OwnerFinancesPeriod; label: string }[] = [
  { value: "month", label: "Mois en cours" },
  { value: "quarter", label: "Trimestre en cours" },
  { value: "year", label: "Année civile en cours" },
  { value: "academic_year", label: "Année scolaire" },
];

function isUuid(s: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    s.trim()
  );
}

export default function OwnerFinancesPage() {
  const { data: session } = useSession();
  const queryClient = useQueryClient();
  const tenantId = (session as { tenantId?: string } | null)?.tenantId ?? "no-tenant";

  const [period, setPeriod] = useState<OwnerFinancesPeriod>("month");
  const [academicYearIdInput, setAcademicYearIdInput] = useState("");
  const [cycleIdInput, setCycleIdInput] = useState("");
  const [payrollFeedback, setPayrollFeedback] = useState<{
    type: "ok" | "err";
    message: string;
  } | null>(null);

  const validatePayroll = useMutation({
    mutationFn: async (paymentId: string) => {
      const headers = createApiHeaders(session);
      const res = await fetch(`/api/v1/owner/payroll/${paymentId}/validate`, {
        method: "PATCH",
        headers: { ...headers, "Content-Type": "application/json" },
      });
      const body = (await res.json().catch(() => ({}))) as { message?: string };
      if (!res.ok) {
        throw new Error(body.message || `Erreur ${res.status}`);
      }
      return body;
    },
    onSuccess: async () => {
      setPayrollFeedback({ type: "ok", message: "Paiement approuvé." });
      await queryClient.invalidateQueries({ queryKey: ["owner-finances", tenantId] });
    },
    onError: (e: Error) => {
      setPayrollFeedback({ type: "err", message: e.message });
    },
  });

  const queryParams = useMemo(() => {
    const academicYearId =
      period === "academic_year" && isUuid(academicYearIdInput)
        ? academicYearIdInput.trim()
        : undefined;
    const cycleId = isUuid(cycleIdInput) ? cycleIdInput.trim() : undefined;
    return { period, academicYearId, cycleId };
  }, [period, academicYearIdInput, cycleIdInput]);

  const { data, isLoading, error, refetch } = useOwnerFinances(queryParams);

  const fmt = (n: number) =>
    new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 0 }).format(n);

  return (
    <div className="space-y-8">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 className="text-xl font-semibold tracking-tight">Finances</h2>
          <p className="text-sm text-muted-foreground mt-1">
            Recouvrement par classe, impayés (références élèves anonymisées) et masse salariale
            enseignants sur la période choisie.
          </p>
        </div>
        <Button variant="outline" size="sm" asChild>
          <Link href="/owner/finances/rapport">Exports PDF / CSV</Link>
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Filtres</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-3">
          <div className="space-y-2">
            <Label>Période</Label>
            <Select
              value={period}
              onValueChange={(v) => setPeriod(v as OwnerFinancesPeriod)}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PERIOD_OPTIONS.map((o) => (
                  <SelectItem key={o.value} value={o.value}>
                    {o.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {period === "academic_year" ? (
            <div className="space-y-2 md:col-span-2">
              <Label htmlFor="ay">Identifiant année scolaire (UUID)</Label>
              <Input
                id="ay"
                placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
                value={academicYearIdInput}
                onChange={(e) => setAcademicYearIdInput(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                Sans UUID valide, la période utilisée est le mois en cours (repli côté API).
              </p>
            </div>
          ) : null}
          <div className="space-y-2 md:col-span-3">
            <Label htmlFor="cycle">Cycle (UUID, optionnel)</Label>
            <Input
              id="cycle"
              placeholder="Filtrer par cycle — laisser vide pour tout le tenant"
              value={cycleIdInput}
              onChange={(e) => setCycleIdInput(e.target.value)}
            />
          </div>
          <div className="md:col-span-3">
            <Button type="button" variant="secondary" size="sm" onClick={() => refetch()}>
              Actualiser
            </Button>
          </div>
        </CardContent>
      </Card>

      {isLoading ? (
        <div className="flex items-center justify-center py-16 text-muted-foreground gap-2">
          <Loader2 className="h-6 w-6 animate-spin" />
          Chargement des finances…
        </div>
      ) : null}

      {error ? (
        <Card className="max-w-lg border-red-200 bg-red-50">
          <CardHeader>
            <CardTitle className="text-red-800 text-base">Erreur</CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-red-700">
            {error instanceof Error ? error.message : "Chargement impossible."}
          </CardContent>
        </Card>
      ) : null}

      {data ? (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  Encours attendu / perçu
                </CardTitle>
              </CardHeader>
              <CardContent className="text-lg font-semibold">
                {fmt(data.totals.expectedTuition)} / {fmt(data.totals.collectedTuition)} FCFA
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  Taux de recouvrement
                </CardTitle>
              </CardHeader>
              <CardContent className="text-lg font-semibold">{data.totals.recoveryRate}%</CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  Retards ({data.totals.overdueCount})
                </CardTitle>
              </CardHeader>
              <CardContent className="text-lg font-semibold">{fmt(data.totals.overdueAmount)} FCFA</CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  Masse salariale (période)
                </CardTitle>
              </CardHeader>
              <CardContent className="text-lg font-semibold">
                {fmt(data.totals.teacherPayrollTotal)} FCFA
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Recouvrement par classe</CardTitle>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Classe</TableHead>
                    <TableHead>Cycle</TableHead>
                    <TableHead className="text-right">Attendu</TableHead>
                    <TableHead className="text-right">Perçu</TableHead>
                    <TableHead className="text-right">Taux</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.recoveryByClass.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={5} className="text-muted-foreground text-sm">
                        Aucune échéance sur la période (ou données indisponibles).
                      </TableCell>
                    </TableRow>
                  ) : (
                    data.recoveryByClass.map((r) => (
                      <TableRow key={r.classId}>
                        <TableCell>{r.className}</TableCell>
                        <TableCell>{r.cycleName ?? "—"}</TableCell>
                        <TableCell className="text-right">{fmt(r.expected)}</TableCell>
                        <TableCell className="text-right">{fmt(r.collected)}</TableCell>
                        <TableCell className="text-right">{r.recoveryRate}%</TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          <div className="grid gap-6 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Impayés (réf. anonymisée)</CardTitle>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Réf.</TableHead>
                      <TableHead>Classe</TableHead>
                      <TableHead className="text-right">Dû</TableHead>
                      <TableHead>Échéance</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.overdueInstallments.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={4} className="text-muted-foreground text-sm">
                          Aucun impayé listé.
                        </TableCell>
                      </TableRow>
                    ) : (
                      data.overdueInstallments.map((o, i) => (
                        <TableRow key={`${o.studentRef}-${o.dueDate}-${i}`}>
                          <TableCell className="font-mono text-xs">{o.studentRef}</TableCell>
                          <TableCell>{o.className ?? "—"}</TableCell>
                          <TableCell className="text-right">{fmt(o.amountDue)}</TableCell>
                          <TableCell>{o.dueDate}</TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">Rémunérations enseignants</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {payrollFeedback ? (
                  <p
                    className={
                      payrollFeedback.type === "ok"
                        ? "text-sm text-green-700"
                        : "text-sm text-red-600"
                    }
                    role="status"
                  >
                    {payrollFeedback.message}
                  </p>
                ) : null}
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Enseignant</TableHead>
                      <TableHead>Période paie</TableHead>
                      <TableHead className="text-right">Montant</TableHead>
                      <TableHead>Statut</TableHead>
                      <TableHead className="text-right w-[120px]">Action</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.teacherPayroll.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={5} className="text-muted-foreground text-sm">
                          Aucun paiement sur l&apos;intervalle.
                        </TableCell>
                      </TableRow>
                    ) : (
                      data.teacherPayroll.map((p) => (
                        <TableRow key={p.id}>
                          <TableCell>{p.teacherName}</TableCell>
                          <TableCell>{p.periodLabel ?? "—"}</TableCell>
                          <TableCell className="text-right">{fmt(p.amount)}</TableCell>
                          <TableCell className="capitalize">{p.status}</TableCell>
                          <TableCell className="text-right">
                            {p.status === "calculated" ? (
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                disabled={
                                  validatePayroll.isPending ||
                                  !session ||
                                  tenantId === "no-tenant"
                                }
                                onClick={() => {
                                  setPayrollFeedback(null);
                                  validatePayroll.mutate(p.id);
                                }}
                              >
                                {validatePayroll.isPending &&
                                validatePayroll.variables === p.id ? (
                                  <Loader2 className="h-4 w-4 animate-spin" />
                                ) : (
                                  "Valider"
                                )}
                              </Button>
                            ) : (
                              <span className="text-xs text-muted-foreground">—</span>
                            )}
                          </TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </div>
        </>
      ) : null}
    </div>
  );
}
