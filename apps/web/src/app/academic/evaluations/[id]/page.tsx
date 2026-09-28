"use client";

import { Card, CardContent, CardDescription, CardHeader, CardTitle, Button, Badge } from "@ecoledigitale/ui";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ArrowLeft, Edit, Settings, Users, BarChart3, Plus, FileText, Clock, Calendar } from "lucide-react";
import React from "react";
import { useParams, usePathname, useRouter, useSearchParams } from "next/navigation";
import { useAssignment, useSubmissions, useEvaluationQuestions } from "@/lib/hooks/use-evaluations";
import Link from "next/link";
import { formatDistanceToNow, format } from "date-fns";
import { fr } from "date-fns/locale";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@ecoledigitale/ui";

import QuestionsList from "@/components/evaluations/QuestionsList";
import SubmissionsList from "@/components/evaluations/SubmissionsList";

function GeneratePlaceholdersDialog({ assignmentId }: { assignmentId: string }) {
  const [open, setOpen] = React.useState(false);
  const [loading, setLoading] = React.useState(false);
  const [counts, setCounts] = React.useState({ single_choice: 3, multiple_choice: 2, true_false: 2, short_text: 1, fill_blank: 0, points: 1 });

  React.useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/v1/assignments/question-defaults', {
          headers: {
            "Content-Type": "application/json",
          }
        });
        if (res.ok) {
          const data = await res.json();
          if (data?.defaults) setCounts((c) => ({ ...c, ...data.defaults }));
        }
      } catch {}
    })();
  }, []);

  const saveDefaults = async (defaults: any) => {
    try {
      await fetch('/api/v1/assignments/question-defaults', {
        method: 'POST',
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ defaults })
      });
    } catch {}
  };

  const submit = async () => {
    setLoading(true);
    try {
      const { points, ...questionCounts } = counts;
      const body = {
        ...questionCounts,
        default_points: points,
      };
      const res = await fetch(`/api/v1/assignments/${assignmentId}/questions/bulk-placeholders`, {
        method: 'POST',
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body)
      });
      if (!res.ok) throw new Error('failed');
      const data = await res.json().catch(() => ({}));
      await saveDefaults(counts);
      setOpen(false);
      try {
        if (Array.isArray(data?.question_ids)) {
          sessionStorage.setItem('editing_question_ids', JSON.stringify(data.question_ids));
        }
      } catch {}
      location.reload();
    } catch {
      alert('Echec création placeholders');
    } finally {
      setLoading(false);
    }
  };

  const fields: Array<{ key: keyof typeof counts; label: string }> = [
    { key: 'single_choice', label: 'QCM (choix unique)' },
    { key: 'multiple_choice', label: 'Choix multiple' },
    { key: 'true_false', label: 'Vrai/Faux' },
    { key: 'short_text', label: 'Réponse courte' },
    { key: 'fill_blank', label: 'Texte à trou' },
  ];

  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)}>Générer des placeholders</Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Générer des placeholders</DialogTitle>
            <DialogDescription>
              Indiquez combien de questions de chaque type vous souhaitez créer. Des placeholders seront ajoutés et vous pourrez les éditer ensuite.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            {fields.map(f => (
              <div key={String(f.key)} className="flex items-center gap-3">
                <label className="w-48 text-sm">{f.label}</label>
                <Input type="number" min={0} value={Number(counts[f.key])}
                  onChange={(e) => setCounts(prev => ({ ...prev, [f.key]: Math.max(0, Number(e.target.value||0)) }))}
                  className="w-32" />
              </div>
            ))}
            <div className="flex items-center gap-3">
              <label className="w-48 text-sm">Points par défaut</label>
              <Input type="number" min={0} value={Number(counts.points)}
                onChange={(e) => setCounts(prev => ({ ...prev, points: Math.max(0, Number(e.target.value||0)) }))}
                className="w-32" />
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-4">
            <Button variant="outline" onClick={() => setOpen(false)}>Annuler</Button>
            <Button onClick={submit} disabled={loading}>{loading ? 'Création...' : 'Créer'}</Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

