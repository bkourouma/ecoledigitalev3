import { z } from "zod";

/**
 * Catalogue des menus du sidebar ADMINISTRATEUR.
 *
 * Seuls les menus visibles par un administrateur d'établissement sont listés :
 * les espaces parent / élève / enseignant / formateur ne sont pas concernés par
 * les rôles administratifs et restent pilotés par les rôles socle.
 *
 * `key` est l'identifiant stocké en base (`admin_role_menus.menu_key`) : il doit
 * rester stable. `href` sert au filtrage du sidebar côté web (correspondance
 * exacte avec le `href` de l'entrée de menu).
 */
export interface AdminMenuItemDef {
  key: string;
  label: string;
  href: string;
}

export interface AdminMenuGroupDef {
  /** Libellé du sous-menu dépliant, ou du bloc quand il n'y en a pas. */
  label: string;
  items: AdminMenuItemDef[];
}

export interface AdminMenuSectionDef {
  /** Titre de section affiché en majuscules dans le sidebar. */
  label: string;
  groups: AdminMenuGroupDef[];
}

export const ADMIN_MENU_CATALOG: AdminMenuSectionDef[] = [
  {
    label: "Structure Académique",
    groups: [
      {
        label: "Cycles & Programmes",
        items: [
          // La clé reste `academic.overview` (elle est persistée dans
          // `admin_role_menus`) mais la page « Vue d'ensemble » vit désormais
          // sous /tableau-de-bord : /academic n'existe plus.
          { key: "academic.overview", label: "Vue d'ensemble", href: "/tableau-de-bord" },
          { key: "academic.cycles", label: "Cycles", href: "/academic/cycles" },
          { key: "academic.programmes", label: "Filières", href: "/academic/programmes" },
        ],
      },
      {
        label: "Personnes",
        items: [
          { key: "people.teachers", label: "Enseignants", href: "/academic/teachers" },
          { key: "people.students", label: "Étudiants", href: "/academic/students" },
          { key: "people.parents", label: "Parents", href: "/academic/parents" },
        ],
      },
    ],
  },
  {
    label: "Module Professionnel",
    groups: [
      {
        label: "Programme",
        items: [
          { key: "pro.ue", label: "UE", href: "/professionnel/admin/ue" },
          { key: "pro.ecue", label: "ECUE", href: "/professionnel/admin/matieres" },
          { key: "pro.semestres", label: "Semestres", href: "/professionnel/admin/semestres" },
        ],
      },
      {
        label: "Sessions & Planning",
        items: [
          { key: "pro.sessions", label: "Sessions", href: "/professionnel/admin/sessions" },
          { key: "pro.classrooms", label: "Salles de classe", href: "/academic/classrooms" },
          {
            key: "pro.planning",
            label: "Planning des cours",
            href: "/professionnel/admin/planning",
          },
        ],
      },
      {
        label: "Étudiants",
        items: [
          {
            key: "pro.inscriptions",
            label: "Inscriptions",
            href: "/professionnel/admin/inscriptions",
          },
          {
            key: "pro.inscrits",
            label: "Étudiants inscrits",
            href: "/professionnel/admin/inscrits",
          },
          { key: "pro.paiements", label: "Paiements", href: "/professionnel/admin/paiements" },
        ],
      },
      {
        label: "Suivi & Évaluation",
        items: [
          { key: "pro.presences", label: "Présences", href: "/professionnel/admin/presences" },
          { key: "pro.conduite", label: "Conduite", href: "/professionnel/admin/conduite" },
          { key: "pro.notes", label: "Notes", href: "/professionnel/admin/notes" },
          {
            key: "pro.rattrapages",
            label: "Rattrapages",
            href: "/professionnel/admin/notes/rattrapages",
          },
          { key: "pro.bulletins", label: "Bulletins", href: "/professionnel/admin/bulletins" },
        ],
      },
      {
        label: "Documents officiels",
        items: [
          {
            key: "pro.attestations",
            label: "Attestations de réussite",
            href: "/professionnel/admin/attestations",
          },
          { key: "pro.diplomes", label: "Diplômes", href: "/professionnel/admin/diplomes" },
          {
            key: "pro.signataires",
            label: "Signataires",
            href: "/professionnel/admin/signataires",
          },
        ],
      },
    ],
  },
  {
    label: "Opérations Académiques",
    groups: [
      {
        label: "Année Académique",
        items: [
          { key: "year.start", label: "Démarrer Année", href: "/annee-academique/demarrer" },
          { key: "year.classes", label: "Classes", href: "/annee-academique/ajouter-classe" },
          {
            key: "year.course_assignments",
            label: "Affectations Cours",
            href: "/academic/assignments",
          },
          {
            key: "year.enrollments",
            label: "Inscriptions",
            href: "/annee-academique/inscription",
          },
        ],
      },
      {
        label: "BTS",
        items: [
          {
            key: "bts.semester_averages",
            label: "Moyennes semestre",
            href: "/annee-academique/moyennes-semestre",
          },
        ],
      },
      {
        label: "Post BTS",
        items: [
          { key: "ops.schedule_generation", label: "Génération Planning", href: "/simple-schedule" },
          {
            key: "ops.schedule_calendar",
            label: "Calendrier Cours",
            href: "/schedule-generation/calendar",
          },
          {
            key: "ops.schedule_stats",
            label: "Statistiques Planning",
            href: "/schedule-generation/stats",
          },
        ],
      },
      {
        label: "Catalogue Formations",
        items: [
          {
            key: "fpro.catalogue",
            label: "Catalogue",
            href: "/formations-professionnelles/catalogue",
          },
          {
            key: "fpro.sessions",
            label: "Calendrier des Sessions",
            href: "/formations-professionnelles/sessions",
          },
          {
            key: "fpro.public",
            label: "Page Publique",
            href: "/formations-professionnelles/public",
          },
        ],
      },
      {
        label: "Administration Pro",
        items: [
          {
            key: "fpro.admin_sessions",
            label: "Gestion des Sessions",
            href: "/formations-professionnelles/admin/sessions",
          },
          {
            key: "fpro.admin_session_create",
            label: "Créer une Session",
            href: "/formations-professionnelles/admin/sessions/creer",
          },
          {
            key: "fpro.admin_formateurs",
            label: "Formateurs",
            href: "/formations-professionnelles/admin/formateurs",
          },
        ],
      },
    ],
  },
  {
    label: "Rémunération Enseignants",
    groups: [
      {
        label: "Rémunération Enseignants",
        items: [
          { key: "payroll.periods", label: "Périodes de Paiement", href: "/payments/periods" },
          {
            key: "payroll.teacher_configs",
            label: "Configuration Enseignants",
            href: "/payments/teacher-configs",
          },
          {
            key: "payroll.teaching_hours",
            label: "Validation des Heures",
            href: "/payments/teaching-hours",
          },
          {
            key: "payroll.calculate",
            label: "Calcul des Paiements",
            href: "/payments/calculate",
          },
          { key: "payroll.manage", label: "Gestion des Paiements", href: "/payments/manage" },
          { key: "payroll.reports", label: "Rapports Enseignants", href: "/payments/reports" },
        ],
      },
    ],
  },
  {
    label: "Finances Étudiantes",
    groups: [
      {
        label: "Gestion Financière",
        items: [
          { key: "finance.scolarite", label: "Scolarité", href: "/admin/finances/scolarite" },
          {
            key: "finance.tuition_schedules",
            label: "Échéanciers",
            href: "/admin/finances/tuition-schedules",
          },
          {
            key: "finance.student_payments",
            label: "Paiements Étudiants",
            href: "/admin/finances/student-payments",
          },
          {
            key: "finance.reports",
            label: "Rapports Financiers",
            href: "/admin/finances/reports",
          },
        ],
      },
    ],
  },
  {
    label: "Communication",
    groups: [
      {
        label: "Communication",
        items: [{ key: "comm.messages", label: "Messages", href: "/admin/messages" }],
      },
    ],
  },
  {
    label: "Administration",
    groups: [
      {
        label: "Administration",
        items: [
          { key: "admin.acces", label: "Accès", href: "/owner/acces" },
          { key: "admin.roles", label: "Rôles", href: "/admin/roles" },
          { key: "admin.users", label: "Utilisateurs", href: "/admin/utilisateurs" },
        ],
      },
    ],
  },
];

