"use client";

import Link from "next/link";
import { Card, CardContent, CardDescription, CardHeader, CardTitle, Button } from "@ecoledigitale/ui";
import {
  BookOpen,
  GraduationCap,
  Users,
  Calendar,
  Plus,
  TrendingUp,
  Clock,
  CheckCircle,
  FileText
} from "lucide-react";
import { useCycles } from "@/lib/hooks/use-cycles";

const quickActions = [
  {
    title: "Nouveau cycle",
    description: "Créer un nouveau cycle de formation",
    href: "/academic/cycles",
    icon: GraduationCap,
    color: "bg-blue-500",
  },
  {
    title: "Nouveau programme",
    description: "Ajouter un programme à un cycle",
    href: "/academic/programmes",
    icon: BookOpen,
    color: "bg-green-500",
  },
  {
    title: "Nouveau cours",
    description: "Créer un nouveau cours",
    href: "/academic/courses",
    icon: Calendar,
    color: "bg-purple-500",
  },
  {
    title: "Nouvel enseignant",
    description: "Ajouter un enseignant ou vacataire",
    href: "/academic/teachers",
    icon: Users,
    color: "bg-orange-500",
  },
  {
    title: "Nouvelle évaluation",
    description: "Créer une évaluation ou un devoir",
    href: "/academic/evaluations",
    icon: FileText,
    color: "bg-red-500",
  },
];

const stats = [
  {
    title: "Cycles actifs",
    value: "12",
    change: "+2",
    changeType: "positive" as const,
    icon: GraduationCap,
    gradient: "bg-gradient-to-br from-blue-500 via-blue-600 to-cyan-600",
    iconBg: "bg-white/20",
  },
  {
    title: "Programmes",
    value: "45",
    change: "+5",
    changeType: "positive" as const,
    icon: BookOpen,
    gradient: "bg-gradient-to-br from-emerald-500 via-green-600 to-teal-600",
    iconBg: "bg-white/20",
  },
  {
    title: "Cours",
    value: "234",
    change: "+12",
    changeType: "positive" as const,
    icon: Calendar,
    gradient: "bg-gradient-to-br from-purple-500 via-violet-600 to-indigo-600",
    iconBg: "bg-white/20",
  },
  {
    title: "Enseignants",
    value: "67",
    change: "+3",
    changeType: "positive" as const,
    icon: Users,
    gradient: "bg-gradient-to-br from-orange-500 via-red-500 to-pink-600",
    iconBg: "bg-white/20",
  },
];

