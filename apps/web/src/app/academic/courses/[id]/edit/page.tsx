"use client";

import { useRouter, useParams } from "next/navigation";
import { Card, CardContent, CardDescription, CardHeader, CardTitle, Button } from "@ecoledigitale/ui";
import { ArrowLeft, Loader2, AlertCircle } from "lucide-react";
import { useCourse, useUpdateCourse } from "@/lib/hooks/use-courses";
import { CourseForm } from "@/components/academic/CourseForm";
import { UpdateCourse } from "@/lib/hooks/use-courses";

export default function EditCoursePage() {
  const router = useRouter();
  const params = useParams();
  const courseId = params.id as string;
  const { data: course, isLoading, error } = useCourse(courseId);
  const updateCourseMutation = useUpdateCourse();

  const handleSubmit = async (data: UpdateCourse) => {
    try {
      // Clean up optional fields
      const cleanData = {
        ...data,
        programmeId: data.programmeId === "no-programme" ? undefined : data.programmeId,
      };
      await updateCourseMutation.mutateAsync({
        id: courseId,
        data: cleanData,
      });
      router.push("/academic/courses");
    } catch (error) {
      console.error("Error updating course:", error);
    }
  };

  const handleCancel = () => {
    router.push("/academic/courses");
  };

  if (isLoading) {
    return (
      <div className="container mx-auto px-6 py-8 max-w-4xl">
        <div className="flex items-center justify-center py-16">
          <div className="text-center space-y-4">
            <div className="bg-gradient-to-br from-blue-100 to-purple-100 rounded-full w-16 h-16 flex items-center justify-center mx-auto">
              <Loader2 className="h-8 w-8 animate-spin text-blue-600" />
            </div>
            <p className="text-gray-600 text-lg">Chargement des informations du cours...</p>
          </div>
        </div>
      </div>
    );
  }

  if (error || !course) {
    return (
      <div className="container mx-auto px-6 py-8 max-w-4xl">
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <div className="text-center space-y-4">
              <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mx-auto">
                <AlertCircle className="h-8 w-8 text-red-600" />
              </div>
              <div>
                <h3 className="text-lg font-medium">Cours introuvable</h3>
                <p className="text-muted-foreground">
                  Le cours demandé n'existe pas ou vous n'avez pas les permissions pour le modifier.
                </p>
              </div>
              <Button onClick={() => router.push("/academic/courses")}>
                Retour à la liste
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="container mx-auto px-6 py-8 max-w-4xl">
      {/* Header */}
      <div className="flex items-center gap-4 mb-8">
        <Button
          variant="outline"
          size="sm"
          onClick={() => router.push("/academic/courses")}
        >
          <ArrowLeft className="h-4 w-4 mr-2" />
          Retour
        </Button>
        <div>
          <h1 className="text-3xl font-bold bg-gradient-to-r from-blue-600 to-purple-600 bg-clip-text text-transparent">
            Modifier le cours
          </h1>
          <p className="text-muted-foreground mt-2">
            Modifiez les informations de {course.name}
          </p>
        </div>
      </div>

      <Card className="shadow-lg">
        <CardHeader>
          <CardTitle>Informations du cours</CardTitle>
          <CardDescription>
            Modifiez les informations du cours
          </CardDescription>
        </CardHeader>
        <CardContent>
          <CourseForm
            course={course}
            onSubmit={handleSubmit}
            onCancel={handleCancel}
            isLoading={updateCourseMutation.isPending}
          />
        </CardContent>
      </Card>
    </div>
  );
}
