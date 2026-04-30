"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@ecoledigitale/ui";
import { CheckCircle, ArrowRight } from "lucide-react";
import Link from "next/link";
import type { SessionListItem } from "@ecoledigitale/contracts/src/formateurs";

interface SessionsRecentesWidgetProps {
  sessions: SessionListItem[];
}

export function SessionsRecentesWidget({ sessions }: SessionsRecentesWidgetProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <CheckCircle className="h-5 w-5" />
          Sessions récentes
        </CardTitle>
      </CardHeader>
      <CardContent>
        {sessions.length === 0 ? (
          <p className="text-muted-foreground text-sm">Aucune session terminée récemment</p>
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
                      {session.code_session} • Terminée le {new Date(session.date_fin).toLocaleDateString('fr-FR')}
                    </p>
                    <div className="flex items-center gap-2 mt-2 text-xs text-muted-foreground">
                      <span>{session.nb_inscrits} apprenant(s) formé(s)</span>
                    </div>
                  </div>
                  <ArrowRight className="h-4 w-4 text-muted-foreground ml-2" />
                </div>
              </Link>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

