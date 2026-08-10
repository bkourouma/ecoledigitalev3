"use client";

import { useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle, CardDescription, Button, Progress } from "@ecoledigitale/ui";
import {
  ArrowLeft,
  Edit,
  GraduationCap,
  BookOpen,
  Users,
  ChevronDown,
  ChevronUp,
  FileText,
  Download,
  Plus,
  Loader2,
} from "lucide-react";
import { useProgramme, useUpdateProgramme } from "@/lib/hooks/use-programmes";
import { useCycles } from "@/lib/hooks/use-cycles";
import { useCourses } from "@/lib/hooks/use-courses";
import { AcademicModal } from "@/components/academic/AcademicModal";
import { ProgrammeForm } from "@/components/academic/ProgrammeForm";
import {
  useDiplomas,
  useDiplomaCandidates,
  useDiplomaStudentProgress,
  useEnsureCycleDiploma,
  fetchDiplomaAttestation,
} from "@/lib/hooks/use-professional-diplomas";
import { fetchStudent } from "@/lib/hooks/use-students";
import { downloadAttestationPdf } from "@/lib/attestation-pdf";
import { downloadDiplomePdf } from "@/lib/diplome-pdf";
import { cycleLabel, cycleDureeAnnees, MENTIONS, academicYearFromDate } from "@/lib/diplome-format";

