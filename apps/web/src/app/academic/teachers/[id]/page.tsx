"use client";

import { useRouter, useParams } from "next/navigation";
import { 
  Card, 
  CardContent, 
  CardDescription, 
  CardHeader, 
  CardTitle, 
  Button,
  Badge,

} from "@ecoledigitale/ui";
import { Separator } from "@/components/ui/separator";
import { 
  ArrowLeft, 
  Edit, 
  Mail, 
  Phone, 
  Calendar, 
  Euro, 
  User, 
  Award, 
  BookOpen,
  Loader2,
  AlertCircle
} from "lucide-react";
import { useTeacher } from "@/lib/hooks/use-teachers";
import { ContractType, TeacherStatus } from "@ecoledigitale/contracts";
import { formatAmountFCFA } from "@/lib/utils";

const statusConfig: Record<TeacherStatus, { 
  label: string; 
  variant: "default" | "secondary" | "success" | "warning" | "destructive";
}> = {
  active: { label: "Actif", variant: "success" },
  inactive: { label: "Inactif", variant: "secondary" },
  suspended: { label: "Suspendu", variant: "destructive" },
};

const contractConfig: Record<ContractType, { 
  label: string; 
  variant: "default" | "secondary" | "outline";
}> = {
  permanent: { label: "CDI", variant: "default" },
  temporary: { label: "CDD", variant: "secondary" },
  freelance: { label: "Vacataire", variant: "outline" },
};

