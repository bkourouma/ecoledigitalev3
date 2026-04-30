"use client";

import React from 'react';
import { motion } from 'framer-motion';
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
  Cell
} from 'recharts';
import {
  TrendingUp,
  Users,
  BookOpen,
  GraduationCap,
  Calendar,
  Star,
  Award,
  Clock,
  FileText
} from 'lucide-react';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useSession } from 'next-auth/react';

// Sample data for charts
const monthlyData = [
  { name: 'Jan', students: 400, courses: 24, completion: 78 },
  { name: 'Fév', students: 300, courses: 32, completion: 82 },
  { name: 'Mar', students: 500, courses: 28, completion: 85 },
  { name: 'Avr', students: 280, courses: 35, completion: 89 },
  { name: 'Mai', students: 590, courses: 42, completion: 92 },
  { name: 'Jun', students: 320, courses: 38, completion: 88 }
];

const pieData = [
  { name: 'Terminé', value: 65, color: 'rgb(16 185 129)' },
  { name: 'En cours', value: 25, color: 'rgb(59 130 246)' },
  { name: 'Non commencé', value: 10, color: 'rgb(249 115 22)' }
];

const DashboardStats = ({ userRole }: { userRole: string }) => {
  const statsConfig = {
    admin: [
      { title: "Étudiants actifs", value: "1,234", icon: Users, color: "text-blue-500", change: "+12%", trend: "up" },
      { title: "Cours créés", value: "89", icon: BookOpen, color: "text-emerald-500", change: "+5%", trend: "up" },
      { title: "Taux de réussite", value: "94%", icon: TrendingUp, color: "text-orange-500", change: "+3%", trend: "up" },
      { title: "Nouveaux inscrits", value: "156", icon: GraduationCap, color: "text-purple-500", change: "+18%", trend: "up" }
    ],
    student: [
      { title: "Cours suivis", value: "8", icon: BookOpen, color: "text-emerald-500", change: "+2", trend: "up" },
      { title: "Évaluations", value: "5", icon: FileText, color: "text-blue-500", change: "+2", trend: "up" },
      { title: "Progression", value: "76%", icon: TrendingUp, color: "text-orange-500", change: "+8%", trend: "up" },
      { title: "Certifications", value: "3", icon: Award, color: "text-purple-500", change: "+1", trend: "up" }
    ],
    parent: [
      { title: "Cours enfant", value: "6", icon: BookOpen, color: "text-emerald-500", change: "=", trend: "stable" },
      { title: "Moyenne", value: "15.2/20", icon: Star, color: "text-orange-500", change: "+0.5", trend: "up" },
      { title: "Présence", value: "96%", icon: Calendar, color: "text-blue-500", change: "+2%", trend: "up" },
      { title: "Devoirs", value: "18/20", icon: GraduationCap, color: "text-purple-500", change: "+3", trend: "up" }
    ]
  };

  const stats = statsConfig[userRole as keyof typeof statsConfig] || statsConfig.student;

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
      {stats.map((stat, index) => (
        <motion.div
          key={stat.title}
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 * index, duration: 0.6 }}
        >
          <Card variant="glass" hover className="relative overflow-hidden">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                {stat.title}
              </CardTitle>
              <div className={`p-2 rounded-lg bg-role-primary/10`}>
                <stat.icon className={`h-4 w-4 ${stat.color}`} />
              </div>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-role-primary mb-1">{stat.value}</div>
              <div className="flex items-center text-xs">
                <TrendingUp className={`h-3 w-3 mr-1 ${
                  stat.trend === 'up' ? 'text-emerald-500' : 
                  stat.trend === 'down' ? 'text-red-500' : 'text-gray-500'
                }`} />
                <span className={`${
                  stat.trend === 'up' ? 'text-emerald-600' : 
                  stat.trend === 'down' ? 'text-red-600' : 'text-gray-600'
                }`}>
                  {stat.change} ce mois
                </span>
              </div>
            </CardContent>
            
            {/* Animated background gradient */}
            <div className="absolute inset-0 bg-gradient-to-r from-role-primary/5 to-transparent opacity-0 hover:opacity-100 transition-opacity duration-300" />
          </Card>
        </motion.div>
      ))}
    </div>
  );
};

const ChartsSection = ({ userRole }: { userRole: string }) => {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
      {/* Bar Chart */}
      <motion.div
        initial={{ opacity: 0, x: -20 }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ delay: 0.5, duration: 0.6 }}
      >
        <Card variant="glass">
          <CardHeader>
            <CardTitle>Évolution mensuelle</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={monthlyData}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis 
                  dataKey="name" 
                  stroke="hsl(var(--muted-foreground))"
                  fontSize={12}
                />
                <YAxis 
                  stroke="hsl(var(--muted-foreground))"
                  fontSize={12}
                />
                <Tooltip 
                  contentStyle={{
                    backgroundColor: 'hsl(var(--card))',
                    border: '1px solid hsl(var(--border))',
                    borderRadius: '8px'
                  }}
                />
                <Bar 
                  dataKey="students" 
                  fill="rgb(var(--role-primary))" 
                  radius={[4, 4, 0, 0]}
                />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </motion.div>

      {/* Line Chart */}
      <motion.div
        initial={{ opacity: 0, x: 20 }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ delay: 0.6, duration: 0.6 }}
      >
        <Card variant="glass">
          <CardHeader>
            <CardTitle>Taux de complétion</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={300}>
              <LineChart data={monthlyData}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis 
                  dataKey="name" 
                  stroke="hsl(var(--muted-foreground))"
                  fontSize={12}
                />
                <YAxis 
                  stroke="hsl(var(--muted-foreground))"
                  fontSize={12}
                />
                <Tooltip 
                  contentStyle={{
                    backgroundColor: 'hsl(var(--card))',
                    border: '1px solid hsl(var(--border))',
                    borderRadius: '8px'
                  }}
                />
                <Line 
                  type="monotone" 
                  dataKey="completion" 
                  stroke="rgb(var(--role-accent))" 
                  strokeWidth={3}
                  dot={{ fill: "rgb(var(--role-accent))", strokeWidth: 2, r: 4 }}
                />
              </LineChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </motion.div>
    </div>
  );
};

const PieChartSection = () => {
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.7, duration: 0.6 }}
    >
      <Card variant="glass">
        <CardHeader>
          <CardTitle>Répartition des cours</CardTitle>
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
                  borderRadius: '8px'
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
  );
};

export default function DashboardPage() {
  const { data: session } = useSession();
  const userRole = (session as any)?.roles?.[0] || 'student';

  const pageTitle = {
    admin: "Tableau de Bord Administrateur",
    student: "Mon Tableau de Bord",
    parent: "Tableau de Bord Parent"
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
        <h1 className="text-3xl font-bold gradient-text mb-2">
          {pageTitle[userRole as keyof typeof pageTitle]}
        </h1>
        <p className="text-muted-foreground">
          Suivez vos performances et votre progression en temps réel
        </p>
      </motion.div>

      {/* Stats Cards */}
      <DashboardStats userRole={userRole} />

      {/* Charts Section */}
      <ChartsSection userRole={userRole} />

      {/* Pie Chart */}
      <PieChartSection />
    </div>
  );
}
