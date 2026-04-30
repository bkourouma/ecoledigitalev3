"use client";

import { useState, useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import {
  Form,
  FormControl,
  FormField,
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
import { ExamSchedule, CreateExamSchedule, UpdateExamSchedule } from "@/lib/hooks/use-exam-schedules";
import { useAcademicYears } from "@/lib/hooks/use-academic-years";
import { useCourses } from "@/lib/hooks/use-courses";

const examScheduleFormSchema = z.object({
  courseId: z.string().min(1, "Le cours est requis"),
  academicYearId: z.string().min(1, "L'année académique est requise"),
  name: z.string().min(1, "Le nom de l'examen est requis").max(255, "Le nom est trop long"),
  type: z.enum(['midterm', 'final', 'quiz', 'assignment', 'other'], {
    required_error: "Le type d'examen est requis",
  }),
  examDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Format de date invalide (YYYY-MM-DD)"),
  examTime: z.string().regex(/^\d{2}:\d{2}$/, "Format d'heure invalide (HH:MM)").optional().or(z.literal('')),
  duration: z.number().int().min(1, "La durée doit être supérieure à 0").optional().or(z.literal('')),
  location: z.string().max(255, "Le lieu est trop long").optional(),
});

type ExamScheduleFormData = z.infer<typeof examScheduleFormSchema>;

interface ExamScheduleFormProps {
  examSchedule?: ExamSchedule;
  onSubmit: (data: ExamScheduleFormData) => Promise<void>;
  onCancel: () => void;
  isLoading?: boolean;
  isEdit?: boolean;
}

export function ExamScheduleForm({ 
  examSchedule, 
  onSubmit, 
  onCancel, 
  isLoading = false,
  isEdit = false 
}: ExamScheduleFormProps) {
  const { data: academicYearsData } = useAcademicYears();
  const { data: coursesData } = useCourses({ status: 'active' });
  const academicYears = academicYearsData?.data || [];
  const courses = coursesData?.data || [];

  const form = useForm<ExamScheduleFormData>({
    resolver: zodResolver(examScheduleFormSchema),
    defaultValues: {
      courseId: examSchedule?.courseId || "",
      academicYearId: examSchedule?.academicYearId || "",
      name: examSchedule?.name || "",
      type: examSchedule?.type || "other",
      examDate: examSchedule?.examDate ? examSchedule.examDate.slice(0, 10) : "",
      examTime: examSchedule?.examTime || "",
      duration: examSchedule?.duration || undefined,
      location: examSchedule?.location || "",
    },
  });

  // Update form when examSchedule changes (for edit mode)
  useEffect(() => {
    if (isEdit && examSchedule) {
      form.reset({
        courseId: examSchedule.courseId || "",
        academicYearId: examSchedule.academicYearId || "",
        name: examSchedule.name || "",
        type: examSchedule.type || "other",
        examDate: examSchedule.examDate ? examSchedule.examDate.slice(0, 10) : "",
        examTime: examSchedule.examTime || "",
        duration: examSchedule.duration || undefined,
        location: examSchedule.location || "",
      }, {
        keepDefaultValues: false,
      });
    }
  }, [isEdit, examSchedule, form]);

  const handleSubmit = async (data: ExamScheduleFormData) => {
    try {
      await onSubmit(data);
    } catch (error) {
      console.error("Error submitting form:", error);
      alert("Erreur lors de l'enregistrement. Vérifiez que tous les champs sont correctement remplis.");
    }
  };

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(handleSubmit)} className="space-y-6">
        {/* Course and Academic Year */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <FormField
            control={form.control}
            name="courseId"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Cours *</FormLabel>
                <Select onValueChange={field.onChange} value={field.value}>
                  <FormControl>
                    <SelectTrigger>
                      <SelectValue placeholder="Sélectionner un cours" />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent side="bottom" sideOffset={4} position="item-aligned">
                    {courses.length > 0 ? (
                      courses.map((course) => (
                        <SelectItem key={course.id} value={course.id}>
                          {course.name}
                        </SelectItem>
                      ))
                    ) : (
                      <SelectItem value="no-course" disabled>
                        Aucun cours disponible
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
            name="academicYearId"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Année Académique *</FormLabel>
                <Select onValueChange={field.onChange} value={field.value}>
                  <FormControl>
                    <SelectTrigger>
                      <SelectValue placeholder="Sélectionner une année académique" />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent side="bottom" sideOffset={4} position="item-aligned">
                    {academicYears.length > 0 ? (
                      academicYears.map((year) => (
                        <SelectItem key={year.id} value={year.id}>
                          {year.name}
                        </SelectItem>
                      ))
                    ) : (
                      <SelectItem value="no-year" disabled>
                        Aucune année académique disponible
                      </SelectItem>
                    )}
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>

        {/* Name and Type */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <FormField
            control={form.control}
            name="name"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Nom de l'examen *</FormLabel>
                <FormControl>
                  <Input placeholder="Ex: Examen Final de Mathématiques" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="type"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Type d'examen *</FormLabel>
                <Select onValueChange={field.onChange} value={field.value}>
                  <FormControl>
                    <SelectTrigger>
                      <SelectValue placeholder="Sélectionner un type" />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent side="bottom" sideOffset={4} position="item-aligned">
                    <SelectItem value="midterm">Contrôle Intermédiaire</SelectItem>
                    <SelectItem value="final">Examen Final</SelectItem>
                    <SelectItem value="quiz">Quiz</SelectItem>
                    <SelectItem value="assignment">Devoir</SelectItem>
                    <SelectItem value="other">Autre</SelectItem>
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>

        {/* Date and Time */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <FormField
            control={form.control}
            name="examDate"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Date de l'examen *</FormLabel>
                <FormControl>
                  <Input type="date" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="examTime"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Heure (optionnel)</FormLabel>
                <FormControl>
                  <Input type="time" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>

        {/* Duration and Location */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <FormField
            control={form.control}
            name="duration"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Durée en minutes (optionnel)</FormLabel>
                <FormControl>
                  <Input
                    type="number"
                    min="1"
                    placeholder="Ex: 120"
                    {...field}
                    value={field.value || ""}
                    onChange={(e) => {
                      const value = e.target.value;
                      field.onChange(value === "" ? undefined : parseInt(value, 10));
                    }}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="location"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Lieu (optionnel)</FormLabel>
                <FormControl>
                  <Input placeholder="Ex: Salle A101" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>

        {/* Actions */}
        <div className="flex justify-end gap-4 pt-4">
          <button
            type="button"
            onClick={onCancel}
            disabled={isLoading}
            className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-emerald-500 disabled:opacity-50"
          >
            Annuler
          </button>
          <button
            type="submit"
            disabled={isLoading}
            className="px-4 py-2 text-sm font-medium text-white bg-emerald-600 border border-transparent rounded-md hover:bg-emerald-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-emerald-500 disabled:opacity-50 flex items-center gap-2"
          >
            {isLoading && <Loader2 className="h-4 w-4 animate-spin" />}
            {isEdit ? "Modifier" : "Créer"}
          </button>
        </div>
      </form>
    </Form>
  );
}

