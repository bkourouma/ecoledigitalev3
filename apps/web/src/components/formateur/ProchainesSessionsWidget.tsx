"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@ecoledigitale/ui";
import { Calendar, ArrowRight } from "lucide-react";
import Link from "next/link";
import type { SessionListItem } from "@ecoledigitale/contracts/src/formateurs";

interface ProchainesSessionsWidgetProps {
  sessions: SessionListItem[];
}

export function ProchainesSessionsWidget({ sessions }: ProchainesSessionsWidgetProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Calendar className="h-5 w-5" />
          Prochaines sessions
        </CardTitle>
      </CardHeader>
      <CardContent>
        {sessions.length === 0 ? (
          <p className="text-muted-foreground text-sm">Aucune session à venir</p>
        ) : (
          <div className="space-y-3">
            {sessions.map((session) => (
              <Link
                key={session.id}
                href={`/formateur/sessions/${session.id}/details`}
                className="block p-3 rounded-lg border hover:bg-accent transition-colors"
              >
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <h4 className="font-medium text-sm">{session.formation.titre}</h4>
                    <p className="text-xs text-muted-foreground mt-1">
                      {session.code_session} • {new Date(session.date_debut).toLocaleDateString('fr-FR')}
                    </p>
                    <div className="flex items-center gap-2 mt-2 text-xs text-muted-foreground">
                      <span>{session.nb_inscrits} inscrit(s)</span>
                      <span>•</span>
                      <span>{session.mode_formation}</span>
                    </div>
                  </div>
                  <ArrowRight className="h-4 w-4 text-muted-foreground ml-2" />
                </div>
              </Link>
            ))}
          </div>
        )}
        {sessions.length > 0 && (
          <Link
            href="/formateur/sessions"
            className="mt-4 block text-sm text-primary hover:underline text-center"
          >
            Voir toutes les sessions →
          </Link>
        )}
      </CardContent>
    </Card>
  );
}