export default function EvaluationDetailPage() {
  const params = useParams();
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const assignmentId = params.id as string;

  const { data: assignment, isLoading, error } = useAssignment(assignmentId);
  const { data: questionsData } = useEvaluationQuestions(assignmentId, {
    enabled: assignment?.type === 'evaluation'
  });
  const { data: submissionsData } = useSubmissions(assignmentId, { limit: 5 });

  const questions = questionsData?.questions || [];
  const submissions = submissionsData?.submissions || [];

  // Read inline-edit target IDs from sessionStorage (set after creating placeholders)
  const [inlineEditIds, setInlineEditIds] = React.useState<string[]>([]);
  React.useEffect(() => {
    try {
      const raw = sessionStorage.getItem('editing_question_ids');
      if (raw) {
        const ids = JSON.parse(raw);
        if (Array.isArray(ids)) setInlineEditIds(ids);
        sessionStorage.removeItem('editing_question_ids');
      }
    } catch {}
  }, []);

  const isEvaluation = assignment?.type === "evaluation";
  const isHomework = assignment?.type === "homework";
  const [activeTab, setActiveTab] = React.useState("overview");

  React.useEffect(() => {
    const requestedTab = searchParams.get("tab") || "overview";
    const allowedTabs = isEvaluation
      ? ["overview", "questions", "submissions", "grading", "analytics"]
      : ["overview", "submissions", "grading", "analytics"];

    setActiveTab(allowedTabs.includes(requestedTab) ? requestedTab : "overview");
  }, [isEvaluation, searchParams]);

  const handleTabChange = (nextTab: string) => {
    setActiveTab(nextTab);

    const nextParams = new URLSearchParams(searchParams.toString());
    if (nextTab === "overview") {
      nextParams.delete("tab");
    } else {
      nextParams.set("tab", nextTab);
    }

    const nextQuery = nextParams.toString();
    router.replace(nextQuery ? `${pathname}?${nextQuery}` : pathname);
  };

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div className="mb-6 flex max-w-full flex-col items-start gap-2 overflow-x-auto md:mb-8 md:gap-3">
          <Link href="/academic/evaluations">
            <Button variant="outline" size="sm">
              <ArrowLeft className="h-4 w-4 mr-2" />
          Retour
        </Button>
          </Link>
          <div>
            <h2 className="whitespace-nowrap font-bold text-2xl leading-tight md:text-3xl">Chargement...</h2>
          </div>
        </div>
      </div>
    );
  }

  if (error || !assignment) {
    return (
      <div className="space-y-6">
        <div className="mb-6 flex max-w-full flex-col items-start gap-2 overflow-x-auto md:mb-8 md:gap-3">
          <Link href="/academic/evaluations">
            <Button variant="outline" size="sm">
              <ArrowLeft className="h-4 w-4 mr-2" />
          Retour
        </Button>
          </Link>
          <div>
            <h2 className="whitespace-nowrap font-bold text-2xl leading-tight md:text-3xl">Erreur</h2>
            <p className="whitespace-nowrap text-muted-foreground text-sm md:text-base">
              {error ? String(error) : "Évaluation non trouvée"}
            </p>
          </div>
        </div>
      </div>
    );
  }

  const getStatusBadge = (status: string) => {
    const variants = {
      draft: "secondary",
      published: "default",
      archived: "outline"
    } as const;

    const labels = {
      draft: "Brouillon",
      published: "Publié",
      archived: "Archivé"
    };

    return (
      <Badge variant={variants[status as keyof typeof variants] || "secondary"}>
        {labels[status as keyof typeof labels] || status}
      </Badge>
    );
  };

  const getTypeBadge = (type: string) => {
    const variants = {
      evaluation: "default",
      homework: "secondary"
    } as const;

    const labels = {
      evaluation: "Évaluation",
      homework: "Devoir"
    };

    return (
      <Badge variant={variants[type as keyof typeof variants] || "default"}>
        {labels[type as keyof typeof labels] || type}
      </Badge>
    );
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="mb-6 flex max-w-full flex-col items-start gap-2 overflow-x-auto md:gap-3">
        <div className="mb-6 flex max-w-full flex-col items-start gap-2 overflow-x-auto md:mb-8 md:gap-3">
          <Link href="/academic/evaluations">
            <Button variant="outline" size="sm">
              <ArrowLeft className="h-4 w-4 mr-2" />
          Retour
        </Button>
          </Link>
          <div>
            <div className="flex items-center gap-2 mb-1">
              <h2 className="whitespace-nowrap font-bold leading-tight text-2xl md:text-3xl">{assignment.title}</h2>
              {getTypeBadge(assignment.type)}
              {getStatusBadge(assignment.status)}
            </div>
            <p className="whitespace-nowrap text-muted-foreground text-sm md:text-base">
              {assignment.course_title} ({assignment.course_code})
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Link href={`/academic/evaluations/${assignmentId}/edit`}>
            <Button variant="outline">
              <Edit className="h-4 w-4 mr-2" />
              Modifier
            </Button>
          </Link>
          <Button variant="outline">
            <Settings className="h-4 w-4 mr-2" />
            Paramètres
          </Button>
        </div>
      </div>

      {/* Overview Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2">
              <Calendar className="h-4 w-4 text-muted-foreground" />
              <div>
                <p className="text-sm font-medium">Échéance</p>
                <p className="text-sm text-muted-foreground">
                  {format(new Date(assignment.ends_at), "PPP à HH:mm", { locale: fr })}
                </p>
                <p className="text-xs text-muted-foreground">
                  {formatDistanceToNow(new Date(assignment.ends_at), { addSuffix: true, locale: fr })}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        {isEvaluation && (
          <>
            <Card>
              <CardContent className="p-4">
                <div className="flex items-center gap-2">
                  <Clock className="h-4 w-4 text-muted-foreground" />
                  <div>
                    <p className="text-sm font-medium">Durée</p>
                    <p className="text-sm text-muted-foreground">
                      {assignment.duration_minutes} minutes
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="p-4">
                <div className="flex items-center gap-2">
                  <FileText className="h-4 w-4 text-muted-foreground" />
                  <div>
                    <p className="text-sm font-medium">Questions</p>
                    <p className="text-sm text-muted-foreground">
                      {questions.length} question{questions.length > 1 ? 's' : ''}
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </>
        )}

        {isHomework && (
          <>
            <Card>
              <CardContent className="p-4">
                <div className="flex items-center gap-2">
                  <FileText className="h-4 w-4 text-muted-foreground" />
                  <div>
                    <p className="text-sm font-medium">Taille max</p>
                    <p className="text-sm text-muted-foreground">
                      {assignment.max_file_size_mb} MB
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="p-4">
                <div className="flex items-center gap-2">
                  <Users className="h-4 w-4 text-muted-foreground" />
                  <div>
                    <p className="text-sm font-medium">Retard autorisé</p>
                    <p className="text-sm text-muted-foreground">
                      {assignment.late_submission_allowed ? 'Oui' : 'Non'}
                      {assignment.late_submission_allowed && assignment.late_penalty_percent > 0 &&
                        ` (${assignment.late_penalty_percent}% pénalité)`
                      }
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </>
        )}
      </div>

      {/* Main Content */}
      <Tabs value={activeTab} onValueChange={handleTabChange} className="space-y-4">
        <TabsList>
          <TabsTrigger value="overview">Aperçu</TabsTrigger>
          {isEvaluation && <TabsTrigger value="questions">Questions</TabsTrigger>}
          <TabsTrigger value="submissions">Soumissions</TabsTrigger>
          <TabsTrigger value="grading">Correction</TabsTrigger>
          <TabsTrigger value="analytics">Statistiques</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Description</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-muted-foreground">
                {assignment.description || "Aucune description fournie."}
              </p>
            </CardContent>
          </Card>

          {/* PDF Document for Homework */}
          {isHomework && assignment.subject_document_url && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <FileText className="h-5 w-5" />
                  Document du sujet
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex items-center justify-between p-4 bg-blue-50 border border-blue-200 rounded-lg">
                  <div className="flex items-center gap-3">
                    <FileText className="h-8 w-8 text-blue-600" />
                    <div>
                      <p className="font-medium text-blue-800">Document PDF du devoir</p>
                      <p className="text-sm text-blue-600">
                        Cliquez pour télécharger et consulter le sujet
                      </p>
                    </div>
                  </div>
                  <Button
                    variant="outline"
                    className="border-blue-300 text-blue-700 hover:bg-blue-100"
                    onClick={async () => {
                      try {
                        // Extract tenant ID from the URL
                        const urlParts = assignment.subject_document_url.split('/');
                        const tenantIdFromUrl = urlParts[4]; // /api/v1/files/{tenantId}/...

                        // Create a proper download request with authentication headers
                        const response = await fetch(`http://localhost:4000${assignment.subject_document_url}`, {
                          headers: {
                            'X-Tenant': tenantIdFromUrl,
                                                        'X-User-Id': '634a57fe-2007-4ecb-ae5b-f9e3152a24fb',
                          },
                        });

                        if (!response.ok) {
                          throw new Error(`Erreur ${response.status}: ${response.statusText}`);
                        }

                        // Create blob and download
                        const blob = await response.blob();
                        const url = window.URL.createObjectURL(blob);
                        const link = document.createElement('a');
                        link.href = url;
                        link.download = `devoir-${assignment.title}.pdf`;
                        document.body.appendChild(link);
                        link.click();
                        document.body.removeChild(link);
                        window.URL.revokeObjectURL(url);
                      } catch (error) {
                        console.error('Erreur lors du téléchargement:', error);
                        alert(`Erreur lors du téléchargement: ${error instanceof Error ? error.message : 'Erreur inconnue'}`);
                      }
                    }}
                  >
                    <FileText className="h-4 w-4 mr-2" />
                    Télécharger PDF
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Subject Content for Homework (text) */}
          {isHomework && assignment.subject_content && !assignment.subject_document_url && (
            <Card>
              <CardHeader>
                <CardTitle>Contenu du sujet</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="prose max-w-none">
                  <p className="text-muted-foreground whitespace-pre-wrap">
                    {assignment.subject_content}
              <Button variant="outline" onClick={async () => {
                try {
                  const res = await fetch(`http://localhost:4000/api/v1/assignments/${assignmentId}/questions/reorder`, {
                    method: 'POST', headers: {
      "Content-Type": "application/json",
      "X-Tenant": "imhotepacademy",
            "X-User-Id": "634a57fe-2007-4ecb-ae5b-f9e3152a24fb"
    }, body: JSON.stringify({ group_by_type: true })
                  });
                  if (res.ok) location.reload();
                } catch {}
              }}>Grouper par type</Button>

                  </p>
                </div>
              </CardContent>
            </Card>
          )}

          {isEvaluation && (
            <Card>
              <CardHeader>
                <CardTitle>Paramètres de l'évaluation</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <p className="text-sm font-medium">Tentatives autorisées</p>
                    <p className="text-sm text-muted-foreground">{assignment.max_attempts}</p>
                  </div>
                  <div>
                    <p className="text-sm font-medium">Questions mélangées</p>
                    <p className="text-sm text-muted-foreground">
                      {assignment.shuffle_questions ? 'Oui' : 'Non'}
                    </p>
                  </div>
                  <div>
                    <p className="text-sm font-medium">Affichage des résultats</p>
                    <p className="text-sm text-muted-foreground">
                      {assignment.show_results_mode === 'immediate' ? 'Immédiat' :
                       assignment.show_results_mode === 'after_end' ? 'Après la fin' :
                       'Après correction'}
                    </p>
                  </div>
                  {assignment.starts_at && (
                    <div>
                      <p className="text-sm font-medium">Date de début</p>
                      <p className="text-sm text-muted-foreground">
                        {format(new Date(assignment.starts_at), "PPP à HH:mm", { locale: fr })}
                      </p>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          )}

          {isHomework && (
            <Card>
              <CardHeader>
                <CardTitle>Sujet du devoir</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  {assignment.subject_content && (
                    <div>
                      <p className="text-sm font-medium mb-2">Contenu</p>
                      <div className="bg-muted p-4 rounded-md">
                        <pre className="whitespace-pre-wrap text-sm">
                          {assignment.subject_content}
                        </pre>
                      </div>
                    </div>
                  )}

                  {assignment.subject_document_url && (
                    <div>
                      <p className="text-sm font-medium mb-2">Document joint</p>
                      <Button
                        variant="outline"
                        onClick={async () => {
                          try {
                            // Extract tenant ID from the URL
                            const urlParts = assignment.subject_document_url.split('/');
                            const tenantIdFromUrl = urlParts[4]; // /api/v1/files/{tenantId}/...

                            // Create a proper download request with authentication headers
                            const response = await fetch(`http://localhost:4000${assignment.subject_document_url}`, {
                              headers: {
                                'X-Tenant': tenantIdFromUrl,
                                                                'X-User-Id': '634a57fe-2007-4ecb-ae5b-f9e3152a24fb',
                              },
                            });

                            if (!response.ok) {
                              throw new Error(`Erreur ${response.status}: ${response.statusText}`);
                            }

                            // Create blob and download
                            const blob = await response.blob();
                            const url = window.URL.createObjectURL(blob);
                            const link = document.createElement('a');
                            link.href = url;
                            link.download = `sujet-${assignment.title}.pdf`;
                            document.body.appendChild(link);
                            link.click();
                            document.body.removeChild(link);
                            window.URL.revokeObjectURL(url);
                          } catch (error) {
                            console.error('Erreur lors du téléchargement:', error);
                            alert(`Erreur lors du téléchargement: ${error instanceof Error ? error.message : 'Erreur inconnue'}`);
                          }
                        }}
                      >
                        <FileText className="h-4 w-4 mr-2" />
                        Télécharger le sujet
                      </Button>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        {isEvaluation && (
          <TabsContent value="questions" className="space-y-4">
            <div className="flex justify-between items-center">
              <div>
                <h3 className="text-lg font-medium">Questions ({questions.length})</h3>
                <p className="text-sm text-muted-foreground">
                  Gérez les questions de votre évaluation
                </p>
              </div>
            <GeneratePlaceholdersDialog assignmentId={assignmentId} />

              <Link href={`/academic/evaluations/${assignmentId}/questions/create`}>
                <Button>
                  <Plus className="h-4 w-4 mr-2" />
                  Ajouter une question
                </Button>
              </Link>
            </div>

            <QuestionsList assignmentId={assignmentId} questions={questions} inlineEditIds={inlineEditIds} />
          </TabsContent>
        )}

        <TabsContent value="submissions" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Users className="h-4 w-4" />
                Soumissions ({submissions.length})
              </CardTitle>
              <CardDescription>
                Consultez les soumissions des étudiants
              </CardDescription>
            </CardHeader>
            <CardContent>
              <SubmissionsList
                assignmentId={assignmentId}
                submissions={submissions}
                showActions={false}
              />
              {submissions.length > 0 && (
                <div className="mt-4 text-center">
                  <Link href={`/academic/evaluations/${assignmentId}/grading`}>
                    <Button variant="outline">
                      Voir toutes les soumissions
                    </Button>
                  </Link>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="grading" className="space-y-4">
          <div className="flex justify-between items-center">
            <div>
              <h3 className="text-lg font-medium">Correction et notation</h3>
              <p className="text-sm text-muted-foreground">
                Corrigez et notez les soumissions des étudiants
              </p>
            </div>
            <Link href={`/academic/evaluations/${assignmentId}/grading`}>
              <Button>
                Interface de correction
              </Button>
            </Link>
          </div>

          <SubmissionsList
            assignmentId={assignmentId}
            submissions={submissions}
            showActions={true}
          />
        </TabsContent>

        <TabsContent value="analytics" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <BarChart3 className="h-4 w-4" />
                Statistiques
              </CardTitle>
              <CardDescription>
                Analysez les performances et les résultats
              </CardDescription>
            </CardHeader>
            <CardContent>
              <p className="text-muted-foreground">
                Fonctionnalité en cours de développement...
              </p>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
