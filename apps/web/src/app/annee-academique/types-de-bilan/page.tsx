"use client";

import { FormEvent, useMemo, useState } from "react";
import {
  CheckCircle2,
  ClipboardList,
  Edit,
  Loader2,
  Plus,
  Sparkles,
  Trash2,
} from "lucide-react";
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Input,
} from "@ecoledigitale/ui";
import { toast } from "sonner";
import {
  BilanType,
  useBilanTypes,
  useCreateBilanType,
  useDeleteBilanType,
  useUpdateBilanType,
} from "@/lib/hooks/use-bilan-types";

const initialForm = {
  name: "",
};

export default function TypesDeBilanPage() {
  const [form, setForm] = useState(initialForm);
  const [editingId, setEditingId] = useState<string | null>(null);

  const { data: bilanTypesData, isLoading } = useBilanTypes({
    page: 1,
    limit: 100,
  });
  const createBilanType = useCreateBilanType();
  const updateBilanType = useUpdateBilanType();
  const deleteBilanType = useDeleteBilanType();

  const bilanTypes = bilanTypesData?.data || [];

  const stats = useMemo(() => {
    return {
      total: bilanTypes.length,
      filtered: bilanTypes.length,
      recent: bilanTypes.filter((item) => {
        const createdAt = new Date(item.createdAt).getTime();
        const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
        return createdAt >= sevenDaysAgo;
      }).length,
    };
  }, [bilanTypes]);

  function resetForm() {
    setForm(initialForm);
    setEditingId(null);
  }

  function startEdit(item: BilanType) {
    setEditingId(item.id);
    setForm({
      name: item.name,
    });
  }

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();

    if (!form.name.trim()) {
      toast.error("Le libelle est requis");
      return;
    }

    try {
      if (editingId) {
        await updateBilanType.mutateAsync({
          id: editingId,
          data: {
            name: form.name.trim(),
          },
        });
        toast.success("Type de bilan mis a jour");
      } else {
        await createBilanType.mutateAsync({
          name: form.name.trim(),
        });
        toast.success("Type de bilan cree");
      }

      resetForm();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Erreur lors de l'enregistrement");
    }
  }

  async function handleDelete(item: BilanType) {
    if (!window.confirm(`Supprimer le type de bilan "${item.name}" ?`)) {
      return;
    }

    try {
      await deleteBilanType.mutateAsync(item.id);
      toast.success("Type de bilan supprime");
      if (editingId === item.id) {
        resetForm();
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Erreur lors de la suppression");
    }
  }

  const isSubmitting = createBilanType.isPending || updateBilanType.isPending;

  return (
    <div className="space-y-8 max-w-7xl mx-auto">
      <div className="mb-6 flex max-w-full flex-col items-start gap-2 overflow-x-auto md:gap-3">
        <div>
          <h1 className="font-bold bg-gradient-to-r from-violet-600 to-indigo-600 bg-clip-text text-transparent whitespace-nowrap text-2xl leading-tight md:text-3xl">
            Types de Bilan
          </h1>
          <p className="text-muted-foreground whitespace-nowrap text-sm md:text-base">
            Centralisez les libelles de bilan utilises dans votre etablissement.
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Badge variant="secondary" className="bg-indigo-100 text-indigo-800 border-indigo-200">
            <CheckCircle2 className="h-3 w-3 mr-1" />
            Referentiel global
          </Badge>
          <Badge variant="secondary" className="bg-violet-100 text-violet-800 border-violet-200">
            <Sparkles className="h-3 w-3 mr-1" />
            Multi usage
          </Badge>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="bg-gradient-to-br from-violet-500 to-indigo-600 p-6 rounded-xl text-white shadow-lg hover:shadow-xl transition-all duration-300 transform hover:scale-105">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-white/80 text-sm font-medium">Total types</p>
              <p className="text-3xl font-bold mt-1">{stats.total}</p>
            </div>
            <div className="bg-white/20 p-3 rounded-lg">
              <ClipboardList className="h-6 w-6" />
            </div>
          </div>
        </div>

        <div className="bg-gradient-to-br from-indigo-500 to-purple-600 p-6 rounded-xl text-white shadow-lg hover:shadow-xl transition-all duration-300 transform hover:scale-105">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-white/80 text-sm font-medium">Types enregistres</p>
              <p className="text-3xl font-bold mt-1">{stats.filtered}</p>
            </div>
            <div className="bg-white/20 p-3 rounded-lg">
              <ClipboardList className="h-6 w-6" />
            </div>
          </div>
        </div>

        <div className="bg-gradient-to-br from-purple-500 to-pink-600 p-6 rounded-xl text-white shadow-lg hover:shadow-xl transition-all duration-300 transform hover:scale-105">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-white/80 text-sm font-medium">Ajouts recents</p>
              <p className="text-3xl font-bold mt-1">{stats.recent}</p>
            </div>
            <div className="bg-white/20 p-3 rounded-lg">
              <Sparkles className="h-6 w-6" />
            </div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-[420px,1fr] gap-6">
        <Card className="shadow-lg border-0 bg-gradient-to-br from-gray-50 to-white">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-slate-900">
              {editingId ? <Edit className="h-5 w-5 text-violet-600" /> : <Plus className="h-5 w-5 text-violet-600" />}
              {editingId ? "Modifier un type" : "Nouveau type de bilan"}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <form className="space-y-4" onSubmit={handleSubmit}>
              <div className="space-y-2">
                <label className="text-sm font-medium text-slate-700">Libelle</label>
                <Input
                  value={form.name}
                  onChange={(e) => setForm((prev) => ({ ...prev, name: e.target.value }))}
                  placeholder="Ex: Bilan semestriel"
                  className="h-11 border-gray-200 focus:border-violet-500 focus:ring-violet-500"
                />
              </div>

              <div className="flex gap-3">
                <Button
                  type="submit"
                  disabled={isSubmitting}
                  className="flex-1 bg-gradient-to-r from-violet-500 to-indigo-600 hover:from-violet-600 hover:to-indigo-700 text-white shadow-lg hover:shadow-xl transition-all duration-300"
                >
                  {isSubmitting ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      Enregistrement...
                    </>
                  ) : editingId ? (
                    "Mettre a jour"
                  ) : (
                    <>
                      <Plus className="h-4 w-4 mr-2" />
                      Ajouter
                    </>
                  )}
                </Button>

                {editingId && (
                  <Button type="button" variant="outline" onClick={resetForm}>
                    Annuler
                  </Button>
                )}
              </div>
            </form>
          </CardContent>
        </Card>

        <Card className="shadow-lg border-0 bg-gradient-to-br from-gray-50 to-white">
          <CardContent className="p-6 space-y-6">
            <div className="flex justify-end">
              <div className="text-sm text-gray-600 whitespace-nowrap">
                <span className="font-medium">{bilanTypes.length}</span>
                <span className="ml-1">{bilanTypes.length === 1 ? "type trouve" : "types trouves"}</span>
              </div>
            </div>

            {isLoading ? (
              <div className="flex items-center justify-center py-16 text-gray-500">
                <Loader2 className="h-5 w-5 mr-2 animate-spin" />
                Chargement des types de bilan...
              </div>
            ) : bilanTypes.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 text-center space-y-4">
                <div className="bg-gradient-to-br from-violet-100 to-indigo-100 rounded-full w-20 h-20 flex items-center justify-center">
                  <ClipboardList className="h-10 w-10 text-violet-600" />
                </div>
                <div>
                  <h3 className="text-xl font-semibold text-gray-900">Aucun type de bilan</h3>
                  <p className="text-gray-600 mt-2">
                    Creez votre premier type pour commencer a structurer vos bilans.
                  </p>
                </div>
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-4">
                {bilanTypes.map((item) => (
                  <div
                    key={item.id}
                    className="bg-gradient-to-br from-violet-500 via-indigo-500 to-purple-500 p-6 rounded-xl shadow-lg hover:shadow-xl transition-all duration-300 text-white relative overflow-hidden group"
                  >
                    <div className="relative z-10">
                      <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-4">
                        <div className="flex-1">
                          <div className="mb-4">
                            <h3 className="font-semibold text-lg">{item.name}</h3>
                          </div>
                        </div>

                        <div className="flex gap-2 self-start">
                          <Button
                            variant="secondary"
                            size="sm"
                            className="bg-white/20 hover:bg-white/30 text-white border-white/20 hover:border-white/30 transition-all duration-200 p-2"
                            onClick={() => startEdit(item)}
                            title="Modifier"
                          >
                            <Edit className="w-4 h-4" />
                          </Button>
                          <Button
                            variant="secondary"
                            size="sm"
                            className="bg-red-500/20 hover:bg-red-500/40 text-white border-red-300/20 hover:border-red-300/40 transition-all duration-200 p-2"
                            onClick={() => handleDelete(item)}
                            disabled={deleteBilanType.isPending}
                            title="Supprimer"
                          >
                            {deleteBilanType.isPending ? (
                              <Loader2 className="w-4 h-4 animate-spin" />
                            ) : (
                              <Trash2 className="w-4 h-4" />
                            )}
                          </Button>
                        </div>
                      </div>
                    </div>

                    <div className="absolute top-0 right-0 w-32 h-32 bg-white/10 rounded-full -translate-y-16 translate-x-16 group-hover:scale-110 transition-transform duration-500" />
                    <div className="absolute bottom-0 left-0 w-24 h-24 bg-black/10 rounded-full translate-y-12 -translate-x-12 group-hover:scale-110 transition-transform duration-500" />
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
