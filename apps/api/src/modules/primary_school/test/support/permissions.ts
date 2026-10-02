/** Permissions déclarées par le manifeste (source de vérité des tests de matrice de rôles). */
import manifest from "../../manifest";

export const PRIMARY_PERMISSIONS_LIST: readonly string[] = manifest.permissions.map((p) => p.key);
export const SENSITIVE_PERMISSIONS: readonly string[] = manifest.permissions.filter((p) => p.sensitive).map((p) => p.key);
