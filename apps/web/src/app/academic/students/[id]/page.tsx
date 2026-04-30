"use client";

import { useParams, useRouter } from "next/navigation";
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@ecoledigitale/ui";
import { ArrowLeft, Calendar, Edit, GraduationCap, MapPin, Phone, User } from "lucide-react";
import { useStudent } from "@/lib/hooks/use-students";

export default function StudentDetailPage() {
  const router = useRouter();
  const params = useParams();
  const studentId = params.id as string;
  const { data: student, isLoading, error } = useStudent(studentId);

  const textOrFallback = (value?: string | null) =>
    value && value.trim().length > 0 ? value : "—";

  const formatDateOrFallback = (value?: string | Date | null) => {
    if (!value) return "—";
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return String(value);
    return parsed.toLocaleDateString("fr-FR");
  };

  const boolOrFallback = (value?: boolean | null) => {
    if (typeof value !== "boolean") return "—";
    return value ? "Oui" : "Non";
  };

  if (isLoading) {
    return (
      <div className="container mx-auto px-6 py-8">
        <div className="flex items-center justify-center py-8">
          <div className="h-8 w-8 animate-spin rounded-full border-b-2 border-blue-600"></div>
        </div>
      </div>
    );
  }

  if (error || !student) {
    return (
      <div className="container mx-auto px-6 py-8">
        <Card>
          <CardContent className="pt-6">
            <p className="text-red-600">
              {error ? `Erreur: ${error.message}` : "Étudiant non trouvé"}
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const hasCurrentEnrollment =
    !!student.classId ||
    !!student.className ||
    !!student.programmeName ||
    !!student.academicYearId ||
    !!student.academicYearName ||
    !!student.inscriptionDate ||
    !!student.originSchool ||
    !!student.lv2 ||
    !!student.scholarshipLevel ||
    !!student.transferDecision ||
    !!student.affectationDecision ||
    !!student.cepeCode ||
    typeof student.isRepeating === "boolean" ||
    typeof student.isTransfer === "boolean" ||
    typeof student.isInscribed === "boolean";

  return (
    <div className="container mx-auto max-w-6xl px-6 py-8">
      <div className="mb-8 flex items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <Button variant="outline" size="sm" onClick={() => router.back()}>
            <ArrowLeft className="mr-2 h-4 w-4" />
            Retour
          </Button>
          <div>
            <h1 className="bg-gradient-to-r from-blue-600 to-purple-600 bg-clip-text text-3xl font-bold text-transparent">
              Profil étudiant
            </h1>
            <p className="mt-2 text-muted-foreground">
              Matricule: {student.studentNumber}
            </p>
          </div>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            onClick={() =>
              router.push(
                hasCurrentEnrollment
                  ? "/annee-academique/inscription"
                  : `/annee-academique/inscription/new?studentId=${studentId}`
              )
            }
          >
            <GraduationCap className="mr-2 h-4 w-4" />
            {hasCurrentEnrollment ? "Voir les inscriptions" : "Inscrire"}
          </Button>
          <Button
            onClick={() => router.push(`/academic/students/${studentId}/edit`)}
            className="bg-gradient-to-r from-blue-500 to-purple-600 text-white hover:from-blue-600 hover:to-purple-700"
          >
            <Edit className="mr-2 h-4 w-4" />
            Modifier
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <User className="h-5 w-5" />
                Informations personnelles
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <div>
                  <p className="text-sm font-medium text-muted-foreground">Prénom</p>
                  <p>{textOrFallback(student.user?.firstName)}</p>
                </div>
                <div>
                  <p className="text-sm font-medium text-muted-foreground">Nom</p>
                  <p>{textOrFallback(student.user?.lastName)}</p>
                </div>
              </div>
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <div>
                  <p className="text-sm font-medium text-muted-foreground">Email</p>
                  <p>{textOrFallback(student.user?.email)}</p>
                </div>
                <div>
                  <p className="text-sm font-medium text-muted-foreground">Sexe</p>
                  <p>{textOrFallback(student.gender)}</p>
                </div>
              </div>
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <div>
                  <p className="flex items-center gap-1 text-sm font-medium text-muted-foreground">
                    <Calendar className="h-4 w-4" />
                    Date de naissance
                  </p>
                  <p>{formatDateOrFallback(student.dateOfBirth)}</p>
                </div>
                <div>
                  <p className="flex items-center gap-1 text-sm font-medium text-muted-foreground">
                    <MapPin className="h-4 w-4" />
                    Lieu de naissance
                  </p>
                  <p>{textOrFallback(student.placeOfBirth)}</p>
                </div>
              </div>
              <div>
                <p className="text-sm font-medium text-muted-foreground">Nationalité</p>
                <p>{textOrFallback(student.nationality)}</p>
              </div>
              <div>
                <p className="text-sm font-medium text-muted-foreground">Adresse</p>
                <p className="whitespace-pre-line">{textOrFallback(student.address)}</p>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Phone className="h-5 w-5" />
                Informations de contact
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div>
                <p className="text-sm font-medium text-muted-foreground">Téléphone</p>
                <p className="font-mono">{textOrFallback(student.phone)}</p>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Identifiants scolaires</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <div>
                  <p className="text-sm font-medium text-muted-foreground">Matricule étudiant</p>
                  <p className="font-mono">{textOrFallback(student.studentNumber)}</p>
                </div>
                <div>
                  <p className="text-sm font-medium text-muted-foreground">Matricule établissement</p>
                  <p className="font-mono">{textOrFallback(student.establishmentMatricule)}</p>
                </div>
              </div>
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <div>
                  <p className="text-sm font-medium text-muted-foreground">Matricule DSPS</p>
                  <p>{textOrFallback(student.dspsMatricule)}</p>
                </div>
                <div>
                  <p className="text-sm font-medium text-muted-foreground">Matricule précédent DSPS</p>
                  <p>{textOrFallback(student.dspsPreviousMatricule)}</p>
                </div>
              </div>
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <div>
                  <p className="text-sm font-medium text-muted-foreground">Année de cursus</p>
                  <p>{student.currentYear}</p>
                </div>
                <div>
                  <p className="text-sm font-medium text-muted-foreground">Statut étudiant</p>
                  <p>{textOrFallback(student.status)}</p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Inscription actuelle</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {hasCurrentEnrollment ? (
                <>
                  <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                    <div>
                      <p className="text-sm font-medium text-muted-foreground">Année académique</p>
                      <p>{textOrFallback(student.academicYearName)}</p>
                    </div>
                    <div>
                      <p className="text-sm font-medium text-muted-foreground">Classe</p>
                      <p>{textOrFallback(student.className)}</p>
                    </div>
                    <div>
                      <p className="text-sm font-medium text-muted-foreground">Programme</p>
                      <p>{textOrFallback(student.programmeName)}</p>
                    </div>
                  </div>
                  <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                    <div>
                      <p className="text-sm font-medium text-muted-foreground">Date inscription</p>
                      <p>{formatDateOrFallback(student.inscriptionDate)}</p>
                    </div>
                    <div>
                      <p className="text-sm font-medium text-muted-foreground">Établissement d'origine</p>
                      <p>{textOrFallback(student.originSchool)}</p>
                    </div>
                    <div>
                      <p className="text-sm font-medium text-muted-foreground">LV2</p>
                      <p>{textOrFallback(student.lv2)}</p>
                    </div>
                  </div>
                  <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                    <div>
                      <p className="text-sm font-medium text-muted-foreground">Bourse</p>
                      <p>{textOrFallback(student.scholarshipLevel)}</p>
                    </div>
                    <div>
                      <p className="text-sm font-medium text-muted-foreground">Redoublé</p>
                      <p>{boolOrFallback(student.isRepeating)}</p>
                    </div>
                    <div>
                      <p className="text-sm font-medium text-muted-foreground">Inscrit</p>
                      <p>{boolOrFallback(student.isInscribed)}</p>
                    </div>
                  </div>
                  <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                    <div>
                      <p className="text-sm font-medium text-muted-foreground">Transfert</p>
                      <p>{boolOrFallback(student.isTransfer)}</p>
                    </div>
                    <div>
                      <p className="text-sm font-medium text-muted-foreground">Décision de transfert</p>
                      <p>{textOrFallback(student.transferDecision)}</p>
                    </div>
                  </div>
                  <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                    <div>
                      <p className="text-sm font-medium text-muted-foreground">Statut affectation</p>
                      <p>{textOrFallback(student.affectationStatus)}</p>
                    </div>
                    <div>
                      <p className="text-sm font-medium text-muted-foreground">Décision affectation</p>
                      <p>{textOrFallback(student.affectationDecision)}</p>
                    </div>
                  </div>
                  <div>
                    <p className="text-sm font-medium text-muted-foreground">CodeEP+N°TableCEPE</p>
                    <p>{textOrFallback(student.cepeCode)}</p>
                  </div>
                </>
              ) : (
                <div className="rounded-lg border border-dashed border-slate-300 p-4 text-sm text-muted-foreground">
                  Aucune inscription n&apos;est encore enregistrée pour cet étudiant. Utilisez le menu Année académique &gt;
                  Inscriptions pour l&apos;affecter à une classe.
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Informations administratives</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <div>
                  <p className="text-sm font-medium text-muted-foreground">Numéro d'extrait de naissance</p>
                  <p>{textOrFallback(student.birthCertificateNumber)}</p>
                </div>
                <div>
                  <p className="text-sm font-medium text-muted-foreground">Date d'extrait de naissance</p>
                  <p>{formatDateOrFallback(student.birthCertificateDate)}</p>
                </div>
              </div>
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <div>
                  <p className="text-sm font-medium text-muted-foreground">Bureau d'état civil</p>
                  <p>{textOrFallback(student.civilRegistryOffice)}</p>
                </div>
                <div>
                  <p className="text-sm font-medium text-muted-foreground">Sous-préfecture</p>
                  <p>{textOrFallback(student.subPrefecture)}</p>
                </div>
              </div>
              <div>
                <p className="text-sm font-medium text-muted-foreground">Résidence</p>
                <p>{textOrFallback(student.residence)}</p>
              </div>
            </CardContent>
          </Card>
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <GraduationCap className="h-5 w-5" />
                Situation académique
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <p className="text-sm font-medium text-muted-foreground">Statut étudiant</p>
                <Badge variant="outline" className="font-mono">
                  {textOrFallback(student.status)}
                </Badge>
              </div>
              <div>
                <p className="text-sm font-medium text-muted-foreground">Année académique visible</p>
                <p>{textOrFallback(student.academicYearName)}</p>
              </div>
              <div>
                <p className="text-sm font-medium text-muted-foreground">Classe visible</p>
                <p>{textOrFallback(student.className)}</p>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Informations système</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <p className="text-sm font-medium text-muted-foreground">Créé le</p>
                <p className="text-sm">{formatDateOrFallback(student.createdAt)}</p>
              </div>
              <div>
                <p className="text-sm font-medium text-muted-foreground">Modifié le</p>
                <p className="text-sm">{formatDateOrFallback(student.updatedAt)}</p>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
