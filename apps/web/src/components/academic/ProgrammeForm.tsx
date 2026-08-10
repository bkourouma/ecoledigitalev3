"use client";

import { useEffect } from "react";
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
  Textarea,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@ecoledigitale/ui";
import { Plus, Trash2 } from "lucide-react";
import { Programme } from "@/lib/hooks/use-programmes";
import { useCycles } from "@/lib/hooks/use-cycles";

const programmeFormSchema = z.object({
  name: z.string().max(100, "Le nom est trop long").optional().or(z.literal("")),
  code: z.string().max(20, "Le code est trop long").optional().or(z.literal("")),
  description: z.string().optional(),
  domaine: z.string().max(255, "Le domaine est trop long").optional().or(z.literal("")),
  cycleId: z.string().min(1, "Le cycle est requis").refine(
    (value) => value !== "no-cycles",
    "Veuillez sélectionner un cycle valide"
  ),
  status: z.enum(["draft", "review", "approved", "active", "archived"], {
    required_error: "Le statut est requis",
  }).default("active"),
  bulkItems: z.array(z.object({
    name: z.string().max(100, "Le nom est trop long").optional().or(z.literal("")),
    code: z.string().max(20, "Le code est trop long").optional().or(z.literal("")),
    domaine: z.string().max(255, "Le domaine est trop long").optional().or(z.literal("")),
  })).optional(),
});

type ProgrammeFormData = z.infer<typeof programmeFormSchema>;

interface ProgrammeFormProps {
  programme?: Programme;
  onSubmit: (data: ProgrammeFormData & {
    bulkProgrammes?: Array<{ name: string; code: string; domaine?: string }>;
  }) => Promise<void>;
  onCancel: () => void;
  isLoading?: boolean;
  allowBulkCreation?: boolean;
}

const programmeStatuses: { value: string; label: string }[] = [
  { value: "active", label: "Actif" },
  { value: "draft", label: "Brouillon" },
  { value: "review", label: "En révision" },
  { value: "approved", label: "Approuvé" },
  { value: "archived", label: "Archivé" },
];

