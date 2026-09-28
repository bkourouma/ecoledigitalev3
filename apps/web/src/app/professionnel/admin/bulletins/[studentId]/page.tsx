"use client";

/**
 * Bulletin d'un étudiant pour un semestre donné.
 *
 * Cette route est la cible des liens « Consulter » de l'historique des bulletins
 * (`/professionnel/admin/bulletins/{studentId}?semestre={id}`, ouverts dans un
 * nouvel onglet). Le fichier était vide : l'onglet s'ouvrait sur une page
 * blanche. On rend ici le relevé en HTML — lisible, imprimable, indexable par la
 * recherche du navigateur — avec le PDF officiel en un clic.
 *
 * Le PDF reste généré côté client (jsPDF) comme sur la page principale ; comme
 * l'onglet est déjà ouvert, il n'y a plus de risque de blocage de pop-up.
 */

import { Fragment, useEffect, useMemo, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { Card, CardContent, Button } from "@ecoledigitale/ui";
import {
  AlertCircle,
  ArrowLeft,
  Award,
  Download,
  FileSpreadsheet,
  Loader2,
} from "lucide-react";
import { fetchBulletin, fetchBulletinBts } from "@/lib/hooks/use-professional-bulletins";
import { openBulletinPdf } from "@/lib/bulletin-pdf";
import { openBulletinBtsPdf } from "@/lib/bulletin-pdf-bts";
import {
  appreciation,
  decisionLabel,
  fmtDateLongFr,
  fmtNote,
  isLicenceUnOuDeux,
  niveauOf,
  rangLabel,
  sessionLabel,
  statutEtudiantLabel,
  ueEtatLabel,
  CATEGORIE_LABEL,
} from "@/lib/bulletin-format";

/* ------------------------------ Présentation ------------------------------ */

/** Couleur du badge de décision de jury. Toujours doublée du libellé. */
function decisionClasses(d: string | null | undefined): string {
  switch ((d ?? "").toLowerCase()) {
    case "admis":
      return "bg-emerald-100 text-emerald-800 ring-emerald-200";
    case "rattrapage":
      return "bg-amber-100 text-amber-800 ring-amber-200";
    case "ajourne":
    case "ajourné":
      return "bg-red-100 text-red-800 ring-red-200";
    default:
      return "bg-muted text-muted-foreground ring-border";
  }
}

/** Couleur du badge d'état d'une UE. Toujours doublée du libellé. */
function etatClasses(etat: string | null | undefined): string {
  switch ((etat ?? "").toLowerCase()) {
    case "validee":
      return "bg-emerald-100 text-emerald-800";
    case "rattrapage":
      return "bg-amber-100 text-amber-800";
    case "dette":
      return "bg-red-100 text-red-800";
    default:
      return "bg-muted text-muted-foreground";
  }
}

function Info({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <div className="text-xs uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="truncate font-medium">{value ?? "—"}</div>
    </div>
  );
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="text-xs uppercase tracking-wide text-muted-foreground">{label}</div>
        <div className="mt-1 text-2xl font-semibold tabular-nums">{value}</div>
        {hint ? <div className="mt-0.5 text-xs text-muted-foreground">{hint}</div> : null}
      </CardContent>
    </Card>
  );
}

/* --------------------------------- Page ---------------------------------- */

