"use client";

import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
  Input,
  Textarea,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@ecoledigitale/ui";
import {
  CreateTeacherPaymentConfig,
  UpdateTeacherPaymentConfig,
  TeacherPaymentConfig,
  PaymentConfigType,
} from "@ecoledigitale/contracts";
import { useAllTeachers } from "@/lib/hooks/use-teachers";
import DatePickerFr from "@/components/DatePickerFr";

const teacherPaymentConfigFormSchema = z.object({
  teacherId: z.string().uuid("Veuillez sélectionner un enseignant"),
  configType: z.enum(["salary", "hourly", "mixed"], {
    required_error: "Le type de configuration est requis",
  }),
  monthlySalary: z.number().positive("Le salaire mensuel doit être positif").optional(),
  annualSalary: z.number().positive("Le salaire annuel doit être positif").optional(),
  defaultHourlyRate: z.number().positive("Le taux horaire doit être positif").optional(),
  overtimeThreshold: z.number().int().positive("Le seuil doit être un nombre entier positif").default(40),
  overtimeMultiplier: z.number().positive("Le multiplicateur doit être positif").default(1.5),
  effectiveFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Format de date invalide (YYYY-MM-DD)"),
  effectiveTo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Format de date invalide (YYYY-MM-DD)").optional().or(z.literal("")),
  notes: z.string().optional(),
}).refine((data) => {
  // If configType is salary or mixed, monthlySalary or annualSalary must be provided
  if ((data.configType === "salary" || data.configType === "mixed") && !data.monthlySalary && !data.annualSalary) {
    return false;
  }
  return true;
}, {
  message: "Le salaire mensuel ou annuel est requis pour ce type de configuration",
  path: ["monthlySalary"],
}).refine((data) => {
  // If configType is hourly or mixed, defaultHourlyRate must be provided
  if ((data.configType === "hourly" || data.configType === "mixed") && !data.defaultHourlyRate) {
    return false;
  }
  return true;
}, {
  message: "Le taux horaire est requis pour ce type de configuration",
  path: ["defaultHourlyRate"],
}).refine((data) => {
  // If effectiveTo is provided, it must be after effectiveFrom
  if (data.effectiveTo && data.effectiveTo !== "" && data.effectiveFrom) {
    return new Date(data.effectiveTo) > new Date(data.effectiveFrom);
  }
  return true;
}, {
  message: "La date de fin doit être après la date de début",
  path: ["effectiveTo"],
});

type TeacherPaymentConfigFormData = z.infer<typeof teacherPaymentConfigFormSchema>;

interface AntdTeacherPaymentConfigFormProps {
  config?: TeacherPaymentConfig;
  onSubmit: (data: CreateTeacherPaymentConfig | UpdateTeacherPaymentConfig) => Promise<void>;
  onCancel: () => void;
  isLoading?: boolean;
}

const configTypes: { value: PaymentConfigType; label: string }[] = [
  { value: "salary", label: "Salaire fixe" },
  { value: "hourly", label: "Taux horaire" },
  { value: "mixed", label: "Mixte (Salaire + Horaire)" },
];

