"use client";

import { useState, useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useQueryClient } from "@tanstack/react-query";
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
  Label,
  Input,
  Textarea,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@ecoledigitale/ui";
import { ArrowLeft, Loader2, Plus, X, AlertCircle, FileVideo, Link2 } from "lucide-react";
import toast from "react-hot-toast";
import { useFormationDetail } from "@/lib/hooks/use-formations-pro";
import { createApiHeaders } from "@/lib/api-utils";
import { usesSessionBasedProfessionalCatalogue } from "@/lib/pro-tenants";

// Schéma de validation
const formationFormSchema = z.object({
  titre: z.string().min(1, "Le titre est requis").max(255, "Le titre est trop long"),
  description_courte: z.string().optional(),
  objectifs: z.array(z.string()).default([]),
  prerequis: z.string().optional(),
  public_cible: z.string().optional(),
  duree_jours: z.number().int().min(0).optional().or(z.literal("")),
  duree_heures: z.number().int().min(0).optional().or(z.literal("")),
  prix_ht: z.number().nonnegative().optional().or(z.literal("")),
  prix_ttc: z.number().nonnegative("Le prix TTC doit être positif"),
  type_certification: z.string().optional(),
  nom_certification: z.string().optional(),
  themes: z.array(z.string()).default([]),
  niveau: z.enum(["Débutant", "Intermédiaire", "Avancé"]).optional().or(z.literal("")),
  carriere: z.string().optional(),
}).refine((data) => {
  // Au moins une durée doit être renseignée
  return (data.duree_jours && data.duree_jours > 0) || (data.duree_heures && data.duree_heures > 0);
}, {
  message: "Au moins une durée (jours ou heures) doit être renseignée",
  path: ["duree_jours"],
});

type FormationFormData = z.infer<typeof formationFormSchema>;

