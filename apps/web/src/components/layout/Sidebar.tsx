"use client";

import React, { useState } from 'react';
import {
  LayoutDashboard,
  Users,
  GraduationCap,
  Settings,
  LogOut,
  BookOpen,
  Layers,
  Calendar,
  CalendarRange,
  CalendarClock,
  CalendarCheck,
  Banknote,
  BarChart3,
  ChevronDown,
  ChevronRight,
  ClipboardCheck,
  ClipboardList,
  FileSpreadsheet,
  DoorOpen,
  UserPlus,
  DollarSign,
  Calculator,
  FileText,
  CreditCard,
  TrendingUp,
  History,
  Receipt,
  ScrollText,
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
  ShieldAlert,
  List,
  Baby,
  Phone,
  X,
  PenLine,
  RotateCcw,
  Star,
  Radar,
  Compass,
  Briefcase,
  Coins
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { usePathname } from 'next/navigation';
import { useSession, signOut } from 'next-auth/react';
import Link from 'next/link';
import { removeToken, getToken } from '@/lib/jwt-storage';
import { useAdminMenuAccess } from '@/lib/hooks/use-admin-roles';
import { isAdminRole } from '@/lib/role-landing';

// Convention de ce fichier : toute icône du menu porte `shrink-0`. Les rangées
// sont des conteneurs flex où le libellé voisin ne se coupe pas ; sans cette
// classe, un libellé plus large que le volet écrase le SVG à zéro pixel et
// l'entrée apparaît sans icône. C'est arrivé sur « Configuration Enseignants ».

// « Home » (/) a été retiré du menu : la page d'accueil communautaire faisait
// doublon avec le tableau de bord, qui est désormais le point d'entrée unique.
const navigationItems = [
  { icon: LayoutDashboard, label: 'Tableau de bord', href: '/tableau-de-bord' as const },
];

type OwnerMenuLink = { icon: LucideIcon; label: string; href: string };

/** Un bloc du menu propriétaire : un intertitre facultatif et ses entrées. */
type OwnerMenuSection = { label: string | null; items: OwnerMenuLink[] };

/**
 * Espace propriétaire.
 *
 * LE MENU EST LE MIROIR DU MENU ADMINISTRATEUR. C'est la règle qui gouverne ce
 * bloc, et elle prime sur toute autre considération d'ergonomie.
 *
 * L'espace a longtemps été rangé par question de fondateur — Argent, Élèves,
 * Pédagogie, Offre, Pilotage. C'était cohérent en soi, mais le propriétaire et
 * ses administrateurs ne trouvaient plus la même chose au même endroit : quand
 * il demandait « où sont les commissions ? », personne ne pouvait le guider
 * depuis son propre écran. Les sections et leur ordre reprennent donc
 * exactement ceux de la barre administrateur — Structure académique, Module
 * professionnel, Scolarité, Prospection, Suivi & évaluation, Rémunération —
 * avec les mêmes mots.
 *
 * SOURCE DU MIROIR : les constantes de ce fichier (`academicStructureMenuItems`,
 * `professionalSessionsMenuItems`, `professionalStudentsMenuItems`, etc.), et
 * NON `ADMIN_MENU_CATALOG`. Les deux ont divergé : le catalogue ignore encore
 * « Classes », appelle « Classes » ce que la barre nomme « Ouvertures de
 * classe », et ne contient aucune des quatre entrées Rémunération. Le miroir
 * suit ce que le propriétaire voit à l'écran.
 *
 * « Pilotage » est le seul bloc sans équivalent administrateur : il porte ce
 * qui n'appartient à aucun domaine métier — la rentabilité, les points de
 * vigilance, les rapports, les accès.
 *
 * UNE SECTION NE PARAÎT QUE SI ELLE A UN ÉCRAN. Deux entrées du menu
 * administrateur n'a pas encore son pendant propriétaire : « Programme
 * (UE & ECUE) ». Elle n'est pas listée — une entrée qui mène à une page vide se
 * lit comme une école sans données, et coûte plus cher que son absence. Elle
 * arrivera avec son écran.
 *
 * Deux entrées ont rejoint la liste depuis le miroir :
 *   - « Inscriptions & effectifs inscrits » le 22/09/2026 — le trou le plus
 *     visible, la scolarité étant le poste le plus lourd de l'école et le seul
 *     qu'aucun écran propriétaire ne montrait ;
 *   - « Attestations, diplômes & signataires » le 23/09/2026, avec la section
 *     « Documents officiels » qui n'existait pas côté propriétaire. Elle porte
 *     un fait qu'aucun autre écran ne peut dire : les quatre signataires livrés
 *     par défaut sont des noms de personnes réelles, et un établissement qui ne
 *     les a pas remplacés imprime leur signature sur ses diplômes.
 *
 * LES ADRESSES SE RENOMMENT QUAND LEUR ÉCRAN EST REFONDU, jamais avant : une
 * URL renommée deux fois pose une redirection pour rien et change deux fois de
 * sens. Faits à ce jour, chacun avec sa redirection qui transmet les
 * paramètres — un favori doit rouvrir le même périmètre, pas l'écran nu :
 *
 *   - `/owner/remplissage` → `/owner/ouvertures` (23/09/2026), quand chaque
 *     ouverture est devenue une ligne économique et que le taux de remplissage
 *     n'a plus été qu'un indicateur parmi six ;
 *   - `/owner/referentiel` → `/owner/structure` (23/09/2026), quand chaque
 *     classe a porté son économie et que l'écran a cessé de décrire une table.
 *
 *   - `/owner/staff` → `/owner/remuneration` (23/09/2026), quand l écran a cessé
 *     de ne montrer qu une population pour montrer ce qui bloque son paiement.
 *
 * Tous les renommages prévus sont faits.
 *
 * Délibérément SANS groupes dépliants, contrairement au menu administrateur.
 * Un administrateur travaille dans une zone à la fois — replier les autres lui
 * fait gagner de la place. Un propriétaire, lui, balaie l'ensemble pour décider :
 * chaque repli lui cache une information qu'il veut voir d'un coup d'œil, et
 * chaque dépli est un clic entre lui et un chiffre.
 *
 * Aucune page de l'espace n'est hors menu. Les adresses absorbées
 * (`/owner/academique`, `/owner/finances/professionnel`)
 * survivent en redirections : les liens profonds du pouls y mènent encore.
 */
const ownerMenuSections: OwnerMenuSection[] = [
  {
    // Porte d'entrée de l'espace : pas d'intertitre, elle se suffit.
    label: null,
    items: [{ icon: BarChart3, label: 'Tableau de bord', href: '/owner/dashboard' }],
  },
  {
    label: 'Structure académique',
    items: [
      // Une seule entrée pour « Cycles », « Filières » et « Classes » : l'écran
      // les traite ensemble. Son libellé nomme les trois, pour qu'on le trouve
      // en cherchant n'importe lequel des trois mots.
      { icon: Layers, label: 'Cycles, filières & classes', href: '/owner/structure' },
      { icon: Users, label: 'Personnes', href: '/owner/personnes' },
    ],
  },
  {
    label: 'Module professionnel',
    items: [
      // « Ouvertures » et non « Remplissage » : le propriétaire et son
      // gestionnaire de scolarité doivent désigner la même chose du même mot.
      // Les trois entrées de la section administrateur — ouvertures, salles,
      // planning — vivent sur cet écran unique, et le libellé les nomme toutes
      // pour qu'on le trouve en cherchant n'importe laquelle.
      {
        icon: BookOpen,
        label: 'Programme (UE · ECUE · Semestres)',
        href: '/owner/programme',
      },
      { icon: Calendar, label: 'Ouvertures, salles & planning', href: '/owner/ouvertures' },
    ],
  },
  {
    label: 'Scolarité',
    items: [
      {
        icon: ClipboardList,
        label: 'Inscriptions & effectifs inscrits',
        href: '/owner/scolarite',
      },
      { icon: Wallet, label: 'Paiements', href: '/owner/finances' },
      { icon: DollarSign, label: 'Impayés', href: '/owner/finances/tresorerie' },
    ],
  },
  {
    label: 'Prospection',
    items: [
      { icon: Radar, label: 'Prospection & commissions', href: '/owner/prospection' },
    ],
  },
  {
    label: 'Suivi & évaluation',
    items: [
      { icon: ClipboardCheck, label: 'Présences', href: '/owner/assiduite' },
      { icon: FileSpreadsheet, label: 'Notes & bulletins', href: '/owner/pedagogie' },
    ],
  },
  {
    label: 'Documents officiels',
    items: [
      {
        icon: Award,
        label: 'Attestations, diplômes & signataires',
        href: '/owner/documents',
      },
    ],
  },
  {
    label: 'Rémunération',
    items: [
      { icon: Banknote, label: 'Séances, bulletins & masse salariale', href: '/owner/remuneration' },
    ],
  },
  {
    // Le seul bloc sans équivalent administrateur, et il vient en dernier :
    // ce sont des écrans de décision, pas de consultation quotidienne.
    label: 'Pilotage',
    items: [
      { icon: TrendingUp, label: 'Rentabilité', href: '/owner/economie' },
      { icon: ShieldAlert, label: 'Points de vigilance', href: '/owner/risque' },
      { icon: UserPlus, label: 'Recrutement', href: '/owner/recrutement' },
      { icon: FileText, label: 'Rapports', href: '/owner/finances/rapport' },
      { icon: Shield, label: 'Accès', href: '/owner/acces' },
    ],
  },
];

/**
 * Entrée active de l'espace propriétaire.
 *
 * Deux exceptions, sans lesquelles plusieurs entrées s'allumeraient ensemble :
 * « Tableau de bord » couvre aussi /owner, et « Paiements » ne doit s'allumer
 * que sur /owner/finances exactement — les deux routes qui vivent dessous
 * (« Impayés » en /tresorerie, « Rapports » en /rapport) ont chacune leur
 * propre entrée de menu.
 */
function isOwnerLinkActive(pathname: string, href: string): boolean {
  if (href === '/owner/dashboard') {
    return pathname === '/owner/dashboard' || pathname === '/owner';
  }
  if (href === '/owner/finances') {
    return pathname === '/owner/finances';
  }
  return pathname === href || pathname.startsWith(`${href}/`);
}

const adminQuickMenuItems = [
  { icon: Shield, label: 'Accès', href: '/owner/acces' as const },
  { icon: List, label: 'Rôles', href: '/admin/roles' as const },
  { icon: Users, label: 'Utilisateurs', href: '/admin/utilisateurs' as const },
];

// Core Academic Structure Management
// « Vue d'ensemble » (clé `academic.overview`) a été remplacée par le tableau de
// bord administrateur : elle est rendue en haut du menu (`navigationItems`).
// « Types de Bilan » et « Matières » sont sortis du menu (les pages restent
// atteignables par URL) — cf. migration 0095.
const academicStructureMenuItems = [
  { icon: GraduationCap, label: 'Cycles', href: '/academic/cycles' as const },
  { icon: BookOpen, label: 'Filières', href: '/academic/programmes' as const },
  { icon: Layers, label: 'Classes', href: '/academic/classes' as const },
];

// Module Professionnel (Filière → UE → ECUE), découpé en sous-menus dépliants.
// Le découpage doit rester aligné sur les groupes de `ADMIN_MENU_CATALOG`
// (packages/contracts) : c'est le même classement qui s'affiche sur la page
// « Accès → Menus par rôle ».
const professionalProgrammeMenuItems = [
  { icon: Layers, label: 'UE', href: '/professionnel/admin/ue' as const },
  { icon: BookOpen, label: 'ECUE', href: '/professionnel/admin/matieres' as const },
  { icon: CalendarRange, label: 'Semestres', href: '/professionnel/admin/semestres' as const },
];

const professionalSessionsMenuItems = [
  { icon: Calendar, label: 'Ouvertures de classe', href: '/professionnel/admin/sessions' as const },
  { icon: DoorOpen, label: 'Salles de classe', href: '/academic/classrooms' as const },
  { icon: CalendarClock, label: 'Planning des cours', href: '/professionnel/admin/planning' as const },
];

// L'argent de l'étudiant se règle ici, au plus près de son inscription :
// « Scolarité » fixe le barème de la classe, « Paiements » l'encaisse, et la
// scolarité ouvre la marche puisqu'on la fixe AVANT d'inscrire qui que ce soit.
// L'ancienne page /professionnel/admin/paiements, qui ne facturait que les UE,
// a été supprimée — elle ignorait inscription, frais annexes et autres frais.
const professionalStudentsMenuItems = [
  { icon: Calendar, label: 'Scolarité', href: '/admin/finances/scolarite' as const },
  { icon: UserPlus, label: 'Inscriptions', href: '/professionnel/admin/inscriptions' as const },
  { icon: Users, label: 'Étudiants inscrits', href: '/professionnel/admin/inscrits' as const },
  { icon: Wallet, label: 'Paiements', href: '/admin/finances/student-payments' as const },
];

// Prospection : d'où viennent les étudiants et ce qui est dû aux commerciaux.
// Rangée juste après « Étudiants » : c'est au moment d'inscrire que la
// provenance se saisit.
const professionalProspectionMenuItems = [
  { icon: Radar, label: 'Tableau de bord', href: '/professionnel/admin/prospection' as const },
  {
    icon: Compass,
    label: 'Amenés par un commercial',
    href: '/professionnel/admin/prospection/provenances' as const,
  },
  {
    icon: Briefcase,
    label: 'Commerciaux',
    href: '/professionnel/admin/prospection/commerciaux' as const,
  },
  {
    icon: Coins,
    label: 'Commissions à payer',
    href: '/professionnel/admin/prospection/commissions/historique' as const,
  },
  {
    icon: History,
    label: 'Commissions payées',
    href: '/professionnel/admin/prospection/commissions/historique/payees' as const,
  },
];

const professionalTrackingMenuItems = [
  { icon: ClipboardCheck, label: 'Présences', href: '/professionnel/admin/presences' as const },
  { icon: Star, label: 'Conduite', href: '/professionnel/admin/conduite' as const },
  { icon: ClipboardList, label: 'Notes', href: '/professionnel/admin/notes' as const },
  { icon: RotateCcw, label: 'Rattrapages', href: '/professionnel/admin/notes/rattrapages' as const },
  { icon: FileSpreadsheet, label: 'Bulletins', href: '/professionnel/admin/bulletins' as const },
];

const professionalDocumentsMenuItems = [
  { icon: Award, label: 'Attestations de réussite', href: '/professionnel/admin/attestations' as const },
  { icon: GraduationCap, label: 'Diplômes', href: '/professionnel/admin/diplomes' as const },
  { icon: PenLine, label: 'Signataires', href: '/professionnel/admin/signataires' as const },
];

// People Management
// « Inscriptions en ligne » est sortie du menu (page toujours atteignable par
// URL) — cf. migration 0095.
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
  // « Périodes de Paiement » est masqué du menu : les périodes se créent
  // désormais depuis « Bulletin de paiement », où elles sont bornées par le
  // verrou d'unicité. La page reste atteignable par URL.

  // Feature 031 — les écrans du Module Professionnel sont fondus dans ce groupe
  // plutôt que dans un second menu de paie : côte à côte, les deux donnaient
  // deux endroits où chercher le même bulletin. L'ordre suit le parcours :
  // configurer qui est payable, valider les séances qui donnent les heures,
  // puis générer les bulletins qui les consomment.
  { icon: Settings, label: 'Configuration', href: '/payments/teacher-configs' as const },
  { icon: CalendarCheck, label: 'Validation des séances', href: '/professionnel/admin/remuneration/seances' as const },
  // Masqués du menu, comme « Périodes de Paiement » : ces trois écrans sont
  // l'ancien parcours de paie académique, doublonné par « Bulletin de paiement »
  // qui génère et archive en un endroit. Les pages restent atteignables par URL.
  // { icon: Clock, label: 'Validation des Heures', href: '/payments/teaching-hours' as const },
  // { icon: Calculator, label: 'Calcul des Paiements', href: '/payments/calculate' as const },
  // { icon: DollarSign, label: 'Gestion des Paiements', href: '/payments/manage' as const },
  { icon: ScrollText, label: 'Bulletin de paiement', href: '/professionnel/admin/remuneration/bulletins' as const },
  // Consultation, pas une étape du parcours : dernière de la liste.
  { icon: History, label: 'Historique des paiements', href: '/professionnel/admin/remuneration/historique' as const },
];