function StudentProgressRow({
  candidate,
  diplomaId,
  uvRequired,
  onGenerate,
  busyKind,
  mention,
  onMentionChange,
}: {
  candidate: any;
  diplomaId: string;
  uvRequired: number;
  onGenerate: (studentId: string, matricule: string | null, kind: "attestation" | "diplome") => void;
  busyKind: string | null;
  mention: string;
  onMentionChange: (value: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const progressQuery = useDiplomaStudentProgress(expanded ? diplomaId : null, candidate.student_id);
  const progress: any = progressQuery.data;
  const isObtenu = candidate.statut_octroi === "obtenu";

  return (
    <>
      <tr className="border-b last:border-0 hover:bg-muted/20">
        <td className="px-4 py-2.5">
          <button
            type="button"
            className="flex items-center gap-1.5 font-medium"
            onClick={() => setExpanded((v) => !v)}
          >
            {expanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
            {candidate.nom_complet}
          </button>
        </td>
        <td className="px-4 py-2.5 font-mono text-xs text-muted-foreground">
          {candidate.student_number ?? "—"}
        </td>
        <td className="px-4 py-2.5">
          <div className="flex items-center gap-2 min-w-[140px]">
            <Progress value={candidate.pourcentage} className="h-2 flex-1" />
            <span className="text-xs font-mono w-10 text-right">{candidate.pourcentage}%</span>
          </div>
          <div className="text-[11px] text-muted-foreground mt-0.5">
            {candidate.uv_validees}/{uvRequired} UV
          </div>
        </td>
        <td className="px-4 py-2.5 text-center">
          {isObtenu ? (
            <span className="inline-flex rounded-full px-2 py-0.5 text-xs font-medium bg-green-100 text-green-700">
              Diplôme obtenu
            </span>
          ) : candidate.eligible ? (
            <span className="inline-flex rounded-full px-2 py-0.5 text-xs font-medium bg-blue-100 text-blue-700">
              Éligible
            </span>
          ) : (
            <span className="inline-flex rounded-full px-2 py-0.5 text-xs font-medium bg-gray-100 text-gray-600">
              En cours
            </span>
          )}
        </td>
        <td className="px-4 py-2.5 text-right">
          {isObtenu && (
            <div className="flex justify-end items-center gap-1.5">
              <select
                className="h-8 rounded-md border border-input bg-background px-2 text-xs"
                value={mention}
                onChange={(e) => onMentionChange(e.target.value)}
              >
                <option value="">Mention…</option>
                {MENTIONS.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
              <Button
                size="sm"
                variant="outline"
                className="h-8"
                disabled={busyKind === `attestation:${candidate.student_id}`}
                onClick={() => onGenerate(candidate.student_id, candidate.student_number ?? null, "attestation")}
              >
                {busyKind === `attestation:${candidate.student_id}` ? (
                  <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
                ) : (
                  <FileText className="h-3.5 w-3.5 mr-1.5" />
                )}
                Attestation
              </Button>
              <Button
                size="sm"
                className="h-8"
                disabled={busyKind === `diplome:${candidate.student_id}`}
                onClick={() => onGenerate(candidate.student_id, candidate.student_number ?? null, "diplome")}
              >
                {busyKind === `diplome:${candidate.student_id}` ? (
                  <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
                ) : (
                  <Download className="h-3.5 w-3.5 mr-1.5" />
                )}
                Diplôme
              </Button>
            </div>
          )}
        </td>
      </tr>
      {expanded && (
        <tr className="border-b last:border-0 bg-muted/10">
          <td colSpan={5} className="px-4 py-3">
            {progressQuery.isLoading ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                Chargement du parcours…
              </div>
            ) : progress ? (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
                <div>
                  <p className="font-medium text-green-700 mb-1.5">
                    UE validées ({progress.ue_validees.length})
                  </p>
                  {progress.ue_validees.length === 0 ? (
                    <p className="text-muted-foreground text-xs">Aucune UE validée pour l'instant.</p>
                  ) : (
                    <ul className="space-y-1">
                      {progress.ue_validees.map((u: any) => (
                        <li key={u.ue_id} className="flex items-center gap-2">
                          <span className="font-mono text-xs">{u.code}</span>
                          <span>{u.libelle}</span>
                          <span className="text-xs text-muted-foreground">({u.nb_uv} UV)</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
                <div>
                  <p className="font-medium text-amber-700 mb-1.5">
                    UE restantes ({progress.ue_restantes.length})
                  </p>
                  {progress.ue_restantes.length === 0 ? (
                    <p className="text-muted-foreground text-xs">Toutes les UE exigées sont validées.</p>
                  ) : (
                    <ul className="space-y-1">
                      {progress.ue_restantes.map((u: any) => (
                        <li key={u.ue_id} className="flex items-center gap-2">
                          <span className="font-mono text-xs">{u.code}</span>
                          <span>{u.libelle}</span>
                          {u.est_obligatoire && (
                            <span className="text-xs font-medium text-red-600">(obligatoire)</span>
                          )}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">Parcours indisponible.</p>
            )}
          </td>
        </tr>
      )}
    </>
  );
}

export default function ProgrammeDetailPage() {
  const params = useParams();
  const router = useRouter();
  const [showEditModal, setShowEditModal] = useState(false);
  const updateProgrammeMutation = useUpdateProgramme();
  const programmeId = params.id as string;

  const { data: programme, isLoading, error } = useProgramme(programmeId);
  const { data: cyclesData } = useCycles();
  const { data: coursesData } = useCourses();
  const cycles = cyclesData?.data || [];
  const courses = coursesData?.data || [];

  const [selectedDiplomaId, setSelectedDiplomaId] = useState<string>("");
  const [diplomaError, setDiplomaError] = useState<string | null>(null);
  const [busyKind, setBusyKind] = useState<string | null>(null);
  const [mentions, setMentions] = useState<Record<string, string>>({});
  const diplomasQuery = useDiplomas({ filiere_id: programmeId });
  const diplomas: any[] = (diplomasQuery.data as any[]) ?? [];
  const activeDiplomaId = selectedDiplomaId || diplomas[0]?.id || "";
  const activeDiploma = diplomas.find((d) => d.id === activeDiplomaId);
  const ensureCycleDiplomaMut = useEnsureCycleDiploma();

  async function handleOpenCycleDiploma() {
    setDiplomaError(null);
    try {
      const diploma: any = await ensureCycleDiplomaMut.mutateAsync(programmeId);
      router.push(`/professionnel/admin/diplomes/${diploma.id}`);
    } catch (err: any) {
      setDiplomaError(err?.message ?? "Erreur lors de la préparation du diplôme.");
    }
  }
  const candidatesQuery = useDiplomaCandidates(activeDiplomaId || null);
  const candidates: any[] = (candidatesQuery.data as any[]) ?? [];
  const diplomaGrade = cycleLabel(programme?.name);
  const diplomaDuree = cycleDureeAnnees(programme?.name);
  const diplomaStats = useMemo(() => {
    const obtenu = candidates.filter((c) => c.statut_octroi === "obtenu").length;
    return { total: candidates.length, obtenu };
  }, [candidates]);

  async function handleGenerateDocument(
    studentId: string,
    matricule: string | null,
    kind: "attestation" | "diplome"
  ) {
    if (!activeDiplomaId) return;
    setDiplomaError(null);
    setBusyKind(`${kind}:${studentId}`);
    try {
      const [attestation, student] = await Promise.all([
        fetchDiplomaAttestation(activeDiplomaId, studentId) as Promise<any>,
        fetchStudent(studentId).catch(() => null),
      ]);
      const commonData = {
        reference: attestation.reference,
        diplome: attestation.diplome,
        etudiant: {
          nom_complet: attestation.etudiant.nom_complet,
          matricule,
          date_naissance: student?.dateOfBirth ? String(student.dateOfBirth) : null,
          lieu_naissance: student?.placeOfBirth ?? null,
        },
        date_obtention: attestation.date_obtention,
        annee_academique: academicYearFromDate(attestation.date_obtention),
        mention: mentions[studentId]?.trim() || null,
      };
      if (kind === "attestation") {
        await downloadAttestationPdf({ ...commonData, uv_total_validees: attestation.uv_total_validees });
      } else {
        await downloadDiplomePdf(commonData);
      }
    } catch (err: any) {
      setDiplomaError(err?.message ?? "Erreur lors de la génération du document.");
    } finally {
      setBusyKind(null);
    }
  }

  const handleEditSubmit = async (data: any) => {
    await updateProgrammeMutation.mutateAsync({ id: programmeId, data });
    setShowEditModal(false);
  };

  if (isLoading) {
    return (
      <div className="container mx-auto px-4 sm:px-6 py-4 sm:py-8 max-w-7xl">
        <div className="animate-pulse space-y-6">
          <div className="h-8 bg-gray-200 rounded w-1/3" />
          <div className="h-64 bg-gray-200 rounded" />
        </div>
      </div>
    );
  }

  if (error || !programme) {
    return (
      <div className="container mx-auto px-4 sm:px-6 py-4 sm:py-8 max-w-7xl">
        <div className="text-center space-y-4">
          <h1 className="text-xl sm:text-2xl font-bold text-red-600">Programme non trouve</h1>
          <p className="text-sm sm:text-base text-muted-foreground">
            Le programme demande n&apos;existe pas ou a ete supprime.
          </p>
          <Button onClick={() => router.push("/academic/programmes")} className="w-full sm:w-auto">
            <ArrowLeft className="w-4 h-4 mr-2" />
            Retour aux programmes
          </Button>
        </div>
      </div>
    );
  }

  const programmeCycle = cycles.find((cycle) => cycle.id === programme.cycleId);
  const programmeCourses = courses.filter((course) => course.programmeId === programme.id);

  return (
    <div className="container mx-auto px-4 sm:px-6 py-4 sm:py-8 max-w-7xl">
      <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4 mb-6 sm:mb-8">
        <Button
          variant="outline"
          onClick={() => router.push("/academic/programmes")}
          className="flex items-center gap-2 w-full sm:w-auto"
        >
          <ArrowLeft className="w-4 h-4" />
          <span className="hidden sm:inline">Retour</span>
        </Button>

        <div className="flex-1 w-full min-w-0">
          <div className="flex flex-wrap items-center gap-2 sm:gap-3 mb-2">
            <h1 className="text-2xl sm:text-3xl font-bold break-words">{programme.name}</h1>
            <span
              className={`px-2 sm:px-3 py-1 text-xs sm:text-sm rounded-full font-medium whitespace-nowrap ${
                programme.status === "active"
                  ? "bg-green-100 text-green-800"
                  : programme.status === "draft"
                    ? "bg-yellow-100 text-yellow-800"
                    : programme.status === "review"
                      ? "bg-blue-100 text-blue-800"
                      : programme.status === "approved"
                        ? "bg-purple-100 text-purple-800"
                        : "bg-gray-100 text-gray-800"
              }`}
            >
              {programme.status === "active"
                ? "Actif"
                : programme.status === "draft"
                  ? "Brouillon"
                  : programme.status === "review"
                    ? "En revision"
                    : programme.status === "approved"
                      ? "Approuve"
                      : programme.status === "archived"
                        ? "Archive"
                        : programme.status}
            </span>
          </div>

          <p className="text-sm sm:text-base text-muted-foreground break-words">
            Code: {programme.code}
            {programmeCycle ? ` | Cycle: ${programmeCycle.code} - ${programmeCycle.name}` : ""}
          </p>
        </div>

        <Button
          className="bg-gradient-to-r from-pink-500 to-orange-600 hover:from-pink-600 hover:to-orange-700 w-full sm:w-auto"
          onClick={() => setShowEditModal(true)}
        >
          <Edit className="w-4 h-4 sm:mr-2" />
          <span className="hidden sm:inline">Modifier</span>
        </Button>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 sm:gap-4 mb-6 sm:mb-8">
        <div className="bg-gradient-to-br from-pink-500 to-orange-600 p-3 sm:p-4 rounded-xl text-white shadow">
          <div className="flex items-center justify-between">
            <div className="min-w-0 flex-1">
              <p className="text-white/80 text-xs">Cours</p>
              <p className="text-xl sm:text-2xl font-bold mt-1">{programmeCourses.length}</p>
            </div>
            <BookOpen className="h-5 w-5 sm:h-6 sm:w-6 opacity-90 flex-shrink-0 ml-2" />
          </div>
        </div>

        {programmeCycle && (
          <div className="bg-gradient-to-br from-blue-500 to-cyan-600 p-3 sm:p-4 rounded-xl text-white shadow">
            <div className="flex items-center justify-between">
              <div className="min-w-0 flex-1">
                <p className="text-white/80 text-xs">Cycle</p>
                <p className="text-base sm:text-lg font-semibold mt-1 truncate">{programmeCycle.code}</p>
              </div>
              <GraduationCap className="h-5 w-5 sm:h-6 sm:w-6 opacity-90 flex-shrink-0 ml-2" />
            </div>
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 sm:gap-8">
        <div className="lg:col-span-2 space-y-4 sm:space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-lg sm:text-xl">
                <BookOpen className="w-5 h-5" />
                Informations du programme
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {programme.description && (
                <div>
                  <h3 className="font-medium mb-2 text-sm sm:text-base">Description</h3>
                  <p className="text-sm sm:text-base text-muted-foreground whitespace-pre-wrap break-words">
                    {programme.description}
                  </p>
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
                {programmeCycle && (
                  <div className="flex items-center gap-2">
                    <GraduationCap className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                    <span className="text-sm sm:text-base break-words">{programmeCycle.name}</span>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        </div>

        <div className="space-y-4 sm:space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-base sm:text-lg">Actions rapides</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <Button
                className="w-full justify-start bg-gradient-to-r from-pink-500 to-orange-600 hover:from-pink-600 hover:to-orange-700 text-sm sm:text-base"
                onClick={() => setShowEditModal(true)}
              >
                <Edit className="w-4 h-4 mr-2" />
                Modifier
              </Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base sm:text-lg">Statistiques</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 sm:space-y-4">
              <div className="flex justify-between items-center">
                <span className="text-xs sm:text-sm text-muted-foreground">Cours</span>
                <span className="text-sm sm:text-base font-medium">{programmeCourses.length}</span>
              </div>

              {programmeCycle && (
                <div className="flex justify-between items-center">
                  <span className="text-xs sm:text-sm text-muted-foreground">Cycle</span>
                  <span className="text-sm sm:text-base font-medium break-words text-right">{programmeCycle.name}</span>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      <Card className="mt-6 sm:mt-8">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg sm:text-xl">
            <GraduationCap className="w-5 h-5 text-emerald-600" />
            Diplôme{diplomas.length > 1 ? "s" : ""} de cette filière
          </CardTitle>
          <CardDescription>
            {diplomaGrade !== "—"
              ? `Cursus ${diplomaGrade.toLowerCase()}${diplomaDuree ? ` (${diplomaDuree} ans)` : ""} : le diplôme est obtenu lorsque l'étudiant valide toutes les UE exigées et capitalise les UV requises.`
              : "Configurez un diplôme pour suivre le parcours des étudiants jusqu'à son obtention."}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {diplomaError && (
            <div className="rounded-md border border-red-300 bg-red-50 px-4 py-2 text-sm text-red-700">
              {diplomaError}
            </div>
          )}

          {diplomasQuery.isLoading ? (
            <div className="flex justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-emerald-600" />
            </div>
          ) : diplomas.length === 0 ? (
            <div className="text-center py-8 space-y-3">
              <p className="text-sm text-muted-foreground">
                Aucun diplôme configuré pour le cycle de cette filière.
              </p>
              <Button onClick={handleOpenCycleDiploma} disabled={ensureCycleDiplomaMut.isPending}>
                {ensureCycleDiplomaMut.isPending ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <Plus className="h-4 w-4 mr-2" />
                )}
                Ouvrir le diplôme du cycle
              </Button>
            </div>
          ) : (
            <>
              {diplomas.length > 1 && (
                <div className="flex flex-wrap gap-2">
                  {diplomas.map((d) => (
                    <button
                      key={d.id}
                      type="button"
                      onClick={() => setSelectedDiplomaId(d.id)}
                      className={`rounded-full px-3 py-1.5 text-sm border ${
                        activeDiplomaId === d.id
                          ? "bg-emerald-600 text-white border-emerald-600"
                          : "border-border text-muted-foreground hover:bg-muted"
                      }`}
                    >
                      {d.libelle}
                    </button>
                  ))}
                </div>
              )}

              {activeDiploma && (
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="text-sm text-muted-foreground">
                    <span className="font-mono">{activeDiploma.code}</span> · {activeDiploma.uv_required} UV
                    requises · {diplomaStats.total} étudiant(s) · {diplomaStats.obtenu} diplôme(s) obtenu(s)
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => router.push(`/professionnel/admin/diplomes/${activeDiploma.id}`)}
                  >
                    Gérer ce diplôme
                  </Button>
                </div>
              )}

              {activeDiplomaId && (
                <div className="space-y-2">
                  <p className="text-sm font-medium flex items-center gap-2 pt-2">
                    <Users className="h-4 w-4 text-pink-600" />
                    Parcours des étudiants
                  </p>
                  {candidatesQuery.isLoading ? (
                    <div className="flex justify-center py-8">
                      <Loader2 className="h-6 w-6 animate-spin text-pink-600" />
                    </div>
                  ) : candidates.length === 0 ? (
                    <p className="text-sm text-muted-foreground">Aucun étudiant inscrit dans cette filière.</p>
                  ) : (
                    <div className="overflow-x-auto rounded-lg border">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="text-left text-muted-foreground border-b bg-muted/30">
                            <th className="px-4 py-3">Étudiant</th>
                            <th className="px-4 py-3">Matricule</th>
                            <th className="px-4 py-3 text-center">Progression</th>
                            <th className="px-4 py-3 text-center">Statut</th>
                            <th className="px-4 py-3 text-right">Documents</th>
                          </tr>
                        </thead>
                        <tbody>
                          {candidates.map((c) => (
                            <StudentProgressRow
                              key={c.student_id}
                              candidate={c}
                              diplomaId={activeDiplomaId}
                              uvRequired={activeDiploma?.uv_required ?? 0}
                              onGenerate={handleGenerateDocument}
                              busyKind={busyKind}
                              mention={mentions[c.student_id] ?? ""}
                              onMentionChange={(value) =>
                                setMentions((prev) => ({ ...prev, [c.student_id]: value }))
                              }
                            />
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>

      <AcademicModal
        isOpen={showEditModal}
        onClose={() => setShowEditModal(false)}
        title="Modifier le programme"
        description="Modifiez les informations du programme"
        onSubmit={() => {}}
        isSubmitting={updateProgrammeMutation.isPending}
        showFooter={false}
        size="xl"
      >
        <ProgrammeForm
          programme={programme}
          onSubmit={handleEditSubmit}
          onCancel={() => setShowEditModal(false)}
          isLoading={updateProgrammeMutation.isPending}
        />
      </AcademicModal>
    </div>
  );
}
