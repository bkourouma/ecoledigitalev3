"use client";

import { useEffect } from "react";
import { useRouter, useParams } from "next/navigation";
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
} from "@ecoledigitale/ui";
import DatePickerFr from "@/components/DatePickerFr";
import { ArrowLeft, Save, Loader2, X } from "lucide-react";
import { UpdateStudentProfile, StudentStatus } from "@ecoledigitale/contracts";
import { useStudent, useUpdateStudent } from "@/lib/hooks/use-students";

// Form schema for updating student
const studentUpdateFormSchema = z.object({
  firstName: z.string().min(1, "Le prénom est requis").max(100, "Le prénom ne peut pas dépasser 100 caractères"),
  lastName: z.string().min(1, "Le nom est requis").max(100, "Le nom ne peut pas dépasser 100 caractères"),
  email: z.string().email("Email invalide").optional().or(z.literal("")),
  phone: z.string().max(20, "Le numéro de téléphone ne peut pas dépasser 20 caractères").optional().or(z.literal("")),
  studentNumber: z.string().min(1, "Le numéro étudiant est requis").max(50, "Le numéro étudiant ne peut pas dépasser 50 caractères"),
  // Matricule saisi par la scolarité, distinct du numéro séquentiel ci-dessus.
  studentMatricule: z
    .string()
    .min(1, "Le matricule est requis")
    .max(50, "Le matricule ne peut pas dépasser 50 caractères")
    .transform((val) => val.trim()),
  status: z.enum(["active", "graduated", "suspended", "dropped", "transfer"] as const),
  dateOfBirth: z.string().optional().or(z.literal("")),
  placeOfBirth: z.string().optional().or(z.literal("")),
  nationality: z.string().optional().or(z.literal("")),
  address: z.string().optional().or(z.literal("")),
  emergencyPhone: z.string().optional().or(z.literal("")),
  // errorMap plutôt que required_error : couvre d'un seul message la valeur
  // absente ET la valeur vide (`""`), qui produisait sinon le message brut de Zod
  // « Invalid enum value. Expected 'masculin' | 'feminin', received '' ».
  gender: z.enum(["masculin", "feminin"], {
    errorMap: () => ({ message: "Le sexe est requis" }),
  }),
});

/**
 * Ne retient que les deux valeurs valides. Toute autre entrée (`null` en base
 * pour les fiches anciennes, `undefined`, chaîne vide) renvoie `undefined` :
 * le champ reste sur son libellé d'invite et la scolarité doit choisir, plutôt
 * que de se voir attribuer « masculin » par défaut.
 */
const normalizeGender = (value: unknown): "masculin" | "feminin" | undefined =>
  value === "masculin" || value === "feminin" ? value : undefined;

type StudentUpdateFormData = z.infer<typeof studentUpdateFormSchema>;
type StudentUpdatePayload = UpdateStudentProfile & {
  firstName?: string;
  lastName?: string;
  email?: string;
};

