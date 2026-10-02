/**
 * Permissions du module (manifeste `stateassign`) : fichier SANS directive client, importable par les pages serveur (gardes) comme
 * par les écrans. L'écran AFFICHE ou masque ; l'API reste la barrière réelle.
 */
export const PERM = {
  read: "stateassign.read",
  record: "stateassign.record",
  verify: "stateassign.verify",
  manage: "stateassign.manage",
  amend: "stateassign.amend",
  reconcile: "stateassign.reconcile",
  receivableManage: "stateassign.receivable.manage",
  controlPerform: "stateassign.control.perform",
  documentManage: "stateassign.document.manage",
  export: "stateassign.export",
  settingsManage: "stateassign.settings.manage",
  childRead: "stateassign.child.read",
} as const;

/** Écrans de lecture : au moins une de ces permissions ouvre la section. */
export const VIEW_PERMISSIONS = [PERM.read, PERM.verify, PERM.reconcile, PERM.record] as const;
