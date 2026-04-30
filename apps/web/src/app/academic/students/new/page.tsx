"use client";

import { useState, type ChangeEvent } from "react";
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
} from "@ecoledigitale/ui";
import DatePickerFr from "@/components/DatePickerFr";
import { ArrowLeft, Loader2, Save } from "lucide-react";
import { useCreateStudent } from "@/lib/hooks/use-students";
import { CI_SUBPREFECTURES } from "@/data/ci-subprefectures";

const generatePassword = (): string => {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*";
  let password = "";
  for (let i = 0; i < 12; i++) {
    password += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return password;
};

const studentFormSchema = z.object({
  firstName: z.string().min(1, "Le prénom est requis").max(100, "Le prénom ne peut pas dépasser 100 caractères"),
  lastName: z.string().min(1, "Le nom est requis").max(100, "Le nom ne peut pas dépasser 100 caractères"),
  email: z.string().min(1, "L'email est requis").email("Email invalide"),
  phone: z.string()
    .refine((val) => {
      if (!val) return true;
      const digits = val.replace(/\s/g, "");
      return digits.length === 10 && /^\d+$/.test(digits);
    }, "Le numéro doit contenir exactement 10 chiffres")
    .transform((val) => (val ? val.replace(/\s/g, "") : val))
    .optional()
    .or(z.literal("")),
  dateOfBirth: z.string().min(1, "La date de naissance est requise"),
  placeOfBirth: z.string().max(255, "Le lieu de naissance ne peut pas dépasser 255 caractères").optional().or(z.literal("")),
  nationality: z.string().min(1, "La nationalité est requise").max(100, "La nationalité ne peut pas dépasser 100 caractères"),
  address: z.string().optional().or(z.literal("")),
  gender: z.enum(["masculin", "feminin"], {
    required_error: "Le sexe est requis",
  }),
  birthCertificateNumber: z.string().max(100, "Le numéro d'extrait est trop long").optional().or(z.literal("")),
  birthCertificateDate: z.string().optional().or(z.literal("")),
  civilRegistryOffice: z.string().max(255, "Le bureau d'état civil est trop long").optional().or(z.literal("")),
  subPrefecture: z.string().min(1, "La sous-préfecture est requise"),
  residence: z.string().max(255, "La résidence est trop longue").optional().or(z.literal("")),
  dspsMatricule: z.string().max(100, "Le matricule DSPS est trop long").optional().or(z.literal("")),
  dspsPreviousMatricule: z.string().max(100, "Le matricule précédent DSPS est trop long").optional().or(z.literal("")),
});

type StudentFormData = z.infer<typeof studentFormSchema>;

const formatPhoneNumber = (value: string): string => {
  const digits = value.replace(/\D/g, "").slice(0, 10);

  if (digits.length <= 2) return digits;
  if (digits.length <= 4) return digits.replace(/(\d{2})(\d+)/, "$1 $2");
  if (digits.length <= 6) return digits.replace(/(\d{2})(\d{2})(\d+)/, "$1 $2 $3");
  if (digits.length <= 8) return digits.replace(/(\d{2})(\d{2})(\d{2})(\d+)/, "$1 $2 $3 $4");
  return digits.replace(/(\d{2})(\d{2})(\d{2})(\d{2})(\d+)/, "$1 $2 $3 $4 $5");
};

export default function NewStudentPage() {
  const router = useRouter();
  const createStudent = useCreateStudent();
  const [phoneValue, setPhoneValue] = useState("");

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
    setValue,
    watch,
  } = useForm<StudentFormData>({
    resolver: zodResolver(studentFormSchema),
    defaultValues: {
      nationality: "Ivoirienne",
    },
  });

  const genderValue = watch("gender");
  const subPrefectureValue = watch("subPrefecture");

  const handlePhoneChange = (e: ChangeEvent<HTMLInputElement>) => {
    const formatted = formatPhoneNumber(e.target.value);
    setPhoneValue(formatted);
    setValue("phone", formatted);
  };

  const onSubmit = async (data: StudentFormData) => {
    try {
      const studentData = {
        firstName: data.firstName,
        lastName: data.lastName,
        email: data.email,
        password: generatePassword(),
        currentYear: 1,
        status: "active" as const,
        dateOfBirth: data.dateOfBirth && data.dateOfBirth.trim() ? data.dateOfBirth : undefined,
        placeOfBirth: data.placeOfBirth && data.placeOfBirth.trim() ? data.placeOfBirth : undefined,
        nationality: data.nationality && data.nationality.trim() ? data.nationality : undefined,
        address: data.address && data.address.trim() ? data.address : undefined,
        phone: data.phone ? data.phone.replace(/\s/g, "") : undefined,
        gender: data.gender,
        birthCertificateNumber: data.birthCertificateNumber && data.birthCertificateNumber.trim() ? data.birthCertificateNumber : undefined,
        birthCertificateDate: data.birthCertificateDate && data.birthCertificateDate.trim() ? data.birthCertificateDate : undefined,
        civilRegistryOffice: data.civilRegistryOffice && data.civilRegistryOffice.trim() ? data.civilRegistryOffice : undefined,
        subPrefecture: data.subPrefecture,
        residence: data.residence && data.residence.trim() ? data.residence : undefined,
        dspsMatricule: data.dspsMatricule && data.dspsMatricule.trim() ? data.dspsMatricule : undefined,
        dspsPreviousMatricule: data.dspsPreviousMatricule && data.dspsPreviousMatricule.trim() ? data.dspsPreviousMatricule : undefined,
      };

      const createdStudent = await createStudent.mutateAsync(studentData);
      if (!createdStudent) {
        throw new Error("Création de l'étudiant échouée");
      }

      router.push("/academic/students");
    } catch (error) {
      console.error("Error creating student:", error);
      const message = error instanceof Error ? error.message : "Erreur lors de la création de l'étudiant.";
      if (message.includes("email already exists")) {
        const suggestedEmail = data.email.includes("@")
          ? data.email.replace("@", `+${Date.now().toString().slice(-4)}@`)
          : `${data.email}.${Date.now().toString().slice(-4)}@ecoledigitale.ci`;
        alert(`Cet email existe déjà.\n\nUtilisez un autre email, par exemple : ${suggestedEmail}`);
        return;
      }
      alert(message);
    }
  };

  return (
    <div className="container mx-auto px-6 py-8 max-w-4xl">
      <div className="flex items-center gap-4 mb-8">
        <Button variant="outline" size="sm" onClick={() => router.back()}>
          <ArrowLeft className="h-4 w-4 mr-2" />
          Retour
        </Button>
        <div>
          <h1 className="text-3xl font-bold bg-gradient-to-r from-blue-600 to-purple-600 bg-clip-text text-transparent">
            Nouvel étudiant
          </h1>
          <p className="text-muted-foreground mt-2">
            Créez le profil permanent d'un étudiant. L'inscription en classe se fera ensuite depuis le menu Année académique.
          </p>
        </div>
      </div>

      <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
        <Card className="border-blue-200 bg-blue-50/60">
          <CardContent className="pt-6">
            <p className="text-sm text-blue-900">
              La classe, la date d'inscription, la LV2, la bourse et les autres informations annuelles se gèrent désormais dans
              <span className="font-semibold"> Année académique &gt; Inscriptions</span>.
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Informations personnelles</CardTitle>
            <CardDescription>Informations de base sur l'étudiant</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="firstName">Prénom *</Label>
                <Input id="firstName" {...register("firstName")} placeholder="Prénom de l'étudiant" />
                {errors.firstName && <p className="text-sm text-red-600">{errors.firstName.message}</p>}
              </div>
              <div className="space-y-2">
                <Label htmlFor="lastName">Nom *</Label>
                <Input id="lastName" {...register("lastName")} placeholder="Nom de famille" />
                {errors.lastName && <p className="text-sm text-red-600">{errors.lastName.message}</p>}
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="email">Email *</Label>
                <Input id="email" type="email" {...register("email")} placeholder="email@exemple.com" />
                {errors.email && <p className="text-sm text-red-600">{errors.email.message}</p>}
              </div>
              <div className="space-y-2">
                <Label htmlFor="gender">Sexe *</Label>
                <Select onValueChange={(value) => setValue("gender", value as "masculin" | "feminin", { shouldValidate: true })} value={genderValue}>
                  <SelectTrigger>
                    <SelectValue placeholder="Sélectionner le sexe" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="masculin">Masculin</SelectItem>
                    <SelectItem value="feminin">Féminin</SelectItem>
                  </SelectContent>
                </Select>
                {errors.gender && <p className="text-sm text-red-600">{errors.gender.message}</p>}
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="nationality">Nationalité *</Label>
                <Input id="nationality" {...register("nationality")} placeholder="Ivoirienne" />
                {errors.nationality && <p className="text-sm text-red-600">{errors.nationality.message}</p>}
              </div>
              <div className="space-y-2">
                <Label htmlFor="phone">Téléphone</Label>
                <Input
                  id="phone"
                  value={phoneValue}
                  onChange={handlePhoneChange}
                  placeholder="07 07 12 34 56"
                  maxLength={14}
                />
                {errors.phone && <p className="text-sm text-red-600">{errors.phone.message}</p>}
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="dateOfBirth">Date de naissance *</Label>
                <DatePickerFr id="dateOfBirth" value={undefined} onChange={(iso) => setValue("dateOfBirth", iso)} />
                {errors.dateOfBirth && <p className="text-sm text-red-600">{errors.dateOfBirth.message}</p>}
              </div>
              <div className="space-y-2">
                <Label htmlFor="placeOfBirth">Lieu de naissance</Label>
                <Input id="placeOfBirth" {...register("placeOfBirth")} placeholder="Ville, Pays" />
                {errors.placeOfBirth && <p className="text-sm text-red-600">{errors.placeOfBirth.message}</p>}
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="address">Adresse</Label>
              <Textarea id="address" {...register("address")} placeholder="Adresse complète de l'étudiant" rows={3} />
              {errors.address && <p className="text-sm text-red-600">{errors.address.message}</p>}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Informations administratives</CardTitle>
            <CardDescription>Informations permanentes conservées sur la fiche étudiant</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="birthCertificateNumber">N° Extrait Naissance</Label>
                <Input id="birthCertificateNumber" {...register("birthCertificateNumber")} placeholder="Numéro d'extrait" />
                {errors.birthCertificateNumber && <p className="text-sm text-red-600">{errors.birthCertificateNumber.message}</p>}
              </div>
              <div className="space-y-2">
                <Label htmlFor="birthCertificateDate">Date Extrait Naissance</Label>
                <DatePickerFr id="birthCertificateDate" value={undefined} onChange={(iso) => setValue("birthCertificateDate", iso)} />
                {errors.birthCertificateDate && <p className="text-sm text-red-600">{errors.birthCertificateDate.message}</p>}
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="civilRegistryOffice">Bureau État Civil</Label>
                <Input id="civilRegistryOffice" {...register("civilRegistryOffice")} placeholder="Bureau d'état civil" />
                {errors.civilRegistryOffice && <p className="text-sm text-red-600">{errors.civilRegistryOffice.message}</p>}
              </div>
              <div className="space-y-2">
                <Label htmlFor="subPrefecture">Sous-préfecture *</Label>
                <Select value={subPrefectureValue || ""} onValueChange={(value) => setValue("subPrefecture", value, { shouldValidate: true })}>
                  <SelectTrigger>
                    <SelectValue placeholder="Sélectionner une sous-préfecture" />
                  </SelectTrigger>
                  <SelectContent side="bottom" sideOffset={4} position="item-aligned">
                    {CI_SUBPREFECTURES.map((sp) => (
                      <SelectItem key={sp} value={sp}>
                        {sp}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {errors.subPrefecture && <p className="text-sm text-red-600">{errors.subPrefecture.message}</p>}
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="residence">Résidence</Label>
                <Input id="residence" {...register("residence")} placeholder="Résidence" />
                {errors.residence && <p className="text-sm text-red-600">{errors.residence.message}</p>}
              </div>
              <div className="space-y-2">
                <Label htmlFor="dspsMatricule">Matricule DSPS</Label>
                <Input id="dspsMatricule" {...register("dspsMatricule")} placeholder="Matricule DSPS" />
                {errors.dspsMatricule && <p className="text-sm text-red-600">{errors.dspsMatricule.message}</p>}
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="dspsPreviousMatricule">Matr. prov. DSPS</Label>
              <Input id="dspsPreviousMatricule" {...register("dspsPreviousMatricule")} placeholder="Matricule précédent DSPS" />
              {errors.dspsPreviousMatricule && <p className="text-sm text-red-600">{errors.dspsPreviousMatricule.message}</p>}
            </div>
          </CardContent>
        </Card>

        <div className="flex justify-end gap-4">
          <Button type="button" variant="outline" onClick={() => router.back()} disabled={isSubmitting}>
            Annuler
          </Button>
          <Button
            type="submit"
            disabled={isSubmitting}
            className="bg-gradient-to-r from-blue-500 to-purple-600 hover:from-blue-600 hover:to-purple-700 text-white"
          >
            {isSubmitting ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Création...
              </>
            ) : (
              <>
                <Save className="h-4 w-4 mr-2" />
                Créer l'étudiant
              </>
            )}
          </Button>
        </div>
      </form>
    </div>
  );
}
