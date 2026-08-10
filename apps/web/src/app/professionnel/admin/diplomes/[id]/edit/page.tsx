"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle, Button, Input, Label, Textarea } from "@ecoledigitale/ui";
import { ArrowLeft, GraduationCap, Loader2, Save } from "lucide-react";
import { useDiploma, useUpdateDiploma } from "@/lib/hooks/use-professional-diplomas";

export default function EditDiplomaPage() {
  const router = useRouter();
  const params = useParams();
  const id = (params?.id as string) ?? "";
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({ libelle: "", description: "", statut: "actif" });

  const diplomaQuery = useDiploma(id);
  const updateMut = useUpdateDiploma();
  const diploma: any = diplomaQuery.data;

  useEffect(() => {
    if (diploma) {
      setForm({
        libelle: diploma.libelle ?? "",
        description: diploma.description ?? "",
        statut: diploma.statut ?? "actif",
      });
    }
  }, [diploma]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await updateMut.mutateAsync({
        id,
        data: {
          libelle: form.libelle.trim(),
          description: form.description.trim() || null,
          statut: form.statut as "actif" | "inactif",
        },
      });
      router.push(`/professionnel/admin/diplomes/${id}`);
    } catch (err: any) {
      setError(err?.message ?? "Erreur lors de la mise à jour du diplôme.");
    }
  }

  if (diplomaQuery.isLoading) {
    return (
      <div className="max-w-3xl mx-auto p-6">
        <Card className="shadow-lg">
          <CardContent className="flex items-center justify-center py-16">
            <Loader2 className="h-8 w-8 animate-spin text-emerald-600" />
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto p-6 space-y-6">
      <div className="flex items-center gap-4">
        <Button variant="outline" size="sm" onClick={() => router.push(`/professionnel/admin/diplomes/${id}`)}>
          <ArrowLeft className="h-4 w-4 mr-2" />
          Retour
        </Button>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <GraduationCap className="h-6 w-6 text-emerald-600" />
          Modifier le diplôme
        </h1>
      </div>

      <Card className="shadow-lg">
        <CardHeader>
          <CardTitle className="font-mono text-base text-muted-foreground">{diploma?.code}</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            {error && (
              <div className="rounded-md border border-red-300 bg-red-50 px-4 py-2 text-sm text-red-700">
                {error}
              </div>
            )}

            <div className="space-y-1.5">
              <Label>Libellé</Label>
              <Input
                value={form.libelle}
                onChange={(e) => setForm({ ...form, libelle: e.target.value })}
                required
              />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label>UV requises</Label>
                <Input value={`${diploma?.uv_required ?? "—"} (calculées automatiquement)`} disabled />
                <p className="text-xs text-muted-foreground">
                  Recalculées à chaque ouverture du diplôme, à partir des UE des semestres du cycle.
                </p>
              </div>
              <div className="space-y-1.5">
                <Label>Statut</Label>
                <select
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                  value={form.statut}
                  onChange={(e) => setForm({ ...form, statut: e.target.value })}
                >
                  <option value="actif">Actif</option>
                  <option value="inactif">Inactif</option>
                </select>
              </div>
            </div>

            <div className="space-y-1.5">
              <Label>Description</Label>
              <Textarea
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
                rows={3}
              />
            </div>

            <div className="flex justify-end">
              <Button type="submit" disabled={updateMut.isPending}>
                {updateMut.isPending ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <Save className="h-4 w-4 mr-2" />
                )}
                Enregistrer
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