export function ProgrammeForm({
  programme,
  onSubmit,
  onCancel,
  isLoading = false,
  allowBulkCreation = false,
}: ProgrammeFormProps) {
  const { data: cyclesData } = useCycles();
  const cycles = cyclesData?.data || [];

  const form = useForm<ProgrammeFormData>({
    resolver: zodResolver(programmeFormSchema),
    defaultValues: {
      name: programme?.name || "",
      code: programme?.code || "",
      description: programme?.description || "",
      domaine: programme?.domaine || "",
      cycleId: programme?.cycleId || "",
      status: (programme?.status || "active") as "draft" | "review" | "approved" | "active" | "archived",
      bulkItems: allowBulkCreation && !programme ? [{ name: "", code: "", domaine: "" }] : [],
    },
  });

  const { fields, append, remove } = useFieldArray({
    control: form.control,
    name: "bulkItems",
  });

  useEffect(() => {
    if (!programme) {
      const currentStatus = form.getValues("status");
      if (!currentStatus || currentStatus === "draft") {
        form.setValue("status", "active");
      }
    }
  }, [programme, form]);

  const handleSubmit = async (data: ProgrammeFormData) => {
    try {
      if (allowBulkCreation && !programme) {
        const rawItems = data.bulkItems || [];
        const normalized = rawItems
          .map((item) => ({
            name: item.name?.trim() || "",
            code: item.code?.trim() || "",
            domaine: item.domaine?.trim() || "",
          }))
          .filter((item) => item.name.length > 0 && item.code.length > 0);

        if (normalized.length === 0) {
          form.setError("bulkItems.0.name" as never, {
            message: "Ajoutez au moins une filière (nom et code remplis).",
          });
          return;
        }

        const deduped = normalized.filter(
          (item, index, arr) =>
            arr.findIndex(
              (candidate) => candidate.code.toLowerCase() === item.code.toLowerCase()
            ) === index
        );

        await onSubmit({
          ...data,
          name: deduped[0].name,
          code: deduped[0].code,
          domaine: deduped[0].domaine || undefined,
          bulkProgrammes: deduped,
          status: "active",
        });
        return;
      }

      const programmeName = data.name?.trim();
      const programmeCode = data.code?.trim();
      if (!programmeName) {
        form.setError("name", { message: "Le nom est requis" });
        return;
      }
      if (!programmeCode) {
        form.setError("code", { message: "Le code est requis" });
        return;
      }

      const { bulkItems: _bulkItems, ...restData } = data;
      const dataToSubmit = programme
        ? {
            ...restData,
            name: programmeName,
            code: programmeCode,
            status: (data.status || programme.status || "active") as
              | "draft"
              | "review"
              | "approved"
              | "active"
              | "archived",
          }
        : {
            ...restData,
            name: programmeName,
            code: programmeCode,
            status: "active" as const,
          };
      await onSubmit(dataToSubmit);
    } catch (error) {
      console.error("Error submitting form:", error);
      alert("Erreur lors de l'enregistrement. Vérifiez que tous les champs sont correctement remplis.");
    }
  };

  const cycleField = (
    <FormField
      control={form.control}
      name="cycleId"
      render={({ field }) => (
        <FormItem>
          <FormLabel>Cycle</FormLabel>
          <Select onValueChange={field.onChange} value={field.value}>
            <FormControl>
              <SelectTrigger>
                <SelectValue placeholder="Sélectionner un cycle" />
              </SelectTrigger>
            </FormControl>
            <SelectContent>
              {cycles.length > 0 ? (
                cycles.map((cycle) => (
                  <SelectItem key={cycle.id} value={cycle.id}>
                    {cycle.name}
                  </SelectItem>
                ))
              ) : (
                <SelectItem value="no-cycles" disabled>
                  Aucun cycle disponible
                </SelectItem>
              )}
            </SelectContent>
          </Select>
          <FormMessage />
        </FormItem>
      )}
    />
  );

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(handleSubmit)} className="space-y-4">
        <datalist id="domaine-suggestions">
          <option value="Sciences de Gestion des entreprises" />
          <option value="Sciences Juridiques, Politiques et Administratives" />
          <option value="Sciences et Technologies" />
        </datalist>

        {allowBulkCreation && !programme ? (
          cycleField
        ) : null}

        {!allowBulkCreation || !!programme ? (
          <>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Nom de la filière</FormLabel>
                    <FormControl>
                      <Input placeholder="Ex. : SLAM — Solutions logicielles" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="code"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Code</FormLabel>
                    <FormControl>
                      <Input placeholder="Ex. : SLAM" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            {cycleField}

            <FormField
              control={form.control}
              name="domaine"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Domaine (optionnel)</FormLabel>
                  <FormControl>
                    <Input
                      placeholder="Ex. : Sciences de Gestion des entreprises"
                      list="domaine-suggestions"
                      {...field}
                      value={field.value ?? ""}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="description"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Description</FormLabel>
                  <FormControl>
                    <Textarea
                      placeholder="Description de la filière…"
                      className="min-h-[80px]"
                      {...field}
                    />
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
                        {programmeStatuses.map((status) => (
                          <SelectItem key={status.value} value={status.value}>
                            {status.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                );
              }}
            />
          </>
        ) : (
          <div className="space-y-4">
            <h3 className="text-sm font-medium">Filières à créer (même cycle)</h3>

            {fields.map((item, index) => (
              <div key={item.id} className="rounded-lg border p-4 space-y-4">
                <div className="flex items-center justify-between">
                  <h4 className="text-sm font-semibold">Filière {index + 1}</h4>
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

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <FormField
                    control={form.control}
                    name={`bulkItems.${index}.name`}
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Nom de la filière</FormLabel>
                        <FormControl>
                          <Input
                            placeholder="Ex. : SLAM — Solutions logicielles"
                            {...field}
                            value={field.value ?? ""}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name={`bulkItems.${index}.code`}
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Code</FormLabel>
                        <FormControl>
                          <Input placeholder="Ex. : SLAM" {...field} value={field.value ?? ""} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>

                <FormField
                  control={form.control}
                  name={`bulkItems.${index}.domaine`}
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Domaine (optionnel)</FormLabel>
                      <FormControl>
                        <Input
                          placeholder="Ex. : Sciences de Gestion des entreprises"
                          list="domaine-suggestions"
                          {...field}
                          value={field.value ?? ""}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
            ))}

            <div className="flex justify-end">
              <button
                type="button"
                onClick={() => append({ name: "", code: "", domaine: "" })}
                className="inline-flex items-center gap-2 px-3 py-2 text-sm rounded-md border hover:bg-muted"
                disabled={isLoading}
              >
                <Plus className="h-4 w-4" />
                Ajouter une filière
              </button>
            </div>
          </div>
        )}

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
            className="flex-1 px-4 py-2 bg-gradient-to-r from-pink-500 to-orange-600 text-white rounded-md hover:from-pink-600 hover:to-orange-700 transition-colors disabled:opacity-50"
            disabled={isLoading}
          >
            {isLoading ? "Enregistrement…" : "Enregistrer"}
          </button>
        </div>
      </form>
    </Form>
  );
}
