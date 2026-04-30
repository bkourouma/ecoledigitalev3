"use client";

import React from 'react';
import { motion } from 'framer-motion';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Progress,
  Badge,
} from '@ecoledigitale/ui';
import {
  Calendar as CalendarIcon,
  Clock,
  BookOpen,
  TrendingUp,
  CheckCircle2,
  XCircle,
  AlertTriangle,
} from 'lucide-react';

interface ScheduleStats {
  total_sessions: number;
  total_courses: number;
  total_hours: number;
  first_session: string;
  last_session: string;
  completed_sessions: number;
  cancelled_sessions: number;
}

interface StatsCardsProps {
  stats: ScheduleStats;
}

export function StatsCards({ stats }: StatsCardsProps) {
  const getCompletionRate = (): number => {
    if (stats.total_sessions === 0) return 0;
    return Math.round((stats.completed_sessions / stats.total_sessions) * 100);
  };

  const getCancellationRate = (): number => {
    if (stats.total_sessions === 0) return 0;
    return Math.round((stats.cancelled_sessions / stats.total_sessions) * 100);
  };

  const getScheduledSessions = (): number => {
    return stats.total_sessions - stats.completed_sessions - stats.cancelled_sessions;
  };

  const formatDate = (dateString: string): string => {
    if (!dateString) return "Non défini";
    return new Date(dateString).toLocaleDateString('fr-FR', {
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    });
  };

  const getWeeksDuration = (): number => {
    if (!stats.first_session || !stats.last_session) return 0;
    const start = new Date(stats.first_session);
    const end = new Date(stats.last_session);
    return Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24 * 7));
  };

  const cardVariants = {
    hidden: { opacity: 0, y: 20 },
    visible: (i: number) => ({
      opacity: 1,
      y: 0,
      transition: {
        delay: i * 0.1,
        duration: 0.5,
      },
    }),
  };

  return (
    <div className="space-y-6">
      {/* Overview Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <motion.div
          custom={0}
          initial="hidden"
          animate="visible"
          variants={cardVariants}
        >
          <Card className="bg-card border-border">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium text-foreground">Total Sessions</CardTitle>
              <CalendarIcon className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-foreground">{stats.total_sessions}</div>
              <p className="text-xs text-muted-foreground">
                Sessions programmées
              </p>
            </CardContent>
          </Card>
        </motion.div>

        <motion.div
          custom={1}
          initial="hidden"
          animate="visible"
          variants={cardVariants}
        >
          <Card className="bg-card border-border">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium text-foreground">Total Cours</CardTitle>
              <BookOpen className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-foreground">{stats.total_courses}</div>
              <p className="text-xs text-muted-foreground">
                Matières différentes
              </p>
            </CardContent>
          </Card>
        </motion.div>

        <motion.div
          custom={2}
          initial="hidden"
          animate="visible"
          variants={cardVariants}
        >
          <Card className="bg-card border-border">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium text-foreground">Total Heures</CardTitle>
              <Clock className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-foreground">{Math.round(stats.total_hours)}</div>
              <p className="text-xs text-muted-foreground">
                Heures de cours
              </p>
            </CardContent>
          </Card>
        </motion.div>

        <motion.div
          custom={3}
          initial="hidden"
          animate="visible"
          variants={cardVariants}
        >
          <Card className="bg-card border-border">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium text-foreground">Taux de Réalisation</CardTitle>
              <TrendingUp className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-foreground">{getCompletionRate()}%</div>
              <Progress value={getCompletionRate()} className="mt-2" />
            </CardContent>
          </Card>
        </motion.div>
      </div>

      {/* Detailed Cards */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <motion.div
          custom={4}
          initial="hidden"
          animate="visible"
          variants={cardVariants}
        >
          <Card className="bg-card border-border">
            <CardHeader>
              <CardTitle className="flex items-center text-foreground">
                <CalendarIcon className="h-5 w-5 mr-2 text-foreground" />
                Période Académique
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex justify-between items-center">
                <span className="text-sm font-medium text-foreground">Début:</span>
                <span className="text-sm text-muted-foreground">{formatDate(stats.first_session)}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-sm font-medium text-foreground">Fin:</span>
                <span className="text-sm text-muted-foreground">{formatDate(stats.last_session)}</span>
              </div>
              <div className="border-t border-border pt-4">
                <div className="flex justify-between items-center">
                  <span className="text-sm font-medium text-foreground">Durée:</span>
                  <span className="text-sm text-muted-foreground">
                    {getWeeksDuration()} semaine{getWeeksDuration() > 1 ? 's' : ''}
                  </span>
                </div>
              </div>
            </CardContent>
          </Card>
        </motion.div>

        <motion.div
          custom={5}
          initial="hidden"
          animate="visible"
          variants={cardVariants}
        >
          <Card className="bg-card border-border">
            <CardHeader>
              <CardTitle className="flex items-center text-foreground">
                <TrendingUp className="h-5 w-5 mr-2 text-foreground" />
                État des Sessions
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex justify-between items-center">
                <div className="flex items-center space-x-2">
                  <CheckCircle2 className="h-4 w-4 text-primary" />
                  <span className="text-sm text-foreground">Terminées</span>
                </div>
                <Badge variant="success">{stats.completed_sessions}</Badge>
              </div>
              <div className="flex justify-between items-center">
                <div className="flex items-center space-x-2">
                  <XCircle className="h-4 w-4 text-destructive" />
                  <span className="text-sm text-foreground">Annulées</span>
                </div>
                <Badge variant="destructive">{stats.cancelled_sessions}</Badge>
              </div>
              <div className="flex justify-between items-center">
                <div className="flex items-center space-x-2">
                  <AlertTriangle className="h-4 w-4 text-primary" />
                  <span className="text-sm text-foreground">Programmées</span>
                </div>
                <Badge variant="default">{getScheduledSessions()}</Badge>
              </div>
              {getCancellationRate() > 0 && (
                <div className="border-t border-border pt-4">
                  <div className="flex justify-between items-center text-sm">
                    <span className="text-foreground">Taux d'annulation:</span>
                    <span className="font-medium text-destructive">{getCancellationRate()}%</span>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </motion.div>
      </div>
    </div>
  );
}

export default StatsCards;
