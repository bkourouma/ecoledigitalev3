"use client";

import { useEffect, useState } from "react";
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
import { ArrowLeft, Loader2 } from "lucide-react";
import { SubjectMaterialsPanel } from "@/components/professional/SubjectMaterialsPanel";
import {
  useProfessionalEcue,
  useUpdateProfessionalEcue,
} from "@/lib/hooks/use-professional-catalog-admin";

/**
 * Édition d'une ECUE — Module Professionnel (feature 030).
 * Mêmes champs que la création : code, libellé, crédits.
 */

interface EcueFormState {
  code: string;
  libelle: string;
  credits: string;
}

const LIST_URL = "/professionnel/admin/matieres";

export default function EditProfessionalEcuePage() {
  const router = useRouter();
  const params = useParams();
  const ecueId = String(params?.id ?? "");

  const [form, setForm] = useState<EcueFormState | null>(null);
  const [error, setError] = useState<string | null>(null);

  const ecueQuery = useProfessionalEcue(ecueId || null);
  const updateMut = useUpdateProfessionalEcue();

  const ecue: any = ecueQuery.data;
  const linkedUe: any[] = ecue?.ue ?? [];

  useEffect(() => {
    if (ecue && !form) {
      setForm({
        code: ecue.code,
        libelle: ecue.libelle,
        credits:
          ecue.credits === null || ecue.credits === undefined ? "" : String(ecue.credits),
      });
    }
  }, [ecue, form]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form) return;
    setError(null);
    try {
      await updateMut.mutateAsync({
        id: ecueId,
        data: {
          code: form.code,
          libelle: form.libelle,
          credits: form.credits.trim() === "" ? null : Number(form.credits),
        },
      });
      router.push(LIST_URL);
    } catch (err: any) {
      setError(err?.message ?? "Erreur lors de l'enregistrement.");
    }
  }

  if (ecueQuery.isLoading || !form) {
    return (
      <div className="max-w-7xl mx-auto p-6">
        <Card className="shadow-lg">
          <CardContent className="flex flex-col items-center justify-center py-16">
            <Loader2 className="h-8 w-8 animate-spin text-green-600" />
            <p className="text-gray-600 mt-3">Chargement de l'ECUE…</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (ecueQuery.isError) {
    return (
      <div className="max-w-7xl mx-auto p-6 space-y-4">
        <Button variant="outline" size="sm" onClick={() => router.push(LIST_URL)}>
          <ArrowLeft className="h-4 w-4 mr-2" />
          Retour
        </Button>
        <div className="rounded-md border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-700">
          {(ecueQuery.error as Error)?.message ?? "ECUE introuvable."}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-8 max-w-7xl mx-auto p-6">
      <div className="flex items-center gap-4">
        <Button variant="outline" size="sm" onClick={() => router.push(LIST_URL)}>
          <ArrowLeft className="h-4 w-4 mr-2" />
          Retour
        </Button>
        <div>
          <h1 className="text-3xl font-bold bg-gradient-to-r from-green-600 to-blue-600 bg-clip-text text-transparent">
            Modifier l'ECUE
          </h1>
          <p className="text-muted-foreground mt-2">
            {ecue?.code} — {ecue?.libelle}
          </p>
        </div>
      </div>

      {error && (
        <div className="rounded-md border border-red-300 bg-red-50 px-4 py-2 text-sm text-red-700">
          {error}
        </div>
      )}

      <div className="max-w-4xl mx-auto w-full space-y-6">
        <Card className="shadow-lg">
          <CardHeader>
            <CardTitle>Informations de l'ECUE</CardTitle>
            <CardDescription>
              {linkedUe.length > 0
                ? `Mutualisée dans ${linkedUe.length} UE : ${linkedUe
                    .map((u: any) => u.code)
                    .join(", ")}`
                : "Cette ECUE n'est encore rattachée à aucune UE."}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-5">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="space-y-1.5">
                  <label className="text-sm font-medium">Code</label>
                  <Input
                    value={form.code}
                    onChange={(e) => setForm({ ...form, code: e.target.value })}
                    placeholder="Ex. : ECUE-COMPTA-1"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-sm font-medium">Libellé</label>
                  <Input
                    value={form.libelle}
                    onChange={(e) => setForm({ ...form, libelle: e.target.value })}
                    placeholder="Ex. : Comptabilité générale"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-sm font-medium">Crédits</label>
                  <Input
                    type="number"
                    min={0}
                    step={1}
                    value={form.credits}
                    onChange={(e) => setForm({ ...form, credits: e.target.value })}
                    placeholder="Ex. : 4"
                  />
                </div>
              </div>

              <div className="flex gap-3 pt-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => router.push(LIST_URL)}
                  disabled={updateMut.isPending}
                >
                  Annuler
                </Button>
                <Button type="submit" disabled={updateMut.isPending}>
                  {updateMut.isPending ? (
                    <span className="flex items-center">
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      Enregistrement…
                    </span>
                  ) : (
                    "Enregistrer"
                  )}
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>

        {/* Supports de cours (rattachés à l'ECUE) */}
        <div id="supports" className="scroll-mt-24">
          <SubjectMaterialsPanel subjectId={ecueId} canManage canViewStats />
        </div>
      </div>
    </div>
  );
}