/**
 * Catalogues des menus des rôles socle (hors administrateur).
 *
 * Ils reflètent le sidebar tel qu'il est rendu pour chaque espace. Les entrées
 * commentées dans `Sidebar.tsx` (E-Learning étudiant, paramètres parent…) n'y
 * figurent pas : on ne peut pas donner une permission sur un menu qui n'existe
 * pas à l'écran.
 */
export const TEACHER_MENU_CATALOG: AdminMenuSectionDef[] = [
  {
    label: "Espace enseignant",
    groups: [
      {
        label: "Tableau de bord",
        items: [
          { key: "teacher.dashboard", label: "Tableau de Bord", href: "/teacher/dashboard" },
        ],
      },
      {
        label: "Gestion des Cours",
        items: [
          { key: "teacher.courses", label: "Mes Cours", href: "/teacher/courses" },
          { key: "teacher.schedule", label: "Planning des Cours", href: "/teacher/schedule" },
          { key: "teacher.attendance", label: "Présences", href: "/teacher/attendance" },
          { key: "teacher.notes", label: "Notes", href: "/professionnel/admin/notes" },
        ],
      },
      {
        label: "Mes Étudiants",
        items: [
          { key: "teacher.students", label: "Liste des Étudiants", href: "/teacher/students" },
          {
            key: "teacher.communications",
            label: "Communications",
            href: "/teacher/communications",
          },
        ],
      },
      {
        label: "Évaluations",
        items: [
          {
            key: "teacher.evaluations",
            label: "Mes évaluations",
            href: "/teacher/assignments/create",
          },
          {
            key: "teacher.assign_homework",
            label: "Assigner un devoir",
            href: "/academic/assignments/assign",
          },
          {
            key: "teacher.corrections",
            label: "Corrections en Attente",
            href: "/teacher/corrections",
          },
        ],
      },
      {
        label: "Mes Rémunérations",
        items: [
          { key: "teacher.hours", label: "Heures Enseignées", href: "/teacher/hours" },
          { key: "teacher.payments", label: "Mes Paiements", href: "/teacher/payments" },
        ],
      },
      {
        label: "Rapports & Analyses",
        items: [
          { key: "teacher.reports", label: "Dashboard Analytique", href: "/teacher/reports" },
        ],
      },
      {
        label: "Profil",
        items: [
          {
            key: "teacher.profile",
            label: "Informations Personnelles",
            href: "/teacher/profile",
          },
        ],
      },
    ],
  },
];

