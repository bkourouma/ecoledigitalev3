"use client";

import React from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Button,
  Badge,
  Separator,
} from "@ecoledigitale/ui";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { 
  User, 
  Mail, 
  Phone, 
  Calendar, 
  Edit,
  Award,
  Briefcase,
  GraduationCap,
  Euro,
  Loader2,
  AlertCircle,
  BookOpen,
  Users,
  Clock,
  FileText,
  DollarSign
} from "lucide-react";
import { 
  useTeacher, 
  useTeacherStudents
} from "@/lib/hooks/use-teachers";
import { useCurrentTeacherId } from "@/lib/hooks/use-current-teacher";
import { useTeacherClasses } from "@/lib/hooks/use-classes";
import { ContractType, TeacherStatus } from "@ecoledigitale/contracts";
import { formatAmountFCFA } from "@/lib/utils";
import Link from "next/link";

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

export default function TeacherProfilePage() {
  const router = useRouter();
  const { data: session, status } = useSession();
  const { data: teacherId, isLoading: isLoadingTeacherId, error: teacherIdError } = useCurrentTeacherId();
  const { data: teacher, isLoading: isLoadingTeacher, error } = useTeacher(teacherId || '');

  // Debug: Log session and teacher info
  React.useEffect(() => {
    if (session?.user?.email) {
      console.log('🔍 Session email:', session.user.email);
    }
    if (teacherId) {
      console.log('🔍 Teacher ID:', teacherId);
    }
    if (teacher) {
      console.log('🔍 Teacher data:', { 
        id: teacher.id, 
        email: teacher.email, 
        name: `${teacher.firstName} ${teacher.lastName}` 
      });
    }
    if (teacherIdError) {
      console.error('❌ Error fetching teacher ID:', teacherIdError);
    }
    if (error) {
      console.error('❌ Error fetching teacher:', error);
    }
  }, [session, teacherId, teacher, teacherIdError, error]);
  
  // Fetch all related data
  const { data: classesData, isLoading: isLoadingClasses } = useTeacherClasses();
  const { data: studentsData, isLoading: isLoadingStudents } = useTeacherStudents();

  // Redirect if not authenticated or not teacher
  React.useEffect(() => {
    if (status === 'loading' || isLoadingTeacherId) {
      return;
    }

    if (!session) {
      router.push('/login');
      return;
    }

    const roles = (session as any)?.roles ?? [];
    const isTeacher = Array.isArray(roles) && roles.some((r: string) => ['teacher', 'Enseignant'].includes(r));

    if (!isTeacher) {
      router.push('/');
    }
  }, [session, status, isLoadingTeacherId, router]);

  // Show loading state while checking authentication or fetching teacher ID
  if (status === 'loading' || isLoadingTeacherId) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-32 w-32 border-b-2 border-purple-500"></div>
      </div>
    );
  }

  if (isLoadingTeacher) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-purple-500" />
      </div>
    );
  }

  if (error || !teacher) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Card className="max-w-md">
          <CardContent className="flex flex-col items-center justify-center py-12">
            <div className="text-center space-y-4">
              <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mx-auto">
                <AlertCircle className="h-8 w-8 text-red-600" />
              </div>
              <div>
                <h3 className="text-lg font-medium">Profil introuvable</h3>
                <p className="text-muted-foreground">
                  Votre profil enseignant n'a pas été trouvé. Veuillez contacter l'administrateur.
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  const statusInfo = statusConfig[teacher.status];
  const contractInfo = contractConfig[teacher.contractType];

  const classes = classesData?.data || [];
  const students = studentsData?.data || [];

  // Calculate statistics for display in cards
  const totalStudents = students.length;
  const totalClasses = classes.length;

  const getInitials = (firstName: string, lastName: string) => {
    return `${firstName.charAt(0)}${lastName.charAt(0)}`.toUpperCase();
  };

  const formatDate = (dateString: string | undefined) => {
    if (!dateString) return 'Non spécifié';
    return new Date(dateString).toLocaleDateString('fr-FR', {
      day: 'numeric',
      month: 'long',
      year: 'numeric'
    });
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-purple-50 via-white to-pink-50">
      {/* Header */}
      <div className="bg-white shadow-sm border-b border-purple-100">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center py-6">
            <div className="flex items-center gap-4">
              <Avatar className="w-16 h-16">
                <AvatarImage src="" alt={`${teacher.firstName} ${teacher.lastName}`} />
                <AvatarFallback className="text-xl bg-purple-100 text-purple-600">
                  {getInitials(teacher.firstName, teacher.lastName)}
                </AvatarFallback>
              </Avatar>
              <div>
                <h1 className="font-bold bg-gradient-to-r from-purple-600 to-pink-600 bg-clip-text text-transparent whitespace-nowrap text-2xl leading-tight md:text-3xl">
                  {teacher.firstName} {teacher.lastName}
                </h1>
                <p className="text-gray-600 whitespace-nowrap text-sm md:text-base">
                  Profil Enseignant
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Badge variant={statusInfo.variant}>
                {statusInfo.label}
              </Badge>
              <Badge variant={contractInfo.variant}>
                {contractInfo.label}
              </Badge>
            </div>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Main Information */}
          <div className="lg:col-span-2 space-y-6">
            {/* Personal Information */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <User className="h-5 w-5" />
                  Informations Personnelles
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <p className="text-sm font-medium text-muted-foreground">Prénom</p>
                    <p className="text-lg font-semibold">{teacher.firstName}</p>
                  </div>
                  <div>
                    <p className="text-sm font-medium text-muted-foreground">Nom</p>
                    <p className="text-lg font-semibold">{teacher.lastName}</p>
                  </div>
                </div>

                {teacher.employeeNumber && (
                  <div>
                    <p className="text-sm font-medium text-muted-foreground">Numéro d'employé</p>
                    <p className="text-lg">{teacher.employeeNumber}</p>
                  </div>
                )}

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
              </CardContent>
            </Card>

            {/* Academic Profile */}
            {(teacher.specialties?.length || teacher.qualifications?.length || teacher.bio) && (
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Award className="h-5 w-5" />
                    Profil Académique
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

            {/* Classes */}
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle className="flex items-center gap-2">
                      <GraduationCap className="h-5 w-5" />
                      Mes Classes
                    </CardTitle>
                    <CardDescription>
                      {totalClasses} classes assignées
                    </CardDescription>
                  </div>
                  <Link href="/teacher/students">
                    <Button variant="outline" size="sm">Voir tout</Button>
                  </Link>
                </div>
              </CardHeader>
              <CardContent>
                {isLoadingClasses ? (
                  <div className="flex items-center justify-center py-8">
                    <Loader2 className="h-6 w-6 animate-spin text-purple-500" />
                  </div>
                ) : classes.length > 0 ? (
                  <div className="space-y-3">
                    {classes.slice(0, 5).map((classItem: any) => (
                      <div key={classItem.id} className="flex items-center justify-between p-3 border rounded-lg">
                        <div>
                          <p className="font-medium">{classItem.name}</p>
                          <p className="text-sm text-muted-foreground">
                            {classItem.code} • {classItem.programmeName || classItem.programme_name || 'N/A'}
                          </p>
                        </div>
                        {classItem.capacity && (
                          <Badge variant="secondary">{classItem.capacity} places</Badge>
                        )}
                      </div>
                    ))}
                    {classes.length > 5 && (
                      <p className="text-sm text-muted-foreground text-center">
                        +{classes.length - 5} autres classes
                      </p>
                    )}
                  </div>
                ) : (
                  <p className="text-center text-muted-foreground py-8">Aucune classe assignée</p>
                )}
              </CardContent>
            </Card>

          </div>

          {/* Sidebar */}
          <div className="space-y-6">
            {/* Employment Details */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Briefcase className="h-5 w-5" />
                  Détails d'Emploi
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {teacher.hireDate && (
                  <div className="flex items-center gap-2">
                    <Calendar className="h-4 w-4 text-muted-foreground" />
                    <div>
                      <p className="text-sm font-medium text-muted-foreground">Date d'embauche</p>
                      <p className="text-sm">{formatDate(teacher.hireDate)}</p>
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
                  <p className="text-sm font-medium text-muted-foreground">Type de contrat</p>
                  <Badge variant={contractInfo.variant} className="mt-1">
                    {contractInfo.label}
                  </Badge>
                </div>

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

            {/* Quick Actions */}
            <Card>
              <CardHeader>
                <CardTitle>Actions Rapides</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                <Link href="/teacher/courses" className="block">
                  <Button variant="outline" className="w-full justify-start" size="sm">
                    <BookOpen className="h-4 w-4 mr-2" />
                    Mes Cours
                  </Button>
                </Link>
                <Link href="/teacher/students" className="block">
                  <Button variant="outline" className="w-full justify-start" size="sm">
                    <Users className="h-4 w-4 mr-2" />
                    Mes Étudiants
                  </Button>
                </Link>
                <Link href="/teacher/assignments/create" className="block">
                  <Button variant="outline" className="w-full justify-start" size="sm">
                    <FileText className="h-4 w-4 mr-2" />
                    Créer un Devoir
                  </Button>
                </Link>
                <Link href="/teacher/hours" className="block">
                  <Button variant="outline" className="w-full justify-start" size="sm">
                    <Clock className="h-4 w-4 mr-2" />
                    Mes Heures
                  </Button>
                </Link>
                <Link href="/teacher/payments" className="block">
                  <Button variant="outline" className="w-full justify-start" size="sm">
                    <DollarSign className="h-4 w-4 mr-2" />
                    Mes Paiements
                  </Button>
                </Link>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </div>
  );
}
