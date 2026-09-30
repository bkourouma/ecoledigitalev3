"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
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
  Badge,
} from "@ecoledigitale/ui";
import { ArrowLeft, Save, Loader2, Users, X } from "lucide-react";
import { useStudents } from "@/lib/hooks/use-students";
import { useParents, useAssignStudentToParent, useStudentParents, useUnassignStudentFromParent } from "@/lib/hooks/use-parents";
import { StudentWithUser } from "@ecoledigitale/contracts";
import { FormMessage } from "@/components/ui/form-message";
import { ConfirmationDialog } from "@/components/ui/confirmation-dialog";

export default function AssignStudentsToParentPage() {
  const router = useRouter();
  const [selectedStudentId, setSelectedStudentId] = useState<string>("");
  const [selectedParentId, setSelectedParentId] = useState<string>("");
  const [relationshipType, setRelationshipType] = useState<'parent' | 'guardian' | 'emergency_contact'>('parent');
  const [isPrimaryContact, setIsPrimaryContact] = useState(false);
  const [emergencyContact, setEmergencyContact] = useState(false);
  const [canPickup, setCanPickup] = useState(true);
  // Résultat de la dernière action, affiché dans la page (et non dans une alerte
  // du navigateur, qui bloque l'onglet et disparaît sans laisser de trace).
  const [feedback, setFeedback] = useState<{ text: string; variant: "error" | "success" } | null>(null);
  // Parent dont le retrait attend confirmation.
  const [parentToUnassign, setParentToUnassign] = useState<string | null>(null);

  // Le rattachement parent-enfant n'a pas de dimension annuelle : la table de
  // liaison ne porte aucune année scolaire. Filtrer ces deux listes sur
  // l'année active vidait donc l'écran dès qu'un établissement n'inscrit pas
  // ses étudiants par année académique -- c'est le cas du module professionnel,
  // où les 63 étudiants et 46 parents du tenant devenaient 0 de part et d'autre,
  // sans le moindre message.
  const { data: studentsData, isLoading: isLoadingStudents } = useStudents({
    limit: 1000,
  });
  const { data: parentsData, isLoading: isLoadingParents } = useParents({
    limit: 1000,
  });
  const { data: studentParentsData, isLoading: isLoadingStudentParents } = useStudentParents(selectedStudentId || "");
  
  const assignMutation = useAssignStudentToParent();
  const unassignMutation = useUnassignStudentFromParent();

  const students = studentsData?.data || [];
  const parents = parentsData?.data?.parents || [];
  const studentParents = selectedStudentId ? (studentParentsData?.data?.parents || []) : [];

  const handleAssign = async () => {
    setFeedback(null);
    if (!selectedStudentId || !selectedParentId) {
      setFeedback({ text: "Veuillez sélectionner un étudiant et un parent", variant: "error" });
      return;
    }

    try {
      await assignMutation.mutateAsync({
        studentId: selectedStudentId,
        data: {
          parentId: selectedParentId,
          relationshipType,
          isPrimaryContact,
          emergencyContact,
          canPickup,
        },
      });
      setFeedback({ text: "Étudiant assigné au parent avec succès", variant: "success" });
      setSelectedParentId("");
      setRelationshipType('parent');
      setIsPrimaryContact(false);
      setEmergencyContact(false);
      setCanPickup(true);
    } catch (error: any) {
      setFeedback({ text: error.message || "Erreur lors de l'assignation", variant: "error" });
    }
  };

  const handleUnassign = async (parentId: string) => {
    if (!selectedStudentId) return;
    setFeedback(null);

    try {
      await unassignMutation.mutateAsync({
        studentId: selectedStudentId,
        parentId,
      });
      setFeedback({ text: "Parent retiré avec succès", variant: "success" });
    } catch (error: any) {
      setFeedback({ text: error.message || "Erreur lors du retrait", variant: "error" });
    }
  };

  const selectedStudent = students.find((s: StudentWithUser) => s.id === selectedStudentId);

  return (
    <div className="container mx-auto px-6 py-8 max-w-4xl">
      {/* Header */}
      <div className="mb-6 flex max-w-full flex-col items-start gap-2 overflow-x-auto md:mb-8 md:gap-3">
        <Button
          variant="outline"
          size="sm"
          onClick={() => router.back()}
        >
          <ArrowLeft className="h-4 w-4 mr-2" />
          Retour
        </Button>
        <div>
          <h1 className="whitespace-nowrap font-bold bg-gradient-to-r from-blue-600 to-purple-600 bg-clip-text text-transparent text-2xl leading-tight md:text-3xl">
            Assigner des étudiants aux parents
          </h1>
          <p className="whitespace-nowrap text-muted-foreground text-sm md:text-base">
            Créez des relations entre les étudiants et leurs parents
          </p>
        </div>
      </div>

      <div className="space-y-6">
        <FormMessage message={feedback?.text} variant={feedback?.variant} />

        {/* Student Selection */}
        <Card>
          <CardHeader>
            <CardTitle>1. Sélectionner un étudiant</CardTitle>
            <CardDescription>
              Choisissez l'étudiant pour lequel vous souhaitez gérer les parents
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="student">Étudiant *</Label>
              <Select value={selectedStudentId} onValueChange={setSelectedStudentId}>
                <SelectTrigger id="student">
                  <SelectValue placeholder="Sélectionner un étudiant" />
                </SelectTrigger>
                <SelectContent side="bottom" sideOffset={4} position="item-aligned">
                  {isLoadingStudents ? (
                    <SelectItem value="loading" disabled>Chargement...</SelectItem>
                  ) : (
                    students.map((student: StudentWithUser) => {
                      const name = student.user?.firstName && student.user?.lastName
                        ? `${student.user.firstName} ${student.user.lastName}`
                        : student.user?.name || student.user?.email || "Étudiant inconnu";
                      return (
                        <SelectItem key={student.id} value={student.id}>
                          {name} {student.studentNumber ? `(${student.studentNumber})` : ''}
                        </SelectItem>
                      );
                    })
                  )}
                </SelectContent>
              </Select>
            </div>

            {selectedStudent && (
              <div className="p-4 bg-blue-50 rounded-lg">
                <p className="font-medium text-blue-900">
                  Étudiant sélectionné: {selectedStudent.user?.firstName} {selectedStudent.user?.lastName}
                </p>
                <p className="text-sm text-blue-700">
                  {selectedStudent.user?.email}
                </p>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Current Parents */}
        {selectedStudentId && (
          <Card>
            <CardHeader>
              <CardTitle>Parents actuels</CardTitle>
              <CardDescription>
                Liste des parents déjà assignés à cet étudiant
              </CardDescription>
            </CardHeader>
            <CardContent>
              {isLoadingStudentParents ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="h-6 w-6 animate-spin text-emerald-600" />
                </div>
              ) : studentParents.length === 0 ? (
                <p className="text-gray-600 text-center py-4">Aucun parent assigné</p>
              ) : (
                <div className="space-y-2">
                  {studentParents.map((parent: any) => (
                    <div key={parent.relationshipId} className="flex items-center justify-between p-3 border rounded-lg">
                      <div className="flex-1">
                        <p className="font-medium">{parent.name}</p>
                        <p className="text-sm text-gray-600">{parent.email}</p>
                        <div className="flex gap-2 mt-2">
                          <Badge variant="secondary">{parent.relationshipType}</Badge>
                          {parent.isPrimaryContact && <Badge variant="default">Contact principal</Badge>}
                          {parent.emergencyContact && <Badge variant="default">Contact d'urgence</Badge>}
                        </div>
                      </div>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setParentToUnassign(parent.id)}
                        disabled={unassignMutation.isPending}
                      >
                        <X className="h-4 w-4 mr-2" />
                        Retirer
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {/* Assign New Parent */}
        {selectedStudentId && (
          <Card>
            <CardHeader>
              <CardTitle>2. Assigner un nouveau parent</CardTitle>
              <CardDescription>
                Sélectionnez un parent et configurez la relation
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="parent">Parent *</Label>
                <Select value={selectedParentId} onValueChange={setSelectedParentId}>
                  <SelectTrigger id="parent">
                    <SelectValue placeholder="Sélectionner un parent" />
                  </SelectTrigger>
                  <SelectContent>
                    {isLoadingParents ? (
                      <SelectItem value="loading" disabled>Chargement...</SelectItem>
                    ) : (
                      parents
                        .filter((parent: any) => !studentParents.some((sp: any) => sp.id === parent.id))
                        .map((parent: any) => (
                          <SelectItem key={parent.id} value={parent.id}>
                            {parent.name} ({parent.email})
                          </SelectItem>
                        ))
                    )}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="relationshipType">Type de relation *</Label>
                <Select value={relationshipType} onValueChange={(value: any) => setRelationshipType(value)}>
                  <SelectTrigger id="relationshipType">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="parent">Parent</SelectItem>
                    <SelectItem value="guardian">Tuteur</SelectItem>
                    <SelectItem value="emergency_contact">Contact d'urgence</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-3">
                <div className="flex items-center space-x-2">
                  <input
                    type="checkbox"
                    id="isPrimaryContact"
                    checked={isPrimaryContact}
                    onChange={(e) => setIsPrimaryContact(e.target.checked)}
                    className="rounded"
                  />
                  <Label htmlFor="isPrimaryContact" className="cursor-pointer">
                    Contact principal
                  </Label>
                </div>

                <div className="flex items-center space-x-2">
                  <input
                    type="checkbox"
                    id="emergencyContact"
                    checked={emergencyContact}
                    onChange={(e) => setEmergencyContact(e.target.checked)}
                    className="rounded"
                  />
                  <Label htmlFor="emergencyContact" className="cursor-pointer">
                    Contact d'urgence
                  </Label>
                </div>

                <div className="flex items-center space-x-2">
                  <input
                    type="checkbox"
                    id="canPickup"
                    checked={canPickup}
                    onChange={(e) => setCanPickup(e.target.checked)}
                    className="rounded"
                  />
                  <Label htmlFor="canPickup" className="cursor-pointer">
                    Autorisé à récupérer l'étudiant
                  </Label>
                </div>
              </div>

              <div className="flex justify-end gap-4 pt-4">
                <Button
                  variant="outline"
                  onClick={() => router.back()}
                >
                  Annuler
                </Button>
                <Button
                  onClick={handleAssign}
                  disabled={!selectedParentId || assignMutation.isPending}
                  className="bg-emerald-600 hover:bg-emerald-700 text-white"
                >
                  {assignMutation.isPending ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      Assignation...
                    </>
                  ) : (
                    <>
                      <Users className="h-4 w-4 mr-2" />
                      Assigner
                    </>
                  )}
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        {!selectedStudentId && (
          <Card>
            <CardContent className="pt-6">
              <div className="text-center py-8">
                <Users className="mx-auto h-12 w-12 text-gray-400 mb-4" />
                <p className="text-gray-600">
                  Veuillez sélectionner un étudiant pour commencer
                </p>
              </div>
            </CardContent>
          </Card>
        )}
      </div>

      <ConfirmationDialog
        open={parentToUnassign !== null}
        onOpenChange={(open) => {
          if (!open) setParentToUnassign(null);
        }}
        title="Retirer ce parent ?"
        description="Êtes-vous sûr de vouloir retirer ce parent de l'étudiant ?"
        confirmText="Retirer"
        variant="destructive"
        onConfirm={() => {
          const id = parentToUnassign;
          setParentToUnassign(null);
          if (id) void handleUnassign(id);
        }}
      />
    </div>
  );
}

