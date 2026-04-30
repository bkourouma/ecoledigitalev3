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
import { Loader2, BookOpen } from "lucide-react";
import { Class, CreateClass, UpdateClass } from "@/lib/hooks/use-classes";
import { useProgrammes } from "@/lib/hooks/use-programmes";
import { useClassrooms } from "@/lib/hooks/use-classrooms";
import { useAvailableCourses } from "@/lib/hooks/use-classes";

// Schema for creating a new class
const createClassFormSchema = z.object({
  programmeId: z.string().min(1, "Le programme est requis"),
  name: z.string().min(1, "Le nom est requis").max(255, "Le nom est trop long"),
  courseIds: z.array(z.string()).default([]),
});

// Schema for editing a class (programmeId is optional)
const editClassFormSchema = z.object({
  programmeId: z.string().optional(),
  name: z.string().min(1, "Le nom est requis").max(255, "Le nom est trop long"),
  code: z.string().min(1, "Le code est requis").max(50, "Le code est trop long"),
  maxStudents: z.number().int().positive("Le nombre maximum d'étudiants doit être positif"),
  courseIds: z.array(z.string()).default([]),
  classroomId: z.string().uuid({ message: "La salle de classe est requise" }),
});

type CreateClassFormData = z.infer<typeof createClassFormSchema>;
type EditClassFormData = z.infer<typeof editClassFormSchema>;

interface ClassFormProps {
  classItem?: Class & { courses?: { id: string }[] };
  onSubmit: (data: CreateClassFormData | EditClassFormData) => Promise<void>;
  onCancel: () => void;
  isLoading?: boolean;
  isEdit?: boolean;
}

