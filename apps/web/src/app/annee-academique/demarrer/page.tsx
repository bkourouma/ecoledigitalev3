"use client";

import { useState, useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Plus, Calendar, Users, BookOpen, CheckCircle, AlertCircle, Layers, Pencil, Trash2 } from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Button,
  Input,
  Label,
  Badge,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@ecoledigitale/ui";
import {
  useAcademicYears,
  useActiveAcademicYear,
  useCreateAcademicYear,
  useSetActiveAcademicYear,
  useUpdateAcademicYear,
  useDeleteAcademicYear,
} from "@/lib/hooks/use-academic-years";
import {
  useAcademicYearPeriods,
  useCreateAcademicYearPeriod,
  useUpdateAcademicYearPeriod,
  useDeleteAcademicYearPeriod,
  type AcademicYearPeriod,
} from "@/lib/hooks/use-academic-year-periods";
import DatePickerFr from "@/components/DatePickerFr";

const academicYearFormSchema = z.object({
  name: z.string().min(1, "Le nom est requis").max(255, "Le nom est trop long"),
});

type AcademicYearFormData = z.infer<typeof academicYearFormSchema>;

const periodFormSchema = z
  .object({
    name: z.string().min(1, "Le nom est requis").max(255, "Le nom est trop long"),
    startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Format de date invalide (YYYY-MM-DD)"),
    endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Format de date invalide (YYYY-MM-DD)"),
  })
  .refine((data) => new Date(data.endDate) > new Date(data.startDate), {
    message: "La date de fin doit être postérieure à la date de début",
    path: ["endDate"],
  });

type PeriodFormData = z.infer<typeof periodFormSchema>;

