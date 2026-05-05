"use client";

import React, { useState } from 'react';
import {
  Home,
  Users,
  GraduationCap,
  Settings,
  LogOut,
  BookOpen,
  Calendar,
  BarChart3,
  ChevronDown,
  ChevronRight,
  ClipboardCheck,
  DollarSign,
  Calculator,
  FileText,
  CreditCard,
  TrendingUp,
  Receipt,
  Wallet,
  PieChart,
  Clock,
  Award,
  Play,
  FolderOpen,
  MessageSquare,
  Bot,
  HelpCircle,
  User,
  Edit,
  Archive,
  Shield,
  List,
  Baby,
  Phone,
  X,
  Bell
} from 'lucide-react';
import { usePathname } from 'next/navigation';
import { useSession, signOut } from 'next-auth/react';
import Link from 'next/link';
import { removeToken, getToken } from '@/lib/jwt-storage';

const navigationItems = [
  { icon: Home, label: 'Home', href: '/' as const },
];

// Espace propriétaire (même style que le reste de l’app)
const ownerMenuItems = [
  { icon: BarChart3, label: 'Pilotage', href: '/owner/dashboard' as const },
  { icon: DollarSign, label: 'Finances', href: '/owner/finances' as const },
  { icon: GraduationCap, label: 'Académique', href: '/owner/academique' as const },
  { icon: Users, label: 'RH', href: '/owner/staff' as const },
  { icon: BookOpen, label: 'Formations', href: '/owner/formations' as const },
  { icon: Bell, label: 'Alertes', href: '/owner/alertes' as const },
];

const adminQuickMenuItems = [
  { icon: Shield, label: 'Accès', href: '/owner/acces' as const },
];

// Formateur space menu (rendered with the same global sidebar style)
const formateurMenuItems = [
  { icon: BarChart3, label: 'Tableau de bord', href: '/formateur/dashboard' as const },
  { icon: Calendar, label: 'Planning', href: '/formateur/planning' as const },
  { icon: BookOpen, label: 'Sessions', href: '/formateur/sessions' as const },
  { icon: FileText, label: 'Supports', href: '/formateur/supports' as const },
  { icon: BookOpen, label: 'Catalogue', href: '/formations-professionnelles/catalogue' as const },
  { icon: Play, label: 'Page publique', href: '/formations-professionnelles/public' as const },
  { icon: User, label: 'Profil', href: '/formateur/profil' as const },
];

// Formations Professionnelles Menu
const formationsProMenuItems = [
  { icon: BookOpen, label: 'Catalogue', href: '/formations-professionnelles/catalogue' as const },
  { icon: Calendar, label: 'Calendrier des Sessions', href: '/formations-professionnelles/sessions' as const },
  { icon: Play, label: 'Page Publique', href: '/formations-professionnelles/public' as const },
];

// Formations Professionnelles Admin Menu
const formationsProAdminMenuItems = [
  { icon: Calendar, label: 'Gestion des Sessions', href: '/formations-professionnelles/admin/sessions' as const },
  { icon: Edit, label: 'Créer une Session', href: '/formations-professionnelles/admin/sessions/creer' as const },
  { icon: User, label: 'Formateurs', href: '/formations-professionnelles/admin/formateurs' as const },
  { icon: Play, label: 'Pages Publiques', href: '/formations-professionnelles/public' as const },
  // { icon: FileText, label: 'Inscriptions', href: '/formations-professionnelles/admin/inscriptions' as const },
];

// Core Academic Structure Management
const academicStructureMenuItems = [
  { icon: BarChart3, label: 'Vue d\'ensemble', href: '/academic' as const },
  { icon: GraduationCap, label: 'Cycles', href: '/academic/cycles' as const },
  { icon: BookOpen, label: 'Programmes', href: '/academic/programmes' as const },
  { icon: ClipboardCheck, label: 'Types de Bilan', href: '/annee-academique/types-de-bilan' as const },
  { icon: Calendar, label: 'Matières', href: '/academic/courses' as const },
];

// People Management
const peopleMenuItems = [
  { icon: Users, label: 'Enseignants', href: '/academic/teachers' as const },
  { icon: Users, label: 'Étudiants', href: '/academic/students' as const },
  { icon: Users, label: 'Parents', href: '/academic/parents' as const },
];

// Academic Year Operations
const academicOperationsMenuItems = [
  { icon: Calendar, label: 'Démarrer Année', href: '/annee-academique/demarrer' as const },
  { icon: BookOpen, label: 'Classes', href: '/annee-academique/ajouter-classe' as const },
  { icon: Settings, label: 'Affectations Cours', href: '/academic/assignments' as const },
  { icon: Users, label: 'Inscriptions', href: '/annee-academique/inscription' as const },
  // { icon: GraduationCap, label: 'Relevés de Notes', href: '/annee-academique/releves-de-notes' as const },
  // { icon: ClipboardCheck, label: 'Rapports de Présence', href: '/annee-academique/rapports-de-presence' as const },
];

// BTS submenu in Academic Operations
const btsMenuItems = [
  { icon: Award, label: 'Moyennes semestre', href: '/annee-academique/moyennes-semestre' as const },
  { icon: Clock, label: 'Horaires d\'Examens', href: '/annee-academique/horaires-examens' as const },
];

// Daily Operations
const dailyOperationsMenuItems = [
  // { icon: ClipboardCheck, label: 'Présences', href: '/attendance' as const },
  { icon: Clock, label: 'Génération Planning', href: '/simple-schedule' as const },
  { icon: Calendar, label: 'Calendrier Cours', href: '/schedule-generation/calendar' as const },
  { icon: BarChart3, label: 'Statistiques Planning', href: '/schedule-generation/stats' as const },
];

// Teacher Payment Management
const teacherPaymentMenuItems = [
  { icon: Calendar, label: 'Périodes de Paiement', href: '/payments/periods' as const },
  { icon: Settings, label: 'Configuration Enseignants', href: '/payments/teacher-configs' as const },
  { icon: Clock, label: 'Validation des Heures', href: '/payments/teaching-hours' as const },
  { icon: Calculator, label: 'Calcul des Paiements', href: '/payments/calculate' as const },
  { icon: DollarSign, label: 'Gestion des Paiements', href: '/payments/manage' as const },
  { icon: FileText, label: 'Rapports Enseignants', href: '/payments/reports' as const },
];

// Student Finance (for students)
const studentFinanceMenuItems = [
  { icon: Wallet, label: 'Mes Paiements', href: '/student-payments' as const },
  // { icon: Receipt, label: 'Mes Reçus', href: '/student-payments/receipts' as const }, // Masqué
];

// Student Finance Management (for admins)
const studentFinanceAdminMenuItems = [
  // { icon: PieChart, label: 'Tableau de Bord', href: '/admin/finances' as const }, // Masqu?
  { icon: Calendar, label: 'Scolarité', href: '/admin/finances/scolarite' as const },
  { icon: Calendar, label: 'Échéanciers', href: '/admin/finances/tuition-schedules' as const },
  { icon: Users, label: 'Paiements Étudiants', href: '/admin/finances/student-payments' as const },
  // { icon: TrendingUp, label: 'Analyses Financi?res', href: '/admin/finances/analytics' as const }, // Masqu?
  { icon: FileText, label: 'Rapports Financiers', href: '/admin/finances/reports' as const },
];

// Student Academic Menu Items
const studentAcademicMenuItems = [
  { icon: BookOpen, label: 'Mes Cours', href: '/student/courses' as const },
  { icon: Calendar, label: 'Emploi du Temps', href: '/student/schedule' as const },
  { icon: FileText, label: 'Devoirs', href: '/student/assignments' as const },
  { icon: Award, label: 'Mes Notes', href: '/student/grades' as const },
];

