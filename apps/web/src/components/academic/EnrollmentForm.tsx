"use client";

import { useEffect, useState } from "react";
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
import { DollarSign, Loader2 } from "lucide-react";
import DatePickerFr from "@/components/DatePickerFr";
import {
  StudentEnrollment,
  useAvailableStudents,
} from "@/lib/hooks/use-enrollments";
import { useClasses } from "@/lib/hooks/use-classes";

const enrollmentBaseSchema = z.object({
  classId: z.string().min(1, "La classe est requise"),
  originSchool: z.string().max(255, "L'établissement d'origine est trop long").optional().or(z.literal("")),
  lv2: z.string().max(100, "La LV2 est trop longue").optional().or(z.literal("")),
  scholarshipLevel: z.enum(["oui", "non"]).default("non"),
  isRepeating: z.boolean().default(false),
  isTransfer: z.boolean().default(false),
  isInscribed: z.boolean().default(true),
  transferDecision: z.string().max(255, "La décision de transfert est trop longue").optional().or(z.literal("")),
  affectationStatus: z.enum(["affecte", "non_affecte", "prise_en_charge"]).default("affecte"),
  affectationDecision: z.string().max(255, "La décision d'affectation est trop longue").optional().or(z.literal("")),
  cepeCode: z.string().max(100, "Le code CEPE est trop long").optional().or(z.literal("")),
  enrollmentDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Format de date invalide (YYYY-MM-DD)").optional(),
  status: z.enum(["active", "suspended", "completed", "dropped", "transferred"]).default("active"),
  fees: z.object({
    inscription: z.number().nonnegative("Les frais d'inscription doivent être positifs").default(0),
    scolarite: z.number().nonnegative("Les frais de scolarité doivent être positifs").default(0),
    annexes: z.number().nonnegative("Les frais annexes doivent être positifs").default(0),
    autres: z.number().nonnegative("Les autres frais doivent être positifs").default(0),
    currency: z.string().default("FCFA"),
  }),
});

const createEnrollmentFormSchema = enrollmentBaseSchema.extend({
  studentId: z.string().min(1, "L'étudiant est requis"),
});

const editEnrollmentFormSchema = enrollmentBaseSchema;

type CreateEnrollmentFormData = z.infer<typeof createEnrollmentFormSchema>;
type EditEnrollmentFormData = z.infer<typeof editEnrollmentFormSchema>;

interface EnrollmentFormProps {
  enrollment?: StudentEnrollment;
  academicYearId: string;
  onSubmit: (data: CreateEnrollmentFormData | EditEnrollmentFormData) => Promise<void>;
  onCancel: () => void;
  isLoading?: boolean;
  isEdit?: boolean;
  defaultStudentId?: string;
  showFeesSection?: boolean;
  showStatusField?: boolean;
}

