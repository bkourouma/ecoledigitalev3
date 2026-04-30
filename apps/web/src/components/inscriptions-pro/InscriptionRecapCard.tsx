"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@ecoledigitale/ui";
import { format } from "date-fns";
import { fr } from "date-fns/locale";

interface InscriptionRecapCardProps {
  inscription: {
    numero_inscription: string;
    statut: string;
    montant_ht: number;
    montant_ttc: number;
    code_promo_utilise?: string | null;
    reduction_appliquee: number;
    date_inscription: string;
  };
  session: {
    code: string;
    date_debut: string;
    date_fin: string;
    mode_formation: string;
  };
  formation: {
    titre: string;
    description?: string | null;
  };
  apprenant: {
    nom: string;
    prenom: string;
    email: string;
    telephone?: string | null;
  };
  paiement: {
    methode: string;
    numero_transaction: string;
    date_paiement: string | null;
  } | null;
}

export function InscriptionRecapCard({
  inscription,
  session,
  formation,
  apprenant,
  paiement,
}: InscriptionRecapCardProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Récapitulatif de votre inscription</CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Formation */}
        <div>
          <h3 className="font-semibold mb-2 text-lg">Formation</h3>
          <div className="space-y-1 text-sm">
            <p>
              <span className="text-muted-foreground">Titre:</span>{" "}
              <span className="font-medium">{formation.titre}</span>
            </p>
            {formation.description && (
              <p className="text-muted-foreground">{formation.description}</p>
            )}
          </div>
        </div>

        {/* Session */}
        <div>
          <h3 className="font-semibold mb-2 text-lg">Session</h3>
          <div className="space-y-1 text-sm">
            <p>
              <span className="text-muted-foreground">Code:</span>{" "}
              <span className="font-medium">{session.code}</span>
            </p>
            <p>
              <span className="text-muted-foreground">Dates:</span>{" "}
              {format(new Date(session.date_debut), "dd MMMM yyyy", { locale: fr })} -{" "}
              {format(new Date(session.date_fin), "dd MMMM yyyy", { locale: fr })}
            </p>
            <p>
              <span className="text-muted-foreground">Mode:</span>{" "}
              <span className="font-medium">{session.mode_formation}</span>
            </p>
          </div>
        </div>

        {/* Participant */}
        <div>
          <h3 className="font-semibold mb-2 text-lg">Participant</h3>
          <div className="space-y-1 text-sm">
            <p>
              <span className="text-muted-foreground">Nom:</span>{" "}
              <span className="font-medium">
                {apprenant.prenom} {apprenant.nom}
              </span>
            </p>
            <p>
              <span className="text-muted-foreground">Email:</span> {apprenant.email}
            </p>
            {apprenant.telephone && (
              <p>
                <span className="text-muted-foreground">Téléphone:</span> {apprenant.telephone}
              </p>
            )}
          </div>
        </div>

        {/* Payment */}
        {paiement && (
          <div>
            <h3 className="font-semibold mb-2 text-lg">Paiement</h3>
            <div className="space-y-1 text-sm">
              <p>
                <span className="text-muted-foreground">Méthode:</span>{" "}
                <span className="font-medium">{paiement.methode}</span>
              </p>
              <p>
                <span className="text-muted-foreground">Transaction:</span>{" "}
                {paiement.numero_transaction}
              </p>
              {paiement.date_paiement && (
                <p>
                  <span className="text-muted-foreground">Date:</span>{" "}
                  {format(new Date(paiement.date_paiement), "dd MMMM yyyy à HH:mm", { locale: fr })}
                </p>
              )}
            </div>
          </div>
        )}

        {/* Pricing */}
        <div>
          <h3 className="font-semibold mb-2 text-lg">Montant</h3>
          <div className="space-y-1 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Montant HT:</span>
              <span>{inscription.montant_ht.toFixed(2)} FCFA</span>
            </div>
            {inscription.reduction_appliquee > 0 && (
              <div className="flex justify-between text-green-600">
                <span className="text-muted-foreground">
                  Réduction {inscription.code_promo_utilise ? `(${inscription.code_promo_utilise})` : ""}:
                </span>
                <span>-{inscription.reduction_appliquee.toFixed(2)} FCFA</span>
              </div>
            )}
            <div className="flex justify-between font-bold text-lg pt-2 border-t">
              <span>Total TTC:</span>
              <span>{inscription.montant_ttc.toFixed(2)} FCFA</span>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

