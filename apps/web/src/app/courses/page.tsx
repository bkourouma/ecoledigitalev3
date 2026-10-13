"use client";

import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  BookOpen, 
  Users, 
  Clock, 
  Star,
  Play,
  Search,
  Filter,
  Grid,
  List,
  ChevronDown
} from 'lucide-react';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { useSession } from 'next-auth/react';
import { AntSelect } from "@/platform/ui/FormField";

// Sample course data
const coursesData = [
  {
    id: 1,
    title: "Introduction à React",
    description: "Apprenez les bases de React avec des exemples pratiques",
    instructor: "Marie Dupont",
    students: 124,
    duration: "8 semaines",
    level: "Débutant",
    rating: 4.8,
    category: "Développement",
    image: "/api/placeholder/300/200",
    progress: 65,
    status: "active"
  },
  {
    id: 2,
    title: "Python pour la Data Science",
    description: "Maîtrisez Python pour l'analyse de données",
    instructor: "Pierre Martin",
    students: 89,
    duration: "12 semaines",
    level: "Intermédiaire",
    rating: 4.9,
    category: "Data Science",
    image: "/api/placeholder/300/200",
    progress: 30,
    status: "active"
  },
  {
    id: 3,
    title: "Design UX/UI Moderne",
    description: "Créez des interfaces utilisateur exceptionnelles",
    instructor: "Sophie Leroy",
    students: 156,
    duration: "6 semaines",
    level: "Intermédiaire",
    rating: 4.7,
    category: "Design",
    image: "/api/placeholder/300/200",
    progress: 100,
    status: "completed"
  },
  {
    id: 4,
    title: "Machine Learning Avancé",
    description: "Plongez dans les algorithmes d'apprentissage automatique",
    instructor: "David Chen",
    students: 67,
    duration: "16 semaines",
    level: "Avancé",
    rating: 4.9,
    category: "IA",
    image: "/api/placeholder/300/200",
    progress: 0,
    status: "upcoming"
  },
  {
    id: 5,
    title: "Marketing Digital",
    description: "Stratégies marketing pour l'ère numérique",
    instructor: "Claire Bernard",
    students: 203,
    duration: "10 semaines",
    level: "Débutant",
    rating: 4.6,
    category: "Marketing",
    image: "/api/placeholder/300/200",
    progress: 45,
    status: "active"
  },
  {
    id: 6,
    title: "Cybersécurité Fondamentale",
    description: "Protégez vos systèmes contre les menaces",
    instructor: "Thomas Moreau",
    students: 98,
    duration: "14 semaines",
    level: "Intermédiaire",
    rating: 4.8,
    category: "Sécurité",
    image: "/api/placeholder/300/200",
    progress: 15,
    status: "active"
  }
];

const categories = ["Tous", "Développement", "Data Science", "Design", "IA", "Marketing", "Sécurité"];
const levels = ["Tous", "Débutant", "Intermédiaire", "Avancé"];

