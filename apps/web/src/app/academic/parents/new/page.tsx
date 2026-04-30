"use client";

import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Button,
  Input,
  Label,
} from "@ecoledigitale/ui";
import { ArrowLeft, Save, Loader2 } from "lucide-react";
import { useCreateParent, CreateParentData } from "@/lib/hooks/use-parents";

const generatePassword = (): string => {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*";
  let password = "";
  for (let i = 0; i < 12; i++) {
    password += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return password;
};

const parentFormSchema = z.object({
  firstName: z.string().min(1, "Le prénom est requis").max(100, "Le prénom ne peut pas dépasser 100 caractères"),
  lastName: z.string().min(1, "Le nom est requis").max(100, "Le nom ne peut pas dépasser 100 caractères"),
  email: z.string().email("Email invalide"),
  phone: z.string().max(20, "Le numéro de téléphone ne peut pas dépasser 20 caractères").optional().or(z.literal("")),
});

type ParentFormData = z.infer<typeof parentFormSchema>;

export default function NewParentPage() {
  const router = useRouter();
  const createParent = useCreateParent();

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<ParentFormData>({
    resolver: zodResolver(parentFormSchema),
  });

  const onSubmit = async (data: ParentFormData) => {
    try {
      const parentData: CreateParentData = {
        firstName: data.firstName,
        lastName: data.lastName,
        email: data.email,
        password: generatePassword(),
        phone: data.phone || undefined,
      };

      await createParent.mutateAsync(parentData);
      router.push("/academic/parents");
    } catch (error: any) {
      console.error("Error creating parent:", error);
      alert(error.message || "Erreur lors de la création du parent");
    }
  };

  return (
    <div className="container mx-auto px-6 py-8 max-w-2xl">
      <div className="flex items-center gap-4 mb-8">
        <Button variant="outline" size="sm" onClick={() => router.back()}>
          <ArrowLeft className="h-4 w-4 mr-2" />
          Retour
        </Button>
        <div>
          <h1 className="text-3xl font-bold bg-gradient-to-r from-blue-600 to-purple-600 bg-clip-text text-transparent">
            Nouveau parent
          </h1>
          <p className="text-muted-foreground mt-2">Ajoutez un nouveau parent à votre système</p>
        </div>
      </div>

      <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle>Informations personnelles</CardTitle>
            <CardDescription>Informations de base sur le parent</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="firstName">Prénom *</Label>
                <Input id="firstName" {...register("firstName")} placeholder="Prénom" />
                {errors.firstName && <p className="text-sm text-red-600">{errors.firstName.message}</p>}
              </div>

              <div className="space-y-2">
                <Label htmlFor="lastName">Nom *</Label>
                <Input id="lastName" {...register("lastName")} placeholder="Nom" />
                {errors.lastName && <p className="text-sm text-red-600">{errors.lastName.message}</p>}
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="email">Email *</Label>
              <Input id="email" type="email" {...register("email")} placeholder="email@example.com" />
              {errors.email && <p className="text-sm text-red-600">{errors.email.message}</p>}
            </div>

            <div className="space-y-2">
              <Label htmlFor="phone">Téléphone</Label>
              <Input id="phone" type="tel" {...register("phone")} placeholder="+225 07 07 12 34 56" />
              {errors.phone && <p className="text-sm text-red-600">{errors.phone.message}</p>}
            </div>
          </CardContent>
        </Card>

        <div className="flex justify-end gap-4">
          <Button type="button" variant="outline" onClick={() => router.back()}>
            Annuler
          </Button>
          <Button
            type="submit"
            disabled={isSubmitting || createParent.isPending}
            className="bg-emerald-600 hover:bg-emerald-700 text-white"
          >
            {isSubmitting || createParent.isPending ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Création...
              </>
            ) : (
              <>
                <Save className="h-4 w-4 mr-2" />
                Créer le parent
              </>
            )}
          </Button>
        </div>
      </form>
    </div>
  );
}
