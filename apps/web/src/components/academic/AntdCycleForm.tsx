"use client";

import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import toast from "react-hot-toast";
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
  CreateCycle,
  UpdateCycle,
  Cycle,
  CycleType,
  CycleStatus,
} from "@ecoledigitale/contracts";

const cycleFormSchema = z.object({
  name: z.string().min(1, "Le nom du cycle est requis").max(255, "Le nom ne peut pas dépasser 255 caractères"),
  code: z.string().max(20, "Le code ne peut pas dépasser 20 caractères").optional(),
  type: z.enum(["academic", "professional", "short", "certification"], {
    required_error: "Le type est requis",
  }),
  description: z.string().optional(),
  certificationLevel: z.string().optional(),
  status: z.enum(["draft", "active", "archived"], {
    required_error: "Le statut est requis",
  }).optional(),
});

type CycleFormData = z.infer<typeof cycleFormSchema>;

interface AntdCycleFormProps {
  cycle?: Cycle;
  onSubmit: (data: CreateCycle | UpdateCycle) => Promise<void>;
  onCancel: () => void;
  isLoading?: boolean;
}

const cycleTypes: { value: CycleType; label: string }[] = [
  { value: "academic", label: "Académique" },
  { value: "professional", label: "Professionnel" },
  { value: "short", label: "Formation courte" },
  { value: "certification", label: "Certification" },
];

const cycleStatuses: { value: CycleStatus; label: string }[] = [
  { value: "draft", label: "Brouillon" },
  { value: "active", label: "Actif" },
  { value: "archived", label: "Archivé" },
];

export function AntdCycleForm({ cycle, onSubmit, onCancel, isLoading = false }: AntdCycleFormProps) {
  const form = useForm<CycleFormData>({
    resolver: zodResolver(cycleFormSchema),
    defaultValues: {
      name: cycle?.name || "",
      code: cycle?.code || undefined,
      type: cycle?.type || "academic",
      description: cycle?.description || "",
      certificationLevel: cycle?.certificationLevel || "",
      status: cycle?.status || "active",
    },
  });

  const handleSubmit = async (data: CycleFormData) => {
    try {
      // Pour la création, définir automatiquement le statut sur 'active'
      // Pour la modification, utiliser le statut du formulaire
      const dataToSubmit = cycle 
        ? { ...data, status: (data.status || cycle.status) as CycleStatus } 
        : { ...data, status: 'active' as CycleStatus };
      
      await onSubmit(dataToSubmit);
    } catch (error: any) {
      console.error("Error submitting form:", error);
      
      // Extract error message
      const errorMessage = error?.message || "Erreur lors de l'enregistrement. Vérifiez que tous les champs sont correctement remplis.";
      
      // If error is related to code field, set error on that field
      if (error?.field === "code" || errorMessage.includes("code")) {
        form.setError("code", {
          type: "manual",
          message: errorMessage.includes("existe déjà") || errorMessage.includes("already exists")
            ? "Un cycle avec ce code existe déjà. Veuillez utiliser un code différent."
            : errorMessage
        });
        toast.error(errorMessage, {
          duration: 5000,
          position: "top-center"
        });
      } else {
        // Show general error toast
        toast.error(errorMessage, {
          duration: 5000,
          position: "top-center"
        });
      }
    }
  };

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(handleSubmit)} className="space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <FormField
            control={form.control}
            name="name"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Nom du cycle</FormLabel>
                <FormControl>
                  <Input placeholder="Ex: BTS Services Informatiques" {...field} />
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
                  <Input placeholder="Ex: BTS-SIO" value={field.value ?? ""} onChange={field.onChange} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <FormField
            control={form.control}
            name="type"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Type</FormLabel>
                <Select onValueChange={field.onChange} defaultValue={field.value}>
                  <FormControl>
                    <SelectTrigger>
                      <SelectValue placeholder="Sélectionnez un type" />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    {cycleTypes.map((type) => (
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

          <FormField
            control={form.control}
            name="certificationLevel"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Niveau de certification</FormLabel>
                <FormControl>
                  <Input placeholder="Ex: Bac+2, Bac+3" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>

        <FormField
          control={form.control}
          name="description"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Description</FormLabel>
              <FormControl>
                <Textarea
                  placeholder="Description du cycle académique..."
                  className="min-h-[80px]"
                  {...field}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        {/* Champ de statut visible uniquement lors de la modification */}
        {cycle && (
          <FormField
            control={form.control}
            name="status"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Statut</FormLabel>
                <Select onValueChange={field.onChange} defaultValue={field.value}>
                  <FormControl>
                    <SelectTrigger>
                      <SelectValue placeholder="Sélectionnez un statut" />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    {cycleStatuses.map((status) => (
                      <SelectItem key={status.value} value={status.value}>
                        {status.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )}
          />
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
            className="flex-1 px-4 py-2 bg-gradient-to-r from-blue-500 to-purple-600 text-white rounded-md hover:from-blue-600 hover:to-purple-700 transition-colors disabled:opacity-50"
            disabled={isLoading}
          >
            {isLoading ? "Enregistrement..." : "Enregistrer"}
          </button>
        </div>
      </form>
    </Form>
  );
}
