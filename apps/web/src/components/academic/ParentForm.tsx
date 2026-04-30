"use client";

import { useEffect } from "react";
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
  Button,
} from "@ecoledigitale/ui";
import { Parent, CreateParentData, UpdateParentData } from "@/lib/hooks/use-parents";
import { Loader2 } from "lucide-react";

const parentFormSchema = z.object({
  firstName: z.string().min(1, "Le prénom est requis").max(100, "Le prénom est trop long"),
  lastName: z.string().min(1, "Le nom est requis").max(100, "Le nom est trop long"),
  email: z.string().email("Email invalide").min(1, "L'email est requis"),
  phone: z.string().optional(),
  password: z.string().optional().refine(
    (val) => !val || val.length >= 6,
    "Le mot de passe doit contenir au moins 6 caractères"
  ),
});

type ParentFormData = z.infer<typeof parentFormSchema>;

interface ParentFormProps {
  parent?: Parent;
  onSubmit: (data: CreateParentData | UpdateParentData) => Promise<void>;
  onCancel?: () => void;
  isLoading?: boolean;
}

export function ParentForm({ parent, onSubmit, onCancel, isLoading = false }: ParentFormProps) {
  const form = useForm<ParentFormData>({
    resolver: zodResolver(parentFormSchema),
    defaultValues: {
      firstName: parent?.firstName || "",
      lastName: parent?.lastName || "",
      email: parent?.email || "",
      phone: "",
      password: "",
    },
  });

  // Update form when parent data changes
  useEffect(() => {
    if (parent) {
      form.reset({
        firstName: parent.firstName || "",
        lastName: parent.lastName || "",
        email: parent.email || "",
        phone: "",
        password: "",
      });
    }
  }, [parent, form]);

  const handleSubmit = async (data: ParentFormData) => {
    try {
      console.log("[ParentForm] Submitting form data:", data);
      if (parent) {
        // Update: exclude password if not provided
        const updateData: UpdateParentData = {
          firstName: data.firstName,
          lastName: data.lastName,
          email: data.email,
          ...(data.phone && { phone: data.phone }),
        };
        console.log("[ParentForm] Update data:", updateData);
        await onSubmit(updateData);
      } else {
        // Create: password is required
        if (!data.password) {
          form.setError("password", { message: "Le mot de passe est requis" });
          return;
        }
        const createData: CreateParentData = {
          firstName: data.firstName,
          lastName: data.lastName,
          email: data.email,
          password: data.password,
          ...(data.phone && { phone: data.phone }),
        };
        console.log("[ParentForm] Create data:", createData);
        await onSubmit(createData);
      }
    } catch (error) {
      console.error("[ParentForm] Error submitting form:", error);
      // Re-throw to let the parent component handle it
      throw error;
    }
  };

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(handleSubmit)} className="space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <FormField
            control={form.control}
            name="firstName"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Prénom</FormLabel>
                <FormControl>
                  <Input placeholder="Ex: Jean" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="lastName"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Nom</FormLabel>
                <FormControl>
                  <Input placeholder="Ex: Dupont" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>

        <FormField
          control={form.control}
          name="email"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Email</FormLabel>
              <FormControl>
                <Input type="email" placeholder="Ex: jean.dupont@example.com" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="phone"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Téléphone (optionnel)</FormLabel>
              <FormControl>
                  <Input type="tel" placeholder="Ex: +225 07 07 12 34 56" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        {!parent && (
          <FormField
            control={form.control}
            name="password"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Mot de passe</FormLabel>
                <FormControl>
                  <Input type="password" placeholder="Minimum 6 caractères" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        )}

        <div className="flex justify-end gap-3 pt-4">
          {onCancel && (
            <Button
              type="button"
              variant="outline"
              onClick={onCancel}
              disabled={isLoading}
            >
              Annuler
            </Button>
          )}
          <Button
            type="submit"
            disabled={isLoading}
            className="bg-gradient-to-r from-rose-500 to-pink-600 hover:from-rose-600 hover:to-pink-700 text-white"
          >
            {isLoading ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                {parent ? "Modification..." : "Création..."}
              </>
            ) : (
              parent ? "Modifier" : "Créer"
            )}
          </Button>
        </div>
      </form>
    </Form>
  );
}