// Student Finance (for students)
const studentFinanceMenuItems = [
  { icon: Wallet, label: 'Mes Paiements', href: '/student-payments' as const },
];

// Student Finance Management (for admins)
const studentFinanceAdminMenuItems = [
  // { icon: PieChart, label: 'Tableau de Bord', href: '/admin/finances' as const }, // Masqu?
  // « Scolarité » et « Paiements Étudiants » sont passés dans le bloc Étudiants
  // du module professionnel : c'est là qu'on inscrit, donc là qu'on encaisse.
  { icon: Calendar, label: 'Échéanciers', href: '/admin/finances/tuition-schedules' as const },
  // { icon: TrendingUp, label: 'Analyses Financi?res', href: '/admin/finances/analytics' as const }, // Masqu?
  { icon: FileText, label: 'Rapports Financiers', href: '/admin/finances/reports' as const },
];

// Student Academic Menu Items
const studentAcademicMenuItems = [
  { icon: BookOpen, label: 'Mes Cours', href: '/student/courses' as const },
  { icon: Calendar, label: 'Emploi du Temps', href: '/student/schedule' as const },
  { icon: FileText, label: 'Devoirs', href: '/student/assignments' as const },
  { icon: Award, label: 'Mes Notes', href: '/student/grades' as const },
  // « Mon Bulletin » (/student/bulletin) est retiré du menu : son contenu est
  // repris par l'onglet Bulletins de « Bulletins & Reçus ». La page reste
  // accessible par lien direct (Mes Notes, Mes Rattrapages).
  { icon: FileText, label: 'Bulletins & Reçus', href: '/student/documents' as const },
  { icon: TrendingUp, label: 'Ma progression', href: '/student/progression' as const },
  { icon: Award, label: 'Mes diplômes', href: '/student/diplomes' as const },
  { icon: CalendarCheck, label: 'Présences & absences', href: '/professionnel/etudiant/presences' as const },
  { icon: RotateCcw, label: 'Mes Rattrapages', href: '/professionnel/etudiant/rattrapages' as const },
  { icon: BookOpen, label: 'Module Professionnel', href: '/professionnel/etudiant' as const },
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
  { icon: ClipboardList, label: 'Notes', href: '/professionnel/admin/notes' as const },
];