export const STUDENT_MENU_CATALOG: AdminMenuSectionDef[] = [
  {
    label: "Espace étudiant",
    groups: [
      {
        label: "Mes Études",
        items: [
          { key: "student.courses", label: "Mes Cours", href: "/student/courses" },
          { key: "student.schedule", label: "Emploi du Temps", href: "/student/schedule" },
          { key: "student.assignments", label: "Devoirs", href: "/student/assignments" },
          { key: "student.grades", label: "Mes Notes", href: "/student/grades" },
          { key: "student.bulletin", label: "Mon Bulletin", href: "/student/bulletin" },
          {
            key: "student.professionnel",
            label: "Module Professionnel",
            href: "/professionnel/etudiant",
          },
        ],
      },
      {
        label: "Communication",
        items: [{ key: "student.messages", label: "Messages", href: "/student/messages" }],
      },
      {
        label: "Assistance",
        items: [
          { key: "student.ai_tutor", label: "Tuteur IA", href: "/student/ai-tutor" },
          { key: "student.support", label: "Support", href: "/student/support" },
        ],
      },
      {
        label: "Mes Finances",
        items: [{ key: "student.payments", label: "Mes Paiements", href: "/student-payments" }],
      },
      {
        label: "Profil",
        items: [{ key: "student.profile", label: "Mon Profil", href: "/student/profile" }],
      },
    ],
  },
];

export const PARENT_MENU_CATALOG: AdminMenuSectionDef[] = [
  {
    label: "Espace parent",
    groups: [
      {
        label: "Mes Enfants",
        items: [
          { key: "parent.children", label: "Mes Enfants", href: "/parent/children" },
          { key: "parent.homework", label: "Cours & Devoirs", href: "/parent/homework" },
          { key: "parent.documents", label: "Bulletins & Reçus", href: "/parent/documents" },
          { key: "parent.messages", label: "Messages", href: "/parent/messages" },
          {
            key: "parent.professionnel",
            label: "Parcours Professionnel",
            href: "/parent/professionnel",
          },
          {
            key: "parent.diplomes",
            label: "Diplômes de mon enfant",
            href: "/parent/professionnel/diplomes",
          },
        ],
      },
    ],
  },
];

