'use client';

import React from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import Link from 'next/link';
import {
  Users,
  GraduationCap,
  AlertCircle,
  CheckCircle2,
  ArrowRight,
  Calendar,
  BookOpen,
} from 'lucide-react';
import { ChildListItem } from '@ecoledigitale/contracts';

interface ChildrenListProps {
  children: ChildListItem[];
  isLoading?: boolean;
  error?: Error | null;
}

const STATUS_STYLES: Record<string, { label: string; className: string }> = {
  active: { label: 'Actif', className: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30' },
  suspended: { label: 'Suspendu', className: 'bg-amber-500/15 text-amber-400 border-amber-500/30' },
  dropped: { label: 'Abandonné', className: 'bg-red-500/15 text-red-400 border-red-500/30' },
  transfer: { label: 'Transféré', className: 'bg-blue-500/15 text-blue-400 border-blue-500/30' },
  graduated: { label: 'Diplômé', className: 'bg-purple-500/15 text-purple-400 border-purple-500/30' },
};

const AVATAR_GRADIENTS = [
  'from-emerald-500 to-teal-600',
  'from-blue-500 to-indigo-600',
  'from-purple-500 to-pink-600',
  'from-amber-500 to-orange-600',
  'from-rose-500 to-red-600',
  'from-cyan-500 to-blue-600',
];

function getInitials(name: string) {
  return name
    .split(' ')
    .map((part) => part[0])
    .filter(Boolean)
    .slice(0, 2)
    .join('')
    .toUpperCase();
}

function getGradientForId(id: string) {
  const sum = Array.from(id).reduce((acc, ch) => acc + ch.charCodeAt(0), 0);
  return AVATAR_GRADIENTS[sum % AVATAR_GRADIENTS.length];
}

function getGradeTone(value: number) {
  if (value >= 14) return 'text-emerald-400';
  if (value >= 10) return 'text-amber-400';
  return 'text-red-400';
}

export function ChildrenList({ children, isLoading, error }: ChildrenListProps) {
  if (isLoading) {
    return (
      <div
        className="flex items-center justify-center py-16"
        role="status"
        aria-label="Chargement de la liste des enfants"
      >
        <div
          className="animate-spin rounded-full h-12 w-12 border-b-2 border-emerald-500"
          aria-hidden="true"
        />
        <span className="sr-only">Chargement en cours...</span>
      </div>
    );
  }

  if (error) {
    return (
      <Card className="border-red-500/30 bg-red-500/5">
        <CardContent className="pt-6">
          <div className="text-center py-8">
            <AlertCircle className="mx-auto h-12 w-12 text-red-400 mb-4" />
            <p className="text-red-400 font-medium">Erreur lors du chargement</p>
            <p className="text-muted-foreground text-sm mt-2">{error.message}</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (!children || children.length === 0) {
    return (
      <Card>
        <CardContent className="pt-6">
          <div className="text-center py-12">
            <div className="mx-auto h-16 w-16 rounded-full bg-muted flex items-center justify-center mb-4">
              <Users className="h-8 w-8 text-muted-foreground" />
            </div>
            <h3 className="text-lg font-semibold text-foreground mb-2">
              Aucun enfant trouvé
            </h3>
            <p className="text-muted-foreground">
              Aucun enfant n'est actuellement lié à votre compte.
            </p>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <div
      className="grid grid-cols-1 lg:grid-cols-2 gap-4"
      role="list"
      aria-label="Liste des enfants"
    >
      {children.map((child, index) => {
        const status = STATUS_STYLES[child.status] ?? {
          label: child.status,
          className: 'bg-muted text-muted-foreground border-border',
        };
        const gradient = getGradientForId(child.id);
        const initials = getInitials(child.name);
        const grade = child.summaryIndicator.gradeAverage;
        const attendance = child.summaryIndicator.attendanceStatus;

        return (
          <Card
            key={`child-${child.id}-${index}`}
            className="group relative overflow-hidden border-border bg-card hover:border-emerald-500/40 hover:shadow-lg hover:shadow-emerald-500/5 transition-all"
            role="listitem"
          >
            <div
              className={`absolute inset-x-0 top-0 h-1 bg-gradient-to-r ${gradient}`}
              aria-hidden="true"
            />

            <CardContent className="p-5">
              <div className="flex items-start gap-4">
                <div
                  className={`flex-shrink-0 h-14 w-14 rounded-xl bg-gradient-to-br ${gradient} flex items-center justify-center text-white font-bold text-lg shadow-md`}
                  aria-hidden="true"
                >
                  {initials}
                </div>

                <div className="flex-1 min-w-0">
                  <div className="flex flex-wrap items-center gap-2 mb-1">
                    <h3 className="text-lg font-semibold text-foreground truncate">
                      {child.name}
                    </h3>
                    <Badge
                      variant="outline"
                      className={`text-xs font-medium ${status.className}`}
                    >
                      {status.label}
                    </Badge>
                  </div>
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
                    <span className="flex items-center gap-1.5">
                      <GraduationCap className="h-4 w-4" aria-hidden="true" />
                      Année {child.currentYear}
                    </span>
                    <span className="font-mono text-xs">#{child.studentNumber}</span>
                  </div>
                </div>

                {grade !== null && (
                  <div className="flex-shrink-0 text-right">
                    <div className={`text-2xl font-bold tabular-nums ${getGradeTone(grade)}`}>
                      {grade.toFixed(1)}
                      <span className="text-sm text-muted-foreground font-normal">/20</span>
                    </div>
                    <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
                      Moyenne
                    </div>
                  </div>
                )}
              </div>

              <div className="flex items-center justify-between gap-3 mt-5 pt-4 border-t border-border">
                <div className="flex items-center gap-2 text-xs">
                  {attendance === 'warning' ? (
                    <span className="flex items-center gap-1 text-amber-400">
                      <AlertCircle className="h-3.5 w-3.5" />
                      Présence à surveiller
                    </span>
                  ) : attendance === 'good' ? (
                    <span className="flex items-center gap-1 text-emerald-400">
                      <CheckCircle2 className="h-3.5 w-3.5" />
                      Présence régulière
                    </span>
                  ) : (
                    <span className="text-muted-foreground">Aucune donnée de présence</span>
                  )}
                </div>

                <div className="flex items-center gap-1">
                  <Link
                    href={`/parent/children/${child.id}/schedule`}
                    aria-label={`Emploi du temps de ${child.name}`}
                  >
                    <Button variant="ghost" size="sm" className="h-8 px-2">
                      <Calendar className="h-4 w-4" />
                    </Button>
                  </Link>
                  <Link
                    href={`/parent/homework`}
                    aria-label={`Devoirs de ${child.name}`}
                  >
                    <Button variant="ghost" size="sm" className="h-8 px-2">
                      <BookOpen className="h-4 w-4" />
                    </Button>
                  </Link>
                  <Link
                    href={`/parent/children/${child.id}`}
                    aria-label={`Voir les détails de ${child.name}`}
                  >
                    <Button
                      size="sm"
                      className="h-8 bg-emerald-600 hover:bg-emerald-500 text-white"
                    >
                      Voir détails
                      <ArrowRight className="h-3.5 w-3.5 ml-1" />
                    </Button>
                  </Link>
                </div>
              </div>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