export default function EditFormationPage() {
  const router = useRouter();
  const params = useParams();
  const slug = decodeURIComponent(params.slug as string);
  const queryClient = useQueryClient();
  const { data: session } = useSession();
  const tenantId = (session as { tenantId?: string } | null)?.tenantId;
  const sessionBasedCatalogue = usesSessionBasedProfessionalCatalogue(tenantId);

  const { data, isLoading, error, refetch } = useFormationDetail(slug);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [objectifs, setObjectifs] = useState<string[]>([""]);
  const [themes, setThemes] = useState<string[]>([""]);

  const [supportMode, setSupportMode] = useState<"file" | "vimeo">("file");
  const [supportFile, setSupportFile] = useState<File | null>(null);
  const [vimeoUrl, setVimeoUrl] = useState("");
  const [supportTitre, setSupportTitre] = useState("");
  const [supportDescription, setSupportDescription] = useState("");
  const [isUploadingSupport, setIsUploadingSupport] = useState(false);

  // Determine if it's a 404 error
  const isNotFound = (error as any)?.status === 404 || (error as any)?.code === "NOT_FOUND";

  const form = useForm<FormationFormData>({
    resolver: zodResolver(formationFormSchema),
    defaultValues: {
      titre: "",
      description_courte: "",
      objectifs: [],
      prerequis: "",
      public_cible: "",
      duree_jours: undefined,
      duree_heures: undefined,
      prix_ht: undefined,
      prix_ttc: 0,
      type_certification: "",
      nom_certification: "",
      themes: [],
      niveau: undefined,
      carriere: undefined,
    },
  });

  // Populate form when formation data is loaded
  useEffect(() => {
    if (data?.data) {
      const formation = data.data;
      form.reset({
        titre: formation.titre || "",
        description_courte: formation.description_courte || "",
        objectifs: formation.objectifs || [],
        prerequis: formation.prerequis || "",
        public_cible: formation.public_cible || "",
        duree_jours: formation.duree_jours || undefined,
        duree_heures: formation.duree_heures || undefined,
        prix_ht: formation.prix_ht || undefined,
        prix_ttc: formation.prix_ttc || 0,
        type_certification: formation.type_certification || "",
        nom_certification: formation.nom_certification || "",
        themes: formation.themes || [],
        niveau: formation.niveau || undefined,
        carriere: formation.carriere || undefined,
      });

      // Initialize objectifs and themes arrays for UI
      if (formation.objectifs && formation.objectifs.length > 0) {
        setObjectifs(formation.objectifs);
      } else {
        setObjectifs([""]);
      }

      if (formation.themes && formation.themes.length > 0) {
        setThemes(formation.themes);
      } else {
        setThemes([""]);
      }
    }
  }, [data, form]);

  useEffect(() => {
    if (!data?.data || sessionBasedCatalogue) {
      return;
    }
    const f = data.data;
    const cs = f.catalogue_support;
    if (cs) {
      setSupportTitre(cs.titre || "");
      setSupportDescription(cs.description || "");
      const isVimeo =
        cs.video_provider === "vimeo" ||
        (typeof cs.fichier_url === "string" && /vimeo\.com/i.test(cs.fichier_url));
      if (isVimeo) {
        setSupportMode("vimeo");
        if (cs.video_id) {
          setVimeoUrl(`https://vimeo.com/${cs.video_id}`);
        } else {
          setVimeoUrl(cs.fichier_url || "");
        }
      } else {
        setSupportMode("file");
        setVimeoUrl("");
      }
    } else {
      setSupportTitre("");
      setSupportDescription("");
      setSupportMode("file");
      setVimeoUrl("");
    }
    setSupportFile(null);
  }, [data, sessionBasedCatalogue]);

  const handleCancel = () => {
    router.push("/formations-professionnelles/catalogue");
  };

  const addObjectif = () => {
    setObjectifs([...objectifs, ""]);
  };

  const removeObjectif = (index: number) => {
    const newObjectifs = objectifs.filter((_, i) => i !== index);
    setObjectifs(newObjectifs.length > 0 ? newObjectifs : [""]);
    form.setValue("objectifs", newObjectifs.filter(o => o.trim() !== ""));
  };

  const updateObjectif = (index: number, value: string) => {
    const newObjectifs = [...objectifs];
    newObjectifs[index] = value;
    setObjectifs(newObjectifs);
    form.setValue("objectifs", newObjectifs.filter(o => o.trim() !== ""));
  };

  const addTheme = () => {
    setThemes([...themes, ""]);
  };

  const removeTheme = (index: number) => {
    const newThemes = themes.filter((_, i) => i !== index);
    setThemes(newThemes.length > 0 ? newThemes : [""]);
    form.setValue("themes", newThemes.filter(t => t.trim() !== ""));
  };

  const updateTheme = (index: number, value: string) => {
    const newThemes = [...themes];
    newThemes[index] = value;
    setThemes(newThemes);
    form.setValue("themes", newThemes.filter(t => t.trim() !== ""));
  };

  const onSubmit = async (formData: FormationFormData) => {
    setIsSubmitting(true);
    try {
      // Préparer les données pour l'API
      const payload: any = {
        titre: formData.titre,
        description_courte: formData.description_courte || null,
        prerequis: formData.prerequis || null,
        public_cible: formData.public_cible || null,
        duree_jours: formData.duree_jours === "" || formData.duree_jours === undefined ? null : formData.duree_jours,
        duree_heures: formData.duree_heures === "" || formData.duree_heures === undefined ? null : formData.duree_heures,
        prix_ht: formData.prix_ht === "" || formData.prix_ht === undefined ? null : formData.prix_ht,
        prix_ttc: formData.prix_ttc,
        type_certification: formData.type_certification || null,
        nom_certification: formData.nom_certification || null,
        niveau: formData.niveau && formData.niveau !== "" ? formData.niveau : null,
        carriere: formData.carriere || null,
        objectifs: formData.objectifs.filter(o => o.trim() !== ""),
        themes: formData.themes.filter(t => t.trim() !== ""),
      };

      const response = await fetch(`/api/v1/formations-pro/${encodeURIComponent(slug)}`, {
        method: "PUT",
        headers: {
          ...createApiHeaders(),
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || error.error || "Erreur lors de la mise à jour de la formation");
      }

      const result = await response.json();
      
      // Invalider le cache pour cette formation et la liste des formations
      const updatedSlug = result.data?.slug || slug;
      
      // Récupérer les données complètes de la formation mise à jour pour mettre à jour le cache
      // On fait un fetch direct pour obtenir les données à jour
      try {
        const detailResponse = await fetch(`/api/v1/formations-pro/${updatedSlug}`, {
          headers: createApiHeaders(),
        });
        
        if (detailResponse.ok) {
          const detailData = await detailResponse.json();
          // Mettre à jour le cache directement avec les nouvelles données
          queryClient.setQueryData(["formation-pro", updatedSlug], detailData);
        }
      } catch (fetchError) {
        console.warn("Could not fetch updated formation data:", fetchError);
      }
      
      // Invalider la query de détail de la formation (ancien et nouveau slug si différent)
      await queryClient.invalidateQueries({ 
        queryKey: ["formation-pro", slug],
        exact: false 
      });
      if (updatedSlug !== slug) {
        await queryClient.invalidateQueries({ 
          queryKey: ["formation-pro", updatedSlug],
          exact: false 
        });
      }
      
      // Invalider la liste des formations pour rafraîchir le catalogue
      await queryClient.invalidateQueries({ 
        queryKey: ["formations-pro"],
        exact: false 
      });
      
      // Refetch les données de la formation mise à jour pour s'assurer que tout est à jour
      await queryClient.refetchQueries({ 
        queryKey: ["formation-pro", updatedSlug],
        exact: false 
      });
      
      toast.success("Formation mise à jour avec succès");
      
      // Navigate to the updated formation (slug might have changed if titre was updated)
      // Utiliser replace au lieu de push pour éviter d'ajouter une entrée dans l'historique
      router.replace(`/formations-professionnelles/catalogue/${updatedSlug}`);
    } catch (error: any) {
      console.error("Error updating formation:", error);
      toast.error(error.message || "Erreur lors de la mise à jour de la formation");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleSupportSave = async () => {
    const formationRow = data?.data;
    if (!formationRow?.id || sessionBasedCatalogue) return;

    if (supportMode === "file" && !supportFile) {
      toast.error("Choisissez un fichier PDF ou vidéo.");
      return;
    }
    if (supportMode === "vimeo" && !vimeoUrl.trim()) {
      toast.error("Indiquez l’URL de la vidéo Vimeo.");
      return;
    }

    setIsUploadingSupport(true);
    try {
      const fd = new FormData();
      const titre =
        supportTitre.trim() ||
        formationRow.titre ||
        (supportMode === "file" ? supportFile?.name : "Vidéo Vimeo") ||
        "Support";
      fd.append("titre", titre);
      if (supportDescription.trim()) {
        fd.append("description", supportDescription.trim());
      }
      fd.append("visible_apprenants", "true");
      if (supportMode === "vimeo") {
        fd.append("video_provider", "vimeo");
        fd.append("vimeo_url", vimeoUrl.trim());
      } else if (supportFile) {
        fd.append("file", supportFile);
      }

      const res = await fetch(
        `/api/v1/formations-pro/${formationRow.id}/catalogue-support`,
        { method: "POST", body: fd }
      );
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.message || err.error || "Échec de l’enregistrement du support");
      }

      toast.success("Support pédagogique enregistré (remplace l’ancien fichier unique).");
      setSupportFile(null);
      setVimeoUrl("");
      await refetch();
      await queryClient.invalidateQueries({ queryKey: ["formations-pro"], exact: false });
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Erreur lors de l’upload");
    } finally {
      setIsUploadingSupport(false);
    }
  };

  if (isLoading) {
    return (
      <div className="container mx-auto px-4 py-8 max-w-4xl">
        <div className="flex items-center justify-center py-16">
          <div className="text-center space-y-4">
            <div className="bg-gradient-to-br from-blue-100 to-purple-100 rounded-full w-16 h-16 flex items-center justify-center mx-auto">
              <Loader2 className="h-8 w-8 animate-spin text-blue-600" />
            </div>
            <p className="text-gray-600 text-lg">Chargement des informations de la formation...</p>
          </div>
        </div>
      </div>
    );
  }

  if (error || !data?.data) {
    return (
      <div className="container mx-auto px-4 py-8 max-w-4xl">
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <div className="text-center space-y-4">
              <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mx-auto">
                <AlertCircle className="h-8 w-8 text-red-600" />
              </div>
              <div>
                <h3 className="text-lg font-medium">
                  {isNotFound ? "Formation introuvable" : "Erreur de chargement"}
                </h3>
                <p className="text-muted-foreground">
                  {isNotFound
                    ? "La formation demandée n'existe pas ou a été supprimée."
                    : error?.message || "Une erreur s'est produite lors du chargement de la formation."}
                </p>
              </div>
              <div className="flex flex-col sm:flex-row gap-3 justify-center items-center">
                {!isNotFound && (
                  <Button 
                    onClick={() => refetch()} 
                    variant="outline"
                  >
                    <Loader2 className="w-4 h-4 mr-2" />
                    Réessayer
                  </Button>
                )}
                <Button onClick={handleCancel}>
                  <ArrowLeft className="w-4 h-4 mr-2" />
                  Retour au catalogue
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  const formation = data.data;

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
            Modifier la formation
          </h1>
          <p className="whitespace-nowrap text-muted-foreground text-sm md:text-base">
            Modifiez les informations de {formation.titre}
          </p>
        </div>
      </div>

      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
          <Card className="shadow-lg">
            <CardHeader>
              <CardTitle>Informations de la formation</CardTitle>
              <CardDescription>
                Modifiez les informations de la formation professionnelle
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              {/* Carrière */}
              <FormField
                control={form.control}
                name="carriere"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Carrière</FormLabel>
                    <Select
                      onValueChange={field.onChange}
                      value={field.value || ""}
                    >
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Sélectionner une carrière" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="LES FORMATIONS INTERENTREPRISES d'IMHOTEP DATA">
                          LES FORMATIONS INTERENTREPRISES d'IMHOTEP DATA
                        </SelectItem>
                        <SelectItem value="LES FORMATIONS DIPLÔMANTES d'IMHOTEP DATA">
                          LES FORMATIONS DIPLÔMANTES d'IMHOTEP DATA
                        </SelectItem>
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {/* Titre */}
              <FormField
                control={form.control}
                name="titre"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Titre *</FormLabel>
                    <FormControl>
                      <Input placeholder="Ex: Formation en Data Science" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {/* Description courte */}
              <FormField
                control={form.control}
                name="description_courte"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Description courte</FormLabel>
                    <FormControl>
                      <Textarea
                        placeholder="Une brève description de la formation..."
                        rows={3}
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {/* Objectifs */}
              <div>
                <FormLabel>Objectifs pédagogiques</FormLabel>
                <div className="space-y-2 mt-2">
                  {objectifs.map((objectif, index) => (
                    <div key={index} className="flex gap-2">
                      <Input
                        placeholder="Objectif d'apprentissage"
                        value={objectif}
                        onChange={(e) => updateObjectif(index, e.target.value)}
                      />
                      {objectifs.length > 1 && (
                        <Button
                          type="button"
                          variant="outline"
                          size="icon"
                          onClick={() => removeObjectif(index)}
                        >
                          <X className="h-4 w-4" />
                        </Button>
                      )}
                    </div>
                  ))}
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={addObjectif}
                    className="w-full"
                  >
                    <Plus className="h-4 w-4 mr-2" />
                    Ajouter un objectif
                  </Button>
                </div>
              </div>

              {/* Durée */}
              <div className="grid grid-cols-2 gap-4">
                <FormField
                  control={form.control}
                  name="duree_jours"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Durée (jours)</FormLabel>
                      <FormControl>
                        <Input
                          type="number"
                          placeholder="Ex: 5"
                          {...field}
                          onChange={(e) => {
                            const value = e.target.value === "" ? "" : parseInt(e.target.value, 10);
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
                  name="duree_heures"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Durée (heures)</FormLabel>
                      <FormControl>
                        <Input
                          type="number"
                          placeholder="Ex: 35"
                          {...field}
                          onChange={(e) => {
                            const value = e.target.value === "" ? "" : parseInt(e.target.value, 10);
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

              {/* Prix */}
              <div className="grid grid-cols-2 gap-4">
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
                      <FormLabel>Prix TTC *</FormLabel>
                      <FormControl>
                        <Input
                          type="number"
                          step="0.01"
                          placeholder="Ex: 1200.00"
                          {...field}
                          onChange={(e) => field.onChange(parseFloat(e.target.value) || 0)}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              {/* Niveau */}
              <FormField
                control={form.control}
                name="niveau"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Niveau</FormLabel>
                    <Select
                      onValueChange={field.onChange}
                      value={field.value || ""}
                    >
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Sélectionner un niveau" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="Débutant">Débutant</SelectItem>
                        <SelectItem value="Intermédiaire">Intermédiaire</SelectItem>
                        <SelectItem value="Avancé">Avancé</SelectItem>
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {/* Certification */}
              <div className="grid grid-cols-2 gap-4">
                <FormField
                  control={form.control}
                  name="type_certification"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Type de certification</FormLabel>
                      <FormControl>
                        <Input placeholder="Ex: Attestation, Certificat, Diplôme" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="nom_certification"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Nom de la certification</FormLabel>
                      <FormControl>
                        <Input placeholder="Ex: Certificat Data Science" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              {/* Prérequis */}
              <FormField
                control={form.control}
                name="prerequis"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Prérequis</FormLabel>
                    <FormControl>
                      <Textarea
                        placeholder="Les prérequis nécessaires pour suivre cette formation..."
                        rows={3}
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {/* Public cible */}
              <FormField
                control={form.control}
                name="public_cible"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Public cible</FormLabel>
                    <FormControl>
                      <Textarea
                        placeholder="Le public visé par cette formation..."
                        rows={3}
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {/* Thèmes */}
              <div>
                <FormLabel>Thèmes / Catégories</FormLabel>
                <div className="space-y-2 mt-2">
                  {themes.map((theme, index) => (
                    <div key={index} className="flex gap-2">
                      <Input
                        placeholder="Thème ou catégorie"
                        value={theme}
                        onChange={(e) => updateTheme(index, e.target.value)}
                      />
                      {themes.length > 1 && (
                        <Button
                          type="button"
                          variant="outline"
                          size="icon"
                          onClick={() => removeTheme(index)}
                        >
                          <X className="h-4 w-4" />
                        </Button>
                      )}
                    </div>
                  ))}
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={addTheme}
                    className="w-full"
                  >
                    <Plus className="h-4 w-4 mr-2" />
                    Ajouter un thème
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Actions */}
          <div className="flex gap-3 justify-end">
            <Button type="button" variant="outline" onClick={handleCancel} disabled={isSubmitting}>
              Annuler
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Enregistrer les modifications
            </Button>
          </div>
        </form>
      </Form>

      {!sessionBasedCatalogue && (
        <Card className="shadow-lg mt-6 border-muted">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg">
              <FileVideo className="h-5 w-5" />
              Support pédagogique unique
            </CardTitle>
            <CardDescription>
              Un seul support (PDF ou vidéo) ou une vidéo Vimeo. L’envoi remplace le support existant pour
              cette formation.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {formation.catalogue_support && (
              <div className="rounded-md border bg-muted/50 p-3 text-sm space-y-2">
                <p className="font-medium text-foreground">Support actuellement enregistré</p>
                <p>
                  <span className="text-muted-foreground">Titre :</span>{" "}
                  {formation.catalogue_support.titre}
                </p>
                <p>
                  <span className="text-muted-foreground">Type :</span>{" "}
                  {formation.catalogue_support.type_fichier}
                  {formation.catalogue_support.video_provider === "vimeo" ? " (Vimeo)" : ""}
                </p>
                {formation.catalogue_support.description ? (
                  <p className="text-muted-foreground whitespace-pre-wrap">
                    {formation.catalogue_support.description}
                  </p>
                ) : null}
                {formation.catalogue_support.video_provider === "vimeo" ||
                /vimeo\.com/i.test(formation.catalogue_support.fichier_url || "") ? (
                  <p className="break-all">
                    <span className="text-muted-foreground">Lecture :</span>{" "}
                    <a
                      href={formation.catalogue_support.fichier_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-primary underline"
                    >
                      {formation.catalogue_support.fichier_url}
                    </a>
                  </p>
                ) : formation.catalogue_support.type_fichier === "PDF" ? (
                  <p className="text-muted-foreground">
                    Document PDF stocké sur le serveur. Choisissez un nouveau fichier ci-dessous pour le
                    remplacer.
                  </p>
                ) : (
                  <p className="text-muted-foreground">
                    Fichier vidéo stocké sur le serveur. Choisissez un nouveau fichier pour le remplacer.
                  </p>
                )}
              </div>
            )}

            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant={supportMode === "file" ? "default" : "outline"}
                size="sm"
                onClick={() => setSupportMode("file")}
                disabled={isUploadingSupport}
              >
                Fichier PDF / vidéo
              </Button>
              <Button
                type="button"
                variant={supportMode === "vimeo" ? "default" : "outline"}
                size="sm"
                onClick={() => setSupportMode("vimeo")}
                disabled={isUploadingSupport}
              >
                <Link2 className="h-4 w-4 mr-1 inline" />
                Lien Vimeo
              </Button>
            </div>

            {supportMode === "file" ? (
              <div className="space-y-2">
                <Label>Fichier</Label>
                <Input
                  type="file"
                  accept=".pdf,application/pdf,video/*"
                  disabled={isUploadingSupport}
                  onChange={(e) => setSupportFile(e.target.files?.[0] ?? null)}
                />
                <p className="text-xs text-muted-foreground">
                  PDF ou vidéo. Choisir un fichier puis « Enregistrer le support » remplace le support actuel.
                </p>
              </div>
            ) : (
              <div className="space-y-2">
                <Label>URL Vimeo</Label>
                <Input
                  type="url"
                  placeholder="https://vimeo.com/123456789"
                  value={vimeoUrl}
                  disabled={isUploadingSupport}
                  onChange={(e) => setVimeoUrl(e.target.value)}
                />
              </div>
            )}

            <div className="space-y-2">
              <Label>Titre du support (optionnel)</Label>
              <Input
                placeholder="Ex. : Cours complet"
                value={supportTitre}
                disabled={isUploadingSupport}
                onChange={(e) => setSupportTitre(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label>Description (optionnel)</Label>
              <Textarea
                rows={2}
                placeholder="Brève description pour les apprenants…"
                value={supportDescription}
                disabled={isUploadingSupport}
                onChange={(e) => setSupportDescription(e.target.value)}
              />
            </div>

            <div className="flex justify-end pt-2">
              <Button
                type="button"
                onClick={handleSupportSave}
                disabled={isUploadingSupport || (supportMode === "file" && !supportFile) || (supportMode === "vimeo" && !vimeoUrl.trim())}
              >
                {isUploadingSupport && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Enregistrer le support
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
