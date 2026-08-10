"use client";

import { useState } from "react";
import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@ecoledigitale/ui";
import {
  ClipboardList,
  Plus,
  Loader2,
  Edit2,
  Trash2,
  X,
  CheckCircle2,
  BookOpen,
  FileText,
  Brain,
  Clock,
  Upload,
  ListChecks,
} from "lucide-react";
import { AssignmentQuestionsManager } from "@/components/professional/AssignmentQuestionsManager";
import {
  useAssignments,
  useAssignmentSubmissions,
  useCreateAssignment,
  useDeleteAssignment,
  useGradeSubmission,
  useUpdateAssignment,
  useUploadAssignmentSubjectDocument,
  openAssignmentSubjectDocument,
  openSubmissionFile,
} from "@/lib/hooks/use-professional-assignments";
import { SubmissionAnswersReviewer } from "@/components/professional/SubmissionAnswersReviewer";

interface Props {
  subjectId: string;
  sessionId?: string;
  canManage?: boolean;
}

const STATUT_OPTIONS = [
  { value: "brouillon", label: "Brouillon" },
  { value: "publie", label: "Publié" },
  { value: "cloture", label: "Clôturé" },
];

<<<<<<< HEAD
const EVALUATION_TYPES = [
=======
export const EVALUATION_TYPES = [
>>>>>>> 030-pedagogie-ue-ecue
  {
    id: "online" as const,
    name: "Évaluation en ligne",
    short: "En ligne",
    description: "Questions interactives (QCM, réponses courtes / longues, vrai/faux)",
    icon: BookOpen,
    color: "from-green-500 to-emerald-600",
    border: "border-green-500",
    ring: "ring-green-200 dark:ring-green-800",
    bg: "bg-green-50 dark:bg-green-950/20",
  },
  {
    id: "pdf" as const,
    name: "Évaluation à sujet unique",
    short: "Sujet PDF",
    description: "Sujet au format PDF ou texte, avec remise de fichier(s) par l'étudiant",
    icon: FileText,
    color: "from-blue-500 to-cyan-600",
    border: "border-blue-500",
    ring: "ring-blue-200 dark:ring-blue-800",
    bg: "bg-blue-50 dark:bg-blue-950/20",
  },
  {
    id: "ai_generated" as const,
    name: "Évaluation IA",
    short: "IA",
    description: "Génération automatique de questions à partir des supports de la matière",
    icon: Brain,
    color: "from-purple-500 to-pink-600",
    border: "border-purple-500",
    ring: "ring-purple-200 dark:ring-purple-800",
    bg: "bg-purple-50 dark:bg-purple-950/20",
  },
];

<<<<<<< HEAD
const EVALUATION_TYPE_LABEL: Record<string, string> = {
=======
export const EVALUATION_TYPE_LABEL: Record<string, string> = {
>>>>>>> 030-pedagogie-ue-ecue
  online: "En ligne",
  pdf: "Sujet PDF",
  ai_generated: "IA",
};

const DIFFICULTY_OPTIONS = [
  { value: "easy", label: "Facile" },
  { value: "medium", label: "Moyenne" },
  { value: "hard", label: "Difficile" },
];

const SHOW_RESULTS_OPTIONS = [
  { value: "immediately", label: "Immédiatement après soumission" },
  { value: "after_correction", label: "Après correction" },
  { value: "never", label: "Jamais" },
];

export function ProfessionalAssignmentsPanel({ subjectId, sessionId, canManage = false }: Props) {
  const listQuery = useAssignments({ ecue_id: subjectId });
  const items: any[] = listQuery.data ?? [];

  const [showCreate, setShowCreate] = useState(false);
  const [editing, setEditing] = useState<any | null>(null);
  const [gradingFor, setGradingFor] = useState<any | null>(null);
  const [managingQuestionsFor, setManagingQuestionsFor] = useState<any | null>(null);
  const [error, setError] = useState<string | null>(null);

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-2">
          <div>
            <CardTitle>Évaluations</CardTitle>
            <CardDescription>
              Devoirs, contrôles, projets… Notation côté enseignant.
            </CardDescription>
          </div>
          {canManage && (
            <Button onClick={() => setShowCreate(true)}>
              <Plus className="h-4 w-4 mr-2" />
              Nouvelle évaluation
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {error && (
          <div className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700">
            {error}
          </div>
        )}

        {listQuery.isLoading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : items.length === 0 ? (
          <p className="text-sm text-muted-foreground py-4">Aucune évaluation pour cette matière.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs uppercase text-muted-foreground border-b">
                <tr>
                  <th className="py-2 pr-2">Titre</th>
                  <th className="py-2 pr-2">Type</th>
                  <th className="py-2 pr-2 text-right">/Note</th>
                  <th className="py-2 pr-2 text-right">Coef.</th>
                  <th className="py-2 pr-2">Échéance</th>
                  <th className="py-2 pr-2">Statut</th>
                  <th className="py-2 pr-2 text-right">Soumis</th>
                  <th className="py-2 pr-2 text-right">Notés</th>
                  <th className="py-2 pr-2"></th>
                </tr>
              </thead>
              <tbody>
                {items.map((a) => (
                  <tr key={a.id} className="border-b last:border-0">
                    <td className="py-2 pr-2 font-medium">
                      <button
                        type="button"
                        onClick={() => setGradingFor(a)}
                        className="text-blue-600 hover:underline text-left"
                      >
                        {a.titre}
                      </button>
                    </td>
                    <td className="py-2 pr-2 whitespace-nowrap">
                      <span
                        className={`inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full whitespace-nowrap border ${
                          a.evaluation_type === "online"
                            ? "bg-green-500/15 text-green-500 border-green-500/40"
                            : a.evaluation_type === "ai_generated"
                              ? "bg-purple-500/15 text-purple-500 border-purple-500/40"
                              : "bg-blue-500/15 text-blue-500 border-blue-500/40"
                        }`}
                      >
                        {a.evaluation_type === "online" && (
                          <BookOpen className="h-3 w-3" />
                        )}
                        {a.evaluation_type === "ai_generated" && (
                          <Brain className="h-3 w-3" />
                        )}
                        {a.evaluation_type === "pdf" && (
                          <FileText className="h-3 w-3" />
                        )}
                        {EVALUATION_TYPE_LABEL[a.evaluation_type] ?? "—"}
                      </span>
                    </td>
                    <td className="py-2 pr-2 text-right font-mono">{a.note_max}</td>
                    <td className="py-2 pr-2 text-right font-mono">{a.coefficient}</td>
                    <td className="py-2 pr-2 text-xs whitespace-nowrap">
                      {a.due_at ? new Date(a.due_at).toLocaleString("fr-FR") : "—"}
                    </td>
                    <td className="py-2 pr-2">
                      <span
                        className={`text-xs px-2 py-0.5 rounded-full ${
                          a.statut === "publie"
                            ? "bg-green-100 text-green-700"
                            : a.statut === "brouillon"
                              ? "bg-gray-100 text-gray-700"
                              : "bg-amber-100 text-amber-700"
                        }`}
                      >
                        {a.statut}
                      </span>
                    </td>
                    <td className="py-2 pr-2 text-right font-mono">{a.nb_soumis}</td>
                    <td className="py-2 pr-2 text-right font-mono">{a.nb_notes}</td>
                    <td className="py-2 pr-2 text-right whitespace-nowrap">
                      {canManage &&
                        (a.evaluation_type === "online" ||
                          a.evaluation_type === "ai_generated") && (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => setManagingQuestionsFor(a)}
                            title="Gérer les questions"
                            className="mr-1"
                          >
                            <ListChecks className="h-4 w-4" />
                          </Button>
                        )}
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => setGradingFor(a)}
                        title="Corriger"
                      >
                        <ClipboardList className="h-4 w-4" />
                      </Button>
                      {canManage && (
                        <>
                          <Button
                            size="sm"
                            variant="outline"
                            className="ml-1"
                            onClick={() => setEditing(a)}
                            title="Modifier"
                          >
                            <Edit2 className="h-4 w-4" />
                          </Button>
                          <DeleteAssignmentBtn id={a.id} onError={setError} />
                        </>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>

      {(showCreate || editing) && (
        <AssignmentForm
          subjectId={subjectId}
          sessionId={sessionId}
          initial={editing}
          onClose={() => {
            setShowCreate(false);
            setEditing(null);
          }}
          onError={setError}
        />
      )}

      {gradingFor && (
        <GradingModal
          assignment={gradingFor}
          canManage={canManage}
          onClose={() => setGradingFor(null)}
        />
      )}

      {managingQuestionsFor && (
        <AssignmentQuestionsManager
          assignment={managingQuestionsFor}
          onClose={() => setManagingQuestionsFor(null)}
        />
      )}
    </Card>
  );
}

<<<<<<< HEAD
function DeleteAssignmentBtn({ id, onError }: { id: string; onError: (m: string) => void }) {
=======
export function DeleteAssignmentBtn({ id, onError }: { id: string; onError: (m: string) => void }) {
>>>>>>> 030-pedagogie-ue-ecue
  const delMut = useDeleteAssignment();
  return (
    <Button
      size="sm"
      variant="outline"
      className="ml-1 text-red-600"
      disabled={delMut.isPending}
      onClick={async () => {
        if (!window.confirm("Supprimer définitivement cette évaluation ?")) return;
        try {
          await delMut.mutateAsync(id);
        } catch (err: any) {
          onError(err?.message ?? "Erreur lors de la suppression.");
        }
      }}
    >
      {delMut.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
    </Button>
  );
}

/* -------------------------------------------------------------------------- */
/* Wizard de création/édition aligné sur /teacher/assignments/create          */
/* Étape 1 : choix du type d'évaluation (3 cartes)                            */
/* Étape 2 : formulaire complet avec sections conditionnelles                 */
/* -------------------------------------------------------------------------- */

type EvaluationTypeId = "online" | "pdf" | "ai_generated";

<<<<<<< HEAD
function AssignmentForm({
=======
export function AssignmentForm({
>>>>>>> 030-pedagogie-ue-ecue
  subjectId,
  sessionId,
  initial,
  onClose,
  onError,
}: {
  subjectId: string;
  sessionId?: string;
  initial: any | null;
  onClose: () => void;
  onError: (m: string) => void;
}) {
  const createMut = useCreateAssignment();
  const updateMut = useUpdateAssignment();
  const uploadSubjectMut = useUploadAssignmentSubjectDocument();

  // Étape : 1 = choix du type, 2 = formulaire détaillé.
  // En édition on saute direct à l'étape 2 (le type est figé).
  const [step, setStep] = useState<1 | 2>(initial ? 2 : 1);
  const [evaluationType, setEvaluationType] = useState<EvaluationTypeId>(
    initial?.evaluation_type ?? "pdf"
  );

  // Champs communs
  const [titre, setTitre] = useState(initial?.titre ?? "");
  const [nature, setNature] = useState<"devoir" | "examen">(
    initial?.type === "examen" ? "examen" : "devoir"
  );
  const [description, setDescription] = useState(initial?.description ?? "");
  const [noteMax, setNoteMax] = useState(initial?.note_max ?? 20);
  const [coefficient, setCoefficient] = useState(initial?.coefficient ?? 1);
  const [dueAt, setDueAt] = useState(
    initial?.due_at ? new Date(initial.due_at).toISOString().slice(0, 16) : ""
  );
  const [statut, setStatut] = useState(initial?.statut ?? "publie");

  // Champs « online » et « ai_generated »
  const [durationMinutes, setDurationMinutes] = useState(initial?.duration_minutes ?? 60);
  const [maxAttempts, setMaxAttempts] = useState(initial?.max_attempts ?? 1);
  const [shuffleQuestions, setShuffleQuestions] = useState(
    initial?.shuffle_questions ?? false
  );
  const [showResultsMode, setShowResultsMode] = useState(
    initial?.show_results_mode ?? "after_correction"
  );

  // Champs « pdf »
  const [subjectContent, setSubjectContent] = useState(initial?.subject_content ?? "");
  const existingSubjectDocumentUrl: string | null = initial?.subject_document_url ?? null;
  const [subjectFile, setSubjectFile] = useState<File | null>(null);
  const [removeExistingDoc, setRemoveExistingDoc] = useState(false);
  const [maxFileSizeMb, setMaxFileSizeMb] = useState(initial?.max_file_size_mb ?? 10);
  const [lateSubmissionAllowed, setLateSubmissionAllowed] = useState(
    initial?.late_submission_allowed ?? false
  );
  const [latePenaltyPercent, setLatePenaltyPercent] = useState(
    initial?.late_penalty_percent ?? 0
  );

  // Champs « ai_generated »
  const initialAi = initial?.ai_config ?? {};
  const [aiMcq, setAiMcq] = useState(initialAi?.mcq ?? 7);
  const [aiShort, setAiShort] = useState(initialAi?.short_answer ?? 3);
  const [aiLong, setAiLong] = useState(initialAi?.long_answer ?? 3);
  const [aiTrueFalse, setAiTrueFalse] = useState(initialAi?.true_false ?? 7);
  const [aiDifficulty, setAiDifficulty] = useState(initialAi?.difficulty ?? "medium");
  const [aiInstructions, setAiInstructions] = useState(initialAi?.instructions ?? "");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    try {
      const payload: any = {
        titre,
        description: description || null,
        // Nature de la note pour le calcul de moyenne : « devoir » (contrôle
        // continu, pèse 40 %) ou « examen » (épreuve finale, pèse 60 %,
        // unique par ECUE/cohorte).
        type: nature,
        evaluation_type: evaluationType,
        note_max: Number(noteMax),
        coefficient: Number(coefficient),
        due_at: dueAt ? new Date(dueAt).toISOString() : null,
        statut,
      };

      if (evaluationType === "online" || evaluationType === "ai_generated") {
        payload.duration_minutes = durationMinutes ? Number(durationMinutes) : null;
        payload.max_attempts = Number(maxAttempts) || 1;
        payload.shuffle_questions = !!shuffleQuestions;
        payload.show_results_mode = showResultsMode;
      }

      if (evaluationType === "pdf") {
        payload.subject_content = subjectContent || null;
        // Si on remplace le fichier ou si on demande à le supprimer, on met à null
        // (l'upload ré-écrira le subject_document_url juste après si subjectFile est présent).
        if (subjectFile || removeExistingDoc) {
          payload.subject_document_url = null;
        }
        payload.max_file_size_mb = Number(maxFileSizeMb) || 10;
        payload.late_submission_allowed = !!lateSubmissionAllowed;
        payload.late_penalty_percent = Number(latePenaltyPercent) || 0;
      }

      if (evaluationType === "ai_generated") {
        payload.ai_config = {
          mcq: Number(aiMcq) || 0,
          short_answer: Number(aiShort) || 0,
          long_answer: Number(aiLong) || 0,
          true_false: Number(aiTrueFalse) || 0,
          difficulty: aiDifficulty,
          instructions: aiInstructions || null,
        };
      }

      let savedAssignment: any;
      if (initial) {
        savedAssignment = await updateMut.mutateAsync({ id: initial.id, data: payload });
      } else {
        savedAssignment = await createMut.mutateAsync({
          ...payload,
          ecue_id: subjectId,
          ue_session_id: sessionId ?? null,
        });
      }
      // Upload du sujet PDF si un fichier est sélectionné (uniquement pour le type pdf).
      if (evaluationType === "pdf" && subjectFile && savedAssignment?.id) {
        await uploadSubjectMut.mutateAsync({
          assignmentId: savedAssignment.id,
          file: subjectFile,
        });
      }
      onClose();
    } catch (err: any) {
      onError(err?.message ?? "Erreur lors de l'enregistrement.");
    }
  }

  const isPending = createMut.isPending || updateMut.isPending || uploadSubjectMut.isPending;
  const selectedType = EVALUATION_TYPES.find((t) => t.id === evaluationType);

  // Validation type-spécifique : pour le format « Sujet PDF », il faut OBLIGATOIREMENT
  // soit un énoncé texte, soit un fichier (nouveau ou existant non retiré).
  const pdfHasContent =
    evaluationType !== "pdf" ||
    Boolean(
      subjectContent.trim() ||
        subjectFile ||
        (existingSubjectDocumentUrl && !removeExistingDoc)
    );

  const canSubmit = !!titre.trim() && pdfHasContent && !isPending;

  /* ----------------- Étape 1 : choix du type d'évaluation ----------------- */
  if (step === 1) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
        <div className="bg-background text-foreground border border-border rounded-lg shadow-2xl w-full max-w-4xl max-h-[90vh] overflow-auto">
          <div className="flex items-center justify-between px-4 py-3 border-b">
            <div>
              <h3 className="font-semibold">Créer une évaluation</h3>
              <p className="text-xs text-muted-foreground">
                Étape 1 / 2 — Choisissez le type d'évaluation
              </p>
            </div>
            <Button type="button" size="sm" variant="outline" onClick={onClose}>
              <X className="h-4 w-4" />
            </Button>
          </div>
          <div className="p-6 space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {EVALUATION_TYPES.map((t) => {
                const Icon = t.icon;
                const isSelected = evaluationType === t.id;
                return (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => setEvaluationType(t.id)}
                    className={`text-left p-6 border-2 rounded-lg transition-all hover:shadow-md ${
                      isSelected
                        ? `${t.border} ${t.bg} ring-2 ${t.ring}`
                        : "border-border hover:border-muted-foreground/40"
                    }`}
                  >
                    <div className="text-center">
                      <div
                        className={`w-12 h-12 mx-auto mb-4 rounded-lg bg-gradient-to-r ${t.color} flex items-center justify-center`}
                      >
                        <Icon className="w-6 h-6 text-white" />
                      </div>
                      <h4 className="font-semibold mb-2">{t.name}</h4>
                      <p className="text-sm text-muted-foreground">{t.description}</p>
                      {isSelected && (
                        <div className="mt-3 inline-flex w-6 h-6 bg-primary rounded-full items-center justify-center">
                          <CheckCircle2 className="w-4 h-4 text-primary-foreground" />
                        </div>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
          <div className="flex justify-end gap-2 px-4 py-3 border-t border-border bg-muted/40">
            <Button type="button" variant="outline" onClick={onClose}>
              Annuler
            </Button>
            <Button type="button" onClick={() => setStep(2)} disabled={!evaluationType}>
              Continuer
              <Plus className="w-4 h-4 ml-2 rotate-45" />
            </Button>
          </div>
        </div>
      </div>
    );
  }

  /* ----------------- Étape 2 : formulaire détaillé ----------------- */
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <form
        onSubmit={handleSubmit}
        className="bg-background text-foreground border border-border rounded-lg shadow-2xl w-full max-w-3xl max-h-[90vh] overflow-auto"
      >
        <div className="flex items-center justify-between px-4 py-3 border-b">
          <div>
            <h3 className="font-semibold">
              {initial ? "Modifier l'évaluation" : "Nouvelle évaluation"}
            </h3>
            <p className="text-xs text-muted-foreground flex items-center gap-2">
              {selectedType && (
                <span
                  className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] ${
                    selectedType.id === "online"
                      ? "bg-green-500/15 text-green-500 border border-green-500/40"
                      : selectedType.id === "ai_generated"
                        ? "bg-purple-500/15 text-purple-500 border border-purple-500/40"
                        : "bg-blue-500/15 text-blue-500 border border-blue-500/40"
                  }`}
                >
                  <selectedType.icon className="w-3 h-3" />
                  {selectedType.name}
                </span>
              )}
              {!initial && (
                <button
                  type="button"
                  onClick={() => setStep(1)}
                  className="underline hover:text-foreground"
                >
                  Changer
                </button>
              )}
            </p>
          </div>
          <Button type="button" size="sm" variant="outline" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        </div>

        <div className="p-4 space-y-5">
          {/* Bloc commun */}
          <section className="space-y-3">
            <h4 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
              Informations générales
            </h4>
            <div className="space-y-1">
              <label className="text-sm font-medium">Titre *</label>
              <Input value={titre} onChange={(e) => setTitre(e.target.value)} required />
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium">Nature de la note *</label>
              <Select value={nature} onValueChange={(v) => setNature(v as "devoir" | "examen")}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="devoir">Devoir (contrôle continu — 40 %)</SelectItem>
                  <SelectItem value="examen">Examen (épreuve finale — 60 %)</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                {nature === "examen"
                  ? "Une seule évaluation « examen » par ECUE et par cohorte."
                  : "Plusieurs devoirs possibles ; leur moyenne compte pour 40 %."}
              </p>
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium">Description / Consigne</label>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={3}
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              />
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <div className="space-y-1">
                <label className="text-sm font-medium">Note max</label>
                <Input
                  type="number"
                  min={1}
                  step="0.5"
                  value={noteMax}
                  onChange={(e) => setNoteMax(e.target.value)}
                />
              </div>
              <div className="space-y-1">
                <label className="text-sm font-medium">Coefficient</label>
                <Input
                  type="number"
                  min={0.1}
                  step="0.1"
                  value={coefficient}
                  onChange={(e) => setCoefficient(e.target.value)}
                />
              </div>
              <div className="space-y-1">
                <label className="text-sm font-medium">Statut</label>
                <Select value={statut} onValueChange={setStatut}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {STATUT_OPTIONS.map((o) => (
                      <SelectItem key={o.value} value={o.value}>
                        {o.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium">Date d'échéance</label>
              <Input
                type="datetime-local"
                value={dueAt}
                onChange={(e) => setDueAt(e.target.value)}
              />
            </div>
          </section>

          {/* Bloc spécifique « online » */}
          {evaluationType === "online" && (
            <section className="space-y-3 border-t border-border pt-4">
              <h4 className="text-sm font-semibold text-green-500 uppercase tracking-wide flex items-center gap-2">
                <BookOpen className="w-4 h-4" />
                Paramètres de l'évaluation en ligne
              </h4>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <div className="space-y-1">
                  <label className="text-sm font-medium flex items-center gap-1">
                    <Clock className="w-3 h-3" /> Durée (min)
                  </label>
                  <Input
                    type="number"
                    min={1}
                    value={durationMinutes}
                    onChange={(e) => setDurationMinutes(e.target.value)}
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-sm font-medium">Tentatives max</label>
                  <Input
                    type="number"
                    min={1}
                    value={maxAttempts}
                    onChange={(e) => setMaxAttempts(e.target.value)}
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-sm font-medium">Affichage des résultats</label>
                  <Select value={showResultsMode} onValueChange={setShowResultsMode}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {SHOW_RESULTS_OPTIONS.map((o) => (
                        <SelectItem key={o.value} value={o.value}>
                          {o.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={shuffleQuestions}
                  onChange={(e) => setShuffleQuestions(e.target.checked)}
                />
                Mélanger les questions à chaque tentative
              </label>
              <p className="text-xs text-muted-foreground italic">
                💡 Les questions interactives (QCM, réponses) seront ajoutées dans une étape
                ultérieure après création.
              </p>
            </section>
          )}

          {/* Bloc spécifique « pdf » */}
          {evaluationType === "pdf" && (
            <section className="space-y-3 border-t border-border pt-4">
              <h4 className="text-sm font-semibold text-blue-500 uppercase tracking-wide flex items-center gap-2">
                <FileText className="w-4 h-4" />
                Sujet et remise de fichiers
              </h4>
              <p className="text-xs text-muted-foreground">
                Renseignez <span className="font-medium">au moins l'énoncé texte OU le fichier
                du sujet</span> pour pouvoir créer l'évaluation.
              </p>
              {!pdfHasContent && (
                <div className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-500">
                  ⚠ Aucun contenu fourni : ajoutez un énoncé ou un fichier pour activer le
                  bouton « Créer l'évaluation ».
                </div>
              )}
              <div className="space-y-1">
                <label className="text-sm font-medium">Énoncé / Sujet (texte)</label>
                <textarea
                  value={subjectContent}
                  onChange={(e) => setSubjectContent(e.target.value)}
                  rows={4}
                  placeholder="Saisir l'énoncé directement ici…"
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium flex items-center gap-1">
                  <Upload className="w-3 h-3" /> Fichier du sujet (PDF / Word)
                </label>
                {existingSubjectDocumentUrl && !subjectFile && !removeExistingDoc && (
                  <div className="flex items-center justify-between gap-2 rounded-md border border-border bg-muted/40 px-3 py-2 text-sm">
                    <button
                      type="button"
                      onClick={() =>
                        openAssignmentSubjectDocument(existingSubjectDocumentUrl).catch((err) =>
                          onError(err?.message ?? "Erreur lors de l'ouverture du fichier.")
                        )
                      }
                      className="flex items-center gap-2 text-blue-500 hover:underline truncate"
                    >
                      <FileText className="w-4 h-4 shrink-0" />
                      Sujet actuel — ouvrir
                    </button>
                    <button
                      type="button"
                      onClick={() => setRemoveExistingDoc(true)}
                      className="text-xs text-red-500 hover:underline"
                    >
                      Retirer
                    </button>
                  </div>
                )}
                <input
                  type="file"
                  accept=".pdf,.doc,.docx,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                  onChange={(e) => {
                    const f = e.target.files?.[0] ?? null;
                    setSubjectFile(f);
                    if (f) setRemoveExistingDoc(false);
                  }}
                  className="block w-full text-sm file:mr-3 file:rounded-md file:border-0 file:bg-blue-100 file:px-3 file:py-1.5 file:text-blue-700 hover:file:bg-blue-200"
                />
                {subjectFile && (
                  <p className="text-xs text-muted-foreground">
                    Fichier sélectionné :{" "}
                    <span className="font-medium">{subjectFile.name}</span> (
                    {(subjectFile.size / (1024 * 1024)).toFixed(2)} Mo)
                  </p>
                )}
                {existingSubjectDocumentUrl && removeExistingDoc && !subjectFile && (
                  <p className="text-xs text-amber-500">
                    Le fichier sujet sera retiré à l'enregistrement.{" "}
                    <button
                      type="button"
                      onClick={() => setRemoveExistingDoc(false)}
                      className="underline"
                    >
                      Annuler
                    </button>
                  </p>
                )}
                <p className="text-[11px] text-muted-foreground">
                  Formats acceptés : PDF, Word (.doc, .docx). Le fichier sera mis à
                  disposition des étudiants à la lecture (Content-Disposition: inline).
                </p>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <div className="space-y-1">
                  <label className="text-sm font-medium">Taille max fichier (Mo)</label>
                  <Input
                    type="number"
                    min={1}
                    max={500}
                    value={maxFileSizeMb}
                    onChange={(e) => setMaxFileSizeMb(e.target.value)}
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-sm font-medium">Pénalité retard (%)</label>
                  <Input
                    type="number"
                    min={0}
                    max={100}
                    value={latePenaltyPercent}
                    onChange={(e) => setLatePenaltyPercent(e.target.value)}
                    disabled={!lateSubmissionAllowed}
                  />
                </div>
                <label className="flex items-center gap-2 text-sm pt-7">
                  <input
                    type="checkbox"
                    checked={lateSubmissionAllowed}
                    onChange={(e) => setLateSubmissionAllowed(e.target.checked)}
                  />
                  Autoriser les rendus en retard
                </label>
              </div>
            </section>
          )}

          {/* Bloc spécifique « ai_generated » */}
          {evaluationType === "ai_generated" && (
            <section className="space-y-3 border-t border-border pt-4">
              <h4 className="text-sm font-semibold text-purple-500 uppercase tracking-wide flex items-center gap-2">
                <Brain className="w-4 h-4" />
                Génération IA des questions
              </h4>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <div className="space-y-1">
                  <label className="text-sm font-medium">QCM</label>
                  <Input
                    type="number"
                    min={0}
                    max={50}
                    value={aiMcq}
                    onChange={(e) => setAiMcq(e.target.value)}
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-sm font-medium">Réponses courtes</label>
                  <Input
                    type="number"
                    min={0}
                    max={50}
                    value={aiShort}
                    onChange={(e) => setAiShort(e.target.value)}
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-sm font-medium">Réponses longues</label>
                  <Input
                    type="number"
                    min={0}
                    max={50}
                    value={aiLong}
                    onChange={(e) => setAiLong(e.target.value)}
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-sm font-medium">Vrai/Faux</label>
                  <Input
                    type="number"
                    min={0}
                    max={50}
                    value={aiTrueFalse}
                    onChange={(e) => setAiTrueFalse(e.target.value)}
                  />
                </div>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <div className="space-y-1">
                  <label className="text-sm font-medium">Difficulté</label>
                  <Select value={aiDifficulty} onValueChange={setAiDifficulty}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {DIFFICULTY_OPTIONS.map((o) => (
                        <SelectItem key={o.value} value={o.value}>
                          {o.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <label className="text-sm font-medium flex items-center gap-1">
                    <Clock className="w-3 h-3" /> Durée (min)
                  </label>
                  <Input
                    type="number"
                    min={1}
                    value={durationMinutes}
                    onChange={(e) => setDurationMinutes(e.target.value)}
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-sm font-medium">Tentatives max</label>
                  <Input
                    type="number"
                    min={1}
                    value={maxAttempts}
                    onChange={(e) => setMaxAttempts(e.target.value)}
                  />
                </div>
              </div>
              <div className="space-y-1">
                <label className="text-sm font-medium">
                  Instructions IA (optionnel)
                </label>
                <textarea
                  value={aiInstructions}
                  onChange={(e) => setAiInstructions(e.target.value)}
                  rows={2}
                  placeholder="Focus sur les définitions du chapitre 3, éviter les questions de calcul…"
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                />
              </div>
              <p className="text-xs text-muted-foreground italic">
                💡 Les supports de cours de la matière serviront de source pour la génération.
                La génération elle-même sera lancée lors d'une étape ultérieure.
              </p>
            </section>
          )}
        </div>

        <div className="flex justify-between items-center gap-2 px-4 py-3 border-t border-border bg-muted/40">
          {!initial ? (
            <Button type="button" variant="outline" onClick={() => setStep(1)}>
              Retour
            </Button>
          ) : (
            <div />
          )}
          <div className="flex gap-2">
            <Button type="button" variant="outline" onClick={onClose}>
              Annuler
            </Button>
            <Button type="submit" disabled={!canSubmit}>
              {isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              {initial ? "Enregistrer" : "Créer l'évaluation"}
            </Button>
          </div>
        </div>
      </form>
    </div>
  );
}

/* -------------------------------------------------------------------------- */

<<<<<<< HEAD
function GradingModal({
=======
export function GradingModal({
>>>>>>> 030-pedagogie-ue-ecue
  assignment,
  canManage,
  onClose,
}: {
  assignment: any;
  canManage: boolean;
  onClose: () => void;
}) {
  const submissionsQuery = useAssignmentSubmissions(assignment.id);
  const gradeMut = useGradeSubmission();
  const [edits, setEdits] = useState<Record<string, { note: string; appreciation: string }>>({});
  const [error, setError] = useState<string | null>(null);
  const [reviewingSubmissionId, setReviewingSubmissionId] = useState<string | null>(null);

  const rows: any[] = submissionsQuery.data ?? [];
  const isOnline = assignment.evaluation_type === "online" || assignment.evaluation_type === "ai_generated";

  function getEdit(row: any) {
    return (
      edits[row.student_id] ?? {
        note: row.note != null ? String(row.note) : "",
        appreciation: row.appreciation ?? "",
      }
    );
  }

  async function saveRow(row: any) {
    setError(null);
    const e = getEdit(row);
    const note = parseFloat(e.note);
    if (Number.isNaN(note)) {
      setError("Veuillez saisir une note numérique.");
      return;
    }
    try {
      await gradeMut.mutateAsync({
        assignmentId: assignment.id,
        studentId: row.student_id,
        note,
        appreciation: e.appreciation || undefined,
      });
    } catch (err: any) {
      setError(err?.message ?? "Erreur lors de l'enregistrement de la note.");
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="bg-background text-foreground border border-border rounded-lg shadow-2xl w-full max-w-5xl max-h-[90vh] flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 border-b">
          <div>
            <h3 className="font-semibold">Correction — {assignment.titre}</h3>
            <p className="text-xs text-muted-foreground">
              Note sur {assignment.note_max} · Coefficient {assignment.coefficient}
            </p>
          </div>
          <Button size="sm" variant="outline" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        </div>
        <div className="flex-1 overflow-auto p-4 space-y-3">
          {error && (
            <div className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700">
              {error}
            </div>
          )}
          {submissionsQuery.isLoading ? (
            <div className="flex justify-center py-12">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : rows.length === 0 ? (
            <p className="text-sm text-muted-foreground">Aucun étudiant inscrit.</p>
          ) : (
            <table className="w-full text-sm">
              <thead className="text-left text-xs uppercase text-muted-foreground border-b">
                <tr>
                  <th className="py-2 pr-2">Étudiant</th>
                  <th className="py-2 pr-2">Statut</th>
                  <th className="py-2 pr-2">Soumission</th>
                  <th className="py-2 pr-2 w-24">Note /{assignment.note_max}</th>
                  <th className="py-2 pr-2">Appréciation</th>
                  <th className="py-2 pr-2"></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const ed = getEdit(r);
                  return (
                    <tr key={r.student_id} className="border-b last:border-0">
                      <td className="py-2 pr-2 font-medium">
                        {r.first_name} {r.last_name}
                      </td>
                      <td className="py-2 pr-2">
                        <span
                          className={`text-xs px-2 py-0.5 rounded-full ${
                            r.statut === "note"
                              ? "bg-green-100 text-green-700"
                              : r.statut === "soumis"
                                ? "bg-blue-100 text-blue-700"
                                : "bg-gray-100 text-gray-700"
                          }`}
                        >
                          {r.statut ?? "—"}
                        </span>
                      </td>
                      <td className="py-2 pr-2 text-xs">
                        {isOnline ? (
                          r.submission_id ? (
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => setReviewingSubmissionId(r.submission_id)}
                              className="h-7 text-xs"
                            >
                              <ClipboardList className="h-3 w-3 mr-1.5" />
                              Voir / Corriger les réponses
                            </Button>
                          ) : (
                            <span className="text-muted-foreground">(pas encore soumis)</span>
                          )
                        ) : (
                          <>
                            {r.contenu && (
                              <p className="line-clamp-2 max-w-xs" title={r.contenu}>
                                {r.contenu}
                              </p>
                            )}
                            {r.file_url && (
                              <button
                                type="button"
                                onClick={() =>
                                  openSubmissionFile(r.file_url).catch(() => {
                                    /* ignore — la fonction lance déjà une erreur visible */
                                  })
                                }
                                className="text-blue-500 hover:underline"
                              >
                                Pièce jointe
                              </button>
                            )}
                            {!r.contenu && !r.file_url && (
                              <span className="text-muted-foreground">—</span>
                            )}
                          </>
                        )}
                      </td>
                      <td className="py-2 pr-2">
                        <Input
                          type="number"
                          min={0}
                          max={assignment.note_max}
                          step="0.25"
                          disabled={!canManage}
                          value={ed.note}
                          onChange={(e) =>
                            setEdits((prev) => ({
                              ...prev,
                              [r.student_id]: { ...ed, note: e.target.value },
                            }))
                          }
                          className="h-8"
                        />
                      </td>
                      <td className="py-2 pr-2">
                        <Input
                          disabled={!canManage}
                          value={ed.appreciation}
                          onChange={(e) =>
                            setEdits((prev) => ({
                              ...prev,
                              [r.student_id]: { ...ed, appreciation: e.target.value },
                            }))
                          }
                          placeholder="Commentaire (optionnel)"
                          className="h-8"
                        />
                      </td>
                      <td className="py-2 pr-2 text-right">
                        {canManage && (
                          <Button
                            size="sm"
                            disabled={gradeMut.isPending}
                            onClick={() => saveRow(r)}
                          >
                            {gradeMut.isPending ? (
                              <Loader2 className="h-3 w-3 animate-spin" />
                            ) : (
                              <CheckCircle2 className="h-3 w-3 mr-1" />
                            )}
                            Noter
                          </Button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {reviewingSubmissionId && (
        <SubmissionAnswersReviewer
          submissionId={reviewingSubmissionId}
          onClose={() => setReviewingSubmissionId(null)}
        />
      )}
    </div>
  );
}
