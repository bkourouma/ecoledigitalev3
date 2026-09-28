"use client";

import { useMemo, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { Card, CardContent, Input } from "@ecoledigitale/ui";
import {
  ArrowLeft,
  ClipboardCheck,
  Loader2,
  AlertCircle,
  Search,
  Clock,
  MapPin,
  UserRound,
  BookOpen,
  Layers,
  CalendarRange,
  ShieldCheck,
  Undo2,
  FileText,
  Paperclip,
  Trash2,
} from "lucide-react";
import {
  useSeanceAttendance,
  useJustifyAbsence,
  useUploadJustificatif,
  useDeleteJustificatif,
  fetchJustificatifUrl,
} from "@/lib/hooks/use-professional-catalog-admin";

/**
 * Détail d'une séance — Présences (admin, module professionnel).
 *
 * Fiche complète d'une séance d'ECUE : quelle séance (libellé, date, horaire,
 * durée, salle), quelle matière et à quoi elle se rattache (UE, semestre,
 * session), quel enseignant l'a assurée, qui a enregistré l'appel et quand,
 * puis le pointage étudiant par étudiant.
 *
 * L'admin peut y justifier une absence : le statut passe de `absent` à
 * `excuse`, la valeur que le bulletin compte comme « absence justifiée »
 * (professional-bulletin.service.ts : 'absent' = non justifiée, 'excuse' =
 * justifiée). La justification est donc immédiatement reprise par le bulletin
 * du semestre, et reste réversible.
 *
 * Paramètre `student_id` : quand on arrive depuis le détail d'un étudiant, le
 * pointage n'affiche que CET étudiant — on consultait sa fiche, pas celle de la
 * promotion. Un lien permet de revenir au pointage complet. Sans le paramètre
 * (accès depuis la liste des séances), toute la promotion est listée.
 */

const STATUT_PRESENCE: Record<string, { label: string; className: string }> = {
  present: { label: "Présent", className: "bg-green-100 text-green-700" },
  absent: { label: "Absence non justifiée", className: "bg-red-100 text-red-700" },
  retard: { label: "Retard", className: "bg-amber-100 text-amber-700" },
  excuse: { label: "Absence justifiée", className: "bg-blue-100 text-blue-700" },
};

const ENSEIGNANT_SOURCE_LABEL: Record<string, string> = {
  seance: "enseignant de la séance",
  ecue: "enseignant affecté à l'ECUE dans la session",
  session: "enseignant de la session",
};

function fmtHeures(h: number | null | undefined): string {
  const v = Number(h ?? 0);
  const heures = Math.floor(v);
  const minutes = Math.round((v - heures) * 60);
  return minutes > 0 ? `${heures}h${String(minutes).padStart(2, "0")}` : `${heures}h`;
}

function fmtDuree(min: number | null | undefined): string {
  const v = Number(min ?? 0);
  return v <= 0 ? "—" : fmtHeures(v / 60);
}

function fmtDateLongueFr(d: string | null | undefined): string {
  if (!d) return "—";
  const x = new Date(d);
  return isNaN(x.getTime())
    ? String(d)
    : x.toLocaleDateString("fr-FR", {
        weekday: "long",
        day: "2-digit",
        month: "long",
        year: "numeric",
      });
}

function fmtDateHeureFr(d: string | null | undefined): string {
  if (!d) return "—";
  const x = new Date(d);
  if (isNaN(x.getTime())) return String(d);
  return `${x.toLocaleDateString("fr-FR")} à ${x.toLocaleTimeString("fr-FR", {
    hour: "2-digit",
    minute: "2-digit",
  })}`;
}

function hm(t: string | null | undefined): string {
  return t ? String(t).slice(0, 5) : "—";
}

/** 1048576 → « 1 Mo » ; 2048 → « 2 Ko ». */
function fmtTaille(octets: number | null | undefined): string {
  const v = Number(octets ?? 0);
  if (v <= 0) return "—";
  if (v < 1024) return `${v} o`;
  if (v < 1024 * 1024) return `${Math.round(v / 1024)} Ko`;
  return `${(v / (1024 * 1024)).toFixed(1)} Mo`;
}

export default function SeanceDetailPage() {
  const params = useParams<{ seanceId: string }>();
  const router = useRouter();
  const searchParams = useSearchParams();
  const seanceId = String(params?.seanceId ?? "");
  // Étudiant sur lequel la fiche est cadrée (arrivée depuis son détail).
  const focusStudentId = searchParams.get("student_id") ?? "";
  const [search, setSearch] = useState("");
  // Étudiant dont la justification est en cours d'enregistrement.
  const [pendingStudentId, setPendingStudentId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  // Étudiant dont la justification est ouverte dans le modal.
  const [justifyingId, setJustifyingId] = useState<string | null>(null);
  const [motif, setMotif] = useState("");
  const [fichier, setFichier] = useState<File | null>(null);

  const justifyMut = useJustifyAbsence();
  const uploadMut = useUploadJustificatif();
  const deleteJustificatifMut = useDeleteJustificatif();
  const { data, isLoading, isError, error } = useSeanceAttendance(seanceId);
  const seance: any = (data as any)?.seance;
  const items: any[] = (data as any)?.items ?? [];

  // Ligne suivie en direct : le modal reflète les données rechargées.
  const justifying = useMemo(
    () => items.find((it) => it.student_id === justifyingId) ?? null,
    [items, justifyingId]
  );

  // Cadrage sur un étudiant : le reste de la promotion n'a pas à s'afficher.
  const scopedItems = useMemo(
    () => (focusStudentId ? items.filter((it) => it.student_id === focusStudentId) : items),
    [items, focusStudentId]
  );
  const focusItem = focusStudentId ? (scopedItems[0] ?? null) : null;
  // Étudiant demandé mais absent de la séance : à dire, plutôt que de laisser
  // croire que le pointage est vide.
  const focusIntrouvable = Boolean(focusStudentId) && scopedItems.length === 0;

  const q = search.trim().toLowerCase();
  const filteredItems = useMemo(
    () =>
      q
        ? scopedItems.filter((it) =>
            `${it.first_name} ${it.last_name} ${it.matricule ?? ""}`.toLowerCase().includes(q)
          )
        : scopedItems,
    [scopedItems, q]
  );

  // Décomptes : ceux de la séance, recalculés depuis le pointage en secours.
  const counts = useMemo(() => {
    const c: Record<string, number> = { present: 0, absent: 0, retard: 0, excuse: 0, marques: 0 };
    for (const it of items) {
      if (!it.attendance_statut) continue;
      c.marques += 1;
      if (it.attendance_statut in c) c[it.attendance_statut] += 1;
    }
    return c;
  }, [items]);

  const nbMarques = seance?.nb_marques != null ? Number(seance.nb_marques) : counts.marques;
  const nbPresent = seance?.nb_present != null ? Number(seance.nb_present) : counts.present;
  const nbAbsent = seance?.nb_absent != null ? Number(seance.nb_absent) : counts.absent;
  const nbRetard = seance?.nb_retard != null ? Number(seance.nb_retard) : counts.retard;
  const nbExcuse = seance?.nb_excuse != null ? Number(seance.nb_excuse) : counts.excuse;
  const taux = nbMarques > 0 ? Math.round((nbPresent / nbMarques) * 100) : null;

  /**
   * Justifie (`absent` → `excuse`, avec motif) ou retire la justification
   * (`excuse` → `absent`, motif effacé). Le bulletin lit ces mêmes statuts,
   * la modification y est donc reportée sans autre action.
   */
  async function setJustification(studentId: string, justifiee: boolean, motifSaisi?: string) {
    setPendingStudentId(studentId);
    setActionError(null);
    try {
      await justifyMut.mutateAsync({ seanceId, studentId, justifiee, motif: motifSaisi });
      // Le justificatif ne peut être joint qu'une fois l'absence justifiée.
      if (justifiee && fichier) {
        await uploadMut.mutateAsync({ seanceId, studentId, file: fichier });
      }
      fermerModal();
    } catch (e) {
      setActionError((e as Error)?.message ?? "Impossible d'enregistrer la justification.");
    } finally {
      setPendingStudentId(null);
    }
  }

  /** Retire le justificatif sans toucher à la justification elle-même. */
  async function retirerJustificatif(studentId: string) {
    setActionError(null);
    try {
      await deleteJustificatifMut.mutateAsync({ seanceId, studentId });
    } catch (e) {
      setActionError((e as Error)?.message ?? "Impossible de retirer le justificatif.");
    }
  }

  /** Ouvre le PDF dans un nouvel onglet (téléchargement authentifié). */
  async function ouvrirJustificatif(studentId: string) {
    setActionError(null);
    try {
      const url = await fetchJustificatifUrl(seanceId, studentId);
      window.open(url, "_blank", "noopener");
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (e) {
      setActionError((e as Error)?.message ?? "Impossible d'ouvrir le justificatif.");
    }
  }

  function ouvrirModal(item: any) {
    setJustifyingId(item.student_id);
    setMotif(item.justification ?? "");
    setFichier(null);
    setActionError(null);
  }

  function fermerModal() {
    setJustifyingId(null);
    setMotif("");
    setFichier(null);
  }

  return (
    <div className="space-y-6 max-w-[1200px] mx-auto p-6">
      <button
        onClick={() => router.back()}
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" />
        Retour
      </button>

      {isLoading ? (
        <div className="flex justify-center py-16">
          <Loader2 className="h-10 w-10 animate-spin text-indigo-500" />
        </div>
      ) : isError || !seance ? (
        <Card className="border-red-200">
          <CardContent className="flex items-center gap-3 py-8 text-red-700">
            <AlertCircle className="h-6 w-6 shrink-0" />
            <p>{(error as Error)?.message ?? "Séance introuvable."}</p>
          </CardContent>
        </Card>
      ) : (
        <>
          {/* En-tête : la séance */}
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <ClipboardCheck className="h-7 w-7 text-indigo-500" />
              <h1 className="font-bold bg-gradient-to-r from-indigo-600 to-blue-600 bg-clip-text text-transparent whitespace-nowrap text-2xl leading-tight md:text-3xl">
                {seance.seance_libelle || seance.libelle || "Séance"}
              </h1>
              {nbMarques > 0 ? (
                <span className="rounded-full bg-green-100 px-2.5 py-0.5 text-xs font-medium text-green-700">
                  Appel effectué
                </span>
              ) : (
                <span className="rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-medium text-amber-700">
                  Appel à faire
                </span>
              )}
            </div>
            <p className="text-muted-foreground mt-2 capitalize">
              {fmtDateLongueFr(seance.date)}
              <span className="normal-case">
                {" · "}
                {hm(seance.heure_debut)}–{hm(seance.heure_fin)} · {fmtDuree(seance.duree_minutes)}
                {seance.salle ? ` · ${seance.salle}` : ""}
              </span>
            </p>
          </div>

          {/* Identité de la séance */}
          <Card className="shadow-sm">
            <CardContent className="grid grid-cols-1 gap-4 p-5 md:grid-cols-2 xl:grid-cols-3">
              <InfoBlock icon={<BookOpen className="h-4 w-4" />} label="Matière (ECUE)">
                <div className="flex items-center gap-2">
                  {seance.ecue_code && (
                    <span className="rounded bg-indigo-100 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-indigo-700">
                      {seance.ecue_code}
                    </span>
                  )}
                  <span className="font-medium">{seance.ecue_libelle}</span>
                </div>
              </InfoBlock>

              <InfoBlock icon={<Layers className="h-4 w-4" />} label="Unité d'enseignement (UE)">
                <span className="font-medium">{seance.ue_libelle ?? "—"}</span>
                {seance.ue_code && (
                  <div className="font-mono text-xs text-muted-foreground">{seance.ue_code}</div>
                )}
              </InfoBlock>

              <InfoBlock icon={<CalendarRange className="h-4 w-4" />} label="Semestre · Session">
                <span className="font-medium">{seance.semestre_libelle ?? "—"}</span>
                <div className="text-xs text-muted-foreground">
                  {seance.session_libelle ?? "—"}
                  {seance.session_statut ? ` (${seance.session_statut})` : ""}
                </div>
              </InfoBlock>

              <InfoBlock icon={<UserRound className="h-4 w-4" />} label="Enseignant">
                <span className="font-medium">{seance.enseignant_nom ?? "—"}</span>
                {seance.enseignant_source && (
                  <div className="text-xs text-muted-foreground">
                    {ENSEIGNANT_SOURCE_LABEL[seance.enseignant_source] ?? ""}
                  </div>
                )}
                {seance.enseignant_email && (
                  <div className="text-xs text-muted-foreground">{seance.enseignant_email}</div>
                )}
              </InfoBlock>

              <InfoBlock icon={<Clock className="h-4 w-4" />} label="Appel enregistré par">
                <span className="font-medium">{seance.marque_par ?? "—"}</span>
                <div className="text-xs text-muted-foreground">
                  {seance.marque_le ? fmtDateHeureFr(seance.marque_le) : "aucun pointage"}
                </div>
              </InfoBlock>

              <InfoBlock icon={<MapPin className="h-4 w-4" />} label="Salle">
                <span className="font-medium">{seance.salle ?? "—"}</span>
              </InfoBlock>
            </CardContent>
          </Card>

          {/* Décomptes */}
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-6">
            <StatCard
              label="Pointés"
              value={`${nbMarques}/${seance.nb_inscrits ?? items.length}`}
              color="from-indigo-500 to-blue-600"
            />
            <StatCard label="Présents" value={nbPresent} color="from-emerald-500 to-green-600" />
            <StatCard label="Absences non justifiées" value={nbAbsent} color="from-red-500 to-rose-600" />
            <StatCard label="Absences justifiées" value={nbExcuse} color="from-blue-500 to-indigo-600" />
            <StatCard label="Retards" value={nbRetard} color="from-amber-500 to-orange-600" />
            <StatCard
              label="Taux de présence"
              value={taux == null ? "—" : `${taux}%`}
              color="from-sky-500 to-cyan-600"
            />
          </div>

          {/* Recherche — sans objet quand la fiche est cadrée sur un étudiant */}
          {!focusStudentId && (
            <div className="relative max-w-md">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Rechercher un étudiant…"
                className="pl-9"
              />
            </div>
          )}

          {/* Pointage étudiant par étudiant */}
          <Card className="shadow-sm overflow-hidden">
            <div className="flex flex-wrap items-center gap-2 border-b border-border bg-muted/40 px-4 py-3">
              <UserRound className="h-4 w-4 text-indigo-500 shrink-0" />
              {focusStudentId ? (
                <>
                  <span className="font-semibold">
                    Pointage de{" "}
                    {focusItem
                      ? `${focusItem.first_name} ${focusItem.last_name}`
                      : "l'étudiant consulté"}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    · une absence justifiée est comptée comme telle dans le bulletin du semestre
                  </span>
                  <Link
                    href={`/professionnel/admin/presences/${seanceId}`}
                    className="ml-auto shrink-0 rounded-md border border-border px-2.5 py-1 text-xs font-medium hover:bg-muted"
                    title="Afficher le pointage de tous les étudiants de la séance"
                  >
                    Voir toute la séance
                  </Link>
                </>
              ) : (
                <>
                  <span className="font-semibold">Pointage de la séance</span>
                  <span className="text-xs text-muted-foreground">
                    · {filteredItems.length} étudiant{filteredItems.length > 1 ? "s" : ""} inscrit
                    {filteredItems.length > 1 ? "s" : ""} à la session · une absence justifiée est
                    comptée comme telle dans le bulletin du semestre
                  </span>
                </>
              )}
            </div>
            {actionError && (
              <div className="flex items-center gap-2 border-b border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700">
                <AlertCircle className="h-4 w-4 shrink-0" />
                {actionError}
              </div>
            )}
            <CardContent className="p-0 overflow-auto max-h-[65vh]">
              {focusIntrouvable ? (
                <div className="flex flex-col items-center gap-2 py-10 text-center text-sm text-muted-foreground">
                  <p>Cet étudiant n&apos;est pas inscrit au pointage de cette séance.</p>
                  <Link
                    href={`/professionnel/admin/presences/${seanceId}`}
                    className="font-medium text-indigo-600 underline underline-offset-2"
                  >
                    Voir le pointage complet
                  </Link>
                </div>
              ) : filteredItems.length === 0 ? (
                <p className="py-10 text-center text-muted-foreground text-sm">
                  Aucun étudiant pour cette séance.
                </p>
              ) : (
                <table className="min-w-full text-sm border-collapse">
                  <thead>
                    <tr className="bg-muted/50 border-b border-border text-left text-muted-foreground">
                      <th className="sticky top-0 z-10 bg-muted/50 px-4 py-3 font-medium">Étudiant</th>
                      <th className="sticky top-0 z-10 bg-muted/50 px-4 py-3 font-medium">Matricule</th>
                      <th className="sticky top-0 z-10 bg-muted/50 px-4 py-3 font-medium">Statut</th>
                      <th className="sticky top-0 z-10 bg-muted/50 px-4 py-3 font-medium">Pointé le</th>
                      <th className="sticky top-0 z-10 bg-muted/50 px-4 py-3 font-medium">Pointé par</th>
                      <th className="sticky top-0 z-10 bg-muted/50 px-4 py-3 font-medium text-right">
                        Justification
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredItems.map((it) => {
                      const st = it.attendance_statut
                        ? STATUT_PRESENCE[it.attendance_statut]
                        : undefined;
                      return (
                        <tr
                          key={it.student_id}
                          className="border-b border-border/60 last:border-0 hover:bg-muted/20"
                        >
                          <td className="px-4 py-2.5 font-medium whitespace-nowrap">
                            {it.first_name} {it.last_name}
                          </td>
                          <td className="px-4 py-2.5 font-mono text-xs text-muted-foreground">
                            {it.matricule ?? "—"}
                          </td>
                          <td className="px-4 py-2.5">
                            <span
                              className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${
                                st?.className ?? "bg-gray-100 text-gray-600"
                              }`}
                            >
                              {st?.label ?? "Non pointé"}
                            </span>
                            {it.justificatif && (
                              <span
                                className="ml-1.5 inline-flex items-center text-blue-600"
                                title="Justificatif PDF joint"
                              >
                                <Paperclip className="h-3.5 w-3.5" />
                              </span>
                            )}
                          </td>
                          <td className="px-4 py-2.5 text-xs text-muted-foreground whitespace-nowrap">
                            {it.marked_at ? fmtDateHeureFr(it.marked_at) : "—"}
                          </td>
                          <td className="px-4 py-2.5 text-xs text-muted-foreground whitespace-nowrap">
                            {it.marque_par ?? "—"}
                          </td>
                          <td className="px-4 py-2.5 text-right whitespace-nowrap">
                            {pendingStudentId === it.student_id ? (
                              <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
                                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                Enregistrement…
                              </span>
                            ) : it.attendance_statut === "absent" ? (
                              <button
                                onClick={() => ouvrirModal(it)}
                                disabled={justifyMut.isPending}
                                className="inline-flex items-center gap-1.5 rounded-md border border-blue-200 bg-blue-50 px-2.5 py-1 text-xs font-medium text-blue-700 hover:bg-blue-100 disabled:opacity-50"
                                title="Compter cette absence comme justifiée dans le bulletin"
                              >
                                <ShieldCheck className="h-3.5 w-3.5" />
                                Justifier
                              </button>
                            ) : it.attendance_statut === "excuse" ? (
                              <button
                                onClick={() => ouvrirModal(it)}
                                disabled={justifyMut.isPending}
                                className="inline-flex items-center gap-1.5 rounded-md border border-blue-200 bg-blue-50 px-2.5 py-1 text-xs font-medium text-blue-700 hover:bg-blue-100 disabled:opacity-50"
                                title="Voir le motif, le justificatif et l'auteur de la justification"
                              >
                                <FileText className="h-3.5 w-3.5" />
                                Motif
                              </button>
                            ) : (
                              <span className="text-muted-foreground">—</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </CardContent>
          </Card>

          <Link
            href="/professionnel/admin/presences"
            className="inline-flex items-center gap-1.5 text-sm text-indigo-600 hover:underline"
          >
            <ArrowLeft className="h-4 w-4" />
            Revenir aux présences
          </Link>

          {/* Justification : consultation du motif, du justificatif et de l'auteur */}
          {justifying && (
            <div
              className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
              onClick={fermerModal}
            >
              <div
                className="w-full max-w-xl rounded-xl border border-border bg-background p-5 shadow-xl"
                onClick={(e) => e.stopPropagation()}
              >
                <h2 className="flex items-center gap-2 text-lg font-semibold">
                  <ShieldCheck className="h-5 w-5 text-blue-500" />
                  {justifying.attendance_statut === "excuse"
                    ? "Justification de l'absence"
                    : "Justifier l'absence"}
                </h2>
                <p className="text-muted-foreground whitespace-nowrap text-sm md:text-base">
                  {justifying.first_name} {justifying.last_name}
                  {justifying.matricule ? ` · ${justifying.matricule}` : ""} — séance du{" "}
                  {fmtDateLongueFr(seance?.date)}
                </p>

                {/* Ce qui est déjà enregistré */}
                {justifying.attendance_statut === "excuse" && (
                  <div className="mt-4 rounded-lg border border-border/60 bg-muted/20 p-3 text-sm">
                    <p>
                      <span className="font-medium">Motif enregistré : </span>
                      {justifying.justification || (
                        <span className="text-muted-foreground">non renseigné</span>
                      )}
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      Justifiée par {justifying.justifie_par ?? "—"}
                      {justifying.justifie_le ? ` — ${fmtDateHeureFr(justifying.justifie_le)}` : ""}
                    </p>
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      {justifying.justificatif ? (
                        <>
                          <button
                            onClick={() => ouvrirJustificatif(justifying.student_id)}
                            className="inline-flex items-center gap-1.5 rounded-md border border-blue-200 bg-blue-50 px-2.5 py-1 text-xs font-medium text-blue-700 hover:bg-blue-100"
                          >
                            <FileText className="h-3.5 w-3.5" />
                            Ouvrir le justificatif
                          </button>
                          <span className="text-xs text-muted-foreground">
                            {justifying.justificatif_nom}
                            {justifying.justificatif_taille
                              ? ` · ${fmtTaille(justifying.justificatif_taille)}`
                              : ""}
                          </span>
                          <button
                            onClick={() => retirerJustificatif(justifying.student_id)}
                            disabled={deleteJustificatifMut.isPending}
                            className="inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1 text-xs font-medium text-muted-foreground hover:bg-muted disabled:opacity-50"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                            Retirer le PDF
                          </button>
                        </>
                      ) : (
                        <span className="text-xs text-muted-foreground">
                          Aucun justificatif joint.
                        </span>
                      )}
                    </div>
                  </div>
                )}

                <label className="mt-4 block text-sm font-medium" htmlFor="motif-justification">
                  Motif
                </label>
                <textarea
                  id="motif-justification"
                  value={motif}
                  onChange={(e) => setMotif(e.target.value)}
                  maxLength={500}
                  rows={3}
                  autoFocus
                  placeholder="Certificat médical, convocation officielle, décès dans la famille…"
                  className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:border-indigo-400"
                />
                <p className="mt-1 text-xs text-muted-foreground">{motif.length}/500</p>

                <label className="mt-4 block text-sm font-medium" htmlFor="justificatif-pdf">
                  Justificatif (PDF)
                  {justifying.justificatif && (
                    <span className="ml-1 font-normal text-muted-foreground">
                      — en déposer un nouveau remplacera celui déjà joint
                    </span>
                  )}
                </label>
                <input
                  id="justificatif-pdf"
                  type="file"
                  accept="application/pdf,.pdf"
                  onChange={(e) => setFichier(e.target.files?.[0] ?? null)}
                  className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm file:mr-3 file:rounded file:border-0 file:bg-muted file:px-2 file:py-1 file:text-xs file:font-medium"
                />
                <p className="mt-1 text-xs text-muted-foreground">
                  {fichier
                    ? `${fichier.name} · ${fmtTaille(fichier.size)}`
                    : "Facultatif · PDF uniquement"}
                  {" · "}le motif est enregistré avec votre nom et la date. L'absence est comptée
                  comme justifiée dans le bulletin du semestre.
                </p>

                {actionError && (
                  <p className="mt-3 flex items-center gap-2 text-sm text-red-700">
                    <AlertCircle className="h-4 w-4 shrink-0" />
                    {actionError}
                  </p>
                )}

                <div className="mt-5 flex flex-wrap items-center justify-end gap-2">
                  {justifying.attendance_statut === "excuse" && (
                    <button
                      onClick={() => setJustification(justifying.student_id, false)}
                      disabled={justifyMut.isPending}
                      className="mr-auto inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-sm font-medium text-muted-foreground hover:bg-muted disabled:opacity-50"
                      title="Repasser cette absence en non justifiée (le justificatif est supprimé)"
                    >
                      <Undo2 className="h-4 w-4" />
                      Retirer la justification
                    </button>
                  )}
                  <button
                    onClick={fermerModal}
                    className="rounded-md border border-border px-3 py-1.5 text-sm font-medium hover:bg-muted"
                  >
                    Fermer
                  </button>
                  <button
                    onClick={() => setJustification(justifying.student_id, true, motif)}
                    disabled={justifyMut.isPending || uploadMut.isPending}
                    className="inline-flex items-center gap-1.5 rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
                  >
                    {justifyMut.isPending || uploadMut.isPending ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <ShieldCheck className="h-4 w-4" />
                    )}
                    Enregistrer
                  </button>
                </div>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function InfoBlock({
  icon,
  label,
  children,
}: {
  icon: React.ReactNode;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-lg border border-border/60 bg-muted/20 p-3">
      <p className="mb-1 flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
        <span className="text-indigo-500">{icon}</span>
        {label}
      </p>
      <div className="text-sm">{children}</div>
    </div>
  );
}

function StatCard({
  label,
  value,
  color,
}: {
  label: string;
  value: string | number;
  color: string;
}) {
  return (
    <div className={`rounded-xl p-4 text-white bg-gradient-to-br ${color} shadow`}>
      <p className="text-white/80 text-sm font-medium">{label}</p>
      <p className="text-3xl font-bold mt-1">{value}</p>
    </div>
  );
}
