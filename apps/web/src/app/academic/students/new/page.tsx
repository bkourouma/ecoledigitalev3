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
import { FormMessage } from "@/components/ui/form-message";
import { ArrowLeft, Loader2, Save, Upload, FileText, X } from "lucide-react";
import { useCreateStudent, uploadStudentDiploma } from "@/lib/hooks/use-students";
import { CI_SUBPREFECTURES } from "@/data/ci-subprefectures";

const DIPLOMA_ACCEPT = "application/pdf,image/png,image/jpeg,image/webp";
const DIPLOMA_MAX_MB = 10;

const generatePassword = (): string => {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*";
  let password = "";
  for (let i = 0; i < 12; i++) {
    password += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return password;
};

/** Indicatif téléphonique de la Côte d'Ivoire. */
const CI_DIAL_CODE = "225";

/** Groupe les chiffres deux par deux : « 0707123456 » → « 07 07 12 34 56 ». */
const groupDigitPairs = (digits: string): string => digits.replace(/(\d{2})(?=\d)/g, "$1 ");

/**
 * Ne conserve que les 10 chiffres du numéro national, indicatif et séparateurs
 * retirés. « +225 07 07 12 34 56 », « 00225 07 07 12 34 56 » et
 * « 07 07 12 34 56 » donnent tous « 0707123456 ».
 *
 * L'indicatif n'est retiré que si le reste dépasse 10 chiffres : un numéro
 * national de 10 chiffres est donc rendu intact, même s'il commençait par 225.
 */
const toNationalDigits = (value: string): string => {
  const digits = value.replace(/\D/g, "");
  const withoutTrunkPrefix = digits.startsWith("00") ? digits.slice(2) : digits;

  return withoutTrunkPrefix.startsWith(CI_DIAL_CODE) && withoutTrunkPrefix.length > 10
    ? withoutTrunkPrefix.slice(CI_DIAL_CODE.length)
    : withoutTrunkPrefix;
};

/**
 * Formate le numéro au fil de la frappe. L'indicatif est facultatif : il n'est
 * conservé que si l'utilisateur le saisit (« + » de tête) ou colle un numéro
 * international (« 00225… »).
 */
const formatPhoneNumber = (value: string): string => {
  const raw = value.trimStart();
  const digits = raw.replace(/\D/g, "");
  const isInternational = raw.startsWith("+") || digits.startsWith("00");

  if (!isInternational) {
    return groupDigitPairs(digits.slice(0, 10));
  }

  const withoutTrunkPrefix = digits.startsWith("00") ? digits.slice(2) : digits;
  // Pendant la frappe l'indicatif est encore incomplet (« +2 », « +22 ») : on
  // l'accepte tant qu'il reste un préfixe possible de « 225 ». Un « + » posé
  // devant un numéro national déjà saisi ne doit pas, lui, transformer ses
  // premiers chiffres en indicatif.
  const looksLikeDialCode =
    withoutTrunkPrefix.startsWith(CI_DIAL_CODE) || CI_DIAL_CODE.startsWith(withoutTrunkPrefix);

  if (!looksLikeDialCode) {
    return groupDigitPairs(withoutTrunkPrefix.slice(0, 10));
  }

  const dialCode = withoutTrunkPrefix.slice(0, CI_DIAL_CODE.length);
  const national = groupDigitPairs(
    withoutTrunkPrefix.slice(CI_DIAL_CODE.length, CI_DIAL_CODE.length + 10)
  );

  return national ? `+${dialCode} ${national}` : `+${dialCode}`;
};

/** Longueur de « +225 07 07 12 34 56 », la forme la plus longue acceptée. */
const PHONE_MAX_LENGTH = 19;

const studentFormSchema = z.object({
  firstName: z.string().min(1, "Le prénom est requis").max(100, "Le prénom ne peut pas dépasser 100 caractères"),
  lastName: z.string().min(1, "Le nom est requis").max(100, "Le nom ne peut pas dépasser 100 caractères"),
  // Matricule saisi par la scolarité — distinct du matricule numérique
  // (10001, 10002, …) que l'API génère automatiquement à la création.
  studentMatricule: z
    .string()
    .min(1, "Le matricule est requis")
    .max(50, "Le matricule ne peut pas dépasser 50 caractères")
    .transform((val) => val.trim()),
  email: z.string().min(1, "L'email est requis").email("Email invalide"),
  phone: z.string()
    .min(1, "Le téléphone est requis")
    .refine(
      (val) => /^\d{10}$/.test(toNationalDigits(val)),
      "Le numéro doit contenir 10 chiffres (indicatif +225 facultatif)"
    )
    // L'indicatif éventuellement saisi est retiré avant l'envoi : la base ne
    // stocke que les 10 chiffres du numéro national, comme les fiches
    // existantes.
    .transform((val) => toNationalDigits(val)),
  dateOfBirth: z.string().min(1, "La date de naissance est requise"),
  placeOfBirth: z.string().min(1, "Le lieu de naissance est requis").max(255, "Le lieu de naissance ne peut pas dépasser 255 caractères"),
  nationality: z.string().min(1, "La nationalité est requise").max(100, "La nationalité ne peut pas dépasser 100 caractères"),
  address: z.string().optional().or(z.literal("")),
  // errorMap : couvre aussi la chaîne vide, que `required_error` laissait
  // remonter sous la forme du message brut de Zod.
  gender: z.enum(["masculin", "feminin"], {
    errorMap: () => ({ message: "Le sexe est requis" }),
  }),
  birthCertificateNumber: z.string().max(100, "Le numéro d'extrait est trop long").optional().or(z.literal("")),
  birthCertificateDate: z.string().optional().or(z.literal("")),
  civilRegistryOffice: z.string().max(255, "Le bureau d'état civil est trop long").optional().or(z.literal("")),
  subPrefecture: z.string().max(255, "La sous-préfecture est trop longue").optional().or(z.literal("")),
  residence: z.string().min(1, "La résidence est requise").max(255, "La résidence est trop longue"),
  dspsMatricule: z.string().max(100, "Le matricule DSPS est trop long").optional().or(z.literal("")),
  dspsPreviousMatricule: z.string().max(100, "Le matricule précédent DSPS est trop long").optional().or(z.literal("")),
  bacObtentionDate: z.string().min(1, "La date d'obtention du BAC est requise"),
  bacSeries: z.string().min(1, "La série du BAC est requise").max(100, "La série du BAC est trop longue"),
});

type StudentFormData = z.infer<typeof studentFormSchema>;

export default function NewStudentPage() {
  const router = useRouter();
  const createStudent = useCreateStudent();
  const [phoneValue, setPhoneValue] = useState("");
  const [diplomaFile, setDiplomaFile] = useState<File | null>(null);
  const [diplomaError, setDiplomaError] = useState<string | null>(null);
  // Erreurs affichées dans la page (et non dans une alerte du navigateur).
  const [formError, setFormError] = useState<string | null>(null);
  // Étudiant créé mais fichier non téléversé : on reste sur la page pour le dire,
  // sans proposer de recréer l'étudiant.
  const [uploadFailure, setUploadFailure] = useState<{ studentId: string; message: string } | null>(null);

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
    setValue("phone", formatted, { shouldValidate: true });
  };

  const handleDiplomaChange = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0] ?? null;
    if (!file) {
      setDiplomaFile(null);
      return;
    }
    const allowed = DIPLOMA_ACCEPT.split(",");
    if (!allowed.includes(file.type)) {
      setDiplomaError("Format non autorisé (PDF, PNG, JPG ou WEBP).");
      setDiplomaFile(null);
      return;
    }
    if (file.size > DIPLOMA_MAX_MB * 1024 * 1024) {
      setDiplomaError(`Le fichier ne doit pas dépasser ${DIPLOMA_MAX_MB} Mo.`);
      setDiplomaFile(null);
      return;
    }
    setDiplomaError(null);
    setDiplomaFile(file);
  };

  const onSubmit = async (data: StudentFormData) => {
    setFormError(null);
    if (!diplomaFile) {
      setDiplomaError("Le dernier diplôme (fichier) est requis.");
      return;
    }
    try {
      const studentData = {
        firstName: data.firstName,
        lastName: data.lastName,
        studentMatricule: data.studentMatricule,
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
        bacObtentionDate: data.bacObtentionDate && data.bacObtentionDate.trim() ? data.bacObtentionDate : undefined,
        bacSeries: data.bacSeries && data.bacSeries.trim() ? data.bacSeries : undefined,
      };

      const createdStudent = await createStudent.mutateAsync(studentData);
      if (!createdStudent) {
        throw new Error("Création de l'étudiant échouée");
      }

      // Upload du fichier du dernier diplôme (obligatoire).
      try {
        await uploadStudentDiploma((createdStudent as any).id, diplomaFile);
      } catch (uploadError) {
        console.error("Error uploading diploma:", uploadError);
        setUploadFailure({
          studentId: String((createdStudent as any).id),
          message:
            "L'étudiant a été créé, mais l'envoi du diplôme a échoué. Vous pourrez le réessayer depuis sa fiche." +
            (uploadError instanceof Error && uploadError.message ? `\n\n${uploadError.message}` : ""),
        });
        return;
      }

      router.push("/academic/students");
    } catch (error) {
      console.error("Error creating student:", error);
      const message = error instanceof Error ? error.message : "Erreur lors de la création de l'étudiant.";
      if (message.includes("email already exists")) {
        const suggestedEmail = data.email.includes("@")
          ? data.email.replace("@", `+${Date.now().toString().slice(-4)}@`)
          : `${data.email}.${Date.now().toString().slice(-4)}@ecoledigitale.ci`;
        setFormError(`Cet email existe déjà.\n\nUtilisez un autre email, par exemple : ${suggestedEmail}`);
        return;
      }
      setFormError(message);
    }
  };

  return (
    <div className="container mx-auto px-6 py-8 max-w-4xl">
      <div className="mb-6 flex max-w-full flex-col items-start gap-2 overflow-x-auto md:mb-8 md:gap-3">
        <Button variant="outline" size="sm" onClick={() => router.back()}>
          <ArrowLeft className="h-4 w-4 mr-2" />
          Retour
        </Button>
        <div>
          <h1 className="whitespace-nowrap font-bold bg-gradient-to-r from-blue-600 to-purple-600 bg-clip-text text-transparent text-2xl leading-tight md:text-3xl">
            Nouvel étudiant
          </h1>
        </div>
      </div>

      <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
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
                <Label htmlFor="studentMatricule">Matricule DESPS *</Label>
                <Input
                  id="studentMatricule"
                  {...register("studentMatricule")}
                  placeholder="04100146D"
                />
                {errors.studentMatricule && (
                  <p className="text-sm text-red-600">{errors.studentMatricule.message}</p>
                )}
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
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
              <div className="space-y-2">
                <Label htmlFor="dateOfBirth">Date de naissance *</Label>
                <Input id="dateOfBirth" type="date" {...register("dateOfBirth")} />
                {errors.dateOfBirth && <p className="text-sm text-red-600">{errors.dateOfBirth.message}</p>}
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="nationality">Nationalité *</Label>
                <Input id="nationality" {...register("nationality")} placeholder="Ivoirienne" />
                {errors.nationality && <p className="text-sm text-red-600">{errors.nationality.message}</p>}
              </div>
              <div className="space-y-2">
                <Label htmlFor="phone">Téléphone *</Label>
                <Input
                  id="phone"
                  value={phoneValue}
                  onChange={handlePhoneChange}
                  placeholder="+225 07 07 12 34 56"
                  maxLength={PHONE_MAX_LENGTH}
                />
                {errors.phone && <p className="text-sm text-red-600">{errors.phone.message}</p>}
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Informations complémentaires (origine, scolarité, diplômes) */}
        <Card>
          <CardHeader>
            <CardTitle>Informations complémentaires</CardTitle>
            <CardDescription>Origine, scolarité et diplômes de l'étudiant</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="placeOfBirth">Lieu de naissance *</Label>
                <Input id="placeOfBirth" {...register("placeOfBirth")} placeholder="Ville, Pays" />
                {errors.placeOfBirth && <p className="text-sm text-red-600">{errors.placeOfBirth.message}</p>}
              </div>
              <div className="space-y-2">
                <Label htmlFor="residence">Résidence *</Label>
                <Input id="residence" {...register("residence")} placeholder="Résidence actuelle" />
                {errors.residence && <p className="text-sm text-red-600">{errors.residence.message}</p>}
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="bacObtentionDate">Date d'obtention du BAC *</Label>
                <Input id="bacObtentionDate" type="date" {...register("bacObtentionDate")} />
                {errors.bacObtentionDate && <p className="text-sm text-red-600">{errors.bacObtentionDate.message}</p>}
              </div>
              <div className="space-y-2">
                <Label htmlFor="bacSeries">Série du BAC *</Label>
                <Input id="bacSeries" {...register("bacSeries")} placeholder="Ex. A, C, D, G2…" />
                {errors.bacSeries && <p className="text-sm text-red-600">{errors.bacSeries.message}</p>}
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="lastDiploma">Dernier diplôme obtenu (fichier) *</Label>
              {diplomaFile ? (
                <div className="flex items-center justify-between gap-3 rounded-md border border-input bg-muted/40 px-3 py-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <FileText className="h-4 w-4 shrink-0 text-purple-600" />
                    <span className="truncate text-sm">{diplomaFile.name}</span>
                    <span className="text-xs text-muted-foreground shrink-0">
                      ({(diplomaFile.size / (1024 * 1024)).toFixed(2)} Mo)
                    </span>
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => setDiplomaFile(null)}
                    className="shrink-0 text-red-500 hover:text-red-600"
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              ) : (
                <label
                  htmlFor="lastDiploma"
                  className="flex cursor-pointer items-center gap-2 rounded-md border border-dashed border-input px-3 py-2 text-sm text-muted-foreground hover:bg-muted/40"
                >
                  <Upload className="h-4 w-4" />
                  Choisir un fichier (PDF, PNG, JPG ou WEBP, max {DIPLOMA_MAX_MB} Mo)
                </label>
              )}
              <input
                id="lastDiploma"
                type="file"
                accept={DIPLOMA_ACCEPT}
                onChange={handleDiplomaChange}
                className="hidden"
              />
              {diplomaError && <p className="text-sm text-red-600">{diplomaError}</p>}
            </div>
          </CardContent>
        </Card>

        {/* Section masquée : conservée pour la structure du formulaire. */}
        <Card className="hidden">
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
                <Label htmlFor="dspsMatricule">Matricule DSPS</Label>
                <Input id="dspsMatricule" {...register("dspsMatricule")} placeholder="Matricule DSPS" />
                {errors.dspsMatricule && <p className="text-sm text-red-600">{errors.dspsMatricule.message}</p>}
              </div>
              <div className="space-y-2">
                <Label htmlFor="dspsPreviousMatricule">Matr. prov. DSPS</Label>
                <Input id="dspsPreviousMatricule" {...register("dspsPreviousMatricule")} placeholder="Matricule précédent DSPS" />
                {errors.dspsPreviousMatricule && <p className="text-sm text-red-600">{errors.dspsPreviousMatricule.message}</p>}
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="address">Adresse</Label>
              <Textarea id="address" {...register("address")} placeholder="Adresse complète de l'étudiant" rows={3} />
              {errors.address && <p className="text-sm text-red-600">{errors.address.message}</p>}
            </div>
          </CardContent>
        </Card>

        <FormMessage message={formError} />

        {uploadFailure && (
          <div className="space-y-3">
            <FormMessage message={uploadFailure.message} variant="warning" />
            <div className="flex justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => router.push(`/academic/students/${uploadFailure.studentId}`)}
              >
                Ouvrir la fiche de l'étudiant
              </Button>
              <Button type="button" variant="ghost" onClick={() => router.push("/academic/students")}>
                Retour à la liste
              </Button>
            </div>
          </div>
        )}

        <div className="flex justify-end gap-4">
          <Button type="button" variant="outline" onClick={() => router.back()} disabled={isSubmitting}>
            Annuler
          </Button>
          <Button
            type="submit"
            disabled={isSubmitting || uploadFailure !== null}
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