export function AntdTeacherPaymentConfigForm({ 
  config, 
  onSubmit, 
  onCancel, 
  isLoading = false 
}: AntdTeacherPaymentConfigFormProps) {
  const { data: teachersData, isLoading: isLoadingTeachers } = useAllTeachers();
  const teachers = teachersData?.data || [];

  const form = useForm<TeacherPaymentConfigFormData>({
    resolver: zodResolver(teacherPaymentConfigFormSchema),
    defaultValues: {
      teacherId: config?.teacherId || "",
      configType: config?.configType || "salary",
      monthlySalary: config?.monthlySalary,
      annualSalary: config?.annualSalary,
      defaultHourlyRate: config?.defaultHourlyRate,
      overtimeThreshold: config?.overtimeThreshold || 40,
      overtimeMultiplier: config?.overtimeMultiplier || 1.5,
      effectiveFrom: config?.effectiveFrom 
        ? (typeof config.effectiveFrom === 'string' 
            ? config.effectiveFrom.substring(0, 10)
            : new Date(config.effectiveFrom).toISOString().split('T')[0])
        : new Date().toISOString().split('T')[0],
      effectiveTo: config?.effectiveTo 
        ? (typeof config.effectiveTo === 'string' 
            ? config.effectiveTo.substring(0, 10)
            : new Date(config.effectiveTo).toISOString().split('T')[0])
        : "",
      notes: config?.notes || "",
    },
  });

  const configType = form.watch("configType");

  const handleSubmit = async (data: TeacherPaymentConfigFormData) => {
    try {
      const dataToSubmit = {
        ...data,
        effectiveTo: data.effectiveTo && data.effectiveTo !== "" ? data.effectiveTo : undefined,
      };
      await onSubmit(dataToSubmit);
    } catch (error) {
      console.error("Error submitting form:", error);
      alert("Erreur lors de l'enregistrement. Vérifiez que tous les champs sont correctement remplis.");
    }
  };

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(handleSubmit)} className="space-y-4">
        <FormField
          control={form.control}
          name="teacherId"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Enseignant *</FormLabel>
              <Select 
                onValueChange={field.onChange} 
                defaultValue={field.value}
                disabled={isLoadingTeachers}
              >
                <FormControl>
                  <SelectTrigger>
                    <SelectValue placeholder="Sélectionnez un enseignant" />
                  </SelectTrigger>
                </FormControl>
                <SelectContent>
                  {teachers.map((teacher) => (
                    <SelectItem key={teacher.id} value={teacher.id}>
                      {teacher.firstName} {teacher.lastName} ({teacher.email})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="configType"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Type de configuration *</FormLabel>
              <Select onValueChange={field.onChange} defaultValue={field.value}>
                <FormControl>
                  <SelectTrigger>
                    <SelectValue placeholder="Sélectionnez un type" />
                  </SelectTrigger>
                </FormControl>
                <SelectContent>
                  {configTypes.map((type) => (
                    <SelectItem key={type.value} value={type.value}>
                      {type.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <FormMessage />
            </FormItem>
          )}
        />

        {(configType === "salary" || configType === "mixed") && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <FormField
              control={form.control}
              name="monthlySalary"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Salaire mensuel {configType === "salary" ? "*" : ""}</FormLabel>
                  <FormControl>
                    <Input
                      type="number"
                      step="1"
                      placeholder="250000"
                      {...field}
                      value={field.value || ""}
                      onChange={(e) => field.onChange(e.target.value ? parseFloat(e.target.value) : undefined)}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="annualSalary"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Salaire annuel (optionnel)</FormLabel>
                  <FormControl>
                    <Input
                      type="number"
                      step="1"
                      placeholder="3000000"
                      {...field}
                      value={field.value || ""}
                      onChange={(e) => field.onChange(e.target.value ? parseFloat(e.target.value) : undefined)}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>
        )}

        {(configType === "hourly" || configType === "mixed") && (
          <FormField
            control={form.control}
            name="defaultHourlyRate"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Taux horaire par défaut *</FormLabel>
                <FormControl>
                  <Input
                    type="number"
                    step="1"
                    placeholder="25000"
                    {...field}
                    value={field.value || ""}
                    onChange={(e) => field.onChange(e.target.value ? parseFloat(e.target.value) : undefined)}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <FormField
            control={form.control}
            name="overtimeThreshold"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Seuil heures supplémentaires</FormLabel>
                <FormControl>
                  <Input
                    type="number"
                    placeholder="40"
                    {...field}
                    value={field.value || 40}
                    onChange={(e) => field.onChange(parseInt(e.target.value) || 40)}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="overtimeMultiplier"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Multiplicateur heures sup.</FormLabel>
                <FormControl>
                  <Input
                    type="number"
                    step="0.1"
                    placeholder="1.5"
                    {...field}
                    value={field.value || 1.5}
                    onChange={(e) => field.onChange(parseFloat(e.target.value) || 1.5)}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <FormField
            control={form.control}
            name="effectiveFrom"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Date d'entrée en vigueur *</FormLabel>
                <FormControl>
                  <DatePickerFr
                    value={field.value}
                    onChange={(iso) => field.onChange(iso)}
                    placeholder="jj/mm/aaaa"
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="effectiveTo"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Date de fin (optionnel)</FormLabel>
                <FormControl>
                  <DatePickerFr
                    value={field.value || ""}
                    onChange={(iso) => field.onChange(iso || "")}
                    placeholder="jj/mm/aaaa"
                    min={form.watch("effectiveFrom")}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>

        <FormField
          control={form.control}
          name="notes"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Notes (optionnel)</FormLabel>
              <FormControl>
                <Textarea
                  placeholder="Notes sur cette configuration..."
                  className="min-h-[80px]"
                  {...field}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <div className="flex gap-3 pt-4">
          <button
            type="button"
            onClick={onCancel}
            className="flex-1 px-4 py-2 border border-gray-300 rounded-md text-gray-700 hover:bg-gray-50 transition-colors disabled:opacity-50"
            disabled={isLoading}
          >
            Annuler
          </button>
          <button
            type="submit"
            className="flex-1 px-4 py-2 bg-gradient-to-r from-blue-500 to-green-600 text-white rounded-md hover:from-blue-600 hover:to-green-700 transition-colors disabled:opacity-50"
            disabled={isLoading}
          >
            {isLoading ? "Enregistrement..." : "Enregistrer"}
          </button>
        </div>
      </form>
    </Form>
  );
}

