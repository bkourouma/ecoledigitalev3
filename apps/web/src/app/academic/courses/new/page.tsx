"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle, Button } from "@ecoledigitale/ui";
import { ArrowLeft } from "lucide-react";
import { useCreateCourse, CreateCourse, sanitizeCourseCode, buildBulkCourseCode } from "@/lib/hooks/use-courses";
import { CourseForm } from "@/components/academic/CourseForm";

type CreateCourseSubmission = Partial<CreateCourse> & {
  programmeId?: string;
  bilanTypeId?: string;
  status?: "draft" | "active" | "inactive";
  bulkCourses?: Array<{
    name: string;
    cm?: string;
    td?: string;
    tp?: string;
    coef?: number;
    vhh?: string;
  }>;
};

export default function NewCoursePage() {
  const router = useRouter();
  const createCourseMutation = useCreateCourse();
  const [isBulkSubmitting, setIsBulkSubmitting] = useState(false);

  const handleSubmit = async (data: CreateCourseSubmission) => {
    try {
      console.log("[Courses/New] Raw form data:", data);
      setIsBulkSubmitting(true);

      const coursesToCreate = data.bulkCourses && data.bulkCourses.length > 0
        ? data.bulkCourses
        : data.name
          ? [{
              name: data.name,
              cm: data.cm,
              td: data.td,
              tp: data.tp,
              coef: data.coef,
              vhh: data.vhh,
            }]
          : [];

      if (coursesToCreate.length === 0) {
        throw new Error("Ajoutez au moins une matière à créer.");
      }

      const failedNames: string[] = [];

      const namedRows = coursesToCreate.filter((c) => c.name?.trim());
      const useBulkCodes = namedRows.length > 1;

      let bulkRowIndex = 0;
      for (const courseToCreate of coursesToCreate) {
        const name = courseToCreate.name?.trim();
        if (!name) {
          continue;
        }

        const baseCode = sanitizeCourseCode(name) || "MATIERE";
        const code = useBulkCodes ? buildBulkCourseCode(baseCode, bulkRowIndex) : undefined;
        bulkRowIndex += 1;

        const cleanData: CreateCourse = {
          name,
          ...(code ? { code } : {}),
          programmeId: data.programmeId === "no-programme" ? undefined : data.programmeId,
          bilanTypeId: data.bilanTypeId,
          cm: courseToCreate.cm?.trim() || undefined,
          td: courseToCreate.td?.trim() || undefined,
          tp: courseToCreate.tp?.trim() || undefined,
          coef: courseToCreate.coef,
          vhh: courseToCreate.vhh?.trim() || undefined,
          status: data.status || "active",
        };

        console.log("[Courses/New] Clean payload before mutation:", cleanData);
        try {
          await createCourseMutation.mutateAsync(cleanData);
        } catch (error) {
          failedNames.push(name);
          console.error(`[Courses/New] Error creating course "${name}":`, error);
        }
      }

      if (failedNames.length > 0) {
        throw new Error(
          `${failedNames.length} matière(s) n'ont pas pu être créées: ${failedNames.join(", ")}`
        );
      }

      router.push("/academic/courses");
    } catch (error) {
      console.error("Error creating course:", error);
      alert(error instanceof Error ? error.message : "Erreur lors de la création des matières.");
    } finally {
      setIsBulkSubmitting(false);
    }
  };

  const handleCancel = () => {
    router.push("/academic/courses");
  };

  return (
    <div className="space-y-8 max-w-7xl mx-auto">
      {/* Header */}
      <div className="mb-6 flex max-w-full flex-col items-start gap-2 overflow-x-auto md:mb-8 md:gap-3">
        <div className="mb-6 flex max-w-full flex-col items-start gap-2 overflow-x-auto md:mb-8 md:gap-3">
          <Button
            variant="outline"
            size="sm"
            onClick={() => router.push("/academic/courses")}
          >
            <ArrowLeft className="h-4 w-4 mr-2" />
            Retour
          </Button>
          <div>
          <h1 className="whitespace-nowrap font-bold bg-gradient-to-r from-green-600 to-blue-600 bg-clip-text text-transparent leading-tight text-2xl md:text-3xl">
              Nouvelle matière
            </h1>
            <p className="whitespace-nowrap text-muted-foreground text-sm md:text-base">
              Créez une nouvelle matière avec toutes les informations nécessaires
            </p>
          </div>
        </div>
      </div>

      <div className="max-w-4xl mx-auto">
        <Card className="shadow-lg">
          <CardHeader>
            <CardTitle>Informations de la matière</CardTitle>
            <CardDescription>
              Remplissez les informations pour créer une nouvelle matière
            </CardDescription>
          </CardHeader>
          <CardContent>
            <CourseForm
              onSubmit={handleSubmit}
              onCancel={handleCancel}
              isLoading={createCourseMutation.isPending || isBulkSubmitting}
              allowBulkCreation
            />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
