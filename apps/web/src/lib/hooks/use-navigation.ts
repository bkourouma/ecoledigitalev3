import { 
  BarChart3, 
  BookOpen, 
  Users, 
  FileText, 
  Settings, 
  Home, 
  Play, 
  GraduationCap, 
  User, 
  MessageCircle 
} from 'lucide-react';

export interface NavigationItem {
  label: string;
  icon: typeof Home;
  href: string;
  color: string;
  badge?: string | number;
  children?: NavigationItem[];
}

// Navigation configurations for each role
const navigationByRole = {
  admin: [
    { 
      label: "Tableau de bord", 
      icon: BarChart3, 
      href: "/dashboard",
      color: "text-blue-500"
    },
    { 
      label: "Gestion des cours", 
      icon: BookOpen, 
      href: "/courses",
      color: "text-blue-500",
      children: [
        { label: "Tous les cours", icon: BookOpen, href: "/courses", color: "text-blue-400" },
        { label: "Créer un cours", icon: BookOpen, href: "/courses/create", color: "text-blue-400" },
        { label: "Catégories", icon: BookOpen, href: "/courses/categories", color: "text-blue-400" }
      ]
    },
    { 
      label: "Utilisateurs", 
      icon: Users, 
      href: "/users",
      color: "text-blue-500",
      children: [
        { label: "Étudiants", icon: GraduationCap, href: "/users/students", color: "text-blue-400" },
        { label: "Parents", icon: Users, href: "/users/parents", color: "text-blue-400" },
        { label: "Enseignants", icon: User, href: "/users/teachers", color: "text-blue-400" }
      ]
    },
    { 
      label: "Rapports", 
      icon: FileText, 
      href: "/reports",
      color: "text-blue-500"
    },
    { 
      label: "Paramètres", 
      icon: Settings, 
      href: "/settings",
      color: "text-blue-500"
    }
  ],
  student: [
    { 
      label: "Accueil", 
      icon: Home, 
      href: "/dashboard",
      color: "text-emerald-500"
    },
    { 
      label: "Mes cours", 
      icon: BookOpen, 
      href: "/courses",
      color: "text-emerald-500",
      children: [
        { label: "Cours actifs", icon: Play, href: "/courses/active", color: "text-emerald-400" },
        { label: "Cours terminés", icon: BookOpen, href: "/courses/completed", color: "text-emerald-400" },
        { label: "Favoris", icon: BookOpen, href: "/courses/favorites", color: "text-emerald-400" }
      ]
    },
    { 
      label: "E-learning", 
      icon: Play, 
      href: "/elearning",
      color: "text-emerald-500"
    },
    { 
      label: "Mes notes", 
      icon: GraduationCap, 
      href: "/grades",
      color: "text-emerald-500"
    },
    { 
      label: "Profil", 
      icon: User, 
      href: "/profile",
      color: "text-emerald-500"
    }
  ],
  parent: [
    { 
      label: "Tableau de bord", 
      icon: Home, 
      href: "/dashboard",
      color: "text-orange-500"
    },
    { 
      label: "Suivi enfant", 
      icon: Users, 
      href: "/children",
      color: "text-orange-500",
      children: [
        { label: "Progression", icon: BarChart3, href: "/children/progress", color: "text-orange-400" },
        { label: "Emploi du temps", icon: FileText, href: "/children/schedule", color: "text-orange-400" },
        { label: "Absences", icon: FileText, href: "/children/absences", color: "text-orange-400" }
      ]
    },
    { 
      label: "Cours & devoirs", 
      icon: BookOpen, 
      href: "/homework",
      color: "text-orange-500"
    },
    { 
      label: "Communications", 
      icon: MessageCircle, 
      href: "/messages",
      color: "text-orange-500",
      badge: 3
    },
    { 
      label: "Paramètres", 
      icon: Settings, 
      href: "/settings",
      color: "text-orange-500"
    }
  ]
} as const;

// Role badge configurations
export const roleBadges = {
  admin: {
    label: "Administrateur",
    className: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200"
  },
  student: {
    label: "Étudiant",
    className: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900 dark:text-emerald-200"
  },
  parent: {
    label: "Parent",
    className: "bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200"
  }
} as const;

// Hook to get navigation items based on user role
export const useNavigation = (userRole: 'admin' | 'student' | 'parent' | null) => {
  if (!userRole) return [];
  return navigationByRole[userRole] || [];
};

// Hook to get role badge configuration
export const useRoleBadge = (userRole: 'admin' | 'student' | 'parent' | null) => {
  if (!userRole) return null;
  return roleBadges[userRole] || null;
};










