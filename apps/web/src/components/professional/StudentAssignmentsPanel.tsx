"use client";

import { useMemo, useState } from "react";
import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Input,
} from "@ecoledigitale/ui";
import {
  ClipboardList,
  Loader2,
  Send,
  X,
  CheckCircle2,
  Clock,
  AlertCircle,
  Award,
  FileText,
  BookOpen,
  Brain,
  Download,
} from "lucide-react";
import {
  useStudentAssignments,
  useSubmitAssignment,
  useSubmitAssignmentWithFile,
  openAssignmentSubjectDocument,
  openSubmissionFile,
} from "@/lib/hooks/use-professional-assignments";
import { OnlineEvaluationPlayer } from "@/components/professional/OnlineEvaluationPlayer";

const EVALUATION_TYPE_LABEL: Record<string, string> = {
  online: "En ligne",
  pdf: "Sujet PDF",
  ai_generated: "IA",
};

function EvaluationTypeBadge({ type }: { type?: string | null }) {
  if (!type) return null;
  const Icon = type === "online" ? BookOpen : type === "ai_generated" ? Brain : FileText;
  const cls =
    type === "online"
      ? "bg-green-500/15 text-green-500 border border-green-500/40"
      : type === "ai_generated"
        ? "bg-purple-500/15 text-purple-500 border border-purple-500/40"
        : "bg-blue-500/15 text-blue-500 border border-blue-500/40";
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] ${cls}`}>
      <Icon className="w-3 h-3" />
      {EVALUATION_TYPE_LABEL[type] ?? type}
    </span>
  );
}

interface Props {
  subjectId: string;
}

const STATUT_BADGE: Record<string, string> = {
  en_attente: "bg-gray-100 text-gray-700",
  soumis: "bg-blue-100 text-blue-700",
  en_correction: "bg-amber-100 text-amber-700",
  note: "bg-green-100 text-green-700",
  rejete: "bg-red-100 text-red-700",
};

const STATUT_LABEL: Record<string, string> = {
  en_attente: "À faire",
  soumis: "Soumis",
  en_correction: "En correction",
  note: "Noté",
  rejete: "Rejeté",
};

function fmtDateTime(s?: string | null): string {
  if (!s) return "—";
  const d = new Date(s);
  return isNaN(d.getTime()) ? String(s) : d.toLocaleString("fr-FR");
}

export function StudentAssignmentsPanel({ subjectId }: Props) {
  const assignmentsQuery = useStudentAssignments();
  const allAssignments: any[] = assignmentsQuery.data ?? [];
  const items = useMemo(
    () => allAssignments.filter((a) => a.ecue_id === subjectId),
    [allAssignments, subjectId]
  );

  const [submitting, setSubmitting] = useState<any | null>(null);

  if (assignmentsQuery.isLoading) {
    return (
      <Card>
        <CardContent className="flex justify-center py-10">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }

  if (assignmentsQuery.isError) {
    return (
      <Card>
        <CardContent className="py-6 text-sm text-red-700">
          {(assignmentsQuery.error as Error)?.message ?? "Erreur de chargement."}
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Évaluations & notes</CardTitle>
        <CardDescription>
          Devoirs, contrôles et examens de cette matière. Cliquez sur une évaluation pour la rendre.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {items.length === 0 ? (
          <p className="text-sm text-muted-foreground py-4">
            Aucune évaluation publiée pour cette matière.
          </p>
        ) : (
          <ul className="space-y-2">
            {items.map((a) => {
              const subStatut = a.submission_statut ?? "en_attente";
              const isGraded = subStatut === "note";
              // Une fois soumis (peu importe si en_correction / note / rejete),
              // l'étudiant ne peut plus modifier sa copie.
              const isSubmitted =
                subStatut === "soumis" ||
                subStatut === "en_correction" ||
                subStatut === "note" ||
                subStatut === "rejete";
              const overdue = a.due_at && new Date(a.due_at) < new Date() && subStatut === "en_attente";
              return (
                <li
                  key={a.id}
                  className={`flex flex-wrap items-start justify-between gap-3 rounded-lg border p-3 transition-opacity ${
                    isGraded
                      ? "border-green-500/40 bg-green-500/5"
                      : isSubmitted
                        ? "border-blue-500/40 bg-blue-500/5"
                        : "border-border bg-muted/40"
                  }`}
                >
                  <div className="flex items-start gap-3 min-w-0 flex-1">
                    {isSubmitted ? (
                      <CheckCircle2
                        className={`h-5 w-5 mt-0.5 shrink-0 ${
                          isGraded ? "text-green-500" : "text-blue-500"
                        }`}
                      />
                    ) : (
                      <ClipboardList className="h-5 w-5 mt-0.5 text-blue-500 shrink-0" />
                    )}
                    <div className="min-w-0">
                      <p
                        className={`text-sm font-medium ${
                          isSubmitted && !isGraded ? "line-through opacity-80" : ""
                        }`}
                      >
                        {a.titre}
                      </p>
                      {a.description && (
                        <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">
                          {a.description}
                        </p>
                      )}
                      <div className="flex flex-wrap gap-2 mt-1.5 text-[11px]">
                        <EvaluationTypeBadge type={a.evaluation_type} />
                        <span className="text-muted-foreground">
                          Note&nbsp;/{a.note_max} · Coef.&nbsp;{a.coefficient}
                        </span>
                        {a.due_at && (
                          <span
                            className={`flex items-center gap-1 ${
                              overdue ? "text-red-600" : "text-muted-foreground"
                            }`}
                          >
                            <Clock className="h-3 w-3" />
                            {fmtDateTime(a.due_at)}
                            {overdue && " (en retard)"}
                          </span>
                        )}
                        <span
                          className={`px-2 py-0.5 rounded-full ${STATUT_BADGE[subStatut]}`}
                        >
                          {STATUT_LABEL[subStatut] ?? subStatut}
                        </span>
                      </div>

                      {/* Énoncé texte (si renseigné) */}
                      {a.subject_content && (
                        <details className="mt-2 rounded-md border border-border bg-background/60 px-2.5 py-1.5 text-xs">
                          <summary className="cursor-pointer text-foreground font-medium">
                            📄 Voir l'énoncé
                          </summary>
                          <p className="mt-2 whitespace-pre-line text-muted-foreground">
                            {a.subject_content}
                          </p>
                        </details>
                      )}

                      {/* Lien vers le sujet PDF (si présent) */}
                      {a.subject_document_url && (
                        <button
                          type="button"
                          onClick={() =>
                            openAssignmentSubjectDocument(a.subject_document_url).catch(() => {
                              /* feedback simple : ouvrir reste l'action principale */
                            })
                          }
                          className="mt-2 inline-flex items-center gap-1.5 text-xs text-blue-500 hover:underline"
                        >
                          <Download className="h-3.5 w-3.5" />
                          Récupérer le sujet (PDF / Word)
                        </button>
                      )}

                      {isGraded && (
                        <div className="mt-2 inline-flex items-center gap-2 bg-green-50 border border-green-200 rounded-md px-2.5 py-1">
                          <Award className="h-4 w-4 text-green-600" />
                          <span className="text-sm font-bold text-green-700">
                            {a.note} / {a.note_max}
                          </span>
                          {a.appreciation && (
                            <span className="text-xs text-green-700 italic">
                              — {a.appreciation}
                            </span>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                  <div className="shrink-0 flex flex-col items-end gap-1.5">
                    {/* Pas encore soumis ET pas clôturé → bouton « Rendre » */}
                    {!isSubmitted && a.statut !== "cloture" && (
                      <Button size="sm" onClick={() => setSubmitting(a)}>
                        <Send className="h-3.5 w-3.5 mr-1.5" />
                        Rendre
                      </Button>
                    )}
                    {/* Évaluation clôturée par l'enseignant et étudiant n'a pas rendu */}
                    {a.statut === "cloture" && !isSubmitted && (
                      <span className="text-xs text-red-600 inline-flex items-center gap-1">
                        <AlertCircle className="h-3 w-3" />
                        Clôturé
                      </span>
                    )}
                    {/* Déjà soumis : étiquette + bouton « Voir » (consultation seule) */}
                    {isSubmitted && (
                      <>
                        <span
                          className={`text-xs font-medium inline-flex items-center gap-1 px-2 py-1 rounded-full ${
                            isGraded
                              ? "bg-green-500/15 text-green-500 border border-green-500/40"
                              : "bg-blue-500/15 text-blue-500 border border-blue-500/40"
                          }`}
                        >
                          <CheckCircle2 className="h-3.5 w-3.5" />
                          {isGraded ? "Noté" : "Devoir soumis"}
                        </span>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => setSubmitting(a)}
                        >
                          <FileText className="h-3.5 w-3.5 mr-1.5" />
                          Voir ma copie
                        </Button>
                      </>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>

      {submitting && submitting.evaluation_type === "online" && (
        <OnlineEvaluationPlayer
          assignment={submitting}
          onClose={() => setSubmitting(null)}
          onSubmitted={() => {
            setSubmitting(null);
            assignmentsQuery.refetch();
          }}
        />
      )}
      {submitting && submitting.evaluation_type !== "online" && (
        <SubmissionModal
          assignment={submitting}
          onClose={() => setSubmitting(null)}
          onSubmitted={() => {
            setSubmitting(null);
            assignmentsQuery.refetch();
          }}
        />
      )}
    </Card>
  );
}

/* -------------------------------------------------------------------------- */

function SubmissionModal({
  assignment,
  onClose,
  onSubmitted,
}: {
  assignment: any;
  onClose: () => void;
  onSubmitted: () => void;
}) {
  const submitMut = useSubmitAssignment();
  const submitWithFileMut = useSubmitAssignmentWithFile();
  const [contenu, setContenu] = useState<string>(assignment.submission_contenu ?? "");
  const [file, setFile] = useState<File | null>(null);
  const existingSubmissionFileUrl: string | null = assignment.submission_file_url ?? null;
  const [removeExistingFile, setRemoveExistingFile] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Mode lecture seule : une fois la copie soumise, l'étudiant ne peut plus modifier.
  const subStatut = assignment.submission_statut ?? "en_attente";
  const readOnly =
    subStatut === "soumis" ||
    subStatut === "en_correction" ||
    subStatut === "note" ||
    subStatut === "rejete";

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const hasFile = !!file;
    const keepsExisting = !!existingSubmissionFileUrl && !removeExistingFile && !hasFile;
    if (!contenu.trim() && !hasFile && !keepsExisting) {
      setError("Saisissez une réponse texte ou joignez un fichier.");
      return;
    }
    try {
      if (hasFile) {
        await submitWithFileMut.mutateAsync({
          assignmentId: assignment.id,
          file,
          contenu: contenu || undefined,
        });
      } else {
        // Pas de nouveau fichier : on garde l'éventuel file_url existant (sauf si on l'a retiré explicitement)
        await submitMut.mutateAsync({
          assignmentId: assignment.id,
          contenu: contenu || undefined,
          file_url: removeExistingFile ? "" : existingSubmissionFileUrl ?? undefined,
        });
      }
      onSubmitted();
    } catch (err: any) {
      setError(err?.message ?? "Erreur lors de la soumission.");
    }
  }

  const isPending = submitMut.isPending || submitWithFileMut.isPending;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <form
        onSubmit={handleSubmit}
        className="bg-background text-foreground border border-border rounded-lg shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-auto"
      >
        <div className="flex items-center justify-between px-4 py-3 border-b">
          <div>
            <h3 className="font-semibold">
              {readOnly ? "Ma copie — " : "Rendre — "}
              {assignment.titre}
            </h3>
            <p className="text-xs text-muted-foreground">
              /{assignment.note_max} · Coef. {assignment.coefficient}
              {assignment.due_at && (
                <> · Échéance {fmtDateTime(assignment.due_at)}</>
              )}
            </p>
          </div>
          <Button type="button" size="sm" variant="outline" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        </div>
        <div className="p-4 space-y-3">
          {readOnly && (
            <div className="rounded-md border border-blue-500/40 bg-blue-500/10 px-3 py-2 text-sm flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4 text-blue-500 shrink-0" />
              <span>
                Votre copie a déjà été <span className="font-medium">soumise</span>.{" "}
                {subStatut === "note"
                  ? `Notée ${assignment.note}/${assignment.note_max}.`
                  : "Vous ne pouvez plus la modifier."}
              </span>
            </div>
          )}
          {assignment.description && (
            <div className="rounded-md bg-blue-500/10 border border-blue-500/30 p-3 text-sm">
              <p className="font-medium text-blue-500 mb-1">Consigne</p>
              <p className="whitespace-pre-line">{assignment.description}</p>
            </div>
          )}
          {assignment.subject_content && (
            <div className="rounded-md bg-muted/40 border border-border p-3 text-sm">
              <p className="font-medium mb-1 flex items-center gap-1.5">
                <FileText className="h-4 w-4" /> Énoncé du sujet
              </p>
              <p className="whitespace-pre-line text-muted-foreground">
                {assignment.subject_content}
              </p>
            </div>
          )}
          {assignment.subject_document_url && (
            <button
              type="button"
              onClick={() =>
                openAssignmentSubjectDocument(assignment.subject_document_url).catch((err) =>
                  setError(err?.message ?? "Erreur lors de l'ouverture du sujet.")
                )
              }
              className="inline-flex items-center gap-2 rounded-md border border-blue-500/40 bg-blue-500/10 px-3 py-2 text-sm text-blue-500 hover:bg-blue-500/20 transition-colors"
            >
              <Download className="h-4 w-4" />
              Récupérer le sujet (PDF / Word)
            </button>
          )}
          {error && (
            <div className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700">
              {error}
            </div>
          )}
          <div className="space-y-1">
            <label className="text-sm font-medium">Votre réponse</label>
            <textarea
              value={contenu}
              onChange={(e) => setContenu(e.target.value)}
              rows={8}
              disabled={readOnly}
              readOnly={readOnly}
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm disabled:opacity-70"
              placeholder="Tapez votre réponse, votre dissertation ou les liens vers vos productions."
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-sm font-medium flex items-center gap-1">
              <Download className="w-3 h-3 rotate-180" /> Joindre un fichier (PDF, Word, image…)
            </label>
            {existingSubmissionFileUrl && !file && !removeExistingFile && (
              <div className="flex items-center justify-between gap-2 rounded-md border border-border bg-muted/40 px-3 py-2 text-sm">
                <button
                  type="button"
                  onClick={() =>
                    openSubmissionFile(existingSubmissionFileUrl).catch((err) =>
                      setError(err?.message ?? "Erreur lors de l'ouverture.")
                    )
                  }
                  className="flex items-center gap-2 text-blue-500 hover:underline truncate"
                >
                  <FileText className="w-4 h-4 shrink-0" />
                  Pièce jointe actuelle — ouvrir
                </button>
                {!readOnly && (
                  <button
                    type="button"
                    onClick={() => setRemoveExistingFile(true)}
                    className="text-xs text-red-500 hover:underline"
                  >
                    Retirer
                  </button>
                )}
              </div>
            )}
            {!readOnly && (
              <input
                type="file"
                accept=".pdf,.doc,.docx,.png,.jpg,.jpeg,.gif,.webp,.zip"
                onChange={(e) => {
                  const f = e.target.files?.[0] ?? null;
                  setFile(f);
                  if (f) setRemoveExistingFile(false);
                }}
                className="block w-full text-sm file:mr-3 file:rounded-md file:border-0 file:bg-blue-100 file:px-3 file:py-1.5 file:text-blue-700 hover:file:bg-blue-200"
              />
            )}
            {file && (
              <p className="text-xs text-muted-foreground">
                Fichier sélectionné :{" "}
                <span className="font-medium">{file.name}</span> (
                {(file.size / (1024 * 1024)).toFixed(2)} Mo)
              </p>
            )}
            {existingSubmissionFileUrl && removeExistingFile && !file && (
              <p className="text-xs text-amber-500">
                Le fichier sera retiré à l'enregistrement.{" "}
                <button
                  type="button"
                  onClick={() => setRemoveExistingFile(false)}
                  className="underline"
                >
                  Annuler
                </button>
              </p>
            )}
            <p className="text-[11px] text-muted-foreground">
              Formats acceptés : PDF, Word (.doc, .docx), image, archive ZIP.
            </p>
          </div>
        </div>
        <div className="flex justify-end gap-2 px-4 py-3 border-t border-border bg-muted/40">
          <Button type="button" variant="outline" onClick={onClose}>
            {readOnly ? "Fermer" : "Annuler"}
          </Button>
          {!readOnly && (
            <Button type="submit" disabled={isPending}>
              {isPending ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <CheckCircle2 className="h-4 w-4 mr-2" />
              )}
              Soumettre
            </Button>
          )}
        </div>
      </form>
    </div>
  );
}
