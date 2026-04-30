"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@ecoledigitale/ui";
import { Users, BookOpen, Clock, FileText } from "lucide-react";

interface ProfileStatsProps {
  statistics: {
    nb_sessions_total: number;
    nb_apprenants_formes: number;
    heures_formation_total: number;
    nb_supports_crees: number;
  };
}

export function ProfileStats({ statistics }: ProfileStatsProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Statistiques</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="p-4 border rounded-lg">
            <div className="flex items-center gap-3 mb-2">
              <BookOpen className="h-5 w-5 text-primary" />
              <div>
                <p className="text-sm text-muted-foreground">Sessions totales</p>
                <p className="text-2xl font-bold">{statistics.nb_sessions_total}</p>
              </div>
            </div>
          </div>

          <div className="p-4 border rounded-lg">
            <div className="flex items-center gap-3 mb-2">
              <Users className="h-5 w-5 text-primary" />
              <div>
                <p className="text-sm text-muted-foreground">Apprenants formés</p>
                <p className="text-2xl font-bold">{statistics.nb_apprenants_formes}</p>
              </div>
            </div>
          </div>

          <div className="p-4 border rounded-lg">
            <div className="flex items-center gap-3 mb-2">
              <Clock className="h-5 w-5 text-primary" />
              <div>
                <p className="text-sm text-muted-foreground">Heures de formation</p>
                <p className="text-2xl font-bold">{statistics.heures_formation_total}</p>
              </div>
            </div>
          </div>

          <div className="p-4 border rounded-lg">
            <div className="flex items-center gap-3 mb-2">
              <FileText className="h-5 w-5 text-primary" />
              <div>
                <p className="text-sm text-muted-foreground">Supports créés</p>
                <p className="text-2xl font-bold">{statistics.nb_supports_crees}</p>
              </div>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

