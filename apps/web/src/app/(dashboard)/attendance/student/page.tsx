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
} from "@ecoledigitale/ui";
import {
  Calendar,
  Clock,
  TrendingUp,
  TrendingDown,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  User,
  BarChart3,
  CalendarDays,
} from "lucide-react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  LineChart,
  Line,
} from "recharts";

// Mock data - in real app, this would come from API
const attendanceData = {
  summary: {
    totalSessions: 45,
    presentCount: 38,
    absentCount: 4,
    lateCount: 2,
    excusedCount: 1,
    attendancePercentage: 84.4,
    consecutiveAbsences: 0,
  },
  recentSessions: [
    {
      id: "1",
      date: "2024-08-19",
      time: "09:00",
      course: "Mathématiques",
      teacher: "Prof. Martin",
      status: "present",
      location: "Salle A101",
    },
    {
      id: "2",
      date: "2024-08-18",
      time: "14:00",
      course: "Physique",
      teacher: "Prof. Durand",
      status: "late",
      location: "Laboratoire",
      arrivalTime: "14:15",
    },
    {
      id: "3",
      date: "2024-08-17",
      time: "10:00",
      course: "Chimie",
      teacher: "Prof. Bernard",
      status: "present",
      location: "Salle B203",
    },
    {
      id: "4",
      date: "2024-08-16",
      time: "08:00",
      course: "Anglais",
      teacher: "Prof. Smith",
      status: "absent",
      location: "Salle C105",
    },
  ],
  monthlyTrend: [
    { month: "Jan", rate: 92 },
    { month: "Fév", rate: 88 },
    { month: "Mar", rate: 85 },
    { month: "Avr", rate: 90 },
    { month: "Mai", rate: 87 },
    { month: "Jun", rate: 84 },
  ],
  weeklyPattern: [
    { day: "Lun", rate: 95 },
    { day: "Mar", rate: 88 },
    { day: "Mer", rate: 82 },
    { day: "Jeu", rate: 90 },
    { day: "Ven", rate: 78 },
  ],
};

const pieData = [
  { name: "Présent", value: attendanceData.summary.presentCount, color: "#10b981" },
  { name: "Absent", value: attendanceData.summary.absentCount, color: "#ef4444" },
  { name: "Retard", value: attendanceData.summary.lateCount, color: "#f59e0b" },
  { name: "Excusé", value: attendanceData.summary.excusedCount, color: "#3b82f6" },
];

