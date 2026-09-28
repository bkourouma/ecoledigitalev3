"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Badge,
  Button,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Input,
} from "@ecoledigitale/ui";
import {
  BarChart3,
  Users,
  AlertTriangle,
  TrendingUp,
  TrendingDown,
  Calendar,
  Clock,
  Search,
  Download,
  Filter,
  Eye,
} from "lucide-react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  LineChart,
  Line,
  PieChart,
  Pie,
  Cell,
} from "recharts";

// Mock data for admin dashboard
const dashboardData = {
  overview: {
    totalStudents: 1250,
    averageAttendance: 87.3,
    sessionsToday: 24,
    alertsCount: 8,
  },
  classAttendance: [
    { class: "IDA 1A", rate: 92, students: 35, sessions: 5 },
    { class: "IDA 1B", rate: 88, students: 32, sessions: 5 },
    { class: "GC 1A", rate: 85, students: 28, sessions: 4 },
    { class: "GC 1B", rate: 90, students: 30, sessions: 4 },
    { class: "IDA 2A", rate: 83, students: 25, sessions: 6 },
  ],
  weeklyTrend: [
    { day: "Lun", rate: 89 },
    { day: "Mar", rate: 91 },
    { day: "Mer", rate: 85 },
    { day: "Jeu", rate: 88 },
    { day: "Ven", rate: 82 },
    { day: "Sam", rate: 78 },
  ],
  alerts: [
    {
      id: "1",
      type: "consecutive_absences",
      student: "Jean Dupont",
      class: "IDA 1A",
      details: "3 absences consécutives",
      severity: "high",
    },
    {
      id: "2",
      type: "low_attendance",
      student: "Marie Martin",
      class: "GC 1B",
      details: "Taux de présence: 65%",
      severity: "medium",
    },
    {
      id: "3",
      type: "frequent_late",
      student: "Pierre Durand",
      class: "IDA 2A",
      details: "5 retards ce mois",
      severity: "low",
    },
  ],
  recentSessions: [
    {
      id: "1",
      class: "IDA 1A",
      course: "Mathématiques",
      teacher: "Prof. Martin",
      date: "2024-08-19",
      time: "09:00",
      status: "completed",
      attendance: { present: 32, absent: 2, late: 1 },
    },
    {
      id: "2",
      class: "GC 1B",
      course: "Physique",
      teacher: "Prof. Durand",
      date: "2024-08-19",
      time: "10:00",
      status: "in_progress",
      attendance: { present: 28, absent: 1, late: 1 },
    },
  ],
};

