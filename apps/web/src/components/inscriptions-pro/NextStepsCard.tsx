"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@ecoledigitale/ui";
import { Calendar, Mail, Phone, FileText } from "lucide-react";
import { format } from "date-fns";
import { fr } from "date-fns/locale";

interface NextStepsCardProps {
  session: {
    code: string;
    date_debut: string;
    date_fin: string;
    mode_formation: string;
  };
  formation: {
    titre: string;
  };
}

export function NextStepsCard({ session, formation }: NextStepsCardProps) {
  const sessionStartDate = new Date(session.date_debut);
  const daysUntilStart = Math.ceil(
    (sessionStartDate.getTime() - new Date().getTime()) / (1000 * 60 * 60 * 24)
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle>Prochaines étapes</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-3">
          <div className="flex items-start space-x-3">
            <Mail className="h-5 w-5 text-primary mt-0.5" />
            <div>
              <p className="font-medium text-sm">Email de confirmation</p>
              <p className="text-xs text-muted-foreground">
                Vous recevrez un email de confirmation avec tous les détails et votre facture.
              </p>
            </div>
          </div>

          <div className="flex items-start space-x-3">
            <Calendar className="h-5 w-5 text-primary mt-0.5" />
            <div>
              <p className="font-medium text-sm">Préparez-vous pour la formation</p>
              <p className="text-xs text-muted-foreground">
                {daysUntilStart > 0
                  ? `La formation commence dans ${daysUntilStart} jour${daysUntilStart > 1 ? "s" : ""}`
                  : "La formation commence bientôt"}
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                Date de début: {format(sessionStartDate, "dd MMMM yyyy", { locale: fr })}
              </p>
            </div>
          </div>

          <div className="flex items-start space-x-3">
            <FileText className="h-5 w-5 text-primary mt-0.5" />
            <div>
              <p className="font-medium text-sm">Téléchargez votre facture</p>
              <p className="text-xs text-muted-foreground">
                Vous pouvez télécharger votre facture depuis cette page.
              </p>
            </div>
          </div>

          {session.mode_formation === "presentiel" && (
            <div className="flex items-start space-x-3">
              <Phone className="h-5 w-5 text-primary mt-0.5" />
              <div>
                <p className="font-medium text-sm">Contactez-nous</p>
                <p className="text-xs text-muted-foreground">
                  Pour toute question, contactez-nous à contact@ecoledigitale.com
                </p>
              </div>
            </div>
          )}
        </div>

        <div className="pt-4 border-t">
          <p className="text-xs text-muted-foreground text-center">
            Nous avons hâte de vous accueillir pour cette formation !
          </p>
        </div>
      </CardContent>
    </Card>
  );
}