const CourseCard = ({ course, viewMode }: { course: any; viewMode: 'grid' | 'list' }) => {
  const getStatusColor = (status: string) => {
    switch (status) {
      case 'active': return 'text-emerald-500 bg-emerald-50 dark:bg-emerald-900/20';
      case 'completed': return 'text-blue-500 bg-blue-50 dark:bg-blue-900/20';
      case 'upcoming': return 'text-orange-500 bg-orange-50 dark:bg-orange-900/20';
      default: return 'text-gray-500 bg-gray-50 dark:bg-gray-900/20';
    }
  };

  const getStatusLabel = (status: string) => {
    switch (status) {
      case 'active': return 'En cours';
      case 'completed': return 'Terminé';
      case 'upcoming': return 'À venir';
      default: return 'Inconnu';
    }
  };

  if (viewMode === 'list') {
    return (
      <motion.div
        layout
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -20 }}
        transition={{ duration: 0.3 }}
      >
        <Card variant="glass" hover className="mb-4">
          <CardContent className="p-6">
            <div className="flex items-center space-x-6">
              <div className="w-24 h-16 bg-role-gradient rounded-lg flex-shrink-0" />
              
              <div className="flex-1 min-w-0">
                <div className="flex items-start justify-between">
                  <div>
                    <h3 className="text-lg font-semibold text-role-primary truncate">{course.title}</h3>
                    <p className="text-sm text-muted-foreground mt-1">{course.description}</p>
                    <div className="flex items-center space-x-4 mt-2 text-xs text-muted-foreground">
                      <span className="flex items-center">
                        <Users className="h-3 w-3 mr-1" />
                        {course.students} étudiants
                      </span>
                      <span className="flex items-center">
                        <Clock className="h-3 w-3 mr-1" />
                        {course.duration}
                      </span>
                      <span className="flex items-center">
                        <Star className="h-3 w-3 mr-1 text-yellow-500" />
                        {course.rating}
                      </span>
                    </div>
                  </div>
                  
                  <div className="flex flex-col items-end space-y-2">
                    <span className={`px-2 py-1 rounded-full text-xs font-medium ${getStatusColor(course.status)}`}>
                      {getStatusLabel(course.status)}
                    </span>
                    <Button size="sm" className="hover-lift">
                      {course.status === 'active' ? 'Continuer' : 
                       course.status === 'completed' ? 'Revoir' : 'Commencer'}
                    </Button>
                  </div>
                </div>
                
                {course.progress > 0 && (
                  <div className="mt-3">
                    <div className="flex justify-between text-xs text-muted-foreground mb-1">
                      <span>Progression</span>
                      <span>{course.progress}%</span>
                    </div>
                    <div className="w-full bg-muted rounded-full h-2">
                      <div 
                        className="bg-role-primary h-2 rounded-full transition-all duration-300"
                        style={{ width: `${course.progress}%` }}
                      />
                    </div>
                  </div>
                )}
              </div>
            </div>
          </CardContent>
        </Card>
      </motion.div>
    );
  }

  return (
    <motion.div
      layout
      initial={{ opacity: 0, scale: 0.9 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.9 }}
      transition={{ duration: 0.3 }}
    >
      <Card variant="glass" hover className="group">
        <div className="relative overflow-hidden">
          <div className="w-full h-48 bg-role-gradient rounded-t-2xl" />
          <div className="absolute top-3 right-3">
            <span className={`px-2 py-1 rounded-full text-xs font-medium ${getStatusColor(course.status)}`}>
              {getStatusLabel(course.status)}
            </span>
          </div>
          <div className="absolute inset-0 bg-black/0 group-hover:bg-black/10 transition-colors duration-300 flex items-center justify-center opacity-0 group-hover:opacity-100">
            <Button size="sm" variant="secondary" className="shadow-lg">
              <Play className="h-4 w-4 mr-2" />
              Voir le cours
            </Button>
          </div>
        </div>
        
        <CardHeader className="pb-3">
          <div className="flex items-start justify-between">
            <div className="flex-1 min-w-0">
              <CardTitle className="text-lg truncate">{course.title}</CardTitle>
              <p className="text-sm text-muted-foreground mt-1 line-clamp-2">
                {course.description}
              </p>
            </div>
          </div>
        </CardHeader>
        
        <CardContent className="pt-0">
          <div className="space-y-3">
            <div className="flex items-center justify-between text-sm text-muted-foreground">
              <span className="flex items-center">
                <Users className="h-4 w-4 mr-1" />
                {course.students}
              </span>
              <span className="flex items-center">
                <Clock className="h-4 w-4 mr-1" />
                {course.duration}
              </span>
              <span className="flex items-center">
                <Star className="h-4 w-4 mr-1 text-yellow-500" />
                {course.rating}
              </span>
            </div>
            
            {course.progress > 0 && (
              <div>
                <div className="flex justify-between text-xs text-muted-foreground mb-1">
                  <span>Progression</span>
                  <span>{course.progress}%</span>
                </div>
                <div className="w-full bg-muted rounded-full h-2">
                  <div 
                    className="bg-role-primary h-2 rounded-full transition-all duration-300"
                    style={{ width: `${course.progress}%` }}
                  />
                </div>
              </div>
            )}
            
            <Button className="w-full hover-lift">
              {course.status === 'active' ? 'Continuer le cours' : 
               course.status === 'completed' ? 'Revoir le cours' : 'Commencer'}
            </Button>
          </div>
        </CardContent>
      </Card>
    </motion.div>
  );
};