export default function BulletinEtudiantPage() {
  const params = useParams();
  const router = useRouter();
  const searchParams = useSearchParams();

  const studentId = String(params?.studentId ?? "");
  const semestreId = searchParams.get("semestre") ?? "";

  const [bulletin, setBulletin] = useState<any | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyPdf, setBusyPdf] = useState<null | "releve" | "bts">(null);

  useEffect(() => {
    let cancelled = false;
    if (!studentId || !semestreId) {
      setLoading(false);
      setError(
        !semestreId
          ? "Semestre non précisé dans l'adresse (paramètre « semestre » manquant)."
          : "Étudiant non précisé dans l'adresse."
      );
      return;
    }
    setLoading(true);
    setError(null);
    fetchBulletin(semestreId, studentId)
      .then((data) => {
        if (!cancelled) setBulletin(data);
      })
      .catch((err: any) => {
        if (!cancelled) setError(err?.message ?? "Impossible de charger le bulletin.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [studentId, semestreId]);

  /**
   * Catégories d'UE telles que calculées par l'API. Repli sur une catégorie
   * unique quand le bulletin n'en porte pas — même règle que le PDF.
   */
  const categories = useMemo(() => {
    if (!bulletin) return [];
    if (Array.isArray(bulletin.categories) && bulletin.categories.length > 0) {
      return bulletin.categories;
    }
    return [
      {
        key: "_all",
        ues: bulletin.ues ?? [],
        credits_obtenus: bulletin.credits_valides ?? 0,
        credits_ue: bulletin.credits_total ?? 0,
      },
    ];
  }, [bulletin]);

  const btsEligible = isLicenceUnOuDeux(bulletin?.filiere?.name);

  async function handlePdf(kind: "releve" | "bts") {
    if (!semestreId || busyPdf) return;
    setBusyPdf(kind);
    setError(null);
    // L'onglet est ouvert AVANT l'appel réseau : ouvert après, il serait bloqué
    // comme pop-up. Même garde-fou que sur la page principale des bulletins.
    const win = typeof window !== "undefined" ? window.open("", "_blank") : null;
    if (!win) {
      setError(
        "Le navigateur a bloqué l'ouverture d'un nouvel onglet. Autorisez les pop-ups pour ce site, puis réessayez."
      );
      setBusyPdf(null);
      return;
    }
    try {
      if (kind === "releve") {
        const data = await fetchBulletin(semestreId, studentId);
        await openBulletinPdf(data, win);
      } else {
        const data = await fetchBulletinBts(semestreId, studentId);
        await openBulletinBtsPdf(data, win);
      }
    } catch (err: any) {
      win.close();
      setError(err?.message ?? "Impossible de générer le document.");
    } finally {
      setBusyPdf(null);
    }
  }

  if (loading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <div className="text-center">
          <Loader2 className="mx-auto h-8 w-8 animate-spin text-indigo-500" />
          <p className="mt-3 text-sm text-muted-foreground">Chargement du bulletin…</p>
        </div>
      </div>
    );
  }

  if (error && !bulletin) {
    return (
      <div className="mx-auto max-w-3xl space-y-4 p-6">
        <Card className="border-red-200">
          <CardContent className="flex flex-col items-center gap-4 py-12 text-center">
            <AlertCircle className="h-10 w-10 text-red-500" />
            <div>
              <h1 className="text-lg font-semibold">Bulletin indisponible</h1>
              <p className="text-muted-foreground whitespace-nowrap text-sm md:text-base">{error}</p>
            </div>
            <Button variant="outline" onClick={() => router.push("/professionnel/admin/bulletins")}>
              <ArrowLeft className="mr-2 h-4 w-4" />
              Retour aux bulletins
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  const student = bulletin?.student ?? {};
  const filiere = bulletin?.filiere ?? {};
  const semestre = bulletin?.semestre ?? {};
  const creditsValides = bulletin?.credits_valides ?? 0;
  const creditsTotal = bulletin?.credits_total ?? 0;

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-6">
      {/* En-tête */}
      <div className="mb-6 flex max-w-full flex-col items-start gap-2 overflow-x-auto md:mb-8 md:gap-3 sm:items-start sm:justify-between">
        <div className="min-w-0">
          <Link
            href="/professionnel/admin/bulletins/historique"
            className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="h-4 w-4" />
            Historique des bulletins
          </Link>
          <h1 className="whitespace-nowrap mt-2 flex items-center gap-2 font-bold text-2xl leading-tight md:text-3xl">
            <FileSpreadsheet className="h-6 w-6 text-indigo-500" />
            {`${student.last_name ?? ""} ${student.first_name ?? ""}`.trim() || "Étudiant"}
          </h1>
          <p className="whitespace-nowrap text-muted-foreground text-sm md:text-base">
            {semestre.libelle ?? "Semestre"}
            {filiere.name ? ` · ${filiere.name}` : ""}
            {bulletin?.annee_academique ? ` · ${bulletin.annee_academique}` : ""}
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          <Button onClick={() => handlePdf("releve")} disabled={busyPdf !== null}>
            {busyPdf === "releve" ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Download className="mr-2 h-4 w-4" />
            )}
            Relevé de notes (PDF)
          </Button>
          {btsEligible && (
            <Button
              variant="outline"
              onClick={() => handlePdf("bts")}
              disabled={busyPdf !== null}
              title="Disponible pour les classes Licence 1 et 2"
            >
              {busyPdf === "bts" ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Award className="mr-2 h-4 w-4" />
              )}
              Bulletin BTS (PDF)
            </Button>
          )}
        </div>
      </div>

      {error && (
        <div className="flex items-start gap-2 rounded-md border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-700">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* Synthèse */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat
          label="Moyenne du semestre"
          value={fmtNote(bulletin?.moyenne_session)}
          hint={appreciation(bulletin?.moyenne_session)}
        />
        <Stat
          label="Crédits validés"
          value={`${creditsValides}/${creditsTotal}`}
          hint={
            creditsTotal > 0
              ? `${Math.round((creditsValides / creditsTotal) * 100)} % des crédits du semestre`
              : undefined
          }
        />
        <Stat
          label="UE validées"
          value={`${bulletin?.nb_ue_validees ?? 0}/${bulletin?.nb_ue_total ?? 0}`}
          hint={`Validées en ${sessionLabel(bulletin?.session_globale ?? 1).toLowerCase()}`}
        />
        <Stat
          label="Rang"
          value={rangLabel(bulletin?.rang)}
          hint={bulletin?.effectif ? `sur ${bulletin.effectif} étudiants` : undefined}
        />
      </div>

      {/* Décision + statut */}
      <Card>
        <CardContent className="flex flex-wrap items-center gap-3 p-4">
          <span className="text-sm text-muted-foreground">Décision du jury :</span>
          <span
            className={`rounded-full px-3 py-1 text-sm font-semibold ring-1 ${decisionClasses(
              bulletin?.decision
            )}`}
          >
            {decisionLabel(bulletin?.decision)}
          </span>
          {bulletin?.statut_etudiant && (
            <>
              <span className="text-sm text-muted-foreground">·</span>
              <span className="text-sm font-medium">
                {statutEtudiantLabel(bulletin.statut_etudiant)}
              </span>
            </>
          )}
          {bulletin?.statut && (
            <span
              className={`ml-auto rounded-full px-2.5 py-0.5 text-xs font-medium ${
                bulletin.statut === "definitif"
                  ? "bg-emerald-100 text-emerald-800"
                  : "bg-amber-100 text-amber-800"
              }`}
              title={
                bulletin.statut === "definitif"
                  ? "Bulletin définitif"
                  : "Bulletin provisoire, en attente de la session 2"
              }
            >
              {bulletin.statut === "definitif" ? "Définitif" : "Provisoire"}
            </span>
          )}
        </CardContent>
      </Card>

      {/* Identité */}
      <Card>
        <CardContent className="grid gap-4 p-5 sm:grid-cols-2 lg:grid-cols-3">
          <Info label="Matricule" value={<span className="font-mono">{student.matricule ?? "—"}</span>} />
          <Info
            label="Né(e) le"
            value={`${fmtDateLongFr(student.date_of_birth)}${
              student.place_of_birth ? ` à ${student.place_of_birth}` : ""
            }`}
          />
          <Info label="Niveau" value={niveauOf(filiere.name)} />
          <Info label="Spécialité" value={filiere.name} />
          <Info label="Domaine" value={filiere.domaine} />
          <Info label="Redoublant(e)" value={student.is_repeating ? "Oui" : "Non"} />
        </CardContent>
      </Card>

      {/* Détail par catégorie / UE / ECUE */}
      {categories.map((cat: any) => (
        <Card key={cat.key ?? "cat"}>
          <CardContent className="p-0">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-5 py-3">
              <h2 className="font-semibold">
                {CATEGORIE_LABEL[cat.key] ?? (cat.key === "_all" ? "Unités d'enseignement" : cat.key)}
              </h2>
              <span className="text-sm text-muted-foreground tabular-nums">
                {cat.credits_obtenus ?? 0}/{cat.credits_ue ?? 0} crédits
              </span>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-muted/40 text-left">
                    <th className="px-5 py-2 font-medium">Unité d'enseignement</th>
                    <th className="px-4 py-2 text-center font-medium">Note</th>
                    <th className="px-4 py-2 text-center font-medium">Appréciation</th>
                    <th className="px-4 py-2 text-center font-medium">Crédits</th>
                    <th className="px-4 py-2 text-center font-medium">Session</th>
                  </tr>
                </thead>
                <tbody>
                  {(cat.ues ?? []).length === 0 && (
                    <tr>
                      <td colSpan={5} className="px-5 py-6 text-center text-muted-foreground">
                        Aucune UE dans cette catégorie.
                      </td>
                    </tr>
                  )}
                  {(cat.ues ?? []).map((ue: any) => (
                    <Fragment key={ue.ue_id ?? ue.code}>
                      <tr className="border-b border-border/60 bg-muted/20">
                        <td className="px-5 py-2.5 font-semibold uppercase">
                          {ue.libelle ?? ue.code ?? "—"}
                        </td>
                        <td className="px-4 py-2.5 text-center font-mono font-semibold">
                          {fmtNote(ue.moyenne_ue)}
                        </td>
                        <td className="px-4 py-2.5 text-center">
                          <span
                            className={`rounded-full px-2 py-0.5 text-xs font-medium ${etatClasses(
                              ue.etat
                            )}`}
                          >
                            {ueEtatLabel(ue.etat)}
                          </span>
                        </td>
                        <td className="px-4 py-2.5 text-center tabular-nums">{ue.credits ?? "—"}</td>
                        <td className="px-4 py-2.5 text-center">
                          {sessionLabel(ue.session_validation)}
                        </td>
                      </tr>
                      {(ue.ecues ?? []).map((e: any) => (
                        <tr
                          key={`${ue.ue_id ?? ue.code}-${e.ecue_id ?? e.code}`}
                          className="border-b border-border/40"
                        >
                          <td className="px-5 py-2 pl-10 text-muted-foreground">
                            {e.libelle ?? e.code ?? "—"}
                          </td>
                          <td className="px-4 py-2 text-center font-mono">{fmtNote(e.note_ecue)}</td>
                          <td className="px-4 py-2 text-center text-muted-foreground">
                            {appreciation(e.note_ecue)}
                          </td>
                          <td className="px-4 py-2 text-center tabular-nums">
                            {e.credits != null ? e.credits : "—"}
                          </td>
                          <td className="px-4 py-2 text-center">
                            {sessionLabel(e.session_obtention)}
                          </td>
                        </tr>
                      ))}
                    </Fragment>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      ))}

      <p className="text-xs text-muted-foreground">
        Cette vue restitue le bulletin tel qu'il a été calculé et enregistré
        {bulletin?.generated_at
          ? ` le ${new Date(bulletin.generated_at).toLocaleDateString("fr-FR")}`
          : ""}
        . Le document officiel reste le PDF généré ci-dessus.
      </p>
    </div>
  );
}