export default function DemarrerAnneeAcademiquePage() {
  const [showForm, setShowForm] = useState(false);

  const { data: academicYearsData, isLoading: isLoadingYears } = useAcademicYears({ includeStats: true });
  const { data: activeYearData } = useActiveAcademicYear();
  const createAcademicYear = useCreateAcademicYear();
  const setActiveAcademicYear = useSetActiveAcademicYear();
  const updateAcademicYear = useUpdateAcademicYear();
  const deleteAcademicYear = useDeleteAcademicYear();

  const [selectedYearIdForPeriods, setSelectedYearIdForPeriods] = useState<string>("");
  const [periodDialogOpen, setPeriodDialogOpen] = useState(false);
  const [editingPeriod, setEditingPeriod] = useState<AcademicYearPeriod | null>(null);
  const [periodForm, setPeriodForm] = useState<PeriodFormData>({
    name: "",
    startDate: "",
    endDate: "",
  });
  const [periodFormError, setPeriodFormError] = useState<string | null>(null);

  const { data: periodsData, isLoading: periodsLoading } = useAcademicYearPeriods(
    selectedYearIdForPeriods || undefined
  );
  const createPeriod = useCreateAcademicYearPeriod();
  const updatePeriod = useUpdateAcademicYearPeriod();
  const deletePeriod = useDeleteAcademicYearPeriod();

  // Edition / Suppression
  const [editOpen, setEditOpen] = useState(false);
  const [editForm, setEditForm] = useState<{ id: string; name: string; startDate: string; endDate: string }>({
    id: "",
    name: "",
    startDate: "",
    endDate: "",
  });

  const openEdit = (year: any) => {
    setEditForm({
      id: year.id,
      name: year.name,
      startDate: (year.startDate || "").slice(0, 10),
      endDate: (year.endDate || "").slice(0, 10),
    });
    setEditOpen(true);
  };

  const handleUpdate = async () => {
    try {
      await updateAcademicYear.mutateAsync({
        id: editForm.id,
        data: { name: editForm.name },
      });
      setEditOpen(false);
    } catch (error) {
      console.error("Error updating academic year:", error);
    }
  };

  const handleDelete = async (year: any) => {
    if (year.isActive) return;
    if (!confirm("Êtes-vous sûr de vouloir supprimer cette année académique ?")) return;
    try {
      await deleteAcademicYear.mutateAsync(year.id);
    } catch (error) {
      console.error("Error deleting academic year:", error);
    }
  };

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
    reset,
  } = useForm<AcademicYearFormData>({
    resolver: zodResolver(academicYearFormSchema),
    defaultValues: {}
  });

  const onSubmit = async (data: AcademicYearFormData) => {
    try {
      await createAcademicYear.mutateAsync({ name: data.name });
      setShowForm(false);
      reset();
    } catch (error) {
      console.error("Error creating academic year:", error);
    }
  };

  const handleSetActive = async (academicYearId: string) => {
    try {
      await setActiveAcademicYear.mutateAsync(academicYearId);
    } catch (error) {
      console.error("Error setting active academic year:", error);
    }
  };

  const academicYears = academicYearsData?.data || [];
  const activeYear = activeYearData?.data;

  useEffect(() => {
    if (academicYears.length === 0) {
      setSelectedYearIdForPeriods("");
      return;
    }
    const stillValid = selectedYearIdForPeriods && academicYears.some((y) => y.id === selectedYearIdForPeriods);
    if (!stillValid) {
      setSelectedYearIdForPeriods(activeYear?.id ?? academicYears[0].id);
    }
  }, [academicYears, activeYear, selectedYearIdForPeriods]);

  const openPeriodDialogCreate = () => {
    setEditingPeriod(null);
    setPeriodForm({ name: "", startDate: "", endDate: "" });
    setPeriodFormError(null);
    setPeriodDialogOpen(true);
  };

  const openPeriodDialogEdit = (p: AcademicYearPeriod) => {
    setEditingPeriod(p);
    setPeriodForm({
      name: p.name,
      startDate: (p.startDate || "").slice(0, 10),
      endDate: (p.endDate || "").slice(0, 10),
    });
    setPeriodFormError(null);
    setPeriodDialogOpen(true);
  };

  const submitPeriod = async () => {
    setPeriodFormError(null);
    const parsed = periodFormSchema.safeParse(periodForm);
    if (!parsed.success) {
      setPeriodFormError(parsed.error.errors[0]?.message ?? "Données invalides");
      return;
    }
    if (!selectedYearIdForPeriods) return;
    try {
      if (editingPeriod) {
        await updatePeriod.mutateAsync({
          academicYearId: selectedYearIdForPeriods,
          periodId: editingPeriod.id,
          data: parsed.data,
        });
      } else {
        await createPeriod.mutateAsync({
          academicYearId: selectedYearIdForPeriods,
          data: parsed.data,
        });
      }
      setPeriodDialogOpen(false);
    } catch (e: unknown) {
      setPeriodFormError(e instanceof Error ? e.message : "Une erreur est survenue");
    }
  };

  const handleDeletePeriod = async (p: AcademicYearPeriod) => {
    if (!selectedYearIdForPeriods) return;
    if (!confirm(`Supprimer la période « ${p.name} » ?`)) return;
    try {
      await deletePeriod.mutateAsync({ academicYearId: selectedYearIdForPeriods, periodId: p.id });
    } catch (e) {
      console.error(e);
    }
  };

  const periods = periodsData?.data ?? [];

  return (<>
    <div className="container mx-auto px-4 py-8">
      <div className="mb-8">
        <h1 className="font-bold text-foreground mb-2 whitespace-nowrap text-2xl leading-tight md:text-3xl">
          Démarrer Année Académique
        </h1>
        <p className="text-gray-600 whitespace-nowrap text-sm md:text-base">
          Gérez les années académiques et définissez l'année active pour votre institution.
        </p>
      </div>

      {/* Active Academic Year Card */}
      {activeYear ? (
        <Card className="mb-8 border-green-200 bg-green-50">
          <CardHeader>
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-2">
                <CheckCircle className="h-5 w-5 text-green-600" />
                <CardTitle className="text-green-800">Année Académique Active</CardTitle>
              </div>
              <Badge variant="default" className="bg-green-600">
                Active
              </Badge>
            </div>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-1 gap-4">
              <div>
                <p className="text-sm font-medium text-green-700">Nom</p>
                <p className="text-lg font-semibold text-green-900">{activeYear.name}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      ) : (
        <Card className="mb-8 border-orange-200 bg-orange-50">
          <CardHeader>
            <div className="flex items-center space-x-2">
              <AlertCircle className="h-5 w-5 text-orange-600" />
              <CardTitle className="text-orange-800">Aucune Année Académique Active</CardTitle>
            </div>
          </CardHeader>
          <CardContent>
            <p className="text-orange-700">
              Aucune année académique n'est actuellement active. Veuillez créer une nouvelle année académique ou activer une année existante.
            </p>
          </CardContent>
        </Card>
      )}

      {/* Create New Academic Year */}
      <Card className="mb-8">
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>Nouvelle Année Académique</CardTitle>
              <CardDescription>
                Créez une nouvelle année académique (les dates se définissent dans les semestres/trimestres)
              </CardDescription>
            </div>
            <Button
              onClick={() => setShowForm(!showForm)}
              className="flex items-center space-x-2"
            >
              <Plus className="h-4 w-4" />
              <span>Nouvelle Année</span>
            </Button>
          </div>
        </CardHeader>

        {showForm && (
          <CardContent>
            <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
              <div className="grid grid-cols-1 gap-4">
                <div>
                  <Label htmlFor="name">Nom de l'année académique</Label>
                  <Input
                    id="name"
                    placeholder="ex: 2024-2025"
                    {...register("name")}
                    className={errors.name ? "border-red-500" : ""}
                  />
                  {errors.name && (
                    <p className="text-sm text-red-600 mt-1">{errors.name.message}</p>
                  )}
                </div>
              </div>

              <div className="flex justify-end space-x-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    setShowForm(false);
                    reset();
                  }}
                >
                  Annuler
                </Button>
                <Button type="submit" disabled={isSubmitting}>
                  {isSubmitting ? "Création..." : "Créer"}
                </Button>
              </div>
            </form>
          </CardContent>
        )}
      </Card>

      {/* Semestres / Trimestres */}
      <Card className="mb-8">
        <CardHeader>
          <div className="mb-6 flex max-w-full flex-col items-start gap-2 overflow-x-auto md:gap-3">
            <div className="flex items-start gap-3">
              <Layers className="h-6 w-6 text-muted-foreground shrink-0 mt-0.5" />
              <div>
                <CardTitle>Semestre / Trimestre</CardTitle>
                <CardDescription>
                  Définissez les périodes (semestres ou trimestres) pour chaque année académique. Les dates doivent rester
                  dans l&apos;intervalle de l&apos;année sélectionnée.
                </CardDescription>
              </div>
            </div>
            <Button
              type="button"
              className="shrink-0"
              onClick={openPeriodDialogCreate}
              disabled={!selectedYearIdForPeriods}
            >
              <Plus className="h-4 w-4 mr-2" />
              Ajouter
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {academicYears.length === 0 ? (
            <p className="text-sm text-muted-foreground">Créez d&apos;abord une année académique pour ajouter des périodes.</p>
          ) : (
            <>
              <div className="max-w-md">
                <Label htmlFor="period-year">Année académique</Label>
                <Select value={selectedYearIdForPeriods} onValueChange={setSelectedYearIdForPeriods}>
                  <SelectTrigger id="period-year" className="mt-1.5">
                    <SelectValue placeholder="Choisir une année" />
                  </SelectTrigger>
                  <SelectContent>
                    {academicYears.map((y) => (
                      <SelectItem key={y.id} value={y.id}>
                        {y.name}
                        {y.isActive ? " (active)" : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {periodsLoading ? (
                <p className="text-sm text-muted-foreground py-4">Chargement des périodes…</p>
              ) : periods.length === 0 ? (
                <p className="text-sm text-muted-foreground py-2">
                  Aucune période pour cette année. Utilisez le bouton « Ajouter » pour en créer.
                </p>
              ) : (
                <ul className="divide-y rounded-lg border">
                  {periods.map((p) => (
                    <li key={p.id} className="flex flex-col gap-2 p-4 sm:flex-row sm:items-center sm:justify-between">
                      <div>
                        <p className="font-medium text-foreground">{p.name}</p>
                        <p className="text-sm text-muted-foreground">
                          Du {new Date(p.startDate).toLocaleDateString("fr-FR")} au{" "}
                          {new Date(p.endDate).toLocaleDateString("fr-FR")}
                        </p>
                      </div>
                      <div className="flex gap-2 shrink-0">
                        <Button type="button" variant="outline" size="sm" onClick={() => openPeriodDialogEdit(p)}>
                          <Pencil className="h-4 w-4 mr-1" />
                          Modifier
                        </Button>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="text-destructive hover:text-destructive"
                          onClick={() => handleDeletePeriod(p)}
                          disabled={deletePeriod.isPending}
                        >
                          <Trash2 className="h-4 w-4 mr-1" />
                          Supprimer
                        </Button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
        </CardContent>
      </Card>

      <Dialog open={periodDialogOpen} onOpenChange={setPeriodDialogOpen}>
        <DialogContent
          className="top-6 translate-y-0"
          onInteractOutside={(event) => {
            const target = event.target as HTMLElement | null;
            if (target?.closest('[data-datepicker-popover="true"]')) {
              event.preventDefault();
            }
          }}
        >
          <DialogHeader>
            <DialogTitle>{editingPeriod ? "Modifier la période" : "Nouvelle période"}</DialogTitle>
            <DialogDescription>
              Exemple : 1er Semestre, Trimestre 1… Indiquez les dates de début et de fin.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label htmlFor="period-name">Nom</Label>
              <Input
                id="period-name"
                placeholder="ex : 1er Semestre"
                value={periodForm.name}
                onChange={(e) => setPeriodForm({ ...periodForm, name: e.target.value })}
                className="mt-1.5"
              />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <Label htmlFor="period-start">Date de début</Label>
                <DatePickerFr
                  id="period-start"
                  value={periodForm.startDate}
                  onChange={(iso) => setPeriodForm({ ...periodForm, startDate: iso })}
                  usePortal={false}
                  className="mt-1.5"
                />
              </div>
              <div>
                <Label htmlFor="period-end">Date de fin</Label>
                <DatePickerFr
                  id="period-end"
                  value={periodForm.endDate}
                  onChange={(iso) => setPeriodForm({ ...periodForm, endDate: iso })}
                  usePortal={false}
                  className="mt-1.5"
                />
              </div>
            </div>
            {periodFormError && <p className="text-sm text-destructive">{periodFormError}</p>}
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => setPeriodDialogOpen(false)}>
                Annuler
              </Button>
              <Button
                type="button"
                onClick={submitPeriod}
                disabled={createPeriod.isPending || updatePeriod.isPending}
              >
                {editingPeriod ? "Enregistrer" : "Créer"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Existing Academic Years */}
      <Card>
        <CardHeader>
          <CardTitle>Années Académiques Existantes</CardTitle>
          <CardDescription>
            Liste de toutes les années académiques créées
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isLoadingYears ? (
            <div className="text-center py-8">
              <p className="text-gray-500">Chargement...</p>
            </div>
          ) : academicYears.length === 0 ? (
            <div className="text-center py-8">
              <Calendar className="h-12 w-12 text-gray-400 mx-auto mb-4" />
              <p className="text-gray-500">Aucune année académique trouvée</p>
              <p className="text-sm text-gray-400">Créez votre première année académique pour commencer</p>
            </div>
          ) : (
            <div className="space-y-4">
              {academicYears.map((year) => (
                <div
                  key={year.id}
                  className={`p-4 border rounded-lg ${
                    year.isActive ? 'border-green-200 bg-green-50' : 'border-border bg-card'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex-1">
                      <div className="flex items-center space-x-3">


                        <h3 className={`font-semibold ${year.isActive ? 'text-gray-900 dark:text-gray-100' : 'text-foreground'}`}>
                          {year.name}
                        </h3>
                        {year.isActive && (
                          <Badge variant="default" className="bg-green-600">
                            Active
                          </Badge>
                        )}
                      </div>
                      <div className="mt-2 grid grid-cols-1 md:grid-cols-2 gap-4 text-sm text-muted-foreground">
                        <div className="flex items-center space-x-1">
                          <BookOpen className="h-4 w-4" />
                          <span>{year.classCount || 0} classes</span>
                        </div>
                        <div className="flex items-center space-x-1">
                          <Users className="h-4 w-4" />
                          <span>{year.studentCount || 0} étudiants</span>
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      {!year.isActive && (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleSetActive(year.id)}
                          disabled={setActiveAcademicYear.isPending}
                        >
                          Activer
                        </Button>
                      )}
                      <Button variant="outline" size="sm" onClick={() => openEdit(year)}>Modifier</Button>
                      <Button
                        variant="destructive"
                        size="sm"
                        onClick={() => handleDelete(year)}
                        disabled={year.isActive || deleteAcademicYear.isPending}
                        title={year.isActive ? "Impossible de supprimer l'année active" : undefined}
                      >
                        Supprimer
                      </Button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>

	      {/* Dialog d'édition */}
	      <Dialog
	        open={editOpen}
	        onOpenChange={(v) => {
	          if (!v) {
	            setEditOpen(false)
	            // évite le warning Chrome sur aria-hidden avec focus retenu
	            setTimeout(() => {
	              const el = document.activeElement as HTMLElement | null
	              el?.blur?.()
	            }, 0)
	          } else {
	            setEditOpen(true)
	          }
	        }}
	      >
	        <DialogContent>
	          <DialogHeader>
	            <DialogTitle>Modifier l'année académique</DialogTitle>
	            <DialogDescription>Mettre à jour le nom.</DialogDescription>
	          </DialogHeader>
	          <div className="space-y-4">
	            <div>
	              <Label htmlFor="edit-name">Nom</Label>
	              <Input id="edit-name" value={editForm.name} onChange={(e) => setEditForm({ ...editForm, name: e.target.value })} />
	            </div>
	            <div className="flex justify-end gap-2">
	              <Button variant="outline" onClick={() => setEditOpen(false)}>Annuler</Button>
	              <Button onClick={handleUpdate} disabled={updateAcademicYear.isPending}>Mettre à jour</Button>
	            </div>
	          </div>
	        </DialogContent>
	      </Dialog>
    </>
  );
}