export default function EditStudentPage() {
  const router = useRouter();
  const params = useParams();
  const studentId = params.id as string;
  
  const { data: student, isLoading: isLoadingStudent, error } = useStudent(studentId);
  const updateStudent = useUpdateStudent();
  const formatDateForInput = (value?: string | Date | null) => {
    if (!value) return "";
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return "";
    return parsed.toISOString().slice(0, 10);
  };

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
    setValue,
    watch,
    reset
  } = useForm<StudentUpdateFormData>({
    resolver: zodResolver(studentUpdateFormSchema),
    defaultValues: {
      status: "active"
    }
  });



  // Populate form when student data is loaded
  useEffect(() => {
    if (student && student.user) {
      reset({
        firstName: student.user.firstName,
        lastName: student.user.lastName,
        email: student.user.email || "",
        phone: student.phone || "",
        studentNumber: student.studentNumber,
        studentMatricule: (student as any).studentMatricule || "",
        status: student.status,
        dateOfBirth: formatDateForInput(student.dateOfBirth),
        placeOfBirth: student.placeOfBirth || "",
        nationality: student.nationality || "",
        address: student.address || "",
        emergencyPhone: student.emergencyPhone || "",
        gender: normalizeGender(student.gender),
      });
    }
  }, [student, reset]);



  const onSubmit = async (data: StudentUpdateFormData) => {
    try {
      const updateData: StudentUpdatePayload = {
        firstName: data.firstName,
        lastName: data.lastName,
        email: data.email || undefined,
        phone: data.phone || undefined,
        studentNumber: data.studentNumber,
        studentMatricule: data.studentMatricule,
        status: data.status,
        dateOfBirth: data.dateOfBirth || undefined,
        placeOfBirth: data.placeOfBirth || undefined,
        nationality: data.nationality || undefined,
        address: data.address || undefined,
        emergencyPhone: data.emergencyPhone || undefined,
        gender: data.gender,
      };

      await updateStudent.mutateAsync({ id: studentId, data: updateData });
      router.push("/academic/students");
    } catch (error) {
      console.error("Error updating student:", error);
      // Sans cela, un conflit de matricule ou d'email échouait silencieusement.
      alert(error instanceof Error ? error.message : "Erreur lors de la mise à jour de l'étudiant.");
    }
  };

  if (error) {
    return (
      <div className="container mx-auto px-6 py-8 max-w-4xl">
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <div className="text-center space-y-4">
              <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mx-auto">
                <X className="h-8 w-8 text-red-600" />
              </div>
              <div>
                <h3 className="text-lg font-medium">Étudiant introuvable</h3>
                <p className="text-muted-foreground">
                  L'étudiant demandé n'existe pas ou vous n'avez pas les permissions pour le modifier.
                </p>
              </div>
              <Button onClick={() => router.push("/academic/students")}>
                Retour à la liste
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (isLoadingStudent) {
    return (
      <div className="container mx-auto px-6 py-8 max-w-4xl">
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin" />
        </div>
      </div>
    );
  }

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
          <h1 className="whitespace-nowrap font-bold bg-gradient-to-r from-blue-600 to-green-600 bg-clip-text text-transparent text-2xl leading-tight md:text-3xl">
            Modifier l'étudiant
          </h1>
          <p className="whitespace-nowrap text-muted-foreground text-sm md:text-base">
            Modifiez les informations de {student?.user?.firstName} {student?.user?.lastName}
          </p>
        </div>
      </div>

      <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
        {/* Personal Information */}
        <Card>
          <CardHeader>
            <CardTitle>Informations personnelles</CardTitle>
            <CardDescription>
              Informations de base sur l'étudiant
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="firstName">Prénom *</Label>
                <Input
                  id="firstName"
                  {...register("firstName")}
                  placeholder="Prénom de l'étudiant"
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
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  type="email"
                  {...register("email")}
                  placeholder="email@exemple.com"
                />
                {errors.email && (
                  <p className="text-sm text-red-600">{errors.email.message}</p>
                )}
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
              <Label htmlFor="studentMatricule">Matricule *</Label>
              <Input
                id="studentMatricule"
                {...register("studentMatricule")}
                placeholder="Ex. ED-2026-001"
              />
              <p className="text-xs text-muted-foreground">
                Matricule propre à l&apos;établissement, saisi librement. Indépendant du numéro
                d&apos;établissement séquentiel ci-dessous.
              </p>
              {errors.studentMatricule && (
                <p className="text-sm text-red-600">{errors.studentMatricule.message}</p>
              )}
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="studentNumber">N° d&apos;établissement *</Label>
                <Input
                  id="studentNumber"
                  {...register("studentNumber")}
                  placeholder="10001"
                />
                <p className="text-xs text-muted-foreground">
                  Numérique sur 5 chiffres, attribué automatiquement.
                </p>
                {errors.studentNumber && (
                  <p className="text-sm text-red-600">{errors.studentNumber.message}</p>
                )}
              </div>
              <div className="space-y-2">
                <Label htmlFor="status">Statut *</Label>
                <Select
                  value={watch("status")}
                  onValueChange={(value: StudentStatus) => setValue("status", value)}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Sélectionner un statut" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="active">Actif</SelectItem>
                    <SelectItem value="graduated">Diplômé</SelectItem>
                    <SelectItem value="suspended">Suspendu</SelectItem>
                    <SelectItem value="dropped">Abandonné</SelectItem>
                    <SelectItem value="transfer">Transféré</SelectItem>
                  </SelectContent>
                </Select>
                {errors.status && (
                  <p className="text-sm text-red-600">{errors.status.message}</p>
                )}
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="gender">Sexe *</Label>
              <Select
                onValueChange={(value) => {
                  // Garde-fou : on n'écrit jamais une valeur hors des deux
                  // attendues dans l'état du formulaire.
                  const selected = normalizeGender(value);
                  if (selected) setValue("gender", selected, { shouldValidate: true });
                }}
                value={normalizeGender(watch("gender")) ?? ""}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Sélectionner le sexe" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="masculin">Masculin</SelectItem>
                  <SelectItem value="feminin">Féminin</SelectItem>
                </SelectContent>
              </Select>
              {!normalizeGender(watch("gender")) && !errors.gender && (
                <p className="text-xs text-muted-foreground">
                  Le sexe n&apos;est pas renseigné sur cette fiche : sélectionnez-le pour pouvoir enregistrer.
                </p>
              )}
              {errors.gender && (
                <p className="text-sm text-red-600">{errors.gender.message}</p>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Personal Details */}
        <Card>
          <CardHeader>
            <CardTitle>Détails personnels</CardTitle>
            <CardDescription>
              Informations détaillées sur l'étudiant
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="space-y-2">
                <Label htmlFor="dateOfBirth">Date de naissance</Label>
                <DatePickerFr
                  id="dateOfBirth"
                  value={watch("dateOfBirth")}
                  onChange={(iso) => setValue("dateOfBirth", iso)}
                />
                {errors.dateOfBirth && (
                  <p className="text-sm text-red-600">{errors.dateOfBirth.message}</p>
                )}
              </div>
              <div className="space-y-2">
                <Label htmlFor="placeOfBirth">Lieu de naissance</Label>
                <Input
                  id="placeOfBirth"
                  {...register("placeOfBirth")}
                  placeholder="Paris, France"
                />
                {errors.placeOfBirth && (
                  <p className="text-sm text-red-600">{errors.placeOfBirth.message}</p>
                )}
              </div>
              <div className="space-y-2">
                <Label htmlFor="nationality">Nationalité</Label>
                <Input
                  id="nationality"
                  {...register("nationality")}
                  placeholder="Française"
                />
                {errors.nationality && (
                  <p className="text-sm text-red-600">{errors.nationality.message}</p>
                )}
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="address">Adresse</Label>
              <Textarea
                id="address"
                {...register("address")}
                placeholder="Adresse complète de l'étudiant..."
                rows={3}
              />
              {errors.address && (
                <p className="text-sm text-red-600">{errors.address.message}</p>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Emergency Contact */}
        <Card>
          <CardHeader>
            <CardTitle>Contact d'urgence</CardTitle>
            <CardDescription>
              Numéro de téléphone d'urgence
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="emergencyPhone">Téléphone d'urgence</Label>
              <Input
                id="emergencyPhone"
                {...register("emergencyPhone")}
                placeholder="+225 07 07 12 34 56"
              />
              {errors.emergencyPhone && (
                <p className="text-sm text-red-600">{errors.emergencyPhone.message}</p>
              )}
            </div>
          </CardContent>
        </Card>

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
            disabled={isSubmitting}
            className="bg-gradient-to-r from-blue-500 to-green-600 hover:from-blue-600 hover:to-green-700 text-white"
          >
            {isSubmitting ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Mise à jour...
              </>
            ) : (
              <>
                <Save className="h-4 w-4 mr-2" />
                Sauvegarder
              </>
            )}
          </Button>
        </div>
      </form>
    </div>
  );
}
