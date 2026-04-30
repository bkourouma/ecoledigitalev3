"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
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
import { useSession } from "next-auth/react";
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

function buildReportQuery(
  format: "pdf" | "csv",
  period: OwnerFinancesPeriod,
  academicYearId?: string,
  cycleId?: string
): string {
  const sp = new URLSearchParams();
  sp.set("format", format);
  sp.set("period", period);
  if (academicYearId) sp.set("academicYearId", academicYearId);
  if (cycleId) sp.set("cycleId", cycleId);
  return sp.toString();
}

export default function OwnerFinancialReportPage() {
  const { data: session } = useSession();
  const [period, setPeriod] = useState<OwnerFinancesPeriod>("month");
  const [academicYearIdInput, setAcademicYearIdInput] = useState("");
  const [cycleIdInput, setCycleIdInput] = useState("");
  const [busy, setBusy] = useState<"pdf" | "csv" | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const { academicYearId, cycleId } = useMemo(() => {
    const ay =
      period === "academic_year" && isUuid(academicYearIdInput)
        ? academicYearIdInput.trim()
        : undefined;
    const c = isUuid(cycleIdInput) ? cycleIdInput.trim() : undefined;
    return { academicYearId: ay, cycleId: c };
  }, [period, academicYearIdInput, cycleIdInput]);

  async function download(format: "pdf" | "csv") {
    setErr(null);
    setBusy(format);
    try {
      const headers = createApiHeaders(session);
      const qs = buildReportQuery(format, period, academicYearId, cycleId);
      const res = await fetch(`/api/v1/owner/reports/financial?${qs}`, { headers });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(
          (body as { message?: string }).message || `Erreur ${res.status} lors du téléchargement`
        );
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = format === "csv" ? `rapport-financier-${period}.csv` : `rapport-financier-${period}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Échec du téléchargement");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-8">
      <div>
        <Button variant="ghost" size="sm" className="mb-2 -ml-2" asChild>
          <Link href="/owner/finances">← Retour aux finances</Link>
        </Button>
        <h2 className="text-xl font-semibold tracking-tight">Rapport financier</h2>
        <p className="text-sm text-muted-foreground mt-1">
          Export CSV (données tabulaires) ou PDF (même périmètre, mise en page imprimable). Les
          identifiants élèves sont masqués dans les listes d&apos;impayés.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Paramètres d&apos;export</CardTitle>
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
              <Label htmlFor="ay-r">Année scolaire (UUID)</Label>
              <Input
                id="ay-r"
                placeholder="UUID de l&apos;année scolaire"
                value={academicYearIdInput}
                onChange={(e) => setAcademicYearIdInput(e.target.value)}
              />
            </div>
          ) : null}
          <div className="space-y-2 md:col-span-3">
            <Label htmlFor="cycle-r">Cycle (UUID, optionnel)</Label>
            <Input
              id="cycle-r"
              value={cycleIdInput}
              onChange={(e) => setCycleIdInput(e.target.value)}
            />
          </div>
          <div className="flex flex-wrap gap-2 md:col-span-3">
            <Button
              type="button"
              onClick={() => download("csv")}
              disabled={!!busy || !session}
            >
              {busy === "csv" ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  CSV…
                </>
              ) : (
                "Télécharger CSV"
              )}
            </Button>
            <Button
              type="button"
              variant="secondary"
              onClick={() => download("pdf")}
              disabled={!!busy || !session}
            >
              {busy === "pdf" ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  PDF…
                </>
              ) : (
                "Télécharger PDF"
              )}
            </Button>
          </div>
          {err ? <p className="text-sm text-red-600 md:col-span-3">{err}</p> : null}
        </CardContent>
      </Card>
    </div>
  );
}
