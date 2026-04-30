"use client";

import { useState, useEffect, useMemo } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import {
  Form,
  FormControl,
  FormField,
  FormDescription,
  FormItem,
  FormLabel,
  FormMessage,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@ecoledigitale/ui";
import { Loader2 } from "lucide-react";
import { TeacherAssignment, CreateAssignmentInput } from "@/lib/hooks/use-teacher-assignments";
import { useTeachers } from "@/lib/hooks/use-teachers";
import { useClasses, useClassCourses, useClass } from "@/lib/hooks/use-classes";
import { useActiveAcademicYear } from "@/lib/hooks/use-academic-years";
import DatePickerFr from "@/components/DatePickerFr";

const teacherAssignmentFormSchema = z
  .object({
    classId: z.string().min(1, "La classe est requise"),
    courseId: z.string().min(1, "Le cours est requis"),
    teacherId: z.string().min(1, "L'enseignant est requis"),
    contractType: z.enum(["salarie", "vacataire"], {
      required_error: "Le type de contrat est requis",
    }),
    datebut: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Format de date invalide (YYYY-MM-DD)"),
    datefin: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Format de date invalide (YYYY-MM-DD)"),
    courseAmount: z.number().min(0, "Le montant doit être positif").optional().or(z.literal("")),
    status: z.enum(["active", "paused", "ended", "cancelled"]).optional(),
  })
  .refine((data) => data.datefin >= data.datebut, {
    message: "La date de fin doit être le même jour ou après la date de début",
    path: ["datefin"],
  });

type TeacherAssignmentFormData = z.infer<typeof teacherAssignmentFormSchema>;

interface TeacherAssignmentFormProps {
  assignment?: TeacherAssignment;
  onSubmit: (data: CreateAssignmentInput) => Promise<void>;
  onCancel: () => void;
  isLoading?: boolean;
  isEdit?: boolean;
}

export function TeacherAssignmentForm({ 
  assignment, 
  onSubmit, 
  onCancel, 
  isLoading = false,
  isEdit = false 
}: TeacherAssignmentFormProps) {
  const { data: teachersData } = useTeachers({});
  const { data: activeAcademicYearData } = useActiveAcademicYear();
  const activeAcademicYearId = activeAcademicYearData?.data?.id;
  const { data: classesData } = useClasses({
    includeDetails: false,
    academicYearId: activeAcademicYearId || undefined,
  });
  const teachers = teachersData?.data || [];
  const classes = classesData?.data || [];

  const [selectedClassId, setSelectedClassId] = useState<string>(assignment?.classId || "");
  const { data: classCoursesData } = useClassCourses(selectedClassId);
  const { data: selectedClassDetail, isLoading: isClassDetailLoading } = useClass(
    selectedClassId,
    false
  );
  const availableCourses = classCoursesData?.data || [];

  const ayBounds = useMemo(() => {
    const ay = selectedClassDetail?.data?.academicYear;
    const start = ay?.startDate || undefined;
    const end = ay?.endDate || undefined;
    if (!start || !end) return { min: undefined as string | undefined, max: undefined as string | undefined };
    return { min: start, max: end };
  }, [selectedClassDetail]);

  const form = useForm<TeacherAssignmentFormData>({
    resolver: zodResolver(teacherAssignmentFormSchema),
    defaultValues: {
      classId: assignment?.classId || "",
      courseId: assignment?.courseId || "",
      teacherId: assignment?.teacherId || "",
      contractType: assignment?.contractType || "salarie",
      datebut: assignment?.datebut ? assignment.datebut.slice(0, 10) : "",
      datefin: assignment?.datefin ? assignment.datefin.slice(0, 10) : "",
      courseAmount: assignment?.courseAmount || undefined,
      status: assignment?.status || "active",
    },
  });

  // Update form when assignment changes (for edit mode)
  useEffect(() => {
    if (isEdit && assignment) {
      form.reset({
        classId: assignment.classId || "",
        courseId: assignment.courseId || "",
        teacherId: assignment.teacherId || "",
        contractType: assignment.contractType || "salarie",
        datebut: assignment.datebut ? assignment.datebut.slice(0, 10) : "",
        datefin: assignment.datefin ? assignment.datefin.slice(0, 10) : "",
        courseAmount: assignment.courseAmount || undefined,
        status: assignment.status || "active",
      }, {
        keepDefaultValues: false,
      });
      setSelectedClassId(assignment.classId || "");
    }
  }, [isEdit, assignment, form]);

  const watchedClassId = form.watch("classId");
  const watchedContractType = form.watch("contractType");

  useEffect(() => {
    setSelectedClassId(watchedClassId || "");
    if (watchedClassId !== assignment?.classId) {
      form.setValue("courseId", "");
    }
  }, [watchedClassId, assignment, form]);

  // Cadrer les dates sur l'année académique de la classe (évite 400 "Out of Bounds" côté API)
  useEffect(() => {
    const lo = ayBounds.min;
    const hi = ayBounds.max;
    if (!lo || !hi) return;

    const clamp = (iso: string) => {
      if (iso < lo) return lo;
      if (iso > hi) return hi;
      return iso;
    };

    const prevDb = form.getValues("datebut");
    const prevDf = form.getValues("datefin");
    let db = prevDb;
    let df = prevDf;
    if (db) db = clamp(db);
    if (df) df = clamp(df);
    if (db && df && db > df) df = db;

    if (db !== prevDb) form.setValue("datebut", db);
    if (df !== prevDf) form.setValue("datefin", df);
  }, [ayBounds.min, ayBounds.max, selectedClassId, form]);

  const handleSubmit = async (data: TeacherAssignmentFormData) => {
    try {
      const lo = ayBounds.min;
      const hi = ayBounds.max;
      if (lo && hi) {
        if (data.datebut < lo || data.datebut > hi) {
          form.setError("datebut", {
            type: "manual",
            message: `La date doit être entre ${new Date(lo + "T12:00:00").toLocaleDateString("fr-FR")} et ${new Date(hi + "T12:00:00").toLocaleDateString("fr-FR")}.`,
          });
          return;
        }
        if (data.datefin < lo || data.datefin > hi) {
          form.setError("datefin", {
            type: "manual",
            message: `La date doit être entre ${new Date(lo + "T12:00:00").toLocaleDateString("fr-FR")} et ${new Date(hi + "T12:00:00").toLocaleDateString("fr-FR")} (fin d'année académique).`,
          });
          return;
        }
      }

      const cleanData: CreateAssignmentInput = {
        classId: data.classId,
        courseId: data.courseId,
        teacherId: data.teacherId,
        contractType: data.contractType,
        datebut: data.datebut,
        datefin: data.datefin,
        courseAmount: data.courseAmount || undefined,
        status: data.status || "active",
      };
      await onSubmit(cleanData);
    } catch (error) {
      console.error("Error submitting form:", error);
      alert("Erreur lors de l'enregistrement. Vérifiez que tous les champs sont correctement remplis.");
    }
  };

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(handleSubmit)} className="space-y-6">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <FormField
            control={form.control}
            name="classId"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Classe *</FormLabel>
                <Select onValueChange={(value) => {
                  field.onChange(value);
                  setSelectedClassId(value);
                  form.setValue("courseId", "");
                }} value={field.value}>
                  <FormControl>
                    <SelectTrigger>
                      <SelectValue placeholder="Sélectionner une classe" />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent side="bottom" sideOffset={4} position="item-aligned">
                    {classes.length > 0 ? (
                      classes.map((cls: any) => (
                        <SelectItem key={cls.id} value={cls.id}>
                          {cls.name} ({cls.code})
                        </SelectItem>
                      ))
                    ) : (
                      <SelectItem value="no-class" disabled>
                        Aucune classe disponible
                      </SelectItem>
                    )}
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="courseId"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Cours *</FormLabel>
                <Select onValueChange={field.onChange} value={field.value} disabled={!selectedClassId}>
                  <FormControl>
                    <SelectTrigger>
                      <SelectValue placeholder={selectedClassId ? "Sélectionner un cours" : "Sélectionnez d'abord une classe"} />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent side="bottom" sideOffset={4} position="item-aligned">
                    {availableCourses.length > 0 ? (
                      availableCourses.map((course: any) => (
                        <SelectItem key={course.id} value={course.id}>
                          {course.name} ({course.code})
                        </SelectItem>
                      ))
                    ) : (
                      <SelectItem value="no-course" disabled>
                        {selectedClassId ? "Aucun cours disponible" : "Sélectionnez d'abord une classe"}
                      </SelectItem>
                    )}
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>

        <FormField
          control={form.control}
          name="teacherId"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Enseignant *</FormLabel>
              <Select onValueChange={field.onChange} value={field.value}>
                <FormControl>
                  <SelectTrigger>
                    <SelectValue placeholder="Sélectionner un enseignant" />
                  </SelectTrigger>
                </FormControl>
                <SelectContent side="bottom" sideOffset={4} position="item-aligned">
                  {teachers.length > 0 ? (
                    teachers.map((teacher: any) => (
                      <SelectItem key={teacher.id} value={teacher.id}>
                        {teacher.firstName} {teacher.lastName}
                      </SelectItem>
                    ))
                  ) : (
                    <SelectItem value="no-teacher" disabled>
                      Aucun enseignant disponible
                    </SelectItem>
                  )}
                </SelectContent>
              </Select>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="contractType"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Type de contrat *</FormLabel>
              <Select onValueChange={field.onChange} value={field.value}>
                <FormControl>
                  <SelectTrigger>
                    <SelectValue placeholder="Sélectionner un type" />
                  </SelectTrigger>
                </FormControl>
                <SelectContent side="bottom" sideOffset={4} position="item-aligned">
                  <SelectItem value="salarie">Salarié</SelectItem>
                  <SelectItem value="vacataire">Vacataire</SelectItem>
                </SelectContent>
              </Select>
              <FormMessage />
            </FormItem>
          )}
        />

        <div className="space-y-2">
          {ayBounds.min && ayBounds.max && (
            <FormDescription className="text-sm">
              Période autorisée pour cette classe (année académique) :{" "}
              {new Date(ayBounds.min + "T12:00:00").toLocaleDateString("fr-FR")} —{" "}
              {new Date(ayBounds.max + "T12:00:00").toLocaleDateString("fr-FR")}
            </FormDescription>
          )}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <FormField
              control={form.control}
              name="datebut"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Date début *</FormLabel>
                  <FormControl>
                    <DatePickerFr
                      value={field.value}
                      onChange={(iso) => field.onChange(iso)}
                      min={ayBounds.min}
                      max={ayBounds.max}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="datefin"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Date fin *</FormLabel>
                  <FormControl>
                    <DatePickerFr
                      value={field.value}
                      onChange={(iso) => field.onChange(iso)}
                      min={ayBounds.min}
                      max={ayBounds.max}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>
        </div>

        {watchedContractType === "vacataire" && (
          <FormField
            control={form.control}
            name="courseAmount"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Montant total du cours (FCFA) *</FormLabel>
                <FormControl>
                  <Input
                    type="number"
                    min="0"
                    placeholder="Ex: 250000"
                    {...field}
                    value={field.value || ""}
                    onChange={(e) => {
                      const value = e.target.value;
                      field.onChange(value === "" ? undefined : parseFloat(value));
                    }}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        )}

        {isEdit && (
          <FormField
            control={form.control}
            name="status"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Statut</FormLabel>
                <Select onValueChange={field.onChange} value={field.value}>
                  <FormControl>
                    <SelectTrigger>
                      <SelectValue placeholder="Sélectionner un statut" />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent side="bottom" sideOffset={4} position="item-aligned">
                    <SelectItem value="active">Actif</SelectItem>
                    <SelectItem value="paused">En pause</SelectItem>
                    <SelectItem value="ended">Terminé</SelectItem>
                    <SelectItem value="cancelled">Annulé</SelectItem>
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )}
          />
        )}

        {/* Actions */}
        <div className="flex justify-end gap-4 pt-4">
          <button
            type="button"
            onClick={onCancel}
            disabled={isLoading}
            className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-red-500 disabled:opacity-50"
          >
            Annuler
          </button>
          <button
            type="submit"
            disabled={isLoading || (!!selectedClassId && isClassDetailLoading)}
            className="px-4 py-2 text-sm font-medium text-white bg-red-600 border border-transparent rounded-md hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-red-500 disabled:opacity-50 flex items-center gap-2"
          >
            {isLoading && <Loader2 className="h-4 w-4 animate-spin" />}
            {isEdit ? "Modifier" : "Créer"}
          </button>
        </div>
      </form>
    </Form>
  );
}