export function ClassForm({ classItem, onSubmit, onCancel, isLoading = false, isEdit = false }: ClassFormProps) {
  const { data: programmesData } = useProgrammes({ status: "active" });
  const { data: classroomsData } = useClassrooms({ isActive: true });
  const programmes = programmesData?.data || [];
  const classrooms = classroomsData?.data || [];

  const [selectedProgrammeId, setSelectedProgrammeId] = useState<string>(
    classItem?.programmeId || ""
  );
  const [selectedCourses, setSelectedCourses] = useState<string[]>(
    classItem?.courses?.map(c => c.id) || []
  );

  // Fetch available courses for the selected programme
  const { data: coursesData } = useAvailableCourses(selectedProgrammeId);
  const courses = coursesData?.data || [];

  const schema = isEdit ? editClassFormSchema : createClassFormSchema;
  const form = useForm<CreateClassFormData | EditClassFormData>({
    resolver: zodResolver(schema),
    defaultValues: {
      programmeId: classItem?.programmeId || "",
      name: classItem?.name || "",
      courseIds: classItem?.courses?.map(c => c.id) || [],
    },
  });

  const watchedProgrammeId = form.watch("programmeId");

  // Update selectedProgrammeId when form value changes
  useEffect(() => {
    if (watchedProgrammeId !== selectedProgrammeId) {
      setSelectedProgrammeId(watchedProgrammeId);
      if (!isEdit) {
        // Only reset courses when creating (not editing)
        setSelectedCourses([]);
        form.setValue("courseIds", []);
      }
    }
  }, [watchedProgrammeId, selectedProgrammeId, isEdit, form]);

  // Sync selectedCourses with form
  useEffect(() => {
    form.setValue("courseIds", selectedCourses);
  }, [selectedCourses, form]);

  // Load courses when editing and classItem changes
  useEffect(() => {
    if (isEdit && classItem) {
      const courseIds = classItem.courses && Array.isArray(classItem.courses) 
        ? classItem.courses.map(c => c.id) 
        : [];
      
      // Update selectedProgrammeId and selectedCourses state
      if (classItem.programmeId) {
        setSelectedProgrammeId(classItem.programmeId);
      }
      setSelectedCourses(courseIds);
      
      // Update all form values when classItem changes
      form.reset({
        programmeId: classItem.programmeId || "",
        name: classItem.name || "",
        code: classItem.code || "",
        maxStudents: classItem.maxStudents || 30,
        courseIds: courseIds,
        classroomId: classItem.classroomId || undefined,
      });
    }
  }, [isEdit, classItem, form]);

  const handleCourseToggle = (courseId: string) => {
    setSelectedCourses(prev =>
      prev.includes(courseId)
        ? prev.filter(id => id !== courseId)
        : [...prev, courseId]
    );
  };

  const handleSubmit = async (data: CreateClassFormData | EditClassFormData) => {
    try {
      const submitData = {
        ...data,
        courseIds: selectedCourses,
      };
      await onSubmit(submitData);
    } catch (error) {
      console.error("Error submitting form:", error);
      alert("Erreur lors de l'enregistrement. Vérifiez que tous les champs sont correctement remplis.");
    }
  };

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(handleSubmit)} className="space-y-6">
        {/* Programme Selection */}
        <FormField
          control={form.control}
          name="programmeId"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Programme {!isEdit && "*"}</FormLabel>
              <Select
                onValueChange={(value) => {
                  field.onChange(value);
                  setSelectedProgrammeId(value);
                  if (!isEdit) {
                    setSelectedCourses([]);
                    form.setValue("courseIds", []);
                  }
                }}
                defaultValue={field.value}
                value={field.value}
              >
                <FormControl>
                  <SelectTrigger>
                    <SelectValue placeholder="Sélectionner un programme" />
                  </SelectTrigger>
                </FormControl>
                <SelectContent side="bottom" sideOffset={4} position="item-aligned">
                  {programmes.length > 0 ? (
                    programmes.map((programme) => (
                      <SelectItem key={programme.id} value={programme.id}>
                        {programme.name}
                      </SelectItem>
                    ))
                  ) : (
                    <SelectItem value="no-programme" disabled>
                      Aucun programme disponible
                    </SelectItem>
                  )}
                </SelectContent>
              </Select>
              <FormMessage />
            </FormItem>
          )}
        />

        {/* Classroom Selection (édition uniquement) */}
        {isEdit && (
          <FormField
            control={form.control}
            name="classroomId"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Salle de classe *</FormLabel>
                <Select
                  onValueChange={field.onChange}
                  defaultValue={field.value}
                  value={field.value}
                >
                  <FormControl>
                    <SelectTrigger>
                      <SelectValue placeholder="Sélectionner une salle" />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent side="bottom" sideOffset={4} position="item-aligned">
                    {classrooms.length > 0 ? (
                      classrooms.map((room: any) => (
                        <SelectItem key={room.id} value={room.id}>
                          {room.name} ({room.code}) • {room.capacity} pl.
                        </SelectItem>
                      ))
                    ) : (
                      <SelectItem value="no-classroom" disabled>
                        Aucune salle disponible
                      </SelectItem>
                    )}
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )}
          />
        )}

        {/* Class Details */}
        <div className="grid grid-cols-1 gap-6">
          <FormField
            control={form.control}
            name="name"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Nom de la classe *</FormLabel>
                <FormControl>
                  <Input placeholder="ex: Classe A 1ère Année" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          {isEdit && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <FormField
                control={form.control}
                name="code"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Code de la classe *</FormLabel>
                    <FormControl>
                      <Input placeholder="ex: BTS-COMP-A1" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="maxStudents"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Nombre maximum d'étudiants *</FormLabel>
                    <FormControl>
                      <Input
                        type="number"
                        min="1"
                        {...field}
                        onChange={(e) => field.onChange(parseInt(e.target.value) || 0)}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
          )}
        </div>

        {/* Course Selection (édition uniquement) */}
        {isEdit && selectedProgrammeId && (
          <div>
            <h3 className="text-foreground font-semibold mb-4">Cours du programme</h3>
            {courses.length === 0 ? (
              <div className="text-center py-8 border-2 border-dashed border-muted rounded-lg">
                <BookOpen className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
                <p className="text-muted-foreground">Aucun cours trouvé pour ce programme</p>
              </div>
            ) : (
              <div className="max-h-64 overflow-y-auto border rounded-lg p-4">
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2">
                  {courses.map((course) => (
                    <div
                      key={course.id}
                      className="flex items-center space-x-3 p-2 hover:bg-muted/50 rounded transition-colors"
                    >
                      <input
                        type="checkbox"
                        id={`course-${course.id}`}
                        checked={selectedCourses.includes(course.id)}
                        onChange={() => handleCourseToggle(course.id)}
                        className="h-4 w-4 text-primary focus:ring-primary border-border rounded"
                      />
                      <label
                        htmlFor={`course-${course.id}`}
                        className="flex-1 cursor-pointer"
                      >
                        <div className="font-medium text-foreground">{course.name}</div>
                        <div className="text-sm text-muted-foreground">
                          {course.code} • {course.teachingUnitName} • {course.credits} crédits
                        </div>
                      </label>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {selectedCourses.length > 0 && (
              <p className="text-sm text-green-600 mt-2">
                {selectedCourses.length} cours sélectionné(s)
              </p>
            )}
          </div>
        )}

        {/* Form Actions */}
        <div className="flex gap-4 pt-6 border-t border-gray-200">
          <button
            type="button"
            onClick={onCancel}
            className="flex-1 px-6 py-3 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50 transition-all duration-200 font-medium"
            disabled={isLoading}
          >
            Annuler
          </button>
          <button
            type="submit"
            className="flex-1 px-6 py-3 bg-gradient-to-r from-violet-500 to-indigo-600 text-white rounded-lg hover:from-violet-600 hover:to-indigo-700 transition-all duration-200 disabled:opacity-50 font-medium shadow-lg hover:shadow-xl"
            disabled={isLoading}
          >
            {isLoading ? (
              <span className="flex items-center justify-center">
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Enregistrement...
              </span>
            ) : (
              isEdit ? "Modifier la classe" : "Créer la classe"
            )}
          </button>
        </div>
      </form>
    </Form>
  );
}

