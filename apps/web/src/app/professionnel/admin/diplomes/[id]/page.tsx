"use client";

import { useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle, CardDescription, Button, Progress, Badge } from "@ecoledigitale/ui";
import {
  ArrowLeft,
  Edit,
  Loader2,
  ListChecks,
  Users,
  Award,
  RefreshCw,
  Download,
  FileText,
  GraduationCap,
} from "lucide-react";
import {
  useDiploma,
  useDiplomaCandidates,
  useDiplomaAwarded,
  useRecomputeDiploma,
  useAwardDiploma,
  useRevokeDiploma,
  fetchDiplomaAttestation,
} from "@/lib/hooks/use-professional-diplomas";
import { fetchStudent } from "@/lib/hooks/use-students";
import { fetchSignataires, indexSignataires } from "@/lib/hooks/use-professional-signataires";
import { openAttestationPdf } from "@/lib/attestation-pdf";
import { openDiplomePdf } from "@/lib/diplome-pdf";
import { academicYearFromDate } from "@/lib/diplome-format";
import { ConfirmationDialog } from "@/components/ui/confirmation-dialog";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";

function statusBadge(statut: string | null, eligible: boolean) {
  if (statut === "obtenu") return { label: "Obtenu", cls: "bg-green-100 text-green-700" };
  if (statut === "revoque") return { label: "Révoqué", cls: "bg-red-100 text-red-700" };
  if (eligible) return { label: "Éligible", cls: "bg-blue-100 text-blue-700" };
  return { label: "En cours", cls: "bg-gray-100 text-gray-600" };
}

