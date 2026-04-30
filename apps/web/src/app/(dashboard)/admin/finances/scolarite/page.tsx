"use client";

import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import {
  Card, CardHeader, CardTitle, CardDescription, CardContent,
  Button, Input, Select, SelectTrigger, SelectValue, SelectContent, SelectItem,
  Alert, AlertDescription
} from "@ecoledigitale/ui";
import { Save } from "lucide-react";

const API_BASE_URL = "";

export default function AdminScolaritePage() {
  const [selectedCycleId, setSelectedCycleId] = useState<string>("");
  const [selectedProgrammeId, setSelectedProgrammeId] = useState<string>("");
  const [form, setForm] = useState({ inscription: 0, scolarite: 0, annexes: 0, autres: 0, currency: "XOF" });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { data: cyclesData } = useQuery({
    queryKey: ["cycles"],
    queryFn: async () => {
      const res = await fetch(`${API_BASE_URL}/api/v1/cycles`, { headers: {
      "X-Tenant": "imhotepacademy",
      "Content-Type": "application/json",
"X-User-Id": "634a57fe-2007-4ecb-ae5b-f9e3152a24fb"
    } });
      const json = await res.json();
      return json.data || [];
    }
  });

  const { data: programmesData } = useQuery({
    queryKey: ["programmes-by-cycle", selectedCycleId],
    enabled: !!selectedCycleId,
    queryFn: async () => {
      const res = await fetch(`${API_BASE_URL}/api/v1/programmes?cycleId=${selectedCycleId}&limit=100`, { headers: {
      "X-Tenant": "imhotepacademy",
      "Content-Type": "application/json",
"X-User-Id": "634a57fe-2007-4ecb-ae5b-f9e3152a24fb"
    } });
      if (!res.ok) {
        throw new Error(`Failed to fetch programmes: ${res.statusText}`);
      }
      const json = await res.json();
      return json.data || [];
    },
  });

  const { data: feesData, refetch } = useQuery({
    queryKey: ["cycle-fees", selectedCycleId, selectedProgrammeId],
    enabled: !!selectedCycleId && !!selectedProgrammeId,
    queryFn: async () => {
      const res = await fetch(
        `${API_BASE_URL}/api/v1/cycle-fees?cycleId=${selectedCycleId}&programmeId=${selectedProgrammeId}`,
        {
          headers: {
            "X-Tenant": "imhotepacademy",
            "Content-Type": "application/json",
            "X-User-Id": "634a57fe-2007-4ecb-ae5b-f9e3152a24fb"
          }
        }
      );
      if (!res.ok) {
        throw new Error(`Failed to fetch cycle fees: ${res.statusText}`);
      }
      const json = await res.json();
      const fees = (json.data || [])[0];
      return fees || null;
    }
  });

  useEffect(() => {
    setSelectedProgrammeId("");
    setForm({ inscription: 0, scolarite: 0, annexes: 0, autres: 0, currency: "XOF" });
  }, [selectedCycleId]);

  useEffect(() => {
    if (feesData) {
      setForm({
        inscription: Number(feesData.inscription || 0),
        scolarite: Number(feesData.scolarite || 0),
        annexes: Number(feesData.annexes || 0),
        autres: Number(feesData.autres || 0),
        currency: feesData.currency || "XOF",
      });
    } else if (selectedProgrammeId) {
      setForm({ inscription: 0, scolarite: 0, annexes: 0, autres: 0, currency: "XOF" });
    }
  }, [feesData, selectedProgrammeId]);

  async function saveFees() {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`${API_BASE_URL}/api/v1/cycle-fees/upsert`, {
        method: "POST",
        headers: {
      "Content-Type": "application/json",
      "X-Tenant": "imhotepacademy",
"X-User-Id": "634a57fe-2007-4ecb-ae5b-f9e3152a24fb"
    },
        body: JSON.stringify({ cycleId: selectedCycleId, programmeId: selectedProgrammeId, ...form })
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.message || "Erreur lors de l'enregistrement");
      await refetch();
    } catch (e: any) {
      setError(e?.message || "Erreur inconnue");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="container mx-auto px-6 py-8 space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Scolarité - Barème par cycle et filière</h1>
          <p className="text-muted-foreground mt-1">
            Définir les montants par défaut d'inscription, scolarité et autres frais pour chaque couple cycle + filière.
            Ces montants seront automatiquement appliqués lors de l'inscription des étudiants si aucun montant spécifique n'est défini.
          </p>
        </div>
      </div>

      <Card>
        <CardContent className="space-y-4">
          <div>
            <label className="text-sm text-muted-foreground">Cycle</label>
            <Select value={selectedCycleId} onValueChange={setSelectedCycleId}>
              <SelectTrigger className="mt-1 w-full">
                <SelectValue placeholder="Sélectionner un cycle" />
              </SelectTrigger>
              <SelectContent>
                {(cyclesData || []).map((c: any) => (
                  <SelectItem key={c.id} value={c.id}>{c.name} ({c.code})</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {selectedCycleId ? (
            <div>
              <label className="text-sm text-muted-foreground">Filière (obligatoire)</label>
              <Select value={selectedProgrammeId} onValueChange={setSelectedProgrammeId}>
                <SelectTrigger className="mt-1 w-full">
                  <SelectValue placeholder="Sélectionner une filière liée au cycle" />
                </SelectTrigger>
                <SelectContent>
                  {(programmesData || []).map((p: any) => (
                    <SelectItem key={p.id} value={p.id}>{p.name} ({p.code})</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {Array.isArray(programmesData) && programmesData.length === 0 ? (
                <p className="mt-2 text-sm text-amber-600">
                  Aucune filière trouvée pour ce cycle. Créez une filière dans la page Programmes avant de configurer les frais.
                </p>
              ) : null}
            </div>
          ) : null}
        </CardContent>
      </Card>

      {selectedCycleId && selectedProgrammeId ? (
        <Card>
          <CardHeader>
            <CardTitle>Frais du cycle et de la filière sélectionnés</CardTitle>
            <CardDescription>Modifiez les montants par défaut pour cette filière</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {error ? (
              <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>
            ) : null}

            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              <div>
                <label className="text-sm text-muted-foreground">Inscription</label>
                <Input type="number" min={0} value={form.inscription} onChange={(e) => setForm({ ...form, inscription: Number(e.target.value || 0) })} className="mt-1" />
              </div>
              <div>
                <label className="text-sm text-muted-foreground">Scolarité</label>
                <Input type="number" min={0} value={form.scolarite} onChange={(e) => setForm({ ...form, scolarite: Number(e.target.value || 0) })} className="mt-1" />
              </div>
              <div>
                <label className="text-sm text-muted-foreground">Frais annexes</label>
                <Input type="number" min={0} value={form.annexes} onChange={(e) => setForm({ ...form, annexes: Number(e.target.value || 0) })} className="mt-1" />
              </div>
              <div>
                <label className="text-sm text-muted-foreground">Autres frais</label>
                <Input type="number" min={0} value={form.autres} onChange={(e) => setForm({ ...form, autres: Number(e.target.value || 0) })} className="mt-1" />
              </div>
            </div>

            <div className="flex gap-3 pt-4">
              <Button onClick={saveFees} disabled={!selectedCycleId || !selectedProgrammeId || saving}>
                {saving ? "Enregistrement..." : (
                  <span className="flex items-center gap-2"><Save className="h-4 w-4" /> Enregistrer</span>
                )}
              </Button>
              <Link href="/admin/finances">
                <Button variant="outline">Retour Tableau de bord</Button>
              </Link>
            </div>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
