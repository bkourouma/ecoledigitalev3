"use client";

import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Button,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Alert,
  AlertDescription,
} from "@ecoledigitale/ui";
import DatePickerFr from "@/components/DatePickerFr";
import {
  Plus,
  Trash2,
  Calendar,
  Percent,
  AlertTriangle,
  CheckCircle2,
  Save,
  X,
  Loader2,
} from "lucide-react";
import { useAcademicYears } from "@/lib/hooks/use-academic-years";
import { useCycles } from "@/lib/hooks/use-cycles";
import { useProgrammes } from "@/lib/hooks/use-programmes";
import { useCreateTuitionSchedule, useUpdateTuitionSchedule, CreateTuitionScheduleData, generateInstallments } from "@/lib/hooks/use-tuition-schedules";

interface Installment {
  percentage: number;
  dueDate: string;
  label: string;
}

interface CreateScheduleFormProps {
  initialData?: any;
  onSuccess: () => void;
  onCancel: () => void;
  onEditExisting?: (scheduleId: string) => void;
}

export function CreateScheduleForm({ initialData, onSuccess, onCancel, onEditExisting }: CreateScheduleFormProps) {
  const [scheduleName, setScheduleName] = useState("");
  const [academicYearId, setAcademicYearId] = useState("");
  const [cycleId, setCycleId] = useState("");
  const [programmeId, setProgrammeId] = useState("");
  const [installments, setInstallments] = useState<Installment[]>([
    { percentage: 40, dueDate: "", label: "1er Trimestre" },
    { percentage: 30, dueDate: "", label: "2eme Trimestre" },
    { percentage: 30, dueDate: "", label: "3eme Trimestre" },
  ]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);

  const { data: academicYearsResponse, isLoading: loadingAcademicYears } = useAcademicYears();
  const academicYears = academicYearsResponse?.data ?? [];

  const { data: cyclesResponse, isLoading: loadingCycles } = useCycles();
  const cycles = cyclesResponse?.data ?? [];

  const { data: programmesResponse, isLoading: loadingProgrammes } = useProgrammes({
    cycleId: cycleId && cycleId !== "all" ? cycleId : undefined,
    limit: 100,
  });
  const programmes = programmesResponse?.data ?? [];

  const { createSchedule, loading: creating } = useCreateTuitionSchedule();
  const { updateSchedule } = useUpdateTuitionSchedule();

  const cycleOptions = [
    { id: null, name: "Tous les cycles" },
    ...cycles.map((cycle: any) => ({ id: cycle.id, name: cycle.name })),
  ];

  useEffect(() => {
    if (initialData) {
      setScheduleName(initialData.scheduleName);
      setAcademicYearId(initialData.academicYearId || "");
      setCycleId(initialData.cycleId || "");
      setProgrammeId((initialData as any).programmeId || "");
      setInstallments(initialData.installments || []);
    } else if (academicYears.length > 0 && !academicYearId) {
      const active = academicYears.find((y: any) => y.isActive) || academicYears[0];
      setAcademicYearId(active.id);
    }
  }, [initialData, academicYears]);

  useEffect(() => {
    setProgrammeId("");
  }, [cycleId]);

  const addInstallment = () => {
    setInstallments([
      ...installments,
      { percentage: 0, dueDate: "", label: `${installments.length + 1}eme Echeance` },
    ]);
  };

  const removeInstallment = (index: number) => {
    if (installments.length > 1) {
      setInstallments(installments.filter((_, i) => i !== index));
    }
  };

  const updateInstallment = (index: number, field: keyof Installment, value: string | number) => {
    const updated = [...installments];
    updated[index] = { ...updated[index], [field]: value };
    setInstallments(updated);
  };

  const validateForm = (): string[] => {
    const formErrors: string[] = [];

    if (!scheduleName.trim()) {
      formErrors.push("Le nom de l'echeancier est requis");
    }

    if (!academicYearId) {
      formErrors.push("L'annee academique est requise");
    }

    if (cycleId && cycleId !== "all" && !programmeId) {
      formErrors.push("La filiere est requise quand un cycle est selectionne");
    }

    if (installments.length === 0) {
      formErrors.push("Au moins une echeance est requise");
    }

    const totalPercentage = installments.reduce((sum, inst) => sum + inst.percentage, 0);
    if (Math.abs(totalPercentage - 100) > 0.01) {
      formErrors.push("Le total des pourcentages doit etre egal a 100%");
    }

    installments.forEach((inst, index) => {
      if (!inst.label.trim()) {
        formErrors.push(`Le libelle de l'echeance ${index + 1} est requis`);
      }
      if (!inst.dueDate) {
        formErrors.push(`La date d'echeance ${index + 1} est requise`);
      }
      if (inst.percentage <= 0) {
        formErrors.push(`Le pourcentage de l'echeance ${index + 1} doit etre superieur a 0`);
      }
    });

    const dates = installments.map(inst => inst.dueDate).filter(Boolean);
    const uniqueDates = new Set(dates);
    if (dates.length !== uniqueDates.size) {
      formErrors.push("Les dates d'echeance doivent etre uniques");
    }

    const sortedDates = [...dates].sort();
    if (JSON.stringify(dates) !== JSON.stringify(sortedDates)) {
      formErrors.push("Les echeances doivent etre dans l'ordre chronologique");
    }

    return formErrors;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    const validationErrors = validateForm();
    if (validationErrors.length > 0) {
      setErrors(validationErrors);
      return;
    }

    setIsSubmitting(true);
    setErrors([]);

    try {
      if (initialData?.id) {
        await updateSchedule(initialData.id, {
          scheduleName,
          installments: installments.map(i => ({
            label: i.label,
            dueDate: i.dueDate.slice(0, 10),
            percentage: Number(i.percentage) || 0,
          })),
        });
      } else {
        const scheduleData: CreateTuitionScheduleData = {
          academicYearId,
          cycleId: cycleId === "all" ? null : (cycleId || null),
          programmeId: cycleId === "all" ? null : (programmeId || null),
          scheduleName,
          installments: installments.map(i => ({
            label: i.label,
            dueDate: i.dueDate.slice(0, 10),
            percentage: Number(i.percentage) || 0,
          })),
        };

        const created = await createSchedule(scheduleData);

        try {
          await generateInstallments({ scheduleId: created.id, overwriteExisting: false });
        } catch (genError: any) {
          const errorMessage = genError?.message || genError?.error || "Erreur inconnue lors de la generation des echeances";
          setErrors([
            `L'echeancier a ete cree mais la generation automatique des echeances a echoue: ${errorMessage}. Vous pourrez generer les echeances manuellement depuis la liste des echeanciers.`,
          ]);
          onSuccess();
          return;
        }
      }

      onSuccess();
    } catch (error: any) {
      let errorMessage = error instanceof Error ? error.message : "Erreur lors de la sauvegarde. Veuillez reessayer.";

      if (errorMessage.includes("already exists") || errorMessage.includes("Duplicate Schedule")) {
        const existingScheduleId = error?.existingScheduleId;

        if (existingScheduleId) {
          errorMessage = `Un echeancier avec le nom "${scheduleName}" existe deja pour cette annee academique et ce cycle.\n\n` +
            `Souhaitez-vous modifier l'echeancier existant ?\n\n` +
            `Si vous souhaitez creer un nouvel echeancier, veuillez utiliser un nom different.`;
          setErrors([errorMessage, `ID_EXISTING_SCHEDULE:${existingScheduleId}`]);
        } else {
          errorMessage = `Un echeancier avec le nom "${scheduleName}" existe deja pour cette annee academique et ce cycle.\n\n` +
            `Veuillez utiliser un nom different ou modifier l'echeancier existant.`;
          setErrors([errorMessage]);
        }
      } else {
        setErrors([errorMessage]);
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  const totalPercentage = installments.reduce((sum, inst) => sum + (Number(inst.percentage) || 0), 0);
  const isPercentageValid = Math.abs(totalPercentage - 100) < 0.01;

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Informations Generales</CardTitle>
          <CardDescription>
            Definissez les parametres de base de l'echeancier
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="scheduleName">Nom de l'Echeancier *</Label>
              <Input
                id="scheduleName"
                value={scheduleName}
                onChange={(e) => setScheduleName(e.target.value)}
                placeholder="Ex: Echeancier Standard 2024-2025"
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="academicYear">Annee Academique *</Label>
              <Select value={academicYearId} onValueChange={setAcademicYearId} disabled={loadingAcademicYears}>
                <SelectTrigger>
                  <SelectValue placeholder={loadingAcademicYears ? "Chargement..." : "Selectionner l'annee"} />
                </SelectTrigger>
                <SelectContent>
                  {(academicYears || []).map((year) => (
                    <SelectItem key={year.id} value={year.id}>
                      {year.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="cycle">Cycle (optionnel)</Label>
            <Select value={cycleId} onValueChange={setCycleId} disabled={loadingCycles}>
              <SelectTrigger>
                <SelectValue placeholder={loadingCycles ? "Chargement..." : "Selectionner le cycle"} />
              </SelectTrigger>
              <SelectContent>
                {cycleOptions.map((cycle) => (
                  <SelectItem key={cycle.id || "all"} value={cycle.id || "all"}>
                    {cycle.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-sm text-gray-600">
              Laissez vide pour appliquer a tous les cycles
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="programme">Filiere {cycleId && cycleId !== "all" ? "*" : "(optionnel)"}</Label>
            <Select
              value={!cycleId || cycleId === "all" ? (programmeId || "all") : programmeId}
              onValueChange={(value) => setProgrammeId(value === "all" ? "" : value)}
              disabled={loadingProgrammes || !cycleId || cycleId === "all"}
            >
              <SelectTrigger>
                <SelectValue
                  placeholder={
                    !cycleId || cycleId === "all"
                      ? "Selectionnez d'abord un cycle"
                      : loadingProgrammes
                        ? "Chargement..."
                        : "Selectionner la filiere"
                  }
                />
              </SelectTrigger>
              <SelectContent>
                {(!cycleId || cycleId === "all") ? <SelectItem value="all">Toutes les filieres</SelectItem> : null}
                {(programmes || []).map((programme: any) => (
                  <SelectItem key={programme.id} value={programme.id}>
                    {programme.name} ({programme.code})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-sm text-gray-600">
              La liste des filieres est filtree selon le cycle choisi.
            </p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>Echeances de Paiement</CardTitle>
              <CardDescription>
                Definissez les pourcentages et dates d'echeance
              </CardDescription>
            </div>
            <Button type="button" variant="outline" onClick={addInstallment}>
              <Plus className="h-4 w-4 mr-2" />
              Ajouter
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {installments.map((installment, index) => (
            <motion.div
              key={index}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: index * 0.1, duration: 0.3 }}
              className="border rounded-lg p-4 space-y-4"
            >
              <div className="flex items-center justify-between">
                <h4 className="font-medium">Echeance {index + 1}</h4>
                {installments.length > 1 && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => removeInstallment(index)}
                    className="text-red-600 hover:text-red-700"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                )}
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="space-y-2">
                  <Label>Libelle *</Label>
                  <Input
                    value={installment.label}
                    onChange={(e) => updateInstallment(index, "label", e.target.value)}
                    placeholder="Ex: 1er Trimestre"
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label>Pourcentage *</Label>
                  <div className="relative">
                    <Input
                      type="number"
                      value={installment.percentage}
                      onChange={(e) => updateInstallment(index, "percentage", parseFloat(e.target.value) || 0)}
                      placeholder="0"
                      min="0"
                      max="100"
                      step="0.01"
                      required
                    />
                    <Percent className="absolute right-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label>Date d'Echeance *</Label>
                  <div className="relative">
                    <DatePickerFr
                      value={installment.dueDate}
                      onChange={(iso) => updateInstallment(index, "dueDate", iso)}
                    />
                    <Calendar className="absolute right-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400 pointer-events-none" />
                  </div>
                </div>
              </div>
            </motion.div>
          ))}

          <div className="bg-gray-50 p-4 rounded-lg">
            <div className="flex items-center justify-between">
              <span className="font-medium">Total des Pourcentages:</span>
              <div className="flex items-center gap-2">
                <span className={`font-bold text-lg ${
                  isPercentageValid ? "text-green-600" : "text-red-600"
                }`}>
                  {totalPercentage.toFixed(2)}%
                </span>
                {isPercentageValid ? (
                  <CheckCircle2 className="h-5 w-5 text-green-600" />
                ) : (
                  <AlertTriangle className="h-5 w-5 text-red-600" />
                )}
              </div>
            </div>
            {!isPercentageValid && (
              <p className="text-sm text-red-600 mt-2">
                Le total doit etre egal a 100%
              </p>
            )}
          </div>
        </CardContent>
      </Card>

      {errors.length > 0 && (
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertDescription className="whitespace-pre-line">
            <ul className="list-disc list-inside space-y-1">
              {errors
                .filter(error => !error.startsWith("ID_EXISTING_SCHEDULE:"))
                .map((error, index) => (
                <li key={index}>{error}</li>
              ))}
            </ul>
            {errors.some(error => error.startsWith("ID_EXISTING_SCHEDULE:")) && (
              <div className="mt-4 pt-4 border-t border-red-200">
                <p className="text-sm font-medium mb-2">Actions possibles :</p>
                <div className="flex gap-2 flex-wrap">
                  {onEditExisting && (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={async () => {
                        const existingScheduleId = errors.find(e => e.startsWith("ID_EXISTING_SCHEDULE:"))?.split(":")[1];
                        if (existingScheduleId) {
                          onEditExisting(existingScheduleId);
                          setErrors([]);
                        }
                      }}
                    >
                      Modifier l&apos;echeancier existant
                    </Button>
                  )}
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setScheduleName(`${scheduleName} (Copie)`);
                      setErrors([]);
                    }}
                  >
                    Utiliser un nom different
                  </Button>
                </div>
              </div>
            )}
          </AlertDescription>
        </Alert>
      )}

      <div className="flex gap-3 pt-4">
        <Button
          type="button"
          variant="outline"
          onClick={onCancel}
          disabled={isSubmitting}
          className="flex-1"
        >
          <X className="h-4 w-4 mr-2" />
          Annuler
        </Button>
        <Button
          type="submit"
          disabled={isSubmitting || creating || !isPercentageValid || loadingAcademicYears || loadingCycles || loadingProgrammes}
          className="flex-1"
        >
          {(isSubmitting || creating) ? (
            <>
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              Sauvegarde...
            </>
          ) : (
            <>
              <Save className="h-4 w-4 mr-2" />
              {initialData ? "Modifier" : "Creer"} l'Echeancier
            </>
          )}
        </Button>
      </div>
    </form>
  );
}
