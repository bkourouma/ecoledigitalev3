"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Button,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@ecoledigitale/ui";
import { ArrowLeft, Save, Loader2, Plus, X, Users, ChevronDown, Search } from "lucide-react";
import { useCreateParent, useAssignStudentToParent, AssignStudentToParentData } from "@/lib/hooks/use-parents";
import { useStudents } from "@/lib/hooks/use-students";
import { StudentWithUser } from "@ecoledigitale/contracts";

const generatePassword = (): string => {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*";
  let password = "";
  for (let i = 0; i < 12; i++) {
    password += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return password;
};

const parentFormSchema = z.object({
  firstName: z.string().min(1, "Le prénom est requis").max(100, "Le prénom ne peut pas dépasser 100 caractères"),
  lastName: z.string().min(1, "Le nom est requis").max(100, "Le nom ne peut pas dépasser 100 caractères"),
  email: z.string().email("Email invalide"),
  phone: z.string().max(20, "Le numéro de téléphone ne peut pas dépasser 20 caractères").optional().or(z.literal("")),
});

type ParentFormData = z.infer<typeof parentFormSchema>;

type RelationshipType = "parent" | "guardian" | "emergency_contact";

interface LinkedChild {
  studentId: string;
  studentLabel: string;
  relationshipType: RelationshipType;
  isPrimaryContact: boolean;
  emergencyContact: boolean;
  canPickup: boolean;
}

const getStudentName = (student: StudentWithUser): string => {
  if (student.user?.firstName && student.user?.lastName) {
    return `${student.user.firstName} ${student.user.lastName}`;
  }
  return student.user?.email || "Étudiant inconnu";
};

interface StudentComboboxProps {
  id: string;
  students: StudentWithUser[];
  value: string;
  onChange: (studentId: string) => void;
  isLoading: boolean;
}

/** Select avec recherche intégrée : le champ de recherche vit dans le panneau déroulant. */
function StudentCombobox({ id, students, value, onChange, isLoading }: StudentComboboxProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const containerRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;

    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };

    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleEscape);
    searchRef.current?.focus();

    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [open]);

  const filteredStudents = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (!needle) return students;
    return students.filter((student) => {
      const haystack = `${getStudentName(student)} ${student.studentNumber || ""} ${student.user?.email || ""}`.toLowerCase();
      return haystack.includes(needle);
    });
  }, [students, search]);

  const selectedStudent = students.find((student) => student.id === value);

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        id={id}
        onClick={() => setOpen((current) => !current)}
        className="flex h-10 w-full items-center justify-between rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
      >
        <span className={selectedStudent ? "line-clamp-1" : "line-clamp-1 text-muted-foreground"}>
          {selectedStudent ? getStudentName(selectedStudent) : "Sélectionner un étudiant"}
        </span>
        <ChevronDown className="h-4 w-4 opacity-50 shrink-0" />
      </button>

      {open && (
        <div className="absolute z-50 mt-1 w-full rounded-md border bg-popover text-popover-foreground shadow-md">
          <div className="relative border-b p-2">
            <Search className="absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              ref={searchRef}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Rechercher un étudiant..."
              className="h-9 pl-8"
            />
          </div>

          <div className="max-h-60 overflow-y-auto p-1">
            {isLoading ? (
              <p className="px-3 py-2 text-sm text-muted-foreground">Chargement...</p>
            ) : students.length === 0 ? (
              <p className="px-3 py-2 text-sm text-muted-foreground">
                Aucun étudiant sans parent disponible
              </p>
            ) : filteredStudents.length === 0 ? (
              <p className="px-3 py-2 text-sm text-muted-foreground">Aucun étudiant trouvé</p>
            ) : (
              filteredStudents.map((student) => (
                <button
                  key={student.id}
                  type="button"
                  onClick={() => {
                    onChange(student.id);
                    setSearch("");
                    setOpen(false);
                  }}
                  className={`flex w-full items-center rounded-sm px-3 py-2 text-left text-sm hover:bg-accent hover:text-accent-foreground ${
                    student.id === value ? "bg-accent text-accent-foreground" : ""
                  }`}
                >
                  {getStudentName(student)}
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default function NewParentPage() {
  const router = useRouter();
  const createParent = useCreateParent();
  const assignMutation = useAssignStudentToParent();

  const [linkedChildren, setLinkedChildren] = useState<LinkedChild[]>([]);
  const [studentToAdd, setStudentToAdd] = useState("");

  // Pas de filtre d'année : le rattachement parent-enfant n'a pas de dimension
  // annuelle, et filtrer ici vidait la liste des étudiants proposables.
  const { data: studentsData, isLoading: isLoadingStudents } = useStudents({
    limit: 1000,
  });

  const students: StudentWithUser[] = studentsData?.data || [];

  // Seuls les étudiants qui n'ont encore aucun parent rattaché sont proposés,
  // moins ceux déjà ajoutés à la liste en cours de saisie.
  const availableStudents = useMemo(
    () =>
      students.filter(
        (student) =>
          (student.parentsCount ?? 0) === 0 &&
          !linkedChildren.some((child) => child.studentId === student.id)
      ),
    [students, linkedChildren]
  );

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<ParentFormData>({
    resolver: zodResolver(parentFormSchema),
  });

  const handleAddChild = () => {
    if (!studentToAdd) return;
    const student = students.find((s) => s.id === studentToAdd);
    if (!student) return;

    setLinkedChildren((current) => [
      ...current,
      {
        studentId: student.id,
        studentLabel: getStudentName(student),
        relationshipType: "parent",
        isPrimaryContact: current.length === 0,
        emergencyContact: false,
        canPickup: true,
      },
    ]);
    setStudentToAdd("");
  };

  const handleRemoveChild = (studentId: string) => {
    setLinkedChildren((current) => current.filter((child) => child.studentId !== studentId));
  };

  const handleUpdateChild = (studentId: string, changes: Partial<LinkedChild>) => {
    setLinkedChildren((current) =>
      current.map((child) => (child.studentId === studentId ? { ...child, ...changes } : child))
    );
  };

  const onSubmit = async (data: ParentFormData) => {
    let parentId: string | undefined;
    // Renseigné par l'API quand l'envoi SMTP des identifiants a échoué.
    let credentialsEmailError: string | null = null;

    try {
      const result = await createParent.mutateAsync({
        firstName: data.firstName,
        lastName: data.lastName,
        email: data.email,
        password: generatePassword(),
        phone: data.phone || undefined,
      });
      parentId = result?.data?.id;
      if (result?.emailSent === false && result?.emailError) {
        credentialsEmailError = result.emailError;
      }
    } catch (error: any) {
      console.error("Error creating parent:", error);
      alert(error.message || "Erreur lors de la création du parent");
      return;
    }

    if (linkedChildren.length > 0 && !parentId) {
      alert(
        "Le parent a été créé, mais son identifiant n'a pas été renvoyé : les enfants n'ont pas pu être assignés. Utilisez la page d'assignation."
      );
      router.push("/academic/parents");
      return;
    }

    const failures: string[] = [];

    for (const child of linkedChildren) {
      const payload: AssignStudentToParentData = {
        parentId: parentId as string,
        relationshipType: child.relationshipType,
        isPrimaryContact: child.isPrimaryContact,
        emergencyContact: child.emergencyContact,
        canPickup: child.canPickup,
      };

      try {
        await assignMutation.mutateAsync({ studentId: child.studentId, data: payload });
      } catch (error: any) {
        console.error("Error assigning student to parent:", error);
        failures.push(`${child.studentLabel} : ${error.message || "erreur inconnue"}`);
      }
    }

    if (failures.length > 0) {
      alert(
        `Le parent a été créé, mais certaines assignations ont échoué :\n\n${failures.join(
          "\n"
        )}\n\nVous pouvez les reprendre depuis la page d'assignation.`
      );
    }

    if (credentialsEmailError) {
      alert(
        `Le parent a été créé, mais l'envoi de ses identifiants par email a échoué :\n\n${credentialsEmailError}`
      );
    }

    router.push("/academic/parents");
  };

  const isBusy = isSubmitting || createParent.isPending || assignMutation.isPending;

  return (
    <div className="container mx-auto px-6 py-8 max-w-3xl">
      <div className="mb-6 flex max-w-full flex-col items-start gap-2 overflow-x-auto md:mb-8 md:gap-3">
        <Button variant="outline" size="sm" onClick={() => router.back()}>
          <ArrowLeft className="h-4 w-4 mr-2" />
          Retour
        </Button>
        <div>
          <h1 className="whitespace-nowrap font-bold bg-gradient-to-r from-blue-600 to-purple-600 bg-clip-text text-transparent text-2xl leading-tight md:text-3xl">
            Nouveau parent
          </h1>
          <p className="whitespace-nowrap text-muted-foreground text-sm md:text-base">Ajoutez un nouveau parent à votre système</p>
        </div>
      </div>

      <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle>Informations personnelles</CardTitle>
            <CardDescription>Informations de base sur le parent</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="firstName">Prénom *</Label>
                <Input id="firstName" {...register("firstName")} placeholder="Prénom" />
                {errors.firstName && <p className="text-sm text-red-600">{errors.firstName.message}</p>}
              </div>

              <div className="space-y-2">
                <Label htmlFor="lastName">Nom *</Label>
                <Input id="lastName" {...register("lastName")} placeholder="Nom" />
                {errors.lastName && <p className="text-sm text-red-600">{errors.lastName.message}</p>}
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="email">Email *</Label>
              <Input id="email" type="email" {...register("email")} placeholder="email@example.com" />
              {errors.email && <p className="text-sm text-red-600">{errors.email.message}</p>}
            </div>

            <div className="space-y-2">
              <Label htmlFor="phone">Téléphone</Label>
              <Input id="phone" type="tel" {...register("phone")} placeholder="+225 07 07 12 34 56" />
              {errors.phone && <p className="text-sm text-red-600">{errors.phone.message}</p>}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Enfants à assigner (optionnel)</CardTitle>
            <CardDescription>
              Seuls les étudiants qui n&apos;ont encore aucun parent assigné sont proposés.
              L&apos;assignation sera effectuée automatiquement après la création du parent.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="studentToAdd">Étudiant</Label>
              <div className="flex gap-2">
                <div className="flex-1">
                  <StudentCombobox
                    id="studentToAdd"
                    students={availableStudents}
                    value={studentToAdd}
                    onChange={setStudentToAdd}
                    isLoading={isLoadingStudents}
                  />
                </div>
                <Button type="button" variant="outline" onClick={handleAddChild} disabled={!studentToAdd}>
                  <Plus className="h-4 w-4 mr-2" />
                  Ajouter
                </Button>
              </div>
            </div>

            {linkedChildren.length === 0 ? (
              <div className="text-center py-8 border rounded-lg border-dashed">
                <Users className="mx-auto h-10 w-10 text-gray-400 mb-3" />
                <p className="text-gray-600 text-sm">
                  Aucun enfant sélectionné. Le parent sera créé sans assignation.
                </p>
              </div>
            ) : (
              <div className="space-y-4">
                {linkedChildren.map((child) => (
                  <div key={child.studentId} className="border rounded-lg p-4 space-y-4">
                    <div className="flex items-start justify-between gap-4">
                      <p className="font-medium">{child.studentLabel}</p>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => handleRemoveChild(child.studentId)}
                      >
                        <X className="h-4 w-4 mr-2" />
                        Retirer
                      </Button>
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor={`relationshipType-${child.studentId}`}>Type de relation *</Label>
                      <Select
                        value={child.relationshipType}
                        onValueChange={(value: string) =>
                          handleUpdateChild(child.studentId, { relationshipType: value as RelationshipType })
                        }
                      >
                        <SelectTrigger id={`relationshipType-${child.studentId}`}>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="parent">Parent</SelectItem>
                          <SelectItem value="guardian">Tuteur</SelectItem>
                          <SelectItem value="emergency_contact">Contact d&apos;urgence</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="space-y-3">
                      <div className="flex items-center space-x-2">
                        <input
                          type="checkbox"
                          id={`isPrimaryContact-${child.studentId}`}
                          checked={child.isPrimaryContact}
                          onChange={(e) =>
                            handleUpdateChild(child.studentId, { isPrimaryContact: e.target.checked })
                          }
                          className="rounded"
                        />
                        <Label htmlFor={`isPrimaryContact-${child.studentId}`} className="cursor-pointer">
                          Contact principal
                        </Label>
                      </div>

                      <div className="flex items-center space-x-2">
                        <input
                          type="checkbox"
                          id={`emergencyContact-${child.studentId}`}
                          checked={child.emergencyContact}
                          onChange={(e) =>
                            handleUpdateChild(child.studentId, { emergencyContact: e.target.checked })
                          }
                          className="rounded"
                        />
                        <Label htmlFor={`emergencyContact-${child.studentId}`} className="cursor-pointer">
                          Contact d&apos;urgence
                        </Label>
                      </div>

                      <div className="flex items-center space-x-2">
                        <input
                          type="checkbox"
                          id={`canPickup-${child.studentId}`}
                          checked={child.canPickup}
                          onChange={(e) => handleUpdateChild(child.studentId, { canPickup: e.target.checked })}
                          className="rounded"
                        />
                        <Label htmlFor={`canPickup-${child.studentId}`} className="cursor-pointer">
                          Autorisé à récupérer l&apos;étudiant
                        </Label>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <div className="flex justify-end gap-4">
          <Button type="button" variant="outline" onClick={() => router.back()}>
            Annuler
          </Button>
          <Button type="submit" disabled={isBusy} className="bg-emerald-600 hover:bg-emerald-700 text-white">
            {isBusy ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                {createParent.isPending ? "Création..." : "Assignation..."}
              </>
            ) : (
              <>
                <Save className="h-4 w-4 mr-2" />
                {linkedChildren.length > 0
                  ? `Créer le parent et assigner ${linkedChildren.length} enfant${linkedChildren.length > 1 ? "s" : ""}`
                  : "Créer le parent"}
              </>
            )}
          </Button>
        </div>
      </form>
    </div>
  );
}
