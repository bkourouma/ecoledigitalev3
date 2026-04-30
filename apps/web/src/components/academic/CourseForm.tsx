"use client";

import { useState, useEffect, useCallback } from "react";
import { useFieldArray, useForm } from "react-hook-form";
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@ecoledigitale/ui";
import { Loader2, Plus, Trash2 } from "lucide-react";
import { Course } from "@/lib/hooks/use-courses";
import { useProgrammes } from "@/lib/hooks/use-programmes";
import { useBilanTypes } from "@/lib/hooks/use-bilan-types";

/** Accepte point ou virgule comme séparateur décimal (ex. 2,5 ou 2.5). */
function parseCoefInput(raw: string): number | undefined {
  const normalized = raw.trim().replace(",", ".");
  if (normalized === "" || normalized === "." || normalized === "-") return undefined;
  const n = Number.parseFloat(normalized);
  return Number.isFinite(n) ? n : undefined;
}

function formatCoefDisplay(n: number | undefined | null): string {
  if (n === undefined || n === null || Number.isNaN(n)) return "";
  return String(n).replace(".", ",");
}

/** Saisie partielle autorisée : ex. "1," ou "1." reste affiché jusqu'au blur ou nombre complet. */
const COEF_PARTIAL = /^\d*[.,]?\d*$/;

function CoefDecimalInput({
  value,
  onChange,
  onBlur,
  disabled,
  placeholder,
}: {
  value: number | undefined;
  onChange: (v: number | undefined) => void;
  onBlur?: () => void;
  disabled?: boolean;
  placeholder?: string;
}) {
  const [focused, setFocused] = useState(false);
  const [draft, setDraft] = useState(() => formatCoefDisplay(value));

  useEffect(() => {
    if (!focused) {
      setDraft(formatCoefDisplay(value));
    }
  }, [value, focused]);

  const handleChange = useCallback(
    (raw: string) => {
      if (raw === "") {
        setDraft("");
        onChange(undefined);
        return;
      }
      if (!COEF_PARTIAL.test(raw)) return;

      setDraft(raw);
      const norm = raw.replace(",", ".");
      if (norm === "." || norm.endsWith(".")) return;
      if (raw.endsWith(",")) return;

      const n = Number.parseFloat(norm);
      if (Number.isFinite(n)) {
        onChange(n);
      }
    },
    [onChange]
  );

  return (
    <Input
      type="text"
      inputMode="decimal"
      autoComplete="off"
      placeholder={placeholder}
      disabled={disabled}
      value={focused ? draft : formatCoefDisplay(value)}
      onFocus={() => {
        setFocused(true);
        setDraft(formatCoefDisplay(value));
      }}
      onChange={(e) => handleChange(e.target.value)}
      onBlur={() => {
        setFocused(false);
        const n = parseCoefInput(draft);
        onChange(n);
        setDraft(formatCoefDisplay(n));
        onBlur?.();
      }}
    />
  );
}

const courseFormSchema = z.object({
  name: z.string().max(255, "Le nom est trop long").optional(),
  programmeId: z.string().min(1, "Le programme est requis"),
  bilanTypeId: z.string().min(1, "Le type de bilan est requis").refine(
    (value) => value !== "no-bilan-type",
    "Veuillez sélectionner un type de bilan valide"
  ),
  cm: z.string().optional(),
  td: z.string().optional(),
  tp: z.string().optional(),
  coef: z.number({ required_error: "Le coefficient est requis" })
    .finite("Coefficient invalide")
    .gt(0, "Le coefficient doit être supérieur à 0"),
  vhh: z.string().optional(),
  bulkItems: z.array(z.object({
    name: z.string().optional(),
    cm: z.string().optional(),
    td: z.string().optional(),
    tp: z.string().optional(),
    coef: z.number({ required_error: "Le coefficient est requis" })
      .finite("Coefficient invalide")
      .gt(0, "Le coefficient doit être supérieur à 0"),
    vhh: z.string().optional(),
  })).optional(),
  status: z.enum(["draft", "active", "inactive"], {
    required_error: "Le statut est requis",
  }).default("active"),
});

type CourseFormData = z.infer<typeof courseFormSchema>;

interface CourseFormProps {
  course?: Course;
  onSubmit: (data: CourseFormData & {
    bulkCourses?: Array<{
      name: string;
      cm?: string;
      td?: string;
      tp?: string;
      coef?: number;
      vhh?: string;
    }>;
  }) => Promise<void>;
  onCancel: () => void;
  isLoading?: boolean;
  allowBulkCreation?: boolean;
}