// Teacher Students Menu Items
const teacherStudentsMenuItems = [
  { icon: Users, label: 'Liste des Étudiants', href: '/teacher/students' as const },
  // { icon: TrendingUp, label: 'Suivi Individuel', href: '/teacher/student-tracking' as const },
  { icon: MessageSquare, label: 'Communications', href: '/teacher/communications' as const },
];

// Teacher Evaluations Menu Items
const teacherEvaluationsMenuItems = [
  { icon: FileText, label: 'Mes évaluations', href: '/teacher/assignments/create' as const },
  // { icon: List, label: 'Liste des Devoirs', href: '/teacher/assignments/list' as const },
  { icon: Users, label: 'Assigner un devoir', href: '/academic/assignments/assign' as const },
  { icon: Edit, label: 'Corrections en Attente', href: '/teacher/corrections' as const },
];

// Teacher Remuneration Menu Items
const teacherRemunerationMenuItems = [
  { icon: Clock, label: 'Heures Enseignées', href: '/teacher/hours' as const },
  { icon: DollarSign, label: 'Mes Paiements', href: '/teacher/payments' as const },
  // Masquée du menu, comme leurs équivalents côté administration : la page
  // reste atteignable par URL.
  // { icon: CalendarCheck, label: 'Séances Professionnelles', href: '/teacher/professional-seances' as const },
  // Miroir en lecture seule des écrans de paie de l'administration : mêmes
  // libellés, périmètre réduit à l'enseignant connecté. « Validation des
  // séances » et « Bulletin de paiement » n'ont pas d'équivalent ici — ce sont
  // des actes de gestion, pas des consultations.
  { icon: Settings, label: 'Configuration', href: '/teacher/remuneration/configuration' as const },
  { icon: History, label: 'Historique des paiements', href: '/teacher/remuneration/historique' as const },
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
  { icon: CalendarClock, label: 'Emploi du temps', href: '/parent/schedule' as const },
  { icon: BookOpen, label: 'Cours & Devoirs', href: '/parent/homework' as const },
  { icon: FileText, label: 'Bulletins & Reçus', href: '/parent/documents' as const },
  { icon: TrendingUp, label: 'Progression de mon enfant', href: '/parent/progression' as const },
  { icon: CalendarCheck, label: 'Présences & absences', href: '/parent/presences' as const },
  { icon: RotateCcw, label: 'Rattrapages de mon enfant', href: '/parent/rattrapages' as const },
  { icon: MessageSquare, label: 'Messages', href: '/parent/messages' as const },
  { icon: Award, label: 'Diplômes de mon enfant', href: '/parent/professionnel/diplomes' as const },
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

/**
 * Sous-menu dépliant du Module Professionnel (Programme, Étudiants, …).
 *
 * Le groupe est mis en évidence et ouvert d'emblée quand la page courante lui
 * appartient — l'appartenance se déduit des `href` du groupe, il n'y a donc
 * aucune liste de préfixes à maintenir en parallèle. Même rendu que les
 * sous-menus « Cycles & Programmes » / « Personnes ».
 */
const ProfessionalModuleGroup = ({
  label,
  icon: GroupIcon,
  items,
  pathname,
  onCloseMobileMenu,
  className = '',
}: {
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  items: ReadonlyArray<{ icon: React.ComponentType<{ className?: string }>; label: string; href: string }>;
  pathname: string;
  onCloseMobileMenu?: () => void;
  className?: string;
}) => {
  const matchesHref = (href: string) => pathname === href || pathname.startsWith(`${href}/`);
  // Deux entrées d'un même groupe peuvent être imbriquées (« Rattrapages » vit
  // sous /professionnel/admin/notes/…) : seule la plus spécifique s'allume.
  const isItemActive = (href: string) =>
    matchesHref(href) &&
    !items.some((other) => other.href.length > href.length && matchesHref(other.href));
  const containsActivePage = items.some((item) => matchesHref(item.href));
  const [isExpanded, setIsExpanded] = useState(containsActivePage);

  // Le sidebar n'est pas remonté d'une page à l'autre : sans cet effet, arriver
  // sur une page d'un autre groupe le mettrait en surbrillance tout en le
  // laissant replié. Le repli manuel reste possible ensuite.
  React.useEffect(() => {
    if (containsActivePage) setIsExpanded(true);
  }, [containsActivePage]);

  if (items.length === 0) return null;

  return (
    <>
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className={`w-full flex items-center justify-between px-3 py-2 rounded-lg text-[16px] font-normal transition-colors ${className} ${containsActivePage ? 'bg-blue-600 text-white' : 'text-gray-300 hover:bg-gray-800 hover:text-white'}`}
      >
        <div className="flex items-center space-x-3">
          <GroupIcon className="w-5 h-5 shrink-0" />
          <span>{label}</span>
        </div>
        {isExpanded ? (
          <ChevronDown className="w-5 h-5 shrink-0" />
        ) : (
          <ChevronRight className="w-5 h-5 shrink-0" />
        )}
      </button>

      {isExpanded && (
        <div className="ml-4 mt-1 space-y-1">
          {items.map((item) => {
            const Icon = item.icon;
            const isActive = isItemActive(item.href);

            return (
              <NavLink
                key={item.href}
                href={item.href}
                onCloseMobileMenu={onCloseMobileMenu}
                className={`flex items-center space-x-3 px-3 py-2 rounded-lg text-[16px] font-normal transition-colors ${isActive ? 'bg-blue-600 text-white' : 'text-gray-300 hover:bg-gray-800 hover:text-white'}`}
              >
                <Icon className="w-5 h-5 shrink-0" />
                <span>{item.label}</span>
              </NavLink>
            );
          })}
        </div>
      )}
    </>
  );
};

export function Sidebar({ onCloseMobileMenu }: SidebarProps) {
  const pathname = usePathname();
  const { data: session } = useSession();

  // Rôles
  const roles = (session as any)?.roles ?? [];
  // Même définition que le garde de `/tableau-de-bord` : l'entrée de menu et
  // l'accès à la page doivent apparaître et disparaître ensemble.
  const isAdmin = isAdminRole(roles);
  const isStudent = Array.isArray(roles) && roles.some((r: string) => ['student', 'Étudiant'].includes(r));
  const isTeacher = Array.isArray(roles) && roles.some((r: string) => ['teacher', 'Enseignant'].includes(r));
  const isParent = Array.isArray(roles) && roles.some((r: string) => ['parent', 'Parent'].includes(r));
  const isOwner =
    Array.isArray(roles) && roles.some((r: string) => String(r).toLowerCase() === 'owner');

  // Menus autorisés pour cet utilisateur : liste blanche de son rôle
  // administratif (page « Administration → Rôles ») ET menus retirés à ses rôles
  // socle (page « Accès → Menus par rôle »). Sans configuration, `canSeeHref`
  // renvoie toujours true : le sidebar reste identique pour les comptes existants.
  const { canSeeHref } = useAdminMenuAccess();
  const canSeeAdmin = (href: string) => canSeeHref('admin', href);

  // Entrées du sidebar administrateur filtrées par les permissions du rôle.
  const visibleAcademicStructureItems = academicStructureMenuItems.filter((item) =>
    canSeeAdmin(item.href)
  );
  const visiblePeopleItems = peopleMenuItems.filter((item) => canSeeAdmin(item.href));
  const visibleProfessionalProgrammeItems = professionalProgrammeMenuItems.filter((item) =>
    canSeeAdmin(item.href)
  );
  const visibleProfessionalSessionsItems = professionalSessionsMenuItems.filter((item) =>
    canSeeAdmin(item.href)
  );
  const visibleProfessionalStudentsItems = professionalStudentsMenuItems.filter((item) =>
    canSeeAdmin(item.href)
  );
  const visibleProfessionalProspectionItems = professionalProspectionMenuItems.filter((item) =>
    canSeeAdmin(item.href)
  );
  const visibleProfessionalTrackingItems = professionalTrackingMenuItems.filter((item) =>
    canSeeAdmin(item.href)
  );
  const visibleProfessionalDocumentsItems = professionalDocumentsMenuItems.filter((item) =>
    canSeeAdmin(item.href)
  );
  const visibleAcademicOperationsItems = academicOperationsMenuItems.filter((item) =>
    canSeeAdmin(item.href)
  );
  const visibleBtsItems = btsMenuItems.filter((item) => canSeeAdmin(item.href));
  const visibleDailyOperationsItems = dailyOperationsMenuItems.filter((item) =>
    canSeeAdmin(item.href)
  );
  const visibleTeacherPaymentItems = teacherPaymentMenuItems.filter((item) =>
    canSeeAdmin(item.href)
  );
  // Le groupe mêle deux familles de routes depuis la fusion : la paie partagée
  // (/payments) et les écrans 031 du Module Professionnel. Sans ce second
  // préfixe, y arriver laisse le menu replié et non surligné.
  const isTeacherPaymentRoute =
    pathname.startsWith('/payments') ||
    pathname.startsWith('/professionnel/admin/remuneration');
  const visibleStudentFinanceAdminItems = studentFinanceAdminMenuItems.filter((item) =>
    canSeeAdmin(item.href)
  );
  // « Accès » figure désormais dans le bloc Propriétaire. Le laisser aussi ici
  // l'afficherait deux fois à un compte cumulant les deux rôles.
  const visibleAdminQuickItems = adminQuickMenuItems.filter(
    (item) => canSeeAdmin(item.href) && !(isOwner && item.href === '/owner/acces')
  );
  const canSeeAdminMessages = canSeeAdmin('/admin/messages');

  // Espaces enseignant / étudiant / parent : mêmes règles, appliquées
  // dans leur propre périmètre de catalogue.
  const visibleTeacherDashboardItems = teacherMenuItems.filter((item) =>
    canSeeHref('teacher', item.href)
  );
  const visibleTeacherCoursesItems = teacherCoursesMenuItems.filter((item) =>
    canSeeHref('teacher', item.href)
  );
  const visibleTeacherStudentsItems = teacherStudentsMenuItems.filter((item) =>
    canSeeHref('teacher', item.href)
  );
  const visibleTeacherEvaluationsItems = teacherEvaluationsMenuItems.filter((item) =>
    canSeeHref('teacher', item.href)
  );
  const visibleTeacherRemunerationItems = teacherRemunerationMenuItems.filter((item) =>
    canSeeHref('teacher', item.href)
  );
  const visibleTeacherReportsItems = teacherReportsMenuItems.filter((item) =>
    canSeeHref('teacher', item.href)
  );
  const visibleTeacherProfileItems = teacherProfileMenuItems.filter((item) =>
    canSeeHref('teacher', item.href)
  );
  const visibleStudentAcademicItems = studentAcademicMenuItems.filter((item) =>
    canSeeHref('student', item.href)
  );
  const visibleStudentAssistanceItems = studentAssistanceMenuItems.filter((item) =>
    canSeeHref('student', item.href)
  );
  const visibleStudentProfileItems = studentProfileMenuItems.filter((item) =>
    canSeeHref('student', item.href)
  );
  const visibleStudentFinanceItems = studentFinanceMenuItems.filter((item) =>
    canSeeHref('student', item.href)
  );
  const canSeeStudentMessages = canSeeHref('student', '/student/messages');
  const visibleParentItems = parentMenuItems.filter((item) => canSeeHref('parent', item.href));

  const showAcademicStructureSection =
    visibleAcademicStructureItems.length > 0 || visiblePeopleItems.length > 0;
  const showProfessionalModuleSection =
    visibleProfessionalProgrammeItems.length > 0 ||
    visibleProfessionalSessionsItems.length > 0 ||
    visibleProfessionalStudentsItems.length > 0 ||
    visibleProfessionalProspectionItems.length > 0 ||
    visibleProfessionalTrackingItems.length > 0 ||
    visibleProfessionalDocumentsItems.length > 0;
  const showAcademicOperationsSection =
    visibleAcademicOperationsItems.length > 0 ||
    visibleBtsItems.length > 0 ||
    visibleDailyOperationsItems.length > 0;

  const [isAcademicStructureExpanded, setIsAcademicStructureExpanded] = useState(
    pathname.startsWith('/academic/cycles') ||
    pathname.startsWith('/academic/programmes') ||
    pathname.startsWith('/academic/classes')
  );
  const [isPeopleExpanded, setIsPeopleExpanded] = useState(
    pathname.startsWith('/academic/teachers') ||
    pathname.startsWith('/academic/students') ||
    pathname.startsWith('/academic/parents')
  );
  const [isAcademicOperationsExpanded, setIsAcademicOperationsExpanded] = useState(
    pathname.startsWith('/annee-academique') || pathname.startsWith('/academic/assignments')
  );
  const [isBtsExpanded, setIsBtsExpanded] = useState(
    pathname.startsWith('/annee-academique/moyennes-semestre')
  );
  const [isDailyOperationsExpanded, setIsDailyOperationsExpanded] = useState(
    pathname.startsWith('/attendance') || pathname.startsWith('/schedule-generation')
  );
  const [isTeacherPaymentExpanded, setIsTeacherPaymentExpanded] = useState(
    isTeacherPaymentRoute
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
    pathname.startsWith('/student/assignments') || pathname.startsWith('/student/grades') ||
    pathname.startsWith('/professionnel/etudiant')
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
    pathname.startsWith('/teacher/payslips') || pathname.startsWith('/teacher/config') ||
    // Sans ce préfixe, arriver sur un écran du groupe laisse le menu replié et
    // l'entrée non surlignée.
    pathname.startsWith('/teacher/remuneration')
  );
  const [isTeacherReportsExpanded, setIsTeacherReportsExpanded] = useState(
    pathname.startsWith('/teacher/reports')
  );

  // Parent menu states
  const [isParentChildrenExpanded, setIsParentChildrenExpanded] = useState(
    pathname.startsWith('/parent/children')
  );

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
              'Content-Type': 'application/json',
            },
            body: '{}',
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
            <X className="h-5 w-5 shrink-0" />
          </button>
        )}
      </div>

      <div className="flex-1 py-4 overflow-y-auto">
        <nav className="space-y-1 px-2">
          {/* Main Navigation */}
          {/* « Tableau de bord » porte la clé de catalogue `academic.overview`
              (ex « Vue d'ensemble » /academic) : il se filtre donc comme les
              autres entrées administratives. Réservé à l'administration : les
              autres profils ont leur propre tableau de bord (voir le garde de
              `app/tableau-de-bord/layout.tsx`). */}
          {isAdmin && navigationItems.filter((item) => canSeeAdmin(item.href)).map((item) => {
            const Icon = item.icon;
            const isActive = pathname === item.href;

            return (
              <NavLink
                key={item.href}
                href={item.href}
                onCloseMobileMenu={onCloseMobileMenu}
                className={`flex items-center space-x-3 px-3 py-2 rounded-lg text-[16px] font-normal transition-colors ${isActive ? 'bg-blue-600 text-white' : 'text-gray-300 hover:bg-gray-800 hover:text-white'}`}
              >
                <Icon className="w-5 h-5 shrink-0" />
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
              {ownerMenuSections.map((section) => (
                <div key={section.label ?? '__entree__'} className="space-y-1">
                  {/* Intertitre discret : il sépare sans ajouter de clic. */}
                  {section.label && (
                    <div className="px-3 pt-2 pb-0.5">
                      <span className="text-[10px] font-normal uppercase tracking-wider text-gray-500">
                        {section.label}
                      </span>
                    </div>
                  )}
                  {section.items.map((item) => {
                    const Icon = item.icon;
                    const isActive = isOwnerLinkActive(pathname, item.href);
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
                        <Icon className="w-5 h-5 shrink-0" />
                        <span>{item.label}</span>
                      </NavLink>
                    );
                  })}
                </div>
              ))}
            </div>
          )}

          <>
              {/* Student Navigation */}
              {isStudent && (
                <>
              {/* Student Academic Section */}
              {visibleStudentAcademicItems.length > 0 && (
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
                    <BookOpen className="w-5 h-5 shrink-0" />
                    <span>Mes Études</span>
                  </div>
                  {isStudentAcademicExpanded ? (
                    <ChevronDown className="w-5 h-5 shrink-0" />
                  ) : (
                    <ChevronRight className="w-5 h-5 shrink-0" />
                  )}
                </button>

                {/* Academic Submenu */}
                {isStudentAcademicExpanded && (
                  <div className="ml-4 mt-1 space-y-1">
                    {visibleStudentAcademicItems.map((item) => {
                      const Icon = item.icon;
                      const isActive = pathname === item.href;

                      return (
                        <NavLink
                          key={item.href}
                          href={item.href}
                          onCloseMobileMenu={onCloseMobileMenu}
                          className={`flex items-center space-x-3 px-3 py-2 rounded-lg text-[16px] font-normal transition-colors ${isActive ? 'bg-emerald-600 text-white' : 'text-gray-300 hover:bg-gray-800 hover:text-white'}`}
                        >
                          <Icon className="w-5 h-5 shrink-0" />
                          <span>{item.label}</span>
                        </NavLink>
                      );
                    })}
                  </div>
                )}
              </div>
)}

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
                    <Play className="w-5 h-5 shrink-0" />
                    <span>Apprentissage</span>
                  </div>
                  {isStudentELearningExpanded ? (
                    <ChevronDown className="w-5 h-5 shrink-0" />
                  ) : (
                    <ChevronRight className="w-5 h-5 shrink-0" />
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
                          <Icon className="w-5 h-5 shrink-0" />
                          <span>{item.label}</span>
                        </NavLink>
                      );
                    })}
                  </div>
                )}
              </div> */}

              {/* Student Communication Section */}
              {canSeeStudentMessages && (
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
                  <MessageSquare className="w-5 h-5 shrink-0" />
                  <span>Messages</span>
                </NavLink>
              </div>
)}

              {/* Student Assistance Section */}
              {visibleStudentAssistanceItems.length > 0 && (
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
                    <Bot className="w-5 h-5 shrink-0" />
                    <span>Aide & Support</span>
                  </div>
                  {isStudentAssistanceExpanded ? (
                    <ChevronDown className="w-5 h-5 shrink-0" />
                  ) : (
                    <ChevronRight className="w-5 h-5 shrink-0" />
                  )}
                </button>

                {/* Assistance Submenu */}
                {isStudentAssistanceExpanded && (
                  <div className="ml-4 mt-1 space-y-1">
                    {visibleStudentAssistanceItems.map((item) => {
                      const Icon = item.icon;
                      const isActive = pathname === item.href;

                      return (
                        <NavLink
                          key={item.href}
                          href={item.href}
                          onCloseMobileMenu={onCloseMobileMenu}
                          className={`flex items-center space-x-3 px-3 py-2 rounded-lg text-[16px] font-normal transition-colors ${isActive ? 'bg-emerald-600 text-white' : 'text-gray-300 hover:bg-gray-800 hover:text-white'}`}
                        >
                          <Icon className="w-5 h-5 shrink-0" />
                          <span>{item.label}</span>
                        </NavLink>
                      );
                    })}
                  </div>
                )}
              </div>
)}

              {/* Student Profile Section */}
              {visibleStudentProfileItems.length > 0 && (
<div className="pt-4">
                {visibleStudentProfileItems.map((item) => {
                  const Icon = item.icon;
                  const isActive = pathname === item.href;

                  return (
                    <NavLink
                      key={item.href}
                      href={item.href}
                      onCloseMobileMenu={onCloseMobileMenu}
                      className={`flex items-center space-x-3 px-3 py-2 rounded-lg text-[16px] font-normal transition-colors mb-1 ${isActive ? 'bg-emerald-600 text-white' : 'text-gray-300 hover:bg-gray-800 hover:text-white'}`}
                    >
                      <Icon className="w-5 h-5 shrink-0" />
                      <span>{item.label}</span>
                    </NavLink>
                  );
                })}
              </div>
)}
                </>
              )}
              {/* Parent Navigation */}
              {isParent && (
                <>
                  {/* Parent Children Section */}
                  {visibleParentItems.length > 0 && (
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
                    <Baby className="w-5 h-5 shrink-0" />
                    <span>Mes Enfants</span>
                  </div>
                  {isParentChildrenExpanded ? (
                    <ChevronDown className="w-5 h-5 shrink-0" />
                  ) : (
                    <ChevronRight className="w-5 h-5 shrink-0" />
                  )}
                </button>

                {/* Parent Children Submenu */}
                {isParentChildrenExpanded && (
                  <div className="ml-4 mt-1 space-y-1">
                    {visibleParentItems.map((item) => {
                      const Icon = item.icon;
                      const isActive = pathname === item.href || pathname.startsWith(`${item.href}/`);

                      return (
                        <NavLink
                          key={item.href}
                          href={item.href}
                          onCloseMobileMenu={onCloseMobileMenu}
                          className={`flex items-center space-x-3 px-3 py-2 rounded-lg text-[16px] font-normal transition-colors ${isActive ? 'bg-emerald-600 text-white' : 'text-gray-300 hover:bg-gray-800 hover:text-white'}`}
                        >
                          <Icon className="w-5 h-5 shrink-0" />
                          <span>{item.label}</span>
                        </NavLink>
                      );
                    })}
                  </div>
                )}
              </div>
)}

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
                  <Settings className="w-5 h-5 shrink-0" />
                  <span>{parentSettingsMenuItem.label}</span>
                </NavLink>
                  </div> */}
                </>
              )}

              {/* Teacher Navigation */}
              {isTeacher && (
                <>
                  {/* Teacher Dashboard */}
              {visibleTeacherDashboardItems.map((item) => {
                const Icon = item.icon;
                const isActive = pathname === item.href;

                return (
                  <NavLink
                    key={item.href}
                    href={item.href}
                    onCloseMobileMenu={onCloseMobileMenu}
                    className={`flex items-center space-x-3 px-3 py-2 rounded-lg text-[16px] font-normal transition-colors mt-4 ${isActive ? 'bg-purple-600 text-white' : 'text-gray-300 hover:bg-gray-800 hover:text-white'}`}
                  >
                    <Icon className="w-5 h-5 shrink-0" />
                    <span>{item.label}</span>
                  </NavLink>
                );
              })}

              {/* Teacher Courses Section */}
              {visibleTeacherCoursesItems.length > 0 && (
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
                    <BookOpen className="w-5 h-5 shrink-0" />
                    <span>Gestion des Cours</span>
                  </div>
                  {isTeacherCoursesExpanded ? (
                    <ChevronDown className="w-5 h-5 shrink-0" />
                  ) : (
                    <ChevronRight className="w-5 h-5 shrink-0" />
                  )}
                </button>

                {isTeacherCoursesExpanded && (
                  <div className="ml-4 mt-1 space-y-1">
                    {visibleTeacherCoursesItems.map((item) => {
                      const Icon = item.icon;
                      const isActive = pathname === item.href;

                      return (
                        <NavLink
                          key={item.href}
                          href={item.href}
                          onCloseMobileMenu={onCloseMobileMenu}
                          className={`flex items-center space-x-3 px-3 py-2 rounded-lg text-[16px] font-normal transition-colors ${isActive ? 'bg-purple-600 text-white' : 'text-gray-300 hover:bg-gray-800 hover:text-white'}`}
                        >
                          <Icon className="w-5 h-5 shrink-0" />
                          <span>{item.label}</span>
                        </NavLink>
                      );
                    })}
                  </div>
                )}
              </div>
)}

              {/* Teacher Students Section */}
              {visibleTeacherStudentsItems.length > 0 && (
<div className="pt-2">
                <button
                  onClick={() => setIsTeacherStudentsExpanded(!isTeacherStudentsExpanded)}
                  className={`w-full flex items-center justify-between px-3 py-2 rounded-lg text-[16px] font-normal transition-colors ${isTeacherStudentsExpanded ? 'bg-purple-600 text-white' : 'text-gray-300 hover:bg-gray-800 hover:text-white'}`}
                >
                  <div className="flex items-center space-x-3">
                    <Users className="w-5 h-5 shrink-0" />
                    <span>Mes Étudiants</span>
                  </div>
                  {isTeacherStudentsExpanded ? (
                    <ChevronDown className="w-5 h-5 shrink-0" />
                  ) : (
                    <ChevronRight className="w-5 h-5 shrink-0" />
                  )}
                </button>

                {isTeacherStudentsExpanded && (
                  <div className="ml-4 mt-1 space-y-1">
                    {visibleTeacherStudentsItems.map((item) => {
                      const Icon = item.icon;
                      const isActive = pathname === item.href;

                      return (
                        <NavLink
                          key={item.href}
                          href={item.href}
                          onCloseMobileMenu={onCloseMobileMenu}
                          className={`flex items-center space-x-3 px-3 py-2 rounded-lg text-[16px] font-normal transition-colors ${isActive ? 'bg-purple-600 text-white' : 'text-gray-300 hover:bg-gray-800 hover:text-white'}`}
                        >
                          <Icon className="w-5 h-5 shrink-0" />
                          <span>{item.label}</span>
                        </NavLink>
                      );
                    })}
                  </div>
                )}
              </div>
)}

              {/* Teacher Evaluations Section */}
              {visibleTeacherEvaluationsItems.length > 0 && (
<div className="pt-2">
                <button
                  onClick={() => setIsTeacherEvaluationsExpanded(!isTeacherEvaluationsExpanded)}
                  className={`w-full flex items-center justify-between px-3 py-2 rounded-lg text-[16px] font-normal transition-colors ${isTeacherEvaluationsExpanded ? 'bg-purple-600 text-white' : 'text-gray-300 hover:bg-gray-800 hover:text-white'}`}
                >
                  <div className="flex items-center space-x-3">
                    <Award className="w-5 h-5 shrink-0" />
                    <span>Évaluations</span>
                  </div>
                  {isTeacherEvaluationsExpanded ? (
                    <ChevronDown className="w-5 h-5 shrink-0" />
                  ) : (
                    <ChevronRight className="w-5 h-5 shrink-0" />
                  )}
                </button>

                {isTeacherEvaluationsExpanded && (
                  <div className="ml-4 mt-1 space-y-1">
                    {visibleTeacherEvaluationsItems.map((item) => {
                      const Icon = item.icon;
                      const isActive = pathname === item.href;

                      return (
                        <NavLink
                          key={item.href}
                          href={item.href}
                          onCloseMobileMenu={onCloseMobileMenu}
                          className={`flex items-center space-x-3 px-3 py-2 rounded-lg text-[16px] font-normal transition-colors ${isActive ? 'bg-purple-600 text-white' : 'text-gray-300 hover:bg-gray-800 hover:text-white'}`}
                        >
                          <Icon className="w-5 h-5 shrink-0" />
                          <span>{item.label}</span>
                        </NavLink>
                      );
                    })}
                  </div>
                )}
              </div>
)}

              {/* Teacher Remuneration Section */}
              {visibleTeacherRemunerationItems.length > 0 && (
<div className="pt-2">
                <button
                  onClick={() => setIsTeacherRemunerationExpanded(!isTeacherRemunerationExpanded)}
                  className={`w-full flex items-center justify-between px-3 py-2 rounded-lg text-[16px] font-normal transition-colors ${isTeacherRemunerationExpanded ? 'bg-purple-600 text-white' : 'text-gray-300 hover:bg-gray-800 hover:text-white'}`}
                >
                  <div className="flex items-center space-x-3">
                    <DollarSign className="w-5 h-5 shrink-0" />
                    <span>Mes Rémunérations</span>
                  </div>
                  {isTeacherRemunerationExpanded ? (
                    <ChevronDown className="w-5 h-5 shrink-0" />
                  ) : (
                    <ChevronRight className="w-5 h-5 shrink-0" />
                  )}
                </button>

                {isTeacherRemunerationExpanded && (
                  <div className="ml-4 mt-1 space-y-1">
                    {visibleTeacherRemunerationItems.map((item) => {
                      const Icon = item.icon;
                      const isActive = pathname === item.href;

                      return (
                        <NavLink
                          key={item.href}
                          href={item.href}
                          onCloseMobileMenu={onCloseMobileMenu}
                          className={`flex items-center space-x-3 px-3 py-2 rounded-lg text-[16px] font-normal transition-colors ${isActive ? 'bg-purple-600 text-white' : 'text-gray-300 hover:bg-gray-800 hover:text-white'}`}
                        >
                          <Icon className="w-5 h-5 shrink-0" />
                          <span>{item.label}</span>
                        </NavLink>
                      );
                    })}
                  </div>
                )}
              </div>
)}

              {/* Teacher Reports Section */}
              {visibleTeacherReportsItems.length > 0 && (
<div className="pt-2">
                <button
                  onClick={() => setIsTeacherReportsExpanded(!isTeacherReportsExpanded)}
                  className={`w-full flex items-center justify-between px-3 py-2 rounded-lg text-[16px] font-normal transition-colors ${isTeacherReportsExpanded ? 'bg-purple-600 text-white' : 'text-gray-300 hover:bg-gray-800 hover:text-white'}`}
                >
                  <div className="flex items-center space-x-3">
                    <BarChart3 className="w-5 h-5 shrink-0" />
                    <span>Rapports & Analyses</span>
                  </div>
                  {isTeacherReportsExpanded ? (
                    <ChevronDown className="w-5 h-5 shrink-0" />
                  ) : (
                    <ChevronRight className="w-5 h-5 shrink-0" />
                  )}
                </button>

                {isTeacherReportsExpanded && (
                  <div className="ml-4 mt-1 space-y-1">
                    {visibleTeacherReportsItems.map((item) => {
                      const Icon = item.icon;
                      const isActive = pathname === item.href;

                      return (
                        <NavLink
                          key={item.href}
                          href={item.href}
                          onCloseMobileMenu={onCloseMobileMenu}
                          className={`flex items-center space-x-3 px-3 py-2 rounded-lg text-[16px] font-normal transition-colors ${isActive ? 'bg-purple-600 text-white' : 'text-gray-300 hover:bg-gray-800 hover:text-white'}`}
                        >
                          <Icon className="w-5 h-5 shrink-0" />
                          <span>{item.label}</span>
                        </NavLink>
                      );
                    })}
                  </div>
                )}
              </div>
)}

              {/* Teacher Profile Section */}
              {visibleTeacherProfileItems.length > 0 && (
<div className="pt-4">
                {visibleTeacherProfileItems.map((item) => {
                  const Icon = item.icon;
                  const isActive = pathname === item.href;

                  return (
                    <NavLink
                      key={item.href}
                      href={item.href}
                      onCloseMobileMenu={onCloseMobileMenu}
                      className={`flex items-center space-x-3 px-3 py-2 rounded-lg text-[16px] font-normal transition-colors mb-1 ${isActive ? 'bg-purple-600 text-white' : 'text-gray-300 hover:bg-gray-800 hover:text-white'}`}
                    >
                      <Icon className="w-5 h-5 shrink-0" />
                      <span>{item.label}</span>
                    </NavLink>
                  );
                })}
              </div>
)}
                </>
              )}

              {/* Academic Structure Section */}
              {isAdmin && showAcademicStructureSection && (
                    <div className="pt-4">
            <div className="px-3 mb-2">
              <h3 className="text-[11px] font-normal text-gray-400 uppercase tracking-wider">
                Structure Académique
              </h3>
            </div>

            {/* Academic Structure Toggle Button */}
            {visibleAcademicStructureItems.length > 0 && (
              <>
            <button
              onClick={() => setIsAcademicStructureExpanded(!isAcademicStructureExpanded)}
              className={`w-full flex items-center justify-between px-3 py-2 rounded-lg text-[16px] font-normal transition-colors ${(pathname.startsWith('/academic/cycles') || pathname.startsWith('/academic/programmes') || pathname.startsWith('/academic/classes')) ? 'bg-blue-600 text-white' : 'text-gray-300 hover:bg-gray-800 hover:text-white'}`}
            >
              <div className="flex items-center space-x-3">
                <GraduationCap className="w-5 h-5 shrink-0" />
                <span>Cycles & Programmes</span>
              </div>
              {isAcademicStructureExpanded ? (
                <ChevronDown className="w-5 h-5 shrink-0" />
              ) : (
                <ChevronRight className="w-5 h-5 shrink-0" />
              )}
            </button>

            {/* Academic Structure Submenu */}
            {isAcademicStructureExpanded && (
              <div className="ml-4 mt-1 space-y-1">
                {visibleAcademicStructureItems.map((item) => {
                  const Icon = item.icon;
                  const isActive = pathname === item.href;

                  return (
                        <NavLink
                      key={item.href}
                          href={item.href}
                          onCloseMobileMenu={onCloseMobileMenu}
                      className={`flex items-center space-x-3 px-3 py-2 rounded-lg text-[16px] font-normal transition-colors ${isActive ? 'bg-blue-600 text-white' : 'text-gray-300 hover:bg-gray-800 hover:text-white'}`}
                    >
                      <Icon className="w-5 h-5 shrink-0" />
                      <span>{item.label}</span>
                        </NavLink>
                  );
                })}
              </div>
            )}
              </>
            )}

            {/* People Management Toggle Button */}
            {visiblePeopleItems.length > 0 && (
              <>
            <button
              onClick={() => setIsPeopleExpanded(!isPeopleExpanded)}
              className={`w-full flex items-center justify-between px-3 py-2 rounded-lg text-[16px] font-normal transition-colors mt-2 ${(pathname.startsWith('/academic/teachers') || pathname.startsWith('/academic/students') || pathname.startsWith('/academic/parents')) ? 'bg-blue-600 text-white' : 'text-gray-300 hover:bg-gray-800 hover:text-white'}`}
            >
              <div className="flex items-center space-x-3">
                <Users className="w-5 h-5 shrink-0" />
                <span>Personnes</span>
              </div>
              {isPeopleExpanded ? (
                <ChevronDown className="w-5 h-5 shrink-0" />
              ) : (
                <ChevronRight className="w-5 h-5 shrink-0" />
              )}
            </button>

            {/* People Submenu */}
            {isPeopleExpanded && (
              <div className="ml-4 mt-1 space-y-1">
                {visiblePeopleItems.map((item) => {
                  const Icon = item.icon;
                  const isActive = pathname === item.href;

                  return (
                        <NavLink
                      key={item.href}
                          href={item.href}
                          onCloseMobileMenu={onCloseMobileMenu}
                      className={`flex items-center space-x-3 px-3 py-2 rounded-lg text-[16px] font-normal transition-colors ${isActive ? 'bg-blue-600 text-white' : 'text-gray-300 hover:bg-gray-800 hover:text-white'}`}
                    >
                      <Icon className="w-5 h-5 shrink-0" />
                      <span>{item.label}</span>
                        </NavLink>
                  );
                })}
              </div>
            )}
              </>
            )}
          </div>
              )}

              {/* Module Professionnel Section */}
              {isAdmin && showProfessionalModuleSection && (
                <div className="pt-4">
                  <div className="px-3 mb-2">
                    <h3 className="text-[11px] font-normal text-gray-400 uppercase tracking-wider">
                      Module Professionnel
                    </h3>
                  </div>

                  <ProfessionalModuleGroup
                    label="Programme"
                    icon={Layers}
                    items={visibleProfessionalProgrammeItems}
                    pathname={pathname}
                    onCloseMobileMenu={onCloseMobileMenu}
                  />
                  <ProfessionalModuleGroup
                    label="Classe & Planning"
                    icon={CalendarClock}
                    items={visibleProfessionalSessionsItems}
                    pathname={pathname}
                    onCloseMobileMenu={onCloseMobileMenu}
                    className="mt-2"
                  />
                  <ProfessionalModuleGroup
                    label="Étudiants"
                    icon={Users}
                    items={visibleProfessionalStudentsItems}
                    pathname={pathname}
                    onCloseMobileMenu={onCloseMobileMenu}
                    className="mt-2"
                  />
                  <ProfessionalModuleGroup
                    label="Prospection"
                    icon={Radar}
                    items={visibleProfessionalProspectionItems}
                    pathname={pathname}
                    onCloseMobileMenu={onCloseMobileMenu}
                    className="mt-2"
                  />
                  <ProfessionalModuleGroup
                    label="Suivi & Évaluation"
                    icon={ClipboardCheck}
                    items={visibleProfessionalTrackingItems}
                    pathname={pathname}
                    onCloseMobileMenu={onCloseMobileMenu}
                    className="mt-2"
                  />
                  <ProfessionalModuleGroup
                    label="Documents officiels"
                    icon={Award}
                    items={visibleProfessionalDocumentsItems}
                    pathname={pathname}
                    onCloseMobileMenu={onCloseMobileMenu}
                    className="mt-2"
                  />
                </div>
              )}

              {/* Academic Operations Section */}
              {isAdmin && showAcademicOperationsSection && (
                    <div className="pt-2">
            <div className="px-3 mb-2">
              <h3 className="text-[11px] font-normal text-gray-400 uppercase tracking-wider">
                Opérations Académiques
              </h3>
            </div>

            {/* Academic Operations Toggle Button */}
            {visibleAcademicOperationsItems.length > 0 && (
              <>
            <button
              onClick={() => setIsAcademicOperationsExpanded(!isAcademicOperationsExpanded)}
              className={`w-full flex items-center justify-between px-3 py-2 rounded-lg text-[16px] font-normal transition-colors ${(pathname.startsWith('/annee-academique') || pathname.startsWith('/academic/assignments')) ? 'bg-blue-600 text-white' : 'text-gray-300 hover:bg-gray-800 hover:text-white'}`}
            >
              <div className="flex items-center space-x-3">
                <Calendar className="w-5 h-5 shrink-0" />
                <span>Année Académique</span>
              </div>
              {isAcademicOperationsExpanded ? (
                <ChevronDown className="w-5 h-5 shrink-0" />
              ) : (
                <ChevronRight className="w-5 h-5 shrink-0" />
              )}
            </button>

            {/* Academic Operations Submenu */}
            {isAcademicOperationsExpanded && (
              <div className="ml-4 mt-1 space-y-1">
                {visibleAcademicOperationsItems.map((item) => {
                  const Icon = item.icon;
                  const isActive = pathname === item.href;

                  return (
                        <NavLink
                      key={item.href}
                          href={item.href}
                          onCloseMobileMenu={onCloseMobileMenu}
                      className={`flex items-center space-x-3 px-3 py-2 rounded-lg text-[16px] font-normal transition-colors ${isActive ? 'bg-blue-600 text-white' : 'text-gray-300 hover:bg-gray-800 hover:text-white'}`}
                    >
                      <Icon className="w-5 h-5 shrink-0" />
                      <span>{item.label}</span>
                        </NavLink>
                  );
                })}
              </div>
            )}

              </>
            )}

            {/* BTS Toggle Button */}
            {visibleBtsItems.length > 0 && (
              <>
            <button
              onClick={() => setIsBtsExpanded(!isBtsExpanded)}
              className={`w-full flex items-center justify-between px-3 py-2 rounded-lg text-[16px] font-normal transition-colors mt-2 ${pathname.startsWith('/annee-academique/moyennes-semestre') ? 'bg-blue-600 text-white' : 'text-gray-300 hover:bg-gray-800 hover:text-white'}`}
            >
              <div className="flex items-center space-x-3">
                <GraduationCap className="w-5 h-5 shrink-0" />
                <span>BTS</span>
              </div>
              {isBtsExpanded ? (
                <ChevronDown className="w-5 h-5 shrink-0" />
              ) : (
                <ChevronRight className="w-5 h-5 shrink-0" />
              )}
            </button>

            {/* BTS Submenu */}
            {isBtsExpanded && (
              <div className="ml-4 mt-1 space-y-1">
                {visibleBtsItems.map((item) => {
                  const Icon = item.icon;
                  const isActive = pathname === item.href;

                  return (
                        <NavLink
                      key={item.href}
                          href={item.href}
                          onCloseMobileMenu={onCloseMobileMenu}
                      className={`flex items-center space-x-3 px-3 py-2 rounded-lg text-[16px] font-normal transition-colors ${isActive ? 'bg-blue-600 text-white' : 'text-gray-300 hover:bg-gray-800 hover:text-white'}`}
                    >
                      <Icon className="w-5 h-5 shrink-0" />
                      <span>{item.label}</span>
                        </NavLink>
                  );
                })}
              </div>
            )}

              </>
            )}

            {/* Daily Operations Toggle Button */}
            {visibleDailyOperationsItems.length > 0 && (
              <>
            <button
              onClick={() => setIsDailyOperationsExpanded(!isDailyOperationsExpanded)}
              className={`w-full flex items-center justify-between px-3 py-2 rounded-lg text-[16px] font-normal transition-colors mt-2 ${(pathname.startsWith('/attendance') || pathname.startsWith('/schedule-generation')) ? 'bg-blue-600 text-white' : 'text-gray-300 hover:bg-gray-800 hover:text-white'}`}
            >
              <div className="flex items-center space-x-3">
                <ClipboardCheck className="w-5 h-5 shrink-0" />
                <span>Post BTS</span>
              </div>
              {isDailyOperationsExpanded ? (
                <ChevronDown className="w-5 h-5 shrink-0" />
              ) : (
                <ChevronRight className="w-5 h-5 shrink-0" />
              )}
            </button>

            {/* Daily Operations Submenu */}
            {isDailyOperationsExpanded && (
              <div className="ml-4 mt-1 space-y-1">
                {visibleDailyOperationsItems.map((item) => {
                  const Icon = item.icon;
                  const isActive = pathname === item.href;

                  return (
                        <NavLink
                      key={item.href}
                          href={item.href}
                          onCloseMobileMenu={onCloseMobileMenu}
                      className={`flex items-center space-x-3 px-3 py-2 rounded-lg text-[16px] font-normal transition-colors ${isActive ? 'bg-blue-600 text-white' : 'text-gray-300 hover:bg-gray-800 hover:text-white'}`}
                    >
                      <Icon className="w-5 h-5 shrink-0" />
                      <span>{item.label}</span>
                        </NavLink>
                  );
                })}
              </div>
            )}
              </>
            )}

            {/* Catalogue Formations Section */}

            {/* Administration Pro Section */}

          </div>
          )}

              {/* Teacher Payment Section */}
              {isAdmin && visibleTeacherPaymentItems.length > 0 && (
                    <div className="pt-4">
            <div className="px-3 mb-2">
              <h3 className="text-[11px] font-normal text-gray-400 uppercase tracking-wider">
                Rémunération
              </h3>
            </div>

            {/* Teacher Payment Toggle Button */}
            <button
              onClick={() => setIsTeacherPaymentExpanded(!isTeacherPaymentExpanded)}
              className={`w-full flex items-center justify-between px-2 py-2 rounded-lg text-[16px] font-normal transition-colors ${isTeacherPaymentRoute ? 'bg-blue-600 text-white' : 'text-gray-300 hover:bg-gray-800 hover:text-white'}`}
            >
              <div className="flex items-center space-x-2">
                <DollarSign className="w-5 h-5 shrink-0" />
                <span className="whitespace-nowrap">Rémunération</span>
              </div>
              {isTeacherPaymentExpanded ? (
                <ChevronDown className="w-5 h-5 shrink-0" />
              ) : (
                <ChevronRight className="w-5 h-5 shrink-0" />
              )}
            </button>

            {/* Teacher Payment Submenu */}
            {isTeacherPaymentExpanded && (
              <div className="ml-4 mt-1 space-y-1">
                {visibleTeacherPaymentItems.map((item) => {
                  const Icon = item.icon;
                  const isActive = pathname === item.href;

                  return (
                        <NavLink
                      key={item.href}
                          href={item.href}
                          onCloseMobileMenu={onCloseMobileMenu}
                      className={`flex items-center space-x-2 px-2 py-2 rounded-lg text-[16px] font-normal transition-colors ${isActive ? 'bg-blue-600 text-white' : 'text-gray-300 hover:bg-gray-800 hover:text-white'}`}
                    >
                      <Icon className="w-5 h-5 shrink-0" />
                      <span className="whitespace-nowrap">{item.label}</span>
                        </NavLink>
                  );
                })}
              </div>
            )}
          </div>
          )}



          {/* Student Finance Section - Only show for students */}
          {session?.user && (session as any).roles && (session as any).roles.includes('student') && visibleStudentFinanceItems.length > 0 && (
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
                  <Wallet className="w-5 h-5 shrink-0" />
                  <span>Paiements & Reçus</span>
                </div>
                {isStudentFinanceExpanded ? (
                  <ChevronDown className="w-5 h-5 shrink-0" />
                ) : (
                  <ChevronRight className="w-5 h-5 shrink-0" />
                )}
              </button>

              {/* Student Finance Submenu */}
              {isStudentFinanceExpanded && (
                <div className="ml-4 mt-1 space-y-1">
                  {visibleStudentFinanceItems.map((item) => {
                    const Icon = item.icon;
                    const isActive = pathname === item.href;

                    return (
                        <NavLink
                        key={item.href}
                          href={item.href}
                          onCloseMobileMenu={onCloseMobileMenu}
                        className={`flex items-center space-x-3 px-3 py-2 rounded-lg text-[16px] font-normal transition-colors ${isActive ? 'bg-blue-600 text-white' : 'text-gray-300 hover:bg-gray-800 hover:text-white'}`}
                      >
                        <Icon className="w-5 h-5 shrink-0" />
                        <span>{item.label}</span>
                        </NavLink>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* Student Finance Admin Section - Only show for admins */}
          {session?.user && (session as any).roles && (session as any).roles.some((role: string) => ['admin', 'super_admin'].includes(role)) && visibleStudentFinanceAdminItems.length > 0 && (
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
                  <PieChart className="w-5 h-5 shrink-0" />
                  <span>Gestion Financière</span>
                </div>
                {isStudentFinanceAdminExpanded ? (
                  <ChevronDown className="w-5 h-5 shrink-0" />
                ) : (
                  <ChevronRight className="w-5 h-5 shrink-0" />
                )}
              </button>

              {/* Student Finance Admin Submenu */}
              {isStudentFinanceAdminExpanded && (
                <div className="ml-4 mt-1 space-y-1">
                  {visibleStudentFinanceAdminItems.map((item) => {
                    const Icon = item.icon;
                    const isActive = pathname === item.href;

                    return (
                        <NavLink
                        key={item.href}
                          href={item.href}
                          onCloseMobileMenu={onCloseMobileMenu}
                        className={`flex items-center space-x-3 px-3 py-2 rounded-lg text-[16px] font-normal transition-colors ${isActive ? 'bg-blue-600 text-white' : 'text-gray-300 hover:bg-gray-800 hover:text-white'}`}
                      >
                        <Icon className="w-5 h-5 shrink-0" />
                        <span>{item.label}</span>
                        </NavLink>
                    );
                  })}
                </div>
              )}
            </div>
          )}

              {/* Admin Communication Section */}
              {isAdmin && canSeeAdminMessages && (
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
                <MessageSquare className="w-5 h-5 shrink-0" />
                <span>Messages</span>
              </NavLink>
            </div>
          )}
              {isAdmin && visibleAdminQuickItems.length > 0 && (
                    <div className="pt-4">
                      <div className="px-3 mb-2">
                <h3 className="text-[11px] font-normal text-gray-400 uppercase tracking-wider">
                  Administration
                </h3>
              </div>
              {visibleAdminQuickItems.map((item) => {
                const Icon = item.icon;
                const isActive = pathname === item.href || pathname.startsWith(`${item.href}/`);
                return (
                  <NavLink
                    key={item.href}
                    href={item.href}
                    onCloseMobileMenu={onCloseMobileMenu}
                    className={`flex items-center space-x-3 px-3 py-2 rounded-lg text-[16px] font-normal transition-colors ${isActive ? 'bg-blue-600 text-white' : 'text-gray-300 hover:bg-gray-800 hover:text-white'}`}
                  >
                    <Icon className="w-5 h-5 shrink-0" />
                    <span>{item.label}</span>
                  </NavLink>
                );
              })}
            </div>
          )}
            </>
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
                <Settings className="w-5 h-5 shrink-0" />
                <span>Settings</span>
              </button>
              <button
                onClick={handleLogout}
                className="flex items-center justify-center space-x-2 px-3 py-2 rounded-lg text-[16px] font-normal text-gray-300 hover:bg-red-600 hover:text-white transition-colors flex-1"
              >
                <LogOut className="w-5 h-5 shrink-0" />
                <span>Logout</span>
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}