export default function AcademicDashboard() {
  const { data: cyclesData, isLoading } = useCycles({ limit: 5 });
  const recentCycles = cyclesData?.data || [];

  return (
    <div className="space-y-8 max-w-7xl mx-auto">
      {/* Welcome Section */}
      <div className="bg-gradient-to-r from-blue-600 via-purple-600 to-indigo-600 rounded-xl p-8 text-white shadow-xl">
        <h2 className="text-3xl font-bold mb-3">Bienvenue dans la gestion académique</h2>
        <p className="text-blue-100 mb-6 text-lg">
          Gérez efficacement vos cycles, programmes, cours et enseignants depuis cette interface centralisée.
        </p>
        <div className="flex gap-4">
          <Button variant="secondary" asChild className="bg-white/20 hover:bg-white/30 text-white border-white/30">
            <Link href="/academic/cycles">
              <Plus className="h-4 w-4 mr-2" />
              Commencer
            </Link>
          </Button>
        </div>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        {stats.map((stat) => (
          <div
            key={stat.title}
            className={`${stat.gradient} p-6 rounded-xl text-white shadow-lg hover:shadow-xl transition-all duration-300 transform hover:scale-105`}
          >
            <div className="flex items-center justify-between">
              <div>
                <p className="text-white/80 text-sm font-medium">
                  {stat.title}
                </p>
                <p className="text-3xl font-bold mt-1">{stat.value}</p>
                <p className="text-xs text-white/70 mt-1">
                  <span className="text-white font-semibold">
                    {stat.change}
                  </span>
                  {' '}ce mois
                </p>
              </div>
              <div className={`${stat.iconBg} p-3 rounded-lg`}>
                <stat.icon className="h-6 w-6 text-white" />
              </div>
            </div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        {/* Quick Actions */}
        <Card className="shadow-lg border-0 bg-gradient-to-br from-gray-50 to-white">
          <CardHeader className="pb-4">
            <CardTitle className="flex items-center gap-2 text-xl">
              <TrendingUp className="h-6 w-6 text-blue-600" />
              Actions rapides
            </CardTitle>
            <CardDescription className="text-base">
              Accès rapide aux fonctionnalités principales
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {quickActions.map((action) => (
              <Link
                key={action.title}
                href={action.href}
                className="flex items-center gap-4 p-4 rounded-xl border border-gray-200 hover:border-gray-300 hover:bg-gray-50 transition-all duration-200 hover:shadow-md"
              >
                <div className={`h-12 w-12 ${action.color} rounded-xl flex items-center justify-center shadow-lg`}>
                  <action.icon className="h-6 w-6 text-white" />
                </div>
                <div>
                  <p className="font-semibold text-gray-900">{action.title}</p>
                  <p className="text-sm text-gray-600">{action.description}</p>
                </div>
              </Link>
            ))}
          </CardContent>
        </Card>

        {/* Recent Cycles */}
        <Card className="shadow-lg border-0 bg-gradient-to-br from-gray-50 to-white">
          <CardHeader className="pb-4">
            <CardTitle className="flex items-center gap-2 text-xl">
              <Clock className="h-6 w-6 text-purple-600" />
              Cycles récents
            </CardTitle>
            <CardDescription className="text-base">
              Derniers cycles créés ou modifiés
            </CardDescription>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="space-y-4">
                {[...Array(3)].map((_, i) => (
                  <div key={i} className="animate-pulse p-4 rounded-xl border border-gray-200">
                    <div className="h-5 bg-gradient-to-r from-gray-200 to-gray-100 rounded w-3/4 mb-2"></div>
                    <div className="h-4 bg-gradient-to-r from-gray-200 to-gray-100 rounded w-1/2"></div>
                  </div>
                ))}
              </div>
            ) : recentCycles.length > 0 ? (
              <div className="space-y-4">
                {recentCycles.map((cycle) => (
                  <Link
                    key={cycle.id}
                    href={`/academic/cycles`}
                    className="flex items-center justify-between p-4 rounded-xl border border-gray-200 hover:border-gray-300 hover:bg-gray-50 transition-all duration-200 hover:shadow-md"
                  >
                    <div>
                      <p className="font-semibold text-gray-900">{cycle.name}</p>
                      <p className="text-sm text-gray-600 mt-1">
                        {cycle.code} • {cycle.type}
                      </p>
                    </div>
                    <div className="flex items-center gap-3">
                      {cycle.status === 'active' && (
                        <div className="flex items-center gap-1">
                          <CheckCircle className="h-4 w-4 text-green-500" />
                          <span className="text-xs text-green-600 font-medium">Actif</span>
                        </div>
                      )}
                      <span className="text-xs text-gray-500 bg-gray-100 px-2 py-1 rounded-full">
                        {new Date(cycle.updatedAt).toLocaleDateString('fr-FR')}
                      </span>
                    </div>
                  </Link>
                ))}
                <Link
                  href="/academic/cycles"
                  className="block text-center text-sm text-purple-600 hover:text-purple-700 hover:underline pt-4 font-medium"
                >
                  Voir tous les cycles →
                </Link>
              </div>
            ) : (
              <div className="text-center py-12">
                <div className="bg-gradient-to-br from-purple-100 to-blue-100 rounded-full w-20 h-20 flex items-center justify-center mx-auto mb-4">
                  <GraduationCap className="h-10 w-10 text-purple-600" />
                </div>
                <p className="text-lg font-medium text-gray-900 mb-2">
                  Aucun cycle créé pour le moment
                </p>
                <p className="text-gray-600 mb-6">
                  Commencez par créer votre premier cycle de formation
                </p>
                <Button variant="default" className="bg-purple-600 hover:bg-purple-700" asChild>
                  <Link href="/academic/cycles">
                    <Plus className="h-4 w-4 mr-2" />
                    Créer le premier cycle
                  </Link>
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
