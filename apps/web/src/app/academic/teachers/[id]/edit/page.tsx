"use client";

import { useState, useEffect } from "react";
import { useRouter, useParams } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { ArrowLeft, Save, Loader2, Plus, X } from "lucide-react";
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
  Badge
} from "@ecoledigitale/ui";
import DatePickerFr from "@/components/DatePickerFr";
import { UpdateTeacher, ContractType, TeacherStatus } from "@ecoledigitale/contracts";
import { useTeacher, useUpdateTeacher } from "@/lib/hooks/use-teachers";

// Form schema for updating teacher
const teacherUpdateFormSchema = z.object({
  firstName: z.string().min(1, "Le prénom est requis").max(100, "Le prénom ne peut pas dépasser 100 caractères"),
  lastName: z.string().min(1, "Le nom est requis").max(100, "Le nom ne peut pas dépasser 100 caractères"),
  email: z.string().email("Email invalide").optional().or(z.literal("")),
  phone: z.string().max(20, "Le numéro de téléphone ne peut pas dépasser 20 caractères").optional().or(z.literal("")),
  employeeNumber: z.string().max(20, "Le numéro d'employé ne peut pas dépasser 20 caractères").optional().or(z.literal("")),
  contractType: z.enum(["permanent", "temporary", "freelance"] as const),
  status: z.enum(["active", "inactive", "suspended"] as const),
  hireDate: z.string().optional().or(z.literal("")),
  bio: z.string().optional().or(z.literal("")),
  specialties: z.array(z.string()).default([]),
  qualifications: z.array(z.string()).default([]),
});

type TeacherUpdateFormData = z.infer<typeof teacherUpdateFormSchema>;

export default function EditTeacherPage() {
  const router = useRouter();
  const params = useParams();
  const teacherId = params.id as string;
  
  const { data: teacher, isLoading: isLoadingTeacher, error } = useTeacher(teacherId);
  const updateTeacher = useUpdateTeacher();
  
  const [newSpecialty, setNewSpecialty] = useState("");
  const [newQualification, setNewQualification] = useState("");

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
    setValue,
    watch,
    reset
  } = useForm<TeacherUpdateFormData>({
    resolver: zodResolver(teacherUpdateFormSchema),
    defaultValues: {
      specialties: [],
      qualifications: [],
      contractType: "permanent",
      status: "active"
    }
  });

  const specialties = watch("specialties");
  const qualifications = watch("qualifications");

  // Populate form when teacher data is loaded
  useEffect(() => {
    if (teacher) {
      reset({
        firstName: teacher.firstName,
        lastName: teacher.lastName,
        email: teacher.email || "",
        phone: teacher.phone || "",
        employeeNumber: teacher.employeeNumber || "",
        contractType: teacher.contractType,
        status: teacher.status,
        hireDate: teacher.hireDate ? teacher.hireDate.split('T')[0] : "", // Convert ISO string to YYYY-MM-DD
        bio: teacher.bio || "",
        specialties: teacher.specialties || [],
        qualifications: teacher.qualifications || [],
      });
    }
  }, [teacher, reset]);

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

  const onSubmit = async (data: TeacherUpdateFormData) => {
    try {
      const updateData: UpdateTeacher = {
        firstName: data.firstName,
        lastName: data.lastName,
        email: data.email || undefined,
        phone: data.phone || undefined,
        employeeNumber: data.employeeNumber || undefined,
        contractType: data.contractType,
        status: data.status,
        hireDate: data.hireDate || undefined, // Send as string (YYYY-MM-DD format)
        bio: data.bio || undefined,
        specialties: data.specialties.length > 0 ? data.specialties : undefined,
        qualifications: data.qualifications.length > 0 ? data.qualifications : undefined,
      };

      await updateTeacher.mutateAsync({ id: teacherId, data: updateData });
      router.push("/academic/teachers");
    } catch (error) {
      console.error("Error updating teacher:", error);
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
                <h3 className="text-lg font-medium">Enseignant introuvable</h3>
                <p className="text-muted-foreground">
                  L'enseignant demandé n'existe pas ou vous n'avez pas les permissions pour le modifier.
                </p>
              </div>
              <Button onClick={() => router.push("/academic/teachers")}>
                Retour à la liste
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (isLoadingTeacher) {
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
          <h1 className="whitespace-nowrap font-bold bg-gradient-to-r from-purple-600 to-pink-600 bg-clip-text text-transparent text-2xl leading-tight md:text-3xl">
            Modifier l'enseignant
          </h1>
          <p className="whitespace-nowrap text-muted-foreground text-sm md:text-base">
            Modifiez les informations de {teacher?.firstName} {teacher?.lastName}
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
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
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
                <Label htmlFor="status">Statut *</Label>
                <Select
                  value={watch("status")}
                  onValueChange={(value: TeacherStatus) => setValue("status", value)}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Sélectionner un statut" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="active">Actif</SelectItem>
                    <SelectItem value="inactive">Inactif</SelectItem>
                    <SelectItem value="suspended">Suspendu</SelectItem>
                  </SelectContent>
                </Select>
                {errors.status && (
                  <p className="text-sm text-red-600">{errors.status.message}</p>
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
            className="bg-gradient-to-r from-purple-500 to-pink-600 hover:from-purple-600 hover:to-pink-700 text-white"
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
