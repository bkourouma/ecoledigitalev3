"use client";

import { Cycle, CycleStatus, CycleType } from "@ecoledigitale/contracts";
import { Card, CardContent, CardDescription, CardHeader, CardTitle, Badge } from "@ecoledigitale/ui";
import { Calendar, Clock, GraduationCap, Settings } from "lucide-react";

interface CycleCardProps {
  cycle: Cycle;
  onEdit?: (cycle: Cycle) => void;
  onView?: (cycle: Cycle) => void;
}

const statusConfig: Record<CycleStatus, { label: string; variant: "default" | "secondary" | "success" | "warning" }> = {
  draft: { label: "Brouillon", variant: "secondary" },
  active: { label: "Actif", variant: "success" },
  archived: { label: "Archivé", variant: "warning" },
};

const typeConfig: Record<CycleType, { label: string; icon: React.ReactNode }> = {
  academic: { label: "Académique", icon: <GraduationCap className="h-4 w-4" /> },
  professional: { label: "Professionnel", icon: <Settings className="h-4 w-4" /> },
  short: { label: "Formation courte", icon: <Clock className="h-4 w-4" /> },
  certification: { label: "Certification", icon: <Calendar className="h-4 w-4" /> },
};

export function CycleCard({ cycle, onEdit, onView }: CycleCardProps) {
  const statusInfo = statusConfig[cycle.status];
  const typeInfo = typeConfig[cycle.type];

  return (
    <Card className="hover:shadow-md transition-shadow cursor-pointer" onClick={() => onView?.(cycle)}>
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between">
          <div className="space-y-1">
            <CardTitle className="text-lg">{cycle.name}</CardTitle>
            <CardDescription className="text-sm text-muted-foreground">
              Code: {cycle.code}
            </CardDescription>
          </div>
          <div className="flex gap-2">
            <Badge variant={statusInfo.variant}>
              {statusInfo.label}
            </Badge>
          </div>
        </div>
      </CardHeader>
      
      <CardContent className="space-y-4">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          {typeInfo.icon}
          <span>{typeInfo.label}</span>
        </div>
        
        {cycle.certificationLevel && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <GraduationCap className="h-4 w-4" />
            <span>Niveau: {cycle.certificationLevel}</span>
          </div>
        )}
        
        {cycle.description && (
          <p className="text-sm text-muted-foreground line-clamp-2">
            {cycle.description}
          </p>
        )}
        
        <div className="flex items-center justify-between pt-2 border-t">
          <span className="text-xs text-muted-foreground">
            Créé le {new Date(cycle.createdAt).toLocaleDateString('fr-FR')}
          </span>
          
          {onEdit && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onEdit(cycle);
              }}
              className="text-xs text-primary hover:underline"
            >
              Modifier
            </button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