export function EnrollmentForm({
  enrollment,
  academicYearId,
  onSubmit,
  onCancel,
  isLoading = false,
  isEdit = false,
  defaultStudentId,
  showFeesSection = true,
  showStatusField = true,
}: EnrollmentFormProps) {
  const { data: classesData } = useClasses({
    academicYearId,
    includeDetails: true,
  });
  const classes = classesData?.data || [];

  const [searchTerm, setSearchTerm] = useState("");
  const { data: studentsData } = useAvailableStudents(academicYearId, searchTerm);
  const students = studentsData?.data || [];

  const schema = isEdit ? editEnrollmentFormSchema : createEnrollmentFormSchema;
  const form = useForm<CreateEnrollmentFormData | EditEnrollmentFormData>({
    resolver: zodResolver(schema),
    defaultValues: {
      studentId: enrollment?.studentId || defaultStudentId || "",
      classId: enrollment?.classId || "",
      originSchool: enrollment?.originSchool || "",
      lv2: enrollment?.lv2 || "",
      scholarshipLevel: enrollment?.scholarshipLevel || "non",
      isRepeating: enrollment?.isRepeating ?? false,
      isTransfer: enrollment?.isTransfer ?? false,
      isInscribed: enrollment?.isInscribed ?? true,
      transferDecision: enrollment?.transferDecision || "",
      affectationStatus: enrollment?.affectationStatus || "affecte",
      affectationDecision: enrollment?.affectationDecision || "",
      cepeCode: enrollment?.cepeCode || "",
      enrollmentDate: enrollment?.enrollmentDate ? enrollment.enrollmentDate.slice(0, 10) : new Date().toISOString().slice(0, 10),
      status: enrollment?.status || "active",
      fees: {
        inscription: (enrollment?.fees as any)?.inscription || 0,
        scolarite: (enrollment?.fees as any)?.scolarite || 0,
        annexes: (enrollment?.fees as any)?.annexes || 0,
        autres: (enrollment?.fees as any)?.autres || 0,
        currency: (enrollment?.fees as any)?.currency || "FCFA",
      },
    } as any,
  });

  useEffect(() => {
    if (isEdit && enrollment?.id) {
      let fees: any = {};
      try {
        if (typeof enrollment.fees === "string") {
          fees = JSON.parse(enrollment.fees);
        } else if (enrollment.fees && typeof enrollment.fees === "object") {
          fees = enrollment.fees;
        }
      } catch (error) {
        console.error("Error parsing fees:", error);
      }

      let enrollmentDate = new Date().toISOString().slice(0, 10);
      if (enrollment.enrollmentDate) {
        try {
          const date = new Date(enrollment.enrollmentDate);
          if (!Number.isNaN(date.getTime())) {
            enrollmentDate = date.toISOString().slice(0, 10);
          }
        } catch (error) {
          console.error("Error parsing enrollment date:", error);
        }
      }

      form.reset({
        classId: enrollment.classId || "",
        originSchool: enrollment.originSchool || "",
        lv2: enrollment.lv2 || "",
        scholarshipLevel: enrollment.scholarshipLevel || "non",
        isRepeating: enrollment.isRepeating ?? false,
        isTransfer: enrollment.isTransfer ?? false,
        isInscribed: enrollment.isInscribed ?? true,
        transferDecision: enrollment.transferDecision || "",
        affectationStatus: enrollment.affectationStatus || "affecte",
        affectationDecision: enrollment.affectationDecision || "",
        cepeCode: enrollment.cepeCode || "",
        enrollmentDate,
        status: enrollment.status || "active",
        fees: {
          inscription: fees?.inscription ?? 0,
          scolarite: fees?.scolarite ?? 0,
          annexes: fees?.annexes ?? 0,
          autres: fees?.autres ?? 0,
          currency: fees?.currency || "FCFA",
        },
      } as any, {
        keepDefaultValues: false,
      });
      return;
    }

    if (!isEdit && defaultStudentId) {
      form.setValue("studentId", defaultStudentId as any, { shouldValidate: true });
    }
  }, [defaultStudentId, enrollment, form, isEdit]);

  const watchedFees = form.watch("fees");
  const watchedClassId = form.watch("classId");

  useEffect(() => {
    const fetchCycleFees = async () => {
      if (!watchedClassId || isEdit) return;

      try {
        const selectedClass = classes.find((c) => c.id === watchedClassId);
        if (!selectedClass?.programme?.id) return;

        const programmeResponse = await fetch(`/api/v1/programmes/${selectedClass.programme.id}`, {
          headers: {
            "Content-Type": "application/json",
            "X-Tenant": "imhotepacademy",
            "X-User-Id": "634a57fe-2007-4ecb-ae5b-f9e3152a24fb",
          },
        });

        if (!programmeResponse.ok) return;

        const programmeData = await programmeResponse.json();
        const cycleId = programmeData.cycleId;
        if (!cycleId) return;

        const feesResponse = await fetch(`/api/v1/cycle-fees?cycleId=${cycleId}&programmeId=${selectedClass.programme.id}`, {
          headers: {
            "Content-Type": "application/json",
            "X-Tenant": "imhotepacademy",
            "X-User-Id": "634a57fe-2007-4ecb-ae5b-f9e3152a24fb",
          },
        });

        if (feesResponse.ok) {
          const feesData = await feesResponse.json();
          if (feesData.data && feesData.data.length > 0) {
            const cycleFees = feesData.data[0];
            form.setValue("fees.inscription", cycleFees.inscription);
            form.setValue("fees.scolarite", cycleFees.scolarite);
            form.setValue("fees.annexes", cycleFees.annexes);
            form.setValue("fees.autres", cycleFees.autres);
            form.setValue("fees.currency", "FCFA");
            return;
          }
        }

        const fallbackResponse = await fetch(`/api/v1/cycle-fees?cycleId=${cycleId}`, {
          headers: {
            "Content-Type": "application/json",
            "X-Tenant": "imhotepacademy",
            "X-User-Id": "634a57fe-2007-4ecb-ae5b-f9e3152a24fb",
          },
        });

        if (fallbackResponse.ok) {
          const fallbackData = await fallbackResponse.json();
          if (fallbackData.data && fallbackData.data.length > 0) {
            const cycleFees = fallbackData.data[0];
            form.setValue("fees.inscription", cycleFees.inscription);
            form.setValue("fees.scolarite", cycleFees.scolarite);
            form.setValue("fees.annexes", cycleFees.annexes);
            form.setValue("fees.autres", cycleFees.autres);
            form.setValue("fees.currency", "FCFA");
          }
        }
      } catch (error) {
        console.error("Error fetching cycle fees:", error);
      }
    };

    void fetchCycleFees();
  }, [watchedClassId, classes, form, isEdit]);

  const handleSubmit = async (data: CreateEnrollmentFormData | EditEnrollmentFormData) => {
    try {
      await onSubmit(data);
    } catch (error) {
      console.error("Error submitting form:", error);
      alert("Erreur lors de l'enregistrement. Vérifiez que tous les champs sont correctement remplis.");
    }
  };

  const formatNumberWithSpaces = (value: number) => value.toLocaleString("fr-FR");

  const calculateTotal = () =>
    (watchedFees?.inscription || 0) +
    (watchedFees?.scolarite || 0) +
    (watchedFees?.annexes || 0) +
    (watchedFees?.autres || 0);

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(handleSubmit)} className="space-y-6">
        {!isEdit && (
          <FormField
            control={form.control}
            name="studentId"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Étudiant *</FormLabel>
                <div className="space-y-2">
                  <Input
                    placeholder="Rechercher un étudiant..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="mb-2"
                  />
                  <Select onValueChange={field.onChange} value={field.value}>
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder="Sélectionner un étudiant" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent side="bottom" sideOffset={4} position="item-aligned">
                      {students.length > 0 ? (
                        students.map((student) => (
                          <SelectItem key={student.id} value={student.id}>
                            {student.firstName} {student.lastName} ({student.studentNumber || "Pas de matricule"})
                          </SelectItem>
                        ))
                      ) : (
                        <SelectItem value="no-student" disabled>
                          {searchTerm ? "Aucun résultat" : "Aucun étudiant disponible"}
                        </SelectItem>
                      )}
                    </SelectContent>
                  </Select>
                </div>
                <FormMessage />
              </FormItem>
            )}
          />
        )}

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <FormField
            control={form.control}
            name="classId"
            render={({ field }) => (
              <FormItem className="md:col-span-2">
                <FormLabel>Classe *</FormLabel>
                <Select onValueChange={field.onChange} value={field.value}>
                  <FormControl>
                    <SelectTrigger>
                      <SelectValue placeholder="Sélectionner une classe" />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent side="bottom" sideOffset={4} position="item-aligned">
                    {classes.length > 0 ? (
                      classes.map((classe) => (
                        <SelectItem key={classe.id} value={classe.id}>
                          {classe.name} ({classe.code}) • {classe.programme?.name || ""}
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
            name="enrollmentDate"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Date inscription</FormLabel>
                <FormControl>
                  <DatePickerFr
                    value={field.value}
                    onChange={(iso) => field.onChange(iso)}
                    placeholder="jj/mm/aaaa"
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <FormField
            control={form.control}
            name="originSchool"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Établissement d'origine</FormLabel>
                <FormControl>
                  <Input {...field} value={field.value || ""} placeholder="Etabl. d'origine" />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="lv2"
            render={({ field }) => (
              <FormItem>
                <FormLabel>LV2</FormLabel>
                <FormControl>
                  <Input {...field} value={field.value || ""} placeholder="Ex: Espagnol" />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="scholarshipLevel"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Bourse</FormLabel>
                <Select onValueChange={field.onChange} value={field.value || "non"}>
                  <FormControl>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    <SelectItem value="non">Non</SelectItem>
                    <SelectItem value="oui">Oui</SelectItem>
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <FormField
            control={form.control}
            name="isRepeating"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Redoublé ?</FormLabel>
                <Select onValueChange={(value) => field.onChange(value === "oui")} value={field.value ? "oui" : "non"}>
                  <FormControl>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    <SelectItem value="non">Non</SelectItem>
                    <SelectItem value="oui">Oui</SelectItem>
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="isTransfer"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Transfert ?</FormLabel>
                <Select onValueChange={(value) => field.onChange(value === "oui")} value={field.value ? "oui" : "non"}>
                  <FormControl>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    <SelectItem value="non">Non</SelectItem>
                    <SelectItem value="oui">Oui</SelectItem>
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="isInscribed"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Inscrit ?</FormLabel>
                <Select onValueChange={(value) => field.onChange(value === "oui")} value={field.value ? "oui" : "non"}>
                  <FormControl>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    <SelectItem value="oui">Oui</SelectItem>
                    <SelectItem value="non">Non</SelectItem>
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <FormField
            control={form.control}
            name="transferDecision"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Dec. Transf.</FormLabel>
                <FormControl>
                  <Input {...field} value={field.value || ""} placeholder="Décision de transfert" />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="affectationStatus"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Statut affectation</FormLabel>
                <Select onValueChange={field.onChange} value={field.value || "affecte"}>
                  <FormControl>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    <SelectItem value="affecte">Affecté(e)</SelectItem>
                    <SelectItem value="non_affecte">Non affecté(e)</SelectItem>
                    <SelectItem value="prise_en_charge">Prise en charge</SelectItem>
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <FormField
            control={form.control}
            name="affectationDecision"
            render={({ field }) => (
              <FormItem className="md:col-span-2">
                <FormLabel>Décision affect.</FormLabel>
                <FormControl>
                  <Input {...field} value={field.value || ""} placeholder="Décision d'affectation" />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="cepeCode"
            render={({ field }) => (
              <FormItem>
                <FormLabel>CodeEP+N°TableCEPE</FormLabel>
                <FormControl>
                  <Input {...field} value={field.value || ""} placeholder="Code CEPE" />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>

        {showStatusField && (
          <FormField
            control={form.control}
            name="status"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Statut d'inscription</FormLabel>
                <Select onValueChange={field.onChange} value={field.value}>
                  <FormControl>
                    <SelectTrigger>
                      <SelectValue placeholder="Sélectionner un statut" />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    <SelectItem value="active">Actif</SelectItem>
                    <SelectItem value="suspended">Suspendu</SelectItem>
                    <SelectItem value="completed">Terminé</SelectItem>
                    <SelectItem value="dropped">Abandonné</SelectItem>
                    <SelectItem value="transferred">Transféré</SelectItem>
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )}
          />
        )}

        {showFeesSection && (
          <div>
            <div className="flex items-center space-x-2 mb-4">
              <DollarSign className="h-4 w-4" />
              <FormLabel>Frais d'inscription (FCFA)</FormLabel>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="fees.inscription"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-sm">Inscription</FormLabel>
                    <FormControl>
                      <Input
                        type="text"
                        placeholder="Ex: 25 000"
                        value={field.value ? formatNumberWithSpaces(field.value) : ""}
                        onChange={(e) => {
                          const value = e.target.value.replace(/\s/g, "");
                          field.onChange(parseInt(value, 10) || 0);
                        }}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="fees.scolarite"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-sm">Scolarité</FormLabel>
                    <FormControl>
                      <Input
                        type="text"
                        placeholder="Ex: 80 000"
                        value={field.value ? formatNumberWithSpaces(field.value) : ""}
                        onChange={(e) => {
                          const value = e.target.value.replace(/\s/g, "");
                          field.onChange(parseInt(value, 10) || 0);
                        }}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="fees.annexes"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-sm">Frais annexes</FormLabel>
                    <FormControl>
                      <Input
                        type="text"
                        placeholder="Ex: 1 500"
                        value={field.value ? formatNumberWithSpaces(field.value) : ""}
                        onChange={(e) => {
                          const value = e.target.value.replace(/\s/g, "");
                          field.onChange(parseInt(value, 10) || 0);
                        }}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="fees.autres"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-sm">Autres frais</FormLabel>
                    <FormControl>
                      <Input
                        type="text"
                        placeholder="Ex: 3 000"
                        value={field.value ? formatNumberWithSpaces(field.value) : ""}
                        onChange={(e) => {
                          const value = e.target.value.replace(/\s/g, "");
                          field.onChange(parseInt(value, 10) || 0);
                        }}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <div className="mt-4 p-3 bg-gray-50 rounded-lg">
              <div className="flex justify-between items-center">
                <span className="font-medium">Total:</span>
                <span className="text-lg font-bold text-blue-600">
                  {calculateTotal().toLocaleString("fr-FR")} FCFA
                </span>
              </div>
            </div>
          </div>
        )}

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
            className="flex-1 px-6 py-3 bg-gradient-to-r from-cyan-500 to-blue-600 text-white rounded-lg hover:from-cyan-600 hover:to-blue-700 transition-all duration-200 disabled:opacity-50 font-medium shadow-lg hover:shadow-xl"
            disabled={isLoading}
          >
            {isLoading ? (
              <span className="flex items-center justify-center">
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Enregistrement...
              </span>
            ) : isEdit ? (
              "Modifier l'inscription"
            ) : (
              "Créer l'inscription"
            )}
          </button>
        </div>
      </form>
    </Form>
  );
}