export default function TeacherDetailPage() {
  const router = useRouter();
  const params = useParams();
  const teacherId = params.id as string;
  
  const { data: teacher, isLoading, error } = useTeacher(teacherId);

  if (error) {
    return (
      <div className="container mx-auto px-6 py-8 max-w-4xl">
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <div className="text-center space-y-4">
              <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mx-auto">
                <AlertCircle className="h-8 w-8 text-red-600" />
              </div>
              <div>
                <h3 className="text-lg font-medium">Enseignant introuvable</h3>
                <p className="text-muted-foreground">
                  L'enseignant demandé n'existe pas ou vous n'avez pas les permissions pour le consulter.
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

  if (isLoading) {
    return (
      <div className="container mx-auto px-6 py-8 max-w-4xl">
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin" />
        </div>
      </div>
    );
  }

  if (!teacher) {
    return null;
  }

  const statusInfo = statusConfig[teacher.status];
  const contractInfo = contractConfig[teacher.contractType];

  return (
    <div className="container mx-auto px-6 py-8 max-w-4xl">
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div className="flex items-center gap-4">
          <Button
            variant="outline"
            size="sm"
            onClick={() => router.back()}
          >
            <ArrowLeft className="h-4 w-4 mr-2" />
            Retour
          </Button>
          <div>
            <h1 className="text-3xl font-bold bg-gradient-to-r from-purple-600 to-pink-600 bg-clip-text text-transparent">
              {teacher.firstName} {teacher.lastName}
            </h1>
            <p className="text-muted-foreground mt-2">
              Profil enseignant
            </p>
          </div>
        </div>
        <Button
          onClick={() => router.push(`/academic/teachers/${teacher.id}/edit`)}
          className="bg-gradient-to-r from-purple-500 to-pink-600 hover:from-purple-600 hover:to-pink-700 text-white"
        >
          <Edit className="h-4 w-4 mr-2" />
          Modifier
        </Button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Main Information */}
        <div className="lg:col-span-2 space-y-6">
          {/* Personal Information */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <User className="h-5 w-5" />
                Informations personnelles
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <p className="text-sm font-medium text-muted-foreground">Nom complet</p>
                  <p className="text-lg font-semibold">{teacher.firstName} {teacher.lastName}</p>
                </div>
                {teacher.employeeNumber && (
                  <div>
                    <p className="text-sm font-medium text-muted-foreground">Numéro d'employé</p>
                    <p className="text-lg">{teacher.employeeNumber}</p>
                  </div>
                )}
              </div>

              {(teacher.email || teacher.phone) && (
                <>
                  <Separator />
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {teacher.email && (
                      <div className="flex items-center gap-2">
                        <Mail className="h-4 w-4 text-muted-foreground" />
                        <div>
                          <p className="text-sm font-medium text-muted-foreground">Email</p>
                          <p className="text-sm">{teacher.email}</p>
                        </div>
                      </div>
                    )}
                    {teacher.phone && (
                      <div className="flex items-center gap-2">
                        <Phone className="h-4 w-4 text-muted-foreground" />
                        <div>
                          <p className="text-sm font-medium text-muted-foreground">Téléphone</p>
                          <p className="text-sm">{teacher.phone}</p>
                        </div>
                      </div>
                    )}
                  </div>
                </>
              )}
            </CardContent>
          </Card>

          {/* Academic Profile */}
          {(teacher.specialties?.length || teacher.qualifications?.length || teacher.bio) && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Award className="h-5 w-5" />
                  Profil académique
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {teacher.specialties && teacher.specialties.length > 0 && (
                  <div>
                    <p className="text-sm font-medium text-muted-foreground mb-2">Spécialités</p>
                    <div className="flex flex-wrap gap-2">
                      {teacher.specialties.map((specialty, index) => (
                        <Badge key={index} variant="secondary">
                          {specialty}
                        </Badge>
                      ))}
                    </div>
                  </div>
                )}

                {teacher.qualifications && teacher.qualifications.length > 0 && (
                  <div>
                    <p className="text-sm font-medium text-muted-foreground mb-2">Qualifications</p>
                    <div className="flex flex-wrap gap-2">
                      {teacher.qualifications.map((qualification, index) => (
                        <Badge key={index} variant="outline">
                          {qualification}
                        </Badge>
                      ))}
                    </div>
                  </div>
                )}

                {teacher.bio && (
                  <div>
                    <p className="text-sm font-medium text-muted-foreground mb-2">Biographie</p>
                    <p className="text-sm leading-relaxed">{teacher.bio}</p>
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {/* Courses Taught - Placeholder for future implementation */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <BookOpen className="h-5 w-5" />
                Cours enseignés
              </CardTitle>
              <CardDescription>
                Liste des cours actuellement assignés à cet enseignant
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="text-center py-8">
                <BookOpen className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
                <p className="text-muted-foreground">
                  La gestion des affectations de cours sera disponible prochainement
                </p>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Sidebar */}
        <div className="space-y-6">
          {/* Status Card */}
          <Card>
            <CardHeader>
              <CardTitle>Statut</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex flex-col gap-2">
                <Badge variant={statusInfo.variant} className="w-fit">
                  {statusInfo.label}
                </Badge>
                <Badge variant={contractInfo.variant} className="w-fit">
                  {contractInfo.label}
                </Badge>
              </div>
            </CardContent>
          </Card>

          {/* Employment Details */}
          <Card>
            <CardHeader>
              <CardTitle>Détails d'emploi</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {teacher.hireDate && (
                <div className="flex items-center gap-2">
                  <Calendar className="h-4 w-4 text-muted-foreground" />
                  <div>
                    <p className="text-sm font-medium text-muted-foreground">Date d'embauche</p>
                    <p className="text-sm">
                      {new Date(teacher.hireDate).toLocaleDateString('fr-FR')}
                    </p>
                  </div>
                </div>
              )}

              {teacher.hourlyRate && (
                <div className="flex items-center gap-2">
                  <Euro className="h-4 w-4 text-muted-foreground" />
                  <div>
                    <p className="text-sm font-medium text-muted-foreground">Taux horaire</p>
                    <p className="text-sm">{formatAmountFCFA(teacher.hourlyRate)}/heure</p>
                  </div>
                </div>
              )}

              <Separator />
              
              <div>
                <p className="text-sm font-medium text-muted-foreground">Créé le</p>
                <p className="text-sm">
                  {new Date(teacher.createdAt).toLocaleDateString('fr-FR')}
                </p>
              </div>
              
              <div>
                <p className="text-sm font-medium text-muted-foreground">Dernière modification</p>
                <p className="text-sm">
                  {new Date(teacher.updatedAt).toLocaleDateString('fr-FR')}
                </p>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