export default function CoursesPage() {
  const { data: session } = useSession();
  const userRole = (session as any)?.roles?.[0] || 'student';
  
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('Tous');
  const [selectedLevel, setSelectedLevel] = useState('Tous');
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');

  const filteredCourses = coursesData.filter(course => {
    const matchesSearch = course.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
                         course.description.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesCategory = selectedCategory === 'Tous' || course.category === selectedCategory;
    const matchesLevel = selectedLevel === 'Tous' || course.level === selectedLevel;
    
    return matchesSearch && matchesCategory && matchesLevel;
  });

  const pageTitle = {
    admin: "Gestion des Cours",
    student: "Mes Cours",
    parent: "Cours de mon Enfant"
  };

  return (
    <div className="container mx-auto p-6 max-w-7xl">
        {/* Header */}
        <motion.div 
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6 }}
          className="mb-8"
        >
          <h1 className="font-bold gradient-text mb-2 whitespace-nowrap text-2xl leading-tight md:text-3xl">
            {pageTitle[userRole as keyof typeof pageTitle]}
          </h1>
          <p className="text-muted-foreground whitespace-nowrap text-sm md:text-base">
            Explorez et suivez vos cours en ligne
          </p>
        </motion.div>

        {/* Filters and Search */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2, duration: 0.6 }}
          className="mb-8"
        >
          <Card variant="glass">
            <CardContent className="p-6">
              <div className="flex flex-col lg:flex-row gap-4 items-center justify-between">
                {/* Search */}
                <div className="relative flex-1 max-w-md">
                  <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <input
                    type="text"
                    placeholder="Rechercher un cours..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="w-full pl-9 pr-4 py-2 bg-background border border-border rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-role-primary/20 focus:border-role-primary/50 transition-all duration-200"
                  />
                </div>
                
                {/* Filters */}
                <div className="flex items-center space-x-4">
                  <AntSelect
                    value={selectedCategory}
                    onChange={(e) => setSelectedCategory(e.target.value)}
                    className="px-3 py-2 bg-background border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-role-primary/20"
                  >
                    {categories.map(category => (
                      <option key={category} value={category}>{category}</option>
                    ))}
                  </AntSelect>
                  
                  <AntSelect
                    value={selectedLevel}
                    onChange={(e) => setSelectedLevel(e.target.value)}
                    className="px-3 py-2 bg-background border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-role-primary/20"
                  >
                    {levels.map(level => (
                      <option key={level} value={level}>{level}</option>
                    ))}
                  </AntSelect>
                  
                  {/* View Mode Toggle */}
                  <div className="flex items-center space-x-1 bg-muted rounded-lg p-1">
                    <Button
                      variant={viewMode === 'grid' ? 'default' : 'ghost'}
                      size="sm"
                      onClick={() => setViewMode('grid')}
                      className="p-2"
                    >
                      <Grid className="h-4 w-4" />
                    </Button>
                    <Button
                      variant={viewMode === 'list' ? 'default' : 'ghost'}
                      size="sm"
                      onClick={() => setViewMode('list')}
                      className="p-2"
                    >
                      <List className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        </motion.div>

        {/* Courses Grid/List */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.4, duration: 0.6 }}
        >
          <AnimatePresence mode="wait">
            {viewMode === 'grid' ? (
              <motion.div
                key="grid"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6"
              >
                {filteredCourses.map((course, index) => (
                  <motion.div
                    key={course.id}
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.1 * index, duration: 0.3 }}
                  >
                    <CourseCard course={course} viewMode="grid" />
                  </motion.div>
                ))}
              </motion.div>
            ) : (
              <motion.div
                key="list"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="space-y-4"
              >
                {filteredCourses.map((course, index) => (
                  <motion.div
                    key={course.id}
                    initial={{ opacity: 0, x: -20 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: 0.1 * index, duration: 0.3 }}
                  >
                    <CourseCard course={course} viewMode="list" />
                  </motion.div>
                ))}
              </motion.div>
            )}
          </AnimatePresence>
        </motion.div>

        {/* Empty State */}
        {filteredCourses.length === 0 && (
          <motion.div
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ delay: 0.6, duration: 0.4 }}
            className="text-center py-12"
          >
            <BookOpen className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
            <h3 className="text-lg font-semibold text-muted-foreground mb-2">
              Aucun cours trouvé
            </h3>
            <p className="text-muted-foreground">
              Essayez de modifier vos critères de recherche ou de filtrage
            </p>
          </motion.div>
        )}
    </div>
  );
}