const AdminAttendancePage = () => {
  const [selectedPeriod, setSelectedPeriod] = useState("week");
  const [searchTerm, setSearchTerm] = useState("");
  const [alertFilter, setAlertFilter] = useState("all");

  const getSeverityColor = (severity: string) => {
    switch (severity) {
      case "high": return "bg-red-100 text-red-800 border-red-200";
      case "medium": return "bg-yellow-100 text-yellow-800 border-yellow-200";
      case "low": return "bg-blue-100 text-blue-800 border-blue-200";
      default: return "bg-gray-100 text-gray-800 border-gray-200";
    }
  };

  const getAlertIcon = (type: string) => {
    switch (type) {
      case "consecutive_absences": return "🚨";
      case "low_attendance": return "⚠️";
      case "frequent_late": return "⏰";
      default: return "ℹ️";
    }
  };

  const filteredAlerts = dashboardData.alerts.filter(alert => {
    const matchesSearch = alert.student.toLowerCase().includes(searchTerm.toLowerCase()) ||
                         alert.class.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesFilter = alertFilter === "all" || alert.severity === alertFilter;
    return matchesSearch && matchesFilter;
  });

  return (
    <div className="container mx-auto p-6 max-w-7xl">
      {/* Page Header */}
      <motion.div 
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6 }}
        className="mb-8"
      >
        <div className="flex items-center justify-between">
          <div>
            <h1 className="font-bold gradient-text mb-2 whitespace-nowrap text-2xl leading-tight md:text-3xl">
              Tableau de Bord - Présences
            </h1>
            <p className="text-muted-foreground whitespace-nowrap text-sm md:text-base">
              Vue d'ensemble des présences et alertes de l'établissement
            </p>
          </div>
          <div className="flex items-center gap-4">
            <Select value={selectedPeriod} onValueChange={setSelectedPeriod}>
              <SelectTrigger className="w-48">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="week">Cette semaine</SelectItem>
                <SelectItem value="month">Ce mois</SelectItem>
                <SelectItem value="semester">Ce semestre</SelectItem>
              </SelectContent>
            </Select>
            <Button variant="outline">
              <Download className="h-4 w-4 mr-2" />
              Exporter
            </Button>
          </div>
        </div>
      </motion.div>

      {/* Overview Cards */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.2, duration: 0.6 }}
        className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8"
      >
        <Card variant="glass" hover>
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-muted-foreground">Étudiants Total</p>
                <p className="text-2xl font-bold text-blue-600">
                  {dashboardData.overview.totalStudents.toLocaleString()}
                </p>
              </div>
              <div className="p-3 bg-blue-100 rounded-full">
                <Users className="h-6 w-6 text-blue-600" />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card variant="glass" hover>
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-muted-foreground">Taux Moyen</p>
                <p className="text-2xl font-bold text-green-600">
                  {dashboardData.overview.averageAttendance}%
                </p>
              </div>
              <div className="p-3 bg-green-100 rounded-full">
                <TrendingUp className="h-6 w-6 text-green-600" />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card variant="glass" hover>
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-muted-foreground">Sessions Aujourd'hui</p>
                <p className="text-2xl font-bold text-purple-600">
                  {dashboardData.overview.sessionsToday}
                </p>
              </div>
              <div className="p-3 bg-purple-100 rounded-full">
                <Calendar className="h-6 w-6 text-purple-600" />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card variant="glass" hover>
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-muted-foreground">Alertes</p>
                <p className="text-2xl font-bold text-red-600">
                  {dashboardData.overview.alertsCount}
                </p>
              </div>
              <div className="p-3 bg-red-100 rounded-full">
                <AlertTriangle className="h-6 w-6 text-red-600" />
              </div>
            </div>
          </CardContent>
        </Card>
      </motion.div>

      {/* Charts Section */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
        {/* Class Attendance */}
        <motion.div
          initial={{ opacity: 0, x: -20 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ delay: 0.4, duration: 0.6 }}
        >
          <Card variant="glass">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <BarChart3 className="h-5 w-5" />
                Présence par Classe
              </CardTitle>
              <CardDescription>Taux de présence par classe</CardDescription>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={dashboardData.classAttendance}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis 
                    dataKey="class" 
                    stroke="hsl(var(--muted-foreground))"
                    fontSize={12}
                  />
                  <YAxis 
                    stroke="hsl(var(--muted-foreground))"
                    fontSize={12}
                    domain={[0, 100]}
                  />
                  <Tooltip 
                    contentStyle={{
                      backgroundColor: 'hsl(var(--card))',
                      border: '1px solid hsl(var(--border))',
                      borderRadius: '8px',
                    }}
                    formatter={(value) => [`${value}%`, 'Taux de présence']}
                  />
                  <Bar 
                    dataKey="rate" 
                    fill="#3b82f6"
                    radius={[4, 4, 0, 0]}
                  />
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        </motion.div>

        {/* Weekly Trend */}
        <motion.div
          initial={{ opacity: 0, x: 20 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ delay: 0.4, duration: 0.6 }}
        >
          <Card variant="glass">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <TrendingUp className="h-5 w-5" />
                Tendance Hebdomadaire
              </CardTitle>
              <CardDescription>Évolution du taux de présence</CardDescription>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={300}>
                <LineChart data={dashboardData.weeklyTrend}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis 
                    dataKey="day" 
                    stroke="hsl(var(--muted-foreground))"
                    fontSize={12}
                  />
                  <YAxis 
                    stroke="hsl(var(--muted-foreground))"
                    fontSize={12}
                    domain={[70, 100]}
                  />
                  <Tooltip 
                    contentStyle={{
                      backgroundColor: 'hsl(var(--card))',
                      border: '1px solid hsl(var(--border))',
                      borderRadius: '8px',
                    }}
                    formatter={(value) => [`${value}%`, 'Taux de présence']}
                  />
                  <Line 
                    type="monotone" 
                    dataKey="rate" 
                    stroke="#10b981" 
                    strokeWidth={3}
                    dot={{ fill: '#10b981', strokeWidth: 2, r: 4 }}
                  />
                </LineChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        </motion.div>
      </div>

      {/* Alerts Section */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.6, duration: 0.6 }}
        className="mb-8"
      >
        <Card variant="glass">
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="flex items-center gap-2">
                  <AlertTriangle className="h-5 w-5" />
                  Alertes de Présence
                </CardTitle>
                <CardDescription>Étudiants nécessitant une attention particulière</CardDescription>
              </div>
              <div className="flex gap-2">
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground h-4 w-4" />
                  <Input
                    placeholder="Rechercher..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="pl-10 w-64"
                  />
                </div>
                <Select value={alertFilter} onValueChange={setAlertFilter}>
                  <SelectTrigger className="w-32">
                    <Filter className="h-4 w-4 mr-2" />
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Toutes</SelectItem>
                    <SelectItem value="high">Élevée</SelectItem>
                    <SelectItem value="medium">Moyenne</SelectItem>
                    <SelectItem value="low">Faible</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {filteredAlerts.map((alert) => (
                <div key={alert.id} className="flex items-center justify-between p-4 border rounded-lg">
                  <div className="flex items-center gap-4">
                    <div className="text-2xl">{getAlertIcon(alert.type)}</div>
                    <div>
                      <h4 className="font-medium">{alert.student}</h4>
                      <p className="text-sm text-muted-foreground">
                        {alert.class} • {alert.details}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge 
                      variant="outline" 
                      className={getSeverityColor(alert.severity)}
                    >
                      {alert.severity === "high" && "Élevée"}
                      {alert.severity === "medium" && "Moyenne"}
                      {alert.severity === "low" && "Faible"}
                    </Badge>
                    <Button variant="outline" size="sm">
                      <Eye className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </motion.div>

      {/* Recent Sessions */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.8, duration: 0.6 }}
      >
        <Card variant="glass">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Clock className="h-5 w-5" />
              Sessions Récentes
            </CardTitle>
            <CardDescription>Dernières sessions de cours</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {dashboardData.recentSessions.map((session) => (
                <div key={session.id} className="flex items-center justify-between p-4 border rounded-lg">
                  <div className="flex items-center gap-4">
                    <div className="flex flex-col items-center">
                      <span className="text-sm font-medium">
                        {new Date(session.date).toLocaleDateString('fr-FR', { day: '2-digit' })}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {session.time}
                      </span>
                    </div>
                    <div>
                      <h4 className="font-medium">{session.class} - {session.course}</h4>
                      <p className="text-sm text-muted-foreground">{session.teacher}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-4">
                    <div className="text-right text-sm">
                      <p className="font-medium">
                        {session.attendance.present + session.attendance.absent + session.attendance.late} étudiants
                      </p>
                      <p className="text-muted-foreground">
                        {session.attendance.present} présents, {session.attendance.absent} absents
                      </p>
                    </div>
                    <Badge 
                      variant="outline"
                      className={session.status === "completed" ? "bg-green-100 text-green-800" : "bg-blue-100 text-blue-800"}
                    >
                      {session.status === "completed" ? "Terminé" : "En cours"}
                    </Badge>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </motion.div>
    </div>
  );
};

export default AdminAttendancePage;