// Student E-Learning Menu Items
const studentELearningMenuItems = [
  { icon: FolderOpen, label: 'Contenu Récent', href: '/student/content' as const },
  { icon: TrendingUp, label: 'Progression', href: '/student/progress' as const },
];

// Student Assistance Menu Items
const studentAssistanceMenuItems = [
  { icon: Bot, label: 'Tuteur IA', href: '/student/ai-tutor' as const },
  { icon: HelpCircle, label: 'Support', href: '/student/support' as const },
];

// Student Profile Menu Items
const studentProfileMenuItems = [
  { icon: User, label: 'Mon Profil', href: '/student/profile' as const },
  // { icon: Settings, label: 'Paramètres', href: '/student/settings' as const }, // Masqué
];

// Teacher Navigation Menu Items
const teacherMenuItems = [
  { icon: BarChart3, label: 'Tableau de Bord', href: '/teacher/dashboard' as const },
];

// Teacher Courses Menu Items
const teacherCoursesMenuItems = [
  { icon: BookOpen, label: 'Mes Cours', href: '/teacher/courses' as const },
  { icon: Calendar, label: 'Planning des Cours', href: '/teacher/schedule' as const },
  { icon: Users, label: 'Présences', href: '/teacher/attendance' as const },
];

// Teacher Students Menu Items
const teacherStudentsMenuItems = [
  { icon: Users, label: 'Liste des Étudiants', href: '/teacher/students' as const },
  // { icon: TrendingUp, label: 'Suivi Individuel', href: '/teacher/student-tracking' as const },
  { icon: MessageSquare, label: 'Communications', href: '/teacher/communications' as const },
];

// Teacher Evaluations Menu Items
const teacherEvaluationsMenuItems = [
  { icon: FileText, label: 'Créer des Devoirs', href: '/teacher/assignments/create' as const },
  { icon: List, label: 'Liste des Devoirs', href: '/teacher/assignments/list' as const },
  { icon: Users, label: 'Assigner un devoir', href: '/academic/assignments/assign' as const },
  { icon: Edit, label: 'Corrections en Attente', href: '/teacher/corrections' as const },
];

// Teacher Remuneration Menu Items
const teacherRemunerationMenuItems = [
  { icon: Clock, label: 'Heures Enseignées', href: '/teacher/hours' as const },
  { icon: DollarSign, label: 'Mes Paiements', href: '/teacher/payments' as const },
  // { icon: FileText, label: 'Relevés de Paie', href: '/teacher/payslips' as const },
  // { icon: Settings, label: 'Configuration Personnelle', href: '/teacher/config' as const },
];

// Teacher Reports Menu Items
const teacherReportsMenuItems = [
  { icon: BarChart3, label: 'Dashboard Analytique', href: '/teacher/reports' as const },
  // { icon: Award, label: 'Mes Statistiques', href: '/teacher/reports/personal' as const },
];

// Teacher Profile Menu Items
const teacherProfileMenuItems = [
  { icon: User, label: 'Informations Personnelles', href: '/teacher/profile' as const },
  // { icon: Award, label: 'Mes Spécialités', href: '/teacher/specialties' as const },
  // { icon: Settings, label: 'Paramètres', href: '/teacher/settings' as const },
  // { icon: Shield, label: 'Sécurité', href: '/teacher/security' as const },
];

// Parent Navigation Menu Items (for submenu under "Mes Enfants")
const parentMenuItems = [
  { icon: Users, label: 'Mes Enfants', href: '/parent/children' as const },
  { icon: BookOpen, label: 'Cours & Devoirs', href: '/parent/homework' as const },
  { icon: FileText, label: 'Documents', href: '/parent/documents' as const },
  { icon: CreditCard, label: 'Paiements & Finances', href: '/parent/payments' as const },
  { icon: MessageSquare, label: 'Messages', href: '/parent/messages' as const },
  // { icon: Phone, label: 'Contacts d\'Urgence', href: '/parent/emergency' as const },
];

// Parent Settings Menu Item (separate from submenu)
// const parentSettingsMenuItem = {
//   icon: Settings,
//   label: 'Paramètres',
//   href: '/parent/settings' as const,
// };

interface SidebarProps {
  onCloseMobileMenu?: () => void;
}

// NavLink component that automatically closes mobile menu on click
const NavLink = ({ 
  href, 
  children, 
  className, 
  onCloseMobileMenu 
}: { 
  href: string; 
  children: React.ReactNode; 
  className?: string;
  onCloseMobileMenu?: () => void;
}) => {
  const handleClick = () => {
    if (onCloseMobileMenu) {
      onCloseMobileMenu();
    }
  };

  return (
    <Link
      href={href as any}
      onClick={handleClick}
      className={className}
    >
      {children}
    </Link>
  );
};