export const FORMATEUR_MENU_CATALOG: AdminMenuSectionDef[] = [
  {
    label: "Espace formateur",
    groups: [
      {
        label: "Espace formateur",
        items: [
          { key: "formateur.dashboard", label: "Tableau de bord", href: "/formateur/dashboard" },
          { key: "formateur.planning", label: "Planning", href: "/formateur/planning" },
          { key: "formateur.sessions", label: "Sessions", href: "/formateur/sessions" },
          { key: "formateur.supports", label: "Supports", href: "/formateur/supports" },
          {
            key: "formateur.catalogue",
            label: "Catalogue",
            href: "/formations-professionnelles/catalogue",
          },
          {
            key: "formateur.public",
            label: "Page publique",
            href: "/formations-professionnelles/public",
          },
          { key: "formateur.profil", label: "Profil", href: "/formateur/profil" },
        ],
      },
    ],
  },
];

/**
 * Rôles socle dont les menus sont configurables depuis « Accès → Menus par rôle ».
 * Même périmètre que les rôles attribuables sur cette page.
 */
export const MENU_SCOPES = ["admin", "teacher", "student", "parent", "formateur"] as const;
export type MenuScope = (typeof MENU_SCOPES)[number];

export const MENU_SCOPE_LABELS: Record<MenuScope, string> = {
  admin: "Administrateur",
  teacher: "Enseignant",
  student: "Étudiant",
  parent: "Parent",
  formateur: "Formateur",
};

export const MENU_CATALOG_BY_SCOPE: Record<MenuScope, AdminMenuSectionDef[]> = {
  admin: ADMIN_MENU_CATALOG,
  teacher: TEACHER_MENU_CATALOG,
  student: STUDENT_MENU_CATALOG,
  parent: PARENT_MENU_CATALOG,
  formateur: FORMATEUR_MENU_CATALOG,
};

function flatten(sections: AdminMenuSectionDef[]): AdminMenuItemDef[] {
  return sections.flatMap((section) => section.groups.flatMap((group) => group.items));
}

/** Toutes les entrées d'un périmètre, à plat. */
export function menuItemsForScope(scope: MenuScope): AdminMenuItemDef[] {
  return flatten(MENU_CATALOG_BY_SCOPE[scope]);
}

/**
 * `href` → clé de menu, PAR périmètre.
 *
 * Un même `href` peut appartenir à deux espaces (« Notes » est à la fois un menu
 * admin et un menu enseignant) : la correspondance ne peut donc pas être globale.
 */
export const MENU_KEY_BY_HREF_BY_SCOPE: Record<MenuScope, Record<string, string>> =
  Object.fromEntries(
    MENU_SCOPES.map((scope) => [
      scope,
      Object.fromEntries(menuItemsForScope(scope).map((item) => [item.href, item.key])),
    ])
  ) as Record<MenuScope, Record<string, string>>;

/** Toutes les entrées du catalogue admin, à plat. */
export const ADMIN_MENU_ITEMS: AdminMenuItemDef[] = flatten(ADMIN_MENU_CATALOG);

/** Toutes les clés de menu connues (référentiel de validation). */
export const ADMIN_MENU_KEYS: string[] = ADMIN_MENU_ITEMS.map((item) => item.key);

/** `href` → clé de menu, pour filtrer le sidebar existant sans le réécrire. */
export const ADMIN_MENU_KEY_BY_HREF: Record<string, string> = Object.fromEntries(
  ADMIN_MENU_ITEMS.map((item) => [item.href, item.key])
);

export function isKnownAdminMenuKey(key: string): boolean {
  return ADMIN_MENU_KEYS.includes(key);
}

// ---------------------------------------------------------------------------
// Schémas d'échange API
// ---------------------------------------------------------------------------

export const AdminMenuItemSchema = z.object({
  key: z.string().min(1),
  label: z.string().min(1),
  href: z.string().min(1),
});

export const AdminMenuGroupSchema = z.object({
  label: z.string().min(1),
  items: z.array(AdminMenuItemSchema),
});

export const AdminMenuSectionSchema = z.object({
  label: z.string().min(1),
  groups: z.array(AdminMenuGroupSchema),
});

export const AdminMenuCatalogResponseSchema = z.object({
  sections: z.array(AdminMenuSectionSchema),
});

