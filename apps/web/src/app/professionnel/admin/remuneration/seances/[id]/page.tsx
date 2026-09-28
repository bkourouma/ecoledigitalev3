"use client";

import { useParams, useRouter } from "next/navigation";
import { Card, CardContent } from "@ecoledigitale/ui";
import {
  ArrowLeft,
  CalendarCheck,
  CheckCircle2,
  Clock,
  Loader2,
  AlertCircle,
  Lock,
  UserRound,
  Users,
  Banknote,
  PencilLine,
} from "lucide-react";
import { useSeanceDetail, BLOCKER_LABELS } from "@/lib/hooks/use-professional-remuneration";
import { STATUT_LABELS, STATUT_STYLES, fmtDate, fmtHeures } from "../_shared";

/**
 * Fiche d'une séance — Module Professionnel (feature 031).
 *
 * Le tableau de validation ne porte que ce qui sert à décider : date, volume,
 * enseignant, statut, payabilité. Tout le reste — filière, cohorte, semestre,
 * répartition des pointages, traçabilité, paiement rattaché — vit ici. Une
 * colonne de plus dans la liste rendait chaque ligne illisible ; une page dédiée
 * ne coûte rien tant qu'on ne l'ouvre pas.
 */

const PRESENCE_LABELS: Record<string, string> = {
  present: "Présents",
  absent: "Absents",
  retard: "Retards",
  excuse: "Absences justifiées",
};

function Champ({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-xs uppercase tracking-wide text-muted-foreground">{label}</span>
      <span className="text-sm">{children}</span>
    </div>
  );
}

function fmtMontant(v: number, devise = "XOF") {
  return `${Math.round(v).toLocaleString("fr-FR")} ${devise}`;
}

function fmtHorodatage(v: string | null) {
  if (!v) return "—";
  const d = new Date(v);
  return isNaN(d.getTime()) ? v : d.toLocaleString("fr-FR");
}

