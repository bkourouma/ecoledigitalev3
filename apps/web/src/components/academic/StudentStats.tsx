"use client";

import { useMemo } from "react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@ecoledigitale/ui";
import { 
  Users, 
  GraduationCap, 
  UserCheck, 
  UserX, 
  TrendingUp,
  Calendar,
  BookOpen,
  AlertTriangle
} from "lucide-react";
import { StudentWithUser, StudentStatus } from "@ecoledigitale/contracts";

interface StudentStatsProps {
  students: StudentWithUser[];
  isLoading?: boolean;
}

interface StatCard {
  title: string;
  value: string | number;
  description: string;
  icon: any;
  color: string;
  bgColor: string;
}

export function StudentStats({ students, isLoading }: StudentStatsProps) {
  const stats = useMemo(() => {
    if (!students || students.length === 0) {
      return {
        total: 0,
        byStatus: {},
        byYear: {},
        recentlyAdded: 0,
      };
    }

    // Calculate status distribution
    const byStatus = students.reduce((acc, student) => {
      acc[student.status] = (acc[student.status] || 0) + 1;
      return acc;
    }, {} as Record<StudentStatus, number>);

    // Calculate year distribution
    const byYear = students.reduce((acc, student) => {
      const year = student.currentYear;
      acc[year] = (acc[year] || 0) + 1;
      return acc;
    }, {} as Record<number, number>);

    // Calculate recently added (last 30 days)
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    
    const recentlyAdded = students.filter(student => {
      const createdAt = new Date(student.createdAt);
      return createdAt >= thirtyDaysAgo;
    }).length;

    return {
      total: students.length,
      byStatus,
      byYear,
      recentlyAdded,
    };
  }, [students]);

  const statCards: StatCard[] = [
    {
      title: "Total Étudiants",
      value: stats.total,
      description: "Nombre total d'étudiants inscrits",
      icon: Users,
      color: "text-white",
      bgColor: "bg-gradient-to-br from-blue-500 via-blue-600 to-blue-700",
    },
    {
      title: "Étudiants Actifs",
      value: stats.byStatus.active || 0,
      description: "Étudiants actuellement actifs",
      icon: UserCheck,
      color: "text-white",
      bgColor: "bg-gradient-to-br from-emerald-500 via-green-600 to-teal-700",
    },
    {
      title: "Diplômés",
      value: stats.byStatus.graduated || 0,
      description: "Étudiants ayant obtenu leur diplôme",
      icon: GraduationCap,
      color: "text-white",
      bgColor: "bg-gradient-to-br from-purple-500 via-violet-600 to-indigo-700",
    },
    {
      title: "Nouveaux (30j)",
      value: stats.recentlyAdded,
      description: "Étudiants ajoutés ce mois",
      icon: TrendingUp,
      color: "text-white",
      bgColor: "bg-gradient-to-br from-orange-500 via-amber-600 to-yellow-600",
    },
  ];

  // Additional stats for problematic cases
  const problemStats = [
    {
      title: "Suspendus",
      value: stats.byStatus.suspended || 0,
      description: "Étudiants suspendus",
      icon: AlertTriangle,
      color: "text-white",
      bgColor: "bg-gradient-to-br from-red-500 via-rose-600 to-pink-700",
    },
    {
      title: "Abandons",
      value: stats.byStatus.dropped || 0,
      description: "Étudiants ayant abandonné",
      icon: UserX,
      color: "text-white",
      bgColor: "bg-gradient-to-br from-slate-500 via-gray-600 to-zinc-700",
    },
  ];

  // Year distribution stats with colorful gradients
  const yearColors = [
    "bg-gradient-to-br from-cyan-500 via-teal-600 to-blue-700",
    "bg-gradient-to-br from-pink-500 via-rose-600 to-red-700",
    "bg-gradient-to-br from-violet-500 via-purple-600 to-indigo-700",
    "bg-gradient-to-br from-lime-500 via-green-600 to-emerald-700",
    "bg-gradient-to-br from-amber-500 via-orange-600 to-red-700",
  ];

  const yearStats = Object.entries(stats.byYear)
    .sort(([a], [b]) => parseInt(a) - parseInt(b))
    .map(([year, count], index) => ({
      title: `Année ${year}`,
      value: count,
      description: `Étudiants en ${year}${parseInt(year) === 1 ? 'ère' : 'ème'} année`,
      icon: BookOpen,
      color: "text-white",
      bgColor: yearColors[index % yearColors.length],
    }));

  if (isLoading) {
    const loadingGradients = [
      "bg-gradient-to-br from-blue-400 to-blue-600",
      "bg-gradient-to-br from-green-400 to-green-600",
      "bg-gradient-to-br from-purple-400 to-purple-600",
      "bg-gradient-to-br from-orange-400 to-orange-600",
    ];

    return (
      <div className="space-y-6 mb-6">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          {[...Array(4)].map((_, i) => (
            <Card key={i} className="overflow-hidden border-0 shadow-lg">
              <CardContent className="p-0">
                <div className={`${loadingGradients[i]} p-6 animate-pulse`}>
                  <div className="flex items-center justify-between mb-4">
                    <div className="p-3 rounded-xl bg-white/20 w-12 h-12"></div>
                    <div className="w-16 h-8 bg-white/20 rounded"></div>
                  </div>
                  <div className="space-y-2">
                    <div className="h-4 bg-white/20 rounded w-3/4"></div>
                    <div className="h-3 bg-white/20 rounded w-full"></div>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
          {[...Array(6)].map((_, i) => (
            <Card key={`loading-${i}`} className="overflow-hidden border-0 shadow-md">
              <CardContent className="p-0">
                <div className="bg-gradient-to-br from-gray-400 to-gray-600 p-4 animate-pulse">
                  <div className="flex items-center space-x-3">
                    <div className="p-2 rounded-lg bg-white/20 w-8 h-8"></div>
                    <div className="space-y-1">
                      <div className="h-3 bg-white/20 rounded w-16"></div>
                      <div className="h-4 bg-white/20 rounded w-12"></div>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 mb-6">
      {/* Main Stats */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        {statCards.map((stat, index) => {
          const Icon = stat.icon;
          return (
            <Card key={index} className="overflow-hidden border-0 shadow-lg hover:shadow-xl transition-all duration-300 hover:scale-105">
              <CardContent className="p-0">
                <div className={`${stat.bgColor} p-6 text-white relative overflow-hidden`}>
                  {/* Background decoration */}
                  <div className="absolute top-0 right-0 -mt-4 -mr-4 w-20 h-20 rounded-full bg-white/10"></div>
                  <div className="absolute bottom-0 left-0 -mb-6 -ml-6 w-16 h-16 rounded-full bg-white/5"></div>

                  <div className="relative z-10">
                    <div className="flex items-center justify-between mb-4">
                      <div className="p-3 rounded-xl bg-white/20 backdrop-blur-sm">
                        <Icon className="h-6 w-6 text-white" />
                      </div>
                      <div className="text-right">
                        <p className="text-3xl font-bold text-white drop-shadow-sm">
                          {stat.value}
                        </p>
                      </div>
                    </div>
                    <div>
                      <p className="text-lg font-semibold text-white/95 mb-1">
                        {stat.title}
                      </p>
                      <p className="text-sm text-white/80">
                        {stat.description}
                      </p>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Secondary Stats Row */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
        {/* Problem Stats */}
        {problemStats.map((stat, index) => {
          const Icon = stat.icon;
          return (
            <Card key={`problem-${index}`} className="overflow-hidden border-0 shadow-md hover:shadow-lg transition-all duration-300 hover:scale-105">
              <CardContent className="p-0">
                <div className={`${stat.bgColor} p-4 text-white relative`}>
                  {/* Background decoration */}
                  <div className="absolute top-0 right-0 -mt-2 -mr-2 w-12 h-12 rounded-full bg-white/10"></div>

                  <div className="relative z-10">
                    <div className="flex items-center space-x-3">
                      <div className="p-2 rounded-lg bg-white/20 backdrop-blur-sm">
                        <Icon className="h-4 w-4 text-white" />
                      </div>
                      <div>
                        <p className="text-sm font-medium text-white/90">{stat.title}</p>
                        <p className="text-xl font-bold text-white">{stat.value}</p>
                      </div>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          );
        })}

        {/* Year Distribution Stats */}
        {yearStats.slice(0, 4).map((stat, index) => {
          const Icon = stat.icon;
          return (
            <Card key={`year-${index}`} className="overflow-hidden border-0 shadow-md hover:shadow-lg transition-all duration-300 hover:scale-105">
              <CardContent className="p-0">
                <div className={`${stat.bgColor} p-4 text-white relative`}>
                  {/* Background decoration */}
                  <div className="absolute top-0 right-0 -mt-2 -mr-2 w-12 h-12 rounded-full bg-white/10"></div>

                  <div className="relative z-10">
                    <div className="flex items-center space-x-3">
                      <div className="p-2 rounded-lg bg-white/20 backdrop-blur-sm">
                        <Icon className="h-4 w-4 text-white" />
                      </div>
                      <div>
                        <p className="text-sm font-medium text-white/90">{stat.title}</p>
                        <p className="text-xl font-bold text-white">{stat.value}</p>
                      </div>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