export const AdminRoleSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1),
  isActive: z.boolean(),
  menuKeys: z.array(z.string()),
  userCount: z.number().int().nonnegative(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const AdminRolesListResponseSchema = z.object({
  roles: z.array(AdminRoleSchema),
});

export const AdminRoleCreateBodySchema = z.object({
  name: z.string().trim().min(2).max(100),
  menuKeys: z.array(z.string().min(1)).default([]),
});

export const AdminRoleUpdateBodySchema = z.object({
  name: z.string().trim().min(2).max(100).optional(),
  isActive: z.boolean().optional(),
  menuKeys: z.array(z.string().min(1)).optional(),
});

export const AdminRoleMenusPutBodySchema = z.object({
  menuKeys: z.array(z.string().min(1)),
});

export const AdminManagedUserSchema = z.object({
  userId: z.string().uuid(),
  email: z.string(),
  firstName: z.string(),
  lastName: z.string(),
  isActive: z.boolean(),
  adminRoleId: z.string().uuid().nullable(),
  adminRoleName: z.string().nullable(),
  roleKeys: z.array(z.string()),
  createdAt: z.string(),
});

export const AdminUsersListResponseSchema = z.object({
  users: z.array(AdminManagedUserSchema),
});

export const AdminUserCreateBodySchema = z.object({
  firstName: z.string().trim().min(1).max(100),
  lastName: z.string().trim().min(1).max(100),
  email: z.string().trim().email(),
  password: z.string().min(6).max(200),
  adminRoleId: z.string().uuid(),
});

export const AdminUserAdminRolePatchBodySchema = z.object({
  /** `null` retire le rôle administratif (l'utilisateur retrouve l'accès complet). */
  adminRoleId: z.string().uuid().nullable(),
});

export const AdminMyMenusResponseSchema = z.object({
  /** `true` quand aucun rôle administratif ne restreint l'utilisateur. */
  allowAll: z.boolean(),
  menuKeys: z.array(z.string()),
  adminRoleName: z.string().nullable(),
  /**
   * Menus retirés aux rôles socle de l'utilisateur (onglet « Menus par rôle »).
   * S'applique en plus de `menuKeys`, y compris quand `allowAll` vaut `true`.
   */
  deniedMenuKeys: z.array(z.string()).default([]),
});

// ---------------------------------------------------------------------------
// Menus par défaut des rôles socle (admin, teacher, student, parent, formateur)
// ---------------------------------------------------------------------------

export const RoleMenuScopeSchema = z.enum(MENU_SCOPES);

export const RoleMenuSettingSchema = z.object({
  roleKey: RoleMenuScopeSchema,
  label: z.string(),
  /** Menus explicitement retirés à ce rôle. Vide = tous les menus par défaut. */
  deniedMenuKeys: z.array(z.string()),
});

export const RoleMenusListResponseSchema = z.object({
  roles: z.array(RoleMenuSettingSchema),
});

export const RoleMenusPutBodySchema = z.object({
  /** Menus cochés. Tout menu du catalogue absent de cette liste est retiré. */
  allowedMenuKeys: z.array(z.string().min(1)),
});

export type AdminMenuCatalogResponse = z.infer<typeof AdminMenuCatalogResponseSchema>;
export type AdminRole = z.infer<typeof AdminRoleSchema>;
export type AdminRolesListResponse = z.infer<typeof AdminRolesListResponseSchema>;
export type AdminRoleCreateBody = z.infer<typeof AdminRoleCreateBodySchema>;
export type AdminRoleUpdateBody = z.infer<typeof AdminRoleUpdateBodySchema>;
export type AdminRoleMenusPutBody = z.infer<typeof AdminRoleMenusPutBodySchema>;
export type AdminManagedUser = z.infer<typeof AdminManagedUserSchema>;
export type AdminUsersListResponse = z.infer<typeof AdminUsersListResponseSchema>;
export type AdminUserCreateBody = z.infer<typeof AdminUserCreateBodySchema>;
export type AdminUserAdminRolePatchBody = z.infer<typeof AdminUserAdminRolePatchBodySchema>;
export type AdminMyMenusResponse = z.infer<typeof AdminMyMenusResponseSchema>;
export type RoleMenuSetting = z.infer<typeof RoleMenuSettingSchema>;
export type RoleMenusListResponse = z.infer<typeof RoleMenusListResponseSchema>;
export type RoleMenusPutBody = z.infer<typeof RoleMenusPutBodySchema>;