export default function DiplomaDetailPage() {
  const router = useRouter();
  const params = useParams();
  const id = (params?.id as string) ?? "";
  const [activeTab, setActiveTab] = useState<"etudiants" | "exigences" | "octroyes">("etudiants");
  const [error, setError] = useState<string | null>(null);
  const [genBusyId, setGenBusyId] = useState<string | null>(null);

  const diplomaQuery = useDiploma(id);
  const diploma: any = diplomaQuery.data;

  const candidatesQuery = useDiplomaCandidates(id);
  const candidates: any[] = (candidatesQuery.data as any[]) ?? [];

  const awardedQuery = useDiplomaAwarded(id);
  const awarded: any[] = (awardedQuery.data as any[]) ?? [];

  const recomputeMut = useRecomputeDiploma();
  const awardMut = useAwardDiploma();
  const revokeMut = useRevokeDiploma();

  const stats = useMemo(() => {
    const obtenu = candidates.filter((c) => c.statut_octroi === "obtenu").length;
    const eligible = candidates.filter((c) => c.statut_octroi !== "obtenu" && c.eligible).length;
    return { total: candidates.length, obtenu, eligible };
  }, [candidates]);

  // Regroupe les UE exigées par filière (préfixe du code, ex. « L1GL-S1-UE1 » → « L1GL »).
  const requirementsByFiliere = useMemo(() => {
    const groups = new Map<string, any[]>();
    for (const r of diploma?.requirements ?? []) {
      const key = String(r.ue_code ?? "").split("-")[0] || "—";
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(r);
    }
    return [...groups.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [diploma?.requirements]);

  async function handleRecompute() {
    setError(null);
    try {
      await recomputeMut.mutateAsync(id);
      candidatesQuery.refetch();
      awardedQuery.refetch();
    } catch (err: any) {
      setError(err?.message ?? "Erreur lors du recalcul.");
    }
  }

  // Étudiants dont l'octroi forcé attend confirmation / révocation attend un motif :
  // dialogues de la page, plutôt que window.confirm / window.prompt.
  const [forcerOctroiPour, setForcerOctroiPour] = useState<string | null>(null);
  const [revoquerPour, setRevoquerPour] = useState<string | null>(null);
  const [motifRevocation, setMotifRevocation] = useState("");
  const [motifErreur, setMotifErreur] = useState<string | null>(null);

  /** Octroi ordinaire, ou demande de confirmation pour un octroi forcé. */
  function demanderOctroi(studentId: string, force: boolean) {
    if (force) {
      setForcerOctroiPour(studentId);
      return;
    }
    void handleAward(studentId, false);
  }

  async function handleAward(studentId: string, force: boolean) {
    setError(null);
    try {
      await awardMut.mutateAsync({ id, student_id: studentId, force });
      candidatesQuery.refetch();
      awardedQuery.refetch();
    } catch (err: any) {
      setError(err?.message ?? "Erreur lors de l'octroi du diplôme.");
    }
  }

  function demanderRevocation(studentId: string) {
    setMotifRevocation("");
    setMotifErreur(null);
    setRevoquerPour(studentId);
  }

  async function handleRevoke(studentId: string, motif: string) {
    setError(null);
    try {
      await revokeMut.mutateAsync({ id, student_id: studentId, motif: motif.trim() });
      candidatesQuery.refetch();
      awardedQuery.refetch();
    } catch (err: any) {
      setError(err?.message ?? "Erreur lors de la révocation.");
    }
  }

  async function handleGenerate(studentId: string, matricule: string | null, kind: "attestation" | "diplome") {
    if (genBusyId) return;
    setError(null);
    setGenBusyId(`${kind}:${studentId}`);
    // Onglet ouvert de façon synchrone (au clic) pour ne pas être bloqué par le
    // bloqueur de pop-ups, puis on y injecte le PDF une fois généré.
    const win = window.open("", "_blank");
    if (!win) {
      setError(
        "Le navigateur a bloqué l'ouverture d'un nouvel onglet. Autorisez les pop-ups pour ce site, puis réessayez."
      );
      setGenBusyId(null);
      return;
    }
    try {
      const [attestation, student, signatairesList] = await Promise.all([
        fetchDiplomaAttestation(id, studentId) as Promise<any>,
        fetchStudent(studentId).catch(() => null),
        fetchSignataires().catch(() => []),
      ]);
      const sig = indexSignataires(signatairesList);
      // Donnees communes au diplome et a l'attestation. Les UV et les replis
      // d'identite y vivent desormais : ils n'etaient transmis qu'a
      // l'attestation, si bien que le diplome edite depuis CETTE fiche sortait
      // sans « totalisant 13/13 UV », alors que la page liste et l'espace
      // etudiant l'imprimaient. Trois chemins vers un meme document doivent
      // produire le meme texte.
      const commonData = {
        reference: attestation.reference,
        diplome: attestation.diplome,
        etudiant: {
          nom_complet: attestation.etudiant.nom_complet,
          matricule: matricule ?? attestation.etudiant?.matricule ?? null,
          date_naissance: student?.dateOfBirth
            ? String(student.dateOfBirth)
            : attestation.etudiant?.date_naissance
              ? String(attestation.etudiant.date_naissance)
              : null,
          lieu_naissance:
            student?.placeOfBirth ?? attestation.etudiant?.lieu_naissance ?? null,
        },
        date_obtention: attestation.date_obtention,
        annee_academique:
          attestation.annee_academique ?? academicYearFromDate(attestation.date_obtention),
        mention: attestation.mention ?? null,
      };
      if (kind === "attestation") {
        await openAttestationPdf(
          {
            ...commonData,
            uv_total_validees: attestation.uv_total_validees,
            signataire: sig.attestation_reussite ?? null,
          },
          win
        );
      } else {
        await openDiplomePdf(
          {
            ...commonData,
            signataire_gauche: sig.diplome_gauche ?? null,
            signataire_droite: sig.diplome_droite ?? null,
          },
          win
        );
      }
    } catch (err: any) {
      if (win && !win.closed) win.close();
      setError(err?.message ?? "Erreur lors de la génération du document.");
    } finally {
      setGenBusyId(null);
    }
  }

  if (diplomaQuery.isLoading) {
    return (
      <div className="max-w-6xl mx-auto p-6">
        <Card className="shadow-lg">
          <CardContent className="flex items-center justify-center py-16">
            <Loader2 className="h-8 w-8 animate-spin text-emerald-600" />
          </CardContent>
        </Card>
      </div>
    );
  }

  const TABS: Array<{ id: "etudiants" | "exigences" | "octroyes"; label: string; icon: React.ElementType }> = [
    { id: "etudiants", label: "Étudiants & attestations", icon: Users },
    { id: "exigences", label: "UE requises", icon: ListChecks },
    { id: "octroyes", label: "Diplômes octroyés", icon: Award },
  ];

  return (
    <div className="space-y-6 max-w-6xl mx-auto p-6">
      <ConfirmationDialog
        open={forcerOctroiPour !== null}
        onOpenChange={(open) => {
          if (!open) setForcerOctroiPour(null);
        }}
        title="Forcer l'octroi du diplôme ?"
        description="Cet étudiant n'a pas encore validé toutes les UE requises. Forcer l'octroi du diplôme malgré tout ?"
        confirmText="Forcer l'octroi"
        variant="destructive"
        onConfirm={() => {
          const studentId = forcerOctroiPour;
          setForcerOctroiPour(null);
          if (studentId) void handleAward(studentId, true);
        }}
      />

      <Dialog
        open={revoquerPour !== null}
        onOpenChange={(open) => {
          if (!open) setRevoquerPour(null);
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Révoquer ce diplôme ?</DialogTitle>
            <DialogDescription>
              La révocation est définitive : le diplôme ne pourra plus être régénéré. Le motif est
              obligatoire et reste consigné.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <label htmlFor="motif-revocation" className="text-sm font-medium">
              Motif de la révocation (obligatoire)
            </label>
            <Textarea
              id="motif-revocation"
              value={motifRevocation}
              onChange={(e) => setMotifRevocation(e.target.value)}
              rows={3}
            />
            {motifErreur && (
              <p role="alert" className="text-sm text-red-600">
                {motifErreur}
              </p>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRevoquerPour(null)}>
              Annuler
            </Button>
            <Button
              variant="destructive"
              disabled={revokeMut.isPending}
              onClick={() => {
                if (!motifRevocation.trim()) {
                  setMotifErreur("Le motif de révocation est requis.");
                  return;
                }
                const studentId = revoquerPour;
                setRevoquerPour(null);
                if (studentId) void handleRevoke(studentId, motifRevocation);
              }}
            >
              Révoquer
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <div className="mb-6 flex max-w-full flex-col items-start gap-2 overflow-x-auto md:mb-8 md:gap-3">
        <div className="mb-6 flex max-w-full flex-col items-start gap-2 overflow-x-auto md:mb-8 md:gap-3">
          <Button variant="outline" size="sm" onClick={() => router.push("/professionnel/admin/diplomes")}>
            <ArrowLeft className="h-4 w-4 mr-2" />
            Retour
          </Button>
          <div>
            <h1 className="whitespace-nowrap font-bold flex items-center gap-2 leading-tight text-2xl md:text-3xl">
              <GraduationCap className="h-6 w-6 text-emerald-600" />
              {diploma?.libelle}
            </h1>
            <p className="whitespace-nowrap text-muted-foreground text-sm md:text-base">
              <span className="font-mono">{diploma?.code}</span> · {diploma?.uv_required} UV requises (
              {requirementsByFiliere.length} année{requirementsByFiliere.length > 1 ? "s" : ""}) ·{" "}
              {diploma?.statut}
            </p>
          </div>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={handleRecompute} disabled={recomputeMut.isPending}>
            {recomputeMut.isPending ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <RefreshCw className="h-4 w-4 mr-2" />
            )}
            Recalculer l'éligibilité
          </Button>
          <Button variant="outline" onClick={() => router.push(`/professionnel/admin/diplomes/${id}/edit`)}>
            <Edit className="h-4 w-4 mr-2" />
            Modifier
          </Button>
        </div>
      </div>

      {error && (
        <div className="rounded-md border border-red-300 bg-red-50 px-4 py-2 text-sm text-red-700">{error}</div>
      )}

      <div className="grid grid-cols-3 gap-4">
        <div className="rounded-xl p-4 text-white bg-gradient-to-br from-emerald-500 to-teal-600 shadow">
          <p className="text-white/80 text-sm font-medium">Candidats</p>
          <p className="text-3xl font-bold mt-1">{stats.total}</p>
        </div>
        <div className="rounded-xl p-4 text-white bg-gradient-to-br from-blue-500 to-indigo-600 shadow">
          <p className="text-white/80 text-sm font-medium">Éligibles (non octroyés)</p>
          <p className="text-3xl font-bold mt-1">{stats.eligible}</p>
        </div>
        <div className="rounded-xl p-4 text-white bg-gradient-to-br from-amber-500 to-orange-600 shadow">
          <p className="text-white/80 text-sm font-medium">Diplômes obtenus</p>
          <p className="text-3xl font-bold mt-1">{stats.obtenu}</p>
        </div>
      </div>

      <div className="border-b border-border">
        <nav className="flex flex-wrap gap-2">
          {TABS.map(({ id: tabId, label, icon: Icon }) => {
            const isActive = activeTab === tabId;
            return (
              <button
                key={tabId}
                type="button"
                onClick={() => setActiveTab(tabId)}
                className={`flex items-center gap-2 px-4 py-2 text-sm font-medium border-b-2 transition-colors -mb-px ${
                  isActive ? "border-emerald-600 text-emerald-600" : "border-transparent text-muted-foreground hover:text-foreground"
                }`}
              >
                <Icon className="h-4 w-4" />
                {label}
              </button>
            );
          })}
        </nav>
      </div>

      {activeTab === "exigences" && (
        <Card className="shadow-lg">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <ListChecks className="h-5 w-5 text-emerald-600" />
              UE requises, par année du cycle
            </CardTitle>
            <CardDescription>
              Dérivées automatiquement des semestres de chaque année du cycle — resynchronisées à
              chaque « Recalculer l'éligibilité ». L'étudiant doit valider toutes ces UE pour obtenir
              le diplôme.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            {requirementsByFiliere.length === 0 ? (
              <p className="text-sm text-muted-foreground">Aucune UE exigée pour l'instant.</p>
            ) : (
              requirementsByFiliere.map(([filiereCode, reqs]) => (
                <div key={filiereCode} className="space-y-2">
                  <div className="flex items-center gap-2">
                    <Badge variant="outline" className="font-mono">
                      {filiereCode}
                    </Badge>
                    <span className="text-xs text-muted-foreground">
                      {reqs.length} UE · {reqs.reduce((s: number, r: any) => s + r.ue_nb_uv, 0)} UV
                    </span>
                  </div>
                  <div className="overflow-x-auto rounded-lg border">
                    <table className="w-full text-sm">
                      <tbody>
                        {reqs
                          .sort((a: any, b: any) => a.ordre - b.ordre)
                          .map((r: any) => (
                            <tr key={r.ue_id} className="border-b last:border-0">
                              <td className="py-2 px-3 font-mono text-xs text-muted-foreground w-40">{r.ue_code}</td>
                              <td className="py-2 px-3">{r.ue_libelle}</td>
                              <td className="py-2 px-3 text-center w-16">{r.ue_nb_uv} UV</td>
                            </tr>
                          ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              ))
            )}
          </CardContent>
        </Card>
      )}

      {activeTab === "etudiants" && (
        <Card className="shadow-lg">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Users className="h-5 w-5 text-emerald-600" />
              Candidats & progression
            </CardTitle>
            <CardDescription>
              Étudiants inscrits dans l'une des années du cycle. Une attestation ou un diplôme ne
              peuvent être générés qu'une fois le diplôme obtenu (toutes les UV requises validées).
            </CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            {candidatesQuery.isLoading ? (
              <div className="flex justify-center py-12">
                <Loader2 className="h-8 w-8 animate-spin text-emerald-600" />
              </div>
            ) : candidates.length === 0 ? (
              <p className="text-sm text-muted-foreground p-6">Aucun étudiant inscrit dans ce cycle.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-muted-foreground border-b bg-muted/30">
                      <th className="px-4 py-3">Étudiant</th>
                      <th className="px-4 py-3">Matricule</th>
                      <th className="px-4 py-3 text-center">Progression</th>
                      <th className="px-4 py-3 text-center">Statut</th>
                      <th className="px-4 py-3 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {candidates.map((c) => {
                      const badge = statusBadge(c.statut_octroi, c.eligible);
                      const isObtenu = c.statut_octroi === "obtenu";
                      const busyAtt = genBusyId === `attestation:${c.student_id}`;
                      const busyDip = genBusyId === `diplome:${c.student_id}`;
                      return (
                        <tr key={c.student_id} className="border-b last:border-0 hover:bg-muted/20">
                          <td className="px-4 py-2.5 font-medium">{c.nom_complet}</td>
                          <td className="px-4 py-2.5 font-mono text-xs text-muted-foreground">
                            {c.student_number ?? "—"}
                          </td>
                          <td className="px-4 py-2.5">
                            <div className="flex items-center gap-2 min-w-[140px]">
                              <Progress value={c.pourcentage} className="h-2 flex-1" />
                              <span className="text-xs font-mono w-10 text-right">{c.pourcentage}%</span>
                            </div>
                            <div className="text-[11px] text-muted-foreground text-center mt-0.5">
                              {c.uv_validees}/{diploma?.uv_required} UV
                            </div>
                          </td>
                          <td className="px-4 py-2.5 text-center">
                            <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${badge.cls}`}>
                              {badge.label}
                            </span>
                            {c.statut_octroi === "revoque" && c.motif_revocation && (
                              <div className="mt-1 text-[11px] text-muted-foreground">
                                Motif : {c.motif_revocation}
                              </div>
                            )}
                          </td>
                          <td className="px-4 py-2.5">
                            <div className="flex justify-end gap-1.5 flex-wrap">
                              {c.statut_octroi === "revoque" && (
                                <span className="text-xs text-muted-foreground">Diplôme révoqué</span>
                              )}
                              {!isObtenu && c.statut_octroi !== "revoque" && (
                                <Button
                                  size="sm"
                                  variant="outline"
                                  className="h-8"
                                  disabled={awardMut.isPending}
                                  onClick={() => demanderOctroi(c.student_id, !c.eligible)}
                                >
                                  {c.eligible ? "Octroyer" : "Forcer l'octroi"}
                                </Button>
                              )}
                              {isObtenu && (
                                <>
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    className="h-8"
                                    disabled={busyAtt}
                                    onClick={() => handleGenerate(c.student_id, c.student_number ?? null, "attestation")}
                                  >
                                    {busyAtt ? (
                                      <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
                                    ) : (
                                      <FileText className="h-3.5 w-3.5 mr-1.5" />
                                    )}
                                    Attestation
                                  </Button>
                                  <Button
                                    size="sm"
                                    className="h-8"
                                    disabled={busyDip}
                                    onClick={() => handleGenerate(c.student_id, c.student_number ?? null, "diplome")}
                                  >
                                    {busyDip ? (
                                      <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
                                    ) : (
                                      <Download className="h-3.5 w-3.5 mr-1.5" />
                                    )}
                                    Diplôme
                                  </Button>
                                </>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {activeTab === "octroyes" && (
        <Card className="shadow-lg">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Award className="h-5 w-5 text-emerald-600" />
              Diplômes octroyés
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {awardedQuery.isLoading ? (
              <div className="flex justify-center py-12">
                <Loader2 className="h-8 w-8 animate-spin text-emerald-600" />
              </div>
            ) : awarded.length === 0 ? (
              <p className="text-sm text-muted-foreground p-6">Aucun diplôme octroyé pour l'instant.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-muted-foreground border-b bg-muted/30">
                      <th className="px-4 py-3">Étudiant</th>
                      <th className="px-4 py-3">Référence</th>
                      <th className="px-4 py-3 text-center">Statut</th>
                      <th className="px-4 py-3 text-center">Date d'obtention</th>
                      <th className="px-4 py-3 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {awarded.map((a) => (
                      <tr key={a.id} className="border-b last:border-0 hover:bg-muted/20">
                        <td className="px-4 py-2.5 font-medium">{a.student_nom ?? a.student_id}</td>
                        <td className="px-4 py-2.5 font-mono text-xs">{a.reference}</td>
                        <td className="px-4 py-2.5 text-center">
                          <span
                            className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${
                              a.statut === "obtenu" ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700"
                            }`}
                          >
                            {a.statut === "obtenu" ? "Obtenu" : "Révoqué"}
                          </span>
                          {a.statut !== "obtenu" && a.motif_revocation && (
                            <div className="mt-1 text-[11px] text-muted-foreground">
                              Motif : {a.motif_revocation}
                            </div>
                          )}
                        </td>
                        <td className="px-4 py-2.5 text-center text-xs text-muted-foreground">
                          {a.date_obtention ? new Date(a.date_obtention).toLocaleDateString("fr-FR") : "—"}
                        </td>
                        <td className="px-4 py-2.5 text-right">
                          {a.statut === "obtenu" && (
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-8"
                              disabled={revokeMut.isPending}
                              onClick={() => demanderRevocation(a.student_id)}
                            >
                              Révoquer
                            </Button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
