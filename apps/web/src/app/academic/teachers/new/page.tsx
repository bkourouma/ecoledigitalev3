"use client";

import { useState } from "react";
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
  Textarea,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Badge,
  Alert,
  AlertTitle,
  AlertDescription
} from "@ecoledigitale/ui";
import DatePickerFr from "@/components/DatePickerFr";
import {
  ArrowLeft,
  Save,
  Loader2,
  Plus,
  X,
  Mail,
  AlertTriangle,
  Send,
} from "lucide-react";
import { CreateTeacher, ContractType } from "@ecoledigitale/contracts";
import { useCreateTeacher, useSendTeacherCredentials } from "@/lib/hooks/use-teachers";

/** Même logique que la création parent (`/academic/parents/new`) */
const generatePassword = (): string => {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*";
  let password = "";
  for (let i = 0; i < 12; i++) {
    password += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return password;
};

// Form schema based on CreateTeacher but with additional validation
const teacherFormSchema = z.object({
  firstName: z.string().min(1, "Le prénom est requis").max(100, "Le prénom ne peut pas dépasser 100 caractères"),
  lastName: z.string().min(1, "Le nom est requis").max(100, "Le nom ne peut pas dépasser 100 caractères"),
  email: z.string().email("Email invalide"),
  phone: z.string().max(20, "Le numéro de téléphone ne peut pas dépasser 20 caractères").optional().or(z.literal("")),
  employeeNumber: z.string().max(20, "Le numéro d'employé ne peut pas dépasser 20 caractères").optional().or(z.literal("")),
  contractType: z.enum(["permanent", "temporary", "freelance"] as const),
  hireDate: z.string().optional().or(z.literal("")),
  bio: z.string().optional().or(z.literal("")),
  specialties: z.array(z.string()).default([]),
  qualifications: z.array(z.string()).default([]),
});

type TeacherFormData = z.infer<typeof teacherFormSchema>;

type SubmitResult = {
  teacherId: string;
  email: string;
  emailSent: boolean;
  emailError?: string | null;
};

export default function NewTeacherPage() {
  const router = useRouter();
  const createTeacher = useCreateTeacher();
  const sendCredentials = useSendTeacherCredentials();
  const [newSpecialty, setNewSpecialty] = useState("");
  const [newQualification, setNewQualification] = useState("");

  // Les identifiants partent automatiquement avec le modèle d'email par défaut
  // de l'établissement : il n'y a plus de section pour le personnaliser ici.
  // Seul le compte rendu d'envoi subsiste, pour ne pas rater un échec SMTP.
  const [submitResult, setSubmitResult] = useState<SubmitResult | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
    setValue,
    watch,
    reset
  } = useForm<TeacherFormData>({
    resolver: zodResolver(teacherFormSchema),
    defaultValues: {
      specialties: [],
      qualifications: [],
      contractType: "permanent"
    }
  });

  const specialties = watch("specialties");
  const qualifications = watch("qualifications");

  const addSpecialty = () => {
    if (newSpecialty.trim() && !specialties.includes(newSpecialty.trim())) {
      setValue("specialties", [...specialties, newSpecialty.trim()]);
      setNewSpecialty("");
    }
  };

  const removeSpecialty = (index: number) => {
    setValue("specialties", specialties.filter((_, i) => i !== index));
  };

  const addQualification = () => {
    if (newQualification.trim() && !qualifications.includes(newQualification.trim())) {
      setValue("qualifications", [...qualifications, newQualification.trim()]);
      setNewQualification("");
    }
  };

  const removeQualification = (index: number) => {
    setValue("qualifications", qualifications.filter((_, i) => i !== index));
  };

  const onSubmit = async (data: TeacherFormData) => {
    setSubmitResult(null);
    try {
      const teacherData: CreateTeacher = {
        firstName: data.firstName,
        lastName: data.lastName,
        email: data.email.trim(),
        password: generatePassword(),
        phone: data.phone || undefined,
        employeeNumber: data.employeeNumber || undefined,
        contractType: data.contractType,
        hireDate: data.hireDate || undefined, // Send as string (YYYY-MM-DD format)
        bio: data.bio || undefined,
        specialties: data.specialties.length > 0 ? data.specialties : undefined,
        qualifications: data.qualifications.length > 0 ? data.qualifications : undefined,
        // Envoi systématique, avec le modèle par défaut de l'établissement.
        sendCredentialsEmail: true,
      };

      const created = await createTeacher.mutateAsync(teacherData);

      // L'enseignant est créé : un échec d'envoi ne doit pas ressembler à un
      // échec de création, on garde l'utilisateur sur la page pour réessayer.
      if (created.emailError) {
        setSubmitResult({
          teacherId: created.id,
          email: data.email.trim(),
          emailSent: false,
          emailError: created.emailError,
        });
        return;
      }

      router.push("/academic/teachers");
    } catch (error: any) {
      console.error("Error creating teacher:", error);
      alert(error?.message || "Erreur lors de la création de l'enseignant");
    }
  };

  const retrySendCredentials = async () => {
    if (!submitResult) return;
    try {
      await sendCredentials.mutateAsync({ teacherId: submitResult.teacherId });
      setSubmitResult({ ...submitResult, emailSent: true, emailError: null });
    } catch (error: any) {
      setSubmitResult({
        ...submitResult,
        emailSent: false,
        emailError: error?.message || "Échec de l'envoi",
      });
    }
  };

  return (
    <div className="container mx-auto px-6 py-8 max-w-4xl">
      {/* Header */}
      <div className="mb-6 flex max-w-full flex-col items-start gap-2 overflow-x-auto md:mb-8 md:gap-3">
        <Button
          variant="outline"
          size="sm"
          onClick={() => router.back()}
        >
          <ArrowLeft className="h-4 w-4 mr-2" />
          Retour
        </Button>
        <div>
          <h1 className="whitespace-nowrap font-bold bg-gradient-to-r from-purple-600 to-pink-600 bg-clip-text text-transparent text-2xl leading-tight md:text-3xl">
            Nouvel enseignant
          </h1>
          <p className="whitespace-nowrap text-muted-foreground text-sm md:text-base">
            Ajoutez un nouvel enseignant ou vacataire à votre équipe pédagogique
          </p>
        </div>
      </div>

      <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
        {/* Personal Information */}
        <Card>
          <CardHeader>
            <CardTitle>Informations personnelles</CardTitle>
            <CardDescription>
              Informations de base sur l'enseignant
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="firstName">Prénom *</Label>
                <Input
                  id="firstName"
                  {...register("firstName")}
                  placeholder="Prénom de l'enseignant"
                />
                {errors.firstName && (
                  <p className="text-sm text-red-600">{errors.firstName.message}</p>
                )}
              </div>
              <div className="space-y-2">
                <Label htmlFor="lastName">Nom *</Label>
                <Input
                  id="lastName"
                  {...register("lastName")}
                  placeholder="Nom de famille"
                />
                {errors.lastName && (
                  <p className="text-sm text-red-600">{errors.lastName.message}</p>
                )}
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="email">Email *</Label>
                <Input
                  id="email"
                  type="email"
                  {...register("email")}
                  placeholder="email@exemple.com"
                />
                {errors.email && (
                  <p className="text-sm text-red-600">{errors.email.message}</p>
                )}
                <p className="text-xs text-muted-foreground">
                  Un mot de passe de connexion est généré automatiquement à l’enregistrement (comme pour les parents).
                </p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="phone">Téléphone</Label>
                <Input
                  id="phone"
                  {...register("phone")}
                  placeholder="+225 07 07 12 34 56"
                />
                {errors.phone && (
                  <p className="text-sm text-red-600">{errors.phone.message}</p>
                )}
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="employeeNumber">Numéro d'employé</Label>
              <Input
                id="employeeNumber"
                {...register("employeeNumber")}
                placeholder="EMP001"
              />
              {errors.employeeNumber && (
                <p className="text-sm text-red-600">{errors.employeeNumber.message}</p>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Employment Information */}
        <Card>
          <CardHeader>
            <CardTitle>Informations d'emploi</CardTitle>
            <CardDescription>
              Détails du contrat et de l'emploi
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="space-y-2">
                <Label htmlFor="contractType">Type de contrat *</Label>
                <Select
                  value={watch("contractType")}
                  onValueChange={(value: ContractType) => setValue("contractType", value)}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Sélectionner un type" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="permanent">CDI (Permanent)</SelectItem>
                    <SelectItem value="temporary">CDD (Temporaire)</SelectItem>
                    <SelectItem value="freelance">Vacataire</SelectItem>
                  </SelectContent>
                </Select>
                {errors.contractType && (
                  <p className="text-sm text-red-600">{errors.contractType.message}</p>
                )}
              </div>
              <div className="space-y-2">
                <Label htmlFor="hireDate">Date d'embauche</Label>
                <DatePickerFr
                  id="hireDate"
                  value={watch("hireDate")}
                  onChange={(iso) => setValue("hireDate", iso)}
                />
                {errors.hireDate && (
                  <p className="text-sm text-red-600">{errors.hireDate.message}</p>
                )}
              </div>

            </div>
          </CardContent>
        </Card>

        {/* Academic Profile */}
        <Card>
          <CardHeader>
            <CardTitle>Profil académique</CardTitle>
            <CardDescription>
              Spécialités, qualifications et informations académiques
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Specialties */}
            <div className="space-y-2">
              <Label>Spécialités</Label>
              <div className="flex gap-2">
                <Input
                  value={newSpecialty}
                  onChange={(e) => setNewSpecialty(e.target.value)}
                  placeholder="Ajouter une spécialité (ex: Mathématiques, Informatique...)"
                  onKeyPress={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      addSpecialty();
                    }
                  }}
                />
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={addSpecialty}
                >
                  <Plus className="h-4 w-4" />
                </Button>
              </div>
              {specialties.length > 0 && (
                <div className="flex flex-wrap gap-2 mt-2">
                  {specialties.map((specialty, index) => (
                    <Badge key={index} variant="secondary" className="flex items-center gap-1">
                      {specialty}
                      <button
                        type="button"
                        onClick={() => removeSpecialty(index)}
                        className="ml-1 hover:text-red-600"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </Badge>
                  ))}
                </div>
              )}
            </div>

            {/* Qualifications */}
            <div className="space-y-2">
              <Label>Qualifications</Label>
              <div className="flex gap-2">
                <Input
                  value={newQualification}
                  onChange={(e) => setNewQualification(e.target.value)}
                  placeholder="Ajouter une qualification (ex: Master en Informatique, PhD...)"
                  onKeyPress={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      addQualification();
                    }
                  }}
                />
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={addQualification}
                >
                  <Plus className="h-4 w-4" />
                </Button>
              </div>
              {qualifications.length > 0 && (
                <div className="flex flex-wrap gap-2 mt-2">
                  {qualifications.map((qualification, index) => (
                    <Badge key={index} variant="outline" className="flex items-center gap-1">
                      {qualification}
                      <button
                        type="button"
                        onClick={() => removeQualification(index)}
                        className="ml-1 hover:text-red-600"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </Badge>
                  ))}
                </div>
              )}
            </div>

            {/* Bio */}
            <div className="space-y-2">
              <Label htmlFor="bio">Biographie / Présentation</Label>
              <Textarea
                id="bio"
                {...register("bio")}
                placeholder="Décrivez l'expérience, les compétences et le parcours de l'enseignant..."
                rows={4}
              />
              {errors.bio && (
                <p className="text-sm text-red-600">{errors.bio.message}</p>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Compte rendu de l'envoi des identifiants (aucune saisie ici : l'email
            part automatiquement avec le modèle par défaut de l'établissement). */}
        {submitResult && (
          <div className="space-y-4">
            {!submitResult.emailSent && (
              <Alert variant="destructive">
                <AlertTriangle className="h-4 w-4" />
                <AlertTitle>Enseignant créé, mais l'email n'est pas parti</AlertTitle>
                <AlertDescription className="space-y-3">
                  <p className="text-sm">{submitResult.emailError}</p>
                  <div className="flex gap-2">
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={retrySendCredentials}
                      disabled={sendCredentials.isPending}
                    >
                      {sendCredentials.isPending ? (
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      ) : (
                        <Send className="h-4 w-4 mr-2" />
                      )}
                      Réessayer l'envoi
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      onClick={() => router.push("/academic/teachers")}
                    >
                      Continuer sans envoyer
                    </Button>
                  </div>
                </AlertDescription>
              </Alert>
            )}

            {submitResult.emailSent && (
              <Alert>
                <Mail className="h-4 w-4" />
                <AlertTitle>Identifiants envoyés à {submitResult.email}</AlertTitle>
                <AlertDescription>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="mt-2"
                    onClick={() => router.push("/academic/teachers")}
                  >
                    Retour à la liste
                  </Button>
                </AlertDescription>
              </Alert>
            )}
          </div>
        )}

        {/* Action Buttons */}
        <div className="flex justify-end gap-4">
          <Button
            type="button"
            variant="outline"
            onClick={() => router.back()}
            disabled={isSubmitting}
          >
            Annuler
          </Button>
          <Button
            type="submit"
            disabled={isSubmitting || createTeacher.isPending}
            className="bg-gradient-to-r from-purple-500 to-pink-600 hover:from-purple-600 hover:to-pink-700 text-white"
          >
            {isSubmitting || createTeacher.isPending ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Création...
              </>
            ) : (
              <>
                <Save className="h-4 w-4 mr-2" />
                Créer l'enseignant
              </>
            )}
          </Button>
        </div>
      </form>
    </div>
  );
}
