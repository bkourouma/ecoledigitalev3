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
import { ArrowLeft, Loader2, Calendar, AlertCircle } from "lucide-react";
import toast from "react-hot-toast";
import { useFormationDetail, useUpdateFormationSession } from "@/lib/hooks/use-formations-pro";

// Schéma de validation
const sessionFormSchema = z.object({
  code_session: z.string().optional(),
  date_debut: z.string().min(1, "La date de début est requise"),
  date_fin: z.string().min(1, "La date de fin est requise"),
  horaires: z.string().optional(),
  mode_formation: z.enum(["presential", "remote", "hybrid", "elearning", "presentiel", "distanciel", "hybride"]),
  lieu: z.string().optional(),
  lien_visio: z.string().optional(),
  places_totales: z.number().int().min(1, "Le nombre de places doit être au moins 1"),
  prix_ht: z.number().nonnegative().optional().or(z.literal("")),
  prix_ttc: z.number().nonnegative().optional().or(z.literal("")),
  notes_internes: z.string().optional(),
}).refine((data) => {
  // La date de fin doit être postérieure à la date de début
  if (data.date_debut && data.date_fin) {
    const dateDebut = new Date(data.date_debut);
    const dateFin = new Date(data.date_fin);
    return dateFin >= dateDebut;
  }
  return true;
}, {
  message: "La date de fin doit être postérieure ou égale à la date de début",
  path: ["date_fin"],
});

type SessionFormData = z.infer<typeof sessionFormSchema>;

