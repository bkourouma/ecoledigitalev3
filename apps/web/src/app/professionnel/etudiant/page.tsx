"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent, Button } from "@ecoledigitale/ui";
import { SearchableSelect } from "@/components/SearchableSelect";
import {
  GraduationCap,
  BookOpen,
  Lock,
  Plus,
  Loader2,
  AlertCircle,
  CheckCircle2,
  Info,
  CalendarRange,
  Layers,
} from "lucide-react";
import {
  useProfessionalProgrammes,
  useProfessionalCatalog,
  useStudentSelfEnroll,
} from "@/lib/hooks/use-professional-student";

/**
 * Espace étudiant — Module Professionnel.
 * Auto-inscription DIRECTE aux sessions (sans panier), regroupées par lot
 * (comme l'admin). Chaque inscription part en « en attente de paiement » et est
 * validée par l'administration après règlement (hors système).
 */

function fmtDate(value?: string | null): string {
  if (!value) return "—";
  const d = new Date(value);
  return isNaN(d.getTime()) ? String(value) : d.toLocaleDateString("fr-FR");
}
function fmtFCFA(value?: number | null): string {
  const n = Number(value ?? 0);
  return `${n.toLocaleString("fr-FR")} FCFA`;
}

export default function ProfessionalStudentPage() {
  const router = useRouter();
  const [programmeId, setProgrammeId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [enrolling, setEnrolling] = useState<string | null>(null);
  const [bulkEnrolling, setBulkEnrolling] = useState<string | null>(null);

  const programmesQuery = useProfessionalProgrammes();
  const catalogQuery = useProfessionalCatalog(programmeId || null);
  const enrollMut = useStudentSelfEnroll();

  const programmes: any[] = (programmesQuery.data as any[]) ?? [];
  const catalog: any[] = (catalogQuery.data as any[]) ?? [];

  // Regroupe les sessions OUVERTES par lot (titre + période), UE à l'intérieur.
  // Les UE sans session ouverte n'apparaissent pas.
  const groups = useMemo(() => {
    const map = new Map<string, any>();
    for (const item of catalog) {
      for (const s of item.sessions ?? []) {
        if (s.statut !== "ouvert") continue;
        const suffix = item.ue?.code ? ` — ${item.ue.code}` : "";
        const prefix =
          suffix && s.libelle?.endsWith(suffix) ? s.libelle.slice(0, -suffix.length) : s.libelle;
        const key = `${prefix}|${s.date_debut}|${s.date_fin}`;
        let g = map.get(key);
        if (!g) {
          g = { key, title: prefix, date_debut: s.date_debut, date_fin: s.date_fin, items: [] };
          map.set(key, g);
        }
        g.items.push({
          session: s,
          ue: item.ue,
          ecue: item.ecue,
          verrouille: item.verrouille,
        });
      }
    }
    return Array.from(map.values()).sort((a, b) =>
      String(a.title).localeCompare(String(b.title))
    );
  }, [catalog]);

  async function handleEnroll(session: any) {
    setError(null);
    setSuccess(null);
    setEnrolling(session.id);
    try {
      await enrollMut.mutateAsync(session.id);
      setSuccess(
        `Inscription à « ${session.libelle} » enregistrée. Elle sera validée par l'administration après règlement.`
      );
    } catch (e: any) {
      setError(e?.message ?? "Inscription refusée.");
    } finally {
      setEnrolling(null);
    }
  }

  async function handleEnrollAll(g: any) {
    setError(null);
    setSuccess(null);
    setBulkEnrolling(g.key);
    const targets = g.items.filter(
      (it: any) => !it.session.deja_inscrit && !it.verrouille
    );
    let done = 0;
    const errs: string[] = [];
    for (const it of targets) {
      try {
        await enrollMut.mutateAsync(it.session.id);
        done += 1;
      } catch (e: any) {
        errs.push(`${it.ue.code} : ${e?.message ?? "refusé"}`);
      }
    }
    setBulkEnrolling(null);
    if (done > 0)
      setSuccess(
        `${done} inscription(s) enregistrée(s) pour « ${g.title} ». Elles seront validées après règlement.`
      );
    if (errs.length) setError(errs.slice(0, 3).join(" · "));
  }

  return (
    <div className="space-y-8 max-w-5xl mx-auto p-6">
      {/* Header */}
      <div className="mb-6 flex max-w-full flex-col items-start gap-2 overflow-x-auto md:gap-3">
        <div>
          <h1 className="font-bold bg-gradient-to-r from-green-500 to-blue-500 bg-clip-text text-transparent whitespace-nowrap text-2xl leading-tight md:text-3xl">
            Inscription aux sessions
          </h1>
          <p className="text-muted-foreground whitespace-nowrap text-sm md:text-base">
            Choisissez une filière et inscrivez-vous directement aux sessions souhaitées.
          </p>
        </div>
        <Button variant="outline" onClick={() => router.push("/student/courses")}>
          <GraduationCap className="h-4 w-4 mr-2" />
          Mes cours
        </Button>
      </div>

      {/* Bandeau info règlement */}
      <div className="flex items-start gap-2 rounded-lg border border-blue-500/40 bg-blue-500/10 px-4 py-3 text-sm text-blue-300">
        <Info className="h-4 w-4 shrink-0 mt-0.5" />
        <p>
          Le paiement se fait <strong>hors système</strong> : après votre inscription, l'administration
          la <strong>valide une fois le règlement effectué</strong>. Suivez l'état de vos inscriptions
          dans « Mes inscriptions ».
        </p>
      </div>

      {error && (
        <div className="flex items-center gap-2 rounded-md border border-red-500/40 bg-red-500/10 px-4 py-2 text-sm text-red-400">
          <AlertCircle className="h-4 w-4 shrink-0" />
          {error}
        </div>
      )}
      {success && (
        <div className="flex items-start gap-3 rounded-xl border border-green-500/40 bg-green-500/10 px-5 py-4 text-sm text-green-300">
          <CheckCircle2 className="h-5 w-5 shrink-0 text-green-400" />
          <p>{success}</p>
        </div>
      )}

      {/* Choix de la filière */}
      <Card className="shadow-lg">
        <CardContent className="p-6">
          <div className="w-full lg:w-[32rem]">
            <label className="text-sm font-medium text-foreground mb-1.5 block">Filière</label>
            <SearchableSelect
              value={programmeId}
              onChange={setProgrammeId}
              icon={<GraduationCap className="h-4 w-4 text-muted-foreground" />}
              placeholder={programmesQuery.isLoading ? "Chargement…" : "Choisir une filière"}
              searchPlaceholder="Rechercher une filière…"
              options={programmes.map((p) => ({
                value: p.id,
                label: `${p.name} (${p.nb_ue_inscriptibles} UE${p.nb_ue_inscriptibles > 1 ? "s" : ""})`,
              }))}
            />
          </div>
        </CardContent>
      </Card>

      {/* Sessions disponibles, regroupées par lot */}
      <div className="space-y-4">
        {!programmeId && (
          <Card className="shadow-lg">
            <CardContent className="flex flex-col items-center justify-center py-16 text-center">
              <div className="bg-gradient-to-br from-green-500/20 to-blue-500/20 rounded-full w-20 h-20 flex items-center justify-center mb-4">
                <GraduationCap className="h-10 w-10 text-green-400" />
              </div>
              <h3 className="text-xl font-semibold text-foreground mb-2">Sélectionnez une filière</h3>
              <p className="text-muted-foreground">
                Choisissez une filière ci-dessus pour découvrir ses sessions disponibles.
              </p>
            </CardContent>
          </Card>
        )}

        {programmeId && catalogQuery.isLoading && (
          <Card className="shadow-lg">
            <CardContent className="flex items-center justify-center py-16">
              <Loader2 className="h-8 w-8 animate-spin text-green-400" />
            </CardContent>
          </Card>
        )}

        {programmeId &&
          !catalogQuery.isLoading &&
          groups.map((g) => {
            const enrollable = g.items.filter(
              (it: any) => !it.session.deja_inscrit && !it.verrouille
            );
            return (
              <Card key={g.key} className="shadow-md overflow-hidden">
                <div className="h-1.5 bg-gradient-to-r from-green-500 to-blue-500" />
                <CardContent className="p-5">
                  {/* En-tête du lot */}
                  <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3 mb-4">
                    <div>
                      <h3 className="font-semibold text-lg text-foreground">{g.title}</h3>
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground mt-1">
                        <span className="inline-flex items-center gap-1">
                          <CalendarRange className="h-4 w-4" />
                          {fmtDate(g.date_debut)} → {fmtDate(g.date_fin)}
                        </span>
                        <span className="inline-flex items-center gap-1">
                          <Layers className="h-4 w-4" />
                          {g.items.length} UE
                        </span>
                      </div>
                    </div>
                    {enrollable.length > 0 && (
                      <Button
                        size="sm"
                        onClick={() => handleEnrollAll(g)}
                        disabled={bulkEnrolling === g.key}
                        className="bg-gradient-to-r from-green-500 to-blue-600 hover:from-green-600 hover:to-blue-700 text-white shrink-0"
                      >
                        {bulkEnrolling === g.key ? (
                          <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                        ) : (
                          <Plus className="h-4 w-4 mr-2" />
                        )}
                        Tout prendre ({enrollable.length})
                      </Button>
                    )}
                  </div>

                  {/* UE du lot */}
                  <div className="space-y-2">
                    {g.items.map(({ session: s, ue, ecue, verrouille }: any) => (
                      <div
                        key={s.id}
                        className="flex items-start justify-between gap-3 rounded-lg border border-border bg-muted/40 px-3 py-2"
                      >
                        <div className="flex items-start gap-2.5 min-w-0">
                          <div
                            className={`rounded-md p-1.5 shrink-0 ${
                              verrouille
                                ? "bg-amber-500/15 text-amber-400"
                                : "bg-green-500/15 text-green-400"
                            }`}
                          >
                            {verrouille ? (
                              <Lock className="h-4 w-4" />
                            ) : (
                              <BookOpen className="h-4 w-4" />
                            )}
                          </div>
                          <div className="text-sm min-w-0">
                            <p className="font-medium text-foreground">
                              <span className="font-mono text-xs text-muted-foreground">
                                {ue.code}
                              </span>{" "}
                              {ue.libelle}
                            </p>
                            <p className="text-xs text-muted-foreground">
                              {ue.nb_uv} UV · {fmtFCFA(ue.prix)}
                              {s.places_restantes != null && (
                                <span className="ml-1">· {s.places_restantes} place(s)</span>
                              )}
                            </p>
                            {Array.isArray(ecue) && ecue.length > 0 && (
                              <p className="text-xs text-muted-foreground mt-1">
                                <span className="font-medium">ECUE :</span>{" "}
                                {ecue.map((e: any) => e.libelle).join(" · ")}
                              </p>
                            )}
                          </div>
                        </div>
                        {s.deja_inscrit ? (
                          <span className="inline-flex items-center gap-1.5 rounded-md bg-green-500/15 px-3 py-1.5 text-sm font-medium text-green-400 whitespace-nowrap">
                            <CheckCircle2 className="h-4 w-4" />
                            Inscrit(e)
                          </span>
                        ) : verrouille ? (
                          <span className="rounded-md bg-amber-500/15 px-3 py-1.5 text-xs font-medium text-amber-400 whitespace-nowrap">
                            Verrouillée
                          </span>
                        ) : (
                          <Button
                            size="sm"
                            disabled={enrolling === s.id || bulkEnrolling === g.key}
                            onClick={() => handleEnroll(s)}
                            className="bg-gradient-to-r from-green-500 to-blue-600 hover:from-green-600 hover:to-blue-700 text-white"
                          >
                            {enrolling === s.id ? (
                              <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                              <>
                                <Plus className="h-4 w-4 mr-1" />
                                S'inscrire
                              </>
                            )}
                          </Button>
                        )}
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            );
          })}

        {programmeId && !catalogQuery.isLoading && groups.length === 0 && (
          <Card className="shadow-lg">
            <CardContent className="flex flex-col items-center justify-center py-16 text-center">
              <div className="bg-gradient-to-br from-green-500/20 to-blue-500/20 rounded-full w-20 h-20 flex items-center justify-center mb-4">
                <BookOpen className="h-10 w-10 text-green-400" />
              </div>
              <h3 className="text-xl font-semibold text-foreground mb-2">Aucune session ouverte</h3>
              <p className="text-muted-foreground">
                Aucune session ouverte pour cette filière pour le moment.
              </p>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
