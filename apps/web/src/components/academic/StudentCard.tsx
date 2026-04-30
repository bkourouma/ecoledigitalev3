"use client";

import { StudentWithUser, StudentStatus } from "@ecoledigitale/contracts";
import { Card, CardContent, CardDescription, CardHeader, CardTitle, Badge, Button } from "@ecoledigitale/ui";
import { Mail, Phone, Calendar, MapPin, User, GraduationCap, UserCheck, UserX, Users, Edit, Eye, Trash2, Loader2 } from "lucide-react";

interface StudentCardProps {
  student: StudentWithUser;
  onEdit?: (student: StudentWithUser) => void;
  onView?: (student: StudentWithUser) => void;
  onDelete?: (student: StudentWithUser) => void;
  isDeleting?: boolean;
}

const statusConfig: Record<StudentStatus, {
  label: string;
  variant: "default" | "secondary" | "success" | "warning" | "destructive";
  icon: any;
}> = {
  active: { label: "Actif", variant: "success", icon: UserCheck },
  graduated: { label: "Diplômé", variant: "secondary", icon: GraduationCap },
  suspended: { label: "Suspendu", variant: "destructive", icon: UserX },
  dropped: { label: "Abandonné", variant: "destructive", icon: UserX },
  transfer: { label: "Transféré", variant: "secondary", icon: Users },
};

export function StudentCard({ student, onEdit, onView, onDelete, isDeleting }: StudentCardProps) {
  const statusInfo = statusConfig[student.status];
  const StatusIcon = statusInfo.icon;

  return (
    <Card onClick={() => onView?.(student)} className="relative overflow-hidden hover:shadow-lg transition-all cursor-pointer bg-gradient-to-br from-slate-50 to-white border-slate-200">
      <div className="absolute inset-0 pointer-events-none opacity-5 bg-gradient-to-br from-blue-400/20 to-purple-400/20" />
      <CardHeader className="pb-3 relative">
        <div className="flex items-start justify-between">
          <div className="space-y-1">
            <div className="flex items-center gap-3">
              <div className="h-9 w-9 rounded-full flex items-center justify-center text-white font-semibold shadow-sm"
                   style={{ background: `linear-gradient(135deg, #2563eb 0%, #7c3aed 100%)` }}>
                {(() => {
                  const u = (student.user ?? {}) as any;
                  const f = u.firstName ?? (student as any).firstName ?? u.first_name ?? (student as any).first_name ?? "";
                  const l = u.lastName ?? (student as any).lastName ?? u.last_name ?? (student as any).last_name ?? "";
                  const first = String(f ?? '').trim();
                  const last = String(l ?? '').trim();
                  return `${first?.[0] ?? ''}${last?.[0] ?? ''}`.toUpperCase() || 'ST';
                })()}
              </div>
              <CardTitle className="text-lg text-slate-900">
              {(() => {
                const u = (student.user ?? {}) as any;
                const first = u.firstName ?? (student as any).firstName ?? u.first_name ?? (student as any).first_name ?? "";
                const last = u.lastName ?? (student as any).lastName ?? u.last_name ?? (student as any).last_name ?? "";
                const nameFromUser = u.name ?? (student as any).name;
                const email = u.email ?? (student as any).email;
                const full = [first, last].filter(Boolean).join(" ").trim();
                if (full) return full;
                if (nameFromUser) return nameFromUser;
                if (email) return String(email).split("@")[0];
                return 'Unknown Student';
              })()}
            </CardTitle>
            </div>
            <CardDescription className="text-sm text-muted-foreground font-mono">
              Matricule: {student.studentNumber ?? (student as any).matricule ?? ""}
            </CardDescription>
          </div>
          <div className="flex gap-2">
            <Badge variant={statusInfo.variant} className="flex items-center gap-1">
              <StatusIcon className="h-3 w-3" />
              {statusInfo.label}
            </Badge>
            <Badge variant="outline" className="font-mono">
              Année {student.currentYear}
            </Badge>
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-4 relative">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Mail className="h-4 w-4 text-blue-600" />
          <span>{student.user?.email ?? (student as any).email ?? "—"}</span>
        </div>

        {student.phone && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Phone className="h-4 w-4 text-emerald-600" />
            <span className="font-mono">{student.phone}</span>
          </div>
        )}

        {student.emergencyPhone && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Phone className="h-4 w-4 text-amber-600" />
            <span className="font-mono">Urgence: {student.emergencyPhone}</span>
          </div>
        )}

        {student.dateOfBirth && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Calendar className="h-4 w-4 text-amber-600" />
            <span>Né(e) le {new Date(student.dateOfBirth).toLocaleDateString('fr-FR')}</span>
          </div>
        )}

        {student.placeOfBirth && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <MapPin className="h-4 w-4 text-rose-600" />
            <span>{student.placeOfBirth}</span>
          </div>
        )}

        {student.nationality && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <User className="h-4 w-4 text-sky-600" />
            <span>Nationalité: {student.nationality}</span>
          </div>
        )}

        {student.address && (
          <div className="flex items-start gap-2 text-sm text-muted-foreground">
            <MapPin className="h-4 w-4 mt-0.5 text-violet-600" />
            <span className="line-clamp-2">{student.address}</span>
          </div>
        )}

        {student.bio && (
          <p className="text-sm text-muted-foreground line-clamp-2">
            {student.bio}
          </p>
        )}

        <div className="flex items-center justify-between pt-2 border-t">
          {student.createdAt && !isNaN(new Date(student.createdAt as any).getTime()) ? (
            <span className="text-xs text-muted-foreground">
              Créé le {new Date(student.createdAt as any).toLocaleDateString('fr-FR')}
            </span>
          ) : null}

          <div className="flex gap-1">
            {onView && (
              <Button
                variant="ghost"
                size="sm"
                title="Voir"
                aria-label="Voir"
                onClick={(e) => {
                  e.stopPropagation();
                  onView(student);
                }}
                className="h-8 px-2 text-blue-600 hover:text-blue-700 hover:bg-blue-50"
              >
                <Eye className="w-4 h-4" />
              </Button>
            )}
            {onEdit && (
              <Button
                variant="ghost"
                size="sm"
                title="Éditer"
                aria-label="Éditer"
                onClick={(e) => {
                  e.stopPropagation();
                  onEdit(student);
                }}
                className="h-8 px-2 text-amber-600 hover:text-amber-700 hover:bg-amber-50"
              >
                <Edit className="w-4 h-4" />
              </Button>
            )}
            {onDelete && (
              <Button
                variant="ghost"
                size="sm"
                onClick={(e) => {
                  e.stopPropagation();
                  onDelete(student);
                }}
                disabled={isDeleting}
                className="h-8 px-2 text-red-600 hover:text-red-700 hover:bg-red-50"
              >
                {isDeleting ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Trash2 className="w-4 h-4" />
                )}
              </Button>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