export default function EditSessionPage() {
  const router = useRouter();
  const params = useParams();
  const slug = decodeURIComponent(params.slug as string);
  const sessionId = params.sessionId as string;
  
  const { data, isLoading: isLoadingFormation } = useFormationDetail(slug);
  const updateSessionMutation = useUpdateFormationSession();
  const [isSubmitting, setIsSubmitting] = useState(false);

  const formation = data?.data;
  const session = formation?.sessions?.find((s: any) => s.id === sessionId);

  const form = useForm<SessionFormData>({
    resolver: zodResolver(sessionFormSchema),
    defaultValues: {
      code_session: "",
      date_debut: "",
      date_fin: "",
      horaires: "",
      mode_formation: "presential",
      lieu: "",
      lien_visio: "",
      places_totales: 20,
      prix_ht: undefined,
      prix_ttc: undefined,
      notes_internes: "",
    },
  });

  // Charger les données de la session dans le formulaire
  useEffect(() => {
    if (session) {
      // Map mode_formation from database format to form format
      const modeMap: Record<string, string> = {
        'presential': 'presential',
        'remote': 'remote',
        'hybrid': 'hybrid',
        'elearning': 'elearning',
        'presentiel': 'presential',
        'distanciel': 'remote',
        'hybride': 'hybrid',
      };
      const formMode = modeMap[session.mode_formation?.toLowerCase()] || 'presential';

      form.reset({
        code_session: session.code_session || "",
        date_debut: session.date_debut || "",
        date_fin: session.date_fin || "",
        horaires: session.horaires || "",
        mode_formation: formMode as any,
        lieu: session.lieu || "",
        lien_visio: session.lien_visio || "",
        places_totales: session.places_totales || 20,
        prix_ht: session.prix_ht || undefined,
        prix_ttc: session.prix_ttc || undefined,
        notes_internes: session.notes_internes || "",
      });
    }
  }, [session, form]);

  const handleCancel = () => {
    router.push(`/formations-professionnelles/catalogue/${slug}`);
  };

  const onSubmit = async (formData: SessionFormData) => {
    if (!formation?.id) {
      toast.error("Formation introuvable");
      return;
    }

    setIsSubmitting(true);
    try {
      // Préparer les données pour l'API
      const payload: any = {
        code_session: formData.code_session || undefined,
        date_debut: formData.date_debut,
        date_fin: formData.date_fin,
        horaires: formData.horaires || undefined,
        mode_formation: formData.mode_formation,
        lieu: formData.lieu || null,
        lien_visio: formData.lien_visio || null,
        places_totales: formData.places_totales,
        prix_ht: formData.prix_ht === "" || formData.prix_ht === undefined ? null : formData.prix_ht,
        prix_ttc: formData.prix_ttc === "" || formData.prix_ttc === undefined ? null : formData.prix_ttc,
        notes_internes: formData.notes_internes || undefined,
      };

      await updateSessionMutation.mutateAsync({
        formationId: formation.id,
        sessionId,
        data: payload,
      });

      toast.success("Session mise à jour avec succès");
      router.push(`/formations-professionnelles/catalogue/${slug}`);
    } catch (error: any) {
      console.error("Error updating session:", error);
      toast.error(error.message || "Erreur lors de la mise à jour de la session");
    } finally {
      setIsSubmitting(false);
    }
  };

  if (isLoadingFormation) {
    return (
      <div className="container mx-auto px-4 py-8 max-w-4xl">
        <div className="flex items-center justify-center py-16">
          <div className="text-center space-y-4">
            <div className="bg-gradient-to-br from-blue-100 to-purple-100 rounded-full w-16 h-16 flex items-center justify-center mx-auto">
              <Loader2 className="h-8 w-8 animate-spin text-blue-600" />
            </div>
            <p className="text-gray-600 text-lg">Chargement des informations de la session...</p>
          </div>
        </div>
      </div>
    );
  }

  if (!formation) {
    return (
      <div className="container mx-auto px-4 py-8 max-w-4xl">
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <div className="text-center space-y-4">
              <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mx-auto">
                <AlertCircle className="h-8 w-8 text-red-600" />
              </div>
              <div>
                <h3 className="text-lg font-medium">Formation introuvable</h3>
                <p className="text-muted-foreground">
                  La formation demandée n'existe pas ou a été supprimée.
                </p>
              </div>
              <Button onClick={handleCancel}>
                <ArrowLeft className="w-4 h-4 mr-2" />
                Retour
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!session) {
    return (
      <div className="container mx-auto px-4 py-8 max-w-4xl">
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <div className="text-center space-y-4">
              <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mx-auto">
                <AlertCircle className="h-8 w-8 text-red-600" />
              </div>
              <div>
                <h3 className="text-lg font-medium">Session introuvable</h3>
                <p className="text-muted-foreground">
                  La session demandée n'existe pas ou a été supprimée.
                </p>
              </div>
              <Button onClick={handleCancel}>
                <ArrowLeft className="w-4 h-4 mr-2" />
                Retour
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="container mx-auto px-4 py-8 max-w-4xl">
      {/* Header */}
      <div className="mb-6 flex max-w-full flex-col items-start gap-2 overflow-x-auto md:mb-8 md:gap-3">
        <Button
          variant="outline"
          size="sm"
          onClick={handleCancel}
          disabled={isSubmitting}
        >
          <ArrowLeft className="h-4 w-4 mr-2" />
          Retour
        </Button>
        <div>
          <h1 className="whitespace-nowrap font-bold bg-gradient-to-r from-blue-600 to-purple-600 bg-clip-text text-transparent text-2xl leading-tight md:text-3xl">
            Modifier la session
          </h1>
          <p className="whitespace-nowrap text-muted-foreground text-sm md:text-base">
            Modifiez les informations de la session pour {formation.titre}
          </p>
        </div>
      </div>

      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
          <Card className="shadow-lg">
            <CardHeader>
              <CardTitle>Informations de la session</CardTitle>
              <CardDescription>
                Modifiez les informations de la session de formation
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              {/* Code session (optionnel) */}
              <FormField
                control={form.control}
                name="code_session"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Code de session (optionnel)</FormLabel>
                    <FormControl>
                      <Input 
                        placeholder="Ex: DATA-2024-001" 
                        {...field} 
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {/* Dates */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <FormField
                  control={form.control}
                  name="date_debut"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Date de début *</FormLabel>
                      <FormControl>
                        <Input 
                          type="date" 
                          {...field} 
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="date_fin"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Date de fin *</FormLabel>
                      <FormControl>
                        <Input 
                          type="date" 
                          {...field}
                          min={form.watch("date_debut") || undefined}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              {/* Horaires */}
              <FormField
                control={form.control}
                name="horaires"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Horaires</FormLabel>
                    <FormControl>
                      <Input 
                        placeholder="Ex: 9h-17h" 
                        {...field} 
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {/* Mode de formation */}
              <FormField
                control={form.control}
                name="mode_formation"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Mode de formation *</FormLabel>
                    <Select
                      onValueChange={field.onChange}
                      value={field.value}
                    >
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Sélectionner un mode" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="presential">Présentiel</SelectItem>
                        <SelectItem value="remote">Distanciel</SelectItem>
                        <SelectItem value="hybrid">Hybride</SelectItem>
                        <SelectItem value="elearning">E-learning</SelectItem>
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {/* Lieu (si présentiel ou hybride) */}
              {(form.watch("mode_formation") === "presential" || form.watch("mode_formation") === "hybrid") && (
                <FormField
                  control={form.control}
                  name="lieu"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Lieu</FormLabel>
                      <FormControl>
                        <Input 
                          placeholder="Ex: Salle de formation, Adresse complète..." 
                          {...field} 
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              )}

              {/* Lien visio (si distanciel ou hybride) */}
              {(form.watch("mode_formation") === "remote" || form.watch("mode_formation") === "hybrid" || form.watch("mode_formation") === "elearning") && (
                <FormField
                  control={form.control}
                  name="lien_visio"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Lien de visioconférence</FormLabel>
                      <FormControl>
                        <Input 
                          type="url"
                          placeholder="Ex: https://meet.google.com/..." 
                          {...field} 
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              )}

              {/* Places */}
              <FormField
                control={form.control}
                name="places_totales"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Nombre de places *</FormLabel>
                    <FormControl>
                      <Input 
                        type="number"
                        min="1"
                        placeholder="Ex: 20" 
                        {...field}
                        onChange={(e) => field.onChange(parseInt(e.target.value) || 1)}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {/* Prix */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <FormField
                  control={form.control}
                  name="prix_ht"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Prix HT</FormLabel>
                      <FormControl>
                        <Input
                          type="number"
                          step="0.01"
                          placeholder="Ex: 1000.00"
                          {...field}
                          onChange={(e) => {
                            const value = e.target.value === "" ? "" : parseFloat(e.target.value);
                            field.onChange(value);
                          }}
                          value={field.value === undefined ? "" : field.value}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="prix_ttc"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Prix TTC</FormLabel>
                      <FormControl>
                        <Input
                          type="number"
                          step="0.01"
                          placeholder="Ex: 1200.00"
                          {...field}
                          onChange={(e) => {
                            const value = e.target.value === "" ? "" : parseFloat(e.target.value);
                            field.onChange(value);
                          }}
                          value={field.value === undefined ? "" : field.value}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              {/* Notes internes */}
              <FormField
                control={form.control}
                name="notes_internes"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Notes internes</FormLabel>
                    <FormControl>
                      <Textarea
                        placeholder="Notes internes pour cette session..."
                        rows={3}
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </CardContent>
          </Card>

          {/* Actions */}
          <div className="flex gap-3 justify-end">
            <Button type="button" variant="outline" onClick={handleCancel} disabled={isSubmitting}>
              Annuler
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              <Calendar className="mr-2 h-4 w-4" />
              Enregistrer les modifications
            </Button>
          </div>
        </form>
      </Form>
    </div>
  );
}

