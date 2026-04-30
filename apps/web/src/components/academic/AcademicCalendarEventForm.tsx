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
  Textarea,
} from "@ecoledigitale/ui";
import { Loader2 } from "lucide-react";
import { AcademicCalendarEvent, CreateAcademicCalendarEvent, UpdateAcademicCalendarEvent } from "@/lib/hooks/use-academic-calendar-events";
import { useAcademicYears } from "@/lib/hooks/use-academic-years";

const academicCalendarEventFormSchema = z.object({
  academicYearId: z.string().min(1, "L'année académique est requise"),
  name: z.string().min(1, "Le nom de l'événement est requis").max(255, "Le nom est trop long"),
  type: z.enum(['semester_start', 'semester_end', 'holiday', 'break', 'special_event', 'academic_milestone'], {
    required_error: "Le type d'événement est requis",
  }),
  eventDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Format de date invalide (YYYY-MM-DD)"),
  description: z.string().optional(),
  semester: z.number().int().min(1).max(8).optional().or(z.literal('')),
});

type AcademicCalendarEventFormData = z.infer<typeof academicCalendarEventFormSchema>;

interface AcademicCalendarEventFormProps {
  event?: AcademicCalendarEvent;
  onSubmit: (data: AcademicCalendarEventFormData) => Promise<void>;
  onCancel: () => void;
  isLoading?: boolean;
  isEdit?: boolean;
}

export function AcademicCalendarEventForm({ 
  event, 
  onSubmit, 
  onCancel, 
  isLoading = false,
  isEdit = false 
}: AcademicCalendarEventFormProps) {
  const { data: academicYearsData } = useAcademicYears();
  const academicYears = academicYearsData?.data || [];
  const [eventType, setEventType] = useState<string>(event?.type || 'special_event');

  const form = useForm<AcademicCalendarEventFormData>({
    resolver: zodResolver(academicCalendarEventFormSchema),
    defaultValues: {
      academicYearId: event?.academicYearId || "",
      name: event?.name || "",
      type: event?.type || "special_event",
      eventDate: event?.eventDate ? event.eventDate.slice(0, 10) : "",
      description: event?.description || "",
      semester: event?.semester || undefined,
    },
  });

  // Update form when event changes (for edit mode)
  useEffect(() => {
    if (isEdit && event) {
      form.reset({
        academicYearId: event.academicYearId || "",
        name: event.name || "",
        type: event.type || "special_event",
        eventDate: event.eventDate ? event.eventDate.slice(0, 10) : "",
        description: event.description || "",
        semester: event.semester || undefined,
      }, {
        keepDefaultValues: false,
      });
      setEventType(event.type || 'special_event');
    }
  }, [isEdit, event, form]);

  const watchedType = form.watch("type");

  useEffect(() => {
    setEventType(watchedType || 'special_event');
  }, [watchedType]);

  const handleSubmit = async (data: AcademicCalendarEventFormData) => {
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

        <FormField
          control={form.control}
          name="name"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Nom de l'événement *</FormLabel>
              <FormControl>
                <Input placeholder="Ex: Début du Semestre 1" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <FormField
            control={form.control}
            name="type"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Type d'événement *</FormLabel>
                <Select onValueChange={(value) => {
                  field.onChange(value);
                  setEventType(value);
                }} value={field.value}>
                  <FormControl>
                    <SelectTrigger>
                      <SelectValue placeholder="Sélectionner un type" />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent side="bottom" sideOffset={4} position="item-aligned">
                    <SelectItem value="semester_start">Début de Semestre</SelectItem>
                    <SelectItem value="semester_end">Fin de Semestre</SelectItem>
                    <SelectItem value="holiday">Vacances</SelectItem>
                    <SelectItem value="break">Pause</SelectItem>
                    <SelectItem value="special_event">Événement Spécial</SelectItem>
                    <SelectItem value="academic_milestone">Étape Académique</SelectItem>
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="eventDate"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Date de l'événement *</FormLabel>
                <FormControl>
                  <Input type="date" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>

        {(eventType === 'semester_start' || eventType === 'semester_end' || eventType === 'academic_milestone') && (
          <FormField
            control={form.control}
            name="semester"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Semestre (optionnel)</FormLabel>
                <FormControl>
                  <Input
                    type="number"
                    min="1"
                    max="8"
                    placeholder="1-8"
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
        )}

        <FormField
          control={form.control}
          name="description"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Description (optionnel)</FormLabel>
              <FormControl>
                <Textarea
                  placeholder="Description de l'événement..."
                  rows={3}
                  {...field}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        {/* Actions */}
        <div className="flex justify-end gap-4 pt-4">
          <button
            type="button"
            onClick={onCancel}
            disabled={isLoading}
            className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-purple-500 disabled:opacity-50"
          >
            Annuler
          </button>
          <button
            type="submit"
            disabled={isLoading}
            className="px-4 py-2 text-sm font-medium text-white bg-purple-600 border border-transparent rounded-md hover:bg-purple-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-purple-500 disabled:opacity-50 flex items-center gap-2"
          >
            {isLoading && <Loader2 className="h-4 w-4 animate-spin" />}
            {isEdit ? "Modifier" : "Créer"}
          </button>
        </div>
      </form>
    </Form>
  );
}

