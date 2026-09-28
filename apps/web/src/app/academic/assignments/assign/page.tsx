"use client";

import React, { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import {
  Card,
  CardContent,
  Button,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Alert,
  AlertDescription,
} from "@ecoledigitale/ui";
import {
  ArrowLeft,
  ArrowRight,
  BookOpen,
  Brain,
  CheckCircle2,
  ClipboardList,
  FileText,
  Layers,
  Loader2,
  Save,
  Search,
  Send,
  Users,
  AlertCircle,
  RotateCcw,
} from "lucide-react";
import { useTeacherAssignments } from "@/lib/hooks/use-professional-teacher";
import { useTeacherEcue, type TeacherEcue } from "@/lib/hooks/use-teacher-professional";
import {
  useDuplicateAssignment,
  type DuplicateAssignmentResult,
} from "@/lib/hooks/use-professional-assignments";
import { EVALUATION_TYPE_LABEL } from "@/components/professional/ProfessionalAssignmentsPanel";

/**
 * Assigner un devoir à d'autres filières — Module Professionnel (feature 030).
 *
 * L'enseignant sélectionne l'une de ses évaluations existantes (ancienne ou
 * récente) puis la duplique vers d'autres cibles ECUE × cohorte qui lui sont
 * affectées (autres filières). La configuration complète, les questions et le
 * sujet PDF éventuel sont recopiés.
 */

type Step = "source" | "targets" | "confirm" | "done";

const STEPS: Array<{ id: Step; title: string; icon: React.ElementType }> = [
  { id: "source", title: "Devoir à assigner", icon: FileText },
  { id: "targets", title: "Filières cibles", icon: Layers },
  { id: "confirm", title: "Validation", icon: CheckCircle2 },
];

const SKIP_LABELS: Record<string, string> = {
  SAME_AS_SOURCE: "Cible identique à la source",
  ECUE_NOT_FOUND: "ECUE introuvable",
  FORBIDDEN: "ECUE non enseignée",
  ECUE_NOT_IN_COHORT: "ECUE absente de la cohorte",
  EXAMEN_EXISTS: "Examen déjà présent",
  INVALID: "Cible invalide",
};

function targetKey(e: { ue_session_id: string; ecue_id: string }) {
  return `${e.ue_session_id}::${e.ecue_id}`;
}

function TypeBadge({ type }: { type: string }) {
  const Icon = type === "online" ? BookOpen : type === "ai_generated" ? Brain : FileText;
  return (
    <span
      className={`inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full whitespace-nowrap border ${
        type === "online"
          ? "bg-green-500/15 text-green-600 border-green-500/40"
          : type === "ai_generated"
            ? "bg-purple-500/15 text-purple-600 border-purple-500/40"
            : "bg-blue-500/15 text-blue-600 border-blue-500/40"
      }`}
    >
      <Icon className="h-3 w-3" />
      {EVALUATION_TYPE_LABEL[type] ?? "—"}
    </span>
  );
}

export default function AssignAssignmentPage() {
  const router = useRouter();
  const { data: session, status } = useSession();

  // Hooks (toujours appelés, avant tout retour anticipé).
  const assignmentsQuery = useTeacherAssignments();
  const ecueQuery = useTeacherEcue();
  const duplicateMut = useDuplicateAssignment();

  const [step, setStep] = useState<Step>("source");
  const [sourceId, setSourceId] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [dueAt, setDueAt] = useState("");
  const [statutMode, setStatutMode] = useState<"source" | "brouillon" | "publie" | "cloture">(
    "source"
  );
  const [sourceSearch, setSourceSearch] = useState("");
  const [targetSearch, setTargetSearch] = useState("");
  const [result, setResult] = useState<DuplicateAssignmentResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [preselectDone, setPreselectDone] = useState(false);

  useEffect(() => {
    if (status === "loading") return;
    if (!session) {
      router.push("/login");
      return;
    }
    const roles = (session as any)?.roles ?? [];
    const allowed =
      Array.isArray(roles) &&
      roles.some((r: string) =>
        ["teacher", "Enseignant", "admin", "Administrateur"].includes(r)
      );
    if (!allowed) router.push("/");
  }, [session, status, router]);

  const items: any[] = (assignmentsQuery.data as any[]) ?? [];
  const ecues: TeacherEcue[] = ecueQuery.data ?? [];
  const source = useMemo(() => items.find((a) => a.id === sourceId) ?? null, [items, sourceId]);

  // Pré-sélection du devoir source via ?source=<id> (depuis « Mes évaluations »).
  useEffect(() => {
    if (preselectDone) return;
    const sp =
      typeof window !== "undefined"
        ? new URLSearchParams(window.location.search).get("source")
        : null;
    if (!sp) {
      setPreselectDone(true);
      return;
    }
    if (items.length === 0) return; // attend le chargement de la liste
    if (items.some((a) => a.id === sp)) {
      setSourceId(sp);
      setStep("targets");
    }
    setPreselectDone(true);
  }, [items, preselectDone]);

  // Cibles possibles : affectations ECUE de l'enseignant, sauf le couple source.
  const targetEcues = useMemo(() => {
    return ecues.filter(
      (e) =>
        !(
          source &&
          e.ecue_id === source.ecue_id &&
          e.ue_session_id === (source.ue_session_id ?? null)
        )
    );
  }, [ecues, source]);

  const filteredSources = useMemo(() => {
    const q = sourceSearch.trim().toLowerCase();
    if (!q) return items;
    return items.filter((a) =>
      `${a.titre ?? ""} ${a.ecue_code ?? ""} ${a.ecue_libelle ?? ""} ${a.session_libelle ?? ""} ${
        a.filiere_nom ?? ""
      }`
        .toLowerCase()
        .includes(q)
    );
  }, [items, sourceSearch]);

  const filteredTargets = useMemo(() => {
    const q = targetSearch.trim().toLowerCase();
    if (!q) return targetEcues;
    return targetEcues.filter((e) =>
      `${e.ecue_code} ${e.ecue_libelle} ${e.ue_code} ${e.ue_libelle} ${e.session_libelle ?? ""} ${
        e.filiere_nom ?? ""
      }`
        .toLowerCase()
        .includes(q)
    );
  }, [targetEcues, targetSearch]);

  // Regroupe les cibles par filière pour un affichage clair.
  const targetsByFiliere = useMemo(() => {
    const groups = new Map<string, TeacherEcue[]>();
    for (const e of filteredTargets) {
      const key = e.filiere_nom || e.filiere_code || "Autre filière";
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(e);
    }
    return Array.from(groups, ([filiere, list]) => ({ filiere, list }));
  }, [filteredTargets]);

  if (status === "loading") {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="h-10 w-10 animate-spin text-indigo-500" />
      </div>
    );
  }
  if (!session) return null;

  const stepIndex = STEPS.findIndex((s) => s.id === step);
  const canNext =
    step === "source" ? !!sourceId : step === "targets" ? selected.size > 0 : true;

  function toggleTarget(key: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
  }

  function toggleFiliere(list: TeacherEcue[]) {
    const keys = list.map(targetKey);
    const allSelected = keys.every((k) => selected.has(k));
    setSelected((prev) => {
      const next = new Set(prev);
      keys.forEach((k) => (allSelected ? next.delete(k) : next.add(k)));
      return next;
    });
  }

  function goNext() {
    if (!canNext) return;
    if (step === "confirm") return void handleConfirm();
    setStep(STEPS[Math.min(stepIndex + 1, STEPS.length - 1)].id);
  }

  function goPrev() {
    if (stepIndex > 0) setStep(STEPS[stepIndex - 1].id);
  }

  async function handleConfirm() {
    setError(null);
    const targets = Array.from(selected).map((k) => {
      const [ue_session_id, ecue_id] = k.split("::");
      return { ecue_id, ue_session_id };
    });
    try {
      const res = await duplicateMut.mutateAsync({
        sourceId,
        targets,
        due_at: dueAt ? new Date(dueAt).toISOString() : null,
        statut: statutMode === "source" ? null : statutMode,
      });
      setResult(res);
      setStep("done");
    } catch (e: any) {
      setError(e?.message ?? "Erreur lors de l'assignation.");
    }
  }

  function reset() {
    setStep("source");
    setSourceId("");
    setSelected(new Set());
    setDueAt("");
    setStatutMode("source");
    setResult(null);
    setError(null);
    setSourceSearch("");
    setTargetSearch("");
  }

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-8">
      {/* Header */}
      <div className="mb-6 flex max-w-full flex-col items-start gap-2 overflow-x-auto md:mb-8 md:gap-3">
        <Button variant="outline" size="sm" onClick={() => router.back()}>
          <ArrowLeft className="h-4 w-4 mr-2" />
          Retour
        </Button>
        <div>
          <h1 className="whitespace-nowrap font-bold bg-gradient-to-r from-indigo-600 to-purple-600 bg-clip-text text-transparent flex items-center gap-2 text-2xl leading-tight md:text-3xl">
            <Send className="w-7 h-7 text-indigo-600" />
            Assigner un devoir à d'autres filières
          </h1>
          <p className="whitespace-nowrap text-muted-foreground text-sm md:text-base">
            Dupliquez une de vos évaluations vers d'autres cohortes selon les ECUE qui vous sont
            affectés.
          </p>
        </div>
      </div>

      {/* Stepper (masqué sur l'écran de résultat) */}
      {step !== "done" && (
        <div className="relative">
          <div className="absolute top-6 left-0 right-0 h-0.5 bg-border hidden sm:block" />
          <div
            className="absolute top-6 left-0 h-0.5 bg-indigo-600 transition-all duration-500 hidden sm:block"
            style={{ width: `${(stepIndex / (STEPS.length - 1)) * 100}%` }}
          />
          <div className="relative flex items-start justify-between">
            {STEPS.map((s, index) => {
              const Icon = s.icon;
              const isActive = s.id === step;
              const isDone = index < stepIndex;
              return (
                <div key={s.id} className="flex flex-col items-center flex-1 relative z-10">
                  <div
                    className={`flex items-center justify-center w-12 h-12 rounded-full border-2 transition-all duration-300 ${
                      isActive
                        ? "border-indigo-600 bg-indigo-600 text-white shadow-lg shadow-indigo-500/40 scale-110"
                        : isDone
                          ? "border-green-600 bg-green-600 text-white"
                          : "border-border bg-card text-muted-foreground"
                    }`}
                  >
                    <Icon className="h-6 w-6" />
                  </div>
                  <p
                    className={`mt-3 text-xs sm:text-sm font-medium text-center ${
                      isActive
                        ? "text-indigo-600"
                        : isDone
                          ? "text-green-600"
                          : "text-muted-foreground"
                    }`}
                  >
                    {s.title}
                  </p>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {error && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <Card>
        <CardContent className="p-6">
          {/* ------------------------------ Étape 1 ------------------------------ */}
          {step === "source" && (
            <div className="space-y-4">
              <div>
                <h2 className="text-xl font-semibold">Choisir le devoir à assigner</h2>
                <p className="text-muted-foreground whitespace-nowrap text-sm md:text-base">
                  Sélectionnez l'une de vos évaluations existantes à dupliquer.
                </p>
              </div>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                <Input
                  value={sourceSearch}
                  onChange={(e) => setSourceSearch(e.target.value)}
                  placeholder="Rechercher un devoir, une matière…"
                  className="pl-9"
                />
              </div>

              {assignmentsQuery.isLoading ? (
                <div className="flex justify-center py-10">
                  <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                </div>
              ) : filteredSources.length === 0 ? (
                <Alert>
                  <AlertCircle className="h-4 w-4" />
                  <AlertDescription>
                    {items.length === 0
                      ? "Vous n'avez encore aucune évaluation. Créez-en une depuis « Mes évaluations »."
                      : "Aucune évaluation ne correspond à votre recherche."}
                  </AlertDescription>
                </Alert>
              ) : (
                <div className="space-y-2 max-h-[52vh] overflow-auto pr-1">
                  {filteredSources.map((a) => {
                    const isSel = sourceId === a.id;
                    return (
                      <button
                        key={a.id}
                        type="button"
                        onClick={() => {
                          setSourceId(a.id);
                          setSelected(new Set());
                        }}
                        className={`w-full text-left p-4 border-2 rounded-lg transition-all hover:shadow-sm ${
                          isSel
                            ? "border-indigo-500 bg-indigo-50/60 dark:bg-indigo-950/20 ring-2 ring-indigo-200 dark:ring-indigo-800"
                            : "border-border hover:border-indigo-300"
                        }`}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="font-medium truncate">{a.titre}</span>
                              <TypeBadge type={a.evaluation_type} />
                              {a.type === "examen" && (
                                <span className="text-[10px] uppercase tracking-wide text-amber-600 font-semibold">
                                  Examen
                                </span>
                              )}
                            </div>
                            <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
                              <span className="inline-flex items-center gap-1">
                                <BookOpen className="h-3 w-3" />
                                <span className="font-mono">{a.ecue_code}</span> — {a.ecue_libelle}
                              </span>
                              <span className="inline-flex items-center gap-1">
                                <Layers className="h-3 w-3" />
                                {a.session_libelle ?? a.filiere_nom ?? "—"}
                              </span>
                              <span>/ {a.note_max} · coef {a.coefficient}</span>
                            </div>
                          </div>
                          {isSel && (
                            <CheckCircle2 className="h-5 w-5 text-indigo-600 shrink-0" />
                          )}
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* ------------------------------ Étape 2 ------------------------------ */}
          {step === "targets" && (
            <div className="space-y-4">
              <div>
                <h2 className="text-xl font-semibold">Filières / cohortes cibles</h2>
                <p className="text-muted-foreground whitespace-nowrap text-sm md:text-base">
                  Cochez les ECUE (dans d'autres filières) qui recevront une copie de ce devoir.
                </p>
              </div>

              {source && (
                <div className="rounded-md border border-indigo-200 bg-indigo-50/60 dark:bg-indigo-950/20 px-3 py-2 text-sm flex items-center gap-2">
                  <FileText className="h-4 w-4 text-indigo-600 shrink-0" />
                  <span className="font-medium truncate">{source.titre}</span>
                  <TypeBadge type={source.evaluation_type} />
                </div>
              )}

              <div className="flex items-center gap-3">
                <div className="relative flex-1">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                  <Input
                    value={targetSearch}
                    onChange={(e) => setTargetSearch(e.target.value)}
                    placeholder="Rechercher une filière, une ECUE, une cohorte…"
                    className="pl-9"
                  />
                </div>
                <span className="text-sm text-muted-foreground whitespace-nowrap">
                  <span className="font-semibold text-foreground">{selected.size}</span>{" "}
                  sélectionnée{selected.size > 1 ? "s" : ""}
                </span>
              </div>

              {ecueQuery.isLoading ? (
                <div className="flex justify-center py-10">
                  <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                </div>
              ) : targetsByFiliere.length === 0 ? (
                <Alert>
                  <AlertCircle className="h-4 w-4" />
                  <AlertDescription>
                    {targetEcues.length === 0
                      ? "Aucune autre ECUE ne vous est affectée pour recevoir ce devoir."
                      : "Aucune cible ne correspond à votre recherche."}
                  </AlertDescription>
                </Alert>
              ) : (
                <div className="space-y-4 max-h-[48vh] overflow-auto pr-1">
                  {targetsByFiliere.map(({ filiere, list }) => {
                    const keys = list.map(targetKey);
                    const allSel = keys.every((k) => selected.has(k));
                    return (
                      <div key={filiere} className="border border-border rounded-lg overflow-hidden">
                        <div className="flex items-center justify-between bg-muted/40 px-3 py-2">
                          <span className="text-sm font-semibold flex items-center gap-2">
                            <Layers className="h-4 w-4 text-indigo-500" />
                            {filiere}
                          </span>
                          <button
                            type="button"
                            onClick={() => toggleFiliere(list)}
                            className="text-xs text-indigo-600 hover:underline"
                          >
                            {allSel ? "Tout décocher" : "Tout cocher"}
                          </button>
                        </div>
                        <div className="divide-y divide-border">
                          {list.map((e) => {
                            const key = targetKey(e);
                            const isSel = selected.has(key);
                            return (
                              <label
                                key={key}
                                className={`flex items-start gap-3 px-3 py-2.5 cursor-pointer transition-colors ${
                                  isSel ? "bg-indigo-50/60 dark:bg-indigo-950/20" : "hover:bg-muted/30"
                                }`}
                              >
                                <input
                                  type="checkbox"
                                  checked={isSel}
                                  onChange={() => toggleTarget(key)}
                                  className="mt-1"
                                />
                                <div className="min-w-0">
                                  <div className="flex items-center gap-2">
                                    <span className="font-mono text-[11px] text-indigo-600 bg-indigo-50 rounded px-1.5 py-0.5">
                                      {e.ecue_code}
                                    </span>
                                    <span className="font-medium truncate">{e.ecue_libelle}</span>
                                  </div>
                                  <div className="mt-0.5 flex flex-wrap items-center gap-x-3 text-xs text-muted-foreground">
                                    <span className="inline-flex items-center gap-1">
                                      <BookOpen className="h-3 w-3" />
                                      {e.ue_code} — {e.ue_libelle}
                                    </span>
                                    <span className="inline-flex items-center gap-1">
                                      <Users className="h-3 w-3" />
                                      {e.session_libelle ?? "—"} · {e.nb_inscrits} étud.
                                    </span>
                                  </div>
                                </div>
                              </label>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* ------------------------------ Étape 3 ------------------------------ */}
          {step === "confirm" && source && (
            <div className="space-y-5">
              <div>
                <h2 className="text-xl font-semibold">Valider l'assignation</h2>
                <p className="text-muted-foreground whitespace-nowrap text-sm md:text-base">
                  Vérifiez le devoir, les cibles et les options avant de confirmer.
                </p>
              </div>

              <div className="rounded-lg border border-border p-4 space-y-3">
                <div className="flex items-center gap-2">
                  <FileText className="h-4 w-4 text-indigo-600" />
                  <span className="font-medium">{source.titre}</span>
                  <TypeBadge type={source.evaluation_type} />
                </div>
                <div className="text-sm text-muted-foreground">
                  Source :{" "}
                  <span className="font-mono">{source.ecue_code}</span> — {source.ecue_libelle}
                  {source.session_libelle ? ` · ${source.session_libelle}` : ""}
                </div>
                <div className="text-sm flex items-center gap-2">
                  <Layers className="h-4 w-4 text-indigo-500" />
                  <span className="font-semibold">{selected.size}</span> cible
                  {selected.size > 1 ? "s" : ""} sélectionnée{selected.size > 1 ? "s" : ""}
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="due_at">Nouvelle échéance (optionnelle)</Label>
                  <Input
                    id="due_at"
                    type="datetime-local"
                    value={dueAt}
                    onChange={(e) => setDueAt(e.target.value)}
                  />
                  <p className="text-xs text-muted-foreground">
                    Laissez vide pour conserver l'échéance du devoir source.
                  </p>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="statut">Statut des copies</Label>
                  <Select value={statutMode} onValueChange={(v) => setStatutMode(v as any)}>
                    <SelectTrigger id="statut">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="source">Identique au devoir source</SelectItem>
                      <SelectItem value="brouillon">Brouillon</SelectItem>
                      <SelectItem value="publie">Publié</SelectItem>
                      <SelectItem value="cloture">Clôturé</SelectItem>
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">
                    « Brouillon » pour préparer avant publication dans chaque filière.
                  </p>
                </div>
              </div>

              <Alert>
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>
                  La configuration, les questions et le sujet PDF éventuel sont recopiés. Les
                  soumissions et notes ne le sont pas. Une cible où un « examen » existe déjà sera
                  ignorée.
                </AlertDescription>
              </Alert>
            </div>
          )}

          {/* ------------------------------ Résultat ------------------------------ */}
          {step === "done" && result && (
            <div className="space-y-5">
              <div className="flex flex-col items-center text-center gap-2 py-2">
                <div className="rounded-full bg-green-100 p-3">
                  <CheckCircle2 className="h-8 w-8 text-green-600" />
                </div>
                <h2 className="text-xl font-semibold">
                  {result.created.length > 0
                    ? `Devoir assigné à ${result.created.length} cible${
                        result.created.length > 1 ? "s" : ""
                      }`
                    : "Aucune copie créée"}
                </h2>
                {result.skipped.length > 0 && (
                  <p className="text-muted-foreground whitespace-nowrap text-sm md:text-base">
                    {result.skipped.length} cible{result.skipped.length > 1 ? "s" : ""} ignorée
                    {result.skipped.length > 1 ? "s" : ""}.
                  </p>
                )}
              </div>

              {result.created.length > 0 && (
                <div className="rounded-lg border border-green-200 bg-green-50/50 dark:bg-green-950/10 p-3 space-y-1.5">
                  {result.created.map((c: any) => (
                    <div key={c.id} className="text-sm flex items-center gap-2">
                      <CheckCircle2 className="h-3.5 w-3.5 text-green-600 shrink-0" />
                      <span className="font-mono text-xs">{c.ecue_code ?? c.ecue_id?.slice(0, 8)}</span>
                      <span className="truncate">{c.titre}</span>
                    </div>
                  ))}
                </div>
              )}

              {result.skipped.length > 0 && (
                <div className="rounded-lg border border-amber-200 bg-amber-50/50 dark:bg-amber-950/10 p-3 space-y-1.5">
                  {result.skipped.map((s, i) => (
                    <div key={i} className="text-sm flex items-center gap-2 text-amber-700">
                      <AlertCircle className="h-3.5 w-3.5 shrink-0" />
                      <span>{SKIP_LABELS[s.reason] ?? s.reason}</span>
                      <span className="text-xs text-muted-foreground truncate">— {s.message}</span>
                    </div>
                  ))}
                </div>
              )}

              <div className="flex flex-wrap justify-center gap-3 pt-2">
                <Button
                  variant="outline"
                  onClick={reset}
                >
                  <RotateCcw className="h-4 w-4 mr-2" />
                  Assigner un autre devoir
                </Button>
                <Button
                  className="bg-gradient-to-r from-indigo-500 to-purple-600 hover:from-indigo-600 hover:to-purple-700 text-white"
                  onClick={() => router.push("/teacher/assignments/create")}
                >
                  <ClipboardList className="h-4 w-4 mr-2" />
                  Voir mes évaluations
                </Button>
              </div>
            </div>
          )}

          {/* ------------------------------ Navigation ------------------------------ */}
          {step !== "done" && (
            <div className="flex justify-between pt-6 mt-6 border-t">
              <Button variant="outline" onClick={goPrev} disabled={stepIndex === 0}>
                <ArrowLeft className="h-4 w-4 mr-2" />
                Précédent
              </Button>
              <Button
                onClick={goNext}
                disabled={!canNext || duplicateMut.isPending}
                className="bg-gradient-to-r from-indigo-500 to-purple-600 hover:from-indigo-600 hover:to-purple-700 text-white"
              >
                {step === "confirm" ? (
                  duplicateMut.isPending ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      Assignation…
                    </>
                  ) : (
                    <>
                      <Save className="h-4 w-4 mr-2" />
                      Confirmer l'assignation
                    </>
                  )
                ) : (
                  <>
                    Suivant
                    <ArrowRight className="h-4 w-4 ml-2" />
                  </>
                )}
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
