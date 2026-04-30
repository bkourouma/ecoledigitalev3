"use client";

import { useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { 
  Card, 
  CardContent, 
  CardDescription, 
  CardHeader, 
  CardTitle,
  Button,
  Badge,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@ecoledigitale/ui";
import { 
  ArrowLeft, 
  BookOpen, 
  Users, 
  GraduationCap, 
  Clock,
  MapPin,
  Calendar,
  Search,
  Filter,
  Mail,
  Phone,
  User,
  Edit,
  Trash2,
  Plus
} from "lucide-react";
import { useClass } from "@/lib/hooks/use-classes";
import { useClassCourses } from "@/lib/hooks/use-class-courses";
import { useEnrollments } from "@/lib/hooks/use-enrollments";

export default function ClassDetailsPage() {
  const params = useParams();
  const router = useRouter();
  const classId = params.id as string;
  
  const [activeTab, setActiveTab] = useState("overview");
  const [courseFilter, setCourseFilter] = useState("");
  const [studentFilter, setStudentFilter] = useState("");

  // Fetch class details
  const { data: classData, isLoading: classLoading, error: classError } = useClass(classId, true);
  
  // Fetch class courses
  const { data: coursesData, isLoading: coursesLoading } = useClassCourses(classId);
  
  // Fetch class enrollments (students)
  const { data: enrollmentsData, isLoading: enrollmentsLoading } = useEnrollments({
    classId: classId,
    includeDetails: true
  });

  if (classLoading) {
    return (
      <div className="container mx-auto px-4 py-8">
        <div className="animate-pulse space-y-4">
          <div className="h-8 bg-gray-200 rounded w-1/4"></div>
          <div className="h-32 bg-gray-200 rounded"></div>
          <div className="h-64 bg-gray-200 rounded"></div>
        </div>
      </div>
    );
  }

  if (classError || !classData?.data) {
    return (
      <div className="container mx-auto px-4 py-8">
        <Card className="border-red-200 bg-red-50">
          <CardHeader>
            <CardTitle className="text-red-800">Erreur</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-red-700 mb-4">
              Impossible de charger les détails de la classe.
            </p>
            <Button onClick={() => router.back()}>
              Retour
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  const classDetails = classData.data;
  const courses = coursesData?.data || [];
  const enrollments = enrollmentsData?.data || [];

  // Filter courses
  const filteredCourses = courses.filter(course =>
    course.name.toLowerCase().includes(courseFilter.toLowerCase()) ||
    course.code.toLowerCase().includes(courseFilter.toLowerCase())
  );

  // Filter students
  const filteredStudents = enrollments.filter(enrollment =>
    enrollment.student?.firstName?.toLowerCase().includes(studentFilter.toLowerCase()) ||
    enrollment.student?.lastName?.toLowerCase().includes(studentFilter.toLowerCase()) ||
    enrollment.student?.email?.toLowerCase().includes(studentFilter.toLowerCase()) ||
    enrollment.student?.studentNumber?.toLowerCase().includes(studentFilter.toLowerCase())
  );

  return (
    <div className="container mx-auto px-4 py-8">
      {/* Header */}
      <div className="flex items-center gap-4 mb-6">
        <Button 
          variant="outline" 
          size="sm"
          onClick={() => router.back()}
        >
          <ArrowLeft className="h-4 w-4 mr-2" />
          Retour
        </Button>
        <div className="flex-1">
          <h1 className="text-3xl font-bold text-white">{classDetails.name}</h1>
          <p className="text-gray-300">{classDetails.code}</p>
        </div>
        <Button
          onClick={() => router.push(`/annee-academique/ajouter-classe?edit=${classId}`)}
          className="bg-blue-600 hover:bg-blue-700"
        >
          <Edit className="h-4 w-4 mr-2" />
          Modifier
        </Button>
      </div>

      {/* Overview Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm font-medium text-gray-300">Capacité</CardTitle>
              <Users className="h-4 w-4 text-blue-400" />
            </div>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-white">{classDetails.maxStudents}</div>
            <p className="text-xs text-gray-400">étudiants maximum</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm font-medium text-gray-300">Inscrits</CardTitle>
              <GraduationCap className="h-4 w-4 text-green-400" />
            </div>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-white">{enrollments.length}</div>
            <p className="text-xs text-gray-400">
              {classDetails.maxStudents - enrollments.length} places restantes
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm font-medium text-gray-300">Cours</CardTitle>
              <BookOpen className="h-4 w-4 text-purple-400" />
            </div>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-white">{courses.length}</div>
            <p className="text-xs text-gray-400">cours assignés</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm font-medium text-gray-300">Salle</CardTitle>
              <MapPin className="h-4 w-4 text-orange-400" />
            </div>
          </CardHeader>
          <CardContent>
            <div className="text-lg font-bold text-white">
              {classDetails.classroom?.name || "Non assignée"}
            </div>
            <p className="text-xs text-gray-400">
              {classDetails.classroom?.code || "Aucune salle"}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-6">
        <TabsList className="grid w-full grid-cols-3">
          <TabsTrigger value="overview">Aperçu</TabsTrigger>
          <TabsTrigger value="courses">Cours ({courses.length})</TabsTrigger>
          <TabsTrigger value="students">Étudiants ({enrollments.length})</TabsTrigger>
        </TabsList>

        {/* Overview Tab */}
        <TabsContent value="overview" className="space-y-6">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Class Information */}
            <Card>
              <CardHeader>
                <CardTitle className="text-white">Informations de la classe</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div>
                  <label className="text-sm font-medium text-gray-300">Programme</label>
                  <p className="text-white">{classDetails.programme?.name}</p>
                  <p className="text-sm text-gray-400">{classDetails.programme?.code}</p>
                </div>
                <div>
                  <label className="text-sm font-medium text-gray-300">Année académique</label>
                  <p className="text-white">{classDetails.academicYear?.name}</p>
                </div>
                <div>
                  <label className="text-sm font-medium text-gray-300">Niveau</label>
                  <p className="text-white">Niveau {classDetails.level || 1}</p>
                </div>
                <div>
                  <label className="text-sm font-medium text-gray-300">Date de création</label>
                  <p className="text-white">
                    {new Date(classDetails.createdAt).toLocaleDateString('fr-FR')}
                  </p>
                </div>
              </CardContent>
            </Card>

            {/* Quick Stats */}
            <Card>
              <CardHeader>
                <CardTitle className="text-white">Statistiques rapides</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex justify-between items-center">
                  <span className="text-gray-300">Taux d'occupation</span>
                  <div className="flex items-center gap-2">
                    <div className="w-24 bg-gray-700 rounded-full h-2">
                      <div 
                        className="bg-green-500 h-2 rounded-full" 
                        style={{ width: `${(enrollments.length / classDetails.maxStudents) * 100}%` }}
                      ></div>
                    </div>
                    <span className="text-white text-sm">
                      {Math.round((enrollments.length / classDetails.maxStudents) * 100)}%
                    </span>
                  </div>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-gray-300">Cours actifs</span>
                  <Badge variant="outline" className="text-white">
                    {courses.filter(c => c.status === 'active').length}
                  </Badge>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-gray-300">Total heures de cours</span>
                  <span className="text-white">
                    {courses.reduce((sum, course) => sum + (course.hoursTotal || 0), 0)}h
                  </span>
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* Courses Tab */}
        <TabsContent value="courses" className="space-y-6">
          <Card>
            <CardHeader>
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                <div>
                  <CardTitle className="text-white">Cours de la classe</CardTitle>
                  <CardDescription className="text-gray-300">
                    {filteredCourses.length} cours assigné{filteredCourses.length > 1 ? 's' : ''}
                  </CardDescription>
                </div>
                <div className="flex items-center gap-2">
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
                    <Input
                      placeholder="Rechercher un cours..."
                      value={courseFilter}
                      onChange={(e) => setCourseFilter(e.target.value)}
                      className="pl-10 w-64"
                    />
                  </div>
                  <Button size="sm" className="bg-green-600 hover:bg-green-700">
                    <Plus className="h-4 w-4 mr-2" />
                    Ajouter cours
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              {coursesLoading ? (
                <div className="space-y-4">
                  {[...Array(3)].map((_, i) => (
                    <div key={i} className="animate-pulse">
                      <div className="h-16 bg-gray-700 rounded"></div>
                    </div>
                  ))}
                </div>
              ) : filteredCourses.length === 0 ? (
                <div className="text-center py-8">
                  <BookOpen className="h-12 w-12 text-gray-400 mx-auto mb-4" />
                  <p className="text-gray-300 text-lg mb-2">
                    {courseFilter ? 'Aucun cours trouvé' : 'Aucun cours assigné'}
                  </p>
                  <p className="text-gray-400 text-sm">
                    {courseFilter ? 'Essayez de modifier votre recherche' : 'Commencez par ajouter des cours à cette classe'}
                  </p>
                </div>
              ) : (
                <div className="space-y-4">
                  {filteredCourses.map((course) => (
                    <Card key={course.id} className="border-gray-600">
                      <CardContent className="p-4">
                        <div className="flex items-center justify-between">
                          <div className="flex-1">
                            <div className="flex items-center gap-3 mb-2">
                              <h3 className="font-semibold text-white">{course.name}</h3>
                              <Badge variant="outline" className="text-xs">
                                {course.code}
                              </Badge>
                              {course.isRequired && (
                                <Badge className="text-xs bg-red-600">Obligatoire</Badge>
                              )}
                            </div>
                            <p className="text-sm text-gray-300 mb-2">{course.description}</p>
                            <div className="flex items-center gap-4 text-sm text-gray-400">
                              <div className="flex items-center gap-1">
                                <Clock className="h-4 w-4" />
                                <span>{course.hoursTotal}h total</span>
                              </div>
                              {course.hoursTheory > 0 && (
                                <span>{course.hoursTheory}h théorie</span>
                              )}
                              {course.hoursPractical > 0 && (
                                <span>{course.hoursPractical}h pratique</span>
                              )}
                            </div>
                          </div>
                          <div className="flex items-center gap-2">
                            <Button variant="outline" size="sm">
                              <Edit className="h-4 w-4" />
                            </Button>
                            <Button variant="outline" size="sm" className="text-red-400 hover:text-red-300">
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Students Tab */}
        <TabsContent value="students" className="space-y-6">
          <Card>
            <CardHeader>
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                <div>
                  <CardTitle className="text-white">Étudiants inscrits</CardTitle>
                  <CardDescription className="text-gray-300">
                    {filteredStudents.length} étudiant{filteredStudents.length > 1 ? 's' : ''} inscrit{filteredStudents.length > 1 ? 's' : ''}
                  </CardDescription>
                </div>
                <div className="flex items-center gap-2">
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
                    <Input
                      placeholder="Rechercher un étudiant..."
                      value={studentFilter}
                      onChange={(e) => setStudentFilter(e.target.value)}
                      className="pl-10 w-64"
                    />
                  </div>
                  <Button size="sm" className="bg-green-600 hover:bg-green-700">
                    <Plus className="h-4 w-4 mr-2" />
                    Inscrire étudiant
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              {enrollmentsLoading ? (
                <div className="space-y-4">
                  {[...Array(5)].map((_, i) => (
                    <div key={i} className="animate-pulse">
                      <div className="h-16 bg-gray-700 rounded"></div>
                    </div>
                  ))}
                </div>
              ) : filteredStudents.length === 0 ? (
                <div className="text-center py-8">
                  <GraduationCap className="h-12 w-12 text-gray-400 mx-auto mb-4" />
                  <p className="text-gray-300 text-lg mb-2">
                    {studentFilter ? 'Aucun étudiant trouvé' : 'Aucun étudiant inscrit'}
                  </p>
                  <p className="text-gray-400 text-sm">
                    {studentFilter ? 'Essayez de modifier votre recherche' : 'Commencez par inscrire des étudiants à cette classe'}
                  </p>
                </div>
              ) : (
                <div className="space-y-4">
                  {filteredStudents.map((enrollment) => (
                    <Card key={enrollment.id} className="border-gray-600">
                      <CardContent className="p-4">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-4">
                            <div className="w-12 h-12 bg-gray-600 rounded-full flex items-center justify-center">
                              <User className="h-6 w-6 text-gray-300" />
                            </div>
                            <div>
                              <h3 className="font-semibold text-white">
                                {enrollment.student?.firstName} {enrollment.student?.lastName}
                              </h3>
                              <div className="flex items-center gap-4 text-sm text-gray-400">
                                <span>{enrollment.student?.studentNumber}</span>
                                <div className="flex items-center gap-1">
                                  <Mail className="h-3 w-3" />
                                  <span>{enrollment.student?.email}</span>
                                </div>
                              </div>
                              <div className="flex items-center gap-2 mt-1">
                                <Badge 
                                  variant={enrollment.status === 'active' ? 'default' : 'secondary'}
                                  className="text-xs"
                                >
                                  {enrollment.status === 'active' ? 'Actif' : enrollment.status}
                                </Badge>
                                <span className="text-xs text-gray-400">
                                  Inscrit le {new Date(enrollment.enrollmentDate).toLocaleDateString('fr-FR')}
                                </span>
                              </div>
                            </div>
                          </div>
                          <div className="flex items-center gap-2">
                            <Button variant="outline" size="sm">
                              <Edit className="h-4 w-4" />
                            </Button>
                            <Button variant="outline" size="sm" className="text-red-400 hover:text-red-300">
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
