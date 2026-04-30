"use client";

import { useState } from "react";
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
import { ArrowLeft, Loader2, Plus, X } from "lucide-react";
import toast from "react-hot-toast";
import { useCreateFormateur, CreateFormateurData } from "@/lib/hooks/use-sessions-pro";

// Same password generation strategy as student creation
const generatePassword = (): string => {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*";
  let password = "";
  for (let i = 0; i < 12; i++) {
    password += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return password;
};

const formateurFormSchema = z.object({
  civilite: z.string().optional(),
  nom: z.string().min(1, "Le nom est requis").max(100, "Le nom ne peut pas dépasser 100 caractères"),
  prenom: z.string().min(1, "Le prénom est requis").max(100, "Le prénom ne peut pas dépasser 100 caractères"),
  email: z.string().email("Email invalide").min(1, "L'email est requis"),
  telephone: z.string().max(20, "Le numéro de téléphone ne peut pas dépasser 20 caractères").optional().or(z.literal("")),
  specialites: z.array(z.string()).default([]),
  bio: z.string().optional().or(z.literal("")),
  linkedin_url: z.string().url("URL LinkedIn invalide").optional().or(z.literal("")),
  tarif_journalier: z.number().nonnegative("Le tarif journalier doit être positif").optional().or(z.literal("")),
  actif: z.boolean().default(true),
});

type FormateurFormData = z.infer<typeof formateurFormSchema>;

interface FormateurFormProps {
  onSuccess?: (formateurId: string) => void;
  onCancel?: () => void;
}

export function FormateurForm({ onSuccess, onCancel }: FormateurFormProps) {
  const createFormateur = useCreateFormateur();
  const [newSpecialite, setNewSpecialite] = useState("");

  const form = useForm<FormateurFormData>({
    resolver: zodResolver(formateurFormSchema),
    defaultValues: {
      specialites: [],
      actif: true,
    },
  });

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
    setValue,
    watch,
  } = form;

  const specialites = watch("specialites");

  const addSpecialite = () => {
    if (newSpecialite.trim() && !specialites.includes(newSpecialite.trim())) {
      setValue("specialites", [...specialites, newSpecialite.trim()]);
      setNewSpecialite("");
    }
  };

  const removeSpecialite = (index: number) => {
    setValue("specialites", specialites.filter((_, i) => i !== index));
  };

  const onSubmit = async (data: FormateurFormData) => {
    try {
      const password = generatePassword();

      const formateurData: CreateFormateurData = {
        password,
        civilite: data.civilite || undefined,
        nom: data.nom,
        prenom: data.prenom,
        email: data.email,
        telephone: data.telephone || undefined,
        specialites: data.specialites.length > 0 ? data.specialites : undefined,
        bio: data.bio || undefined,
        linkedin_url: data.linkedin_url || undefined,
        tarif_journalier: data.tarif_journalier ? Number(data.tarif_journalier) : undefined,
        actif: data.actif,
      };

      const result = await createFormateur.mutateAsync(formateurData);
      toast.success(`Formateur créé avec succès. Mot de passe temporaire: ${password}`, {
        duration: 9000,
      });
      
      if (onSuccess) {
        onSuccess(result.data.id);
      }
    } catch (error: any) {
      console.error("Error creating formateur:", error);
      
      // Handle 401 errors specifically - don't let them trigger redirect
      if (error?.status === 401 || error?.message?.includes("Authentication") || error?.message?.includes("TENANT")) {
        toast.error("Votre session a expiré. Veuillez vous reconnecter.");
        // Don't redirect immediately - let user see the error message
        // They can manually refresh or navigate to login if needed
        return;
      }
      
      toast.error(error.message || "Erreur lors de la création du formateur");
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Nouveau Formateur</CardTitle>
        <CardDescription>
          Créez un nouveau formateur pour les formations professionnelles
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Form {...form}>
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
          {/* Informations personnelles */}
          <div className="space-y-4">
            <h3 className="text-lg font-semibold">Informations personnelles</h3>
            
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <FormLabel>Civilité</FormLabel>
                <Select
                  onValueChange={(value) => setValue("civilite", value)}
                  defaultValue={watch("civilite")}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Sélectionner" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="M.">M.</SelectItem>
                    <SelectItem value="Mme">Mme</SelectItem>
                    <SelectItem value="Mlle">Mlle</SelectItem>
                    <SelectItem value="Dr">Dr</SelectItem>
                    <SelectItem value="Prof">Prof</SelectItem>
                  </SelectContent>
                </Select>
                {errors.civilite && (
                  <p className="text-sm text-red-500 mt-1">{errors.civilite.message}</p>
                )}
              </div>

              <div>
                <FormLabel>Prénom *</FormLabel>
                <Input {...register("prenom")} placeholder="Prénom" />
                {errors.prenom && (
                  <p className="text-sm text-red-500 mt-1">{errors.prenom.message}</p>
                )}
              </div>

              <div>
                <FormLabel>Nom *</FormLabel>
                <Input {...register("nom")} placeholder="Nom" />
                {errors.nom && (
                  <p className="text-sm text-red-500 mt-1">{errors.nom.message}</p>
                )}
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <FormLabel>Email *</FormLabel>
                <Input type="email" {...register("email")} placeholder="email@example.com" />
                {errors.email && (
                  <p className="text-sm text-red-500 mt-1">{errors.email.message}</p>
                )}
              </div>

              <div>
                <FormLabel>Téléphone</FormLabel>
                <Input type="tel" {...register("telephone")} placeholder="+225 XX XX XX XX XX" />
                {errors.telephone && (
                  <p className="text-sm text-red-500 mt-1">{errors.telephone.message}</p>
                )}
              </div>
            </div>
          </div>

          {/* Spécialités */}
          <div className="space-y-4">
            <h3 className="text-lg font-semibold">Spécialités</h3>
            
            <div className="flex gap-2">
              <Input
                value={newSpecialite}
                onChange={(e) => setNewSpecialite(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    addSpecialite();
                  }
                }}
                placeholder="Ajouter une spécialité"
                className="flex-1"
              />
              <Button type="button" onClick={addSpecialite} variant="outline">
                <Plus className="w-4 h-4 mr-2" />
                Ajouter
              </Button>
            </div>

            {specialites.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {specialites.map((specialite, index) => (
                  <div
                    key={index}
                    className="flex items-center gap-2 bg-primary/10 text-primary px-3 py-1 rounded-full"
                  >
                    <span>{specialite}</span>
                    <button
                      type="button"
                      onClick={() => removeSpecialite(index)}
                      className="hover:bg-primary/20 rounded-full p-0.5"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Informations professionnelles */}
          <div className="space-y-4">
            <h3 className="text-lg font-semibold">Informations professionnelles</h3>
            
            <div>
              <FormLabel>Biographie</FormLabel>
              <Textarea
                {...register("bio")}
                placeholder="Biographie du formateur..."
                rows={4}
              />
              {errors.bio && (
                <p className="text-sm text-red-500 mt-1">{errors.bio.message}</p>
              )}
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <FormLabel>LinkedIn</FormLabel>
                <Input {...register("linkedin_url")} placeholder="https://linkedin.com/in/..." />
                {errors.linkedin_url && (
                  <p className="text-sm text-red-500 mt-1">{errors.linkedin_url.message}</p>
                )}
              </div>

              <div>
                <FormLabel>Tarif journalier (FCFA)</FormLabel>
                <Input
                  type="number"
                  {...register("tarif_journalier", {
                    setValueAs: (v) => (v === "" ? "" : Number(v)),
                  })}
                  placeholder="0"
                />
                {errors.tarif_journalier && (
                  <p className="text-sm text-red-500 mt-1">{errors.tarif_journalier.message}</p>
                )}
              </div>
            </div>

            <div className="flex items-center space-x-2">
              <input
                type="checkbox"
                {...register("actif")}
                className="w-4 h-4 rounded border-gray-300"
              />
              <FormLabel className="!mt-0">Formateur actif</FormLabel>
            </div>
          </div>

          {/* Actions */}
          <div className="flex justify-end gap-4 pt-4 border-t">
            {onCancel && (
              <Button type="button" variant="outline" onClick={onCancel}>
                Annuler
              </Button>
            )}
            <Button type="submit" disabled={isSubmitting || createFormateur.isPending}>
              {isSubmitting || createFormateur.isPending ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Création...
                </>
              ) : (
                "Créer le formateur"
              )}
            </Button>
          </div>
        </form>
        </Form>
      </CardContent>
    </Card>
  );
}
