"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
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
import { ArrowLeft, Loader2, Plus, X, FileVideo, Link2 } from "lucide-react";
import toast from "react-hot-toast";
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
  niveau: z.enum(["Débutant", "Intermédiaire", "Avancé"]).optional(),
  carriere: z.string().optional(),
}).refine((data) => {
  // Au moins une durée doit être renseignée
  return (data.duree_jours && data.duree_jours > 0) || (data.duree_heures && data.duree_heures > 0);
}, {
  message: "Au moins une durée (jours ou heures) doit être renseignée",
  path: ["duree_jours"],
});

type FormationFormData = z.infer<typeof formationFormSchema>;

export default function NewFormationPage() {
  const router = useRouter();
  const { data: session } = useSession();
  const tenantId = (session as { tenantId?: string } | null)?.tenantId;
  const sessionBasedCatalogue = usesSessionBasedProfessionalCatalogue(tenantId);

  const [isLoading, setIsLoading] = useState(false);
  const [objectifs, setObjectifs] = useState<string[]>([""]);
  const [themes, setThemes] = useState<string[]>([""]);

  const [supportMode, setSupportMode] = useState<"file" | "vimeo">("file");
  const [supportFile, setSupportFile] = useState<File | null>(null);
  const [supportTitre, setSupportTitre] = useState("");
  const [supportDescription, setSupportDescription] = useState("");
  const [vimeoUrl, setVimeoUrl] = useState("");

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

  const handleCancel = () => {
    router.push("/formations-professionnelles/catalogue");
  };

  const addObjectif = () => {
    setObjectifs([...objectifs, ""]);
  };

  const removeObjectif = (index: number) => {
    const newObjectifs = objectifs.filter((_, i) => i !== index);
    setObjectifs(newObjectifs);
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
    setThemes(newThemes);
    form.setValue("themes", newThemes.filter(t => t.trim() !== ""));
  };

  const updateTheme = (index: number, value: string) => {
    const newThemes = [...themes];
    newThemes[index] = value;
    setThemes(newThemes);
    form.setValue("themes", newThemes.filter(t => t.trim() !== ""));
  };

  const onSubmit = async (data: FormationFormData) => {
    if (!sessionBasedCatalogue) {
      if (supportMode === "file" && !supportFile) {
        toast.error("Ajoutez un fichier PDF ou vidéo pour le support pédagogique.");
        return;
      }
      if (supportMode === "vimeo" && !vimeoUrl.trim()) {
        toast.error("Indiquez l’URL de la vidéo Vimeo.");
        return;
      }
    }

    setIsLoading(true);
    try {
      const payload = {
        ...data,
        duree_jours: data.duree_jours === "" ? null : data.duree_jours,
        duree_heures: data.duree_heures === "" ? null : data.duree_heures,
        prix_ht: data.prix_ht === "" ? null : data.prix_ht,
        objectifs: data.objectifs.filter((o) => o.trim() !== ""),
        themes: data.themes.filter((t) => t.trim() !== ""),
      };

      const response = await fetch("/api/v1/formations-pro", {
        method: "POST",
        headers: {
          ...createApiHeaders(),
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        throw new Error(error.message || error.error || "Erreur lors de la création de la formation");
      }

      const result = await response.json();
      const formationId = result?.data?.id as string | undefined;
      const slug = result?.data?.slug as string | undefined;

      if (!sessionBasedCatalogue && formationId) {
        const fd = new FormData();
        const titre =
          supportTitre.trim() ||
          data.titre ||
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

        const uploadRes = await fetch(
          `/api/v1/formations-pro/${formationId}/catalogue-support`,
          {
            method: "POST",
            body: fd,
          }
        );

        if (!uploadRes.ok) {
          const err = await uploadRes.json().catch(() => ({}));
          throw new Error(
            err.message ||
              err.error ||
              "La formation a été créée mais l’upload du support a échoué. Complétez-le depuis la fiche formation."
          );
        }
      }

      toast.success(
        sessionBasedCatalogue
          ? "Formation créée. Vous pouvez planifier les sessions depuis la fiche."
          : "Formation et support enregistrés. Les invités peuvent s’inscrire en achetant la formation."
      );
      if (slug) {
        router.push(`/formations-professionnelles/catalogue/${slug}`);
      }
    } catch (error: unknown) {
      console.error("Error creating formation:", error);
      const message = error instanceof Error ? error.message : "Erreur lors de la création";
      toast.error(message);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="container mx-auto px-4 py-8 max-w-4xl w-full overflow-x-hidden min-w-0">
      {/* Header */}
      <div className="mb-6 flex max-w-full flex-col items-start gap-2 overflow-x-auto md:mb-8 md:gap-3">
        <Button variant="outline" size="sm" onClick={handleCancel} className="shrink-0">
          <ArrowLeft className="h-4 w-4 mr-2" />
          Retour
        </Button>
        <div className="min-w-0 flex-1">
          <h1 className="whitespace-nowrap font-bold bg-gradient-to-r from-blue-600 to-purple-600 bg-clip-text text-transparent text-2xl leading-tight md:text-3xl">
            Nouvelle formation
          </h1>
          <p className="whitespace-nowrap text-muted-foreground text-sm md:text-base">
            Créez une nouvelle formation professionnelle
          </p>
        </div>
      </div>

      <Card className="mb-6 border-primary/20 bg-primary/5">
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Parcours catalogue</CardTitle>
          <CardDescription className="text-sm leading-relaxed">
            1) Saisissez les informations de la formation (ci-dessous).{" "}
            {!sessionBasedCatalogue && (
              <>
                2) Ajoutez <strong>un seul</strong> support pédagogique — fichier <strong>PDF</strong> ou{" "}
                <strong>vidéo</strong> (fichier ou lien Vimeo). 3) Après enregistrement, les invités peuvent{" "}
                s&apos;inscrire en achetant la formation (parcours public / inscription catalogue).
              </>
            )}
            {sessionBasedCatalogue && (
              <>Les sessions se planifient ensuite depuis la fiche de la formation (tenant sessions).</>
            )}
          </CardDescription>
        </CardHeader>
      </Card>

      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6 w-full min-w-0">
          <Card className="shadow-lg w-full">
            <CardHeader>
              <CardTitle>Informations de la formation</CardTitle>
              <CardDescription>
                Remplissez les informations pour créer une nouvelle formation professionnelle
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6 w-full min-w-0">
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
              <div className="w-full min-w-0">
                <FormLabel>Objectifs pédagogiques</FormLabel>
                <div className="space-y-2 mt-2 w-full min-w-0">
                  {objectifs.map((objectif, index) => (
                    <div key={index} className="flex gap-2 w-full min-w-0">
                      <Input
                        placeholder="Objectif d'apprentissage"
                        value={objectif}
                        onChange={(e) => updateObjectif(index, e.target.value)}
                        className="min-w-0 flex-1"
                      />
                      {objectifs.length > 1 && (
                        <Button
                          type="button"
                          variant="outline"
                          size="icon"
                          onClick={() => removeObjectif(index)}
                          className="shrink-0"
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
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 w-full min-w-0">
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
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 w-full min-w-0">
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
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 w-full min-w-0">
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
              <div className="w-full min-w-0">
                <FormLabel>Thèmes / Catégories</FormLabel>
                <div className="space-y-2 mt-2 w-full min-w-0">
                  {themes.map((theme, index) => (
                    <div key={index} className="flex gap-2 w-full min-w-0">
                      <Input
                        placeholder="Thème ou catégorie"
                        value={theme}
                        onChange={(e) => updateTheme(index, e.target.value)}
                        className="min-w-0 flex-1"
                      />
                      {themes.length > 1 && (
                        <Button
                          type="button"
                          variant="outline"
                          size="icon"
                          onClick={() => removeTheme(index)}
                          className="shrink-0"
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

          {!sessionBasedCatalogue && (
            <Card className="shadow-lg w-full border-muted">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-lg">
                  <FileVideo className="h-5 w-5" />
                  Support pédagogique unique
                </CardTitle>
                <CardDescription>
                  Un seul fichier (PDF ou vidéo) ou une vidéo hébergée sur Vimeo. Il sera visible aux
                  apprenants après achat.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    variant={supportMode === "file" ? "default" : "outline"}
                    size="sm"
                    onClick={() => setSupportMode("file")}
                  >
                    Fichier PDF / vidéo
                  </Button>
                  <Button
                    type="button"
                    variant={supportMode === "vimeo" ? "default" : "outline"}
                    size="sm"
                    onClick={() => setSupportMode("vimeo")}
                  >
                    <Link2 className="h-4 w-4 mr-1 inline" />
                    Lien Vimeo
                  </Button>
                </div>

                {supportMode === "file" ? (
                  <div className="space-y-2">
                    <FormLabel>Fichier *</FormLabel>
                    <Input
                      type="file"
                      accept=".pdf,application/pdf,video/*"
                      onChange={(e) => setSupportFile(e.target.files?.[0] ?? null)}
                    />
                    <p className="text-xs text-muted-foreground">
                      PDF ou vidéo (MP4, WebM, etc.). Taille max selon configuration serveur (souvent 100 Mo
                      hors vidéo très longue).
                    </p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    <FormLabel>URL Vimeo *</FormLabel>
                    <Input
                      type="url"
                      placeholder="https://vimeo.com/123456789"
                      value={vimeoUrl}
                      onChange={(e) => setVimeoUrl(e.target.value)}
                    />
                  </div>
                )}

                <div className="space-y-2">
                  <FormLabel>Titre du support (optionnel)</FormLabel>
                  <Input
                    placeholder="Ex : Cours complet — module unique"
                    value={supportTitre}
                    onChange={(e) => setSupportTitre(e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <FormLabel>Description du support (optionnel)</FormLabel>
                  <Textarea
                    rows={2}
                    placeholder="Brève description pour les apprenants…"
                    value={supportDescription}
                    onChange={(e) => setSupportDescription(e.target.value)}
                  />
                </div>
              </CardContent>
            </Card>
          )}

          {/* Actions */}
          <div className="flex flex-col sm:flex-row gap-3 justify-end w-full min-w-0">
            <Button type="button" variant="outline" onClick={handleCancel} disabled={isLoading} className="w-full sm:w-auto">
              Annuler
            </Button>
            <Button type="submit" disabled={isLoading} className="w-full sm:w-auto">
              {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {sessionBasedCatalogue ? "Créer la formation" : "Créer la formation et le support"}
            </Button>
          </div>
        </form>
      </Form>
    </div>
  );
}
