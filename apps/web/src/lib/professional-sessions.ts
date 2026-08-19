/**
 * Helpers partagés sur les cohortes (sessions d'UE) du Module Professionnel.
 * Utilisés par les écrans enseignant qui listent ou filtrent des sessions.
 */

/**
 * Session encore active : ni terminée ni annulée, et pas encore échue.
 * Transposition de OPEN_SESSION_CLAUSE côté API (emploi du temps, plannings),
 * pour que « active » désigne la même chose partout.
 */
export function isSessionActive(s: any): boolean {
  if (s?.statut === "termine" || s?.statut === "annule") return false;
  const now = new Date();
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(
    now.getDate()
  ).padStart(2, "0")}`;
  return String(s?.date_fin ?? "") >= today;
}

/** Libellé lisible d'une session : le code UE y est remplacé par son libellé. */
export function sessionLabel(s: any): string {
  const base = String(s?.libelle ?? s?.session_libelle ?? "");
  return s?.ue_code && s?.ue_libelle && base.includes(s.ue_code)
    ? base.replace(s.ue_code, s.ue_libelle)
    : s?.ue_libelle
    ? `${base} — ${s.ue_libelle}`
    : base;
}