export function CourseForm({
  course,
  onSubmit,
  onCancel,
  isLoading = false,
  allowBulkCreation = false,
}: CourseFormProps) {
  const { data: programmesData } = useProgrammes();
  const { data: bilanTypesData } = useBilanTypes({ limit: 100 });
  const programmes = programmesData?.data || [];
  const bilanTypes = bilanTypesData?.data || [];

  const form = useForm<CourseFormData>({
    resolver: zodResolver(courseFormSchema),
    defaultValues: {
      name: course?.name || "",
      programmeId: course?.programmeId || "",
      bilanTypeId: course?.bilanTypeId || "",
      cm: course?.cm || "",
      td: course?.td || "",
      tp: course?.tp || "",
      coef: course?.coef ?? 1,
      vhh: course?.vhh || "",
      bulkItems: allowBulkCreation && !course ? [{ name: "", cm: "", td: "", tp: "", coef: 1, vhh: "" }] : [],
      status: (course?.status || "active") as "draft" | "active" | "inactive",
    },
  });

  const { fields, append, remove } = useFieldArray({
    control: form.control,
    name: "bulkItems",
  });

  const handleSubmit = async (data: CourseFormData) => {
    try {
      if (allowBulkCreation && !course) {
        const rawItems = data.bulkItems || [];
        const normalized = rawItems
          .map((item) => ({
            name: item.name?.trim() || "",
            cm: item.cm?.trim() || undefined,
            td: item.td?.trim() || undefined,
            tp: item.tp?.trim() || undefined,
            coef: item.coef,
            vhh: item.vhh?.trim() || undefined,
          }))
          .filter((item) => item.name.length > 0);

        if (normalized.length === 0) {
          form.setError("bulkItems.0.name" as never, { message: "Ajoutez au moins une matière" });
          return;
        }

        const deduped = normalized.filter(
          (item, index, arr) =>
            arr.findIndex((candidate) => candidate.name.toLowerCase() === item.name.toLowerCase()) === index
        );

        await onSubmit({
          ...data,
          name: deduped[0].name,
          bulkCourses: deduped,
          status: "active",
        });
        return;
      }

      const courseName = data.name?.trim();
      if (!courseName) {
        form.setError("name", { message: "Le nom est requis" });
        return;
      }

      const { bulkItems: _bulkItems, ...restData } = data;
      const dataToSubmit = course
        ? { ...restData, name: courseName, status: (data.status || course.status || "active") as "draft" | "active" | "inactive" }
        : { ...restData, name: courseName, status: "active" as const };
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
          name="programmeId"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Programme</FormLabel>
              <Select onValueChange={field.onChange} value={field.value}>
                <FormControl>
                  <SelectTrigger>
                    <SelectValue placeholder="Sélectionner un programme" />
                  </SelectTrigger>
                </FormControl>
                <SelectContent side="bottom" sideOffset={4} position="item-aligned">
                  {programmes.length > 0 ? (
                    programmes.map((programme) => (
                      <SelectItem key={programme.id} value={programme.id}>
                        {programme.name}
                      </SelectItem>
                    ))
                  ) : (
                    <SelectItem value="no-programme" disabled>
                      Aucun programme disponible
                    </SelectItem>
                  )}
                </SelectContent>
              </Select>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="bilanTypeId"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Type de bilan</FormLabel>
              <Select onValueChange={field.onChange} value={field.value}>
                <FormControl>
                  <SelectTrigger>
                    <SelectValue placeholder="Sélectionner un type de bilan" />
                  </SelectTrigger>
                </FormControl>
                <SelectContent>
                  {bilanTypes.length > 0 ? (
                    bilanTypes.map((bilanType) => (
                      <SelectItem key={bilanType.id} value={bilanType.id}>
                        {bilanType.name}
                      </SelectItem>
                    ))
                  ) : (
                    <SelectItem value="no-bilan-type" disabled>
                      Aucun type de bilan disponible
                    </SelectItem>
                  )}
                </SelectContent>
              </Select>
              <FormMessage />
            </FormItem>
          )}
        />

        {!allowBulkCreation || !!course ? (
          <>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Matière</FormLabel>
                    <FormControl>
                      <Input placeholder="Ex. : Mathématiques appliquées" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="status"
                render={({ field }) => {
                  const statusValue = field.value || "active";
                  return (
                    <FormItem>
                      <FormLabel>Statut</FormLabel>
                      <Select onValueChange={field.onChange} value={statusValue} key={statusValue}>
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue placeholder="Sélectionner un statut" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value="draft">Brouillon</SelectItem>
                          <SelectItem value="active">Actif</SelectItem>
                          <SelectItem value="inactive">Inactif</SelectItem>
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  );
                }}
              />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              <FormField
                control={form.control}
                name="coef"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>COEF *</FormLabel>
                    <FormControl>
                      <CoefDecimalInput
                        value={field.value}
                        onChange={field.onChange}
                        onBlur={field.onBlur}
                        disabled={isLoading}
                        placeholder="Ex. : 2 ou 2,5"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="cm"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>CM</FormLabel>
                    <FormControl>
                      <Input placeholder="Ex: 20h" value={field.value ?? ""} onChange={field.onChange} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="td"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>TD</FormLabel>
                    <FormControl>
                      <Input placeholder="Ex: 10h" value={field.value ?? ""} onChange={field.onChange} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="tp"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>TP</FormLabel>
                    <FormControl>
                      <Input placeholder="Ex: 8h" value={field.value ?? ""} onChange={field.onChange} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="vhh"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>VHH</FormLabel>
                    <FormControl>
                      <Input placeholder="Ex: 38h" value={field.value ?? ""} onChange={field.onChange} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
          </>
        ) : (
          <div className="space-y-4">
            <h3 className="text-sm font-medium">Matières à créer</h3>

            {fields.map((item, index) => (
              <div key={item.id} className="rounded-lg border p-4 space-y-4">
                <div className="flex items-center justify-between">
                  <h4 className="text-sm font-semibold">Matière {index + 1}</h4>
                  <button
                    type="button"
                    onClick={() => remove(index)}
                    className="inline-flex items-center gap-2 px-3 py-2 text-sm rounded-md border hover:bg-muted disabled:opacity-50"
                    disabled={fields.length === 1 || isLoading}
                  >
                    <Trash2 className="h-4 w-4" />
                    Retirer
                  </button>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  <FormField
                    control={form.control}
                    name={`bulkItems.${index}.name`}
                    render={({ field }) => (
                      <FormItem className="md:col-span-2 lg:col-span-3">
                        <FormLabel>Matière</FormLabel>
                        <FormControl>
                          <Input placeholder="Ex. : Mathématiques appliquées" {...field} value={field.value ?? ""} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name={`bulkItems.${index}.coef`}
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>COEF *</FormLabel>
                        <FormControl>
                          <CoefDecimalInput
                            value={field.value}
                            onChange={field.onChange}
                            onBlur={field.onBlur}
                            disabled={isLoading}
                            placeholder="Ex. : 2 ou 2,5"
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name={`bulkItems.${index}.cm`}
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>CM</FormLabel>
                        <FormControl>
                          <Input placeholder="Ex: 20h" value={field.value ?? ""} onChange={field.onChange} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name={`bulkItems.${index}.td`}
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>TD</FormLabel>
                        <FormControl>
                          <Input placeholder="Ex: 10h" value={field.value ?? ""} onChange={field.onChange} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name={`bulkItems.${index}.tp`}
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>TP</FormLabel>
                        <FormControl>
                          <Input placeholder="Ex: 8h" value={field.value ?? ""} onChange={field.onChange} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name={`bulkItems.${index}.vhh`}
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>VHH</FormLabel>
                        <FormControl>
                          <Input placeholder="Ex: 38h" value={field.value ?? ""} onChange={field.onChange} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>
              </div>
            ))}

            <div className="flex justify-end">
              <button
                type="button"
                onClick={() => append({ name: "", cm: "", td: "", tp: "", coef: 1, vhh: "" })}
                className="inline-flex items-center gap-2 px-3 py-2 text-sm rounded-md border hover:bg-muted"
                disabled={isLoading}
              >
                <Plus className="h-4 w-4" />
                Ajouter une matière
              </button>
            </div>
          </div>
        )}

        <div className="flex gap-3 pt-4">
          <button
            type="button"
            onClick={onCancel}
            className="flex-1 px-6 py-3 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50 transition-all duration-200 font-medium"
            disabled={isLoading}
          >
            Annuler
          </button>
          <button
            type="submit"
            className="flex-1 px-6 py-3 bg-gradient-to-r from-green-500 to-blue-600 text-white rounded-lg hover:from-green-600 hover:to-blue-700 transition-all duration-200 disabled:opacity-50 font-medium shadow-lg hover:shadow-xl"
            disabled={isLoading}
          >
            {isLoading ? (
              <span className="flex items-center justify-center">
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Enregistrement...
              </span>
            ) : (
              "Enregistrer"
            )}
          </button>
        </div>
      </form>
    </Form>
  );
}
