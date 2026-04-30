"use client";

import { Programme, ProgrammeStatus } from "@ecoledigitale/contracts";
import { Card, CardContent, CardDescription, CardHeader, CardTitle, Badge } from "@ecoledigitale/ui";
import { Calendar, BookOpen, Award, CheckCircle, Clock, AlertCircle } from "lucide-react";

interface ProgrammeCardProps {
  programme: Programme;
  onEdit?: (programme: Programme) => void;
  onView?: (programme: Programme) => void;
  onApprove?: (programme: Programme) => void;
}

const statusConfig: Record<ProgrammeStatus, { 
  label: string; 
  variant: "default" | "secondary" | "success" | "warning" | "info";
  icon: React.ReactNode;
}> = {
  draft: { 
    label: "Brouillon", 
    variant: "secondary", 
    icon: <Clock className="h-3 w-3" />
  },
  review: { 
    label: "En révision", 
    variant: "warning", 
    icon: <AlertCircle className="h-3 w-3" />
  },
  approved: { 
    label: "Approuvé", 
    variant: "info", 
    icon: <CheckCircle className="h-3 w-3" />
  },
  active: { 
    label: "Actif", 
    variant: "success", 
    icon: <CheckCircle className="h-3 w-3" />
  },
  archived: { 
    label: "Archivé", 
    variant: "default", 
    icon: <Clock className="h-3 w-3" />
  },
};

export function ProgrammeCard({ programme, onEdit, onView, onApprove }: ProgrammeCardProps) {
  const statusInfo = statusConfig[programme.status];

  return (
    <Card className="hover:shadow-md transition-shadow cursor-pointer" onClick={() => onView?.(programme)}>
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between">
          <div className="space-y-1">
            <CardTitle className="text-lg">{programme.name}</CardTitle>
            <CardDescription className="text-sm text-muted-foreground">
              {programme.code} v{programme.version}
            </CardDescription>
          </div>
          <div className="flex gap-2">
            <Badge variant={statusInfo.variant} className="flex items-center gap-1">
              {statusInfo.icon}
              {statusInfo.label}
            </Badge>
          </div>
        </div>
      </CardHeader>
      
      <CardContent className="space-y-4">
        {programme.cycle && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <BookOpen className="h-4 w-4" />
            <span>{programme.cycle.name}</span>
          </div>
        )}
        
        {programme.academicYear && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Calendar className="h-4 w-4" />
            <span>Année {programme.academicYear}</span>
          </div>
        )}
        
        {programme.ectsCredits && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Award className="h-4 w-4" />
            <span>{programme.ectsCredits} crédits ECTS</span>
          </div>
        )}
        
        {programme.objectives && programme.objectives.length > 0 && (
          <div className="space-y-1">
            <p className="text-sm font-medium">Objectifs:</p>
            <ul className="text-sm text-muted-foreground space-y-1">
              {programme.objectives.slice(0, 2).map((objective, index) => (
                <li key={index} className="flex items-start gap-2">
                  <span className="text-primary">•</span>
                  <span className="line-clamp-1">{objective}</span>
                </li>
              ))}
              {programme.objectives.length > 2 && (
                <li className="text-xs text-muted-foreground">
                  +{programme.objectives.length - 2} autres objectifs...
                </li>
              )}
            </ul>
          </div>
        )}
        
        {programme.description && (
          <p className="text-sm text-muted-foreground line-clamp-2">
            {programme.description}
          </p>
        )}
        
        <div className="flex items-center justify-between pt-2 border-t">
          <span className="text-xs text-muted-foreground">
            Créé le {new Date(programme.createdAt).toLocaleDateString('fr-FR')}
          </span>
          
          <div className="flex gap-2">
            {programme.status === 'review' && onApprove && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onApprove(programme);
                }}
                className="text-xs text-green-600 hover:underline"
              >
                Approuver
              </button>
            )}
            {onEdit && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onEdit(programme);
                }}
                className="text-xs text-primary hover:underline"
              >
                Modifier
              </button>
            )}
          </div>
        </div>
        
        {programme.approvedBy && programme.approvedAt && (
          <div className="text-xs text-muted-foreground bg-green-50 p-2 rounded">
            Approuvé le {new Date(programme.approvedAt).toLocaleDateString('fr-FR')}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
