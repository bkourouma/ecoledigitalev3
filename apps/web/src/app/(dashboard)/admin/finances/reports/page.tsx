"use client";

import { motion } from "framer-motion";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Button,
} from "@ecoledigitale/ui";
import {
  FileText,
  Download,
  TrendingUp,
  Users,
  DollarSign,
  Calendar,
} from "lucide-react";
import Link from "next/link";

export default function FinancialReportsPage() {
  const reportTypes = [
    {
      title: "Rapport de Revenus",
      description: "Analyse détaillée des revenus par type de frais",
      icon: DollarSign,
      href: "/admin/finances/reports/revenue",
      color: "bg-green-100 text-green-600",
    },
    {
      title: "Rapport par Étudiant",
      description: "État des paiements de chaque étudiant",
      icon: Users,
      href: "/admin/finances/reports/students",
      color: "bg-blue-100 text-blue-600",
    },
    {
      title: "Rapport par Classe",
      description: "Performance de paiement par classe",
      icon: TrendingUp,
      href: "/admin/finances/reports/classes",
      color: "bg-purple-100 text-purple-600",
    },
    {
      title: "Rapport Mensuel",
      description: "Évolution des paiements par mois",
      icon: Calendar,
      href: "/admin/finances/reports/monthly",
      color: "bg-orange-100 text-orange-600",
    },
  ];

  return (
    <div className="container mx-auto px-4 py-8 space-y-8">
      {/* Header */}
      <motion.div
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6 }}
        className="mb-6 flex max-w-full flex-col items-start gap-2 overflow-x-auto md:gap-3"
      >
        <div>
          <h1 className="font-bold text-white whitespace-nowrap text-2xl leading-tight md:text-3xl">Rapports Financiers</h1>
          <p className="text-gray-600 whitespace-nowrap text-sm md:text-base">
            Générez et consultez des rapports détaillés sur les finances étudiantes
          </p>
        </div>
        <div className="flex gap-3">
          <Button variant="outline" size="sm">
            <Download className="h-4 w-4 mr-2" />
            Exporter Tout
          </Button>
          <Link href="/admin/finances">
            <Button size="sm">
              Retour au Tableau de Bord
            </Button>
          </Link>
        </div>
      </motion.div>

      {/* Report Types Grid */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.2, duration: 0.6 }}
        className="grid grid-cols-1 md:grid-cols-2 gap-6"
      >
        {reportTypes.map((report, index) => (
          <motion.div
            key={report.title}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.3 + index * 0.1, duration: 0.5 }}
          >
            <Card className="hover:shadow-lg transition-shadow cursor-pointer">
              <CardHeader>
                <div className="flex items-center gap-4">
                  <div className={`p-3 rounded-full ${report.color}`}>
                    <report.icon className="h-6 w-6" />
                  </div>
                  <div>
                    <CardTitle className="text-lg">{report.title}</CardTitle>
                    <CardDescription>{report.description}</CardDescription>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <div className="flex justify-between items-center">
                  <p className="text-sm text-gray-600">
                    Cliquez pour générer le rapport
                  </p>
                  <Link href={report.href}>
                    <Button size="sm" variant="outline">
                      <FileText className="h-4 w-4 mr-2" />
                      Générer
                    </Button>
                  </Link>
                </div>
              </CardContent>
            </Card>
          </motion.div>
        ))}
      </motion.div>

      {/* Quick Actions */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.6, duration: 0.6 }}
      >
        <Card>
          <CardHeader>
            <CardTitle>Actions Rapides</CardTitle>
            <CardDescription>
              Accès rapide aux fonctionnalités les plus utilisées
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <Link href="/admin/finances">
                <Button variant="outline" className="w-full">
                  <TrendingUp className="h-4 w-4 mr-2" />
                  Tableau de Bord
                </Button>
              </Link>
              <Link href="/admin/finances/tuition-schedules">
                <Button variant="outline" className="w-full">
                  <Calendar className="h-4 w-4 mr-2" />
                  Échéanciers
                </Button>
              </Link>
              <Button variant="outline" className="w-full">
                <Download className="h-4 w-4 mr-2" />
                Export Global
              </Button>
            </div>
          </CardContent>
        </Card>
      </motion.div>
    </div>
  );
}
