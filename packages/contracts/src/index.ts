export * from "./auth";
export * from "./entities";
export * from "./tenant";
export * from "./user";
export * from "./common";
export * from "./academic";
export * from "./academic-year";
export * from "./student";
export * from "./assignment";
export * from "./attendance";
export * from "./materials";
export * from "./evaluations";
export * from "./payments";
// export * from "./student-payments"; // Commented out due to conflicting PaymentReportQuery export
export * from "./schedule-generation";
export * from "./classrooms";

// Export des nouveaux contrats pour les tableaux de bord
export * from './student-dashboard';
export * from './teacher-students';
export * from './parent';

export * from "./owner.schema";
export * from "./owner-stats.schema";
export * from "./owner-charges.schema";
export * from "./owner-scolarite.schema";
export * from "./owner-documents.schema";
export * from "./owner-programme.schema";

// Rôles administratifs personnalisés + permissions sur les menus du sidebar admin
export * from "./admin-roles.schema";

// Export des contrats du Module Professionnel (Filière → UE → ECUE) — features 028 → 030
export * from "./professional";

// Export des contrats des Diplômes Professionnels (composés d'UE) — features 029 → 030
export * from "./professional-diplomas";

// Signataires configurables des documents officiels (attestations, diplôme)
export * from "./professional-signataires";

// Rémunération des enseignants du Module Professionnel — feature 031
// (séances payables + tarifs horaires par ECUE ; le moteur de paie reste celui
// de ./payments, partagé avec l'Académique)
export * from "./professional-remuneration";

// Export des contrats du Module Professionnel (Filière → UE → ECUE) — features 028 → 030
export * from "./professional";

// Export des contrats des Diplômes Professionnels (composés d'UE) — features 029 → 030
export * from "./professional-diplomas";












// Prospection : provenance des étudiants, commerciaux et commissions
export * from "./prospection";