export default function SeanceDetailPage() {
  const params = useParams();
  const router = useRouter();
  const id = (params?.id as string) ?? null;
  const { data: s, isLoading, isError, error } = useSeanceDetail(id);

  if (isLoading) {
    return (
      <div className="flex justify-center py-20">
        <Loader2 className="h-10 w-10 animate-spin text-indigo-500" />
      </div>
    );
  }

  if (isError || !s) {
    return (
      <div className="max-w-3xl mx-auto p-6">
        <Card className="border-red-500/40">
          <CardContent className="flex items-center gap-3 py-8 text-red-400">
            <AlertCircle className="h-6 w-6 shrink-0" />
            <p>{(error as Error)?.message ?? "Séance introuvable."}</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const verrouillee = Boolean(
    s.paiement_statut && ["approved", "paid"].includes(s.paiement_statut)
  );
  const totalPointages = s.presences_detail.reduce((n, p) => n + p.n, 0);

  return (
    <div className="space-y-6 max-w-5xl mx-auto p-6">
      <div className="mb-6 flex max-w-full flex-col items-start gap-2 overflow-x-auto md:mb-8 md:gap-3">
        <div>
          <button
            onClick={() => router.back()}
            className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground mb-2"
          >
            <ArrowLeft className="h-4 w-4" />
            Retour à la validation
          </button>
          <h1 className="whitespace-nowrap font-bold flex items-center gap-2 text-2xl leading-tight md:text-3xl">
            <CalendarCheck className="h-6 w-6 text-indigo-400" />
            {s.ecue_libelle ?? "Séance"}
          </h1>
          <p className="whitespace-nowrap text-muted-foreground text-sm md:text-base">
            <span className="font-mono text-xs">{s.ecue_code}</span>
            {s.seance_libelle && <> · {s.seance_libelle}</>} · {fmtDate(s.date)}
          </p>
        </div>

        <div className="text-right shrink-0">
          <span
            className={`inline-block rounded-md border px-3 py-1 text-sm font-medium ${STATUT_STYLES[s.statut]}`}
          >
            {STATUT_LABELS[s.statut]}
          </span>
          <div className="mt-2">
            {verrouillee ? (
              <span className="inline-flex items-center gap-1 text-sm text-muted-foreground">
                <Lock className="h-4 w-4" />
                Payée
              </span>
            ) : s.payable ? (
              <span className="inline-flex items-center gap-1 text-sm text-emerald-400 font-medium">
                <CheckCircle2 className="h-4 w-4" />
                Payable
              </span>
            ) : (
              <span className="text-sm text-amber-400">
                {s.blockers.map((b) => BLOCKER_LABELS[b]).join(" · ")}
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Rattachement pédagogique — ce qui a quitté le tableau */}
      <Card>
        <CardContent className="p-5">
          <h2 className="text-sm font-semibold mb-4 flex items-center gap-2">
            <Users className="h-4 w-4 text-muted-foreground" />
            Rattachement
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            <Champ label="Filière">{s.filiere_nom ?? "—"}</Champ>
            <Champ label="Session">{s.cohorte_libelle ?? "—"}</Champ>
            <Champ label="Semestre">{s.semestre_libelle ?? "—"}</Champ>
            <Champ label="ECUE">
              <span className="font-mono text-xs text-muted-foreground">{s.ecue_code}</span>{" "}
              {s.ecue_libelle}
            </Champ>
            <Champ label="Enseignant">
              <span className="inline-flex items-center gap-1.5">
                <UserRound className="h-3.5 w-3.5 text-muted-foreground" />
                {s.enseignant_nom ?? "Aucun"}
              </span>
            </Champ>
            <Champ label="Libellé de la séance">{s.seance_libelle ?? "—"}</Champ>
          </div>
        </CardContent>
      </Card>

      {/* Temps et volume */}
      <Card>
        <CardContent className="p-5">
          <h2 className="text-sm font-semibold mb-4 flex items-center gap-2">
            <Clock className="h-4 w-4 text-muted-foreground" />
            Temps
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <Champ label="Date">{fmtDate(s.date)}</Champ>
            <Champ label="Horaires">
              {s.heure_debut && s.heure_fin
                ? `${s.heure_debut.slice(0, 5)} – ${s.heure_fin.slice(0, 5)}`
                : "Sans horaires"}
            </Champ>
            <Champ label="Volume retenu pour la paie">
              <span className="font-medium">{fmtHeures(s.duree_heures)}</span>
            </Champ>
            <Champ label="Volume planifié">{fmtHeures(s.duree_planifiee)}</Champ>
          </div>

          {/* La dérogation ne se devine pas d'un volume seul : dire qui l'a
              posée et quand est ce qui la rend contrôlable. */}
          {s.duree_payee != null && (
            <div className="mt-4 rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm">
              <span className="inline-flex items-center gap-1.5 font-medium text-amber-300">
                <PencilLine className="h-4 w-4" />
                Volume corrigé par la comptabilité
              </span>
              <p className="mt-1 text-amber-200/90">
                {fmtHeures(s.duree_payee)} retenues au lieu de {fmtHeures(s.duree_planifiee)}{" "}
                prévues. Les horaires n'ont pas été modifiés.
              </p>
              <p className="mt-1 text-xs text-amber-200/70">
                {s.duree_payee_par_nom ? `Par ${s.duree_payee_par_nom}` : "Auteur inconnu"} ·{" "}
                {fmtHorodatage(s.duree_payee_le)}
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Pointages */}
      <Card>
        <CardContent className="p-5">
          <h2 className="text-sm font-semibold mb-4 flex items-center gap-2">
            <Users className="h-4 w-4 text-muted-foreground" />
            Appel
          </h2>
          {totalPointages === 0 ? (
            <p className="text-muted-foreground whitespace-nowrap text-sm md:text-base">
              Aucun pointage enregistré. L'appel n'est pas obligatoire pour payer une séance : il
              constate qu'elle a eu lieu, il ne la valide pas.
            </p>
          ) : (
            <div className="flex flex-wrap gap-4">
              {s.presences_detail.map((p) => (
                <div key={p.statut} className="rounded-lg border border-border px-4 py-2">
                  <div className="text-xs text-muted-foreground">
                    {PRESENCE_LABELS[p.statut] ?? p.statut}
                  </div>
                  <div className="text-xl font-bold">{p.n}</div>
                </div>
              ))}
              <div className="rounded-lg border border-border px-4 py-2 bg-muted/40">
                <div className="text-xs text-muted-foreground">Total pointé</div>
                <div className="text-xl font-bold">{totalPointages}</div>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Traçabilité */}
      <Card>
        <CardContent className="p-5">
          <h2 className="text-sm font-semibold mb-4">Traçabilité</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Champ label="Validée pour la paie">
              {s.validated_at ? (
                <>
                  {fmtHorodatage(s.validated_at)}
                  {s.validated_by_nom && (
                    <span className="text-muted-foreground"> · par {s.validated_by_nom}</span>
                  )}
                </>
              ) : (
                <span className="text-amber-400">Pas encore validée</span>
              )}
            </Champ>
            <Champ label="Origine de la séance">
              {s.saisie_comptable
                ? "Ajoutée depuis l'écran de paie (saisie comptable)"
                : "Créée dans le planning pédagogique"}
            </Champ>
          </div>
        </CardContent>
      </Card>

      {/* Paiement rattaché */}
      <Card>
        <CardContent className="p-5">
          <h2 className="text-sm font-semibold mb-4 flex items-center gap-2">
            <Banknote className="h-4 w-4 text-muted-foreground" />
            Paiement
          </h2>
          {s.lignes_paiement.length === 0 ? (
            <p className="text-muted-foreground whitespace-nowrap text-sm md:text-base">
              Cette séance n'est rattachée à aucun bulletin. Elle le sera au prochain calcul, si
              elle est payable.
            </p>
          ) : (
            <div className="space-y-3">
              {s.lignes_paiement.map((l, i) => (
                <div key={i} className="rounded-lg border border-border p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-sm">
                      {l.periode ?? "Période inconnue"} ·{" "}
                      <span className="text-muted-foreground">{l.statut}</span>
                    </span>
                    <span className="font-mono font-medium">
                      {fmtMontant(l.montant, l.currency)}
                    </span>
                  </div>
                  <p className="text-sm text-muted-foreground mt-1">
                    {fmtHeures(l.heures)} × {fmtMontant(l.tarif, l.currency)}
                    {l.is_overtime && " · heures supplémentaires"}
                  </p>
                  {/* Le tarif est figé au calcul : une révision ultérieure ne
                      réécrit pas un bulletin déjà produit. */}
                  <p className="text-xs text-muted-foreground mt-1">
                    Tarif figé au moment du calcul.
                  </p>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