const StudentAttendancePage = () => {
  const [selectedPeriod, setSelectedPeriod] = useState("current");

  const getStatusColor = (status: string) => {
    switch (status) {
      case "present": return "bg-green-100 text-green-800 border-green-200";
      case "absent": return "bg-red-100 text-red-800 border-red-200";
      case "late": return "bg-yellow-100 text-yellow-800 border-yellow-200";
      case "excused": return "bg-blue-100 text-blue-800 border-blue-200";
      default: return "bg-gray-100 text-gray-800 border-gray-200";
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case "present": return <CheckCircle2 className="h-4 w-4" />;
      case "absent": return <XCircle className="h-4 w-4" />;
      case "late": return <AlertTriangle className="h-4 w-4" />;
      case "excused": return <CheckCircle2 className="h-4 w-4" />;
      default: return <AlertTriangle className="h-4 w-4" />;
    }
  };

  const getStatusLabel = (status: string) => {
    switch (status) {
      case "present": return "Présent";
      case "absent": return "Absent";
      case "late": return "Retard";
      case "excused": return "Excusé";
      default: return status;
    }
  };

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
              Mon Suivi de Présence
            </h1>
            <p className="text-muted-foreground whitespace-nowrap text-sm md:text-base">
              Consultez votre historique de présence et vos statistiques
            </p>
          </div>
          <div className="flex items-center gap-4">
            <Select value={selectedPeriod} onValueChange={setSelectedPeriod}>
              <SelectTrigger className="w-48">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="current">Période actuelle</SelectItem>
                <SelectItem value="semester">Ce semestre</SelectItem>
                <SelectItem value="year">Cette année</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
      </motion.div>

      {/* Summary Cards */}
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
                <p className="text-sm font-medium text-muted-foreground">Taux de Présence</p>
                <p className="text-2xl font-bold text-green-600">
                  {attendanceData.summary.attendancePercentage}%
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
                <p className="text-sm font-medium text-muted-foreground">Sessions Totales</p>
                <p className="text-2xl font-bold text-blue-600">
                  {attendanceData.summary.totalSessions}
                </p>
              </div>
              <div className="p-3 bg-blue-100 rounded-full">
                <Calendar className="h-6 w-6 text-blue-600" />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card variant="glass" hover>
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-muted-foreground">Présences</p>
                <p className="text-2xl font-bold text-green-600">
                  {attendanceData.summary.presentCount}
                </p>
              </div>
              <div className="p-3 bg-green-100 rounded-full">
                <CheckCircle2 className="h-6 w-6 text-green-600" />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card variant="glass" hover>
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-muted-foreground">Absences</p>
                <p className="text-2xl font-bold text-red-600">
                  {attendanceData.summary.absentCount}
                </p>
              </div>
              <div className="p-3 bg-red-100 rounded-full">
                <XCircle className="h-6 w-6 text-red-600" />
              </div>
            </div>
          </CardContent>
        </Card>
      </motion.div>

      {/* Charts Section */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
        {/* Monthly Trend */}
        <motion.div
          initial={{ opacity: 0, x: -20 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ delay: 0.4, duration: 0.6 }}
        >
          <Card variant="glass">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <BarChart3 className="h-5 w-5" />
                Évolution Mensuelle
              </CardTitle>
              <CardDescription>Taux de présence par mois</CardDescription>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={300}>
                <LineChart data={attendanceData.monthlyTrend}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis 
                    dataKey="month" 
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
                  <Line 
                    type="monotone" 
                    dataKey="rate" 
                    stroke="#3b82f6" 
                    strokeWidth={3}
                    dot={{ fill: '#3b82f6', strokeWidth: 2, r: 4 }}
                  />
                </LineChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        </motion.div>

        {/* Attendance Distribution */}
        <motion.div
          initial={{ opacity: 0, x: 20 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ delay: 0.4, duration: 0.6 }}
        >
          <Card variant="glass">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <User className="h-5 w-5" />
                Répartition des Présences
              </CardTitle>
              <CardDescription>Distribution par statut</CardDescription>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={300}>
                <PieChart>
                  <Pie
                    data={pieData}
                    cx="50%"
                    cy="50%"
                    innerRadius={60}
                    outerRadius={100}
                    paddingAngle={5}
                    dataKey="value"
                  >
                    {pieData.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={entry.color} />
                    ))}
                  </Pie>
                  <Tooltip 
                    contentStyle={{
                      backgroundColor: 'hsl(var(--card))',
                      border: '1px solid hsl(var(--border))',
                      borderRadius: '8px',
                    }}
                  />
                </PieChart>
              </ResponsiveContainer>
              <div className="flex justify-center space-x-4 mt-4">
                {pieData.map((item, index) => (
                  <div key={index} className="flex items-center space-x-2">
                    <div 
                      className="w-3 h-3 rounded-full" 
                      style={{ backgroundColor: item.color }}
                    />
                    <span className="text-sm text-muted-foreground">{item.name}</span>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </motion.div>
      </div>

      {/* Recent Sessions */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.6, duration: 0.6 }}
      >
        <Card variant="glass">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <CalendarDays className="h-5 w-5" />
              Sessions Récentes
            </CardTitle>
            <CardDescription>Historique de vos dernières sessions de cours</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {attendanceData.recentSessions.map((session) => (
                <div key={session.id} className="flex items-center justify-between p-4 border rounded-lg">
                  <div className="flex items-center gap-4">
                    <div className="flex flex-col items-center">
                      <span className="text-sm font-medium">
                        {new Date(session.date).toLocaleDateString('fr-FR', { day: '2-digit' })}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {new Date(session.date).toLocaleDateString('fr-FR', { month: 'short' })}
                      </span>
                    </div>
                    <div className="flex-1">
                      <h4 className="font-medium">{session.course}</h4>
                      <p className="text-sm text-muted-foreground">
                        {session.teacher} • {session.time} • {session.location}
                      </p>
                      {session.arrivalTime && (
                        <p className="text-xs text-yellow-600">
                          Arrivé à {session.arrivalTime}
                        </p>
                      )}
                    </div>
                  </div>
                  <Badge 
                    variant="outline" 
                    className={`${getStatusColor(session.status)} flex items-center gap-1`}
                  >
                    {getStatusIcon(session.status)}
                    {getStatusLabel(session.status)}
                  </Badge>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </motion.div>
    </div>
  );
};

export default StudentAttendancePage;