export function Sidebar({ onCloseMobileMenu }: SidebarProps) {
  const pathname = usePathname();
  const { data: session } = useSession();

  // Rôles
  const roles = (session as any)?.roles ?? [];
  const isAdmin = Array.isArray(roles) && roles.some((r: string) => ['admin', 'super_admin', 'Administrateur'].includes(r));
  const isStudent = Array.isArray(roles) && roles.some((r: string) => ['student', 'Étudiant'].includes(r));
  const isTeacher = Array.isArray(roles) && roles.some((r: string) => ['teacher', 'Enseignant'].includes(r));
  const isParent = Array.isArray(roles) && roles.some((r: string) => ['parent', 'Parent'].includes(r));
  const isFormateur = Array.isArray(roles) && roles.some((r: string) => ['formateur', 'Formateur'].includes(r));
  const isOwner =
    Array.isArray(roles) && roles.some((r: string) => String(r).toLowerCase() === 'owner');

  // All admin tenants are equal: every admin sees the full Formation Pro menus,
  // alongside the regular admin sidebar. No tenant-id gating.
  const formationsProNavItems = formationsProMenuItems;
  const formationsProAdminNavItems = formationsProAdminMenuItems;

  const [isAcademicStructureExpanded, setIsAcademicStructureExpanded] = useState(
    pathname.startsWith('/academic') || pathname.startsWith('/annee-academique/types-de-bilan')
  );
  const [isPeopleExpanded, setIsPeopleExpanded] = useState(
    pathname.startsWith('/academic/teachers') || pathname.startsWith('/academic/students')
  );
  const [isAcademicOperationsExpanded, setIsAcademicOperationsExpanded] = useState(
    pathname.startsWith('/annee-academique') || pathname.startsWith('/academic/assignments')
  );
  const [isBtsExpanded, setIsBtsExpanded] = useState(
    pathname.startsWith('/annee-academique/moyennes-semestre') ||
    pathname.startsWith('/annee-academique/horaires-examens')
  );
  const [isDailyOperationsExpanded, setIsDailyOperationsExpanded] = useState(
    pathname.startsWith('/attendance') || pathname.startsWith('/schedule-generation')
  );
  const [isTeacherPaymentExpanded, setIsTeacherPaymentExpanded] = useState(
    pathname.startsWith('/payments')
  );
  const [isStudentFinanceExpanded, setIsStudentFinanceExpanded] = useState(
    pathname.startsWith('/student-payments')
  );
  const [isStudentFinanceAdminExpanded, setIsStudentFinanceAdminExpanded] = useState(
    pathname.startsWith('/admin/finances')
  );

  // Student menu states
  const [isStudentAcademicExpanded, setIsStudentAcademicExpanded] = useState(
    pathname.startsWith('/student/courses') || pathname.startsWith('/student/schedule') ||
    pathname.startsWith('/student/assignments') || pathname.startsWith('/student/grades')
  );
  const [isStudentELearningExpanded, setIsStudentELearningExpanded] = useState(
    pathname.startsWith('/student/content') || pathname.startsWith('/student/progress')
  );
  const [isStudentAssistanceExpanded, setIsStudentAssistanceExpanded] = useState(
    pathname.startsWith('/student/ai-tutor') || pathname.startsWith('/student/support')
  );
  const [isStudentProfileExpanded, setIsStudentProfileExpanded] = useState(
    pathname.startsWith('/student/profile') || pathname.startsWith('/student/settings')
  );

  // Teacher menu states
  const [isTeacherCoursesExpanded, setIsTeacherCoursesExpanded] = useState(
    pathname.startsWith('/teacher/assignments') || pathname.startsWith('/teacher/schedule') ||
    pathname.startsWith('/teacher/content') || pathname.startsWith('/teacher/attendance')
  );
  const [isTeacherStudentsExpanded, setIsTeacherStudentsExpanded] = useState(
    pathname.startsWith('/teacher/students') || pathname.startsWith('/teacher/student-tracking') ||
    pathname.startsWith('/teacher/communications')
  );
  const [isTeacherEvaluationsExpanded, setIsTeacherEvaluationsExpanded] = useState(
    pathname.startsWith('/teacher/assignments/create') || pathname.startsWith('/teacher/corrections') ||
    pathname.startsWith('/teacher/grades') || pathname.startsWith('/teacher/evaluations')
  );
  const [isTeacherRemunerationExpanded, setIsTeacherRemunerationExpanded] = useState(
    pathname.startsWith('/teacher/hours') || pathname.startsWith('/teacher/payments') ||
    pathname.startsWith('/teacher/payslips') || pathname.startsWith('/teacher/config')
  );
  const [isTeacherReportsExpanded, setIsTeacherReportsExpanded] = useState(
    pathname.startsWith('/teacher/reports')
  );

  // Parent menu states
  const [isParentChildrenExpanded, setIsParentChildrenExpanded] = useState(
    pathname.startsWith('/parent/children')
  );
  const [isFormationsProExpanded, setIsFormationsProExpanded] = useState(
    pathname.startsWith('/formations-professionnelles')
  );
  const [isFormationsProAdminExpanded, setIsFormationsProAdminExpanded] = useState(
    pathname.startsWith('/formations-professionnelles/admin')
  );
  const isFormateurSpace = pathname.startsWith('/formateur');
  const showFormateurMenu = isFormateur || isFormateurSpace;

  const handleLogout = async () => {
    try {
      const token = getToken();
      
      if (token) {
        // Call backend logout endpoint to blacklist token
        try {
          await fetch('/api/v1/auth/logout', {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${token}`,
              'Content-Type': 'application/json'
            }
          });
          console.log('ðŸ—‘ï¸ Token blacklisted on backend');
        } catch (error) {
          console.error('âŒ Failed to call logout endpoint:', error);
          // Continue with logout even if backend call fails
        }
      }
      
      // Remove JWT token from localStorage
      removeToken();
      console.log('ðŸ§¹ JWT token removed from localStorage');
      
      // Clear NextAuth session and redirect to login
      signOut({ callbackUrl: '/login' });
    } catch (error) {
      console.error('âŒ Logout error:', error);
      // Force logout even on error
      removeToken();
      signOut({ callbackUrl: '/login' });
    }
  };

  return (
    <div className="h-full bg-gray-900 flex flex-col">
      <div className="h-12 flex items-center justify-between px-4 border-b border-gray-700">
        <div className="flex items-center space-x-2">
          <div className="w-8 h-8 bg-gradient-to-r from-blue-500 to-purple-600 rounded-lg flex items-center justify-center">
            <span className="text-white font-normal text-xs">ED</span>
          </div>
          <span className="text-white font-normal text-xs tracking-wide">Explore</span>
        </div>
        {/* Mobile close button */}
        {onCloseMobileMenu && (
          <button
            onClick={onCloseMobileMenu}
            className="md:hidden p-1 text-gray-400 hover:text-white hover:bg-gray-800 rounded-md transition-colors"
            aria-label="Close menu"
          >
            <X className="h-5 w-5" />
          </button>
        )}
      </div>

      <div className="flex-1 py-4 overflow-y-auto">
        <nav className="space-y-1 px-2">
          {/* Main Navigation */}
          {navigationItems.map((item) => {
            const Icon = item.icon;
            const isActive = pathname === item.href;

            return (
              <NavLink
                key={item.href}
                href={item.href}
                onCloseMobileMenu={onCloseMobileMenu}
                className={`flex items-center space-x-3 px-3 py-2 rounded-lg text-[16px] font-normal transition-colors ${isActive ? 'bg-blue-600 text-white' : 'text-gray-300 hover:bg-gray-800 hover:text-white'}`}
              >
                <Icon className="w-5 h-5" />
                <span>{item.label}</span>
              </NavLink>
            );
          })}

          {isOwner && (
            <div className="pt-3">
              <div className="px-3 mb-2">
                <h3 className="text-[11px] font-normal text-gray-400 uppercase tracking-wider">
                  Propriétaire
                </h3>
              </div>
              {ownerMenuItems.map((item) => {
                const Icon = item.icon;
                const isActive =
                  item.href === '/owner/dashboard'
                    ? pathname === '/owner/dashboard' || pathname === '/owner'
                    : pathname === item.href || pathname.startsWith(`${item.href}/`);
                return (
                  <NavLink
                    key={item.href}
                    href={item.href}
                    onCloseMobileMenu={onCloseMobileMenu}
                    className={`flex items-center space-x-3 px-3 py-2 rounded-lg text-[16px] font-normal transition-colors ${
                      isActive
                        ? 'bg-purple-600 text-white'
                        : 'text-gray-300 hover:bg-gray-800 hover:text-white'
                    }`}
                  >
                    <Icon className="w-5 h-5" />
                    <span>{item.label}</span>
                  </NavLink>
                );
              })}
            </div>
          )}

          {/* Formateur Section (for formateur accounts or /formateur routes) */}
          {showFormateurMenu ? (
            <div className="pt-2">
              {formateurMenuItems.map((item) => {
                const Icon = item.icon;
                const isActive = pathname === item.href || pathname.startsWith(`${item.href}/`);

                return (
                  <NavLink
                    key={item.href}
                    href={item.href}
                    onCloseMobileMenu={onCloseMobileMenu}
                    className={`flex items-center space-x-3 px-3 py-2 rounded-lg text-[16px] font-normal transition-colors ${isActive ? 'bg-blue-600 text-white' : 'text-gray-300 hover:bg-gray-800 hover:text-white'}`}
                  >
                    <Icon className="w-5 h-5" />
                    <span>{item.label}</span>
                  </NavLink>
                );
              })}
            </div>
          ) : (
            <>
              {/* Student Navigation */}
              {isStudent && (
                <>
              {/* Student Academic Section */}
              <div className="pt-4">
                <div className="px-3 mb-2">
                  <h3 className="text-[11px] font-normal text-gray-400 uppercase tracking-wider">
                    Académique
                  </h3>
                </div>

                {/* Academic Toggle Button */}
                <button
                  onClick={() => setIsStudentAcademicExpanded(!isStudentAcademicExpanded)}
                  className={`w-full flex items-center justify-between px-3 py-2 rounded-lg text-[16px] font-normal transition-colors ${isStudentAcademicExpanded ? 'bg-emerald-600 text-white' : 'text-gray-300 hover:bg-gray-800 hover:text-white'}`}
                >
                  <div className="flex items-center space-x-3">
                    <BookOpen className="w-5 h-5" />
                    <span>Mes Études</span>
                  </div>
                  {isStudentAcademicExpanded ? (
                    <ChevronDown className="w-5 h-5" />
                  ) : (
                    <ChevronRight className="w-5 h-5" />
                  )}
                </button>

                {/* Academic Submenu */}
                {isStudentAcademicExpanded && (
                  <div className="ml-4 mt-1 space-y-1">
                    {studentAcademicMenuItems.map((item) => {
                      const Icon = item.icon;
                      const isActive = pathname === item.href;

                      return (
                        <NavLink
                          key={item.href}
                          href={item.href}
                          onCloseMobileMenu={onCloseMobileMenu}
                          className={`flex items-center space-x-3 px-3 py-2 rounded-lg text-[16px] font-normal transition-colors ${isActive ? 'bg-emerald-600 text-white' : 'text-gray-300 hover:bg-gray-800 hover:text-white'}`}
                        >
                          <Icon className="w-5 h-5" />
                          <span>{item.label}</span>
                        </NavLink>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Student E-Learning Section */}
              {/* <div className="pt-2">
                <div className="px-3 mb-2">
                  <h3 className="text-[11px] font-normal text-gray-400 uppercase tracking-wider">
                    E-Learning
                  </h3>
                </div>

                <button
                  onClick={() => setIsStudentELearningExpanded(!isStudentELearningExpanded)}
                  className={`w-full flex items-center justify-between px-3 py-2 rounded-lg text-[16px] font-normal transition-colors ${isStudentELearningExpanded ? 'bg-emerald-600 text-white' : 'text-gray-300 hover:bg-gray-800 hover:text-white'}`}
                >
                  <div className="flex items-center space-x-3">
                    <Play className="w-5 h-5" />
                    <span>Apprentissage</span>
                  </div>
                  {isStudentELearningExpanded ? (
                    <ChevronDown className="w-5 h-5" />
                  ) : (
                    <ChevronRight className="w-5 h-5" />
                  )}
                </button>

                {isStudentELearningExpanded && (
                  <div className="ml-4 mt-1 space-y-1">
                    {studentELearningMenuItems.map((item) => {
                      const Icon = item.icon;
                      const isActive = pathname === item.href;

                      return (
                        <NavLink
                          key={item.href}
                          href={item.href}
                          onCloseMobileMenu={onCloseMobileMenu}
                          className={`flex items-center space-x-3 px-3 py-2 rounded-lg text-[16px] font-normal transition-colors ${isActive ? 'bg-emerald-600 text-white' : 'text-gray-300 hover:bg-gray-800 hover:text-white'}`}
                        >
                          <Icon className="w-5 h-5" />
                          <span>{item.label}</span>
                        </NavLink>
                      );
                    })}
                  </div>
                )}
              </div> */}

              {/* Student Communication Section */}
              <div className="pt-2">
                <div className="px-3 mb-2">
                  <h3 className="text-[11px] font-normal text-gray-400 uppercase tracking-wider">
                    Communication
                  </h3>
                </div>

                <NavLink
                  href="/student/messages"
                  onCloseMobileMenu={onCloseMobileMenu}
                  className={`flex items-center space-x-3 px-3 py-2 rounded-lg text-[16px] font-normal transition-colors ${
                    pathname.startsWith('/student/messages')
                      ? 'bg-emerald-600 text-white'
                      : 'text-gray-300 hover:bg-gray-800 hover:text-white'
                  }`}
                >
                  <MessageSquare className="w-5 h-5" />
                  <span>Messages</span>
                </NavLink>
              </div>

              {/* Student Assistance Section */}
              <div className="pt-2">
                <div className="px-3 mb-2">
                  <h3 className="text-[11px] font-normal text-gray-400 uppercase tracking-wider">
                    Assistance
                  </h3>
                </div>

                {/* Assistance Toggle Button */}
                <button
                  onClick={() => setIsStudentAssistanceExpanded(!isStudentAssistanceExpanded)}
                  className={`w-full flex items-center justify-between px-3 py-2 rounded-lg text-[16px] font-normal transition-colors ${isStudentAssistanceExpanded ? 'bg-emerald-600 text-white' : 'text-gray-300 hover:bg-gray-800 hover:text-white'}`}
                >
                  <div className="flex items-center space-x-3">
                    <Bot className="w-5 h-5" />
                    <span>Aide & Support</span>
                  </div>
                  {isStudentAssistanceExpanded ? (
                    <ChevronDown className="w-5 h-5" />
                  ) : (
                    <ChevronRight className="w-5 h-5" />
                  )}
                </button>

                {/* Assistance Submenu */}
                {isStudentAssistanceExpanded && (
                  <div className="ml-4 mt-1 space-y-1">
                    {studentAssistanceMenuItems.map((item) => {
                      const Icon = item.icon;
                      const isActive = pathname === item.href;

                      return (
                        <NavLink
                          key={item.href}
                          href={item.href}
                          onCloseMobileMenu={onCloseMobileMenu}
                          className={`flex items-center space-x-3 px-3 py-2 rounded-lg text-[16px] font-normal transition-colors ${isActive ? 'bg-emerald-600 text-white' : 'text-gray-300 hover:bg-gray-800 hover:text-white'}`}
                        >
                          <Icon className="w-5 h-5" />
                          <span>{item.label}</span>
                        </NavLink>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Student Profile Section */}
              <div className="pt-4">
                {studentProfileMenuItems.map((item) => {
                  const Icon = item.icon;
                  const isActive = pathname === item.href;

                  return (
                    <NavLink
                      key={item.href}
                      href={item.href}
                      onCloseMobileMenu={onCloseMobileMenu}
                      className={`flex items-center space-x-3 px-3 py-2 rounded-lg text-[16px] font-normal transition-colors mb-1 ${isActive ? 'bg-emerald-600 text-white' : 'text-gray-300 hover:bg-gray-800 hover:text-white'}`}
                    >
                      <Icon className="w-5 h-5" />
                      <span>{item.label}</span>
                    </NavLink>
                  );
                })}
              </div>
                </>
              )}
              {/* Parent Navigation */}
              {isParent && (
                <>
                  {/* Parent Children Section */}
                  <div className="pt-4">
                <div className="px-3 mb-2">
                  <h3 className="text-[11px] font-normal text-gray-400 uppercase tracking-wider">
                    Suivi des Enfants
                  </h3>
                </div>

                {/* Parent Children Toggle Button */}
                <button
                  onClick={() => setIsParentChildrenExpanded(!isParentChildrenExpanded)}
                  className={`w-full flex items-center justify-between px-3 py-2 rounded-lg text-[16px] font-normal transition-colors ${isParentChildrenExpanded ? 'bg-emerald-600 text-white' : 'text-gray-300 hover:bg-gray-800 hover:text-white'}`}
                >
                  <div className="flex items-center space-x-3">
                    <Baby className="w-5 h-5" />
                    <span>Mes Enfants</span>
                  </div>
                  {isParentChildrenExpanded ? (
                    <ChevronDown className="w-5 h-5" />
                  ) : (
                    <ChevronRight className="w-5 h-5" />
                  )}
                </button>

                {/* Parent Children Submenu */}
                {isParentChildrenExpanded && (
                  <div className="ml-4 mt-1 space-y-1">
                    {parentMenuItems.map((item) => {
                      const Icon = item.icon;
                      const isActive = pathname === item.href || pathname.startsWith(`${item.href}/`);

                      return (
                        <NavLink
                          key={item.href}
                          href={item.href}
                          onCloseMobileMenu={onCloseMobileMenu}
                          className={`flex items-center space-x-3 px-3 py-2 rounded-lg text-[16px] font-normal transition-colors ${isActive ? 'bg-emerald-600 text-white' : 'text-gray-300 hover:bg-gray-800 hover:text-white'}`}
                        >
                          <Icon className="w-5 h-5" />
                          <span>{item.label}</span>
                        </NavLink>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Parent Settings Menu Item (separate from submenu) */}
              {/* <div className="pt-4">
                <NavLink
                  href={parentSettingsMenuItem.href}
                  onCloseMobileMenu={onCloseMobileMenu}
                  className={`flex items-center space-x-3 px-3 py-2 rounded-lg text-[16px] font-normal transition-colors ${
                    pathname === parentSettingsMenuItem.href || pathname.startsWith(`${parentSettingsMenuItem.href}/`)
                      ? 'bg-emerald-600 text-white'
                      : 'text-gray-300 hover:bg-gray-800 hover:text-white'
                  }`}
                >
                  <Settings className="w-5 h-5" />
                  <span>{parentSettingsMenuItem.label}</span>
                </NavLink>
                  </div> */}
                </>
              )}

              {/* Teacher Navigation */}
              {isTeacher && (
                <>
                  {/* Teacher Dashboard */}
              {teacherMenuItems.map((item) => {
                const Icon = item.icon;
                const isActive = pathname === item.href;

                return (
                  <NavLink
                    key={item.href}
                    href={item.href}
                    onCloseMobileMenu={onCloseMobileMenu}
                    className={`flex items-center space-x-3 px-3 py-2 rounded-lg text-[16px] font-normal transition-colors mt-4 ${isActive ? 'bg-purple-600 text-white' : 'text-gray-300 hover:bg-gray-800 hover:text-white'}`}
                  >
                    <Icon className="w-5 h-5" />
                    <span>{item.label}</span>
                  </NavLink>
                );
              })}

              {/* Teacher Courses Section */}
              <div className="pt-4">
                <div className="px-3 mb-2">
                  <h3 className="text-[11px] font-normal text-gray-400 uppercase tracking-wider">
                    Mes Cours
                  </h3>
                </div>

                <button
                  onClick={() => setIsTeacherCoursesExpanded(!isTeacherCoursesExpanded)}
                  className={`w-full flex items-center justify-between px-3 py-2 rounded-lg text-[16px] font-normal transition-colors ${isTeacherCoursesExpanded ? 'bg-purple-600 text-white' : 'text-gray-300 hover:bg-gray-800 hover:text-white'}`}
                >
                  <div className="flex items-center space-x-3">
                    <BookOpen className="w-5 h-5" />
                    <span>Gestion des Cours</span>
                  </div>
                  {isTeacherCoursesExpanded ? (
                    <ChevronDown className="w-5 h-5" />
                  ) : (
                    <ChevronRight className="w-5 h-5" />
                  )}
                </button>

                {isTeacherCoursesExpanded && (
                  <div className="ml-4 mt-1 space-y-1">
                    {teacherCoursesMenuItems.map((item) => {
                      const Icon = item.icon;
                      const isActive = pathname === item.href;

                      return (
                        <NavLink
                          key={item.href}
                          href={item.href}
                          onCloseMobileMenu={onCloseMobileMenu}
                          className={`flex items-center space-x-3 px-3 py-2 rounded-lg text-[16px] font-normal transition-colors ${isActive ? 'bg-purple-600 text-white' : 'text-gray-300 hover:bg-gray-800 hover:text-white'}`}
                        >
                          <Icon className="w-5 h-5" />
                          <span>{item.label}</span>
                        </NavLink>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Teacher Students Section */}
              <div className="pt-2">
                <button
                  onClick={() => setIsTeacherStudentsExpanded(!isTeacherStudentsExpanded)}
                  className={`w-full flex items-center justify-between px-3 py-2 rounded-lg text-[16px] font-normal transition-colors ${isTeacherStudentsExpanded ? 'bg-purple-600 text-white' : 'text-gray-300 hover:bg-gray-800 hover:text-white'}`}
                >
                  <div className="flex items-center space-x-3">
                    <Users className="w-5 h-5" />
                    <span>Mes Étudiants</span>
                  </div>
                  {isTeacherStudentsExpanded ? (
                    <ChevronDown className="w-5 h-5" />
                  ) : (
                    <ChevronRight className="w-5 h-5" />
                  )}
                </button>

                {isTeacherStudentsExpanded && (
                  <div className="ml-4 mt-1 space-y-1">
                    {teacherStudentsMenuItems.map((item) => {
                      const Icon = item.icon;
                      const isActive = pathname === item.href;

                      return (
                        <NavLink
                          key={item.href}
                          href={item.href}
                          onCloseMobileMenu={onCloseMobileMenu}
                          className={`flex items-center space-x-3 px-3 py-2 rounded-lg text-[16px] font-normal transition-colors ${isActive ? 'bg-purple-600 text-white' : 'text-gray-300 hover:bg-gray-800 hover:text-white'}`}
                        >
                          <Icon className="w-5 h-5" />
                          <span>{item.label}</span>
                        </NavLink>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Teacher Evaluations Section */}
              <div className="pt-2">
                <button
                  onClick={() => setIsTeacherEvaluationsExpanded(!isTeacherEvaluationsExpanded)}
                  className={`w-full flex items-center justify-between px-3 py-2 rounded-lg text-[16px] font-normal transition-colors ${isTeacherEvaluationsExpanded ? 'bg-purple-600 text-white' : 'text-gray-300 hover:bg-gray-800 hover:text-white'}`}
                >
                  <div className="flex items-center space-x-3">
                    <Award className="w-5 h-5" />
                    <span>Évaluations</span>
                  </div>
                  {isTeacherEvaluationsExpanded ? (
                    <ChevronDown className="w-5 h-5" />
                  ) : (
                    <ChevronRight className="w-5 h-5" />
                  )}
                </button>

                {isTeacherEvaluationsExpanded && (
                  <div className="ml-4 mt-1 space-y-1">
                    {teacherEvaluationsMenuItems.map((item) => {
                      const Icon = item.icon;
                      const isActive = pathname === item.href;

                      return (
                        <NavLink
                          key={item.href}
                          href={item.href}
                          onCloseMobileMenu={onCloseMobileMenu}
                          className={`flex items-center space-x-3 px-3 py-2 rounded-lg text-[16px] font-normal transition-colors ${isActive ? 'bg-purple-600 text-white' : 'text-gray-300 hover:bg-gray-800 hover:text-white'}`}
                        >
                          <Icon className="w-5 h-5" />
                          <span>{item.label}</span>
                        </NavLink>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Teacher Remuneration Section */}
              <div className="pt-2">
                <button
                  onClick={() => setIsTeacherRemunerationExpanded(!isTeacherRemunerationExpanded)}
                  className={`w-full flex items-center justify-between px-3 py-2 rounded-lg text-[16px] font-normal transition-colors ${isTeacherRemunerationExpanded ? 'bg-purple-600 text-white' : 'text-gray-300 hover:bg-gray-800 hover:text-white'}`}
                >
                  <div className="flex items-center space-x-3">
                    <DollarSign className="w-5 h-5" />
                    <span>Mes Rémunérations</span>
                  </div>
                  {isTeacherRemunerationExpanded ? (
                    <ChevronDown className="w-5 h-5" />
                  ) : (
                    <ChevronRight className="w-5 h-5" />
                  )}
                </button>

                {isTeacherRemunerationExpanded && (
                  <div className="ml-4 mt-1 space-y-1">
                    {teacherRemunerationMenuItems.map((item) => {
                      const Icon = item.icon;
                      const isActive = pathname === item.href;

                      return (
                        <NavLink
                          key={item.href}
                          href={item.href}
                          onCloseMobileMenu={onCloseMobileMenu}
                          className={`flex items-center space-x-3 px-3 py-2 rounded-lg text-[16px] font-normal transition-colors ${isActive ? 'bg-purple-600 text-white' : 'text-gray-300 hover:bg-gray-800 hover:text-white'}`}
                        >
                          <Icon className="w-5 h-5" />
                          <span>{item.label}</span>
                        </NavLink>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Teacher Reports Section */}
              <div className="pt-2">
                <button
                  onClick={() => setIsTeacherReportsExpanded(!isTeacherReportsExpanded)}
                  className={`w-full flex items-center justify-between px-3 py-2 rounded-lg text-[16px] font-normal transition-colors ${isTeacherReportsExpanded ? 'bg-purple-600 text-white' : 'text-gray-300 hover:bg-gray-800 hover:text-white'}`}
                >
                  <div className="flex items-center space-x-3">
                    <BarChart3 className="w-5 h-5" />
                    <span>Rapports & Analyses</span>
                  </div>
                  {isTeacherReportsExpanded ? (
                    <ChevronDown className="w-5 h-5" />
                  ) : (
                    <ChevronRight className="w-5 h-5" />
                  )}
                </button>

                {isTeacherReportsExpanded && (
                  <div className="ml-4 mt-1 space-y-1">
                    {teacherReportsMenuItems.map((item) => {
                      const Icon = item.icon;
                      const isActive = pathname === item.href;

                      return (
                        <NavLink
                          key={item.href}
                          href={item.href}
                          onCloseMobileMenu={onCloseMobileMenu}
                          className={`flex items-center space-x-3 px-3 py-2 rounded-lg text-[16px] font-normal transition-colors ${isActive ? 'bg-purple-600 text-white' : 'text-gray-300 hover:bg-gray-800 hover:text-white'}`}
                        >
                          <Icon className="w-5 h-5" />
                          <span>{item.label}</span>
                        </NavLink>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Teacher Profile Section */}
              <div className="pt-4">
                {teacherProfileMenuItems.map((item) => {
                  const Icon = item.icon;
                  const isActive = pathname === item.href;

                  return (
                    <NavLink
                      key={item.href}
                      href={item.href}
                      onCloseMobileMenu={onCloseMobileMenu}
                      className={`flex items-center space-x-3 px-3 py-2 rounded-lg text-[16px] font-normal transition-colors mb-1 ${isActive ? 'bg-purple-600 text-white' : 'text-gray-300 hover:bg-gray-800 hover:text-white'}`}
                    >
                      <Icon className="w-5 h-5" />
                      <span>{item.label}</span>
                    </NavLink>
                  );
                })}
              </div>
                </>
              )}

              {/* Academic Structure Section */}
              {isAdmin && (
                    <div className="pt-4">
            <div className="px-3 mb-2">
              <h3 className="text-[11px] font-normal text-gray-400 uppercase tracking-wider">
                Structure Académique
              </h3>
            </div>

            {/* Academic Structure Toggle Button */}
            <button
              onClick={() => setIsAcademicStructureExpanded(!isAcademicStructureExpanded)}
              className={`w-full flex items-center justify-between px-3 py-2 rounded-lg text-[16px] font-normal transition-colors ${((pathname.startsWith('/academic') && !pathname.startsWith('/academic/teachers') && !pathname.startsWith('/academic/students') && !pathname.startsWith('/academic/assignments')) || pathname.startsWith('/annee-academique/types-de-bilan')) ? 'bg-blue-600 text-white' : 'text-gray-300 hover:bg-gray-800 hover:text-white'}`}
            >
              <div className="flex items-center space-x-3">
                <GraduationCap className="w-5 h-5" />
                <span>Cycles & Programmes</span>
              </div>
              {isAcademicStructureExpanded ? (
                <ChevronDown className="w-5 h-5" />
              ) : (
                <ChevronRight className="w-5 h-5" />
              )}
            </button>

            {/* Academic Structure Submenu */}
            {isAcademicStructureExpanded && (
              <div className="ml-4 mt-1 space-y-1">
                {academicStructureMenuItems.map((item) => {
                  const Icon = item.icon;
                  const isActive = pathname === item.href;

                  return (
                        <NavLink
                      key={item.href}
                          href={item.href}
                          onCloseMobileMenu={onCloseMobileMenu}
                      className={`flex items-center space-x-3 px-3 py-2 rounded-lg text-[16px] font-normal transition-colors ${isActive ? 'bg-blue-600 text-white' : 'text-gray-300 hover:bg-gray-800 hover:text-white'}`}
                    >
                      <Icon className="w-5 h-5" />
                      <span>{item.label}</span>
                        </NavLink>
                  );
                })}
              </div>
            )}

            {/* People Management Toggle Button */}
            <button
              onClick={() => setIsPeopleExpanded(!isPeopleExpanded)}
              className={`w-full flex items-center justify-between px-3 py-2 rounded-lg text-[16px] font-normal transition-colors mt-2 ${(pathname.startsWith('/academic/teachers') || pathname.startsWith('/academic/students')) ? 'bg-blue-600 text-white' : 'text-gray-300 hover:bg-gray-800 hover:text-white'}`}
            >
              <div className="flex items-center space-x-3">
                <Users className="w-5 h-5" />
                <span>Gestion des Personnes</span>
              </div>
              {isPeopleExpanded ? (
                <ChevronDown className="w-5 h-5" />
              ) : (
                <ChevronRight className="w-5 h-5" />
              )}
            </button>

            {/* People Submenu */}
            {isPeopleExpanded && (
              <div className="ml-4 mt-1 space-y-1">
                {peopleMenuItems.map((item) => {
                  const Icon = item.icon;
                  const isActive = pathname === item.href;

                  return (
                        <NavLink
                      key={item.href}
                          href={item.href}
                          onCloseMobileMenu={onCloseMobileMenu}
                      className={`flex items-center space-x-3 px-3 py-2 rounded-lg text-[16px] font-normal transition-colors ${isActive ? 'bg-blue-600 text-white' : 'text-gray-300 hover:bg-gray-800 hover:text-white'}`}
                    >
                      <Icon className="w-5 h-5" />
                      <span>{item.label}</span>
                        </NavLink>
                  );
                })}
              </div>
            )}
          </div>
              )}

              {/* Academic Operations Section */}
              {isAdmin && (
                    <div className="pt-2">
            <div className="px-3 mb-2">
              <h3 className="text-[11px] font-normal text-gray-400 uppercase tracking-wider">
                Opérations Académiques
              </h3>
            </div>

            {/* Academic Operations Toggle Button */}
            <button
              onClick={() => setIsAcademicOperationsExpanded(!isAcademicOperationsExpanded)}
              className={`w-full flex items-center justify-between px-3 py-2 rounded-lg text-[16px] font-normal transition-colors ${(pathname.startsWith('/annee-academique') || pathname.startsWith('/academic/assignments')) ? 'bg-blue-600 text-white' : 'text-gray-300 hover:bg-gray-800 hover:text-white'}`}
            >
              <div className="flex items-center space-x-3">
                <Calendar className="w-5 h-5" />
                <span>Année Académique</span>
              </div>
              {isAcademicOperationsExpanded ? (
                <ChevronDown className="w-5 h-5" />
              ) : (
                <ChevronRight className="w-5 h-5" />
              )}
            </button>

            {/* Academic Operations Submenu */}
            {isAcademicOperationsExpanded && (
              <div className="ml-4 mt-1 space-y-1">
                {academicOperationsMenuItems.map((item) => {
                  const Icon = item.icon;
                  const isActive = pathname === item.href;

                  return (
                        <NavLink
                      key={item.href}
                          href={item.href}
                          onCloseMobileMenu={onCloseMobileMenu}
                      className={`flex items-center space-x-3 px-3 py-2 rounded-lg text-[16px] font-normal transition-colors ${isActive ? 'bg-blue-600 text-white' : 'text-gray-300 hover:bg-gray-800 hover:text-white'}`}
                    >
                      <Icon className="w-5 h-5" />
                      <span>{item.label}</span>
                        </NavLink>
                  );
                })}
              </div>
            )}

            {/* BTS Toggle Button */}
            <button
              onClick={() => setIsBtsExpanded(!isBtsExpanded)}
              className={`w-full flex items-center justify-between px-3 py-2 rounded-lg text-[16px] font-normal transition-colors mt-2 ${(pathname.startsWith('/annee-academique/moyennes-semestre') || pathname.startsWith('/annee-academique/horaires-examens')) ? 'bg-blue-600 text-white' : 'text-gray-300 hover:bg-gray-800 hover:text-white'}`}
            >
              <div className="flex items-center space-x-3">
                <GraduationCap className="w-5 h-5" />
                <span>BTS</span>
              </div>
              {isBtsExpanded ? (
                <ChevronDown className="w-5 h-5" />
              ) : (
                <ChevronRight className="w-5 h-5" />
              )}
            </button>

            {/* BTS Submenu */}
            {isBtsExpanded && (
              <div className="ml-4 mt-1 space-y-1">
                {btsMenuItems.map((item) => {
                  const Icon = item.icon;
                  const isActive = pathname === item.href;

                  return (
                        <NavLink
                      key={item.href}
                          href={item.href}
                          onCloseMobileMenu={onCloseMobileMenu}
                      className={`flex items-center space-x-3 px-3 py-2 rounded-lg text-[16px] font-normal transition-colors ${isActive ? 'bg-blue-600 text-white' : 'text-gray-300 hover:bg-gray-800 hover:text-white'}`}
                    >
                      <Icon className="w-5 h-5" />
                      <span>{item.label}</span>
                        </NavLink>
                  );
                })}
              </div>
            )}

            {/* Daily Operations Toggle Button */}
            <button
              onClick={() => setIsDailyOperationsExpanded(!isDailyOperationsExpanded)}
              className={`w-full flex items-center justify-between px-3 py-2 rounded-lg text-[16px] font-normal transition-colors mt-2 ${(pathname.startsWith('/attendance') || pathname.startsWith('/schedule-generation')) ? 'bg-blue-600 text-white' : 'text-gray-300 hover:bg-gray-800 hover:text-white'}`}
            >
              <div className="flex items-center space-x-3">
                <ClipboardCheck className="w-5 h-5" />
                <span>Post BTS</span>
              </div>
              {isDailyOperationsExpanded ? (
                <ChevronDown className="w-5 h-5" />
              ) : (
                <ChevronRight className="w-5 h-5" />
              )}
            </button>

            {/* Daily Operations Submenu */}
            {isDailyOperationsExpanded && (
              <div className="ml-4 mt-1 space-y-1">
                {dailyOperationsMenuItems.map((item) => {
                  const Icon = item.icon;
                  const isActive = pathname === item.href;

                  return (
                        <NavLink
                      key={item.href}
                          href={item.href}
                          onCloseMobileMenu={onCloseMobileMenu}
                      className={`flex items-center space-x-3 px-3 py-2 rounded-lg text-[16px] font-normal transition-colors ${isActive ? 'bg-blue-600 text-white' : 'text-gray-300 hover:bg-gray-800 hover:text-white'}`}
                    >
                      <Icon className="w-5 h-5" />
                      <span>{item.label}</span>
                        </NavLink>
                  );
                })}
              </div>
            )}

            {/* Catalogue Formations Section */}
            <div className="pt-2">
              <button
                onClick={() => setIsFormationsProExpanded(!isFormationsProExpanded)}
                className={`w-full flex items-center justify-between px-3 py-2 rounded-lg text-[16px] font-normal transition-colors ${isFormationsProExpanded ? 'bg-blue-600 text-white' : 'text-gray-300 hover:bg-gray-800 hover:text-white'}`}
              >
                <div className="flex items-center space-x-3">
                  <BookOpen className="w-5 h-5" />
                  <span>Catalogue Formations</span>
                </div>
                {isFormationsProExpanded ? (
                  <ChevronDown className="w-5 h-5" />
                ) : (
                  <ChevronRight className="w-5 h-5" />
                )}
              </button>

              {isFormationsProExpanded && (
                <div className="ml-4 mt-1 space-y-1">
                  {formationsProNavItems.map((item) => {
                    const Icon = item.icon;
                    const isActive = pathname === item.href;

                    return (
                      <NavLink
                        key={item.href}
                        href={item.href}
                        onCloseMobileMenu={onCloseMobileMenu}
                        className={`flex items-center space-x-3 px-3 py-2 rounded-lg text-[16px] font-normal transition-colors ${isActive ? 'bg-blue-600 text-white' : 'text-gray-300 hover:bg-gray-800 hover:text-white'}`}
                      >
                        <Icon className="w-5 h-5" />
                        <span>{item.label}</span>
                      </NavLink>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Administration Pro Section */}
            <div className="pt-2">
              <button
                onClick={() => setIsFormationsProAdminExpanded(!isFormationsProAdminExpanded)}
                className={`w-full flex items-center justify-between px-3 py-2 rounded-lg text-[16px] font-normal transition-colors ${isFormationsProAdminExpanded ? 'bg-blue-700 text-white' : 'text-gray-300 hover:bg-gray-800 hover:text-white'}`}
              >
                <div className="flex items-center space-x-3">
                  <Shield className="w-5 h-5" />
                  <span>Administration Pro</span>
                </div>
                {isFormationsProAdminExpanded ? (
                  <ChevronDown className="w-5 h-5" />
                ) : (
                  <ChevronRight className="w-5 h-5" />
                )}
              </button>

              {isFormationsProAdminExpanded && (
                <div className="ml-4 mt-1 space-y-1">
                  {formationsProAdminNavItems.map((item) => {
                    const Icon = item.icon;
                    const isActive = pathname.startsWith(item.href);

                    return (
                      <NavLink
                        key={item.href}
                        href={item.href}
                        onCloseMobileMenu={onCloseMobileMenu}
                        className={`flex items-center space-x-3 px-3 py-2 rounded-lg text-[16px] font-normal transition-colors ${isActive ? 'bg-blue-700 text-white' : 'text-gray-300 hover:bg-gray-800 hover:text-white'}`}
                      >
                        <Icon className="w-5 h-5" />
                        <span>{item.label}</span>
                      </NavLink>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
          )}

              {/* Teacher Payment Section */}
              {isAdmin && (
                    <div className="pt-4">
            <div className="px-3 mb-2">
              <h3 className="text-[11px] font-normal text-gray-400 uppercase tracking-wider">
                Rémunération Enseignants
              </h3>
            </div>

            {/* Teacher Payment Toggle Button */}
            <button
              onClick={() => setIsTeacherPaymentExpanded(!isTeacherPaymentExpanded)}
              className={`w-full flex items-center justify-between px-2 py-2 rounded-lg text-[16px] font-normal transition-colors ${pathname.startsWith('/payments') ? 'bg-blue-600 text-white' : 'text-gray-300 hover:bg-gray-800 hover:text-white'}`}
            >
              <div className="flex items-center space-x-2">
                <DollarSign className="w-5 h-5" />
                <span className="whitespace-nowrap">Rémunération Enseignants</span>
              </div>
              {isTeacherPaymentExpanded ? (
                <ChevronDown className="w-5 h-5" />
              ) : (
                <ChevronRight className="w-5 h-5" />
              )}
            </button>

            {/* Teacher Payment Submenu */}
            {isTeacherPaymentExpanded && (
              <div className="ml-4 mt-1 space-y-1">
                {teacherPaymentMenuItems.map((item) => {
                  const Icon = item.icon;
                  const isActive = pathname === item.href;

                  return (
                        <NavLink
                      key={item.href}
                          href={item.href}
                          onCloseMobileMenu={onCloseMobileMenu}
                      className={`flex items-center space-x-2 px-2 py-2 rounded-lg text-[16px] font-normal transition-colors ${isActive ? 'bg-blue-600 text-white' : 'text-gray-300 hover:bg-gray-800 hover:text-white'}`}
                    >
                      <Icon className="w-5 h-5" />
                      <span className="whitespace-nowrap">{item.label}</span>
                        </NavLink>
                  );
                })}
              </div>
            )}
          </div>
          )}



          {/* Student Finance Section - Only show for students */}
          {session?.user && (session as any).roles && (session as any).roles.includes('student') && (
            <div className="pt-4">
              <div className="px-3 mb-2">
                <h3 className="text-[11px] font-normal text-gray-400 uppercase tracking-wider">
                  Mes Finances
                </h3>
              </div>

              {/* Student Finance Toggle Button */}
              <button
                onClick={() => setIsStudentFinanceExpanded(!isStudentFinanceExpanded)}
                className={`w-full flex items-center justify-between px-3 py-2 rounded-lg text-[16px] font-normal transition-colors ${pathname.startsWith('/student-payments') ? 'bg-blue-600 text-white' : 'text-gray-300 hover:bg-gray-800 hover:text-white'}`}
              >
                <div className="flex items-center space-x-3">
                  <Wallet className="w-5 h-5" />
                  <span>Paiements & Reçus</span>
                </div>
                {isStudentFinanceExpanded ? (
                  <ChevronDown className="w-5 h-5" />
                ) : (
                  <ChevronRight className="w-5 h-5" />
                )}
              </button>

              {/* Student Finance Submenu */}
              {isStudentFinanceExpanded && (
                <div className="ml-4 mt-1 space-y-1">
                  {studentFinanceMenuItems.map((item) => {
                    const Icon = item.icon;
                    const isActive = pathname === item.href;

                    return (
                        <NavLink
                        key={item.href}
                          href={item.href}
                          onCloseMobileMenu={onCloseMobileMenu}
                        className={`flex items-center space-x-3 px-3 py-2 rounded-lg text-[16px] font-normal transition-colors ${isActive ? 'bg-blue-600 text-white' : 'text-gray-300 hover:bg-gray-800 hover:text-white'}`}
                      >
                        <Icon className="w-5 h-5" />
                        <span>{item.label}</span>
                        </NavLink>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* Student Finance Admin Section - Only show for admins */}
          {session?.user && (session as any).roles && (session as any).roles.some((role: string) => ['admin', 'super_admin'].includes(role)) && (
            <div className="pt-4">
              <div className="px-3 mb-2">
                <h3 className="text-[11px] font-normal text-gray-400 uppercase tracking-wider">
                  Finances Étudiantes
                </h3>
              </div>

              {/* Student Finance Admin Toggle Button */}
              <button
                onClick={() => setIsStudentFinanceAdminExpanded(!isStudentFinanceAdminExpanded)}
                className={`w-full flex items-center justify-between px-3 py-2 rounded-lg text-[16px] font-normal transition-colors ${pathname.startsWith('/admin/finances') ? 'bg-blue-600 text-white' : 'text-gray-300 hover:bg-gray-800 hover:text-white'}`}
              >
                <div className="flex items-center space-x-3">
                  <PieChart className="w-5 h-5" />
                  <span>Gestion Financière</span>
                </div>
                {isStudentFinanceAdminExpanded ? (
                  <ChevronDown className="w-5 h-5" />
                ) : (
                  <ChevronRight className="w-5 h-5" />
                )}
              </button>

              {/* Student Finance Admin Submenu */}
              {isStudentFinanceAdminExpanded && (
                <div className="ml-4 mt-1 space-y-1">
                  {studentFinanceAdminMenuItems.map((item) => {
                    const Icon = item.icon;
                    const isActive = pathname === item.href;

                    return (
                        <NavLink
                        key={item.href}
                          href={item.href}
                          onCloseMobileMenu={onCloseMobileMenu}
                        className={`flex items-center space-x-3 px-3 py-2 rounded-lg text-[16px] font-normal transition-colors ${isActive ? 'bg-blue-600 text-white' : 'text-gray-300 hover:bg-gray-800 hover:text-white'}`}
                      >
                        <Icon className="w-5 h-5" />
                        <span>{item.label}</span>
                        </NavLink>
                    );
                  })}
                </div>
              )}
            </div>
          )}

              {/* Admin Communication Section */}
              {isAdmin && (
                    <div className="pt-4">
                      <div className="px-3 mb-2">
                <h3 className="text-[11px] font-normal text-gray-400 uppercase tracking-wider">
                  Communication
                </h3>
              </div>

              <NavLink
                href="/admin/messages"
                onCloseMobileMenu={onCloseMobileMenu}
                className={`flex items-center space-x-3 px-3 py-2 rounded-lg text-[16px] font-normal transition-colors ${
                  pathname.startsWith('/admin/messages')
                    ? 'bg-blue-600 text-white'
                    : 'text-gray-300 hover:bg-gray-800 hover:text-white'
                }`}
              >
                <MessageSquare className="w-5 h-5" />
                <span>Messages</span>
              </NavLink>
            </div>
          )}
              {isAdmin && (
                    <div className="pt-4">
                      <div className="px-3 mb-2">
                <h3 className="text-[11px] font-normal text-gray-400 uppercase tracking-wider">
                  Administration
                </h3>
              </div>
              {adminQuickMenuItems.map((item) => {
                const Icon = item.icon;
                const isActive = pathname === item.href || pathname.startsWith(`${item.href}/`);
                return (
                  <NavLink
                    key={item.href}
                    href={item.href}
                    onCloseMobileMenu={onCloseMobileMenu}
                    className={`flex items-center space-x-3 px-3 py-2 rounded-lg text-[16px] font-normal transition-colors ${isActive ? 'bg-blue-600 text-white' : 'text-gray-300 hover:bg-gray-800 hover:text-white'}`}
                  >
                    <Icon className="w-5 h-5" />
                    <span>{item.label}</span>
                  </NavLink>
                );
              })}
            </div>
          )}
            </>
          )}
        </nav>
      </div>

      {/* User Account Section */}
      <div className="p-4 border-t border-gray-700">
        {session?.user && (
          <div className="space-y-3">
            {/* User Info */}
            <div className="flex items-center space-x-3">
              <div className="w-8 h-8 bg-gradient-to-r from-green-500 to-blue-500 rounded-full flex items-center justify-center">
                <span className="text-white font-normal text-xs">
                  {(session.user as any).firstName?.charAt(0).toUpperCase() || 'U'}
                </span>
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-white text-xs font-normal truncate">
                  {(session.user as any).firstName && (session.user as any).lastName
                    ? `${(session.user as any).firstName} ${(session.user as any).lastName}`
                    : (session.user as any).firstName || 'User'}
                </p>
                <p className="text-gray-400 text-xs truncate">
                  {session.user.email}
                </p>
              </div>
            </div>

            {/* Action Buttons */}
            <div className="flex space-x-2">
              <button className="flex items-center justify-center space-x-2 px-3 py-2 rounded-lg text-[16px] font-normal text-gray-300 hover:bg-gray-800 hover:text-white transition-colors flex-1">
                <Settings className="w-5 h-5" />
                <span>Settings</span>
              </button>
              <button
                onClick={handleLogout}
                className="flex items-center justify-center space-x-2 px-3 py-2 rounded-lg text-[16px] font-normal text-gray-300 hover:bg-red-600 hover:text-white transition-colors flex-1"
              >
                <LogOut className="w-5 h-5" />
                <span>Logout</span>
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}






