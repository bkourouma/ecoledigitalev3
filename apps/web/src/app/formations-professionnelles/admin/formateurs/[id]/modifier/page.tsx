"use client";

import { useState, useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
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
import { ArrowLeft, Loader2, Plus, X, AlertCircle } from "lucide-react";
import toast from "react-hot-toast";
import { useFormateurDetail, useUpdateFormateur, UpdateFormateurData } from "@/lib/hooks/use-sessions-pro";

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

export default function EditFormateurPage() {
  const router = useRouter();
  const params = useParams();
  const formateurId = params.id as string;
  const updateFormateur = useUpdateFormateur();
  
  const { data: response, isLoading, error, refetch } = useFormateurDetail(formateurId);
  const formateur = response?.data;
  const [newSpecialite, setNewSpecialite] = useState("");

  // Determine if it's a 404 error
  const isNotFound = (error as any)?.status === 404 || (error as any)?.code === "NOT_FOUND";

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
    reset,
  } = form;

  const specialites = watch("specialites");

  // Populate form when formateur data is loaded
  useEffect(() => {
    if (formateur) {
      reset({
        civilite: formateur.civilite || "",
        nom: formateur.nom || "",
        prenom: formateur.prenom || "",
        email: formateur.email || "",
        telephone: formateur.telephone || "",
        specialites: formateur.specialites || [],
        bio: formateur.bio || "",
        linkedin_url: formateur.linkedin_url || "",
        tarif_journalier: formateur.tarif_journalier || undefined,
        actif: formateur.actif !== undefined ? formateur.actif : true,
      });
    }
  }, [formateur, reset]);

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
      const updateData: UpdateFormateurData = {
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

      await updateFormateur.mutateAsync({
        formateurId,
        data: updateData,
      });
      
      // Navigate to details page after successful update
      router.push(`/formations-professionnelles/admin/formateurs/${formateurId}/details`);
    } catch (error: any) {
      console.error("Error updating formateur:", error);
      
      // Handle 401 errors specifically - don't let them trigger redirect
      if (error?.status === 401 || error?.message?.includes("Authentication") || error?.message?.includes("TENANT")) {
        toast.error("Votre session a expiré. Veuillez vous reconnecter.");
        return;
      }
      
      toast.error(error.message || "Erreur lors de la mise à jour du formateur");
    }
  };

  const handleCancel = () => {
    router.push(`/formations-professionnelles/admin/formateurs/${formateurId}/details`);
  };

  if (isLoading) {
    return (
      <div className="container mx-auto px-4 sm:px-6 py-4 sm:py-8 max-w-7xl">
        <div className="animate-pulse space-y-6">
          <div className="h-8 bg-gray-200 rounded w-1/3"></div>
          <div className="h-64 bg-gray-200 rounded"></div>
        </div>
      </div>
    );
  }

  if (error || !formateur) {
    return (
      <div className="container mx-auto px-4 sm:px-6 py-4 sm:py-8 max-w-7xl">
        <div className="text-center space-y-4">
          <AlertCircle className="h-16 w-16 text-red-500 mx-auto" />
          <h1 className="text-xl sm:text-2xl font-bold text-red-600">
            {isNotFound ? "Formateur non trouvé" : "Erreur de chargement"}
          </h1>
          <p className="text-sm sm:text-base text-muted-foreground">
            {isNotFound 
              ? "Le formateur demandé n'existe pas ou a été supprimé."
              : error?.message || "Une erreur s'est produite lors du chargement du formateur."}
          </p>
          <div className="flex flex-col sm:flex-row gap-3 justify-center items-center">
            {!isNotFound && (
              <Button 
                onClick={() => refetch()} 
                variant="outline"
                className="w-full sm:w-auto"
              >
                <Loader2 className="w-4 h-4 mr-2" />
                Réessayer
              </Button>
            )}
            <Button 
              onClick={() => router.push('/formations-professionnelles/admin/formateurs')} 
              className="w-full sm:w-auto"
            >
              <ArrowLeft className="w-4 h-4 mr-2" />
              Retour à la liste
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="container mx-auto px-4 sm:px-6 py-4 sm:py-8 max-w-7xl">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4 mb-6 sm:mb-8">
        <Button
          variant="outline"
          onClick={handleCancel}
          className="flex items-center gap-2 w-full sm:w-auto"
        >
          <ArrowLeft className="w-4 h-4" />
          <span className="hidden sm:inline">Retour</span>
        </Button>
        <div className="flex-1 w-full min-w-0">
          <h1 className="text-2xl sm:text-3xl font-bold break-words">
            Modifier le formateur
          </h1>
          <p className="text-sm sm:text-base text-muted-foreground break-words">
            {formateur.prenom} {formateur.nom}
          </p>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Modifier le formateur</CardTitle>
          <CardDescription>
            Modifiez les informations du formateur
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
                <Button type="button" variant="outline" onClick={handleCancel}>
                  Annuler
                </Button>
                <Button type="submit" disabled={isSubmitting || updateFormateur.isPending}>
                  {isSubmitting || updateFormateur.isPending ? (
                    <>
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      Enregistrement...
                    </>
                  ) : (
                    "Enregistrer les modifications"
                  )}
                </Button>
              </div>
            </form>
          </Form>
        </CardContent>
      </Card>
    </div>
  );
}

