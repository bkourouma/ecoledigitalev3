"use client";

import { Teacher, TeacherStatus, ContractType } from "@ecoledigitale/contracts";
import { Card, CardContent, CardDescription, CardHeader, CardTitle, Badge, Button } from "@ecoledigitale/ui";
import { Mail, Phone, Calendar, Euro, User, Award, Edit, Eye, Trash2 } from "lucide-react";
import { formatAmountFCFA } from "@/lib/utils";

interface TeacherCardProps {
  teacher: Teacher;
  onEdit?: (teacher: Teacher) => void;
  onView?: (teacher: Teacher) => void;
  onDelete?: (teacher: Teacher) => void;
  isDeleting?: boolean;
}

const statusConfig: Record<TeacherStatus, { 
  label: string; 
  variant: "default" | "secondary" | "success" | "warning" | "destructive";
}> = {
  active: { label: "Actif", variant: "success" },
  inactive: { label: "Inactif", variant: "secondary" },
  suspended: { label: "Suspendu", variant: "destructive" },
};

const contractConfig: Record<ContractType, {
  label: string;
  variant: "default" | "secondary" | "outline";
}> = {
  permanent: { label: "CDI", variant: "default" },
  temporary: { label: "CDD", variant: "secondary" },
  freelance: { label: "Vacataire", variant: "outline" },
};

export function TeacherCard({ teacher, onEdit, onView, onDelete, isDeleting }: TeacherCardProps) {
  const statusInfo = statusConfig[teacher.status];
  const contractInfo = contractConfig[teacher.contractType];

  return (
    <Card className="relative overflow-hidden hover:shadow-lg transition-all cursor-pointer bg-white border-slate-200 text-slate-900" onClick={() => onView?.(teacher)}>
      <div className="absolute inset-0 pointer-events-none opacity-5 bg-[radial-gradient(circle_at_30%_20%,#7c3aed,transparent_25%),radial-gradient(circle_at_70%_60%,#ec4899,transparent_25%)]" />
      <CardHeader className="pb-3 relative">
        <div className="flex items-start justify-between">
          <div className="space-y-1">
            <div className="flex items-center gap-3">
              <div className="h-9 w-9 rounded-full flex items-center justify-center text-white font-semibold shadow-sm"
                   style={{ background: `linear-gradient(135deg, #7c3aed 0%, #ec4899 100%)` }}>
                {`${teacher.firstName?.[0] ?? ''}${teacher.lastName?.[0] ?? ''}`.toUpperCase()}
              </div>
              <CardTitle className="text-lg font-semibold text-slate-900 dark:text-slate-100">
                {teacher.firstName} {teacher.lastName}
              </CardTitle>
            </div>
            {teacher.employeeNumber && (
              <CardDescription className="text-sm text-muted-foreground">
                N° {teacher.employeeNumber}
              </CardDescription>
            )}
          </div>
          <div className="flex gap-2">
            <Badge variant={statusInfo.variant}>
              {statusInfo.label}
            </Badge>
            <Badge variant={contractInfo.variant}>
              {contractInfo.label}
            </Badge>
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-4 relative">
        {teacher.email && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Mail className="h-4 w-4 text-blue-600" />
            <span className="truncate">{teacher.email}</span>
          </div>
        )}
        
        {teacher.phone && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Phone className="h-4 w-4 text-emerald-600" />
            <span>{teacher.phone}</span>
          </div>
        )}
        
        {teacher.hireDate && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Calendar className="h-4 w-4 text-amber-600" />
            <span>Embauché le {new Date(teacher.hireDate).toLocaleDateString('fr-FR')}</span>
          </div>
        )}
        
        {teacher.hourlyRate && teacher.contractType === 'freelance' && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Euro className="h-4 w-4" />
            <span>{formatAmountFCFA(teacher.hourlyRate)}/heure</span>
          </div>
        )}
        
        {teacher.specialties && teacher.specialties.length > 0 && (
          <div className="space-y-1">
            <p className="text-sm font-medium text-slate-800">Spécialités:</p>
            <div className="flex flex-wrap gap-1.5">
              {teacher.specialties.slice(0, 3).map((specialty, index) => (
                <Badge
                  key={index}
                  variant="secondary"
                  className="text-xs bg-violet-50 text-violet-700 border border-violet-200 hover:bg-violet-100 whitespace-nowrap max-w-[150px] truncate"
                >
                  {specialty}
                </Badge>
              ))}
              {teacher.specialties.length > 3 && (
                <Badge
                  variant="secondary"
                  className="text-xs bg-slate-100 text-slate-700 border border-slate-200 hover:bg-slate-200"
                >
                  +{teacher.specialties.length - 3}
                </Badge>
              )}
            </div>
          </div>
        )}

        {teacher.qualifications && teacher.qualifications.length > 0 && (
          <div className="space-y-1">
            <p className="text-sm font-medium flex items-center gap-1">
              <Award className="h-4 w-4" />
              Qualifications:
            </p>
            <ul className="text-sm text-muted-foreground space-y-1">
              {teacher.qualifications.slice(0, 2).map((qualification, index) => (
                <li key={index} className="flex items-start gap-2">
                  <span className="text-primary">•</span>
                  <span className="line-clamp-1">{qualification}</span>
                </li>
              ))}
              {teacher.qualifications.length > 2 && (
                <li className="text-xs text-muted-foreground">
                  +{teacher.qualifications.length - 2} autres qualifications...
                </li>
              )}
            </ul>
          </div>
        )}
        
        {teacher.bio && (
          <p className="text-sm text-slate-600 dark:text-slate-300 line-clamp-2">
            {teacher.bio}
          </p>
        )}
        
        <div className="flex items-center justify-between pt-2 border-t">
          <span className="text-xs text-muted-foreground">
            Créé le {new Date(teacher.createdAt).toLocaleDateString('fr-FR')}
          </span>

          <div className="flex gap-1">
            {onView && (
              <Button
                variant="ghost"
                size="sm"
                onClick={(e) => {
                  e.stopPropagation();
                  onView(teacher);
                }}
                className="h-8 px-2"
              >
                <Eye className="w-3 h-3" />
              </Button>
            )}
            {onEdit && (
              <Button
                variant="ghost"
                size="sm"
                onClick={(e) => {
                  e.stopPropagation();
                  onEdit(teacher);
                }}
                className="h-8 px-2"
              >
                <Edit className="w-3 h-3" />
              </Button>
            )}
            {onDelete && (
              <Button
                variant="ghost"
                size="sm"
                onClick={(e) => {
                  e.stopPropagation();
                  onDelete(teacher);
                }}
                disabled={isDeleting}
                className="h-8 px-2 text-red-600 hover:text-red-700 hover:bg-red-50"
              >
                <Trash2 className="w-3 h-3" />
              </Button>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
