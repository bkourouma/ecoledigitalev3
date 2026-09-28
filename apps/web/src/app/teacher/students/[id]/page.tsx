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
import { ArrowLeft, User, GraduationCap, BookOpen, Award, TrendingUp, Mail, Phone, MapPin, Calendar } from "lucide-react";
import { useStudent } from "@/lib/hooks/use-students";
import { StudentStatus } from "@ecoledigitale/contracts";

export default function TeacherStudentDetailPage() {
  const router = useRouter();
  const params = useParams();
  const studentId = params.id as string;
  const { data: student, isLoading, error } = useStudent(studentId);

  const getStatusBadge = (status: StudentStatus) => {
    const statusConfig = {
      active: { label: "Actif", variant: "default" as const, className: "bg-green-100 text-green-800" },
      graduated: { label: "Diplômé", variant: "secondary" as const, className: "bg-blue-100 text-blue-800" },
      suspended: { label: "Suspendu", variant: "destructive" as const, className: "bg-red-100 text-red-800" },
      dropped: { label: "Abandonné", variant: "outline" as const, className: "bg-gray-100 text-gray-800" },
      transfer: { label: "Transféré", variant: "outline" as const, className: "bg-yellow-100 text-yellow-800" },
    };

    const config = statusConfig[status] || statusConfig.active;

    return (
      <Badge variant={config.variant} className={`flex items-center gap-1 ${config.className}`}>
        {config.label}
      </Badge>
    );
  };

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-32 w-32 border-b-2 border-purple-500"></div>
      </div>
    );
  }

  if (error || !student) {
    return (
      <div className="mb-6 flex max-w-full flex-col items-start gap-2 overflow-x-auto md:gap-3">
        <div className="text-center">
          <h1 className="font-bold text-foreground mb-2 whitespace-nowrap text-2xl leading-tight md:text-3xl">Étudiant non trouvé</h1>
          <p className="text-muted-foreground mb-4 whitespace-nowrap text-sm md:text-base">L'étudiant demandé n'existe pas ou vous n'y avez pas accès.</p>
          <Button onClick={() => router.push('/teacher/students')}>
            <ArrowLeft className="w-4 h-4 mr-2" />
            Retour aux étudiants
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Header */}
        <div className="mb-6 flex max-w-full flex-col items-start gap-2 overflow-x-auto md:mb-8 md:gap-3">
          <Button
            variant="outline"
            onClick={() => router.push('/teacher/students')}
            className="flex items-center gap-2"
          >
            <ArrowLeft className="w-4 h-4" />
            Retour
          </Button>
          <div className="flex-1">
            <div className="flex items-center gap-3 mb-2">
              <h1 className="whitespace-nowrap font-bold text-foreground text-2xl leading-tight md:text-3xl">
                {student.user?.firstName} {student.user?.lastName}
              </h1>
              {getStatusBadge(student.status)}
            </div>
            <p className="whitespace-nowrap text-muted-foreground text-sm md:text-base">Matricule: {student.studentNumber}</p>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          {/* Main Content */}
          <div className="lg:col-span-2 space-y-6">
            {/* Personal Information */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-foreground">
                  <User className="w-5 h-5 text-purple-400" />
                  Informations personnelles
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="text-sm font-medium text-muted-foreground">Matricule</label>
                    <p className="text-lg font-semibold text-foreground">{student.studentNumber}</p>
                  </div>
                  {student.currentYear && (
                    <div>
                      <label className="text-sm font-medium text-muted-foreground">Année académique</label>
                      <p className="text-lg font-semibold text-foreground">Année {student.currentYear}</p>
                    </div>
                  )}
                </div>

                {student.user?.email && (
                  <div>
                    <label className="text-sm font-medium text-muted-foreground flex items-center gap-1">
                      <Mail className="w-4 h-4" />
                      Email
                    </label>
                    <p className="text-sm text-foreground">{student.user.email}</p>
                  </div>
                )}

                {student.user?.phone && (
                  <div>
                    <label className="text-sm font-medium text-muted-foreground flex items-center gap-1">
                      <Phone className="w-4 h-4" />
                      Téléphone
                    </label>
                    <p className="text-sm text-foreground">{student.user.phone}</p>
                  </div>
                )}

                {student.dateOfBirth && (
                  <div>
                    <label className="text-sm font-medium text-muted-foreground flex items-center gap-1">
                      <Calendar className="w-4 h-4" />
                      Date de naissance
                    </label>
                    <p className="text-sm text-foreground">
                      {new Date(student.dateOfBirth).toLocaleDateString('fr-FR')}
                    </p>
                  </div>
                )}

                {student.placeOfBirth && (
                  <div>
                    <label className="text-sm font-medium text-muted-foreground flex items-center gap-1">
                      <MapPin className="w-4 h-4" />
                      Lieu de naissance
                    </label>
                    <p className="text-sm text-foreground">{student.placeOfBirth}</p>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Academic Information */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-foreground">
                  <GraduationCap className="w-5 h-5 text-purple-400" />
                  Informations académiques
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {student.currentYear && (
                  <div>
                    <label className="text-sm font-medium text-muted-foreground">Année actuelle</label>
                    <p className="text-lg font-semibold text-foreground">Année {student.currentYear}</p>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          {/* Sidebar */}
          <div className="space-y-6">
            {/* Quick Stats */}
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Statistiques</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex items-center justify-between">
                    <span className="text-sm text-muted-foreground flex items-center gap-2">
                    <Award className="w-4 h-4" />
                    Statut
                  </span>
                  {getStatusBadge(student.status)}
                </div>
                {student.currentYear && (
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-muted-foreground flex items-center gap-2">
                      <BookOpen className="w-4 h-4" />
                      Année
                    </span>
                    <span className="font-semibold text-foreground">Année {student.currentYear}</span>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </div>
  );
}

