"use client";

import { useState } from "react";
import { Card, CardContent, Button } from "@ecoledigitale/ui";
import { Award, CheckCircle2, Loader2, AlertCircle, Download } from "lucide-react";
import {
  useStudentDiplomas,
  fetchStudentDiplomaAttestation,
} from "@/lib/hooks/use-professional-diplomas";
import { openDiplomePdf, type DiplomePdfInput } from "@/lib/diplome-pdf";
import { academicYearFromDate } from "@/lib/diplome-format";
import { createApiHeaders } from "@/lib/api-utils";

/**
 * Mes diplômes — espace étudiant (Module Professionnel).
 *
 * Adaptation de /parent/professionnel/diplomes à l'étudiant lui-même :
 * lecture seule des diplômes de ses programmes et de leur progression,
 * sans sélection d'enfant.
 */
export default function StudentDiplomasPage() {
  const diplomasQuery = useStudentDiplomas();
  const items: any[] = Array.isArray(diplomasQuery.data) ? diplomasQuery.data : [];

  const obtenus = items.filter((d) => d.statut_octroi === "obtenu");
  const enCours = items.filter((d) => d.statut_octroi !== "obtenu");

  return (
    <div className="space-y-8 max-w-5xl mx-auto p-6">
      <div>
        <h1 className="font-bold bg-gradient-to-r from-green-600 to-blue-600 bg-clip-text text-transparent whitespace-nowrap text-2xl leading-tight md:text-3xl">
          Mes diplômes
        </h1>
        <p className="text-muted-foreground whitespace-nowrap text-sm md:text-base">
          Consultation en lecture seule de vos diplômes professionnels et de leur progression.
        </p>
      </div>

      {diplomasQuery.isLoading && (
        <Card className="shadow-lg">
          <CardContent className="flex flex-col items-center justify-center py-16">
            <Loader2 className="h-8 w-8 animate-spin text-green-600" />
            <p className="text-gray-600 mt-4">Chargement des diplômes…</p>
          </CardContent>
        </Card>
      )}

      {diplomasQuery.isError && (
        <Card className="shadow-lg">
          <CardContent className="flex flex-col items-center justify-center py-12">
            <AlertCircle className="h-8 w-8 text-red-600" />
            <p className="text-muted-foreground mt-4">
              {(diplomasQuery.error as Error)?.message ?? "Impossible de charger les diplômes."}
            </p>
          </CardContent>
        </Card>
      )}

      {!diplomasQuery.isLoading && !diplomasQuery.isError && items.length === 0 && (
        <Card className="shadow-lg">
          <CardContent className="flex flex-col items-center justify-center py-16 text-center space-y-4">
            <Award className="h-10 w-10 text-green-600" />
            <p className="text-muted-foreground">
              Aucun diplôme disponible dans vos programmes.
            </p>
          </CardContent>
        </Card>
      )}

      {obtenus.length > 0 && (
        <section className="space-y-4">
          <h2 className="text-xl font-semibold text-gray-900">Diplômes obtenus</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {obtenus.map((d) => (
              <StudentDiplomaCard key={d.diploma.id} summary={d} obtained />
            ))}
          </div>
        </section>
      )}

      {enCours.length > 0 && (
        <section className="space-y-4">
          <h2 className="text-xl font-semibold text-gray-900">En cours</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {enCours.map((d) => (
              <StudentDiplomaCard key={d.diploma.id} summary={d} />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

function StudentDiplomaCard({
  summary,
  obtained = false,
}: {
  summary: any;
  obtained?: boolean;
}) {
  const d = summary.diploma;
  const pct = Math.max(0, Math.min(100, summary.pourcentage ?? 0));
  const [busy, setBusy] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);

  /**
   * Le PDF est produit dans le navigateur, comme côté administration. Les
   * signataires viennent de l'attestation elle-même : la route qui les expose
   * est réservée à l'administration, et un diplôme sans signature ne vaut rien.
   */
  async function telecharger() {
    if (busy) return;
    setErreur(null);
    setBusy(true);
    const win = window.open("", "_blank");
    if (!win) {
      setErreur(
        "Le navigateur a bloqué l'ouverture d'un nouvel onglet. Autorisez les pop-ups pour ce site, puis réessayez."
      );
      setBusy(false);
      return;
    }
    try {
      const att: any = await fetchStudentDiplomaAttestation(d.id);
      // Identité détaillée (matricule, naissance) : facultative, le diplôme
      // reste émis si elle n'est pas joignable.
      const moi: any = await fetch("/api/v1/students/me", { headers: createApiHeaders() })
        .then((r) => (r.ok ? r.json() : null))
        .catch(() => null);
      const profil = moi?.data ?? moi ?? null;
      const sig = att?.signataires ?? {};

      const input: DiplomePdfInput = {
        reference: att.reference,
        diplome: att.diplome,
        etudiant: {
          nom_complet: att.etudiant?.nom_complet ?? "",
          matricule:
            att.etudiant?.matricule ?? profil?.studentMatricule ?? profil?.student_number ?? null,
          date_naissance:
            att.etudiant?.date_naissance != null
              ? String(att.etudiant.date_naissance)
              : profil?.dateOfBirth
                ? String(profil.dateOfBirth)
                : null,
          lieu_naissance: att.etudiant?.lieu_naissance ?? profil?.placeOfBirth ?? null,
        },
        date_obtention: att.date_obtention,
        annee_academique: att.annee_academique ?? academicYearFromDate(att.date_obtention),
        mention: att.mention ?? null,
        signataire_gauche: sig.diplome_gauche ?? null,
        signataire_droite: sig.diplome_droite ?? null,
      };
      await openDiplomePdf(input, win);
    } catch (e: any) {
      if (win && !win.closed) win.close();
      setErreur(e?.message ?? "Impossible de produire le diplôme.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="shadow-lg">
      <CardContent className="p-6 space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold text-lg flex items-center gap-2">
            <Award className="h-5 w-5 text-green-600" />
            {d.libelle}
          </h3>
          {obtained ? (
            <span className="inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded bg-green-100 text-green-700">
              <CheckCircle2 className="h-3.5 w-3.5" />
              Obtenu
            </span>
          ) : (
            <span className="text-xs font-medium px-2 py-0.5 rounded bg-gray-100 text-gray-600">
              {pct}%
            </span>
          )}
        </div>
        <p className="font-mono text-xs text-gray-500">{d.code}</p>
        <div>
          <div className="h-2.5 w-full rounded-full bg-gray-200 overflow-hidden">
            <div
              className="h-full rounded-full bg-gradient-to-r from-green-500 to-blue-600 transition-all"
              style={{ width: `${pct}%` }}
            />
          </div>
          <p className="text-xs text-gray-500 mt-1">
            {pct}% — cible {d.uv_required} UV
          </p>
        </div>
        {obtained && summary.reference && (
          <p className="text-xs text-gray-500">Référence : {summary.reference}</p>
        )}
        {obtained && (
          <div className="pt-1">
            <Button
              variant="outline"
              size="sm"
              disabled={busy}
              onClick={telecharger}
              className="w-full"
            >
              {busy ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Download className="h-4 w-4 mr-2" />
              )}
              Télécharger mon diplôme
            </Button>
            {erreur ? <p className="text-xs text-red-600 mt-2">{erreur}</p> : null}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
